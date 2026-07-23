package sub2api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestChatStreamUsesOpenAIContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("request = %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "gpt-test" || body["stream"] != true {
			t.Fatalf("body = %#v", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, err := New(server.URL+"/v1", "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.ChatStream(context.Background(), []Message{{Role: "user", Content: "hello"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestChatStreamWithImagesUsesMultimodalContent(t *testing.T) {
	reference := "data:image/png;base64,aW1hZ2U="
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		parts, ok := body.Messages[len(body.Messages)-1].Content.([]any)
		if !ok || len(parts) != 2 {
			t.Fatalf("content = %#v", body.Messages[len(body.Messages)-1].Content)
		}
		imagePart, ok := parts[1].(map[string]any)
		imageURL, _ := imagePart["image_url"].(map[string]any)
		if !ok || imagePart["type"] != "image_url" || imageURL["url"] != reference {
			t.Fatalf("image part = %#v", parts[1])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	resp, err := client.ChatStreamWithImages(context.Background(), []Message{
		{Role: "assistant", Content: "请上传图片"},
		{Role: "user", Content: "识别图片中的文字"},
	}, []string{reference})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestChatStreamWithImagesPreservesPerMessageVisualContext(t *testing.T) {
	reference := "data:image/png;base64,aGlzdG9yeQ=="
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		parts, ok := body.Messages[0].Content.([]any)
		if !ok || len(parts) != 2 {
			t.Fatalf("historical content = %#v", body.Messages[0].Content)
		}
		imagePart, _ := parts[1].(map[string]any)
		imageURL, _ := imagePart["image_url"].(map[string]any)
		if imageURL["url"] != reference {
			t.Fatalf("historical image = %#v", imagePart)
		}
		if body.Messages[2].Content != "图片里写了什么？" {
			t.Fatalf("latest content = %#v", body.Messages[2].Content)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	resp, err := client.ChatStreamWithImages(context.Background(), []Message{
		{Role: "user", Content: "请看这张图片", ReferenceImages: []string{reference}},
		{Role: "assistant", Content: "好的"},
		{Role: "user", Content: "图片里写了什么？"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestGenerateImageFansOutWithoutNAndCombinesResults(t *testing.T) {
	var mu sync.Mutex
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" {
			t.Errorf("path = %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, exists := body["n"]; exists {
			t.Errorf("request unexpectedly contains n: %#v", body["n"])
		}
		if body["size"] != "1024x576" {
			t.Errorf("size = %#v", body["size"])
		}
		if body["prompt"] != "cloud\n\n输出图片尺寸为 1024x576。输出图片分辨率为 1K。输出图片质量为 high。" {
			t.Errorf("prompt = %#v", body["prompt"])
		}
		mu.Lock()
		requestCount++
		index := requestCount
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":[{"b64_json":"aW1hZ2Ut%d","revised_prompt":"cloud %d"}]}`, index, index)
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "gpt-image-2", 30)
	images, err := client.GenerateImage(context.Background(), "cloud", "1024x576", "high", 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 2 {
		t.Fatalf("images = %#v", images)
	}
	mu.Lock()
	defer mu.Unlock()
	if requestCount != 2 {
		t.Fatalf("requestCount = %d", requestCount)
	}
}

func TestGenerateImageUsesEditsForReferenceImages(t *testing.T) {
	reference := "data:image/png;base64,aW1hZ2U="
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("path = %s", r.URL.Path)
		}
		var body struct {
			Images []map[string]string `json:"images"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Images) != 1 || body.Images[0]["image_url"] != reference {
			t.Fatalf("images = %#v", body.Images)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[{"b64_json":"ZWRpdGVk"}]}`)
	}))
	defer server.Close()

	client, _ := New(server.URL, "test-key", "gpt-test", "gpt-image-2", 30)
	images, err := client.GenerateImage(context.Background(), "translate text", "1024x1024", "high", 1, []string{reference})
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].DataURL != "data:image/png;base64,ZWRpdGVk" {
		t.Fatalf("images = %#v", images)
	}
}

func TestBuildImagePromptAutoSize(t *testing.T) {
	if got := buildImagePrompt(" cloud ", "auto", "auto"); got != "cloud" {
		t.Fatalf("prompt = %q", got)
	}
}

func TestListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("request = %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[{"id":"gpt-test"},{"id":"image-test"}]}`)
	}))
	defer server.Close()

	client, err := New(server.URL, "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0] != "gpt-test" || models[1] != "image-test" {
		t.Fatalf("models = %#v", models)
	}
}
