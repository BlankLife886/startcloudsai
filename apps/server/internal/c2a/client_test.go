package c2a

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEndpointURLAvoidsDuplicateVersionPath(t *testing.T) {
	tests := []struct {
		base string
		want string
	}{
		{"https://example.com", "https://example.com/v1/images/generations"},
		{"https://example.com/", "https://example.com/v1/images/generations"},
		{"https://example.com/v1", "https://example.com/v1/images/generations"},
		{"https://example.com/api", "https://example.com/api/v1/images/generations"},
	}
	for _, tc := range tests {
		client := New(tc.base, "key", 30)
		got, err := client.endpointURL("/v1/images/generations")
		if err != nil {
			t.Fatalf("endpointURL(%q): %v", tc.base, err)
		}
		if got != tc.want {
			t.Fatalf("endpointURL(%q) = %q, want %q", tc.base, got, tc.want)
		}
	}
}

func TestEndpointURLUsesOriginForAsyncAPIAndPreservesQuery(t *testing.T) {
	client := New("https://example.com/v1", "key", 30)
	got, err := client.endpointURL("/api/image-tasks?ids=task-123")
	if err != nil {
		t.Fatalf("endpointURL: %v", err)
	}
	if got != "https://example.com/api/image-tasks?ids=task-123" {
		t.Fatalf("endpointURL = %q", got)
	}
}

func TestExtractB64ListRejectsTooManyImages(t *testing.T) {
	body := []byte(`{"data":[{"b64_json":"a"},{"b64_json":"b"},{"b64_json":"c"},{"b64_json":"d"},{"b64_json":"e"}]}`)
	if _, err := extractB64List(body); err == nil {
		t.Fatal("expected too-many-images error")
	}
}

func TestGenerateImagesUsesNonStreamingContract(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/image-tasks/generations" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if r.URL.Path != "/v1/images/generations" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"image-data"}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	images, err := client.GenerateImages(context.Background(), "draw a cat", "gpt-image-2", 1, "1024x1024")
	if err != nil {
		t.Fatalf("GenerateImages: %v", err)
	}
	if len(images) != 1 || images[0] != "image-data" {
		t.Fatalf("images = %#v", images)
	}
	if stream, ok := payload["stream"].(bool); !ok || stream {
		t.Fatalf("stream = %#v, want false", payload["stream"])
	}
	if disabled, ok := payload["history_disabled"].(bool); !ok || !disabled {
		t.Fatalf("history_disabled = %#v, want true", payload["history_disabled"])
	}
	if payload["quality"] != "auto" {
		t.Fatalf("quality = %#v, want auto", payload["quality"])
	}
}

func TestGenerateImagesRecoversCompletedImageBeforeTaskTerminalState(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/image-tasks/generations":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if payload["client_task_id"] != "task-123" {
				t.Fatalf("client_task_id = %#v", payload["client_task_id"])
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-123","status":"running","data":[{"url":"` + server.URL + `/generated.png"}]}`))
		case "/generated.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL+"/v1", "test-key", 30, true)
	images, err := client.GenerateImagesWithID(context.Background(), "task-123", "draw a cat", "gpt-image-2", 1, "1024x1024")
	if err != nil {
		t.Fatalf("GenerateImagesWithID: %v", err)
	}
	if len(images) != 1 {
		t.Fatalf("images = %#v", images)
	}
	decoded, err := base64.StdEncoding.DecodeString(images[0])
	if err != nil {
		t.Fatalf("decode image: %v", err)
	}
	if string(decoded) != string(png) {
		t.Fatal("downloaded image does not match upstream image")
	}
}

func TestGenerateImagesReturnsUpstreamTaskErrorCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-error","status":"error","error":"generation timed out","error_code":"image_stream_timeout"}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	_, err := client.GenerateImagesWithID(context.Background(), "task-error", "draw a cat", "gpt-image-2", 1, "")
	var upstream *UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("error = %v, want UpstreamError", err)
	}
	if upstream.Message != "image_stream_timeout: generation timed out" {
		t.Fatalf("message = %q", upstream.Message)
	}
}

func TestDownloadImageDoesNotForwardAPIKeyCrossOrigin(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	mediaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("cross-origin Authorization = %q, want empty", got)
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(png)
	}))
	defer mediaServer.Close()

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-cross-origin","status":"success","data":[{"url":"` + mediaServer.URL + `/generated.png"}]}`))
	}))
	defer apiServer.Close()

	client := NewWithPolicy(apiServer.URL, "secret-key", 30, true)
	images, err := client.GenerateImagesWithID(context.Background(), "task-cross-origin", "draw a cat", "gpt-image-2", 1, "")
	if err != nil {
		t.Fatalf("GenerateImagesWithID: %v", err)
	}
	if len(images) != 1 {
		t.Fatalf("images = %#v", images)
	}
}

func TestGenerateImagesRecoversPartialDataClearedByTerminalError(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/image-tasks/generations":
			_, _ = w.Write([]byte(`{"id":"task-partial","status":"running","data":[{"url":"` + server.URL + `/partial.png"}]}`))
		case "/api/image-tasks":
			_, _ = w.Write([]byte(`{"items":[{"id":"task-partial","status":"error","error":"second image timed out","error_code":"image_stream_timeout","data":[]}]}`))
		case "/partial.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 5, true)
	images, err := client.GenerateImagesWithID(context.Background(), "task-partial", "draw two cats", "gpt-image-2", 2, "")
	if err != nil {
		t.Fatalf("GenerateImagesWithID: %v", err)
	}
	if len(images) != 1 {
		t.Fatalf("images = %#v, want recovered partial image", images)
	}
}

func TestGenerateImagesKeepsPollingAfterTransientGatewayFailure(t *testing.T) {
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/image-tasks/generations":
			_, _ = w.Write([]byte(`{"id":"task-transient","status":"running","data":[]}`))
		case "/api/image-tasks":
			polls++
			if polls == 1 {
				http.Error(w, `{"detail":"temporary gateway timeout"}`, http.StatusGatewayTimeout)
				return
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"task-transient","status":"success","data":[{"b64_json":"recovered-image"}]}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 10, true)
	images, err := client.GenerateImagesWithID(context.Background(), "task-transient", "draw a cat", "gpt-image-2", 1, "")
	if err != nil {
		t.Fatalf("GenerateImagesWithID: %v", err)
	}
	if polls < 2 || len(images) != 1 || images[0] != "recovered-image" {
		t.Fatalf("polls = %d, images = %#v", polls, images)
	}
}
