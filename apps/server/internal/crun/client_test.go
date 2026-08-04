package crun

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCreateAndWaitTasks(t *testing.T) {
	var mu sync.Mutex
	created := 0
	polls := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "test-key" {
			t.Fatalf("x-api-key = %q", r.Header.Get("x-api-key"))
		}
		switch r.URL.Path {
		case "/api/v1/client/job/CreateTask":
			var body struct {
				Model string `json:"model"`
				Input struct {
					Prompt      string   `json:"prompt"`
					ImageURLs   []string `json:"img_urls"`
					AspectRatio string   `json:"aspect_ratio"`
					Resolution  string   `json:"resolution"`
				} `json:"input"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body.Model != "openai/gpt-image-2-premium" || body.Input.Prompt != "hello" || body.Input.AspectRatio != "16:9" || body.Input.Resolution != "2K" || len(body.Input.ImageURLs) != 1 {
				t.Fatalf("body = %#v", body)
			}
			mu.Lock()
			created++
			id := fmt.Sprintf("task-%d", created)
			mu.Unlock()
			fmt.Fprintf(w, `{"code":200,"message":"success","data":{"task_id":%q}}`, id)
		case "/api/v1/client/job/TaskInfo":
			id := r.URL.Query().Get("task_id")
			mu.Lock()
			polls[id]++
			poll := polls[id]
			mu.Unlock()
			if poll == 1 {
				fmt.Fprintf(w, `{"code":200,"message":"success","data":{"task_id":%q,"status":"running","result":null}}`, id)
				return
			}
			fmt.Fprintf(w, `{"code":200,"message":"success","data":{"task_id":%q,"status":"success","result":{"code":200,"message":"ok","media_urls":[%q]}}}`, id, "https://cdn.example/"+id+".png")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(server.URL, "test-key", "openai/gpt-image-2-premium", 2)
	if err != nil {
		t.Fatal(err)
	}
	client.pollInterval = time.Millisecond
	var ids []string
	for range 2 {
		id, err := client.CreateTask(context.Background(), "hello", "16:9", "2K", []string{"https://example.com/ref.png"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if results, pending, err := client.PollTasks(context.Background(), ids); err != nil || !pending || len(results) != 2 {
		t.Fatalf("one-shot poll results=%#v pending=%v err=%v", results, pending, err)
	}
	var streamed []string
	results, err := client.WaitTasks(context.Background(), ids, func(_ int, imageURL string) error {
		streamed = append(streamed, imageURL)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || len(streamed) != 2 || !strings.Contains(results[1], "task-2") {
		t.Fatalf("results=%#v streamed=%#v", results, streamed)
	}
}

func TestCreateTaskOmitsResolutionForBaseGPTImage2(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string         `json:"model"`
			Input map[string]any `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != DefaultModel {
			t.Fatalf("model = %q", body.Model)
		}
		if _, exists := body.Input["resolution"]; exists {
			t.Fatalf("base GPT Image 2 request must omit resolution: %#v", body.Input)
		}
		fmt.Fprint(w, `{"code":200,"message":"success","data":{"task_id":"task-1"}}`)
	}))
	defer server.Close()

	client, err := New(server.URL, "test-key", DefaultModel, 30)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.CreateTask(context.Background(), "hello", "1:1", "4K", nil); err != nil {
		t.Fatal(err)
	}
}

func TestCreateTaskUsesResolvedAspectWithFixedResolution(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Input map[string]any `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Input["aspect_ratio"] != "16:9" {
			t.Fatalf("resolved auto aspect was not sent: %#v", body.Input)
		}
		if body.Input["resolution"] != "4K" {
			t.Fatalf("auto aspect must preserve fixed resolution: %#v", body.Input)
		}
		fmt.Fprint(w, `{"code":200,"message":"success","data":{"task_id":"task-auto"}}`)
	}))
	defer server.Close()

	client, err := New(server.URL, "test-key", "openai/gpt-image-2-stable", 30)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.CreateTask(context.Background(), "hello", "16:9", "4K", nil); err != nil {
		t.Fatal(err)
	}
}

func TestBalance(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/client/account/balance" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		fmt.Fprint(w, `{"code":200,"message":"success","data":{"balance":123.5}}`)
	}))
	defer server.Close()
	client, _ := New(server.URL+"/api/v1", "test-key", "", 30)
	balance, err := client.Balance(context.Background())
	if err != nil || balance != 123.5 {
		t.Fatalf("balance=%v err=%v", balance, err)
	}
}

func TestCreateBackgroundRemovalTask(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/client/job/CreateTask" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		var body struct {
			Model string `json:"model"`
			Input struct {
				ImageURLs []string `json:"img_urls"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "image-background-remove" || len(body.Input.ImageURLs) != 1 || body.Input.ImageURLs[0] != "https://cdn.example/source.png" {
			t.Fatalf("body = %#v", body)
		}
		fmt.Fprint(w, `{"code":200,"message":"success","data":{"task_id":"remove-1"}}`)
	}))
	defer server.Close()
	client, err := New(server.URL, "test-key", "image-background-remove", 30)
	if err != nil {
		t.Fatal(err)
	}
	taskID, err := client.CreateBackgroundRemovalTask(context.Background(), "https://cdn.example/source.png")
	if err != nil || taskID != "remove-1" {
		t.Fatalf("taskID=%q err=%v", taskID, err)
	}
}
