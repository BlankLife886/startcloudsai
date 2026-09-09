// Package subscription 实现订阅期管理：开通/续期（顺延）、每日发放与过期回收。
//
// 每日发放以北京时间日界，ledger 幂等键 ('grant','subscription_daily', subId/YYYY-MM-DD)，
// 与 wallet 包相同的幂等入账模式；发放与 last_granted_date 更新同一事务。
package subscription

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

// beijing 北京时间日界（固定 UTC+8，无夏令时）。
var beijing = time.FixedZone("Asia/Shanghai", 8*3600)

// BeijingDate 返回北京时间的日期（YYYY-MM-DD）。
func BeijingDate(t time.Time) string {
	return t.In(beijing).Format("2006-01-02")
}

func strPtr(s string) *string { return &s }

// ApplyOrder 订阅型订单完成时开通/续期（调用方事务内）：
// 同 user+plan 已有 active 订阅 → ends_at 顺延 durationDays；否则新建。
// 首日额度同事务立即发放（幂等，续购当日已发放则跳过）。
func ApplyOrder(ctx context.Context, tx pgx.Tx, order *store.Order, plan *store.Plan, now time.Time) (*store.Subscription, error) {
	ctx = store.WithBillingTime(ctx, now)
	if order.SubscriptionPolicy.Version == 2 {
		return applyRollingOrder(ctx, tx, order, plan, now)
	}
	if plan.DurationDays <= 0 || plan.DailyGrantCents <= 0 {
		return nil, fmt.Errorf("invalid subscription terms for plan %s", plan.ID)
	}
	// Serializes first purchases as well as renewals; an absent row cannot be row-locked.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "subscription:"+order.UserID.String()+":"+plan.ID.String()); err != nil {
		return nil, err
	}
	previous, err := store.GetSubscriptionPeriodForOrder(ctx, tx, order.ID)
	if err != nil {
		return nil, err
	}
	if previous != nil {
		return store.GetSubscription(ctx, tx, previous.SubscriptionID)
	}
	existing, err := store.GetActiveSubscriptionForPlanLocked(ctx, tx, order.UserID, plan.ID)
	if err != nil {
		return nil, err
	}
	start := now.UTC()
	var sub *store.Subscription
	if existing != nil && existing.EndsAt.After(now) {
		if err := store.InsertLegacySubscriptionPeriod(ctx, tx, existing.ID); err != nil {
			return nil, err
		}
		start = existing.EndsAt
		if err := store.ExtendSubscription(ctx, tx, existing.ID, start.AddDate(0, 0, plan.DurationDays)); err != nil {
			return nil, err
		}
		sub, err = store.GetSubscription(ctx, tx, existing.ID)
	} else {
		sub, err = store.InsertSubscription(ctx, tx, &store.Subscription{UserID: order.UserID, PlanID: plan.ID, OrderID: &order.ID,
			StartsAt: start, EndsAt: start.AddDate(0, 0, plan.DurationDays), DailyGrantCents: plan.DailyGrantCents})
	}
	if err != nil {
		return nil, err
	}
	grantStart, _ := time.Parse("2006-01-02", BeijingDate(start))
	_, err = store.InsertSubscriptionPeriod(ctx, tx, &store.SubscriptionPeriod{SubscriptionID: sub.ID, OrderID: &order.ID,
		StartsAt: start, EndsAt: start.AddDate(0, 0, plan.DurationDays), GrantStartsOn: grantStart,
		GrantEndsOn: grantStart.AddDate(0, 0, plan.DurationDays), DailyGrantCents: plan.DailyGrantCents})
	if err != nil {
		return nil, err
	}
	active, err := store.GetSubscriptionPeriodAt(ctx, tx, sub.ID, now)
	if err != nil {
		return nil, err
	}
	today, _ := time.Parse("2006-01-02", BeijingDate(now))
	if active != nil && !today.Before(active.GrantStartsOn) && today.Before(active.GrantEndsOn) {
		current := *sub
		current.DailyGrantCents = active.DailyGrantCents
		if err := GrantDaily(ctx, tx, &current, today.Format("2006-01-02")); err != nil {
			return nil, err
		}
		if active.NextGrantOn.Equal(today) {
			if err := store.AdvanceSubscriptionPeriod(ctx, tx, active.ID, today.AddDate(0, 0, 1)); err != nil {
				return nil, err
			}
		}
	}
	return sub, nil
}

// GrantDaily 发放某订阅某日的额度并更新 last_granted_date（调用方事务内，幂等）。
func GrantDaily(ctx context.Context, tx pgx.Tx, sub *store.Subscription, date string) error {
	sourceID := fmt.Sprintf("%s/%s", sub.ID, date)
	reason := fmt.Sprintf("订阅每日发放（%s）", date)
	if _, err := wallet.Grant(ctx, tx, sub.UserID, sub.DailyGrantCents,
		"grant", "subscription_daily", sourceID, strPtr(reason)); err != nil {
		return err
	}
	return store.SetSubscriptionGrantedDate(ctx, tx, sub.ID, date)
}

// GrantedOn 判断订阅在指定日期（YYYY-MM-DD）是否已发放。
func GrantedOn(sub *store.Subscription, date string) bool {
	return sub.LastGrantedDate != nil && sub.LastGrantedDate.Format("2006-01-02") >= date
}

// Tick catches up bounded batches, including expired periods, before retiring subscriptions.
func Tick(ctx context.Context, st *store.Store, now time.Time) error {
	ctx = store.WithBillingTime(ctx, now)
	rollingErr := tickRolling(ctx, st, now)
	rows, expiryErr := st.Pool.Query(ctx, `SELECT DISTINCT user_id FROM subscription_credit_lots WHERE available_points>0 AND expires_at<=$1 AND NOT refund_hold AND NOT upgrade_hold LIMIT 200`, now)
	if expiryErr == nil {
		var users []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if expiryErr = rows.Scan(&id); expiryErr != nil {
				break
			}
			users = append(users, id)
		}
		if expiryErr == nil {
			expiryErr = rows.Err()
		}
		rows.Close()
		for _, id := range users {
			expiryErr = errors.Join(expiryErr, store.ExpireSubscriptionCredits(ctx, st.Pool, id, now))
		}
	}
	rollingErr = errors.Join(rollingErr, expiryErr)
	today, _ := time.Parse("2006-01-02", BeijingDate(now))
	due, err := store.ListSubscriptionPeriodsDue(ctx, st.Pool, now, BeijingDate(now), 200)
	if err != nil {
		return errors.Join(rollingErr, err)
	}
	var failures []error
	if rollingErr != nil {
		failures = append(failures, rollingErr)
	}
	for _, candidate := range due {
		grant := func() error {
			return st.Tx(ctx, func(tx pgx.Tx) error {
				// Keep lock order consistent with ApplyOrder: subscription, period, wallet.
				sub, err := store.GetSubscriptionForUpdate(ctx, tx, candidate.SubscriptionID)
				if err != nil {
					return err
				}
				if sub == nil {
					return nil
				}
				period, err := store.GetSubscriptionPeriodForUpdate(ctx, tx, candidate.ID)
				if err != nil {
					return err
				}
				if period == nil || period.StartsAt.After(now) {
					return nil
				}
				date := period.NextGrantOn
				current := *sub
				current.DailyGrantCents = period.DailyGrantCents
				for n := 0; n < 60 && !date.After(today) && date.Before(period.GrantEndsOn); n++ {
					if err := GrantDaily(ctx, tx, &current, date.Format("2006-01-02")); err != nil {
						return err
					}
					date = date.AddDate(0, 0, 1)
				}
				if err := store.AdvanceSubscriptionPeriod(ctx, tx, period.ID, date); err != nil {
					return err
				}
				if !now.Before(period.StartsAt) && now.Before(period.EndsAt) {
					_, err = tx.Exec(ctx, `UPDATE subscriptions SET daily_grant_cents=$2 WHERE id=$1`, sub.ID, period.DailyGrantCents)
				}
				return err
			})
		}
		if err := grant(); err != nil {
			if store.IsUniqueViolation(err, "uq_wallet_ledger_idem") {
				err = grant()
			}
			if err != nil {
				log.Printf("subscription period %s grant failed: %v", candidate.ID, err)
				failures = append(failures, err)
			}
		}
	}
	if _, err := store.ExpireSubscriptions(ctx, st.Pool, now); err != nil {
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}
