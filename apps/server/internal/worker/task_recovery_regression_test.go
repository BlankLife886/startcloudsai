package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/jackc/pgx/v5"
)

func TestExpiredOpenAITransportErrorsReleaseTask(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	if err := settings.Set(ctx, st.Pool, "growth_failure_bonus_enabled", json.RawMessage(`false`)); err != nil {
		t.Fatal(err)
	}
	for _, status := range []int{http.StatusInternalServerError, http.StatusGatewayTimeout, 0} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			now := time.Now().UTC()
			id, route, _ := insertPollableOpenAITaskWindow(t, st, ctx, now.Add(-time.Hour), now.Add(-55*time.Minute), now.Add(-30*time.Minute))
			task, err := store.GetTask(ctx, st.Pool, id)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.InsertWallet(ctx, st.Pool, task.UserID); err != nil {
				t.Fatal(err)
			}
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				if _, err := wallet.Grant(ctx, tx, task.UserID, 100, "grant", "test", id.String(), nil); err != nil {
					return err
				}
				if _, err := wallet.FreezeForTask(ctx, tx, task.UserID, id, 20, "text_to_image", nil); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `UPDATE tasks SET cost_cents=20 WHERE id=$1`, id)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if status == 0 {
					conn, _, err := w.(http.Hijacker).Hijack()
					if err == nil {
						_ = conn.Close()
					}
					return
				}
				http.Error(w, "gateway unavailable", status)
			}))
			defer server.Close()
			claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, route, "expiry-test", now, time.Minute, 10)
			if err != nil || len(claimed) != 1 {
				t.Fatalf("claimed=%d err=%v", len(claimed), err)
			}
			w := &Worker{St: st, Cfg: &config.Config{AppEnv: "development"}}
			w.pollOpenAIProviderTasks(ctx, &modelconfig.Provider{ID: "provider-a", RouteID: "route-a", Adapter: modelconfig.AdapterOpenAI, BaseURL: server.URL, APIKey: "test", TimeoutSecs: 30}, claimed)
			task, err = store.GetTask(ctx, st.Pool, id)
			if err != nil || task.Status != "failed" || task.LeaseUntil != nil {
				t.Fatalf("expired task=%+v err=%v", task, err)
			}
			balance, err := store.GetWallet(ctx, st.Pool, task.UserID)
			if err != nil || balance.FrozenCents != 0 || balance.BalanceCents != 100 {
				t.Fatalf("expired task wallet=%+v err=%v", balance, err)
			}
			claimed, err = store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, route, "expiry-replay", now.Add(time.Minute), time.Minute, 10)
			if err != nil || len(claimed) != 0 {
				t.Fatalf("expired attempt remained pollable: %d %v", len(claimed), err)
			}
		})
	}
}

func TestLiveSubmittingWorkerIsNotClaimedUntilLeaseExpires(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	now := time.Now().UTC()
	id, route, _ := insertPollableOpenAITaskWindow(t, st, ctx, now.Add(-131*time.Second), now.Add(169*time.Second), now.Add(30*time.Minute))
	if _, err := st.Pool.Exec(ctx, `UPDATE task_upstream_attempts SET status='submitting' WHERE task_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET lease_owner='worker:live-sync', heartbeat_at=now(), lease_until=now()+interval '2 minutes' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, route, "live-test", now, time.Minute, 10)
	if err != nil || len(claimed) != 0 {
		t.Fatalf("live submission claimed=%d err=%v", len(claimed), err)
	}
	claimed, err = store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, route, "expired-test", now.Add(3*time.Minute), time.Minute, 10)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("orphan submission not recovered: claimed=%d err=%v", len(claimed), err)
	}
}

func TestSynchronousFallbackIsNotPolledBeforeReturn(t *testing.T) {
	st := testdb.Setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := settings.Set(ctx, st.Pool, "task_failure_retry_count", json.RawMessage(`0`)); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	id, route, _ := insertPollableOpenAITaskWindow(t, st, ctx, now, now.Add(5*time.Minute), now.Add(30*time.Minute))
	if _, err := st.Pool.Exec(ctx, `UPDATE task_upstream_attempts SET status='submitting' WHERE task_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET lease_owner='worker:live-sync', heartbeat_at=now(), lease_until=now()+interval '2 minutes' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	syncStarted, finishSync := make(chan struct{}), make(chan struct{})
	var finishOnce sync.Once
	finish := func() { finishOnce.Do(func() { close(finishSync) }) }
	var syncCalls, pollCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/images/generations" {
			syncCalls.Add(1)
			close(syncStarted)
			select {
			case <-finishSync:
			case <-r.Context().Done():
				return
			}
			fmt.Fprint(w, `{"data":[{"b64_json":"aW1hZ2U="}]}`)
			return
		}
		if r.URL.Path == "/api/image-tasks" {
			pollCalls.Add(1)
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	defer finish()
	task, err := store.GetTask(ctx, st.Pool, id)
	if err != nil {
		t.Fatal(err)
	}
	w := &Worker{St: st, Cfg: &config.Config{AppEnv: "development"}}
	provider := &modelconfig.Provider{ID: "provider-a", RouteID: "route-a", Adapter: modelconfig.AdapterOpenAI, BaseURL: server.URL, APIKey: "test", TimeoutSecs: 300}
	done := make(chan error, 1)
	go func() {
		_, err := w.callConfiguredUpstream(ctx, task, &modelconfig.Selection{Provider: *provider, Model: modelconfig.Model{UpstreamModel: "gpt-image-2"}}, nil)
		done <- err
	}()
	select {
	case <-syncStarted:
	case err := <-done:
		t.Fatalf("sync fallback did not start: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE task_upstream_attempts SET submitted_at=now()-interval '131 seconds' WHERE task_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, route, "fallback-poller", time.Now().UTC(), time.Minute, 10)
	if err != nil {
		t.Fatal(err)
	}
	w.pollOpenAIProviderTasks(ctx, provider, claimed)
	current, err := store.GetTask(ctx, st.Pool, id)
	finish()
	if syncErr := <-done; syncErr != nil {
		t.Fatal(syncErr)
	}
	if err != nil || current.Status != "running" || syncCalls.Load() != 1 || pollCalls.Load() != 0 {
		t.Fatalf("sync task=%+v err=%v syncCalls=%d polls=%d", current, err, syncCalls.Load(), pollCalls.Load())
	}
}

func TestCRUNPartialSubmissionRetryKeepsKnownJobs(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	id, _, owner := insertPollableOpenAITask(t, st, ctx, time.Now().UTC())
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET count=2, params=params || '{"_serviceProvider":"crun","_modelConfigId":"model-a"}'::jsonb WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	var createCalls atomic.Int32
	var estimateCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/client/job/EstimateTask" {
			if estimateCalls.Add(1) == 2 {
				w.WriteHeader(http.StatusInternalServerError)
				fmt.Fprint(w, `{"code":500,"message":"temporary estimate error"}`)
				return
			}
			fmt.Fprint(w, `{"code":200,"data":{"affordable":true}}`)
			return
		}
		call := createCalls.Add(1)
		fmt.Fprintf(w, `{"code":200,"data":{"task_id":"job-%d"}}`, call)
	}))
	defer server.Close()
	client, err := crun.New(server.URL, "test", "openai/gpt-image-2", 300)
	if err != nil {
		t.Fatal(err)
	}
	w := &Worker{
		St: st, Cfg: &config.Config{AppEnv: "development"}, workerID: "crun-resume-test",
		modelConfig: modelconfig.Config{
			Version: modelconfig.Version,
			Providers: []modelconfig.Provider{{
				ID: "provider-a", Name: "CRUN", Adapter: modelconfig.AdapterCRUN, Enabled: true,
				Routes: []modelconfig.ProviderRoute{
					{ID: "route-b", Name: "Other route", BaseURL: server.URL, APIKey: "test", MaxConcurrency: 10, Enabled: true},
					{ID: "route-a", Name: "Original route", BaseURL: server.URL, APIKey: "test", MaxConcurrency: 10, Enabled: true},
				},
			}},
			Models: []modelconfig.Model{{ID: "model-a", Name: "Image", ProviderID: "provider-a", UpstreamModel: "openai/gpt-image-2", Kind: modelconfig.ModelKindImage, Enabled: true}},
		},
		modelConfigAt: time.Now(),
	}
	if err := modelconfig.Save(ctx, st.Pool, w.modelConfig); err != nil {
		t.Fatal(err)
	}
	task, err := store.GetTask(ctx, st.Pool, id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = w.createCRUNImageTasks(ctx, task, client, nil)
	if !isRetryableTaskError(err) || !isCRUNPreflightError(err) || !taskRetryIsIdempotent(task, "crun") {
		t.Fatalf("unexpected initial failure %v ids=%v", err, task.Params["_crunTaskIds"])
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE task_upstream_attempts SET status='failed' WHERE task_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	retried, err := w.scheduleTaskRetry(ctx, task, owner)
	if err != nil || !retried {
		t.Fatalf("retried=%v err=%v", retried, err)
	}
	var reason string
	task, reason, err = w.claimTask(ctx, id)
	if err != nil || task == nil || reason != "" {
		t.Fatalf("claim=%+v reason=%s err=%v", task, reason, err)
	}
	if route := taskParamString(task.Params, "_providerRouteId"); route != "route-a" {
		t.Fatalf("resume moved known CRUN jobs to route %s", route)
	}
	ids, err := w.createCRUNImageTasks(ctx, task, client, nil)
	if err != nil {
		t.Fatal(err)
	}
	if createCalls.Load() != 2 || len(ids) != 2 || ids[0] != "job-1" || ids[1] != "job-2" {
		t.Fatalf("known job lost: posts=%d finalIDs=%v", createCalls.Load(), ids)
	}
}
