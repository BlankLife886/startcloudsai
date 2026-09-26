package store_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
)

func TestPlatformLogsListStatsDeleteAndCapacityCleanup(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	now := time.Now().UTC()
	taskID := uuid.New()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("platform-log-%s@test.dev", uuid.NewString()[:8]), "logger", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: taskID, UserID: user.ID, Type: "t2i", Model: "gpt-image-2", Prompt: "not logged",
		Params: map[string]any{
			"_serviceProvider": "openai", "_providerDisplayName": "Primary Images",
			"_providerConfigId": "provider-a", "_providerRouteId": "route-a",
			"_providerRouteKey": "provider-a/route-a", "_modelConfigId": "image-a",
		}, Count: 2, CostCents: 20, WorkUnits: 2,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='failed',attempt=2,error_code='upstream_error',error_message='上游拒绝请求' WHERE id=$1`, taskID); err != nil {
		t.Fatal(err)
	}
	securityDuration := int64(2200)
	operationsDuration := int64(3100)
	userDuration := int64(120)
	for _, item := range []store.NewPlatformLog{
		{Category: "security", Level: "warning", Service: "api", Event: "security.access_denied", Message: "access denied", DurationMs: &securityDuration, Metadata: map[string]any{"route": "/api/v1/private"}},
		{Category: "operations", Level: "error", Service: "worker", Event: "task.failed", Message: "upstream failed", TaskID: &taskID, DurationMs: &operationsDuration},
		{Category: "user", Level: "info", Service: "api", Event: "user.action", Message: "POST /api/v1/tasks", DurationMs: &userDuration, Metadata: map[string]any{"route": "/api/v1/tasks"}},
	} {
		if err := store.InsertPlatformLog(ctx, st.Pool, item); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE platform_logs SET created_at = $1 WHERE category = 'security'`, now.AddDate(0, 0, -10)); err != nil {
		t.Fatal(err)
	}
	items, err := store.ListPlatformLogs(ctx, st.Pool, store.PlatformLogFilter{
		Category: "operations", Search: "upstream", TaskID: &taskID, Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Event != "task.failed" || items[0].Metadata == nil {
		t.Fatalf("items = %#v", items)
	}
	if items[0].UserID == nil || *items[0].UserID != user.ID || items[0].Metadata["model"] != "gpt-image-2" ||
		items[0].Metadata["providerDisplayName"] != "Primary Images" || items[0].Metadata["errorCode"] != "upstream_error" ||
		items[0].Metadata["userEmail"] != user.Email {
		t.Fatalf("enriched item = %#v", items[0])
	}
	stats, err := store.GetPlatformLogStats(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Count != 3 || stats.LogicalBytes <= 0 || stats.PhysicalBytes <= 0 || stats.ByCategory["user"] != 1 {
		t.Fatalf("stats = %#v", stats)
	}
	overview, err := store.GetPlatformLogOverview(ctx, st.Pool, nil, "hour")
	if err != nil {
		t.Fatal(err)
	}
	if overview.Summary.Count != 3 || overview.Summary.ErrorCount != 1 || overview.Summary.WarningCount != 1 ||
		overview.Summary.SlowCount != 2 || overview.Summary.P95Duration <= 0 || len(overview.Trend) == 0 ||
		len(overview.TopEvents) == 0 || len(overview.SlowRoutes) == 0 || len(overview.TaskIssues) != 1 ||
		overview.TaskIssues[0].TaskID != taskID || overview.TaskIssues[0].Provider != "Primary Images" {
		t.Fatalf("overview = %#v", overview)
	}
	deleted, err := store.CleanupPlatformLogs(ctx, st.Pool, now.AddDate(0, 0, -7), 1<<30)
	if err != nil || deleted != 1 {
		t.Fatalf("retention cleanup deleted=%d err=%v", deleted, err)
	}
	deleted, err = store.CleanupPlatformLogs(ctx, st.Pool, now.AddDate(0, 0, -30), 1)
	if err != nil || deleted != 2 {
		t.Fatalf("capacity cleanup deleted=%d err=%v", deleted, err)
	}
	stats, err = store.GetPlatformLogStats(ctx, st.Pool)
	if err != nil || stats.Count != 0 {
		t.Fatalf("empty stats=%#v err=%v", stats, err)
	}
}
