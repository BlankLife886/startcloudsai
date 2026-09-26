package worker

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"testing"
)

func TestUserQueuedTasksResumeInOrderAndClearWaitReason(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4)
	u := assistantRoutingTestUser(t, st, 0)
	if err := settings.Set(ctx, st.Pool, "user_max_concurrent_tasks", []byte(`1`)); err != nil {
		t.Fatal(err)
	}
	first, second, third := queuedSharedImage(t, st, u.ID), queuedSharedImage(t, st, u.ID), queuedSharedImage(t, st, u.ID)
	if task, reason, err := w.claimTask(ctx, first); err != nil || task == nil {
		t.Fatalf("first=%v reason=%s err=%v", task, reason, err)
	}
	for _, id := range []string{second.String(), third.String()} {
		taskID := second
		if id == third.String() {
			taskID = third
		}
		if task, reason, err := w.claimTask(ctx, taskID); err != nil || task != nil || reason != "user_execution_limit" {
			t.Fatalf("deferred=%v reason=%s err=%v", task, reason, err)
		}
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded',finished_at=now() WHERE id=$1`, first); err != nil {
		t.Fatal(err)
	}
	if task, reason, err := w.claimTask(ctx, third); err != nil || task != nil || reason != "user_queue_order" {
		t.Fatalf("later=%v reason=%s err=%v", task, reason, err)
	}
	task, reason, err := w.claimTask(ctx, second)
	if err != nil || task == nil || reason != "" {
		t.Fatalf("next=%v reason=%s err=%v", task, reason, err)
	}
	if task.Params["_queueWaitReason"] != nil {
		t.Fatal("claimed task retained its queue reason")
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded',finished_at=now() WHERE id=$1`, second); err != nil {
		t.Fatal(err)
	}
	if task, _, err := w.claimTask(ctx, third); err != nil || task == nil {
		t.Fatalf("last=%v err=%v", task, err)
	}
}

func TestQueueOrderSkipsHeldUpstreamAndUnavailableRoute(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4)
	u := assistantRoutingTestUser(t, st, 0)
	held, unavailable, next := queuedSharedImage(t, st, u.ID), queuedSharedImage(t, st, u.ID), queuedSharedImage(t, st, u.ID)
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET params=params||'{"_crunTaskIds":["already-submitted"]}' WHERE id=$1`, held); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetTaskQueueWaitReason(ctx, st.Pool, unavailable, "provider_execution_limit"); err != nil {
		t.Fatal(err)
	}
	ids, err := store.ListUserDispatchableTaskIDs(ctx, st.Pool, u.ID, 4)
	if err != nil || len(ids) != 1 || ids[0] != next {
		t.Fatalf("eligible=%v err=%v", ids, err)
	}
	if task, reason, err := w.claimTask(ctx, next); err != nil || task == nil {
		t.Fatalf("next=%v reason=%s err=%v", task, reason, err)
	}
}
