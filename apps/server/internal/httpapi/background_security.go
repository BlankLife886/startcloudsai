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
		initial := time.NewTimer(10 * time.Minute)
		defer initial.Stop()
		select {
		case <-ctx.Done():
			return
		case <-initial.C:
		}
		for {
			s.runScheduledPaymentReconciliation(ctx)
			timer := time.NewTimer(24 * time.Hour)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}()
}

func (s *Server) runScheduledPaymentReconciliation(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, 5*time.Minute)
	defer cancel()
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		return
	}
	orders, err := store.ListOrdersForReconciliation(ctx, s.St.Pool, time.Now().UTC().Add(-30*24*time.Hour), 500)
	if err != nil {
		log.Printf("scheduled payment reconciliation: list orders: %v", err)
		return
	}
	issues, repaired := 0, 0
	for _, order := range orders {
		result, err := s.reconcilePaymentOrder(ctx, order)
		if err != nil {
			issues++
			continue
		}
		if result.Outcome == "repaired" {
			repaired++
		} else if result.Outcome != "matched" {
			issues++
		}
	}
	if issues > 0 || repaired > 0 {
		log.Printf("scheduled payment reconciliation checked=%d repaired=%d issues=%d", len(orders), repaired, issues)
	}
}
