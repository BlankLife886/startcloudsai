package taskflow

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"sort"
)

// Lock the group before touching the wallet. A group cancellation cannot wake
// an uncanceled sibling, and a changed fee policy rolls the entire group back.
func CancelTaskGroupConfirmed(ctx context.Context, st *store.Store, userID uuid.UUID, ids []uuid.UUID, acknowledgedTaskIDs []uuid.UUID) ([]*store.Task, error) {
	if len(ids) == 0 || len(ids) > 100 {
		return nil, apperr.E("validation_error", "每次须选择1到100个任务", 422)
	}
	unique := map[uuid.UUID]bool{}
	acknowledged := map[uuid.UUID]bool{}
	for _, id := range acknowledgedTaskIDs {
		acknowledged[id] = true
	}
	for _, id := range ids {
		unique[id] = true
	}
	ordered := make([]uuid.UUID, 0, len(unique))
	for id := range unique {
		ordered = append(ordered, id)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].String() < ordered[j].String() })
	var tasks []*store.Task
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserTaskExecution(ctx, tx, userID); err != nil {
			return err
		}
		locked := make([]*store.Task, 0, len(ordered))
		for _, id := range ordered {
			task, err := store.GetUserTaskForUpdate(ctx, tx, userID, id)
			if err != nil {
				return err
			}
			if task == nil {
				return apperr.E("task_not_found", "任务不存在", 404)
			}
			locked = append(locked, task)
		}
		for _, task := range locked {
			if task.Status == "queued" || task.Status == "running" {
				var err error
				task, err = cancelTaskInTx(ctx, tx, &userID, task.ID, cancelActorUser, acknowledged[task.ID])
				if err != nil {
					return err
				}
			}
			tasks = append(tasks, task)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return tasks, nil
}
