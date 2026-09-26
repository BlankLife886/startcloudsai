package worker

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/contractpricing"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
)

func queuedSharedImage(t *testing.T, st *store.Store, userID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := st.Pool.QueryRow(context.Background(), `INSERT INTO tasks(user_id,type,prompt,params,status,cost_cents) VALUES($1,'t2i','test','{"_providerConfigId":"chat-provider","_modelConfigId":"image-model","_serviceProvider":"openai"}','queued',0) RETURNING id`, userID).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func oneSharedAssistantImage(t *testing.T, st *store.Store, userID uuid.UUID) *store.AssistantRun {
	t.Helper()
	run := insertAssistantRoutingTestRun(t, st, userID, "image", modelconfig.WorkspaceAssistant, 0)
	if _, err := st.Pool.Exec(context.Background(), `UPDATE assistant_runs SET params=jsonb_set(params,'{count}','1') WHERE id=$1`, run.ID); err != nil {
		t.Fatal(err)
	}
	run.Params["count"] = 1
	return run
}

func TestContractConcurrencySharesImagePoolAndRefundRemovesBonus(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 30)
	u := assistantRoutingTestUser(t, st, 0)
	ids := []uuid.UUID{}
	runs := []*store.AssistantRun{}
	for range 5 {
		ids = append(ids, queuedSharedImage(t, st, u.ID))
		runs = append(runs, oneSharedAssistantImage(t, st, u.ID))
	}
	claimImage := func(i int, want bool) {
		t.Helper()
		got, reason, err := w.claimTask(ctx, ids[i])
		if err != nil || (got != nil) != want {
			t.Fatalf("image %d=%+v reason=%s err=%v", i, got, reason, err)
		}
	}
	claimAssistant := func(i int, want bool) {
		t.Helper()
		got, err := w.claimAssistantRun(ctx, runs[i].ID, fmt.Sprint("worker-", i))
		if err != nil || (got != nil) != want {
			t.Fatalf("assistant %d=%+v err=%v", i, got, err)
		}
	}
	for i := range 2 {
		claimImage(i, true)
		claimAssistant(i, true)
	}
	claimImage(2, false)
	claimAssistant(2, false)
	bonus := 2
	p, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: uuid.NewString(), Name: "shared", Kind: "subscription", DurationDays: 3, DailyGrantCents: 100, SubscriptionPolicy: store.SubscriptionPolicy{ConcurrencyBonus: &bonus}})
	if err != nil {
		t.Fatal(err)
	}
	sub, err := store.InsertSubscription(ctx, st.Pool, &store.Subscription{UserID: u.ID, PlanID: p.ID, StartsAt: time.Now().Add(-time.Minute), EndsAt: time.Now().Add(24 * time.Hour), DailyGrantCents: 100})
	if err != nil {
		t.Fatal(err)
	}
	contract, err := contractpricing.Capture(ctx, st.Pool, p.SubscriptionPolicy, p.Revision, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE subscriptions SET billing_contract=$2 WHERE id=$1`, sub.ID, contract); err != nil {
		t.Fatal(err)
	}
	claimImage(2, true)
	claimAssistant(2, true)
	claimImage(3, false)
	claimAssistant(3, false)
	changedBonus := 10
	p.SubscriptionPolicy.ConcurrencyBonus = &changedBonus
	if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
		t.Fatal(err)
	}
	account, err := store.GetUserConcurrency(ctx, st.Pool, u.ID)
	if err != nil || account.Base != 4 || account.Bonus != 2 || account.Limit != 6 || account.Running != 6 || account.ChatLimit != 4 || account.ChatRunning != 0 {
		t.Fatalf("snapshot=%+v %v", account, err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE subscriptions SET status='refunding' WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	claimImage(3, false)
	claimAssistant(3, false)
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded',finished_at=now() WHERE id=ANY($1)`, ids[:3]); err != nil {
		t.Fatal(err)
	}
	claimAssistant(3, true)
	claimImage(3, false)
	if _, err := st.Pool.Exec(ctx, `UPDATE subscriptions SET status='active' WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	claimImage(3, true)
	claimAssistant(4, true)
	claimImage(4, false)
	for _, status := range []string{"expired", "cancelled"} {
		if _, err := st.Pool.Exec(ctx, `UPDATE subscriptions SET status=$2 WHERE id=$1`, sub.ID, status); err != nil {
			t.Fatal(err)
		}
		account, err := store.GetUserConcurrency(ctx, st.Pool, u.ID)
		if err != nil || account.Limit != 4 || account.Bonus != 0 {
			t.Fatalf("ended=%+v %v", account, err)
		}
	}
}

func TestSharedConcurrencyCannotOversubscribeWithMixedWorkers(t *testing.T) {
	for _, fallback := range []bool{false, true} {
		t.Run(fmt.Sprint("assistant fallback=", fallback), func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			w := assistantRoutingTestWorker(t, st, 40)
			u := assistantRoutingTestUser(t, st, 0)
			type work struct {
				id        uuid.UUID
				assistant bool
			}
			items := []work{}
			for range 6 {
				items = append(items, work{id: queuedSharedImage(t, st, u.ID)})
				r := oneSharedAssistantImage(t, st, u.ID)
				if fallback {
					if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET params='{"count":1}' WHERE id=$1`, r.ID); err != nil {
						t.Fatal(err)
					}
				}
				items = append(items, work{id: r.ID, assistant: true})
			}
			start := make(chan struct{})
			errs := make(chan error, len(items))
			var wg sync.WaitGroup
			var claimed atomic.Int32
			for _, item := range items {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					if item.assistant {
						r, err := w.claimAssistantRun(ctx, item.id, uuid.NewString())
						if err != nil {
							errs <- err
						}
						if r != nil {
							claimed.Add(1)
						}
					} else {
						r, _, err := w.claimTask(ctx, item.id)
						if err != nil {
							errs <- err
						}
						if r != nil {
							claimed.Add(1)
						}
					}
				}()
			}
			close(start)
			wg.Wait()
			close(errs)
			for err := range errs {
				t.Error(err)
			}
			if claimed.Load() != 4 {
				t.Fatalf("mixed claims=%d want=4", claimed.Load())
			}
			account, err := store.GetUserConcurrency(ctx, st.Pool, u.ID)
			if err != nil || account.Running != 4 {
				t.Fatalf("running=%+v %v", account, err)
			}
		})
	}
}

func TestSharedConcurrencyCannotBeBypassedWithHistoryParams(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 30)
	u := assistantRoutingTestUser(t, st, 0)
	for range 4 {
		if _, err := st.Pool.Exec(ctx, `INSERT INTO tasks(user_id,type,prompt,status,params,cost_cents) VALUES($1,'t2i','test','running',jsonb_build_object('_kind',$2::text),0)`, u.ID, store.UIDesignRegionEditKind); err != nil {
			t.Fatal(err)
		}
	}
	run := oneSharedAssistantImage(t, st, u.ID)
	claimed, err := w.claimAssistantRun(ctx, run.ID, "guarded")
	if err != nil || claimed != nil {
		t.Fatalf("forged history bypass=%+v %v", claimed, err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET lease_owner=$2 WHERE user_id=$1`, u.ID, store.UIDesignAssetHistoryLeaseOwner); err != nil {
		t.Fatal(err)
	}
	claimed, err = w.claimAssistantRun(ctx, run.ID, "history-projection-excluded")
	if err != nil || claimed == nil {
		t.Fatalf("real history counted twice=%+v %v", claimed, err)
	}
}
