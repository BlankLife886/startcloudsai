package worker

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/hibiken/asynq"
	"log"
	"time"
)

func (w *Worker) handleSettleReferralMonths(ctx context.Context, _ *asynq.Task) error {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	count, err := referral.SettleDue(ctx, w.St)
	if count > 0 {
		log.Printf("settled %d referral account-months", count)
	}
	return err
}
