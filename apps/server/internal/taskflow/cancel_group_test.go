package taskflow_test

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestCancelGroupIsAtomicAndAcknowledgementIsPerImage(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 100)
	ids := []uuid.UUID{}
	for range 4 {
		task, _, err := createT2I(t, st, user.ID, 1, nil)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, task.ID)
	}
	markSubmitted := func(id uuid.UUID) {
		t.Helper()
		forceRunning(t, st, id)
		if _, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{TaskID: id, ProviderID: "test", RouteKey: "test", Adapter: "openai", Status: store.UpstreamAttemptPending}); err != nil {
			t.Fatal(err)
		}
	}
	markSubmitted(ids[0])
	_, err := taskflow.CancelTaskGroupConfirmed(ctx, st, user.ID, ids, nil)
	mustAppErr(t, err, "task_cancel_confirmation_required")
	// The second image starts after the dialog. Consent for the first must not
	// silently authorize charging the second, and no sibling may be canceled.
	markSubmitted(ids[1])
	_, err = taskflow.CancelTaskGroupConfirmed(ctx, st, user.ID, ids, ids[:1])
	mustAppErr(t, err, "task_cancel_confirmation_required")
	var canceled int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE user_id=$1 AND status='canceled'`, user.ID).Scan(&canceled); err != nil || canceled != 0 {
		t.Fatalf("partial cancellation=%d err=%v", canceled, err)
	}
	before := getWallet(t, st, user.ID)
	if before.BalanceCents != 20 || before.FrozenCents != 80 {
		t.Fatalf("wallet changed before confirmation: %+v", before)
	}
	rows, err := taskflow.CancelTaskGroupConfirmed(ctx, st, user.ID, ids, ids[:2])
	if err != nil || len(rows) != 4 {
		t.Fatalf("rows=%d err=%v", len(rows), err)
	}
	after := getWallet(t, st, user.ID)
	if after.BalanceCents != 60 || after.FrozenCents != 0 {
		t.Fatalf("mixed group settlement: %+v", after)
	}
	if _, err := taskflow.CancelTaskGroupConfirmed(ctx, st, user.ID, ids, nil); err != nil {
		t.Fatal(err)
	}
	again := getWallet(t, st, user.ID)
	if again.BalanceCents != after.BalanceCents || again.FrozenCents != 0 {
		t.Fatal("repeated cancellation changed funds")
	}
}

func TestCancelGroupRefundsEveryQueuedImage(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 100)
	ids := []uuid.UUID{}
	for range 4 {
		task, _, err := createT2I(t, st, user.ID, 1, nil)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, task.ID)
	}
	rows, err := taskflow.CancelTaskGroupConfirmed(ctx, st, user.ID, ids, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Status != "canceled" || row.Params["_cancelUpstreamSubmitted"] != false {
			t.Fatalf("unexpected result %+v", row)
		}
	}
	funds := getWallet(t, st, user.ID)
	if funds.BalanceCents != 100 || funds.FrozenCents != 0 {
		t.Fatalf("refund=%+v", funds)
	}
}

func TestClaimedButUnsubmittedCancelIsRefundable(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 100)
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := store.ClaimTask(ctx, st.Pool, task.ID, time.Now(), "preparing", time.Minute); err != nil || !ok {
		t.Fatal(err)
	}
	if _, err := taskflow.CancelTaskConfirmed(ctx, st, user.ID, task.ID, false); err != nil {
		t.Fatal(err)
	}
	if funds := getWallet(t, st, user.ID); funds.BalanceCents != 100 || funds.FrozenCents != 0 {
		t.Fatalf("claimed preparation charged: %+v", funds)
	}
}

func TestQueuedKnownCRUNCancelRequiresConfirmation(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 100)
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET params=params||'{"_crunTaskIds":["upstream-job"]}' WHERE id=$1`, task.ID); err != nil {
		t.Fatal(err)
	}
	_, err = taskflow.CancelTaskConfirmed(ctx, st, user.ID, task.ID, false)
	mustAppErr(t, err, "task_cancel_confirmation_required")
	if funds := getWallet(t, st, user.ID); funds.BalanceCents != 80 || funds.FrozenCents != 20 {
		t.Fatal("confirmation changed frozen balance")
	}
}

func TestCancelPolicyAcrossAllCloudImageTaskTypes(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 100)
	for _, kind := range []string{"t2i", "coloring", "ui_design", "ecommerce_design", "model_sheet", "game_art", "background_remove", "media_tool"} {
		t.Run(kind, func(t *testing.T) {
			queued, _, err := createT2I(t, st, user.ID, 1, nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET type=$2 WHERE id=$1`, queued.ID, kind); err != nil {
				t.Fatal(err)
			}
			if _, err := taskflow.CancelTaskConfirmed(ctx, st, user.ID, queued.ID, false); err != nil {
				t.Fatal(err)
			}
			if funds := getWallet(t, st, user.ID); funds.BalanceCents != 100 || funds.FrozenCents != 0 {
				t.Fatalf("queued cancellation charged %s: %+v", kind, funds)
			}
		})
	}
}
