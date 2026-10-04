package assistantreview

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// Prober is what the admin review needs from the worker's agent: its first
// move on a case, with the instructions and tools a real turn gets. The
// server's main wires the worker's implementation in.
type Prober interface {
	Probe(ctx context.Context, client *sub2api.Client, item Case, params map[string]any) (Action, error)
}

// contextTurns is how many earlier messages a review case keeps.
const contextTurns = 6

const (
	contextLineRunes    = 300
	contextSummaryRunes = 80
)

// ContextFrom renders the messages before a user message as the text a
// review case keeps. Images and proposals become one-line summaries and
// failed turns are skipped, so the case still works after the conversation
// is deleted.
func ContextFrom(history []*store.AssistantMessage, userMessageID uuid.UUID) []Message {
	messages := []Message{}
	for _, message := range history {
		if message == nil {
			continue
		}
		if message.ID == userMessageID {
			break
		}
		if message.Status == "failed" || (message.Role != "user" && message.Role != "assistant") {
			continue
		}
		if content := contextLine(message); content != "" {
			messages = append(messages, Message{Role: message.Role, Content: content})
		}
	}
	if len(messages) > contextTurns {
		messages = messages[len(messages)-contextTurns:]
	}
	return messages
}

func contextLine(message *store.AssistantMessage) string {
	if message.Role == "assistant" {
		images, _ := message.Metadata["images"].([]any)
		if len(images) > 0 || (message.Kind == "image" && message.Status == "complete") {
			summary, _ := message.Metadata["prompt"].(string)
			if strings.TrimSpace(summary) == "" {
				summary = message.Content
			}
			return fmt.Sprintf("[生成了 %d 张图片：%s]", max(len(images), 1), truncate(strings.TrimSpace(summary), contextSummaryRunes))
		}
		if message.Kind == "proposal" && message.Status == "complete" {
			proposal, _ := message.Metadata["proposal"].(map[string]any)
			summary, _ := proposal["prompt"].(string)
			if strings.TrimSpace(summary) == "" {
				summary = message.Content
			}
			return "[出了图片方案：" + truncate(strings.TrimSpace(summary), contextSummaryRunes) + "]"
		}
	}
	return truncate(strings.TrimSpace(message.Content), contextLineRunes)
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
