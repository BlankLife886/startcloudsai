package c2a

import (
	"bytes"
	"context"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(previous) })
	return &buf
}

func TestImageSubmitTraceShowsBodySentButNoResponse(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	defer close(release)
	logs := captureLog(t)

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	payload := map[string]any{"client_task_id": "task-123", "images": []string{strings.Repeat("A", 64<<10)}}
	_, err := client.doRequest(context.Background(), http.MethodPost, "/api/image-tasks/edits", payload, 200*time.Millisecond)
	if err == nil {
		t.Fatal("expected submit timeout")
	}

	line := logs.String()
	for _, want := range []string{"c2a submit trace", "path=/api/image-tasks/edits", "client_task_id=task-123", "conn_reused=false", "first_byte_ms=-", "status=-", "deadline exceeded"} {
		if !strings.Contains(line, want) {
			t.Fatalf("trace log missing %q:\n%s", want, line)
		}
	}
	if !regexp.MustCompile(`wrote_request_ms=\d+`).MatchString(line) {
		t.Fatalf("trace log should record that the body was fully written:\n%s", line)
	}
	if !regexp.MustCompile(`body_bytes=\d{5,}`).MatchString(line) {
		t.Fatalf("trace log should record the request body size:\n%s", line)
	}
}

func TestImageSubmitTraceRecordsSuccessfulTimings(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"up-1","status":"queued"}`))
	}))
	defer server.Close()
	logs := captureLog(t)

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	if _, err := client.doRequest(context.Background(), http.MethodPost, "/api/image-tasks/generations", map[string]any{"client_task_id": "task-ok"}, time.Second); err != nil {
		t.Fatal(err)
	}
	line := logs.String()
	if !strings.Contains(line, "client_task_id=task-ok") || !strings.Contains(line, "status=200") || !regexp.MustCompile(`first_byte_ms=\d+`).MatchString(line) {
		t.Fatalf("unexpected trace log:\n%s", line)
	}
}

func TestNonSubmitRequestsAreNotTraced(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()
	logs := captureLog(t)

	client := NewWithPolicy(server.URL, "test-key", 30, true)
	if _, err := client.doRequest(context.Background(), http.MethodGet, "/api/image-tasks?ids=x", nil, time.Second); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(logs.String(), "c2a submit trace") {
		t.Fatalf("poll request should not be traced:\n%s", logs.String())
	}
}
