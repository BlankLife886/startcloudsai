package vendorimage

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
)

var pngB64 = base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake-image"))

type recorder struct {
	mu     sync.Mutex
	paths  []string
	auth   []string
	bodies []map[string]any
}

func fake(t *testing.T, respond func(w http.ResponseWriter, body map[string]any)) (*httptest.Server, *recorder) {
	t.Helper()
	rec := &recorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		rec.mu.Lock()
		rec.paths = append(rec.paths, r.URL.Path)
		rec.auth = append(rec.auth, r.Header.Get("Authorization"))
		rec.bodies = append(rec.bodies, body)
		rec.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		respond(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, rec
}

func TestDashScopeSendsMessagesAndDownloadsEachImage(t *testing.T) {
	srv, rec := fake(t, func(w http.ResponseWriter, _ map[string]any) {
		_, _ = io.WriteString(w, `{"output":{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":[{"image":"https://oss.example/a.png"}]}}]},"request_id":"r"}`)
	})
	var fetched []string
	var mu sync.Mutex
	client := NewDashScope(srv.URL, "", map[string]string{"Authorization": "Bearer k"}, 30, nil, func(_ context.Context, rawURL string) (string, error) {
		mu.Lock()
		fetched = append(fetched, rawURL)
		mu.Unlock()
		return pngB64, nil
	})
	images, err := client.GenerateImages(context.Background(), "一只猫", "qwen-image-2.0-pro", 2, "2048x1152", []string{pngB64})
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 2 || len(fetched) != 2 || len(rec.paths) != 2 {
		t.Fatalf("images=%d fetched=%d calls=%d", len(images), len(fetched), len(rec.paths))
	}
	if rec.paths[0] != "/api/v1/services/aigc/multimodal-generation/generation" || rec.auth[0] != "Bearer k" {
		t.Fatalf("request = %s %s", rec.paths[0], rec.auth[0])
	}
	body := rec.bodies[0]
	params := body["parameters"].(map[string]any)
	if params["size"] != "2048*1152" || params["n"] != float64(1) || params["watermark"] != false {
		t.Fatalf("parameters = %v", params)
	}
	content := body["input"].(map[string]any)["messages"].([]any)[0].(map[string]any)["content"].([]any)
	if !strings.HasPrefix(content[0].(map[string]any)["image"].(string), "data:image/png;base64,") || content[1].(map[string]any)["text"] != "一只猫" {
		t.Fatalf("content = %v", content)
	}
}

func TestDashScopeErrorIsReadable(t *testing.T) {
	srv, _ := fake(t, func(w http.ResponseWriter, _ map[string]any) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"request_id":"r","code":"InvalidParameter","message":"n must be 1"}`)
	})
	_, err := NewDashScope(srv.URL, "", nil, 30, nil, nil).GenerateImages(context.Background(), "x", "qwen-image-max", 1, "", nil)
	var upstream *c2a.UpstreamError
	if !errors.As(err, &upstream) || !strings.Contains(upstream.Message, "InvalidParameter n must be 1") {
		t.Fatalf("err = %v", err)
	}
}

func TestMiniMaxMapsSizeAndSubjectReference(t *testing.T) {
	srv, rec := fake(t, func(w http.ResponseWriter, _ map[string]any) {
		_, _ = io.WriteString(w, `{"id":"i","data":{"image_base64":["`+pngB64+`","`+pngB64+`"]},"metadata":{"success_count":"2","failed_count":"0"},"base_resp":{"status_code":0,"status_msg":"success"}}`)
	})
	images, err := NewMiniMax(srv.URL, "", map[string]string{"Authorization": "Bearer k"}, 30, nil).
		GenerateImages(context.Background(), "a girl", "image-01", 2, "1536x1024", []string{pngB64})
	if err != nil || len(images) != 2 {
		t.Fatalf("images=%d err=%v", len(images), err)
	}
	body := rec.bodies[0]
	if rec.paths[0] != "/v1/image_generation" || body["aspect_ratio"] != "3:2" || body["n"] != float64(2) || body["response_format"] != "base64" {
		t.Fatalf("request = %s %v", rec.paths[0], body)
	}
	ref := body["subject_reference"].([]any)[0].(map[string]any)
	if ref["type"] != "character" || !strings.HasPrefix(ref["image_file"].(string), "data:image/png;base64,") {
		t.Fatalf("subject_reference = %v", ref)
	}
}

func TestMiniMaxInBodyStatusIsAnError(t *testing.T) {
	srv, _ := fake(t, func(w http.ResponseWriter, _ map[string]any) {
		_, _ = io.WriteString(w, `{"data":{},"base_resp":{"status_code":1026,"status_msg":"input new_sensitive"}}`)
	})
	_, err := NewMiniMax(srv.URL, "", nil, 30, nil).GenerateImages(context.Background(), "x", "image-01", 1, "", nil)
	var upstream *c2a.UpstreamError
	if !errors.As(err, &upstream) || !strings.Contains(upstream.Message, "1026") {
		t.Fatalf("err = %v", err)
	}
}
