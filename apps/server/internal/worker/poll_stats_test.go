package worker

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// 上游已完成但本端查询失败时，统计要能在时间线里说明"查了几次、失败几次、最近错误"。
func TestUpstreamPollStatsAccumulateFailuresAndFeedTimelineMeta(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	taskID, routeKey, _ := insertPollableOpenAITask(t, st, ctx, time.Now().UTC().Add(-20*time.Second))
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			http.Error(w, `{"error":"upstream busy"}`, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"` + taskID.String() + `","status":"processing"}]}`))
	}))
	defer server.Close()
	w := &Worker{St: st, Cfg: &config.Config{AppEnv: "development"}}
	provider := &modelconfig.Provider{ID: "provider-a", RouteID: "route-a", Adapter: modelconfig.AdapterOpenAI, BaseURL: server.URL, APIKey: "test", TimeoutSecs: 600}
	for i := 0; i < 2; i++ {
		claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, routeKey, "attempt-poller:test", time.Now().UTC(), time.Minute, 10)
		if err != nil || len(claimed) != 1 {
			t.Fatalf("poll %d claim attempts=%d err=%v", i, len(claimed), err)
		}
		w.pollOpenAIProviderTasks(ctx, provider, claimed)
		if _, err := st.Pool.Exec(ctx, `UPDATE task_upstream_attempts SET poll_owner=NULL, poll_lease_until=NULL WHERE task_id=$1`, taskID); err != nil {
			t.Fatal(err)
		}
	}
	claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, routeKey, "attempt-poller:test", time.Now().UTC(), time.Minute, 10)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("final claim attempts=%d err=%v", len(claimed), err)
	}
	task := claimed[0]
	stats, err := store.GetTaskUpstreamAttemptPollStats(ctx, st.Pool, upstreamAttemptID(task))
	if err != nil {
		t.Fatal(err)
	}
	if stats.PollCount != 2 || stats.PollErrorCount != 1 || stats.LastPollError == "" || stats.LastPollErrorAt == nil {
		t.Fatalf("unexpected poll stats: %#v", stats)
	}
	meta := w.upstreamPollMeta(ctx, task, map[string]any{"images": 1})
	if meta["pollCount"] != 2 || meta["pollErrorCount"] != 1 || meta["lastPollError"] == nil || meta["images"] != 1 {
		t.Fatalf("timeline meta missing poll stats: %#v", meta)
	}
}
