package store_test

import (
	"context"
	"encoding/json"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestAgentQualityFilteredSummaryAndPagination(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	now := time.Now().UTC()
	user, err := store.InsertUser(ctx, st.Pool, "quality-"+uuid.NewString()+"@test.dev", "quality", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 51; i++ {
		run := insertPerfAssistantRun(t, st, user.ID, "infinite_canvas", now, "succeeded", nil)
		model := "model-a"
		if i == 50 {
			model = "model-b"
		}
		if err = store.InsertAgentExecutionTrace(ctx, st.Pool, run.ID, user.ID, nil, model, "high", nil, nil); err != nil {
			t.Fatal(err)
		}
		if i == 50 {
			if err = store.UpsertAgentToolStepClaim(ctx, st.Pool, run.ID, "unfinished", "canvas_get_state", json.RawMessage(`{}`), "browser", false); err != nil {
				t.Fatal(err)
			}
			if _, err = st.Pool.Exec(ctx, "UPDATE agent_execution_traces SET status='succeeded',finished_at=now() WHERE run_id=$1", run.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	options := store.AgentTraceListOptions{Since: now.Add(-time.Hour), Workspace: "canvas", Model: "model-b", Limit: 50, IssuesOnly: true}
	summary, err := store.GetAgentQualitySummaryScoped(ctx, st.Pool, options.Since, options.Workspace, options)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := store.ListAdminAgentExecutionTraces(ctx, st.Pool, options)
	if err != nil {
		t.Fatal(err)
	}
	if summary.TotalTraces != 1 || summary.UnfinishedSteps != 1 || len(rows) != 1 {
		t.Fatalf("filter/summary mismatch %#v rows=%d", summary, len(rows))
	}
	options.Model = ""
	options.IssuesOnly = false
	options.Offset = 50
	rows, err = store.ListAdminAgentExecutionTraces(ctx, st.Pool, options)
	if err != nil || len(rows) != 1 {
		t.Fatalf("page 2 failed: %d %v", len(rows), err)
	}
}
