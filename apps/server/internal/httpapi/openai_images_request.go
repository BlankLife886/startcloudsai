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

// /v1/images/edits reference images are spooled to temporary files and
// streamed to the upstream, so their size is bounded only by this request body
// ceiling (a guard against filling the disk) and their count by the model.
const (
	openAIImageEditMaxBodyBytes = 512 << 20
	openAIImageEditMemoryBytes  = 1 << 20
)

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
	return &openAIParameterError{Param: field, Message: fmt.Sprintf("不支持的参数：%s", field), Code: "unsupported_parameter"}
}

func decodeOpenAIImageJSON(request *http.Request) (openAIImageRequest, error) {
	var result openAIImageRequest
	contentType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		return result, imageParameterError("Content-Type", "生成图片请使用 Content-Type: application/json")
	}
	decoder := json.NewDecoder(request.Body)
	var fields map[string]json.RawMessage
	if err := decoder.Decode(&fields); err != nil {
		return result, imageBodyError(err)
	}
	if fields == nil {
		return result, imageParameterError("body", "请求体必须是 JSON 对象")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		if err != nil {
			return result, imageBodyError(err)
		}
		return result, imageParameterError("body", "每个请求只能发送一个 JSON 对象")
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
			return result, imageParameterError(fieldError.Field, fieldError.Field+" 的类型不正确，请对照文档检查")
		}
		return result, imageParameterError("body", "请求参数无效，请对照文档检查字段类型")
	}
	if value, exists := fields["n"]; exists && string(value) != "null" && result.N == 0 {
		return result, imageParameterError("n", "n 必须是 1 到 10 的整数")
	}
	return normalizeOpenAIImageRequest(result)
}

func imageBodyError(err error) error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return err
	}
	return imageParameterError("body", "请求体无效或不完整")
}

func decodeOpenAIImageMultipart(request *http.Request) (openAIImageRequest, []*multipart.FileHeader, error) {
	var result openAIImageRequest
	contentType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || contentType != "multipart/form-data" {
		return result, nil, imageParameterError("Content-Type", "编辑图片请使用 multipart/form-data 上传图片文件")
	}
	if err := request.ParseMultipartForm(openAIImageEditMemoryBytes); err != nil {
		return result, nil, imageBodyError(err)
	}
	fields := make(map[string]json.RawMessage, len(request.MultipartForm.Value))
	for field, values := range request.MultipartForm.Value {
		if !openAIImageFields[field] {
			return result, nil, unsupportedImageField(field)
		}
		if len(values) != 1 {
			return result, nil, imageParameterError(field, "参数重复："+field)
		}
		value := values[0]
		switch field {
		case "n":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 {
				return result, nil, imageParameterError(field, "n 必须是 1 到 10 的整数")
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
	if len(files) == 0 {
		return result, nil, imageParameterError("image", "至少上传一张参考图（字段名 image 或 image[]）")
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
		return request, imageParameterError("model", "model 太长")
	}
	if request.Prompt == "" || len([]rune(request.Prompt)) > maxTaskPromptRunes {
		return request, imageParameterError("prompt", fmt.Sprintf("prompt must contain between 1 and %d characters.", maxTaskPromptRunes))
	}
	if request.N == 0 {
		request.N = 1
	}
	if request.N < 1 || request.N > 10 {
		return request, imageParameterError("n", "n 必须是 1 到 10 的整数")
	}
	if request.Stream {
		return request, unsupportedImageField("stream")
	}
	if len([]rune(request.User)) > 256 {
		return request, imageParameterError("user", "user 不能超过 256 个字符")
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
		return request, imageParameterError("response_format", "response_format 只支持 b64_json 或 url")
	}
	if !imageStringIn([]string{"auto", "opaque", "transparent"}, request.Background) {
		return request, imageParameterError("background", "background 只支持 auto、opaque、transparent")
	}
	if !imageStringIn([]string{"auto", "low", "medium", "high", "xhigh", "max", "standard", "hd"}, request.Quality) {
		return request, imageParameterError("quality", "quality 只支持 auto、low、medium、high、xhigh、max（standard、hd 分别视为 medium、high）")
	}
	if request.OutputFormat != "" && !imageStringIn(modelconfig.ImageOutputFormats, request.OutputFormat) {
		return request, imageParameterError("output_format", "output_format 只支持 png、jpeg、webp")
	}
	if request.Moderation != "" && !imageStringIn(modelconfig.ImageModerationLevels, request.Moderation) {
		return request, imageParameterError("moderation", "moderation 只支持 auto 或 low")
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
		return nil, imageParameterError("n", fmt.Sprintf("所选模型单次最多生成 %d 张，n 请不超过这个数", model.GenerationMaxImages()))
	}
	if references > model.MaxReferenceImages {
		return nil, imageParameterError("image", fmt.Sprintf("所选模型最多接受 %d 张参考图，本次上传了 %d 张", model.MaxReferenceImages, references))
	}
	params := map[string]any{"modelId": model.ID, "_source": "open_api"}
	if request.Size != "auto" {
		parts := strings.Split(request.Size, "x")
		if len(parts) != 2 {
			return nil, imageParameterError("size", "size 须为 auto 或“宽x高”像素，例如 1024x1024")
		}
		width, werr := strconv.Atoi(parts[0])
		height, herr := strconv.Atoi(parts[1])
		if werr != nil || herr != nil || width <= 0 || height <= 0 || fmt.Sprintf("%dx%d", width, height) != request.Size {
			return nil, imageParameterError("size", "size 须为 auto 或“宽x高”像素，例如 1024x1024")
		}
		if err := modelconfig.ValidateExactImageSize(model, width, height); err != nil {
			return nil, imageParameterError("size", err.Error()+"；也可以用 size=auto 使用模型原生尺寸")
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
			return nil, imageParameterError("quality", fmt.Sprintf("所选模型不支持 quality=%s，可用：%s", quality, strings.Join(model.Qualities, "、")))
		}
		params["quality"] = quality
	}
	// An empty OutputFormats list means the admin turned the format selector
	// off and the model returns its native format. OpenAI SDKs and tools often
	// send output_format by default, so drop it there like the canvas does
	// instead of rejecting the request.
	outputFormat := request.OutputFormat
	if len(model.OutputFormats) == 0 {
		outputFormat = ""
	}
	if outputFormat != "" {
		if !imageStringIn(model.OutputFormats, outputFormat) {
			return nil, imageParameterError("output_format", fmt.Sprintf("所选模型不支持 output_format=%s，可用：%s", outputFormat, strings.Join(model.OutputFormats, "、")))
		}
		params["outputFormat"] = outputFormat
	}
	if request.Background == "transparent" {
		if !model.TransparentBackground {
			return nil, imageParameterError("background", "所选模型不支持透明背景")
		}
		if outputFormat == "jpeg" {
			return nil, imageParameterError("output_format", "JPEG 不支持透明背景，请改用 png 或 webp")
		}
		params["transparentPngEnabled"] = true
	}
	if request.Background == "opaque" {
		params["transparentPngEnabled"] = false
	}
	if request.Moderation != "" {
		if !imageStringIn(model.ModerationLevels, request.Moderation) {
			return nil, imageParameterError("moderation", fmt.Sprintf("所选模型不支持 moderation=%s，可用：%s", request.Moderation, strings.Join(model.ModerationLevels, "、")))
		}
		params["moderationLevel"] = request.Moderation
	}
	return params, nil
}
