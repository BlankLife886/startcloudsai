package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func TestQueuedTaskCancelPolicyUsesStoredAttemptsAndMatchesSettlement(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "cancel-policy-"+uuid.NewString()+"@test.dev", "test", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	id, idem := uuid.New(), uuid.NewString()
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.Grant(ctx, tx, user.ID, 100, "grant", "test", id.String(), nil); err != nil {
			return err
		}
		if _, err := store.InsertTask(ctx, tx, store.NewTask{ID: id, UserID: user.ID, Type: "t2i", Prompt: "test", Count: 1, CostCents: 20, IdempotencyKey: &idem,
			Params: map[string]any{"HasPendingUpstream": false, "_hasPendingUpstream": false, "_generationStage": "preparing"}}); err != nil {
			return err
		}
		_, err := wallet.FreezeForTask(ctx, tx, user.ID, id, 20, "text_to_image", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	fresh, err := store.GetTask(ctx, st.Pool, id)
	if err != nil {
		t.Fatal(err)
	}
	if p := taskCancelPolicy(fresh); p["refunded"] != true || p["mode"] != "immediate" {
		t.Fatalf("fresh queue policy=%v", p)
	}
	if _, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{TaskID: id, ProviderID: "test", RouteKey: "test/route", Adapter: "openai", Status: store.UpstreamAttemptPending}); err != nil {
		t.Fatal(err)
	}
	assertPolicy := func(task *store.Task) {
		t.Helper()
		if task == nil || !task.HasPendingUpstream {
			t.Fatalf("missing pending summary: %+v", task)
		}
		policy := taskDict(task, nil, nil)["cancelPolicy"].(gin.H)
		if policy["mode"] != "abandon_upstream" || policy["refunded"] != false || policy["upstreamSubmitted"] != true {
			t.Fatalf("submitted task promised refund: %v", policy)
		}
	}
	for _, read := range []func() (*store.Task, error){
		func() (*store.Task, error) { return store.GetTask(ctx, st.Pool, id) },
		func() (*store.Task, error) { return store.GetUserTask(ctx, st.Pool, user.ID, id) },
		func() (*store.Task, error) { return store.GetTaskByIdemKey(ctx, st.Pool, user.ID, idem) },
	} {
		task, err := read()
		if err != nil {
			t.Fatal(err)
		}
		assertPolicy(task)
	}
	batch, err := store.GetTasksByIDs(ctx, st.Pool, []uuid.UUID{id})
	if err != nil {
		t.Fatal(err)
	}
	assertPolicy(batch[id])
	for _, list := range []func() ([]*store.Task, error){
		func() ([]*store.Task, error) {
			return store.ListTasks(ctx, st.Pool, &user.ID, "", "queued", nil, 10, nil, "", "")
		},
		func() ([]*store.Task, error) {
			return store.ListAdminTasks(ctx, st.Pool, "", "queued", "", []uuid.UUID{user.ID}, 10, nil, "")
		},
		func() ([]*store.Task, error) { return store.ListRecentTasks(ctx, st.Pool, user.ID, 10) },
	} {
		tasks, err := list()
		if err != nil || len(tasks) != 1 {
			t.Fatalf("tasks=%d err=%v", len(tasks), err)
		}
		assertPolicy(tasks[0])
	}
	// Even a recovering worker's preparation stage retains the pending warning.
	preparing := *batch[id]
	preparing.Status = "running"
	assertPolicy(&preparing)
	if _, err := taskflow.CancelTaskConfirmed(ctx, st, user.ID, id, false); err == nil {
		t.Fatal("pending cancellation bypassed confirmation")
	}
	before, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || before.BalanceCents != 80 || before.FrozenCents != 20 {
		t.Fatalf("before=%+v err=%v", before, err)
	}
	if _, err := taskflow.CancelTaskConfirmed(ctx, st, user.ID, id, true); err != nil {
		t.Fatal(err)
	}
	after, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || after.BalanceCents != 80 || after.FrozenCents != 0 {
		t.Fatalf("after=%+v err=%v", after, err)
	}
	var spend, release int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE kind='spend'),count(*) FILTER(WHERE kind='release') FROM wallet_ledger WHERE user_id=$1 AND source_type='task'`, user.ID).Scan(&spend, &release); err != nil {
		t.Fatal(err)
	}
	if spend != 1 || release != 0 {
		t.Fatalf("spend=%d release=%d", spend, release)
	}
	closed, err := store.GetTask(ctx, st.Pool, id)
	if err != nil || closed.HasPendingUpstream || closed.FinishedAt == nil || closed.FinishedAt.After(time.Now().Add(time.Minute)) {
		t.Fatalf("closed=%+v err=%v", closed, err)
	}
	if policy := taskCancelPolicy(closed); policy["upstreamSubmitted"] != true || policy["refunded"] != false || policy["allowed"] != false {
		t.Fatalf("closed task policy lost settlement outcome: %v", policy)
	}
}

func TestCancelledTaskPolicyReportsOnlyRecordedRefunds(t *testing.T) {
	for _, entry := range []struct {
		status                        string
		recorded, submitted, refunded bool
	}{{"canceled", true, false, true}, {"canceled", true, true, false}, {"canceled", false, false, false}, {"failed", true, false, false}} {
		params := map[string]any{}
		if entry.recorded {
			params["_cancelUpstreamSubmitted"] = entry.submitted
		}
		policy := taskCancelPolicy(&store.Task{Status: entry.status, Params: params})
		if policy["refunded"] != entry.refunded {
			t.Fatalf("status=%s recorded=%v submitted=%v policy=%v", entry.status, entry.recorded, entry.submitted, policy)
		}
	}
}
