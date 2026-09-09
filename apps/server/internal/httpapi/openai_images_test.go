package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
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

func TestOpenAIImageMultipartContract(t *testing.T) {
	base := [][2]string{{"model", "test-image"}, {"prompt", "change the background"}}
	for _, tt := range []struct {
		name   string
		fields [][2]string
		files  []string
		max    int64
		param  string
	}{
		{"SDK single image", base, []string{"image"}, 1024, ""},
		{"SDK image array", base, []string{"image[]", "image[]"}, 1024, ""},
		{"mask must not be ignored", base, []string{"image", "mask"}, 1024, "mask"},
		{"URL is not upload", append(base, [2]string{"image", "https://example.com/image.png"}), nil, 1024, "image"},
		{"no image", base, nil, 1024, "image"},
		{"model duplicated", append(base, [2]string{"model", "another-model"}), []string{"image"}, 1024, "model"},
		{"per image size bound", base, []string{"image"}, 4, "image"},
		{"reference count bound", base, []string{"image[]", "image[]", "image[]", "image[]", "image[]", "image[]", "image[]"}, 1024, "image"},
		{"count fractional", append(base, [2]string{"n", "1.5"}), []string{"image"}, 1024, "n"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, files, err := decodeOpenAIImageMultipart(multipartImageRequestForTest(t, tt.fields, tt.files), tt.max)
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

func TestOpenAIImageWaitUsesTerminalState(t *testing.T) {
	taskID, userID := uuid.New(), uuid.New()
	states := []store.Task{{ID: taskID, UserID: userID, Status: "running", OutputKeys: []string{"partial"}}, {ID: taskID, UserID: userID, Status: "succeeded", Count: 2, OutputKeys: []string{"partial"}}}
	reads := 0
	result, err := waitOpenAIImageTask(context.Background(), &store.Task{ID: taskID, Status: "queued"}, time.Millisecond, func(context.Context) (*store.Task, error) { item := states[reads]; reads++; return &item, nil })
	if err != nil || reads != 2 || result.Status != "succeeded" || len(result.OutputKeys) != 1 {
		t.Fatalf("returned before terminal delivery: %+v reads=%d err=%v", result, reads, err)
	}
	for _, status := range []string{"failed", "canceled"} {
		_, err := waitOpenAIImageTask(context.Background(), &store.Task{Status: status, OutputKeys: []string{"partial"}}, time.Millisecond, nil)
		if err == nil {
			t.Errorf("%s was returned as success", status)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, err = waitOpenAIImageTask(ctx, &store.Task{Status: "running"}, time.Second, func(context.Context) (*store.Task, error) { t.Fatal("read after cancellation"); return nil, nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline lost: %v", err)
	}
}

func TestOpenAIImageResultsUseOwnedOriginals(t *testing.T) {
	task := &store.Task{ID: uuid.New(), UserID: uuid.New(), Status: "succeeded", Count: 2, CreatedAt: time.Unix(1786406400, 0)}
	original := "tasks/" + task.UserID.String() + "/" + task.ID.String() + "/original/0.png"
	task.OutputKeys = []string{original}
	task.ThumbnailKeys = []string{"thumbnail-must-not-be-returned"}
	// A supported PNG header suffices for this delivery contract; full image validation belongs to uploads/worker.
	data := []byte{137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13}
	read := func(_ context.Context, key string, _ int64) ([]byte, error) {
		if key != original {
			t.Fatalf("read unexpected key %q", key)
		}
		return data, nil
	}
	result, err := openAIImageResult(context.Background(), task, "b64_json", read, nil)
	if err != nil || len(result.Data) != 1 || result.Data[0].B64JSON != base64.StdEncoding.EncodeToString(data) || result.Created != task.CreatedAt.Unix() {
		t.Fatalf("wrong original response: %+v %v", result, err)
	}
	result, err = openAIImageResult(context.Background(), task, "url", nil, func(_ context.Context, key string) (string, error) {
		if key != original {
			t.Fatal(key)
		}
		return "https://storage.example.com/object?signed=short-lived", nil
	})
	if err != nil || result.Data[0].URL == "" || result.Data[0].B64JSON != "" {
		t.Fatalf("signed delivery: %+v %v", result, err)
	}
	task.OutputKeys = []string{"tasks/" + uuid.NewString() + "/" + task.ID.String() + "/0.png"}
	_, err = openAIImageResult(context.Background(), task, "b64_json", read, nil)
	if err == nil {
		t.Fatal("another user's file was exposed")
	}
	task.OutputKeys = []string{original}
	_, err = openAIImageResult(context.Background(), task, "b64_json", func(context.Context, string, int64) ([]byte, error) { return []byte("<html>failure</html>"), nil }, nil)
	if err == nil {
		t.Fatal("non-image data was returned as an image")
	}
}

func TestOpenAIImageIdempotencyFingerprint(t *testing.T) {
	request, _ := normalizeOpenAIImageRequest(openAIImageRequest{Model: "image", Prompt: "cat"})
	hash := openAIImageFingerprint(request, true, []string{"image-sha"})
	request.ResponseFormat = "url"
	if hash != openAIImageFingerprint(request, true, []string{"image-sha"}) {
		t.Fatal("delivery format would cause a duplicate paid task")
	}
	if hash == openAIImageFingerprint(request, true, []string{"different-image-sha"}) {
		t.Fatal("image changes escaped conflict detection")
	}
	if hash == openAIImageFingerprint(request, false, []string{"image-sha"}) {
		t.Fatal("operation changes escaped conflict detection")
	}
	keyID := uuid.New()
	input := openAIImageTaskInput(request, map[string]any{"modelId": "image", "_source": "open_api"}, nil, keyID, "client-request-1", hash)
	other := openAIImageTaskInput(request, input.Params, nil, uuid.New(), "client-request-1", hash)
	if *input.IdempotencyKey == *other.IdempotencyKey || len(*input.IdempotencyKey) > 128 {
		t.Fatal("API Key idempotency namespace is not isolated")
	}
	task := &store.Task{Params: input.TrustedParams}
	if err := checkOpenAIImageReplay(task, keyID, hash); err != nil {
		t.Fatal(err)
	}
	if err := checkOpenAIImageReplay(task, keyID, "changed"); err == nil {
		t.Fatal("mismatched replay accepted")
	} else if app, ok := apperr.As(err); !ok || app.Status != 409 {
		t.Fatal(err)
	}
}
