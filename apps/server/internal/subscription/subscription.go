// Package subscription 实现订阅期管理：开通/续期（顺延）、每日发放与过期回收。
//
// 每日发放以北京时间日界，ledger 幂等键 ('grant','subscription_daily', subId/YYYY-MM-DD)，
// 与 wallet 包相同的幂等入账模式；发放与 last_granted_date 更新同一事务。
package subscription

import (
	"context"
	"fmt"
	"log"
	"time"

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
	if plan.DurationDays <= 0 || plan.DailyGrantCents <= 0 {
		return nil, fmt.Errorf("plan %s 不是有效的订阅套餐（durationDays=%d, dailyGrantCents=%d）",
			plan.ID, plan.DurationDays, plan.DailyGrantCents)
	}
	duration := time.Duration(plan.DurationDays) * 24 * time.Hour

	existing, err := store.GetActiveSubscriptionForPlanLocked(ctx, tx, order.UserID, plan.ID)
	if err != nil {
		return nil, err
	}
	var sub *store.Subscription
	if existing != nil && existing.EndsAt.After(now) {
		// 续购同套餐：ends_at 顺延
		if err := store.ExtendSubscription(ctx, tx, existing.ID, existing.EndsAt.Add(duration)); err != nil {
			return nil, err
		}
		sub, err = store.GetSubscription(ctx, tx, existing.ID)
		if err != nil {
			return nil, err
		}
	} else {
		orderID := order.ID
		sub, err = store.InsertSubscription(ctx, tx, &store.Subscription{
			UserID:          order.UserID,
			PlanID:          plan.ID,
			OrderID:         &orderID,
			StartsAt:        now,
			EndsAt:          now.Add(duration),
			DailyGrantCents: plan.DailyGrantCents,
		})
		if err != nil {
			return nil, err
		}
	}
	// 首日开通立即发放当日额度（幂等键含日期，续购重复发放无害）
	if err := GrantDaily(ctx, tx, sub, BeijingDate(now)); err != nil {
		return nil, err
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

// Tick worker 定时入口（@every 10m）：先回收过期订阅，再给当日未发放的
// active 订阅逐条发放（每条独立事务，失败不影响其他订阅）。
func Tick(ctx context.Context, st *store.Store, now time.Time) error {
	nowUTC := now.UTC()
	expired, err := store.ExpireSubscriptions(ctx, st.Pool, nowUTC)
	if err != nil {
		return err
	}
	if expired > 0 {
		log.Printf("expired %d subscriptions", expired)
	}

	today := BeijingDate(now)
	due, err := store.ListSubscriptionsDueGrant(ctx, st.Pool, nowUTC, today)
	if err != nil {
		return err
	}
	for _, sub := range due {
		grant := func() error {
			return st.Tx(ctx, func(tx pgx.Tx) error {
				return GrantDaily(ctx, tx, sub, today)
			})
		}
		err := grant()
		if err != nil && store.IsUniqueViolation(err, "uq_wallet_ledger_idem") {
			// 并发竞态：重试命中 Grant 前置幂等检查
			err = grant()
		}
		if err != nil {
			log.Printf("subscription %s daily grant failed: %v", sub.ID, err)
			continue
		}
		log.Printf("subscription %s granted %d cents for %s", sub.ID, sub.DailyGrantCents, today)
	}
	return nil
}
