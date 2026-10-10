package store

import (
	"context"
	"time"
)

// SubscriptionProgress is what the subscriptions page shows for one
// subscription: grant schedule and how its credits were used. The AI
// assistant reads the same struct so both always agree.
type SubscriptionProgress struct {
	// NextGrantAt is nil once the subscription is inactive, ended, or waiting
	// on a restart upgrade.
	NextGrantAt   *time.Time
	GrantedCycles int
	TotalCycles   int
	SkippedCycles int
	// AvailableKnown is false for billing version 1, which never tracked
	// per-subscription balances.
	AvailableKnown    bool
	AvailablePoints   int64
	FrozenPoints      int64
	SpentPoints       int64
	IssuedPoints      int64
	RevokedPoints     int64
	UpgradeHeld       int64
	UpgradeRevoked    int64
	ExpiredPoints     int64
	CurrentTermSpent  int64
	UnattributedSpent int64
	HasPriorTerm      bool
	Upgrading         bool
}

// GetSubscriptionProgress reads sub's grant and credit totals. It only reads.
func GetSubscriptionProgress(ctx context.Context, q Q, sub *Subscription, at time.Time) (*SubscriptionProgress, error) {
	p := &SubscriptionProgress{}
	err := q.QueryRow(ctx, `SELECT min(next_grant_at) FILTER(WHERE granted_count<total_grants),COALESCE(sum(granted_count-skipped_grants),0),COALESCE(sum(total_grants),0),COALESCE(sum(skipped_grants),0) FROM subscription_periods WHERE subscription_id=$1 AND cadence='rolling_24h' AND closed_at IS NULL`, sub.ID).
		Scan(&p.NextGrantAt, &p.GrantedCycles, &p.TotalCycles, &p.SkippedCycles)
	if err != nil {
		return nil, err
	}
	if sub.Status != "active" || !sub.EndsAt.After(at) {
		p.NextGrantAt = nil
	}
	// Attribute use through each grant's order and period, not the time a task settled.
	err = q.QueryRow(ctx, `SELECT COALESCE(sum(available_points) FILTER(WHERE NOT refund_hold AND NOT upgrade_hold),0),COALESCE(sum(frozen_points+CASE WHEN refund_hold OR upgrade_hold THEN available_points ELSE 0 END),0),COALESCE(sum(spent_points),0),COALESCE(sum(granted_points),0),COALESCE(sum(revoked_points-upgrade_revoked_points-expired_points),0),COALESCE(sum(available_points) FILTER(WHERE upgrade_hold),0),COALESCE(sum(upgrade_revoked_points),0),COALESCE(sum(expired_points),0),
 COALESCE(sum(spent_points) FILTER(WHERE EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=l.subscription_id AND p.order_id=l.order_id AND p.starts_at>=$2)),0),
 COALESCE(sum(spent_points) FILTER(WHERE NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=l.subscription_id AND p.order_id=l.order_id)),0),
 EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=$1 AND p.starts_at<$2)
 FROM subscription_credit_lots l WHERE subscription_id=$1`, sub.ID, sub.StartsAt).
		Scan(&p.AvailablePoints, &p.FrozenPoints, &p.SpentPoints, &p.IssuedPoints, &p.RevokedPoints, &p.UpgradeHeld, &p.UpgradeRevoked, &p.ExpiredPoints, &p.CurrentTermSpent, &p.UnattributedSpent, &p.HasPriorTerm)
	if err != nil {
		return nil, err
	}
	p.AvailableKnown = sub.BillingVersion != 1
	if sub.BillingVersion == 1 {
		err = q.QueryRow(ctx, `SELECT COALESCE(sum(delta_cents),0),count(*) FROM wallet_ledger WHERE user_id=$1 AND source_type='subscription_daily' AND source_id LIKE $2`, sub.UserID, sub.ID.String()+"/%").
			Scan(&p.IssuedPoints, &p.GrantedCycles)
		if err != nil {
			return nil, err
		}
	}
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_changes WHERE subscription_id=$1 AND kind='upgrade' AND status='pending' AND snapshot->>'upgradeMode'='restart')`, sub.ID).Scan(&p.Upgrading); err != nil {
		return nil, err
	}
	if p.Upgrading {
		p.NextGrantAt = nil
	}
	return p, nil
}
