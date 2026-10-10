package worker

import (
	"context"
	"log"
	"time"

	"github.com/hibiken/asynq"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantproactive"
	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
)

// handleAssistantProactive is the assistant speaking first: it announces
// finished long work in the conversation and on the notification bell.
func (w *Worker) handleAssistantProactive(ctx context.Context, _ *asynq.Task) error {
	if w.St == nil {
		return nil
	}
	now := time.Now().UTC()
	announced, err := assistantproactive.AnnounceFinishedSets(ctx, w.St, commerceset.Service{St: w.St}, now)
	if announced > 0 {
		log.Printf("assistant proactive: announced %d finished commerce sets", announced)
	}
	return err
}

// handleAssistantAlerts warns recently active users about low balance,
// unusual spending and many failures, once a day per kind.
func (w *Worker) handleAssistantAlerts(ctx context.Context, _ *asynq.Task) error {
	if w.St == nil {
		return nil
	}
	sent, err := assistantproactive.SendAlerts(ctx, w.St, time.Now().UTC())
	if sent > 0 {
		log.Printf("assistant proactive: sent %d alerts", sent)
	}
	return err
}

// handleAssistantReports sends the daily and weekly usage reports users
// asked for.
func (w *Worker) handleAssistantReports(ctx context.Context, _ *asynq.Task) error {
	if w.St == nil {
		return nil
	}
	sent, err := assistantproactive.SendReports(ctx, w.St, time.Now().UTC())
	if sent > 0 {
		log.Printf("assistant proactive: sent %d reports", sent)
	}
	return err
}
