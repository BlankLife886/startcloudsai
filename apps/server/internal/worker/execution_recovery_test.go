package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestExecutionRecoveryKeepsAssistantReservationAndOriginalConnection(t *testing.T) {
	for _, adapter := range []string{"c2a", "crun"} {
		t.Run(adapter, func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			w := assistantRoutingTestWorker(t, st, 4, 4)
			user := assistantRoutingTestUser(t, st, 0)
			queued := executionTestAssistant(t, st, user.ID, 4, 0)
			run, err := w.claimAssistantRun(ctx, queued.ID, "before-crash")
			if err != nil || run == nil {
				t.Fatalf("first claim=%v %v", run, err)
			}
			if adapter == "c2a" {
				if changed, err := store.SetAssistantRunC2ATaskIDs(ctx, st.Pool, run.ID, run.Attempt, map[string]string{"batch": "accepted-job"}); err != nil || !changed {
					t.Fatalf("persist jobs=%v %v", changed, err)
				}
			} else if err := store.SetAssistantRunCRUNTaskIDs(ctx, st.Pool, run.ID, []string{"job-1", "job-2", "job-3", "job-4"}); err != nil {
				t.Fatal(err)
			}
			if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET lease_until=now()-interval '10 minutes' WHERE id=$1`, run.ID); err != nil {
				t.Fatal(err)
			}
			if ids, err := store.RequeueExpiredAssistantRuns(ctx, st.Pool, time.Now().UTC()); err != nil || len(ids) != 1 {
				t.Fatalf("recovery ids=%v %v", ids, err)
			}
			cfg, err := modelconfig.Load(ctx, st.Pool)
			if err != nil {
				t.Fatal(err)
			}
			cfg.Providers[0].Enabled = false
			cfg.Providers[0].Routes[0].BaseURL = "https://changed.invalid"
			if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
				t.Fatal(err)
			}
			executionTestSetting(t, st, "user_max_concurrent_tasks", 1)
			executionTestSetting(t, st, "global_max_concurrent_tasks", 1)
			account, err := store.GetUserConcurrency(ctx, st.Pool, user.ID)
			if err != nil || account.ImageRunning != 4 || account.ImageLimit != 1 {
				t.Fatalf("queued recovery lost quota: %+v %v", account, err)
			}
			scenarioCheck(t, adapter+"：恢复排队后仍保留原4张名额", 4, account.ImageRunning)
			scenarioCheck(t, adapter+"：后台已将新任务个人上限降为1", 1, account.ImageLimit)
			usage, err := store.GetGlobalExecutionUsage(ctx, st.Pool)
			if err != nil || usage.ImageRunning != 4 {
				t.Fatalf("global recovery quota=%+v %v", usage, err)
			}
			scenarioCheck(t, adapter+"：全局仍计入恢复中的4张图", 4, usage.ImageRunning)
			routes, err := store.RunningExecutionUnitsByProvider(ctx, st.Pool, []string{"chat-provider/route-a"})
			if err != nil || routes["chat-provider/route-a"] != 4 {
				t.Fatalf("route recovery quota=%v %v", routes, err)
			}
			scenarioCheck(t, adapter+"：原线路仍保留4张占用", 4, routes["chat-provider/route-a"])
			// A newly reordered but unstarted conversation item must not prevent
			// already accepted work from resuming and releasing its reservation.
			earlier := oneSharedAssistantImage(t, st, user.ID)
			if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET conversation_id=$2,queue_position=1 WHERE id=$1`, earlier.ID, run.ConversationID); err != nil {
				t.Fatal(err)
			}
			if _, err := st.Pool.Exec(ctx, `UPDATE assistant_messages SET conversation_id=$2 WHERE id=ANY($1)`, []uuid.UUID{earlier.UserMessageID, earlier.AssistantMessageID}, run.ConversationID); err != nil {
				t.Fatal(err)
			}
			if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET queue_position=2 WHERE id=$1`, run.ID); err != nil {
				t.Fatal(err)
			}
			if err := store.InsertAssistantRunOutbox(ctx, st.Pool, run.ID); err != nil {
				t.Fatal(err)
			}
			ready, err := store.AssistantRunDispatchable(ctx, st.Pool, run.ID, 1)
			if err != nil || !ready {
				t.Fatalf("recovery stuck behind unstarted work: ready=%v %v", ready, err)
			}
			ids, err := store.ListReadyAssistantRunOutboxIDs(ctx, st.Pool, time.Now().Add(time.Minute), 20)
			found := false
			for _, id := range ids {
				if id == run.ID {
					found = true
				}
			}
			if err != nil || !found {
				t.Fatalf("outbox blocked recovery: %v %v", ids, err)
			}
			resumed, err := w.claimAssistantRun(ctx, run.ID, "after-crash")
			if err != nil || resumed == nil || resumed.Attempt != run.Attempt+1 {
				t.Fatalf("recovery claim=%v %v", resumed, err)
			}
			selection, configured, err := w.configuredAssistantModelSelection(ctx, resumed, modelconfig.ModelKindImage)
			if err != nil || !configured || selection.Provider.BaseURL != "https://route-1.example.com" || selection.Provider.APIKey != "route-secret" {
				t.Fatalf("lost original connection: configured=%v err=%v", configured, err)
			}
			scenarioCheck(t, adapter+"：线路停用后恢复仍绑定原连接", true, selection.Provider.BaseURL == "https://route-1.example.com")
			if got, err := w.claimAssistantRun(ctx, run.ID, "duplicate-owner"); err != nil || got != nil {
				t.Fatalf("duplicate recovery claim=%v %v", got, err)
			}
			account, err = store.GetUserConcurrency(ctx, st.Pool, user.ID)
			if err != nil || account.ImageRunning != 4 {
				t.Fatalf("resumed reservation doubled: %+v %v", account, err)
			}
			scenarioCheck(t, adapter+"：恢复领取后没有重复占用成8张", 4, account.ImageRunning)
			if changed, err := store.FailAssistantRunAttempt(ctx, st.Pool, run.ID, resumed.Attempt, "test_end", "done"); err != nil || !changed {
				t.Fatalf("end=%v %v", changed, err)
			}
			usage, err = store.GetGlobalExecutionUsage(ctx, st.Pool)
			if err != nil || usage.ImageRunning != 0 {
				t.Fatalf("terminal known IDs retained quota: %+v %v", usage, err)
			}
			scenarioCheck(t, adapter+"：任务结束后占用归零", 0, usage.ImageRunning)
		})
	}
}

func TestExecutionRecoveryCurrentPendingTaskOnlyResumesPolling(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4, 4)
	user := assistantRoutingTestUser(t, st, 0)
	queued := executionTestImage(t, st, user.ID, 2, "react_canvas")
	run, reason, err := w.claimTask(ctx, queued.ID)
	if err != nil || run == nil || reason != "" {
		t.Fatalf("claim=%v %s %v", run, reason, err)
	}
	now := time.Now().UTC()
	if _, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{
		TaskID: run.ID, TaskAttempt: run.Attempt, ProviderID: "chat-provider", RouteID: "route-a", RouteKey: "chat-provider/route-a",
		Adapter: modelconfig.AdapterOpenAI, BaseURL: "https://route-1.example.com", Status: store.UpstreamAttemptPending,
		UpstreamTaskIDs: []string{"accepted-job"}, SubmittedAt: now, FailoverAt: now.Add(time.Minute), ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET lease_until=now()-interval '10 minutes' WHERE id=$1`, run.ID); err != nil {
		t.Fatal(err)
	}
	if ids, err := store.RequeueExpiredRunningTasks(ctx, st.Pool, now); err != nil || len(ids) != 1 {
		t.Fatalf("requeue=%v %v", ids, err)
	}
	got, reason, err := w.claimTask(ctx, run.ID)
	if err != nil || got != nil || reason != "upstream_attempts_exhausted" {
		t.Fatalf("recovery submitted another attempt: %v %s %v", got, reason, err)
	}
	payload, _ := json.Marshal(taskflow.RunTaskPayload{TaskID: run.ID.String()})
	if err := w.handleRunTask(ctx, asynq.NewTask(taskflow.TypeRunTask, payload)); err != nil {
		t.Fatal(err)
	}
	stored, err := store.GetTask(ctx, st.Pool, run.ID)
	if err != nil || stored.Attempt != run.Attempt || taskParamString(stored.Params, "_providerRouteKey") != "chat-provider/route-a" {
		t.Fatalf("recovery changed identity: %v %v", stored, err)
	}
	count, err := store.CountPendingTaskUpstreamAttempts(ctx, st.Pool, run.ID)
	if err != nil || count != 1 {
		t.Fatalf("pending attempts=%d %v", count, err)
	}
	account, err := store.GetUserConcurrency(ctx, st.Pool, user.ID)
	if err != nil || account.ImageRunning != 2 {
		t.Fatalf("pending recovery lost quota: %+v %v", account, err)
	}
	other := executionTestImage(t, st, user.ID, 2, "ecommerce")
	if claimed, _, err := w.claimTask(ctx, other.ID); err != nil || claimed == nil {
		t.Fatalf("remaining quota unavailable: %v %v", claimed, err)
	}
	blocked := executionTestImage(t, st, user.ID, 1, "text_to_image")
	if claimed, reason, err := w.claimTask(ctx, blocked.ID); err != nil || claimed != nil || reason != "user_execution_limit" {
		t.Fatalf("pending quota bypass: %v %s %v", claimed, reason, err)
	}
}

func TestExecutionImageAdapterRejectsUnreservedFanoutBeforeHTTP(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4)
	user := assistantRoutingTestUser(t, st, 0)
	queued := executionTestAssistant(t, st, user.ID, 2, 0)
	run, err := w.claimAssistantRun(ctx, queued.ID, "valid-owner")
	if err != nil || run == nil {
		t.Fatalf("claim=%v %v", run, err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "must not reach upstream", 500)
	}))
	defer server.Close()
	client := c2a.NewWithPolicy(server.URL, "test", 1, true)
	for _, scenario := range []string{"chat", "count", "attempt", "lease"} {
		t.Run(scenario, func(t *testing.T) {
			copyRun := *run
			copyRun.Params = make(map[string]any, len(run.Params))
			for key, value := range run.Params {
				copyRun.Params[key] = value
			}
			switch scenario {
			case "chat":
				copyRun.Mode = "chat"
			case "count":
				copyRun.Params["count"] = 4
			case "attempt":
				copyRun.Attempt++
			case "lease":
				owner := "stale-owner"
				copyRun.LeaseOwner = &owner
			}
			if err := w.executeAssistantImageC2AClient(ctx, &copyRun, nil, client, "image"); err == nil {
				t.Fatal("unreserved execution accepted")
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal(fmt.Sprintf("unreserved HTTP calls=%d", calls.Load()))
	}
}

func TestExecutionRecoveryKnownJobTimeoutAndExplicitRetryHaveDifferentRules(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4, 4)
	user := assistantRoutingTestUser(t, st, 100)
	queued := executionTestAssistant(t, st, user.ID, 2, 10)
	run, err := w.claimAssistantRun(ctx, queued.ID, "original")
	if err != nil || run == nil {
		t.Fatalf("claim=%v %v", run, err)
	}
	if changed, err := store.SetAssistantRunC2ATaskIDs(ctx, st.Pool, run.ID, run.Attempt, map[string]string{"batch": "accepted-job"}); err != nil || !changed {
		t.Fatalf("persist IDs=%v %v", changed, err)
	}
	run, err = store.GetAssistantRun(ctx, st.Pool, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retried, err := w.retryAssistantProviderRoute(ctx, run, context.DeadlineExceeded); err != nil || retried {
		t.Fatalf("known job timeout launched an alternate generation: %v %v", retried, err)
	}
	stored, err := store.GetAssistantRun(ctx, st.Pool, run.ID)
	if err != nil || stored.Status != "running" || !store.AssistantRunHasKnownImageJobs(stored) {
		t.Fatalf("timeout discarded original job: %v %v", stored, err)
	}
	if changed, err := assistantbilling.Fail(ctx, st, run.ID, "upstream_timeout", "test timeout"); err != nil || !changed {
		t.Fatalf("failure=%v %v", changed, err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET params=params||'{"_failedImageProviderRouteKeys":["chat-provider/route-a","chat-provider/route-b"]}' WHERE id=$1`, run.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		failed, err := store.GetAssistantRunForUpdate(ctx, tx, run.ID)
		if err != nil {
			return err
		}
		changed, err := assistantbilling.Requeue(ctx, tx, failed)
		if err == nil && !changed {
			return fmt.Errorf("explicit retry was not queued")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	retry, err := w.claimAssistantRun(ctx, run.ID, "explicit-retry")
	if err != nil || retry == nil || retry.Attempt != run.Attempt+1 || store.AssistantRunHasKnownImageJobs(retry) || len(assistantParamStrings(retry.Params, "_failedImageProviderRouteKeys")) != 0 {
		t.Fatalf("explicit retry retained stale failure state: %v %v", retry, err)
	}
	funds, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || funds.BalanceCents != 90 || funds.FrozenCents != 10 {
		t.Fatalf("retry freeze=%+v %v", funds, err)
	}
}
