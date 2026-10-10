package providerclient

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

type captured struct {
	mu       sync.Mutex
	paths    []string
	headers  []http.Header
	payloads []map[string]any
}

func (c *captured) server(t *testing.T, respond func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(raw, &payload)
		c.mu.Lock()
		c.paths = append(c.paths, r.URL.Path)
		c.headers = append(c.headers, r.Header.Clone())
		c.payloads = append(c.payloads, payload)
		c.mu.Unlock()
		respond(w, r)
	}))
	t.Cleanup(server.Close)
	return server
}

func TestChatUsesAPIPathAuthStyleAndCompat(t *testing.T) {
	seen := &captured{}
	server := seen.server(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"pong"}}]}`)
	})
	provider := modelconfig.Provider{
		Adapter: modelconfig.AdapterOpenAI, BaseURL: server.URL, APIKey: "secret", TimeoutSecs: 30,
		APIPath: "/v1beta/openai", AuthStyle: modelconfig.AuthGoogAPIKey,
		Compat: &modelconfig.RequestCompat{DropParams: []string{"temperature"}},
	}
	client, err := Chat(provider, provider.Compat, "gemini-2.5-flash", "")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.PostChatCompletions(context.Background(), []byte(`{"model":"gemini-2.5-flash","temperature":0.2,"messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if seen.paths[0] != "/v1beta/openai/chat/completions" {
		t.Fatalf("path = %s", seen.paths[0])
	}
	if seen.headers[0].Get("x-goog-api-key") != "secret" || seen.headers[0].Get("Authorization") != "" {
		t.Fatalf("auth headers = %v", seen.headers[0])
	}
	if _, exists := seen.payloads[0]["temperature"]; exists {
		t.Fatalf("compat drop not applied: %v", seen.payloads[0])
	}
}

func TestChatKeepsLegacyV1Handling(t *testing.T) {
	seen := &captured{}
	server := seen.server(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"choices":[]}`)
	})
	provider := modelconfig.Provider{Adapter: modelconfig.AdapterOpenAI, BaseURL: server.URL + "/v1", APIKey: "k"}
	client, err := Chat(provider, nil, "gpt-5.4", "")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.PostChatCompletions(context.Background(), []byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if seen.paths[0] != "/v1/chat/completions" || seen.headers[0].Get("Authorization") != "Bearer k" {
		t.Fatalf("legacy request changed: %s %v", seen.paths[0], seen.headers[0])
	}
}

func TestStandardImageProviderUsesPrefixAndAspectRatio(t *testing.T) {
	seen := &captured{}
	png := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))
	server := seen.server(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"b64_json":"`+png+`"}]}`)
	})
	provider := modelconfig.Provider{
		Adapter: modelconfig.AdapterOpenAI, BaseURL: server.URL, APIKey: "k", TimeoutSecs: 30,
		APIPath: "/api/v3", ImageAPI: modelconfig.ImageAPIStandard,
		Compat: &modelconfig.RequestCompat{
			DropParams: []string{"quality"}, ImageSizeParam: modelconfig.ImageSizeParamAspectRatio,
		},
	}
	client := TaskImage(provider, provider.Compat, true)
	if _, err := client.GenerateImagesStandard(context.Background(), "a cat", "img-model", 1, "1536x1024", c2a.ImageOptions{Quality: "high"}); err != nil {
		t.Fatal(err)
	}
	if len(seen.paths) != 1 || seen.paths[0] != "/api/v3/images/generations" {
		t.Fatalf("paths = %v (standard providers must not probe the task protocol)", seen.paths)
	}
	payload := seen.payloads[0]
	if _, exists := payload["quality"]; exists {
		t.Fatalf("quality should be dropped: %v", payload)
	}
	if _, exists := payload["size"]; exists || payload["aspect_ratio"] != "3:2" {
		t.Fatalf("size should become aspect_ratio: %v", payload)
	}
}

func TestMergeCompatModelOverridesProvider(t *testing.T) {
	merged := modelconfig.MergeCompat(
		&modelconfig.RequestCompat{DropParams: []string{"a"}, ExtraBody: map[string]any{"x": 1}},
		&modelconfig.RequestCompat{DropParams: []string{"b"}, ExtraBody: map[string]any{"x": 2}, ImageSizeParam: modelconfig.ImageSizeParamNone},
	)
	if len(merged.DropParams) != 2 || merged.ExtraBody["x"] != 2 || merged.ImageSizeParam != modelconfig.ImageSizeParamNone {
		t.Fatalf("merged = %+v", merged)
	}
}

func TestGeminiProviderRoutesChatToCompatAndImagesToNativeAPI(t *testing.T) {
	seen := &captured{}
	png := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))
	server := seen.server(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1beta/openai/chat/completions" {
			_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"pong"}}]}`)
			return
		}
		_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"`+png+`"}}]}}]}`)
	})
	provider := modelconfig.Provider{Adapter: modelconfig.AdapterGemini, BaseURL: server.URL, APIKey: "gk", TimeoutSecs: 30}
	chat, err := Chat(provider, nil, "gemini-2.5-flash", "")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := chat.PostChatCompletions(context.Background(), []byte(`{"model":"gemini-2.5-flash","messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if seen.paths[0] != "/v1beta/openai/chat/completions" || seen.headers[0].Get("Authorization") != "Bearer gk" {
		t.Fatalf("chat request = %s %v", seen.paths[0], seen.headers[0])
	}
	images, pending, _, err := TaskImage(provider, nil, true).SubmitEditImagesTracked(context.Background(), "task", "edit", "gemini-2.5-flash-image", 1, []string{png}, "1024x1024", c2a.ImageOptions{})
	if err != nil || pending || len(images) != 1 {
		t.Fatalf("images=%d pending=%v err=%v", len(images), pending, err)
	}
	if seen.paths[1] != "/v1beta/models/gemini-2.5-flash-image:generateContent" || seen.headers[1].Get("x-goog-api-key") != "gk" {
		t.Fatalf("image request = %s %v", seen.paths[1], seen.headers[1])
	}
}

func TestGeminiChatAPIV1UsesStandardRoot(t *testing.T) {
	seen := &captured{}
	server := seen.server(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"pong"}}]}`)
	})
	provider := modelconfig.Provider{Adapter: modelconfig.AdapterGemini, BaseURL: server.URL, APIKey: "gk", TimeoutSecs: 30}
	chat, err := Chat(provider, &modelconfig.RequestCompat{ChatAPI: modelconfig.ChatAPIOpenAIV1}, "gemini-3.8-flash", "")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := chat.PostChatCompletions(context.Background(), []byte(`{"model":"gemini-3.8-flash","messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if seen.paths[0] != "/v1/chat/completions" || seen.headers[0].Get("Authorization") != "Bearer gk" {
		t.Fatalf("chat request = %s %v", seen.paths[0], seen.headers[0])
	}
}

func TestNativeVendorAdaptersRouteChatAndImages(t *testing.T) {
	cases := []struct {
		adapter, chatPath, imagePath, imageResponse string
	}{
		{modelconfig.AdapterDashScope, "/compatible-mode/v1/chat/completions", "/api/v1/services/aigc/multimodal-generation/generation",
			`{"output":{"choices":[{"message":{"content":[{"image":"IMAGE_URL"}]}}]}}`},
		{modelconfig.AdapterMiniMax, "/v1/chat/completions", "/v1/image_generation",
			`{"data":{"image_base64":["PNG"]},"base_resp":{"status_code":0}}`},
	}
	png := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))
	for _, tc := range cases {
		seen := &captured{}
		var server *httptest.Server
		server = seen.server(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/img.png":
				w.Header().Set("Content-Type", "image/png")
				raw, _ := base64.StdEncoding.DecodeString(png)
				_, _ = w.Write(raw)
			case tc.chatPath:
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"pong"}}]}`)
			default:
				w.Header().Set("Content-Type", "application/json")
				body := strings.ReplaceAll(strings.ReplaceAll(tc.imageResponse, "IMAGE_URL", server.URL+"/img.png"), "PNG", png)
				_, _ = io.WriteString(w, body)
			}
		})
		provider := modelconfig.Provider{Adapter: tc.adapter, BaseURL: server.URL, APIKey: "vk", TimeoutSecs: 30}
		chat, err := Chat(provider, nil, "m", "")
		if err != nil {
			t.Fatal(err)
		}
		resp, err := chat.PostChatCompletions(context.Background(), []byte(`{"model":"m","messages":[]}`))
		if err != nil {
			t.Fatalf("%s chat: %v", tc.adapter, err)
		}
		resp.Body.Close()
		images, pending, _, err := TaskImage(provider, nil, true).SubmitGenerateImagesTracked(context.Background(), "t", "p", "m", 1, "1024x1024", c2a.ImageOptions{})
		if err != nil || pending || len(images) != 1 {
			t.Fatalf("%s image: images=%d pending=%v err=%v", tc.adapter, len(images), pending, err)
		}
		if seen.paths[0] != tc.chatPath || seen.paths[1] != tc.imagePath || seen.headers[1].Get("Authorization") != "Bearer vk" {
			t.Fatalf("%s paths = %v", tc.adapter, seen.paths)
		}
	}
}
