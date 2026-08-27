package c2a

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestImageDownloadTimeoutAllowsSlowCompletedImages(t *testing.T) {
	if got := imageDownloadTimeout(5 * time.Minute); got != 3*time.Minute {
		t.Fatalf("capped timeout = %s, want 3m", got)
	}
	if got := imageDownloadTimeout(2 * time.Minute); got != 2*time.Minute {
		t.Fatalf("configured timeout = %s, want 2m", got)
	}
}

func TestAsyncSubmitTimeoutCoversSlowReferenceHandoff(t *testing.T) {
	if asyncSubmitTimeout < 2*time.Minute {
		t.Fatalf("async submit timeout=%s, want at least 2m", asyncSubmitTimeout)
	}
}

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

func TestGenerateImagesWithIDHonorsExplicitQuality(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-high","status":"success","data":[{"b64_json":"image-data"}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	images, err := client.GenerateImagesWithID(
		context.Background(), "task-high", "draw sharp UI", "gpt-image-2", 1, "2048x1152", "high",
	)
	if err != nil {
		t.Fatalf("GenerateImagesWithID: %v", err)
	}
	if len(images) != 1 || images[0] != "image-data" {
		t.Fatalf("images = %#v", images)
	}
	if payload["quality"] != "high" {
		t.Fatalf("quality = %#v, want high", payload["quality"])
	}
}

func TestGenerateImagesWithOptionsForwardsConfiguredCapabilities(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-options","status":"success","data":[{"b64_json":"image-data"}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	_, err := client.GenerateImagesWithOptions(
		context.Background(), "task-options", "draw a logo", "gpt-image-2", 1, "1024x1024",
		ImageOptions{Quality: "medium", InputFidelity: "high", TransparentBackground: true, OutputFormat: "webp", ModerationLevel: "low"},
	)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]any{
		"quality": "medium", "background": "transparent", "output_format": "webp", "moderation": "low",
	} {
		if payload[key] != want {
			t.Fatalf("%s = %#v, want %#v", key, payload[key], want)
		}
	}
	if _, exists := payload["input_fidelity"]; exists {
		t.Fatal("generation payload must not include input_fidelity without reference images")
	}
}

func TestEditImagesWithOptionsForwardsInputFidelity(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"edit-fidelity","status":"success","data":[{"b64_json":"done"}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	_, err := client.EditImagesWithOptions(
		context.Background(), "edit-fidelity", "keep identity", "gpt-image-2", 1,
		[]string{"aW1hZ2U="}, "1024x1024", ImageOptions{InputFidelity: "high"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if payload["input_fidelity"] != "high" {
		t.Fatalf("input_fidelity = %#v", payload["input_fidelity"])
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

func TestPollImageTaskRetriesReturnedImageBeforeItIsAvailable(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	downloads := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/image-tasks":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"items":[{"id":"task-media-lag","status":"success","data":[{"url":"`+server.URL+`/generated.png"}]}]}`)
		case "/generated.png":
			downloads++
			if downloads == 1 {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	images, pending, firstErr := client.PollImageTask(context.Background(), "task-media-lag", 1)
	if !pending || nonEmptyImageCount(images) != 0 || !IsRetryableError(firstErr) {
		t.Fatalf("first poll images=%#v pending=%v err=%v, want retryable media lag", images, pending, firstErr)
	}
	images, pending, err = client.PollImageTask(context.Background(), "task-media-lag", 1)
	if err != nil || pending || len(images) != 1 || downloads != 2 {
		t.Fatalf("second poll images=%#v pending=%v downloads=%d err=%v", images, pending, downloads, err)
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

func TestGenerateImagesPollsDeterministicIDAfterAmbiguousSubmitFailure(t *testing.T) {
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/image-tasks/generations":
			http.Error(w, `{"detail":"submit gateway timeout"}`, http.StatusGatewayTimeout)
		case "/api/image-tasks":
			polls++
			if polls == 1 {
				_, _ = w.Write([]byte(`{"items":[],"missing_ids":["task-ambiguous"]}`))
				return
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"task-ambiguous","status":"success","data":[{"b64_json":"recovered-image"}]}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 10, true)
	images, err := client.GenerateImagesWithID(context.Background(), "task-ambiguous", "draw a cat", "gpt-image-2", 1, "")
	if err != nil {
		t.Fatalf("GenerateImagesWithID: %v", err)
	}
	if polls < 2 || len(images) != 1 || images[0] != "recovered-image" {
		t.Fatalf("polls=%d images=%#v", polls, images)
	}
}

func TestNetworkErrorReportsTimeout(t *testing.T) {
	err := &NetworkError{Message: "上游图片任务等待超时"}
	if !err.Timeout() {
		t.Fatal("NetworkError.Timeout() = false, want true")
	}
}

func TestSubmitAndPollImageTaskAreOneShotOperations(t *testing.T) {
	submits, polls := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/image-tasks/generations":
			submits++
			_, _ = w.Write([]byte(`{"id":"task-one-shot","status":"running","data":[]}`))
		case "/api/image-tasks":
			polls++
			_, _ = w.Write([]byte(`{"items":[{"id":"task-one-shot","status":"success","data":[{"b64_json":"done"}]}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	images, pending, err := client.SubmitGenerateImages(context.Background(), "task-one-shot", "draw", "image-model", 1, "", ImageOptions{})
	if err != nil || !pending || len(images) != 0 || submits != 1 || polls != 0 {
		t.Fatalf("submit images=%#v pending=%v submits=%d polls=%d err=%v", images, pending, submits, polls, err)
	}
	images, pending, err = client.PollImageTask(context.Background(), "task-one-shot", 1)
	if err != nil || pending || len(images) != 1 || images[0] != "done" || submits != 1 || polls != 1 {
		t.Fatalf("poll images=%#v pending=%v submits=%d polls=%d err=%v", images, pending, submits, polls, err)
	}
}

func TestPollImageTasksBatchesMultipleIDs(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if got := r.URL.Query().Get("ids"); got != "task-a,task-b" {
			t.Fatalf("ids = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"task-a","status":"running","data":[]},{"id":"task-b","status":"success","data":[{"b64_json":"done-b"}]}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	results := client.PollImageTasks(context.Background(), []string{"task-a", "task-b"}, map[string]int{"task-a": 1, "task-b": 1})
	if requests != 1 || !results["task-a"].Pending || results["task-b"].Pending || len(results["task-b"].Images) != 1 {
		t.Fatalf("requests=%d results=%#v", requests, results)
	}
}

func TestSubmitGenerateImagesTrackedReturnsCanonicalUpstreamID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/image-tasks/generations" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"canonical-upstream-id","client_task_id":"local-id","status":"processing"}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	images, pending, upstreamTaskID, err := client.SubmitGenerateImagesTracked(
		context.Background(), "local-id", "draw", "gpt-image-2", 1, "", ImageOptions{})
	if err != nil || !pending || len(images) != 0 || upstreamTaskID != "canonical-upstream-id" {
		t.Fatalf("images=%#v pending=%v upstreamTaskID=%q err=%v", images, pending, upstreamTaskID, err)
	}
}

func TestPollImageTasksHandlesTwentyCanonicalIDs(t *testing.T) {
	const count = 20
	taskIDs := make([]string, 0, count)
	expected := make(map[string]int, count)
	for index := 0; index < count; index++ {
		id := fmt.Sprintf("upstream-%02d", index)
		taskIDs = append(taskIDs, id)
		expected[id] = 1
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := strings.Split(r.URL.Query().Get("ids"), ","); len(got) != count {
			t.Fatalf("polled %d ids, want %d", len(got), count)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"items":[`)
		for index, id := range taskIDs {
			if index > 0 {
				_, _ = io.WriteString(w, ",")
			}
			fmt.Fprintf(w, `{"id":%q,"status":"success","data":[{"b64_json":%q}]}`, id, "image-"+id)
		}
		_, _ = io.WriteString(w, `]}`)
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	results := client.PollImageTasks(context.Background(), taskIDs, expected)
	if len(results) != count {
		t.Fatalf("results=%d, want %d", len(results), count)
	}
	for _, id := range taskIDs {
		result := results[id]
		if result.Pending || result.Missing || result.Err != nil || len(result.Images) != 1 || result.Images[0] != "image-"+id {
			t.Fatalf("task %s result=%#v", id, result)
		}
	}
}

func TestPollImageTasksAcceptsResultsField(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"task-results","status":"success","succeeded_count":1,"results":[{"b64_json":"done-from-results"}]}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	images, pending, err := client.PollImageTask(context.Background(), "task-results", 1)
	if err != nil || pending || len(images) != 1 || images[0] != "done-from-results" {
		t.Fatalf("images=%#v pending=%v err=%v", images, pending, err)
	}
}

func TestPollImageTasksClassifiesMissingAndExplicitFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"failed","status":"failed","error_code":"rejected","error":"rejected upstream"}],"missing_ids":["missing"]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	results := client.PollImageTasks(context.Background(), []string{"failed", "missing"}, map[string]int{"failed": 1, "missing": 1})
	if results["failed"].Pending || !results["failed"].ExplicitFailure || results["failed"].Err == nil {
		t.Fatalf("explicit failure misclassified: %#v", results["failed"])
	}
	if !strings.Contains(results["failed"].Err.Error(), "rejected: rejected upstream") {
		t.Fatalf("explicit failure lost upstream details: %v", results["failed"].Err)
	}
	if !results["missing"].Pending || !results["missing"].Missing || results["missing"].ExplicitFailure {
		t.Fatalf("missing task misclassified: %#v", results["missing"])
	}
}

func TestCompletedTaskImagesNormalizesProviderStatuses(t *testing.T) {
	client := NewWithPolicy("https://example.com", "test-key", 30, true)
	tests := []struct {
		status          string
		pending         bool
		explicitFailure bool
	}{
		{status: "pending", pending: true},
		{status: "processing", pending: true},
		{status: "text_review", explicitFailure: true},
		{status: "moderating", pending: true},
		{status: "mystery_new_state", pending: true},
		{status: "text", explicitFailure: true},
		{status: "text_result", explicitFailure: true},
		{status: "文本", explicitFailure: true},
		{status: "succeeded"},
		{status: "completed"},
		{status: "failed", explicitFailure: true},
		{status: "cancelled", explicitFailure: true},
	}
	for _, tc := range tests {
		t.Run(tc.status, func(t *testing.T) {
			task := imageTask{ID: "task-" + tc.status, Status: tc.status}
			if !tc.pending && !tc.explicitFailure {
				task.Data = []map[string]any{{"b64_json": "image-data"}}
			}
			images, _, done, err := client.completedTaskImages(context.Background(), task, 1)
			if tc.pending {
				if done || err != nil {
					t.Fatalf("done=%v err=%v, want pending", done, err)
				}
				return
			}
			if !done {
				t.Fatal("terminal status was left pending")
			}
			if tc.explicitFailure {
				if err == nil || !imageTaskStatusFailed(normalizedImageTaskStatus(task)) {
					t.Fatalf("err=%v, want explicit failure", err)
				}
				return
			}
			if err != nil || len(images) != 1 || images[0] != "image-data" {
				t.Fatalf("images=%#v err=%v, want successful image", images, err)
			}
		})
	}
}

func TestCompletedTaskImagesTreatsUpstreamTextMessageAsFailure(t *testing.T) {
	client := NewWithPolicy("https://example.com", "test-key", 30, true)
	task := imageTask{ID: "task-text-msg", Status: "processing", Error: "上游返回文本"}
	_, _, done, err := client.completedTaskImages(context.Background(), task, 1)
	if !done || err == nil || !imageTaskIsTextFailure(task) {
		t.Fatalf("done=%v err=%v, want explicit text failure", done, err)
	}
}

func TestPollImageTasksEachEmitsCompletedResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"task-a","status":"success","data":[{"b64_json":"a"}]},{"id":"task-b","status":"success","data":[{"b64_json":"b"}]}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	got := map[string]string{}
	var mu sync.Mutex
	client.PollImageTasksEach(context.Background(), []string{"task-a", "task-b"}, map[string]int{"task-a": 1, "task-b": 1}, func(taskID string, result ImageTaskPollResult) {
		if result.Err != nil || result.Pending || len(result.Images) != 1 {
			t.Errorf("task %s result = %#v", taskID, result)
			return
		}
		mu.Lock()
		got[taskID] = result.Images[0]
		mu.Unlock()
	})
	if got["task-a"] != "a" || got["task-b"] != "b" {
		t.Fatalf("results = %#v", got)
	}
}

func TestPollImageTasksEachGuardedClaimsOnlyTerminalResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"pending","status":"running","data":[]},{"id":"done","status":"success","data":[{"b64_json":"image"}]}]}`))
	}))
	defer server.Close()
	client := NewWithPolicy(server.URL, "test-key", 30, true)
	var claimed []string
	results := map[string]ImageTaskPollResult{}
	var mu sync.Mutex
	client.PollImageTasksEachGuarded(context.Background(), []string{"pending", "done"}, map[string]int{"pending": 1, "done": 1}, func(taskID string) bool {
		claimed = append(claimed, taskID)
		return true
	}, func(taskID string, result ImageTaskPollResult) {
		mu.Lock()
		results[taskID] = result
		mu.Unlock()
	})
	if strings.Join(claimed, ",") != "done" {
		t.Fatalf("completion claims = %#v, want only done", claimed)
	}
	if !results["pending"].Pending || results["done"].Pending || len(results["done"].Images) != 1 {
		t.Fatalf("results = %#v", results)
	}
}

func png1x1() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54,
		0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
		0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
		0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
}

func TestCompletedTaskImagesKeepsRetryableDownloadPending(t *testing.T) {
	var statusOpen atomic.Bool
	statusOpen.Store(true)
	var overlappingDownload atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/image-tasks"):
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"items":[{"id":"task-ok","status":"success","data":[{"url":"%s/img-ok.png"},{"url":"%s/img-missing.png"}]}]}`, "http://"+r.Host, "http://"+r.Host)
			statusOpen.Store(false)
		case r.URL.Path == "/img-ok.png":
			if statusOpen.Load() {
				overlappingDownload.Store(true)
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png1x1())
		case r.URL.Path == "/img-missing.png":
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	results := client.PollImageTasks(context.Background(), []string{"task-ok"}, map[string]int{"task-ok": 2})
	result := results["task-ok"]
	if overlappingDownload.Load() {
		t.Fatal("image download started before the status response finished")
	}
	if !result.Pending || result.Err == nil || nonEmptyImageCount(result.Images) != 1 {
		t.Fatalf("result = %#v, want pending with one recovered image", result)
	}
	if result.CompletedAt.IsZero() {
		t.Fatal("succeeded poll should record CompletedAt before download")
	}
}

func TestTaskImagesB64DownloadsInParallel(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(png1x1())
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	data := []map[string]any{
		{"url": server.URL + "/a.png"},
		{"url": server.URL + "/b.png"},
	}
	done := make(chan struct{})
	var images []string
	var err error
	go func() {
		defer close(done)
		images, _, err = client.taskImagesB64(context.Background(), data)
	}()
	waitStarted := time.After(2 * time.Second)
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-waitStarted:
			t.Fatal("downloads did not overlap")
		}
	}
	close(release)
	<-done
	if err != nil || nonEmptyImageCount(images) != 2 {
		t.Fatalf("images=%#v err=%v", images, err)
	}
}

func TestPollImageTaskStatusesGuardedDoesNotDownloadURLs(t *testing.T) {
	var downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/image-tasks"):
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"items":[{"id":"task-url","status":"success","data":[{"url":"%s/img.png"}]}]}`, "http://"+r.Host)
		case r.URL.Path == "/img.png":
			downloads.Add(1)
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png1x1())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	var result ImageTaskPollResult
	client.PollImageTaskStatusesGuarded(context.Background(), []string{"task-url"}, map[string]int{"task-url": 1}, func(string) bool {
		return true
	}, func(_ string, got ImageTaskPollResult) {
		result = got
	})
	if downloads.Load() != 0 {
		t.Fatalf("status poll downloaded %d images", downloads.Load())
	}
	if result.Pending || result.Err != nil || len(result.ImagePayload) != 1 || nonEmptyImageCount(result.Images) != 0 {
		t.Fatalf("status result = %#v", result)
	}
}

func TestPollImageTasksMatchClientTaskIDWhenUpstreamIDDiffers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"c2a-internal","client_task_id":"local-task","status":"success","data":[{"b64_json":"matched"}]}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	var result ImageTaskPollResult
	var gotID string
	client.PollImageTasksEach(context.Background(), []string{"local-task"}, map[string]int{"local-task": 1}, func(taskID string, got ImageTaskPollResult) {
		gotID = taskID
		result = got
	})
	if gotID != "local-task" || result.Pending || result.Missing || result.Err != nil || len(result.Images) != 1 || result.Images[0] != "matched" {
		t.Fatalf("id=%q result=%#v, want local-task image", gotID, result)
	}
}

func TestPollImageTasksReadNestedResultData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"nested","status":"success","result":{"data":[{"b64_json":"nested-img"}]}}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	var result ImageTaskPollResult
	client.PollImageTasksEach(context.Background(), []string{"nested"}, map[string]int{"nested": 1}, func(_ string, got ImageTaskPollResult) {
		result = got
	})
	if result.Pending || result.Err != nil || len(result.Images) != 1 || result.Images[0] != "nested-img" {
		t.Fatalf("nested result = %#v, want nested-img", result)
	}
}

func TestPollImageTasksReadsNestedTextReviewReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"reviewed","status":"text_review","output":{"content":[{"type":"output_text","text":"内容审核拒绝：参考图不符合服务政策"}]}}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	var result ImageTaskPollResult
	client.PollImageTasksEach(context.Background(), []string{"reviewed"}, map[string]int{"reviewed": 1}, func(_ string, got ImageTaskPollResult) {
		result = got
	})
	if result.Pending || !result.ExplicitFailure || result.Err == nil || result.Status != "text_review" || result.ErrorMessage != "内容审核拒绝：参考图不符合服务政策" {
		t.Fatalf("text review result = %#v", result)
	}
}

func TestPollImageTasksReturnsPublicTerminalError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"reviewed","status":"text_review","terminal":true,"error_code":"upstream_text_reply","public_error":"请上传需要重新设计的 APP 首页参考图"}]}`))
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	var result ImageTaskPollResult
	client.PollImageTasksEach(context.Background(), []string{"reviewed"}, map[string]int{"reviewed": 1}, func(_ string, got ImageTaskPollResult) {
		result = got
	})
	if result.Pending || !result.ExplicitFailure || result.Err == nil {
		t.Fatalf("terminal text result = %#v", result)
	}
	if result.ErrorMessage != "请上传需要重新设计的 APP 首页参考图" ||
		!strings.Contains(result.Err.Error(), "upstream_text_reply: 请上传需要重新设计的 APP 首页参考图") {
		t.Fatalf("terminal text error was not preserved: %#v", result)
	}
}
