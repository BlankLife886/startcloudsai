package taskflow_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestQueuedPendingCancellationRequiresConfirmationAndSettles(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 100)
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner := "poller:cancel-test"
	if _, err := store.ClaimTask(ctx, st.Pool, task.ID, time.Now().UTC(), owner, time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{
		TaskID: task.ID, RouteKey: "cancel-test", ProviderID: "provider", Adapter: "openai", Status: store.UpstreamAttemptPending,
	}); err != nil {
		t.Fatal(err)
	}
	if _, queued, err := store.RetryRunningTaskOwned(ctx, st.Pool, task.ID, owner, 0, nil); err != nil || !queued {
		t.Fatalf("queued=%v err=%v", queued, err)
	}
	_, err = taskflow.CancelTaskConfirmed(ctx, st, user.ID, task.ID, false)
	mustAppErr(t, err, "task_cancel_confirmation_required")
	_, err = taskflow.AdminCancelTask(ctx, st, task.ID)
	mustAppErr(t, err, "task_not_cancelable")
	_, err = taskflow.CancelQueuedTaskSilently(ctx, st, user.ID, task.ID)
	mustAppErr(t, err, "task_not_cancelable")
	before := getWallet(t, st, user.ID)
	if before.BalanceCents != 80 || before.FrozenCents != 20 {
		t.Fatalf("unconfirmed cancellation changed wallet: %+v", before)
	}
	canceled, err := taskflow.CancelTaskConfirmed(ctx, st, user.ID, task.ID, true)
	if err != nil || canceled.Status != "canceled" {
		t.Fatalf("canceled=%+v err=%v", canceled, err)
	}
	if canceled.StartedAt != nil {
		t.Fatal("retry fixture should have no start timestamp")
	}
	after := getWallet(t, st, user.ID)
	if after.BalanceCents != 80 || after.FrozenCents != 0 {
		t.Fatalf("submitted cancellation was refunded: %+v", after)
	}
	var spend, release int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE kind='spend'), count(*) FILTER (WHERE kind='release')
		FROM wallet_ledger WHERE user_id=$1 AND source_type='task'`, user.ID).Scan(&spend, &release); err != nil {
		t.Fatal(err)
	}
	if spend != 1 || release != 0 {
		t.Fatalf("spend=%d release=%d", spend, release)
	}
	notification := &store.Notification{Title: "已主动停止"}
	taskflow.ApplyTaskNotificationDisplay(notification, canceled)
	if notification.Body == nil || !strings.Contains(*notification.Body, "按本次预留积分结算") {
		t.Fatalf("cancellation history claimed refund: %+v", notification)
	}
	if pending, err := store.CountPendingTaskUpstreamAttempts(ctx, st.Pool, task.ID); err != nil || pending != 0 {
		t.Fatalf("pending=%d err=%v", pending, err)
	}
}

func TestPreparingCancellationHistoryPreservesRefund(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 100)
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	forceRunning(t, st, task.ID)
	if err := store.SetTaskGenerationStage(ctx, st.Pool, task.ID, "preparing"); err != nil {
		t.Fatal(err)
	}
	canceled, err := taskflow.CancelTaskConfirmed(ctx, st, user.ID, task.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	notification := &store.Notification{Title: "已主动停止"}
	taskflow.ApplyTaskNotificationDisplay(notification, canceled)
	if notification.Body == nil || !strings.Contains(*notification.Body, "冻结积分已退回") {
		t.Fatalf("preparing cancellation history claimed settlement: %+v", notification)
	}
}
