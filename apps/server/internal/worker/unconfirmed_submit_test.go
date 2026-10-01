package worker

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
)

// pollMissingUnconfirmed 模拟：提交超时（未获确认）后，上游轮询始终查不到该任务。
func pollMissingUnconfirmed(t *testing.T, retryCount string, prepare string) (*store.Store, uuid.UUID) {
	t.Helper()
	st := testdb.Setup(t)
	ctx := context.Background()
	if err := settings.Set(ctx, st.Pool, "task_failure_retry_count", json.RawMessage(retryCount)); err != nil {
		t.Fatal(err)
	}
	taskID, routeKey, _ := insertPollableOpenAITask(t, st, ctx, time.Now().UTC().Add(-3*time.Minute))
	if _, err := st.Pool.Exec(ctx, `UPDATE task_upstream_attempts SET submit_unconfirmed=true`+prepare+` WHERE task_id=$1`, taskID); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer server.Close()
	claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, routeKey, "attempt-poller:test", time.Now().UTC(), time.Minute, 10)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim attempts=%d err=%v", len(claimed), err)
	}
	w := &Worker{St: st, Cfg: &config.Config{AppEnv: "development"}}
	w.pollOpenAIProviderTasks(ctx, &modelconfig.Provider{
		ID: "provider-a", RouteID: "route-a", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: server.URL, APIKey: "test", TimeoutSecs: 600,
	}, claimed)
	return st, taskID
}

func timelineHasStage(t *testing.T, st *store.Store, taskID uuid.UUID, stage string) bool {
	t.Helper()
	var count int
	if err := st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM task_timeline_events WHERE task_id=$1 AND stage=$2`, taskID, stage).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count > 0
}

func TestUnconfirmedSubmitMissingPastGraceIsResubmitted(t *testing.T) {
	st, taskID := pollMissingUnconfirmed(t, `2`, `, upstream_missing_since=now()-interval '2 minutes'`)
	task, err := store.GetTask(context.Background(), st.Pool, taskID)
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "queued" || task.Attempt != 1 {
		t.Fatalf("unconfirmed submit should be resubmitted early: status=%s attempt=%d", task.Status, task.Attempt)
	}
	if !timelineHasStage(t, st, taskID, "upstream_unconfirmed") {
		t.Fatal("timeline should explain the upstream never confirmed the submit")
	}
}

func TestUnconfirmedSubmitMissingPastGraceFailsWhenRetriesExhausted(t *testing.T) {
	st, taskID := pollMissingUnconfirmed(t, `0`, `, upstream_missing_since=now()-interval '2 minutes'`)
	task, err := store.GetTask(context.Background(), st.Pool, taskID)
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "failed" || task.ErrorCode == nil || *task.ErrorCode != "upstream_unreachable" {
		t.Fatalf("exhausted unconfirmed submit should fail: status=%s code=%v", task.Status, task.ErrorCode)
	}
}

func TestUnconfirmedSubmitSeenByUpstreamKeepsWaiting(t *testing.T) {
	st, taskID := pollMissingUnconfirmed(t, `2`, `, upstream_seen_at=now()-interval '3 minutes', upstream_missing_since=now()-interval '2 minutes'`)
	task, err := store.GetTask(context.Background(), st.Pool, taskID)
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "running" || task.Attempt != 0 {
		t.Fatalf("task the upstream once acknowledged must not be abandoned early: status=%s attempt=%d", task.Status, task.Attempt)
	}
}

func TestUnconfirmedSubmitFirstMissingPollIsWithinGrace(t *testing.T) {
	st, taskID := pollMissingUnconfirmed(t, `2`, ``)
	task, err := store.GetTask(context.Background(), st.Pool, taskID)
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "running" || task.Attempt != 0 {
		t.Fatalf("first missing poll must stay within the grace period: status=%s attempt=%d", task.Status, task.Attempt)
	}
	var missingSince *time.Time
	if err := st.Pool.QueryRow(context.Background(), `SELECT upstream_missing_since FROM task_upstream_attempts WHERE task_id=$1`, taskID).Scan(&missingSince); err != nil || missingSince == nil {
		t.Fatalf("first missing poll should start the grace clock: %v %v", missingSince, err)
	}
}
