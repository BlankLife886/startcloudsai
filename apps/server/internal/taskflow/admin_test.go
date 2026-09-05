// 管理员任务操作：force-fail 解冻退款、admin cancel 放开属主校验。
package taskflow_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
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
	outputKey := fmt.Sprintf("tasks/%s/%s/original/0.png", user.ID, task.ID)
	thumbnailKey := fmt.Sprintf("tasks/%s/%s/thumb/0.jpg", user.ID, task.ID)
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks
		SET output_keys = jsonb_build_array($2::text), thumbnail_keys = jsonb_build_array($3::text)
		WHERE id = $1`, task.ID, outputKey, thumbnailKey); err != nil {
		t.Fatalf("set force-fail outputs: %v", err)
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
	if len(failed.OutputKeys) != 0 || len(failed.ThumbnailKeys) != 0 {
		t.Fatalf("failed outputs = %#v / %#v, want empty", failed.OutputKeys, failed.ThumbnailKeys)
	}
	assertCleanupJobs(t, st, outputKey, thumbnailKey)

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
	outputKey := fmt.Sprintf("tasks/%s/%s/original/0.png", user.ID, task.ID)
	thumbnailKey := fmt.Sprintf("tasks/%s/%s/thumb/0.jpg", user.ID, task.ID)
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks
		SET output_keys = jsonb_build_array($2::text), thumbnail_keys = jsonb_build_array($3::text)
		WHERE id = $1`, task.ID, outputKey, thumbnailKey); err != nil {
		t.Fatalf("set cancel outputs: %v", err)
	}

	canceled, err := taskflow.AdminCancelTask(ctx, st, task.ID)
	if err != nil {
		t.Fatalf("admin cancel: %v", err)
	}
	if canceled.Status != "canceled" {
		t.Fatalf("status = %s, want canceled", canceled.Status)
	}
	if len(canceled.OutputKeys) != 0 || len(canceled.ThumbnailKeys) != 0 {
		t.Fatalf("canceled outputs = %#v / %#v, want empty", canceled.OutputKeys, canceled.ThumbnailKeys)
	}
	assertCleanupJobs(t, st, outputKey, thumbnailKey)
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

func TestAdminCancelFencesClaimedCompletion(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	claimID := uuid.NewString()
	claimed, err := store.TryClaimTaskCompletion(ctx, st.Pool, task.ID, claimID, timeNow(), 5*time.Minute)
	if err != nil || !claimed {
		t.Fatalf("claim completion = %v, err=%v", claimed, err)
	}

	if _, err := taskflow.AdminCancelTask(ctx, st, task.ID); err != nil {
		t.Fatalf("admin cancel: %v", err)
	}
	won, err := store.MarkTaskSucceededClaimed(ctx, st.Pool, task.ID,
		[]string{"tasks/" + user.ID.String() + "/" + task.ID.String() + "/original/0.png"}, nil,
		timeNow(), claimID)
	if err != nil {
		t.Fatalf("claimed completion: %v", err)
	}
	if won {
		t.Fatal("canceled task accepted a claimed completion")
	}
	final, err := store.GetTask(ctx, st.Pool, task.ID)
	if err != nil {
		t.Fatalf("load final task: %v", err)
	}
	if final.Status != "canceled" || len(final.OutputKeys) != 0 || len(final.ThumbnailKeys) != 0 {
		t.Fatalf("final task = %#v, want canceled with no outputs", final)
	}
}

func assertCleanupJobs(t *testing.T, st *store.Store, keys ...string) {
	t.Helper()
	var count int
	if err := st.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM object_cleanup_jobs WHERE object_key = ANY($1::text[])`, keys).Scan(&count); err != nil {
		t.Fatalf("count cleanup jobs: %v", err)
	}
	if count != len(keys) {
		t.Fatalf("cleanup jobs = %d, want %d", count, len(keys))
	}
}
