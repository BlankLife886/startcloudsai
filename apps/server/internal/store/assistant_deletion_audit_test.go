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

type assistantDeletionFixture struct {
	store            *store.Store
	user             *store.User
	conversation     *store.AssistantConversation
	userMessage      *store.AssistantMessage
	assistantMessage *store.AssistantMessage
	run              *store.AssistantRun
}

func newAssistantDeletionFixture(t *testing.T, workspace string) assistantDeletionFixture {
	t.Helper()
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool,
		fmt.Sprintf("assistant-delete-%s@test.dev", uuid.NewString()[:8]), "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversationWithWorkspace(
		ctx, st.Pool, uuid.New(), user.ID, "删除审计", workspace, now,
	)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "生成两张图片",
		Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	firstKey := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	secondKey := fmt.Sprintf("tasks/%s/assistant/%s/2.png", user.ID, uuid.New())
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image", Status: "complete",
		Metadata: map[string]any{
			"images":   []map[string]any{{"fileKey": firstKey}, {"fileKey": secondKey}},
			"proposal": map[string]any{"images": []map[string]any{{"fileKey": firstKey}}},
		},
		CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "image", Prompt: "生成两张图片", ReservedCents: 9,
		Params: map[string]any{
			"model": "gpt-image-2", "count": 2,
			"referenceImages": []any{map[string]any{"fileKey": "uploads/input.png"}},
			"canvasSnapshot":  map[string]any{"previewKey": "uploads/canvas.png"},
			"_maskKey":        "uploads/mask.png",
			"_maskBaseKey":    "uploads/mask-base.png",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs
		SET status = 'succeeded', resolved_mode = 'image', stage = 'complete',
			cost_cents = 7, started_at = $2, finished_at = $3
		WHERE id = $1`, run.ID, now.Add(time.Second), now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	return assistantDeletionFixture{
		store: st, user: user, conversation: conversation,
		userMessage: userMessage, assistantMessage: assistantMessage, run: run,
	}
}

func assertAssistantRunArchived(t *testing.T, fixture assistantDeletionFixture, wantSource string) *store.Task {
	t.Helper()
	ctx := context.Background()
	run, err := store.GetAssistantRun(ctx, fixture.store.Pool, fixture.run.ID)
	if err != nil || run != nil {
		t.Fatalf("assistant run after user deletion = %#v, err = %v", run, err)
	}
	task, err := store.GetTask(ctx, fixture.store.Pool, fixture.run.ID)
	if err != nil || task == nil {
		t.Fatalf("archived task = %#v, err = %v", task, err)
	}
	if task.Type != store.PromptTaskTypeAssistant || task.Status != "succeeded" ||
		task.CostCents != 7 || task.Count != 2 || task.WorkUnits != 1 {
		t.Fatalf("archived task execution snapshot = %#v", task)
	}
	if task.DeletedAt == nil || task.DeletionActor == nil || *task.DeletionActor != "user" ||
		task.DeletedOutputCount != 2 {
		t.Fatalf("archived task deletion marker = %#v", task)
	}
	if len(task.InputKeys) != 0 || len(task.OutputKeys) != 0 || len(task.ThumbnailKeys) != 0 {
		t.Fatalf("archived task retained object keys: input=%#v output=%#v thumbnails=%#v",
			task.InputKeys, task.OutputKeys, task.ThumbnailKeys)
	}
	for _, key := range []string{"referenceImages", "canvasSnapshot", "_maskKey", "_maskBaseKey"} {
		if _, exists := task.Params[key]; exists {
			t.Fatalf("archived task retained private parameter %q: %#v", key, task.Params)
		}
	}
	if task.Params["_archivedAssistantRun"] != true ||
		task.Params["_source"] != wantSource || task.Params["conversationId"] != fixture.conversation.ID.String() {
		t.Fatalf("archived task params = %#v", task.Params)
	}
	return task
}

func TestAssistantRunAuditSurvivesUserDeletionPaths(t *testing.T) {
	tests := []struct {
		name   string
		delete func(context.Context, assistantDeletionFixture) error
	}{
		{
			name: "conversation",
			delete: func(ctx context.Context, fixture assistantDeletionFixture) error {
				deleted, err := store.DeleteUserAssistantConversation(
					ctx, fixture.store.Pool, fixture.user.ID, fixture.conversation.ID,
				)
				if err == nil && !deleted {
					return fmt.Errorf("conversation was not deleted")
				}
				return err
			},
		},
		{
			name: "turn",
			delete: func(ctx context.Context, fixture assistantDeletionFixture) error {
				return store.DeleteAssistantMessagesFrom(
					ctx, fixture.store.Pool, fixture.conversation.ID, fixture.userMessage.ID,
				)
			},
		},
		{
			name: "messages_after_source",
			delete: func(ctx context.Context, fixture assistantDeletionFixture) error {
				return store.DeleteAssistantMessagesAfter(
					ctx, fixture.store.Pool, fixture.conversation.ID, fixture.userMessage.ID,
				)
			},
		},
		{
			name: "assistant_message",
			delete: func(ctx context.Context, fixture assistantDeletionFixture) error {
				deleted, err := store.DeleteUserAssistantMessage(
					ctx, fixture.store.Pool, fixture.user.ID, fixture.assistantMessage.ID,
				)
				if err == nil && !deleted {
					return fmt.Errorf("assistant message was not deleted")
				}
				return err
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newAssistantDeletionFixture(t, store.PromptTaskTypeAssistant)
			if err := tt.delete(context.Background(), fixture); err != nil {
				t.Fatal(err)
			}
			assertAssistantRunArchived(t, fixture, store.PromptTaskTypeAssistant)
			listed, err := store.ListAdminTasks(
				context.Background(), fixture.store.Pool, store.PromptTaskTypeAssistant,
				"succeeded", "", []uuid.UUID{fixture.user.ID}, 20, nil, "",
			)
			if err != nil || len(listed) != 1 || listed[0].ID != fixture.run.ID {
				t.Fatalf("admin assistant audit tasks = %#v, err = %v", listed, err)
			}
		})
	}
}

func TestCanvasAssistantRunAuditKeepsCanvasFilter(t *testing.T) {
	fixture := newAssistantDeletionFixture(t, store.PromptTaskTypeCanvas)
	deleted, err := store.DeleteUserAssistantConversation(
		context.Background(), fixture.store.Pool, fixture.user.ID, fixture.conversation.ID,
	)
	if err != nil || !deleted {
		t.Fatalf("delete canvas conversation = %v, err = %v", deleted, err)
	}
	assertAssistantRunArchived(t, fixture, store.CanvasTaskSource)
	listed, err := store.ListAdminTasks(
		context.Background(), fixture.store.Pool, "", "succeeded", "",
		[]uuid.UUID{fixture.user.ID}, 20, nil, store.CanvasTaskSource,
	)
	if err != nil || len(listed) != 1 || listed[0].ID != fixture.run.ID {
		t.Fatalf("admin canvas audit tasks = %#v, err = %v", listed, err)
	}
	typeCounts, err := store.TaskTypeCountsSince(
		context.Background(), fixture.store.Pool, time.Now().UTC().Add(-time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	if typeCounts[store.PromptTaskTypeCanvas] != 1 || typeCounts[store.PromptTaskTypeAssistant] != 0 {
		t.Fatalf("dashboard task type counts = %#v", typeCounts)
	}
}

func TestPurgeFinishedAdminTasksClearsArchivedAssistantTask(t *testing.T) {
	fixture := newAssistantDeletionFixture(t, store.PromptTaskTypeAssistant)
	deleted, err := store.DeleteUserAssistantConversation(
		context.Background(), fixture.store.Pool, fixture.user.ID, fixture.conversation.ID,
	)
	if err != nil || !deleted {
		t.Fatalf("delete assistant conversation = %v, err = %v", deleted, err)
	}
	result, err := store.PurgeFinishedAdminTasks(
		context.Background(), fixture.store, store.PromptTaskTypeAssistant,
		"succeeded", "", []uuid.UUID{fixture.user.ID}, "",
	)
	if err != nil || result.Deleted != 1 {
		t.Fatalf("purge archived assistant task = %#v, err = %v", result, err)
	}
	listed, err := store.ListAdminTasks(
		context.Background(), fixture.store.Pool, store.PromptTaskTypeAssistant,
		"succeeded", "", []uuid.UUID{fixture.user.ID}, 20, nil, "",
	)
	if err != nil || len(listed) != 0 {
		t.Fatalf("archived assistant task remained in admin list = %#v, err = %v", listed, err)
	}
}

func TestArchivedAssistantTaskCannotBeRequeued(t *testing.T) {
	fixture := newAssistantDeletionFixture(t, store.PromptTaskTypeAssistant)
	if _, err := fixture.store.Pool.Exec(context.Background(), `UPDATE assistant_runs
		SET status = 'failed', stage = 'failed', error_code = 'upstream_error',
			error_message = 'provider failed'
		WHERE id = $1`, fixture.run.ID); err != nil {
		t.Fatal(err)
	}
	deleted, err := store.DeleteUserAssistantConversation(
		context.Background(), fixture.store.Pool, fixture.user.ID, fixture.conversation.ID,
	)
	if err != nil || !deleted {
		t.Fatalf("delete assistant conversation = %v, err = %v", deleted, err)
	}
	requeued, err := store.RequeueTask(context.Background(), fixture.store.Pool, fixture.run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if requeued {
		t.Fatal("deleted assistant audit task was requeued")
	}
}
