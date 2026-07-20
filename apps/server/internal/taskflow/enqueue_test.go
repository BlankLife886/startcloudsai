// C1 入队补偿：入队失败 queued→failed + 解冻；stale queued 扫描。
package taskflow_test

import (
	"context"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestFailQueuedEnqueueCompensates(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()

	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 80 || w.FrozenCents != 20 {
		t.Fatalf("wallet = (%d, %d), want (80, 20)", w.BalanceCents, w.FrozenCents)
	}

	won, err := taskflow.FailQueuedEnqueue(ctx, st, task.ID)
	if err != nil || !won {
		t.Fatalf("compensate: %v (won=%v)", err, won)
	}
	fresh, err := store.GetTask(ctx, st.Pool, task.ID)
	if err != nil || fresh == nil {
		t.Fatalf("get task: %v", err)
	}
	if fresh.Status != "failed" || fresh.ErrorCode == nil || *fresh.ErrorCode != "enqueue_failed" {
		t.Fatalf("task = (%s, %v), want (failed, enqueue_failed)", fresh.Status, fresh.ErrorCode)
	}
	w = getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (100, 0) after release", w.BalanceCents, w.FrozenCents)
	}

	// 幂等：任务已 failed，再补偿抢不到迁移且不重复解冻
	won, err = taskflow.FailQueuedEnqueue(ctx, st, task.ID)
	if err != nil {
		t.Fatalf("second compensate: %v", err)
	}
	if won {
		t.Fatal("second compensate should not win")
	}
	w = getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (100, 0) unchanged", w.BalanceCents, w.FrozenCents)
	}
}

func TestListStaleQueuedTaskIDs(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()

	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// 新建任务未超时：不在回收名单
	ids, err := store.ListStaleQueuedTaskIDs(ctx, st.Pool, time.Now().UTC().Add(-10*time.Minute))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("stale ids = %v, want empty", ids)
	}
	// 伪造 created_at 15 分钟前：应被扫出
	if _, err := st.Pool.Exec(ctx,
		`UPDATE tasks SET created_at = now() - interval '15 minutes' WHERE id = $1`, task.ID); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	ids, err = store.ListStaleQueuedTaskIDs(ctx, st.Pool, time.Now().UTC().Add(-10*time.Minute))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(ids) != 1 || ids[0] != task.ID {
		t.Fatalf("stale ids = %v, want [%s]", ids, task.ID)
	}
	// running 任务不在 queued 回收名单
	forceRunning(t, st, task.ID)
	ids, err = store.ListStaleQueuedTaskIDs(ctx, st.Pool, time.Now().UTC().Add(-10*time.Minute))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("stale ids = %v, want empty after running", ids)
	}
}
