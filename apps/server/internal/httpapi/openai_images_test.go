package httpapi

import (
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func imageRequestForTest(body string) *http.Request {
	request := httptest.NewRequest("POST", "/v1/images/generations", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	return request
}

func TestOpenAIImageJSONContract(t *testing.T) {
	for _, tt := range []struct{ name, body, param string }{
		{"minimal", `{"model":"test-image","prompt":"draw a cat"}`, ""},
		{"all common fields", `{"model":"test-image","prompt":"draw a cat","n":2,"size":"1024x1024","quality":"high","response_format":"url","output_format":"webp","background":"transparent","moderation":"auto","user":"external-user","stream":false}`, ""},
		{"missing model", `{"prompt":"cat"}`, "model"},
		{"empty prompt", `{"model":"test-image","prompt":"   "}`, "prompt"},
		{"zero count", `{"model":"test-image","prompt":"cat","n":0}`, "n"},
		{"negative count", `{"model":"test-image","prompt":"cat","n":-1}`, "n"},
		{"fraction count", `{"model":"test-image","prompt":"cat","n":1.5}`, "n"},
		{"count limit", `{"model":"test-image","prompt":"cat","n":11}`, "n"},
		{"non string model", `{"model":{},"prompt":"cat"}`, "model"},
		{"stream explicitly refused", `{"model":"test-image","prompt":"cat","stream":true}`, "stream"},
		{"partial images refused", `{"model":"test-image","prompt":"cat","partial_images":1}`, "partial_images"},
		{"internal routing refused", `{"model":"test-image","prompt":"cat","params":{"_apiKeyId":"other"}}`, "params"},
		{"unknown format", `{"model":"test-image","prompt":"cat","response_format":"json"}`, "response_format"},
		{"not an object", `[]`, "body"},
		{"null body", `null`, "body"},
		{"trailing body", `{"model":"test-image","prompt":"cat"}{}`, "body"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			result, err := decodeOpenAIImageJSON(imageRequestForTest(tt.body))
			if tt.param == "" {
				if err != nil {
					t.Fatal(err)
				}
				if result.N < 1 || result.Size == "" || result.ResponseFormat == "" {
					t.Fatalf("defaults missing: %#v", result)
				}
				return
			}
			var field *openAIParameterError
			if !errors.As(err, &field) || field.Param != tt.param {
				t.Fatalf("want error for %s, got %v", tt.param, err)
			}
		})
	}
	request := imageRequestForTest(strings.Repeat(" ", 100) + `{}`)
	request.Body = http.MaxBytesReader(httptest.NewRecorder(), request.Body, 20)
	_, err := decodeOpenAIImageJSON(request)
	var limit *http.MaxBytesError
	if !errors.As(err, &limit) {
		t.Fatalf("body size error was hidden: %v", err)
	}
}

func multipartImageRequestForTest(t *testing.T, fields [][2]string, files []string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range files {
		part, err := writer.CreateFormFile(name, "image.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(part, "image bytes checked by shared upload validation"); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/v1/images/edits", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	t.Cleanup(func() {
		if request.MultipartForm != nil {
			_ = request.MultipartForm.RemoveAll()
		}
	})
	return request
}

func repeatedImageFields(count int) []string {
	fields := make([]string, count)
	for i := range fields {
		fields[i] = "image[]"
	}
	return fields
}

func TestOpenAIImageMultipartContract(t *testing.T) {
	base := [][2]string{{"model", "test-image"}, {"prompt", "change the background"}}
	for _, tt := range []struct {
		name   string
		fields [][2]string
		files  []string
		param  string
	}{
		{"SDK single image", base, []string{"image"}, ""},
		{"SDK image array", base, []string{"image[]", "image[]"}, ""},
		// The count is the model's reference-image limit, checked with the model.
		{"no fixed image count", base, repeatedImageFields(maxTaskInputImages + 1), ""},
		{"mask must not be ignored", base, []string{"image", "mask"}, "mask"},
		{"URL is not upload", append(base, [2]string{"image", "https://example.com/image.png"}), nil, "image"},
		{"no image", base, nil, "image"},
		{"model duplicated", append(base, [2]string{"model", "another-model"}), []string{"image"}, "model"},
		{"count fractional", append(base, [2]string{"n", "1.5"}), []string{"image"}, "n"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, files, err := decodeOpenAIImageMultipart(multipartImageRequestForTest(t, tt.fields, tt.files))
			if tt.param == "" {
				if err != nil || len(files) != len(tt.files) {
					t.Fatalf("files=%d err=%v", len(files), err)
				}
				return
			}
			var field *openAIParameterError
			if !errors.As(err, &field) || field.Param != tt.param {
				t.Fatalf("want %s rejection, got %v", tt.param, err)
			}
		})
	}
}

func TestOpenAIImageCapabilityMapping(t *testing.T) {
	model := modelconfig.Model{ID: "image", Kind: modelconfig.ModelKindImage, MaxImages: 4, MaxReferenceImages: 2,
		SupportsExactSize: true, Qualities: []string{"medium", "high"}, OutputFormats: []string{"png", "webp", "jpeg"}, TransparentBackground: true, ModerationLevels: []string{"auto"}}
	base, err := normalizeOpenAIImageRequest(openAIImageRequest{Model: "image", Prompt: "cat"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name, param string
		change      func(*openAIImageRequest, *modelconfig.Model)
		refs        int
	}{
		{"auto keeps model native size", "", func(*openAIImageRequest, *modelconfig.Model) {}, 0},
		{"exact pixels", "", func(r *openAIImageRequest, _ *modelconfig.Model) { r.Size = "1001x777"; r.Quality = "hd" }, 0},
		{"unsupported exact size", "size", func(r *openAIImageRequest, m *modelconfig.Model) { r.Size = "1024x1024"; m.SupportsExactSize = false }, 0},
		{"no silent resizing", "size", func(r *openAIImageRequest, _ *modelconfig.Model) { r.Size = "99999x99999" }, 0},
		{"model count bound", "n", func(r *openAIImageRequest, _ *modelconfig.Model) { r.N = 5 }, 0},
		{"model reference bound", "image", func(*openAIImageRequest, *modelconfig.Model) {}, 3},
		{"unsupported quality", "quality", func(r *openAIImageRequest, _ *modelconfig.Model) { r.Quality = "low" }, 0},
		{"transparent jpeg", "output_format", func(r *openAIImageRequest, _ *modelconfig.Model) {
			r.Background = "transparent"
			r.OutputFormat = "jpeg"
		}, 1},
		{"unsupported transparency", "background", func(r *openAIImageRequest, m *modelconfig.Model) {
			r.Background = "transparent"
			m.TransparentBackground = false
		}, 1},
		{"format outside declared list", "output_format", func(r *openAIImageRequest, m *modelconfig.Model) {
			r.OutputFormat = "webp"
			m.OutputFormats = []string{"png", "jpeg"}
		}, 0},
		{"format selector off uses native format", "", func(r *openAIImageRequest, m *modelconfig.Model) {
			r.OutputFormat = "png"
			m.OutputFormats = []string{}
		}, 0},
		{"format selector off ignores jpeg for transparency", "", func(r *openAIImageRequest, m *modelconfig.Model) {
			r.Background = "transparent"
			r.OutputFormat = "jpeg"
			m.OutputFormats = []string{}
		}, 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			request, candidate := base, model
			tt.change(&request, &candidate)
			params, err := openAIImageParams(request, candidate, tt.refs)
			if tt.param != "" {
				var field *openAIParameterError
				if !errors.As(err, &field) || field.Param != tt.param {
					t.Fatalf("want %s, got %v", tt.param, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(candidate.OutputFormats) == 0 {
				if _, ok := params["outputFormat"]; ok {
					t.Fatalf("format forwarded for a model without a format selector: %#v", params)
				}
			}
			if request.Size == "auto" {
				if _, ok := params["exactWidth"]; ok {
					t.Fatal("native size was changed")
				}
			}
			if request.Size == "1001x777" && (params["exactWidth"] != 1001 || params["exactHeight"] != 777 || params["quality"] != "high") {
				t.Fatalf("exact mapping changed: %#v", params)
			}
		})
	}
}
