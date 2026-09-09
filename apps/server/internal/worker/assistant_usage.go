package worker

import (
	"strings"
	"time"
	"unicode"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func estimateAssistantTokens(text string) int64 {
	ascii, other := 0, 0
	for _, r := range text {
		if r <= unicode.MaxASCII {
			ascii++
		} else {
			other++
		}
	}
	tokens := int64(ascii/4 + other)
	if tokens == 0 && strings.TrimSpace(text) != "" {
		return 1
	}
	return tokens
}

func assistantContextInputTokens(run *store.AssistantRun) int64 {
	if run == nil {
		return 0
	}
	context, _ := run.Params["context"].(map[string]any)
	return int64(assistantMapInt(context, "estimatedInputTokens"))
}

func finalizeAssistantUsage(usage sub2api.ChatUsage, started, firstVisible time.Time, run *store.AssistantRun, output string) sub2api.ChatUsage {
	if usage.PromptTokens <= 0 {
		usage.PromptTokens = assistantContextInputTokens(run)
	}
	if usage.CompletionTokens <= 0 {
		usage.CompletionTokens = estimateAssistantTokens(output)
	}
	if usage.TotalTokens <= 0 {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	if !started.IsZero() {
		elapsed := time.Since(started).Milliseconds()
		if elapsed <= 0 {
			elapsed = 1
		}
		usage.DurationMs = elapsed
	}
	if !firstVisible.IsZero() && !started.IsZero() {
		elapsed := firstVisible.Sub(started).Milliseconds()
		if elapsed <= 0 {
			elapsed = 1
		}
		usage.FirstTokenMs = elapsed
	}
	return usage
}

func attachAssistantUsage(metadata map[string]any, usage sub2api.ChatUsage) {
	if metadata == nil {
		return
	}
	payload := usage.Map()
	if len(payload) == 0 {
		return
	}
	metadata["usage"] = payload
}

func attachAssistantReasoning(metadata map[string]any, reasoning string) {
	if metadata == nil {
		return
	}
	if value := strings.TrimSpace(reasoning); value != "" {
		metadata["reasoning"] = value
	}
}

func assistantUsageFromStartedAt(run *store.AssistantRun) sub2api.ChatUsage {
	if run == nil || run.StartedAt == nil || run.StartedAt.IsZero() {
		return sub2api.ChatUsage{}
	}
	elapsed := time.Since(*run.StartedAt).Milliseconds()
	if elapsed <= 0 {
		return sub2api.ChatUsage{}
	}
	return sub2api.ChatUsage{DurationMs: elapsed}
}

func markAssistantFirstToken(firstVisible *time.Time, text string) {
	if firstVisible == nil || !firstVisible.IsZero() || strings.TrimSpace(text) == "" {
		return
	}
	*firstVisible = time.Now()
}
