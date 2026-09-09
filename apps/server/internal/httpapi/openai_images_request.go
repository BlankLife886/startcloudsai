package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

const openAIImageInputBytes = 32 << 20

type openAIImageRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	N              int    `json:"n"`
	Size           string `json:"size"`
	Quality        string `json:"quality"`
	ResponseFormat string `json:"response_format"`
	OutputFormat   string `json:"output_format"`
	Background     string `json:"background"`
	Moderation     string `json:"moderation"`
	User           string `json:"user"`
	Stream         bool   `json:"stream"`
}

type openAIParameterError struct {
	Param   string
	Message string
	Code    string
}

func (e *openAIParameterError) Error() string { return e.Message }

func imageParameterError(param, message string) error {
	return &openAIParameterError{Param: param, Message: message, Code: "invalid_parameter"}
}

var openAIImageFields = map[string]bool{
	"model": true, "prompt": true, "n": true, "size": true, "quality": true,
	"response_format": true, "output_format": true, "background": true,
	"moderation": true, "user": true, "stream": true,
}

func unsupportedImageField(field string) error {
	return &openAIParameterError{Param: field, Message: fmt.Sprintf("Unsupported parameter: %s", field), Code: "unsupported_parameter"}
}

func decodeOpenAIImageJSON(request *http.Request) (openAIImageRequest, error) {
	var result openAIImageRequest
	contentType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		return result, imageParameterError("Content-Type", "Use application/json for image generation.")
	}
	decoder := json.NewDecoder(request.Body)
	var fields map[string]json.RawMessage
	if err := decoder.Decode(&fields); err != nil {
		return result, imageBodyError(err)
	}
	if fields == nil {
		return result, imageParameterError("body", "The request body must be a JSON object.")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		if err != nil {
			return result, imageBodyError(err)
		}
		return result, imageParameterError("body", "Send one JSON object per request.")
	}
	for field := range fields {
		if !openAIImageFields[field] {
			return result, unsupportedImageField(field)
		}
	}
	encoded, _ := json.Marshal(fields)
	if err := json.Unmarshal(encoded, &result); err != nil {
		var fieldError *json.UnmarshalTypeError
		if errors.As(err, &fieldError) {
			return result, imageParameterError(fieldError.Field, "Invalid parameter type: "+fieldError.Field)
		}
		return result, imageParameterError("body", "Invalid image request.")
	}
	if value, exists := fields["n"]; exists && string(value) != "null" && result.N == 0 {
		return result, imageParameterError("n", "n must be an integer between 1 and 10.")
	}
	return normalizeOpenAIImageRequest(result)
}

func imageBodyError(err error) error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return err
	}
	return imageParameterError("body", "Invalid or incomplete request body.")
}

func decodeOpenAIImageMultipart(request *http.Request, maxFileBytes int64) (openAIImageRequest, []*multipart.FileHeader, error) {
	var result openAIImageRequest
	contentType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || contentType != "multipart/form-data" {
		return result, nil, imageParameterError("Content-Type", "Use multipart/form-data and upload image files for image editing.")
	}
	if err := request.ParseMultipartForm(8 << 20); err != nil {
		return result, nil, imageBodyError(err)
	}
	fields := make(map[string]json.RawMessage, len(request.MultipartForm.Value))
	for field, values := range request.MultipartForm.Value {
		if !openAIImageFields[field] {
			return result, nil, unsupportedImageField(field)
		}
		if len(values) != 1 {
			return result, nil, imageParameterError(field, "Repeated parameter: "+field)
		}
		value := values[0]
		switch field {
		case "n":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 {
				return result, nil, imageParameterError(field, "n must be an integer between 1 and 10.")
			}
			fields[field], _ = json.Marshal(n)
		case "stream":
			if value != "true" && value != "false" {
				return result, nil, imageParameterError(field, "stream must be true or false.")
			}
			fields[field] = json.RawMessage(value)
		default:
			fields[field], _ = json.Marshal(value)
		}
	}
	encoded, _ := json.Marshal(fields)
	if err := json.Unmarshal(encoded, &result); err != nil {
		return result, nil, imageBodyError(err)
	}
	result, err = normalizeOpenAIImageRequest(result)
	if err != nil {
		return result, nil, err
	}
	for field := range request.MultipartForm.File {
		if field != "image" && field != "image[]" {
			return result, nil, unsupportedImageField(field)
		}
	}
	files := append([]*multipart.FileHeader(nil), request.MultipartForm.File["image"]...)
	files = append(files, request.MultipartForm.File["image[]"]...)
	if len(files) < 1 || len(files) > maxTaskInputImages {
		return result, nil, imageParameterError("image", fmt.Sprintf("Upload between 1 and %d images.", maxTaskInputImages))
	}
	var total int64
	for _, file := range files {
		if file.Size <= 0 || file.Size > maxFileBytes {
			return result, nil, imageParameterError("image", "An input image is empty or exceeds the upload size limit.")
		}
		total += file.Size
		if total > openAIImageInputBytes {
			return result, nil, imageParameterError("image", "Input images must not exceed 32 MiB in total.")
		}
	}
	return result, files, nil
}

func normalizeOpenAIImageRequest(request openAIImageRequest) (openAIImageRequest, error) {
	request.Model = strings.TrimSpace(request.Model)
	request.Prompt = strings.TrimSpace(request.Prompt)
	if request.Model == "" {
		return request, &openAIParameterError{Param: "model", Message: "model is required. Choose an ID returned by GET /v1/models.", Code: "missing_required_parameter"}
	}
	if len(request.Model) > 128 {
		return request, imageParameterError("model", "model is too long.")
	}
	if request.Prompt == "" || len([]rune(request.Prompt)) > maxTaskPromptRunes {
		return request, imageParameterError("prompt", fmt.Sprintf("prompt must contain between 1 and %d characters.", maxTaskPromptRunes))
	}
	if request.N == 0 {
		request.N = 1
	}
	if request.N < 1 || request.N > 10 {
		return request, imageParameterError("n", "n must be an integer between 1 and 10.")
	}
	if request.Stream {
		return request, unsupportedImageField("stream")
	}
	if len([]rune(request.User)) > 256 {
		return request, imageParameterError("user", "user must not exceed 256 characters.")
	}
	defaults := map[*string]string{&request.Size: "auto", &request.Quality: "auto", &request.ResponseFormat: "b64_json", &request.Background: "auto"}
	for field, fallback := range defaults {
		*field = strings.ToLower(strings.TrimSpace(*field))
		if *field == "" {
			*field = fallback
		}
	}
	request.OutputFormat = strings.ToLower(strings.TrimSpace(request.OutputFormat))
	request.Moderation = strings.ToLower(strings.TrimSpace(request.Moderation))
	if request.ResponseFormat != "b64_json" && request.ResponseFormat != "url" {
		return request, imageParameterError("response_format", "response_format must be b64_json or url.")
	}
	if !imageStringIn([]string{"auto", "opaque", "transparent"}, request.Background) {
		return request, imageParameterError("background", "background must be auto, opaque or transparent.")
	}
	if !imageStringIn([]string{"auto", "low", "medium", "high", "standard", "hd"}, request.Quality) {
		return request, imageParameterError("quality", "Unsupported image quality.")
	}
	if request.OutputFormat != "" && !imageStringIn(modelconfig.ImageOutputFormats, request.OutputFormat) {
		return request, imageParameterError("output_format", "output_format must be png, jpeg or webp.")
	}
	if request.Moderation != "" && !imageStringIn(modelconfig.ImageModerationLevels, request.Moderation) {
		return request, imageParameterError("moderation", "moderation must be auto or low.")
	}
	return request, nil
}

func imageStringIn(values []string, wanted string) bool {
	for _, value := range values {
		if strings.EqualFold(value, wanted) {
			return true
		}
	}
	return false
}

func openAIImageParams(request openAIImageRequest, model modelconfig.Model, references int) (map[string]any, error) {
	if request.N > model.GenerationMaxImages() {
		return nil, imageParameterError("n", fmt.Sprintf("This model allows at most %d images per request.", model.GenerationMaxImages()))
	}
	if references > model.MaxReferenceImages {
		return nil, imageParameterError("image", fmt.Sprintf("This model allows at most %d input images.", model.MaxReferenceImages))
	}
	params := map[string]any{"modelId": model.ID, "_source": "open_api"}
	if request.Size != "auto" {
		parts := strings.Split(request.Size, "x")
		if len(parts) != 2 {
			return nil, imageParameterError("size", "size must be auto or WIDTHxHEIGHT in pixels.")
		}
		width, werr := strconv.Atoi(parts[0])
		height, herr := strconv.Atoi(parts[1])
		if werr != nil || herr != nil || width <= 0 || height <= 0 || fmt.Sprintf("%dx%d", width, height) != request.Size {
			return nil, imageParameterError("size", "size must be auto or WIDTHxHEIGHT in pixels.")
		}
		if err := modelconfig.ValidateExactImageSize(model, width, height); err != nil {
			return nil, imageParameterError("size", err.Error()+"; use size=auto for the model's native size.")
		}
		params["sizeMode"], params["exactWidth"], params["exactHeight"] = "exact", width, height
	}
	quality := request.Quality
	if quality == "standard" {
		quality = "medium"
	}
	if quality == "hd" {
		quality = "high"
	}
	if quality != "auto" {
		if !imageStringIn(model.Qualities, quality) {
			return nil, imageParameterError("quality", "The selected model does not support this quality.")
		}
		params["quality"] = quality
	}
	if request.OutputFormat != "" {
		if !imageStringIn(model.OutputFormats, request.OutputFormat) {
			return nil, imageParameterError("output_format", "The selected model does not support this output format.")
		}
		params["outputFormat"] = request.OutputFormat
	}
	if request.Background == "transparent" {
		if !model.TransparentBackground {
			return nil, imageParameterError("background", "The selected model does not support transparent backgrounds.")
		}
		if request.OutputFormat == "jpeg" {
			return nil, imageParameterError("output_format", "JPEG does not support transparent backgrounds.")
		}
		params["transparentPngEnabled"] = true
	}
	if request.Background == "opaque" {
		params["transparentPngEnabled"] = false
	}
	if request.Moderation != "" {
		if !imageStringIn(model.ModerationLevels, request.Moderation) {
			return nil, imageParameterError("moderation", "The selected model does not support this moderation setting.")
		}
		params["moderationLevel"] = request.Moderation
	}
	return params, nil
}
