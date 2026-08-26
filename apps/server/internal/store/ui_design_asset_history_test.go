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

func insertUIDesignAssetRun(t *testing.T, st *store.Store, user *store.User, inputKey, outputKey string) (*store.AssistantConversation, *store.AssistantRun) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversationWithWorkspace(ctx, st.Pool, uuid.New(), user.ID, "图片编辑", "ui_design", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "美化图标",
		Kind: "text", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image",
		Status: "queued", Metadata: map[string]any{"images": []map[string]any{{"fileKey": outputKey}}},
		CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "image", Prompt: "透明背景，1:1",
		Params: map[string]any{
			"serviceKey":      "ui_design_asset",
			"quality":         "high",
			"count":           float64(1),
			"parentOutputUrl": "/api/v1/files/tasks/parent.png",
			"referenceImages": []any{
				map[string]any{"fileKey": inputKey},
			},
		},
		ReservedCents: 12,
	})
	if err != nil {
		t.Fatal(err)
	}
	return conversation, run
}

func TestUIDesignAssetHistoryPersistsRunningThenSucceeded(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("ui-asset-%s@test.dev", uuid.NewString()[:8]), "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	outputKey := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	inputKey := fmt.Sprintf("uploads/%s/original/region.png", user.ID)
	conversation, run := insertUIDesignAssetRun(t, st, user, inputKey, outputKey)

	ignored, created, err := store.SyncUIDesignAssetHistoryFromRun(ctx, st.Pool, &store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, Status: "queued", Prompt: "chat only",
		Params: map[string]any{"serviceKey": "ui_design_analysis"},
	}, nil)
	if err != nil || created || ignored != nil {
		t.Fatalf("analysis run persisted = %#v created=%v err=%v", ignored, created, err)
	}

	running, created, err := store.SyncUIDesignAssetHistoryFromRun(ctx, st.Pool, run, nil)
	if err != nil || !created || running == nil {
		t.Fatalf("persist running history = %#v created=%v err=%v", running, created, err)
	}
	if running.Type != "ui_design" || running.Status != "running" {
		t.Fatalf("running history = %#v", running)
	}
	if kind, _ := running.Params["_kind"].(string); kind != store.UIDesignRegionEditKind {
		t.Fatalf("kind = %#v", running.Params)
	}
	if parent, _ := running.Params["parentOutputUrl"].(string); parent != "/api/v1/files/tasks/parent.png" {
		t.Fatalf("parentOutputUrl = %#v", running.Params["parentOutputUrl"])
	}
	run.Params["_serviceProvider"] = "c2a"
	run.Params["_imageProviderDisplayName"] = "Enabled Provider"
	run.Params["_imageProviderRouteKey"] = "provider/enabled-route"
	run.Params["_imageProviderEndpoint"] = "https://enabled.example.com/v1"
	updatedRunning, created, err := store.SyncUIDesignAssetHistoryFromRun(ctx, st.Pool, run, nil)
	if err != nil || created || updatedRunning == nil {
		t.Fatalf("update running route snapshot = %#v created=%v err=%v", updatedRunning, created, err)
	}
	if updatedRunning.Params["_imageProviderEndpoint"] != "https://enabled.example.com/v1" ||
		updatedRunning.Params["_imageProviderRouteKey"] != "provider/enabled-route" {
		t.Fatalf("history route snapshot = %#v", updatedRunning.Params)
	}

	listedRunning, err := store.ListTasks(ctx, st.Pool, &user.ID, "ui_design", "running", nil, 10, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listedRunning) != 1 || listedRunning[0].ID != running.ID {
		t.Fatalf("running user history = %#v", listedRunning)
	}
	active, err := store.CountActiveTasks(ctx, st.Pool, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if active != 0 {
		t.Fatalf("history mirror counted as active task: %d", active)
	}
	requeued, err := store.RequeueExpiredRunningTasks(ctx, st.Pool, time.Now().UTC().Add(31*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range requeued {
		if id == running.ID {
			t.Fatalf("history mirror requeued as a generation task: %#v", requeued)
		}
	}

	run.Status = "succeeded"
	run.CostCents = 12
	finished := time.Now().UTC()
	run.FinishedAt = &finished
	task, created, err := store.SyncUIDesignAssetHistoryFromRun(ctx, st.Pool, run, []string{outputKey})
	if err != nil || created || task == nil {
		t.Fatalf("complete history task = %#v created=%v err=%v", task, created, err)
	}
	if task.ID != running.ID || task.Status != "succeeded" || task.CostCents != 12 {
		t.Fatalf("completed history = %#v", task)
	}
	if len(task.OutputKeys) != 1 || task.OutputKeys[0] != outputKey {
		t.Fatalf("output keys = %#v", task.OutputKeys)
	}

	again, created, err := store.SyncUIDesignAssetHistoryFromRun(ctx, st.Pool, run, []string{outputKey})
	if err != nil || created || again == nil || again.ID != task.ID {
		t.Fatalf("idempotent complete = %#v created=%v err=%v", again, created, err)
	}

	listed, err := store.ListTasks(ctx, st.Pool, &user.ID, "ui_design", "succeeded", nil, 10, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != task.ID {
		t.Fatalf("user history = %#v", listed)
	}

	if _, err := store.DeleteUserAssistantConversation(ctx, st.Pool, user.ID, conversation.ID); err != nil {
		t.Fatal(err)
	}
	locked, err := store.LockReadyObjectCleanupJobs(ctx, st.Pool, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range locked {
		if key == outputKey {
			t.Fatalf("history output queued for cleanup after conversation delete: %#v", locked)
		}
	}
	remaining, err := store.GetTask(ctx, st.Pool, task.ID)
	if err != nil || remaining == nil || remaining.Status != "succeeded" {
		t.Fatalf("history task after conversation delete = %#v err=%v", remaining, err)
	}
}

func TestListTasksIncludesUIDesignAssetAssistantRuns(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("ui-asset-list-%s@test.dev", uuid.NewString()[:8]), "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	outputKey := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	inputKey := fmt.Sprintf("uploads/%s/original/region.png", user.ID)
	_, run := insertUIDesignAssetRun(t, st, user, inputKey, outputKey)

	listed, err := store.ListTasks(ctx, st.Pool, &user.ID, "ui_design", "", nil, 10, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != run.ID || listed[0].Type != "ui_design" {
		t.Fatalf("history list without persist = %#v", listed)
	}
	got, err := store.GetUserTask(ctx, st.Pool, user.ID, run.ID)
	if err != nil || got == nil || got.Type != "ui_design" {
		t.Fatalf("get user history run = %#v err=%v", got, err)
	}
}

func TestListAdminTasksHidesMirroredUIDesignAssetRuns(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("ui-asset-admin-%s@test.dev", uuid.NewString()[:8]), "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	outputKey := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	inputKey := fmt.Sprintf("uploads/%s/original/region.png", user.ID)
	_, run := insertUIDesignAssetRun(t, st, user, inputKey, outputKey)
	if _, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, st.Pool, run, []string{outputKey}); err != nil {
		t.Fatal(err)
	}

	listed, err := store.ListAdminTasks(ctx, st.Pool, "", "", "", []uuid.UUID{user.ID}, 20, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		t.Fatalf("admin list after persist = %#v", listed)
	}
	if listed[0].Type != "ui_design" || listed[0].ID == run.ID {
		t.Fatalf("admin should keep the UI 设计稿 row only: %#v", listed[0])
	}
}

func TestUIDesignAssetHistoryMarksFailedRun(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("ui-asset-fail-%s@test.dev", uuid.NewString()[:8]), "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	outputKey := fmt.Sprintf("tasks/%s/assistant/%s/1.png", user.ID, uuid.New())
	inputKey := fmt.Sprintf("uploads/%s/original/region.png", user.ID)
	_, run := insertUIDesignAssetRun(t, st, user, inputKey, outputKey)
	if _, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, st.Pool, run, nil); err != nil {
		t.Fatal(err)
	}
	code := "assistant_run_failed"
	message := "上游失败"
	run.Status = "failed"
	run.ErrorCode = &code
	run.ErrorMessage = &message
	task, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, st.Pool, run, nil)
	if err != nil || task == nil || task.Status != "failed" {
		t.Fatalf("failed history = %#v err=%v", task, err)
	}
	if task.ErrorCode == nil || *task.ErrorCode != code {
		t.Fatalf("failed history error = %#v", task.ErrorCode)
	}
}
