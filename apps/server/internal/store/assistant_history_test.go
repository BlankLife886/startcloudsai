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

func insertAssistantImageHistoryRun(t *testing.T, st *store.Store, user *store.User) (*store.AssistantRun, string) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversationWithWorkspace(
		ctx, st.Pool, uuid.New(), user.ID, "商品海报", "assistant", now,
	)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user",
		Content: "生成一张商品海报", Kind: "text", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	outputKey := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant",
		Kind: "image", Status: "complete", CreatedAt: now.Add(time.Millisecond),
		Metadata: map[string]any{
			"images": []map[string]any{{"fileKey": outputKey}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "image", Prompt: "生成一张商品海报",
		Params: map[string]any{
			"count": float64(1), "model": "image-model",
			"referenceImages": []any{map[string]any{
				"fileKey": fmt.Sprintf("uploads/%s/original/reference.png", user.ID),
			}},
		},
		ReservedCents: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	finished := now.Add(time.Second)
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET status = 'succeeded', resolved_mode = 'image',
		stage = 'complete', cost_cents = 10, started_at = $2, finished_at = $3 WHERE id = $1`,
		run.ID, now, finished); err != nil {
		t.Fatal(err)
	}
	completed, err := store.GetAssistantRun(ctx, st.Pool, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	return completed, outputKey
}

func TestListTasksIncludesAssistantImageHistory(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(
		ctx, st.Pool, fmt.Sprintf("assistant-history-%s@test.dev", uuid.NewString()[:8]),
		"tester", "x", "user", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	run, outputKey := insertAssistantImageHistoryRun(t, st, user)

	listed, err := store.ListTasks(ctx, st.Pool, &user.ID, store.PromptTaskTypeAssistant, "", nil, 10, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		t.Fatalf("assistant history = %#v", listed)
	}
	item := listed[0]
	if item.ID != run.ID || item.Type != store.PromptTaskTypeAssistant || item.Prompt != run.Prompt {
		t.Fatalf("assistant history item = %#v", item)
	}
	if len(item.OutputKeys) != 1 || item.OutputKeys[0] != outputKey {
		t.Fatalf("assistant history outputs = %#v", item.OutputKeys)
	}
	if item.Params["conversationId"] != run.ConversationID.String() ||
		item.Params["assistantMessageId"] != run.AssistantMessageID.String() {
		t.Fatalf("assistant history params = %#v", item.Params)
	}

	got, err := store.GetUserTask(ctx, st.Pool, user.ID, run.ID)
	if err != nil || got != nil {
		t.Fatalf("virtual assistant history must not impersonate a persisted task: %#v err=%v", got, err)
	}
}

func TestAssistantPublishedHistoryIsRemappedWithoutDuplicate(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(
		ctx, st.Pool, fmt.Sprintf("assistant-published-%s@test.dev", uuid.NewString()[:8]),
		"tester", "x", "user", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	run, _ := insertAssistantImageHistoryRun(t, st, user)
	if _, err := store.EnsureAssistantGalleryTask(ctx, st.Pool, run); err != nil {
		t.Fatal(err)
	}

	listed, err := store.ListTasks(ctx, st.Pool, &user.ID, store.PromptTaskTypeAssistant, "", nil, 10, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != run.ID || listed[0].Type != store.PromptTaskTypeAssistant {
		t.Fatalf("published assistant history = %#v", listed)
	}
	all, err := store.ListTasks(ctx, st.Pool, &user.ID, "", "", nil, 10, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("published assistant history duplicated = %#v", all)
	}
}
