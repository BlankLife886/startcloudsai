package subscription

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/contractpricing"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/jackc/pgx/v5"
)

func proportionalValue(value, part, total int64) int64 {
	if total <= 0 || value <= 0 || part <= 0 {
		return 0
	}
	ratio := new(big.Int).Mul(big.NewInt(value), big.NewInt(min(part, total)))
	return ratio.Quo(ratio, big.NewInt(total)).Int64()
}

func applyRestartUpgrade(ctx context.Context, tx pgx.Tx, order *store.Order, change *store.SubscriptionChange, sub *store.Subscription, at time.Time) (*store.Subscription, error) {
	credit := change.Snapshot.UpgradeCredit
	if sub == nil || credit == nil || change.TargetPlanID == nil || change.Snapshot.DurationDays <= 0 || change.Snapshot.DailyPoints <= 0 || credit.CreditCents < 0 || change.AmountCents != change.Snapshot.PriceCents-credit.CreditCents || change.Status != "pending" || sub.Revision != change.ExpectedRevision || (sub.Status != "active" && sub.Status != "expired") {
		return nil, apperr.E("upgrade_requires_review", "付款已记录，但升级权益锁定状态已变化，需要人工核查", 409)
	}
	var balance, held, spent, frozen int64
	if err := tx.QueryRow(ctx, `SELECT balance_cents+trial_balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, sub.UserID).Scan(&balance); err != nil {
		return nil, err
	}
	if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(available_points) FILTER(WHERE upgrade_hold),0),COALESCE(sum(spent_points),0),COALESCE(sum(frozen_points),0) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&held, &spent, &frozen); err != nil {
		return nil, err
	}
	if held != credit.ReclaimPoints || spent != credit.SpentPoints || frozen != 0 {
		return nil, apperr.E("upgrade_requires_review", "付款已记录，但抵扣积分发生变化，需要人工核查", 409)
	}
	if _, err := tx.Exec(ctx, `UPDATE subscription_credit_lots SET revoked_points=revoked_points+available_points,upgrade_revoked_points=upgrade_revoked_points+available_points,available_points=0,upgrade_hold=false WHERE subscription_id=$1`, sub.ID); err != nil {
		return nil, err
	}
	if held > 0 {
		source, reason := change.ID.String(), fmt.Sprintf("升级整期置换，回收旧订阅 %d 积分", held)
		if _, err := store.InsertLedgerEntry(ctx, tx, sub.UserID, "spend", 0, balance, "subscription_upgrade_exchange", &source, &reason, "subscription"); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE subscription_periods SET closed_at=$2 WHERE subscription_id=$1 AND closed_at IS NULL`, sub.ID, at); err != nil {
		return nil, err
	}
	end := at.Add(time.Duration(change.Snapshot.DurationDays) * Day)
	contract := change.Snapshot.Contract
	if contract == nil {
		var err error
		contract, err = contractpricing.Capture(ctx, tx, change.Snapshot.Policy, order.PlanRevision, at)
		if err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE subscriptions SET plan_id=$2,plan_name_snapshot=$3,policy_snapshot=$4,daily_grant_cents=$5,price_snapshot=$6,duration_snapshot=$7,starts_at=$8,ends_at=$9,status='active',revision=revision+1 WHERE id=$1`, sub.ID, *change.TargetPlanID, change.Snapshot.PlanName, change.Snapshot.Policy, change.Snapshot.DailyPoints, change.Snapshot.PriceCents, change.Snapshot.DurationDays, at, end); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE subscriptions SET billing_contract=$2 WHERE id=$1`, sub.ID, contract); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO subscription_periods(subscription_id,order_id,starts_at,ends_at,grant_starts_on,grant_ends_on,next_grant_on,daily_grant_cents,cadence,next_grant_at,total_grants) VALUES($1,$2,$3,$4,($3 AT TIME ZONE 'Asia/Shanghai')::date,($3 AT TIME ZONE 'Asia/Shanghai')::date+$5::integer,($3 AT TIME ZONE 'Asia/Shanghai')::date,$6,'rolling_24h',$3,$5)`, sub.ID, order.ID, at, end, change.Snapshot.DurationDays, change.Snapshot.DailyPoints); err != nil {
		return nil, err
	}
	change.Snapshot.StartsAt, change.Snapshot.EndsAt = at, end
	if _, err := tx.Exec(ctx, `UPDATE subscription_changes SET status='completed',snapshot=$3,completed_at=$2,updated_at=$2 WHERE id=$1`, change.ID, at, change.Snapshot); err != nil {
		return nil, err
	}
	current, err := store.GetSubscription(ctx, tx, sub.ID)
	if err != nil {
		return nil, err
	}
	if err := grantRollingDue(ctx, tx, current, at); err != nil {
		return nil, err
	}
	if err := store.SetOrderSubscriptionPeriod(ctx, tx, order.ID, at, end); err != nil {
		return nil, err
	}
	change.Status = "completed"
	message := fmt.Sprintf("整期升级已完成，旧权益抵扣 ¥%d.%02d，旧未用积分已回收。新订阅从本次开通起计算完整 %d 天，首期到账 %d 积分。", credit.CreditCents/100, credit.CreditCents%100, change.Snapshot.DurationDays, change.Snapshot.DailyPoints)
	if err := store.RecordSubscriptionChange(ctx, tx, change, "upgrade_completed", nil, "", message, nil, at); err != nil {
		return nil, err
	}
	return current, nil
}
