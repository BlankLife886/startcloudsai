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

func TestTaskPerformanceQueriesHandleEmptyDatabase(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	since := time.Now().UTC().Add(-24 * time.Hour)

	summary, err := store.GetTaskPerformanceSummary(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Created != 0 || summary.QueuedNow != 0 || summary.P95EndToEndMs != 0 {
		t.Fatalf("unexpected empty summary: %#v", summary)
	}

	providers, err := store.TaskProviderPerformanceSince(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	if len(providers) != 0 {
		t.Fatalf("expected no provider rows, got %#v", providers)
	}

	daily, err := store.TaskDailySince(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != 0 {
		t.Fatalf("expected no daily rows, got %#v", daily)
	}

	types, err := store.TaskTypeCountsSince(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	if len(types) != 0 {
		t.Fatalf("expected no type rows, got %#v", types)
	}
}

func TestTaskPerformanceQueriesIncludeAssistantWorkspaceRuns(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	since := now.Add(-24 * time.Hour)
	user, err := store.InsertUser(
		ctx, st.Pool, fmt.Sprintf("dash-work-%s@test.dev", uuid.NewString()[:8]), "dash-work", "x", "user", nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	insertPerfTask(t, st, user.ID, now.Add(-2*time.Hour), "succeeded", "t2i", map[string]any{
		"_providerDisplayName": "图片线路",
	})
	insertPerfTask(t, st, user.ID, now.Add(-90*time.Minute), "queued", "t2i", map[string]any{
		"_providerDisplayName": "图片线路",
	})
	insertPerfTask(t, st, user.ID, now.Add(-80*time.Minute), "succeeded", "t2i", map[string]any{
		"_historyMirror": true, "_providerDisplayName": "镜像线路",
	})

	insertPerfAssistantRun(t, st, user.ID, "assistant", now.Add(-70*time.Minute), "succeeded", map[string]any{
		"_chatProviderDisplayName": "助手线路",
	})
	insertPerfAssistantRun(t, st, user.ID, "infinite_canvas", now.Add(-40*time.Minute), "running", map[string]any{
		"_imageProviderDisplayName": "画布线路",
	})
	insertPerfAssistantRun(t, st, user.ID, "assistant", now.Add(-10*time.Minute), "queued", map[string]any{
		"_chatProviderDisplayName": "助手线路",
	})

	uiRun := insertPerfAssistantRun(t, st, user.ID, "ui_design", now.Add(-30*time.Minute), "succeeded", map[string]any{
		"_imageProviderDisplayName": "设计线路",
	})
	idem := store.UIDesignAssetHistoryIdempotencyKey(uiRun.ID)
	insertPerfTask(t, st, user.ID, now.Add(-29*time.Minute), "succeeded", "ui_design", map[string]any{
		"_providerDisplayName": "设计线路",
	}, &idem)

	summary, err := store.GetTaskPerformanceSummary(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Created != 6 || summary.Succeeded != 3 || summary.QueuedNow != 2 || summary.RunningNow != 1 {
		t.Fatalf("performance = %#v", summary)
	}

	daily, err := store.TaskDailySince(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	row := daily[now.Format("2006-01-02")]
	if row.Total != 6 || row.Succeeded != 3 {
		t.Fatalf("daily = %#v", daily)
	}

	types, err := store.TaskTypeCountsSince(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	if types["t2i"] != 2 || types["assistant"] != 2 || types["infinite_canvas"] != 1 || types["ui_design"] != 1 {
		t.Fatalf("types = %#v", types)
	}

	providers, err := store.TaskProviderPerformanceSince(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	byProvider := map[string]store.ProviderPerformanceRow{}
	for _, item := range providers {
		byProvider[item.Provider] = item
	}
	if byProvider["图片线路"].Total != 2 || byProvider["助手线路"].Total != 2 ||
		byProvider["画布线路"].Total != 1 || byProvider["设计线路"].Total != 1 ||
		byProvider["镜像线路"].Total != 0 {
		t.Fatalf("providers = %#v", providers)
	}
}

func insertPerfTask(
	t *testing.T,
	st *store.Store,
	userID uuid.UUID,
	createdAt time.Time,
	status, taskType string,
	params map[string]any,
	idempotencyKey ...*string,
) *store.Task {
	t.Helper()
	if params == nil {
		params = map[string]any{}
	}
	var key *string
	if len(idempotencyKey) > 0 {
		key = idempotencyKey[0]
	}
	task, err := store.InsertTask(context.Background(), st.Pool, store.NewTask{
		ID: uuid.New(), UserID: userID, Type: taskType, Model: "image-model", Prompt: "dashboard",
		Params: params, Count: 1, CostCents: 10, WorkUnits: 1, IdempotencyKey: key,
	})
	if err != nil {
		t.Fatal(err)
	}
	startedAt := createdAt.Add(time.Second)
	finishedAt := createdAt.Add(2 * time.Second)
	switch status {
	case "queued":
		if _, err := st.Pool.Exec(context.Background(), `UPDATE tasks SET created_at = $2 WHERE id = $1`, task.ID, createdAt); err != nil {
			t.Fatal(err)
		}
	case "running":
		if _, err := st.Pool.Exec(context.Background(), `UPDATE tasks
			SET status = 'running', created_at = $2, started_at = $3 WHERE id = $1`, task.ID, createdAt, startedAt); err != nil {
			t.Fatal(err)
		}
	default:
		if _, err := st.Pool.Exec(context.Background(), `UPDATE tasks
			SET status = $2, created_at = $3, started_at = $4, finished_at = $5 WHERE id = $1`,
			task.ID, status, createdAt, startedAt, finishedAt); err != nil {
			t.Fatal(err)
		}
	}
	return task
}

func insertPerfAssistantRun(
	t *testing.T,
	st *store.Store,
	userID uuid.UUID,
	workspace string,
	createdAt time.Time,
	status string,
	params map[string]any,
) *store.AssistantRun {
	t.Helper()
	ctx := context.Background()
	if params == nil {
		params = map[string]any{}
	}
	conversation, err := store.InsertAssistantConversationWithWorkspace(
		ctx, st.Pool, uuid.New(), userID, workspace+" dash", workspace, createdAt.Add(-time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "dashboard",
		Kind: "text", Status: "complete", CreatedAt: createdAt.Add(-time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "chat", Status: "queued",
		Content: "", CreatedAt: createdAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: userID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "chat", Prompt: "dashboard", Params: params,
	})
	if err != nil {
		t.Fatal(err)
	}
	startedAt := createdAt.Add(time.Second)
	finishedAt := createdAt.Add(2 * time.Second)
	switch status {
	case "queued":
		if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET created_at = $2 WHERE id = $1`, run.ID, createdAt); err != nil {
			t.Fatal(err)
		}
	case "running":
		if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs
			SET status = 'running', created_at = $2, started_at = $3 WHERE id = $1`, run.ID, createdAt, startedAt); err != nil {
			t.Fatal(err)
		}
	default:
		if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs
			SET status = $2, resolved_mode = 'chat', created_at = $3, started_at = $4, finished_at = $5 WHERE id = $1`,
			run.ID, status, createdAt, startedAt, finishedAt); err != nil {
			t.Fatal(err)
		}
	}
	return run
}
