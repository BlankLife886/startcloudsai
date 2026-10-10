package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

func assistantRunPoolMode(run *store.AssistantRun) string {
	if store.AssistantRunIsImage(run) {
		return "image"
	}
	return "chat"
}

func (w *Worker) enqueueAssistantRunRecovery(ctx context.Context, id uuid.UUID) error {
	run, err := store.GetAssistantRun(ctx, w.St.Pool, id)
	if err != nil || run == nil {
		return err
	}
	if run.Status != "queued" {
		return nil
	}
	return w.Queue.EnqueueAssistantRunRecovery(ctx, id.String(), assistantRunPoolMode(run))
}

// Legacy queue records and older API replicas can still omit mode. Resolve the
// durable run before claiming any quota, then move it to its dedicated pool.
func (w *Worker) handleAssistantInExecutionPool(ctx context.Context, task *asynq.Task) error {
	var payload taskflow.RunAssistantPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return err
	}
	id, err := uuid.Parse(payload.RunID)
	if err != nil {
		return err
	}
	run, err := store.GetAssistantRun(ctx, w.St.Pool, id)
	if err != nil || run == nil {
		return err
	}
	if run.Status != "queued" {
		return nil
	}
	mode := assistantRunPoolMode(run)
	if queue, ok := asynq.GetQueueName(ctx); ok && queue != taskflow.AssistantQueue(mode) {
		if w.Queue == nil {
			return fmt.Errorf("assistant queue unavailable for mode %s", mode)
		}
		return w.Queue.EnqueueAssistantRunRecovery(ctx, id.String(), mode)
	}
	err = w.handleRunAssistant(ctx, task)
	if errors.Is(err, store.ErrExecutionBatchTooLarge) {
		return w.failQueuedAssistantRun(ctx, id, err.Error(), "assistant_batch_capacity")
	}
	return err
}
