package worker

import (
	"context"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// handleRefreshModelHealth keeps the hourly table behind the public model
// status page current. The first run on an empty table backfills 7 days.
func (w *Worker) handleRefreshModelHealth(ctx context.Context, _ *asynq.Task) error {
	started := time.Now()
	var from time.Time
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		from, err = store.RefreshModelHealthHourly(ctx, tx, started)
		return err
	})
	if err != nil {
		log.Printf("refresh model health failed: %v", err)
		return err
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		log.Printf("refresh model health from=%s took %s", from.Format(time.RFC3339), elapsed.Round(time.Millisecond))
	}
	return nil
}
