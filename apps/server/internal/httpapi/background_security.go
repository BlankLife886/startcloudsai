package httpapi

import (
	"context"
	"log"
	"time"
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
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			s.runScheduledPaymentReconciliation(ctx)
			timer.Reset(10 * time.Second)
		}
	}()
	s.backgroundWG.Add(1)
	go func() {
		defer s.backgroundWG.Done()
		ticker := time.NewTicker(paymentListenerCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			s.monitorPaymentListener(ctx)
		}
	}()
}

func (s *Server) runScheduledPaymentReconciliation(parent context.Context) {
	checked, counts, err := s.runPaymentReconciliationBatch(parent, 100)
	if err != nil {
		log.Printf("scheduled payment reconciliation: %v", err)
		return
	}
	// Pending orders are checked every few seconds; only log batches that changed something.
	if checked > counts["matched"] {
		log.Printf("payment reconciliation checked=%d outcomes=%v", checked, counts)
	}
}
