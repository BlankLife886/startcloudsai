// Package devapibilling reclaims credit reservations that developer-API direct
// requests left open because their process stopped before settling or
// releasing them.
package devapibilling

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

// Reclaim releases every expired open reservation, up to limit rows per call.
// Each row is re-checked under its own row lock, so a retry that re-opened the
// request after the listing is never released underneath it.
func Reclaim(ctx context.Context, st *store.Store, now time.Time, limit int) (int, error) {
	items, err := store.ListExpiredDeveloperAPIRequests(ctx, st.Pool, now, limit)
	if err != nil {
		return 0, err
	}
	reclaimed := 0
	for _, item := range items {
		released, err := reclaimOne(ctx, st, item.BillingID, now)
		if err != nil {
			log.Printf("developer API reservation reclaim failed billing_id=%s: %v", item.BillingID, err)
			continue
		}
		if released {
			reclaimed++
		}
	}
	return reclaimed, nil
}

func reclaimOne(ctx context.Context, st *store.Store, billingID string, now time.Time) (bool, error) {
	released := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		item, err := store.LockDeveloperAPIRequest(ctx, tx, billingID)
		if err != nil || item == nil {
			return err
		}
		if item.Status != store.DeveloperAPIRequestPending || !item.ExpiresAt.Before(now) {
			return nil
		}
		spend, err := store.GetLedgerEntry(ctx, tx, "spend", item.SourceType, billingID)
		if err != nil {
			return err
		}
		if spend != nil {
			// Settled but the state update was lost; record the real outcome.
			return store.MarkDeveloperAPIRequest(ctx, tx, billingID, store.DeveloperAPIRequestSucceeded)
		}
		freeze, err := store.GetLedgerEntry(ctx, tx, "freeze", item.SourceType, billingID)
		if err != nil {
			return err
		}
		if freeze != nil && item.UserID != nil {
			if _, err := wallet.ReleaseFeatureCredits(ctx, tx, *item.UserID, -freeze.DeltaCents, item.SourceType, billingID, nil); err != nil {
				return err
			}
		}
		if err := store.MarkDeveloperAPIRequest(ctx, tx, billingID, store.DeveloperAPIRequestExpired); err != nil {
			return err
		}
		if err := store.MarkDeveloperAPIProfitEntry(ctx, tx, billingID, "failed", "reservation_expired"); err != nil {
			return err
		}
		released = true
		return nil
	})
	return released, err
}
