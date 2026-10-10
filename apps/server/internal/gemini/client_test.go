package gemini

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

var pngB64 = base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake-image"))

type recorded struct {
	mu     sync.Mutex
	paths  []string
	keys   []string
	bodies []map[string]any
}

func server(t *testing.T, respond func(w http.ResponseWriter, r *http.Request)) (*httptest.Server, *recorded) {
	t.Helper()
	rec := &recorded{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		rec.mu.Lock()
		rec.paths = append(rec.paths, r.URL.Path)
		rec.keys = append(rec.keys, r.Header.Get("x-goog-api-key"))
		rec.bodies = append(rec.bodies, body)
		rec.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		respond(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, rec
}

func TestGenerateContentSendsReferencesAndImageConfig(t *testing.T) {
	srv, rec := server(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"text":"here"},{"inlineData":{"mimeType":"image/png","data":"`+pngB64+`"}}]},"finishReason":"STOP"}]}`)
	})
	client := New(srv.URL, "", map[string]string{"x-goog-api-key": "k"}, 30, nil)
	images, err := client.GenerateImages(context.Background(), "a cat", "gemini-3-pro-image-preview", 2, "2048x1152", []string{pngB64})
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 2 || images[0] != pngB64 {
		t.Fatalf("images = %d", len(images))
	}
	if rec.paths[0] != "/v1beta/models/gemini-3-pro-image-preview:generateContent" || rec.keys[0] != "k" {
		t.Fatalf("request = %s key=%q", rec.paths[0], rec.keys[0])
	}
	body := rec.bodies[0]
	config := body["generationConfig"].(map[string]any)["imageConfig"].(map[string]any)
	if config["aspectRatio"] != "16:9" || config["imageSize"] != "2K" {
		t.Fatalf("imageConfig = %v", config)
	}
	parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
	inline := parts[1].(map[string]any)["inlineData"].(map[string]any)
	if len(parts) != 2 || inline["mimeType"] != "image/png" {
		t.Fatalf("parts = %v", parts)
	}
}

func TestGenerateContentWithoutImageReportsReason(t *testing.T) {
	srv, _ := server(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"text":"I can't draw that"}]},"finishReason":"IMAGE_SAFETY"}]}`)
	})
	_, err := New(srv.URL, "/v1beta", nil, 30, nil).GenerateImages(context.Background(), "x", "gemini-2.5-flash-image", 1, "", nil)
	var upstream *c2a.UpstreamError
	if !errors.As(err, &upstream) || !strings.Contains(upstream.Message, "IMAGE_SAFETY") || !strings.Contains(upstream.Message, "can't draw") {
		t.Fatalf("err = %v", err)
	}
}

func relayServer(t *testing.T, text string) *httptest.Server {
	t.Helper()
	srv, _ := server(t, func(w http.ResponseWriter, _ *http.Request) {
		raw, _ := json.Marshal(map[string]any{"candidates": []any{map[string]any{
			"content": map[string]any{"parts": []any{map[string]any{"text": text}}}, "finishReason": "STOP",
		}}})
		_, _ = w.Write(raw)
	})
	return srv
}

func TestImageResponseTextURLDownloadsLink(t *testing.T) {
	srv := relayServer(t, "![image](https://cdn.example/a.jpg)")
	var fetched []string
	client := New(srv.URL, "", nil, 30, nil).WithImageResponse(modelconfig.ImageResponseTextURL, func(_ context.Context, rawURL string) (string, error) {
		fetched = append(fetched, rawURL)
		return pngB64, nil
	})
	images, err := client.GenerateImages(context.Background(), "x", "gemini-3-pro-image-preview", 1, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0] != pngB64 || len(fetched) != 1 || fetched[0] != "https://cdn.example/a.jpg" {
		t.Fatalf("images=%d fetched=%v", len(images), fetched)
	}
}

func TestImageResponseTextDataURIDecodesInline(t *testing.T) {
	srv := relayServer(t, "done ![x](data:image/png;base64,"+pngB64+")")
	images, err := New(srv.URL, "", nil, 30, nil).WithImageResponse(modelconfig.ImageResponseTextDataURI, nil).
		GenerateImages(context.Background(), "x", "gemini-3-pro-image-preview", 1, "", nil)
	if err != nil || len(images) != 1 || images[0] != pngB64 {
		t.Fatalf("images=%v err=%v", len(images), err)
	}
}

func TestImageResponseIsNotAutoDetected(t *testing.T) {
	// The default (inlineData) must not follow a link in text.
	srv := relayServer(t, "![image](https://cdn.example/a.jpg)")
	called := false
	_, err := New(srv.URL, "", nil, 30, nil).WithImageResponse(modelconfig.ImageResponseInlineData, func(context.Context, string) (string, error) {
		called = true
		return pngB64, nil
	}).GenerateImages(context.Background(), "x", "gemini-3-pro-image-preview", 1, "", nil)
	var upstream *c2a.UpstreamError
	if called || !errors.As(err, &upstream) || !strings.Contains(upstream.Message, "原生 inlineData") {
		t.Fatalf("called=%v err=%v", called, err)
	}
}

func TestImagenPredictBatchesAndRejectsReferences(t *testing.T) {
	srv, rec := server(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"predictions":[{"bytesBase64Encoded":"`+pngB64+`","mimeType":"image/png"}]}`)
	})
	client := New(srv.URL, "", nil, 30, nil)
	images, err := client.GenerateImages(context.Background(), "a cat", "imagen-4.0-generate-001", 1, "1024x1536", nil)
	if err != nil || len(images) != 1 {
		t.Fatalf("images=%d err=%v", len(images), err)
	}
	if rec.paths[0] != "/v1beta/models/imagen-4.0-generate-001:predict" {
		t.Fatalf("path = %s", rec.paths[0])
	}
	params := rec.bodies[0]["parameters"].(map[string]any)
	if params["aspectRatio"] != "3:4" || params["sampleCount"] != float64(1) {
		t.Fatalf("parameters = %v", params)
	}
	if _, err := client.GenerateImages(context.Background(), "x", "imagen-4.0-generate-001", 1, "", []string{pngB64}); err == nil {
		t.Fatal("Imagen must reject reference images")
	}
}

func TestErrorClassification(t *testing.T) {
	for status, retryable := range map[int]bool{400: false, 403: false, 429: true, 503: true} {
		srv, _ := server(t, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"error":{"code":400,"message":"bad thing","status":"INVALID_ARGUMENT"}}`)
		})
		_, err := New(srv.URL, "", nil, 30, nil).GenerateImages(context.Background(), "x", "gemini-2.5-flash-image", 1, "", nil)
		var network *c2a.NetworkError
		if errors.As(err, &network) != retryable || !strings.Contains(err.Error(), "bad thing") {
			t.Errorf("status %d: err = %T %v", status, err, err)
		}
	}
}

func TestSizeSpec(t *testing.T) {
	cases := map[string][2]string{
		"1024x1024": {"1:1", "1K"}, "2048x2048": {"1:1", "2K"}, "4096x2304": {"16:9", "4K"},
		"1536x1024": {"3:2", "1K"}, "": {"", ""}, "auto": {"", ""},
	}
	for size, want := range cases {
		aspect, tier := sizeSpec(size)
		if aspect != want[0] || tier != want[1] {
			t.Errorf("%q: got %s %s want %v", size, aspect, tier, want)
		}
	}
}
