package worker

import (
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestFinalizeAssistantUsageFillsMissingTokensAndTiming(t *testing.T) {
	started := time.Now().Add(-1500 * time.Millisecond)
	first := started.Add(400 * time.Millisecond)
	run := &store.AssistantRun{Params: map[string]any{
		"context": map[string]any{"estimatedInputTokens": 3200},
	}}
	usage := finalizeAssistantUsage(sub2api.ChatUsage{}, started, first, run, "你好世界，这是一段中文回答。")
	if usage.PromptTokens != 3200 {
		t.Fatalf("prompt = %d", usage.PromptTokens)
	}
	if usage.CompletionTokens <= 0 || usage.TotalTokens <= usage.PromptTokens {
		t.Fatalf("tokens = %#v", usage)
	}
	if usage.FirstTokenMs < 300 || usage.DurationMs < 1000 {
		t.Fatalf("timing = %#v", usage)
	}
}

func TestChatUsageMapOmitsEmptyFields(t *testing.T) {
	payload := sub2api.ChatUsage{PromptTokens: 12, CompletionTokens: 4, FirstTokenMs: 180, DurationMs: 2200}.Map()
	if payload["inputTokens"] != int64(12) || payload["outputTokens"] != int64(4) {
		t.Fatalf("payload = %#v", payload)
	}
	if payload["firstTokenMs"] != int64(180) || payload["durationMs"] != int64(2200) {
		t.Fatalf("payload = %#v", payload)
	}
	if _, exists := payload["reasoningTokens"]; exists {
		t.Fatalf("empty field leaked: %#v", payload)
	}
}
