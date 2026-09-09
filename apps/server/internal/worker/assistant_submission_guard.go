package worker

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/upstreamguard"
	"github.com/jackc/pgx/v5"
	"sync"
	"time"
)

func (w *Worker) assistantImageSubmissionContext(ctx context.Context, run *store.AssistantRun) (context.Context, error) {
	return w.assistantSubmissionContext(ctx, run, "image", "preparing-image", "generating-image")
}

func (w *Worker) assistantSubmissionContext(ctx context.Context, run *store.AssistantRun, mode, preparingStage, submittedStage string) (context.Context, error) {
	known := store.AssistantRunHasKnownImageJobs(run) || (mode == "chat" && assistantParamString(run.Params, "_editableTaskId", "") != "")
	initial := preparingStage
	if known {
		initial = submittedStage
	}
	setInitial := func() error {
		if mode == "image" {
			return w.setAssistantImageStage(ctx, run, initial, nil)
		}
		return w.setAssistantEditableStage(ctx, run, initial)
	}
	if err := setInitial(); err != nil {
		return ctx, err
	}
	var mu sync.Mutex
	started := false
	guarded := upstreamguard.With(ctx, func(requestCtx context.Context) error {
		mu.Lock()
		defer mu.Unlock()
		err := w.St.Tx(requestCtx, func(tx pgx.Tx) error {
			current, err := store.GetAssistantRunForUpdate(requestCtx, tx, run.ID)
			if err != nil {
				return err
			}
			if current == nil || current.Status != "running" || current.Attempt != run.Attempt || current.LeaseOwner == nil || run.LeaseOwner == nil || *current.LeaseOwner != *run.LeaseOwner || current.LeaseUntil == nil || !current.LeaseUntil.After(time.Now()) {
				return context.Canceled
			}
			if started {
				return nil
			}
			if _, err := store.SetAssistantRunStageAttempt(requestCtx, tx, run.ID, run.Attempt, mode, submittedStage); err != nil {
				return err
			}
			if mode == "chat" {
				if _, err := tx.Exec(requestCtx, `UPDATE assistant_runs SET params=COALESCE(params,'{}'::jsonb)||jsonb_build_object('_editableTaskId',$2::text,'_editableTaskGeneration',$3::integer) WHERE id=$1`, run.ID, run.ID.String(), run.BillingGeneration); err != nil {
					return err
				}
			}
			return store.UpdateAssistantMessage(requestCtx, tx, run.AssistantMessageID, "", mode, "running", assistantMessageMetadata(run, nil, submittedStage, ""))
		})
		if err != nil {
			return err
		}
		if !started {
			started = true
			if mode == "image" {
				w.recordAssistantImageStage(requestCtx, run, submittedStage)
			}
			assistantstream.Publish(requestCtx, w.Stream, run.ID.String(), assistantstream.Event{Kind: mode, Stage: submittedStage})
		}
		return nil
	})
	if known {
		if err := upstreamguard.Check(guarded); err != nil {
			return guarded, err
		}
	}
	return guarded, nil
}
