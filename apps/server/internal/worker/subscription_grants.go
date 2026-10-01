package worker

import (
	"context"
	"time"

	"github.com/hibiken/asynq"

	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
)

func (w *Worker) grantSubscriptions(ctx context.Context) error {
	return subscription.Tick(ctx, w.St, time.Now().UTC())
}

func (w *Worker) handleGrantSubscriptions(ctx context.Context, _ *asynq.Task) error {
	return w.grantSubscriptions(ctx)
}
