package assistantstream

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// requireRedis skips instead of failing: the tool rendezvous is the only part of
// this package that needs a live backend, and CI may not provide one.
func requireRedis(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL not set")
	}
	client := NewClient(url)
	if client == nil {
		t.Skip("redis url not parseable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("redis unavailable: %v", err)
	}
	return client
}

func TestWaitToolResultReceivesWhatTheBrowserPosted(t *testing.T) {
	client := requireRedis(t)
	defer client.Close()
	ctx := context.Background()
	runID, requestID := "run-"+time.Now().Format("150405.000"), "req-1"

	go func() {
		time.Sleep(50 * time.Millisecond)
		payload, _ := json.Marshal(map[string]any{"requestId": requestID, "result": map[string]any{"applied": 3}})
		_ = PublishToolResult(ctx, client, runID, requestID, payload)
	}()

	payload, err := WaitToolResult(ctx, client, runID, requestID, 3*time.Second)
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	var envelope struct {
		Result struct {
			Applied int `json:"applied"`
		} `json:"result"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Result.Applied != 3 {
		t.Fatalf("payload = %s", payload)
	}
}

func TestWaitToolResultGivesUpWithoutFailingTheRun(t *testing.T) {
	client := requireRedis(t)
	defer client.Close()
	start := time.Now()
	payload, err := WaitToolResult(context.Background(), client, "run-missing", "req-missing", 300*time.Millisecond)
	if err != nil {
		t.Fatalf("a timeout must not surface as an error: %v", err)
	}
	if payload != nil {
		t.Fatalf("payload = %s", payload)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("waited too long: %s", elapsed)
	}
}

func TestWaitToolResultStopsWhenTheRunIsCanceled(t *testing.T) {
	client := requireRedis(t)
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()
	start := time.Now()
	if _, err := WaitToolResult(ctx, client, "run-canceled", "req-canceled", 30*time.Second); err == nil {
		t.Fatal("expected cancellation to surface")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("cancellation was not honored promptly: %s", elapsed)
	}
}

func TestEventSerializesReasoning(t *testing.T) {
	payload, err := json.Marshal(Event{Content: "answer", Reasoning: "actual reasoning", Kind: "chat"})
	if err != nil {
		t.Fatal(err)
	}
	var event map[string]any
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatal(err)
	}
	if event["reasoning"] != "actual reasoning" {
		t.Fatalf("event = %s", payload)
	}
}
