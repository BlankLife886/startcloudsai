package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// UserOrderSummary 用户管理列表里的“充值订单”摘要：只统计已到账（有收款时间）的订单，
// 金额按实际支付金额（没有则用订单金额），与订单看板口径一致；后台移除的订单不计。
type UserOrderSummary struct {
	PaidCount         int64      `json:"paidCount"`
	PaidCents         int64      `json:"paidCents"`
	TopupCount        int64      `json:"topupCount"`
	TopupCents        int64      `json:"topupCents"`
	SubscriptionCount int64      `json:"subscriptionCount"`
	SubscriptionCents int64      `json:"subscriptionCents"`
	PendingCount      int64      `json:"pendingCount"`
	LastPaidAt        *time.Time `json:"lastPaidAt"`
}

func OrderSummariesByUserIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]UserOrderSummary, error) {
	out := make(map[uuid.UUID]UserOrderSummary, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `WITH live AS (
  SELECT o.user_id, o.status, o.paid_at,
         COALESCE(o.provider_pay_amount_cents, o.amount_cents) AS cents,
         COALESCE(o.plan_kind_snapshot, p.kind) AS kind,
         `+receiptAtSQL+` AS received_at
  FROM orders o JOIN plans p ON p.id = o.plan_id
  WHERE o.user_id = ANY($1) AND o.admin_deleted_at IS NULL
)
SELECT user_id,
  count(*) FILTER (WHERE received_at IS NOT NULL),
  COALESCE(sum(cents) FILTER (WHERE received_at IS NOT NULL), 0),
  count(*) FILTER (WHERE received_at IS NOT NULL AND kind = 'topup'),
  COALESCE(sum(cents) FILTER (WHERE received_at IS NOT NULL AND kind = 'topup'), 0),
  count(*) FILTER (WHERE received_at IS NOT NULL AND kind = 'subscription'),
  COALESCE(sum(cents) FILTER (WHERE received_at IS NOT NULL AND kind = 'subscription'), 0),
  count(*) FILTER (WHERE status = 'pending' AND paid_at IS NULL),
  max(received_at)
FROM live GROUP BY user_id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var s UserOrderSummary
		if err := rows.Scan(&id, &s.PaidCount, &s.PaidCents, &s.TopupCount, &s.TopupCents,
			&s.SubscriptionCount, &s.SubscriptionCents, &s.PendingCount, &s.LastPaidAt); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}

// UserSubscriptionSummary 用户最近的一条订阅：优先取生效中的（active 且未到期），
// 没有则取最近结束的那条。
type UserSubscriptionSummary struct {
	Active   bool      `json:"active"`
	Status   string    `json:"status"`
	PlanName string    `json:"planName"`
	StartsAt time.Time `json:"startsAt"`
	EndsAt   time.Time `json:"endsAt"`
	Total    int64     `json:"total"`
}

func LatestSubscriptionsByUserIDs(ctx context.Context, q Q, ids []uuid.UUID, now time.Time) (map[uuid.UUID]UserSubscriptionSummary, error) {
	out := make(map[uuid.UUID]UserSubscriptionSummary, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT DISTINCT ON (s.user_id)
  s.user_id,
  s.status = 'active' AND s.ends_at > $2,
  s.status,
  COALESCE(NULLIF(s.plan_name_snapshot, ''), p.name, ''),
  s.starts_at, s.ends_at,
  count(*) OVER (PARTITION BY s.user_id)
FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
WHERE s.user_id = ANY($1)
ORDER BY s.user_id, (s.status = 'active' AND s.ends_at > $2) DESC, s.ends_at DESC`, ids, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var s UserSubscriptionSummary
		if err := rows.Scan(&id, &s.Active, &s.Status, &s.PlanName, &s.StartsAt, &s.EndsAt, &s.Total); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}
