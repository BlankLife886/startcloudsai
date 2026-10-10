package store_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// Regenerate keeps the replaced reply as an earlier version: its images must
// survive the delete, count as the message's outputs (so deleting the new
// reply later cleans them), and the worker's later metadata writes must not
// drop the versions.
func TestRegenerateKeepsEarlierVersionImages(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("versions-%s@test.dev", uuid.NewString()[:8]), "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversationWithWorkspace(ctx, st.Pool, uuid.New(), user.ID, "版本", "assistant", now)
	if err != nil {
		t.Fatal(err)
	}
	question, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "画一只猫", Kind: "chat", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	keptKey := "tasks/" + user.ID.String() + "/assistant/old/1.png"
	droppedKey := "tasks/" + user.ID.String() + "/assistant/old/2.png"
	reply, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Content: "图片已生成", Kind: "image", CreatedAt: now.Add(time.Second),
		Metadata: map[string]any{"images": []any{map[string]any{"fileKey": keptKey}, map[string]any{"fileKey": droppedKey}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	found, err := store.GetAssistantReplyAfter(ctx, st.Pool, conversation.ID, question.ID)
	if err != nil || found == nil || found.ID != reply.ID {
		t.Fatalf("reply after question = %v, %v", found, err)
	}

	if err := store.DeleteAssistantMessagesAfterKeeping(ctx, st.Pool, conversation.ID, question.ID, []string{keptKey}); err != nil {
		t.Fatal(err)
	}
	var queued []string
	rows, err := st.Pool.Query(ctx, `SELECT object_key FROM object_cleanup_jobs WHERE object_key LIKE $1`, "tasks/"+user.ID.String()+"/%")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			t.Fatal(err)
		}
		queued = append(queued, key)
	}
	rows.Close()
	for _, key := range queued {
		if key == keptKey {
			t.Fatalf("kept image was queued for cleanup: %v", queued)
		}
	}
	if len(queued) == 0 {
		t.Fatalf("the dropped image should be cleaned up")
	}

	next, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image", Status: "queued", CreatedAt: now.Add(2 * time.Second),
		Metadata: map[string]any{"previousVersions": []any{map[string]any{"id": reply.ID.String(), "content": "图片已生成",
			"metadata": map[string]any{"images": []any{map[string]any{"fileKey": keptKey}}}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateAssistantMessage(ctx, st.Pool, next.ID, "新图", "image", "complete", map[string]any{"pending": false}); err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetAssistantMessage(ctx, st.Pool, next.ID)
	if err != nil || updated == nil {
		t.Fatal(err)
	}
	if versions, _ := updated.Metadata["previousVersions"].([]any); len(versions) != 1 {
		t.Fatalf("worker update dropped the versions: %#v", updated.Metadata)
	}
	keys, err := store.ListUserAssistantMessageOutputKeys(ctx, st.Pool, user.ID, next.ID)
	if err != nil {
		t.Fatal(err)
	}
	hasKept := false
	for _, key := range keys {
		hasKept = hasKept || key == keptKey
	}
	if !hasKept {
		t.Fatalf("earlier version images must belong to the new reply: %v", keys)
	}
}
