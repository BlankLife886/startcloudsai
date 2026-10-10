package worker

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

type taskCapacityRejection struct {
	cause   error
	attempt int
	units   int64
}

func (e *taskCapacityRejection) Error() string { return e.cause.Error() }
func (e *taskCapacityRejection) Unwrap() error { return e.cause }

func (w *Worker) failQueuedTaskCapacity(ctx context.Context, id uuid.UUID, rejection *taskCapacityRejection) error {
	var failed *store.Task
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		task, err := store.GetTaskForUpdate(ctx, tx, id)
		if err != nil || task == nil || task.Status != "queued" || task.Attempt != rejection.attempt || store.TaskWorkUnits(task) != rejection.units {
			return err
		}
		won, err := taskflow.MarkFailed(ctx, tx, task, "task_batch_capacity", rejection.Error()+"；冻结积分已退回", "queued")
		if err != nil || !won {
			return err
		}
		if err := store.SupersedePendingTaskUpstreamAttempts(ctx, tx, id, time.Now().UTC()); err != nil {
			return err
		}
		failed = task
		return nil
	})
	if err == nil && failed != nil {
		taskflow.NotifyTaskFailed(ctx, w.St.Pool, failed)
		w.publishTaskEvent(ctx, failed, taskstream.Event{Stage: "failed", Status: "failed", Done: true})
	}
	return err
}
