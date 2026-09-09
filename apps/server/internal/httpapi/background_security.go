package httpapi

import (
	"context"
	"log"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) startBackgroundSecurityJobs() {
	if s == nil || s.Cfg == nil || s.Cfg.AppEnv != "production" || s.St == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.backgroundCancel = cancel
	s.backgroundWG.Add(1)
	go func() {
		defer s.backgroundWG.Done()
		timer := time.NewTimer(30 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			s.runScheduledPaymentReconciliation(ctx)
			timer.Reset(time.Minute)
		}
	}()
}

func (s *Server) runScheduledPaymentReconciliation(parent context.Context) {
	checked, counts, err := s.runPaymentReconciliationBatch(parent, 100)
	if err != nil {
		log.Printf("scheduled payment reconciliation: %v", err)
		return
	}
	if checked > 0 {
		log.Printf("payment reconciliation checked=%d outcomes=%v", checked, counts)
	}
}

func reconciliationDelay(order *store.Order, result *store.PaymentReconciliation, failed bool) time.Duration {
	if failed {
		base := 5 * time.Minute
		if result != nil && result.Outcome == "provider_id_missing" {
			base = 15 * time.Minute
		}
		return min(base*time.Duration(1<<min(max(order.ReconcileAttempts, 0), 10)), 6*time.Hour)
	}
	if result != nil && (result.Outcome == "repaired" || order.Status == "completed" || order.Status == "expired" || order.Status == "failed" || order.Status == "cancelled") {
		return 24 * time.Hour
	}
	return 5 * time.Minute
}

func (s *Server) runPaymentReconciliationBatch(parent context.Context, limit int) (int, map[string]int, error) {
	ctx, cancel := context.WithTimeout(parent, 45*time.Second)
	defer cancel()
	counts := map[string]int{}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		return 0, counts, err
	}
	checked := 0
	for checked < limit && ctx.Err() == nil {
		orders, err := store.ClaimOrdersForReconciliation(ctx, s.St.Pool, time.Now().UTC(), min(20, limit-checked))
		if err != nil {
			return checked, counts, err
		}
		if len(orders) == 0 {
			break
		}
		for i, order := range orders {
			if ctx.Err() != nil {
				releaseCtx, releaseCancel := context.WithTimeout(context.WithoutCancel(parent), 3*time.Second)
				for _, remaining := range orders[i:] {
					_ = store.ReleaseOrderReconciliation(releaseCtx, s.St.Pool, remaining)
				}
				releaseCancel()
				counts["deferred"] += len(orders) - i
				return checked, counts, nil
			}
			result, err := s.reconcilePaymentOrder(ctx, order)
			outcome := "provider_error"
			if result != nil {
				outcome = result.Outcome
			}
			failed := err != nil || (outcome != "matched" && outcome != "repaired")
			counts[outcome]++
			checked++
			finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(parent), 3*time.Second)
			finishErr := store.FinishOrderReconciliation(finishCtx, s.St.Pool, order, time.Now().Add(reconciliationDelay(order, result, failed)), failed)
			finishCancel()
			if finishErr != nil {
				log.Printf("persist reconciliation schedule %s: %v", order.ID, finishErr)
			}
		}
	}
	return checked, counts, nil
}
