package httpapi

import (
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAssistantRegenerateVersionsKeepsTheLatestFour(t *testing.T) {
	if versions, keys := assistantRegenerateVersions(&store.AssistantMessage{Status: "failed"}); versions != nil || keys != nil {
		t.Fatal("a failed reply is not kept")
	}
	older := []any{}
	for index := 0; index < 4; index++ {
		older = append(older, map[string]any{"content": "旧", "metadata": map[string]any{
			"images": []any{map[string]any{"fileKey": "tasks/u/old-" + string(rune('a'+index)) + ".png"}},
		}})
	}
	previous := &store.AssistantMessage{ID: uuid.New(), Status: "complete", Content: "第五版", Kind: "image", Metadata: map[string]any{
		"previousVersions": older, "feedback": "negative", "pending": false,
		"images": []any{map[string]any{"fileKey": "tasks/u/latest.png"}},
	}}
	versions, keys := assistantRegenerateVersions(previous)
	if len(versions) != assistantMaxPreviousVersions {
		t.Fatalf("versions = %d", len(versions))
	}
	last := versions[len(versions)-1].(map[string]any)
	metadata := last["metadata"].(map[string]any)
	if last["content"] != "第五版" || metadata["feedback"] != nil || metadata["previousVersions"] != nil {
		t.Fatalf("snapshot = %#v", last)
	}
	want := map[string]bool{"tasks/u/old-b.png": true, "tasks/u/old-c.png": true, "tasks/u/old-d.png": true, "tasks/u/latest.png": true}
	if len(keys) != len(want) {
		t.Fatalf("keys = %v", keys)
	}
	for _, key := range keys {
		if !want[key] {
			t.Fatalf("unexpected kept key %s (oldest version should be dropped)", key)
		}
	}
}
