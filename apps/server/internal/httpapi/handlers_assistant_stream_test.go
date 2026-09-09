package httpapi

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAssistantPendingToolEventReplaysMetadata(t *testing.T) {
	message := &store.AssistantMessage{Status: "running", Metadata: map[string]any{
		"pendingTool": map[string]any{
			"requestId": "request-1",
			"name":      "canvas_apply_ops",
			"arguments": `{"summary":"整理","ops":[]}`,
			"stage":     "tool",
		},
	}}
	event, ok := assistantPendingToolEvent(message)
	if !ok || event.Tool == nil {
		t.Fatal("expected a replayable pending tool")
	}
	if event.Stage != "tool" || event.Tool.RequestID != "request-1" || event.Tool.Name != "canvas_apply_ops" {
		t.Fatalf("event = %#v", event)
	}
	if got := assistantPendingToolRequestID(message); got != "request-1" {
		t.Fatalf("request id = %q", got)
	}
	message.Metadata["pendingTool"].(map[string]any)["claimedBy"] = "browser-a"
	if got := assistantPendingToolClaimedBy(message); got != "browser-a" {
		t.Fatalf("claimed by = %q", got)
	}
}

func TestAssistantPendingToolEventReplaysServerToolLifecycle(t *testing.T) {
	message := &store.AssistantMessage{Status: "running", Metadata: map[string]any{
		"pendingTool": map[string]any{
			"requestId": "web-1", "name": "web_search", "arguments": `{"query":"latest"}`,
			"stage": "web_search", "execution": "server", "status": "running",
		},
	}}
	event, ok := assistantPendingToolEvent(message)
	if !ok || event.Tool == nil || event.Stage != "web_search" || event.Tool.Execution != "server" || event.Tool.Status != "running" {
		t.Fatalf("event = %#v", event)
	}
}

func TestAssistantPendingToolEventIgnoresClearedOrMalformedMetadata(t *testing.T) {
	for _, metadata := range []map[string]any{
		nil,
		{"pendingTool": nil},
		{"pendingTool": map[string]any{"requestId": "request-1"}},
		{"pendingTool": map[string]any{"name": "canvas_get_state"}},
	} {
		if event, ok := assistantPendingToolEvent(&store.AssistantMessage{Status: "running", Metadata: metadata}); ok {
			t.Fatalf("unexpected event: %#v", event)
		}
	}
}

func TestAssistantPendingToolEventNeverReplaysAfterTerminalStatus(t *testing.T) {
	metadata := map[string]any{"pendingTool": map[string]any{
		"requestId": "request-1", "name": "canvas_apply_ops", "arguments": `{"ops":[]}`, "stage": "tool",
	}}
	for _, status := range []string{"complete", "failed", "stopped"} {
		if event, ok := assistantPendingToolEvent(&store.AssistantMessage{Status: status, Metadata: metadata}); ok {
			t.Fatalf("terminal status %q replayed %#v", status, event)
		}
	}
}
