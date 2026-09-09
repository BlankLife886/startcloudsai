package subscription

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/contractpricing"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const Day = 24 * time.Hour

func applyRollingOrder(ctx context.Context, tx pgx.Tx, order *store.Order, plan *store.Plan, at time.Time) (*store.Subscription, error) {
	if plan.DurationDays <= 0 || plan.DailyGrantCents <= 0 {
		return nil, fmt.Errorf("invalid subscription terms")
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, order.UserID.String()); err != nil {
		return nil, err
	}
	previous, err := store.GetSubscriptionPeriodForOrder(ctx, tx, order.ID)
	if err != nil {
		return nil, err
	}
	if previous != nil {
		return store.GetSubscription(ctx, tx, previous.SubscriptionID)
	}
	blocking, err := store.HasBlockingSubscription(ctx, tx, order.UserID, at)
	if err != nil {
		return nil, err
	}
	if blocking {
		return nil, apperr.E("subscription_exists", "已有有效订阅，请在我的订阅中升级或申请退订", 409)
	}
	start := at.UTC()
	end := start.Add(time.Duration(plan.DurationDays) * Day)
	sub, err := store.InsertSubscription(ctx, tx, &store.Subscription{UserID: order.UserID, PlanID: plan.ID, OrderID: &order.ID, StartsAt: start, EndsAt: end, DailyGrantCents: plan.DailyGrantCents})
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `UPDATE subscriptions SET billing_version=2,policy_snapshot=$2,plan_name_snapshot=$3,price_snapshot=$4,duration_snapshot=$5 WHERE id=$1`, sub.ID, order.SubscriptionPolicy, plan.Name, order.AmountCents, plan.DurationDays)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO subscription_periods(subscription_id,order_id,starts_at,ends_at,grant_starts_on,grant_ends_on,next_grant_on,daily_grant_cents,cadence,next_grant_at,total_grants)
 VALUES($1,$2,$3,$4,($3 AT TIME ZONE 'Asia/Shanghai')::date,($3 AT TIME ZONE 'Asia/Shanghai')::date+$5::integer,($3 AT TIME ZONE 'Asia/Shanghai')::date,$6,'rolling_24h',$3,$5)`, sub.ID, order.ID, start, end, plan.DurationDays, plan.DailyGrantCents)
	if err != nil {
		return nil, err
	}
	sub, err = store.GetSubscription(ctx, tx, sub.ID)
	if err != nil {
		return nil, err
	}
	contract, err := contractpricing.Capture(ctx, tx, sub.Policy, order.PlanRevision, at)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE subscriptions SET billing_contract=$2 WHERE id=$1`, sub.ID, contract); err != nil {
		return nil, err
	}
	sub.Contract = contract
	if err := grantRollingDue(ctx, tx, sub, at); err != nil {
		return nil, err
	}
	return store.GetSubscription(ctx, tx, sub.ID)
}

func grantRollingDue(ctx context.Context, tx pgx.Tx, sub *store.Subscription, at time.Time) error {
	if sub == nil || sub.BillingVersion != 2 || (sub.Status != "active" && sub.Status != "expired") {
		return nil
	}
	ctx = store.WithBillingTime(ctx, at)
	if err := store.ExpireSubscriptionCredits(ctx, tx, sub.UserID, at); err != nil {
		return err
	}
	var upgrading bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_changes WHERE subscription_id=$1 AND kind='upgrade' AND status='pending' AND snapshot->>'upgradeMode'='restart')`, sub.ID).Scan(&upgrading); err != nil {
		return err
	}
	if upgrading {
		return nil
	}
	rows, err := tx.Query(ctx, `SELECT id,order_id,starts_at,next_grant_at,granted_count,total_grants,daily_grant_cents FROM subscription_periods WHERE subscription_id=$1 AND cadence='rolling_24h' AND closed_at IS NULL AND next_grant_at<=$2 AND granted_count<total_grants ORDER BY next_grant_at FOR UPDATE`, sub.ID, at)
	if err != nil {
		return err
	}
	type duePeriod struct {
		id, order    uuid.UUID
		start, next  time.Time
		count, total int
		points       int64
	}
	var periods []duePeriod
	for rows.Next() {
		var p duePeriod
		if err := rows.Scan(&p.id, &p.order, &p.start, &p.next, &p.count, &p.total, &p.points); err != nil {
			rows.Close()
			return err
		}
		periods = append(periods, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, p := range periods {
		currentIndex := min(max(int(at.Sub(p.start)/Day), 0), p.total)
		skipped := max(currentIndex-p.count, 0)
		p.count += skipped
		p.next = p.start.Add(time.Duration(p.count) * Day)
		for n := 0; n < 60 && p.count < p.total && !p.next.After(at); n++ {
			source := fmt.Sprintf("%s/cycle/%d", p.id, p.count)
			kind := "cycle"
			if p.count == 0 {
				kind = "initial"
			}
			if err := wallet.GrantSubscription(ctx, tx, sub, p.order, source, p.next, p.points, kind); err != nil {
				return err
			}
			p.count++
			p.next = p.start.Add(time.Duration(p.count) * Day)
		}
		if _, err := tx.Exec(ctx, `UPDATE subscription_periods SET next_grant_at=$2,granted_count=$3,skipped_grants=skipped_grants+$4 WHERE id=$1`, p.id, p.next, p.count, skipped); err != nil {
			return err
		}
	}
	return nil
}

func tickRolling(ctx context.Context, st *store.Store, at time.Time) error {
	rows, err := st.Pool.Query(ctx, `SELECT s.id FROM subscriptions s JOIN subscription_periods p ON p.subscription_id=s.id JOIN users u ON u.id=s.user_id WHERE s.billing_version=2 AND s.status IN ('active','expired') AND p.closed_at IS NULL AND p.next_grant_at<=$1 AND p.granted_count<p.total_grants AND u.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM subscription_changes c WHERE c.subscription_id=s.id AND c.kind='upgrade' AND c.status='pending' AND c.snapshot->>'upgradeMode'='restart') GROUP BY s.id ORDER BY min(p.next_grant_at),s.id LIMIT 200`, at)
	if err != nil {
		return err
	}
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var failures []error
	for _, id := range ids {
		if err := st.Tx(ctx, func(tx pgx.Tx) error {
			sub, err := store.GetSubscriptionForUpdate(ctx, tx, id)
			if err != nil {
				return err
			}
			return grantRollingDue(ctx, tx, sub, at)
		}); err != nil {
			failures = append(failures, fmt.Errorf("subscription %s: %w", id, err))
		}
	}
	return errors.Join(failures...)
}
