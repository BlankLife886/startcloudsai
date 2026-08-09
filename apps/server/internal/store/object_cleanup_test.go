package store_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestObjectCleanupJobsWaitForReferences(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("cleanup-%s@test.dev", uuid.NewString()[:8]), "cleanup", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	taskID := uuid.New()
	key := fmt.Sprintf("tasks/%s/%s/original/0.png", user.ID, taskID)
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO tasks (id, user_id, type, status, prompt, output_keys, cost_cents)
		VALUES ($1, $2, 't2i', 'failed', 'cleanup', jsonb_build_array($3::text), 0)`, taskID, user.ID, key); err != nil {
		t.Fatal(err)
	}
	if err := store.EnqueueObjectCleanup(ctx, st.Pool, []string{key, key}); err != nil {
		t.Fatal(err)
	}
	locked, err := store.LockReadyObjectCleanupJobs(ctx, st.Pool, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(locked) != 0 {
		t.Fatalf("referenced cleanup jobs = %#v, want none", locked)
	}

	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET output_keys = '[]'::jsonb WHERE id = $1`, taskID); err != nil {
		t.Fatal(err)
	}
	locked, err = store.LockReadyObjectCleanupJobs(ctx, st.Pool, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(locked) != 1 || locked[0] != key {
		t.Fatalf("unreferenced cleanup jobs = %#v, want [%q]", locked, key)
	}
	if _, err := store.DeleteObjectCleanupJobs(ctx, st.Pool, locked); err != nil {
		t.Fatal(err)
	}
}

func TestEnqueueObjectCleanupRejectsNonTaskKeys(t *testing.T) {
	st := testdb.Setup(t)
	if err := store.EnqueueObjectCleanup(context.Background(), st.Pool, []string{"uploads/user/original/image.png"}); err == nil {
		t.Fatal("upload key unexpectedly accepted by task cleanup queue")
	}
}

func TestPartialOutputCleanupCommitsReferenceRemovalWithJob(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("partial-cleanup-%s@test.dev", uuid.NewString()[:8]), "cleanup", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	taskID := uuid.New()
	outputKey := fmt.Sprintf("tasks/%s/%s/original/0.png", user.ID, taskID)
	thumbnailKey := fmt.Sprintf("tasks/%s/%s/thumb/0.jpg", user.ID, taskID)
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO tasks (id, user_id, type, status, prompt, output_keys, thumbnail_keys, cost_cents)
		VALUES ($1, $2, 't2i', 'running', 'partial cleanup', jsonb_build_array($3::text), jsonb_build_array($4::text), 0)`,
		taskID, user.ID, outputKey, thumbnailKey); err != nil {
		t.Fatal(err)
	}

	if err := store.ClearTaskPartialOutputsAndEnqueueCleanup(ctx, st, taskID,
		[]string{}, []string{}, []string{outputKey, thumbnailKey}, "", ""); err != nil {
		t.Fatalf("clear partial outputs: %v", err)
	}
	var outputKeys, thumbnailKeys []string
	if err := st.Pool.QueryRow(ctx, `SELECT output_keys, thumbnail_keys FROM tasks WHERE id = $1`, taskID).
		Scan(&outputKeys, &thumbnailKeys); err != nil {
		t.Fatal(err)
	}
	if len(outputKeys) != 0 || len(thumbnailKeys) != 0 {
		t.Fatalf("partial output references = %#v / %#v, want empty", outputKeys, thumbnailKeys)
	}
	locked, err := store.LockReadyObjectCleanupJobs(ctx, st.Pool, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(locked) != 2 || !containsCleanupKey(locked, outputKey) || !containsCleanupKey(locked, thumbnailKey) {
		t.Fatalf("cleanup candidates = %#v, want both output keys", locked)
	}
}

func TestAssistantOutputCleanupCommitsMetadataRemovalWithJob(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("assistant-cleanup-%s@test.dev", uuid.NewString()[:8]), "cleanup", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "助手清理", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	messageID := uuid.New()
	key := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	if _, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: messageID, ConversationID: conversation.ID, Role: "assistant", Kind: "image", Status: "complete",
		Metadata: map[string]any{"images": []map[string]any{{"fileKey": key}}}, CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}

	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		return store.ClearAssistantMessageOutputMetadata(ctx, tx, user.ID, messageID,
			"生成失败", "image", "failed", map[string]any{"statusStage": "failed"})
	}); err != nil {
		t.Fatalf("clear assistant output metadata: %v", err)
	}
	var hasImages bool
	if err := st.Pool.QueryRow(ctx,
		`SELECT metadata ? 'images' FROM assistant_messages WHERE id = $1`, messageID).Scan(&hasImages); err != nil {
		t.Fatal(err)
	}
	if hasImages {
		t.Fatal("assistant output metadata still contains images")
	}
	locked, err := store.LockReadyObjectCleanupJobs(ctx, st.Pool, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(locked) != 1 || locked[0] != key {
		t.Fatalf("assistant cleanup candidates = %#v, want [%q]", locked, key)
	}
}

func containsCleanupKey(keys []string, want string) bool {
	for _, key := range keys {
		if key == want {
			return true
		}
	}
	return false
}
