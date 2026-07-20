// 管理员任务操作：force-fail 解冻退款、admin cancel 放开属主校验。
package taskflow_test

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestForceFailReleasesFrozen(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// queued 状态不可强制失败
	_, err = taskflow.ForceFailTask(ctx, st, task.ID)
	mustAppErr(t, err, "task_not_cancelable")

	forceRunning(t, st, task.ID)
	failed, err := taskflow.ForceFailTask(ctx, st, task.ID)
	if err != nil {
		t.Fatalf("force fail: %v", err)
	}
	if failed.Status != "failed" {
		t.Fatalf("status = %s, want failed", failed.Status)
	}
	if failed.ErrorCode == nil || *failed.ErrorCode != "admin_force_failed" {
		t.Fatalf("errorCode = %v, want admin_force_failed", failed.ErrorCode)
	}
	if failed.ErrorMessage == nil || *failed.ErrorMessage != "管理员强制失败" {
		t.Fatalf("errorMessage = %v", failed.ErrorMessage)
	}
	if failed.FinishedAt == nil {
		t.Fatal("finishedAt should be set")
	}

	// 冻结已解冻退回
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (100, 0)", w.BalanceCents, w.FrozenCents)
	}
	// release 账本幂等键沿用 task 代数规则（第 0 代 = task_id）
	var releaseSource string
	if err := st.Pool.QueryRow(ctx,
		`SELECT source_id FROM wallet_ledger WHERE kind = 'release' AND source_type = 'task' AND user_id = $1`,
		user.ID).Scan(&releaseSource); err != nil {
		t.Fatalf("release ledger entry missing: %v", err)
	}
	if releaseSource != task.ID.String() {
		t.Fatalf("release source_id = %s, want %s", releaseSource, task.ID)
	}
	// 已给用户发通知
	var notif int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id = $1`, user.ID).Scan(&notif); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notif != 1 {
		t.Fatalf("notifications = %d, want 1", notif)
	}

	// 重复 force-fail：已是终态，不可重放
	_, err = taskflow.ForceFailTask(ctx, st, task.ID)
	mustAppErr(t, err, "task_not_cancelable")
}

func TestAdminCancelReleasesAndNotifies(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	canceled, err := taskflow.AdminCancelTask(ctx, st, task.ID)
	if err != nil {
		t.Fatalf("admin cancel: %v", err)
	}
	if canceled.Status != "canceled" {
		t.Fatalf("status = %s, want canceled", canceled.Status)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (100, 0)", w.BalanceCents, w.FrozenCents)
	}
	var notif int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id = $1`, user.ID).Scan(&notif); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notif != 1 {
		t.Fatalf("notifications = %d, want 1", notif)
	}

	_, err = taskflow.AdminCancelTask(ctx, st, task.ID)
	mustAppErr(t, err, "task_not_cancelable")
}
