package store_test

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestLightweightTaskOverviewMatchesMixedList(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	now := time.Now().UTC()
	user, err := store.InsertUser(ctx, st.Pool, "overview-"+uuid.NewString()+"@test.dev", "overview", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	insertPerfTask(t, st, user.ID, now, "succeeded", "t2i", map[string]any{})
	insertPerfAssistantRun(t, st, user.ID, "assistant", now, "failed", map[string]any{})
	insertPerfAssistantRun(t, st, user.ID, "infinite_canvas", now, "running", map[string]any{})
	run := insertPerfAssistantRun(t, st, user.ID, "ui_design", now, "succeeded", map[string]any{})
	key := store.UIDesignAssetHistoryIdempotencyKey(run.ID)
	insertPerfTask(t, st, user.ID, now, "succeeded", "ui_design", map[string]any{}, &key)
	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	for _, source := range []string{"", store.CanvasTaskSource, "assistant"} {
		filter := store.AdminListFilter{From: &from, To: &to, UserSearch: user.Email}
		list, err := store.ListAdminTasks(ctx, st.Pool, "", "", "", nil, 100, nil, source, filter)
		if err != nil {
			t.Fatal(err)
		}
		overview, err := store.GetAdminTaskOverview(ctx, st.Pool, "", "", nil, source, filter)
		if err != nil {
			t.Fatal(err)
		}
		if overview.Total != int64(len(list)) {
			t.Fatalf("source %s: overview %d != list %d", source, overview.Total, len(list))
		}
		counts := map[string]int64{}
		for _, task := range list {
			counts[task.Status]++
		}
		if overview.Succeeded != counts["succeeded"] || overview.Running != counts["running"] || overview.Failed != counts["failed"] {
			t.Fatalf("status mismatch: %#v", overview)
		}
	}
}
