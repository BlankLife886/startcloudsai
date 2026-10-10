package c2a

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseUpstreamTimestampFormats(t *testing.T) {
	want := time.Date(2026, 9, 25, 4, 22, 18, 0, time.UTC)
	for _, raw := range []string{`"2026-09-25T12:22:18+08:00"`, `1790310138`, `1790310138000`, `"1790310138"`} {
		got := parseUpstreamTimestamp(json.RawMessage(raw))
		if !got.Equal(want) {
			t.Fatalf("parse %s = %s, want %s", raw, got, want)
		}
	}
	for _, raw := range []string{``, `null`, `""`, `"not a time"`, `0`} {
		if got := parseUpstreamTimestamp(json.RawMessage(raw)); !got.IsZero() {
			t.Fatalf("parse %s = %s, want zero", raw, got)
		}
	}
}

func TestPollReportsUpstreamFinishTimeAndPollDiagnostics(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"task-1","status":"processing","finished_at":"2026-09-25T12:22:18+08:00"},{"id":"task-2","status":"processing"}]}`))
	}))
	defer server.Close()
	logs := captureLog(t)
	client := NewWithPolicy(server.URL, "test-key", 30, true)
	results := map[string]ImageTaskPollResult{}
	client.PollImageTaskStatusesGuarded(context.Background(), []string{"task-1", "task-2"}, map[string]int{"task-1": 1, "task-2": 1}, nil, func(id string, result ImageTaskPollResult) {
		results[id] = result
	})
	if len(results) != 2 {
		t.Fatalf("results=%#v", results)
	}
	if !results["task-1"].UpstreamFinishedAt.Equal(time.Date(2026, 9, 25, 4, 22, 18, 0, time.UTC)) || !results["task-2"].UpstreamFinishedAt.IsZero() {
		t.Fatalf("finish times task-1=%s task-2=%s", results["task-1"].UpstreamFinishedAt, results["task-2"].UpstreamFinishedAt)
	}
	if results["task-1"].PollBytes <= 0 || results["task-1"].PollMs < 0 {
		t.Fatalf("poll diagnostics missing: %#v", results["task-1"])
	}
	line := logs.String()
	if !strings.Contains(line, "c2a poll trace ids=2 status=200 items=2") || !strings.Contains(line, "err=-") {
		t.Fatalf("unexpected poll trace log:\n%s", line)
	}
}

func TestPollTraceRecordsUpstreamErrorStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"upstream busy"}`, http.StatusBadGateway)
	}))
	defer server.Close()
	logs := captureLog(t)
	client := NewWithPolicy(server.URL, "test-key", 30, true)
	var got ImageTaskPollResult
	client.PollImageTaskStatusesGuarded(context.Background(), []string{"task-1"}, map[string]int{"task-1": 1}, nil, func(_ string, result ImageTaskPollResult) {
		got = result
	})
	if got.Err == nil {
		t.Fatal("expected poll error")
	}
	if line := logs.String(); !strings.Contains(line, "status=502") || !strings.Contains(line, "upstream busy") {
		t.Fatalf("poll trace should record the failing status and error:\n%s", line)
	}
}
