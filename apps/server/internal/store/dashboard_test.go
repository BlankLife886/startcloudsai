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

func TestGetDashboardUsageMetrics(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(
		ctx, st.Pool, fmt.Sprintf("dashboard-%s@test.dev", uuid.NewString()[:8]), "dashboard", "x", "user", nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	todayStart := time.Date(2026, 8, 28, 0, 0, 0, 0, shanghai).UTC()
	last7DaysStart := todayStart.AddDate(0, 0, -6)
	last30DaysStart := todayStart.AddDate(0, 0, -29)

	todayTask := insertDashboardTask(t, st, user.ID, todayStart.Add(time.Hour), 25, 2, 1, false)
	insertDashboardSpend(t, st, user.ID, "task", todayTask.ID.String(), todayStart.Add(2*time.Hour), "任务结算：消耗冻结 25 分")

	// History mirrors display the assistant output elsewhere but must not add a
	// second delivered image to dashboard totals.
	insertDashboardTask(t, st, user.ID, todayStart.Add(3*time.Hour), 25, 1, 0, true)

	todayRun := insertDashboardAssistantRun(t, st, user.ID, todayStart.Add(4*time.Hour), 40, []string{"assistant/a.png", "assistant/a.png", "assistant/b.png"}, map[string]any{
		"inputTokens": 120, "outputTokens": 48, "reasoningTokens": 12, "totalTokens": 180,
	})
	insertDashboardSpend(t, st, user.ID, "assistant_run", todayRun.ID.String()+"/2", todayStart.Add(4*time.Hour), "AI 助手结算（image）")

	previousDayRun := insertDashboardAssistantRun(
		t, st, user.ID, todayStart.Add(-time.Minute), 10, []string{"assistant/yesterday.png"},
		map[string]any{"inputTokens": 8, "outputTokens": 2, "totalTokens": 10},
	)
	insertDashboardSpend(t, st, user.ID, "assistant_run", previousDayRun.ID.String(), todayStart.Add(-time.Minute), "AI 助手结算（image）")

	olderTask := insertDashboardTask(t, st, user.ID, todayStart.AddDate(0, 0, -10), 15, 1, 0, false)
	insertDashboardSpend(t, st, user.ID, "task", olderTask.ID.String(), todayStart.AddDate(0, 0, -10), "任务结算：消耗冻结 15 分")

	outsideTask := insertDashboardTask(t, st, user.ID, last30DaysStart.Add(-time.Second), 99, 4, 0, false)
	insertDashboardSpend(t, st, user.ID, "task", outsideTask.ID.String(), last30DaysStart.Add(-time.Second), "任务结算：消耗冻结 99 分")

	metrics, err := store.GetDashboardUsageMetrics(ctx, st.Pool, todayStart, last7DaysStart, last30DaysStart)
	if err != nil {
		t.Fatal(err)
	}
	if metrics.Today.SettledCents != 65 || metrics.Today.ImageCount != 5 {
		t.Fatalf("today = %#v", metrics.Today)
	}
	if metrics.Last7Days.SettledCents != 75 || metrics.Last7Days.ImageCount != 6 {
		t.Fatalf("last 7 days = %#v", metrics.Last7Days)
	}
	if metrics.Last30Days.SettledCents != 90 || metrics.Last30Days.ImageCount != 7 {
		t.Fatalf("last 30 days = %#v", metrics.Last30Days)
	}
	if metrics.TodayToken.InputTokens != 120 || metrics.TodayToken.OutputTokens != 48 ||
		metrics.TodayToken.ReasoningTokens != 12 || metrics.TodayToken.TotalTokens != 180 {
		t.Fatalf("today token = %#v", metrics.TodayToken)
	}
}

func insertDashboardTask(
	t *testing.T,
	st *store.Store,
	userID uuid.UUID,
	finishedAt time.Time,
	cost int64,
	outputCount, deletedCount int,
	historyMirror bool,
) *store.Task {
	t.Helper()
	params := map[string]any{}
	if historyMirror {
		params["_historyMirror"] = true
	}
	task, err := store.InsertTask(context.Background(), st.Pool, store.NewTask{
		ID: uuid.New(), UserID: userID, Type: "t2i", Model: "image-model", Prompt: "dashboard",
		Params: params, Count: max(1, outputCount), CostCents: cost, WorkUnits: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	keys := make([]string, outputCount)
	for index := range keys {
		keys[index] = fmt.Sprintf("tasks/%s/dashboard/%s/%d.png", userID, task.ID, index)
	}
	if _, err := st.Pool.Exec(context.Background(), `UPDATE tasks
		SET status = 'succeeded', output_keys = $2, deleted_output_count = $3,
			started_at = $4::timestamptz - interval '1 second', finished_at = $4::timestamptz,
			created_at = $4::timestamptz - interval '2 seconds'
		WHERE id = $1`, task.ID, keys, deletedCount, finishedAt); err != nil {
		t.Fatal(err)
	}
	return task
}

func insertDashboardAssistantRun(
	t *testing.T,
	st *store.Store,
	userID uuid.UUID,
	finishedAt time.Time,
	cost int64,
	imageKeys []string,
	usage map[string]any,
) *store.AssistantRun {
	t.Helper()
	ctx := context.Background()
	conversation, err := store.InsertAssistantConversationWithWorkspace(
		ctx, st.Pool, uuid.New(), userID, "dashboard", "assistant", finishedAt.Add(-time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "生成图片",
		Kind: "text", Status: "complete", CreatedAt: finishedAt.Add(-time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	images := make([]map[string]any, 0, len(imageKeys))
	for _, key := range imageKeys {
		images = append(images, map[string]any{"fileKey": key})
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image", Status: "complete",
		Metadata: map[string]any{"images": images, "usage": usage}, CreatedAt: finishedAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: userID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "image", Prompt: "dashboard", Params: map[string]any{"count": len(imageKeys)}, ReservedCents: cost,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs
		SET status = 'succeeded', resolved_mode = 'image', stage = 'complete', cost_cents = $2,
			started_at = $3::timestamptz - interval '1 second', finished_at = $3::timestamptz,
			created_at = $3::timestamptz - interval '2 seconds'
		WHERE id = $1`, run.ID, cost, finishedAt); err != nil {
		t.Fatal(err)
	}
	return run
}

func insertDashboardSpend(
	t *testing.T,
	st *store.Store,
	userID uuid.UUID,
	sourceType, sourceID string,
	createdAt time.Time,
	reason string,
) {
	t.Helper()
	if _, err := st.Pool.Exec(context.Background(), `INSERT INTO wallet_ledger
		(user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason, credit_bucket, created_at)
		VALUES ($1, 'spend', 0, 0, $2, $3, $4, 'normal', $5)`,
		userID, sourceType, sourceID, reason, createdAt); err != nil {
		t.Fatal(err)
	}
}
