package c2a

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestImageRequestsDoNotFallbackAfterAsyncSubmission(t *testing.T) {
	for _, operation := range []string{"generations", "edits"} {
		for _, submitStatus := range []int{http.StatusAccepted, http.StatusGatewayTimeout} {
			for _, pollStatus := range []int{http.StatusNotFound, http.StatusMethodNotAllowed} {
				t.Run(fmt.Sprintf("%s/submit-%d/poll-%d", operation, submitStatus, pollStatus), func(t *testing.T) {
					t.Parallel()
					var submitted, polled, synchronous atomic.Int32
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						switch r.URL.Path {
						case "/api/image-tasks/" + operation:
							submitted.Add(1)
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(submitStatus)
							_, _ = w.Write([]byte(`{"id":"task-once","status":"running"}`))
						case "/api/image-tasks":
							polled.Add(1)
							http.Error(w, "temporarily unavailable", pollStatus)
						case "/v1/images/" + operation:
							synchronous.Add(1)
							_, _ = w.Write([]byte(`{"data":[{"b64_json":"duplicate"}]}`))
						default:
							http.NotFound(w, r)
						}
					}))
					defer server.Close()

					client := NewWithPolicy(server.URL, "test-key", 10, true).WithAsyncImageEdits()
					var err error
					if operation == "edits" {
						_, err = client.EditImagesWithOptions(context.Background(), "task-once", "refine", "gpt-image-2", 1,
							[]string{base64.StdEncoding.EncodeToString(png1x1())}, "1024x1024", ImageOptions{})
					} else {
						_, err = client.GenerateImagesWithOptions(context.Background(), "task-once", "refine", "gpt-image-2", 1, "1024x1024", ImageOptions{})
					}
					var upstream *UpstreamError
					if !errors.As(err, &upstream) || upstream.StatusCode != pollStatus {
						t.Fatalf("err=%v, want poll HTTP %d", err, pollStatus)
					}
					if submitted.Load() != 1 || polled.Load() != 1 || synchronous.Load() != 0 {
						t.Fatalf("submitted=%d polled=%d synchronous=%d", submitted.Load(), polled.Load(), synchronous.Load())
					}
				})
			}
		}
	}
}

func TestAsyncSubmitFallbackRequiresUnsupportedEndpoint(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusBadRequest, http.StatusGatewayTimeout} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			original := &UpstreamError{Message: "upstream response", StatusCode: status}
			if shouldFallbackToSync(original) {
				t.Fatal("an error outside the submission must not trigger fallback")
			}
			classified := classifyAsyncSubmitError(original)
			wantFallback := status == http.StatusNotFound || status == http.StatusMethodNotAllowed
			if shouldFallbackToSync(classified) != wantFallback {
				t.Fatalf("fallback=%v, want %v", shouldFallbackToSync(classified), wantFallback)
			}
			var upstream *UpstreamError
			if !errors.As(classified, &upstream) || upstream != original {
				t.Fatalf("original error lost: %v", classified)
			}
		})
	}
}

func TestTrackedImageEditDoesNotFallbackOnGatewayTimeout(t *testing.T) {
	var submitted, synchronous atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/image-tasks/edits" {
			submitted.Add(1)
			http.Error(w, "504 Gateway Time-out", http.StatusGatewayTimeout)
			return
		}
		synchronous.Add(1)
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"duplicate"}]}`))
	}))
	defer server.Close()
	client := NewWithPolicy(server.URL, "test-key", 10, true).WithAsyncImageEdits()
	images, pending, upstreamID, err := client.SubmitEditImagesTracked(context.Background(), "task-once", "refine", "gpt-image-2", 1,
		[]string{base64.StdEncoding.EncodeToString(png1x1())}, "1024x1024", ImageOptions{})
	var upstream *UpstreamError
	if len(images) != 0 || pending || upstreamID != "" || !errors.As(err, &upstream) || upstream.StatusCode != http.StatusGatewayTimeout || !IsRetryableError(err) {
		t.Fatalf("images=%v pending=%v upstreamID=%q err=%v", images, pending, upstreamID, err)
	}
	if submitted.Load() != 1 || synchronous.Load() != 0 {
		t.Fatalf("submitted=%d synchronous=%d", submitted.Load(), synchronous.Load())
	}
}

func TestSynchronousImageTimeoutIsNotRecoverableOrRetryable(t *testing.T) {
	for _, operation := range []string{"generations", "edits-json", "edits-multipart", "edits-direct"} {
		for _, tracked := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/tracked-%t", operation, tracked), func(t *testing.T) {
				t.Parallel()
				var submitted, synchronous atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/api/image-tasks/edits" || r.URL.Path == "/api/image-tasks/generations" {
						submitted.Add(1)
						http.NotFound(w, r)
						return
					}
					synchronous.Add(1)
					http.Error(w, "504 Gateway Time-out", http.StatusGatewayTimeout)
				}))
				defer server.Close()
				client := NewWithPolicy(server.URL, "test-key", 10, true)
				switch operation {
				case "edits-multipart":
					client = client.WithAsyncImageEdits()
				case "edits-direct":
					client = client.WithOpenAIImageEdits()
				}
				var images []string
				var pending bool
				var upstreamID string
				var err error
				inputs := []string{base64.StdEncoding.EncodeToString(png1x1())}
				if operation == "generations" {
					if tracked {
						images, pending, upstreamID, err = client.SubmitGenerateImagesTracked(context.Background(), "task-once", "refine", "gpt-image-2", 1, "1024x1024", ImageOptions{})
					} else {
						images, err = client.GenerateImagesWithOptions(context.Background(), "task-once", "refine", "gpt-image-2", 1, "1024x1024", ImageOptions{})
					}
				} else if tracked {
					images, pending, upstreamID, err = client.SubmitEditImagesTracked(context.Background(), "task-once", "refine", "gpt-image-2", 1, inputs, "1024x1024", ImageOptions{})
				} else {
					images, err = client.EditImagesWithOptions(context.Background(), "task-once", "refine", "gpt-image-2", 1, inputs, "1024x1024", ImageOptions{})
				}
				var synchronousErr *SynchronousImageError
				var upstream *UpstreamError
				if len(images) != 0 || pending || upstreamID != "" || !errors.As(err, &synchronousErr) || !errors.As(err, &upstream) || upstream.StatusCode != http.StatusGatewayTimeout || IsRetryableError(err) {
					t.Fatalf("images=%v pending=%v upstreamID=%q err=%v retryable=%v", images, pending, upstreamID, err, IsRetryableError(err))
				}
				wantSubmitted := int32(1)
				if operation == "edits-direct" {
					wantSubmitted = 0
				}
				if submitted.Load() != wantSubmitted || synchronous.Load() != 1 {
					t.Fatalf("submitted=%d synchronous=%d", submitted.Load(), synchronous.Load())
				}
			})
		}
	}
}

func TestTrackedImageEditsRecoverFourConcurrentSubmissions(t *testing.T) {
	var mu sync.Mutex
	counts := map[string]int{}
	var synchronous atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/image-tasks/edits":
			var payload struct {
				ClientTaskID string `json:"client_task_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("decode submit: %v", err)
				http.Error(w, "invalid request", http.StatusBadRequest)
				return
			}
			mu.Lock()
			counts[payload.ClientTaskID]++
			mu.Unlock()
			http.Error(w, "504 Gateway Time-out", http.StatusGatewayTimeout)
		case "/api/image-tasks":
			w.Header().Set("Content-Type", "application/json")
			items := make([]map[string]any, 0, 4)
			for _, taskID := range strings.Split(r.URL.Query().Get("ids"), ",") {
				items = append(items, map[string]any{
					"id": "canonical-" + taskID, "client_task_id": taskID, "status": "success",
					"data": []map[string]string{{"b64_json": "image-" + taskID}},
				})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
		default:
			synchronous.Add(1)
			http.Error(w, "unexpected synchronous submit", http.StatusInternalServerError)
		}
	}))
	defer server.Close()
	client := NewWithPolicy(server.URL, "test-key", 10, true).WithAsyncImageEdits()
	ids := []string{"task-1", "task-2", "task-3", "task-4"}
	var group sync.WaitGroup
	for _, taskID := range ids {
		group.Go(func() {
			_, _, _, err := client.SubmitEditImagesTracked(context.Background(), taskID, "refine", "gpt-image-2", 1,
				[]string{base64.StdEncoding.EncodeToString(png1x1())}, "1024x1024", ImageOptions{})
			if !IsRetryableError(err) {
				t.Errorf("%s must enter async recovery: %v", taskID, err)
			}
		})
	}
	group.Wait()
	results := client.PollImageTasks(context.Background(), ids, map[string]int{"task-1": 1, "task-2": 1, "task-3": 1, "task-4": 1})
	for _, taskID := range ids {
		result := results[taskID]
		if result.Err != nil || result.Pending || len(result.Images) != 1 || result.Images[0] != "image-"+taskID {
			t.Errorf("%s result=%+v", taskID, result)
		}
		if counts[taskID] != 1 {
			t.Errorf("%s submitted %d times", taskID, counts[taskID])
		}
	}
	if synchronous.Load() != 0 {
		t.Fatalf("synchronous submits=%d, want zero", synchronous.Load())
	}
}
