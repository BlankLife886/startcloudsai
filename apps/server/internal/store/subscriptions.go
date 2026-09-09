package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const subscriptionCols = `id, user_id, plan_id, order_id, starts_at, ends_at, daily_grant_cents, last_granted_date, status, created_at,billing_version,policy_snapshot,plan_name_snapshot,price_snapshot,duration_snapshot,revision,billing_contract`

func scanSubscription(row pgx.Row) (*Subscription, error) {
	var s Subscription
	err := row.Scan(&s.ID, &s.UserID, &s.PlanID, &s.OrderID, &s.StartsAt, &s.EndsAt,
		&s.DailyGrantCents, &s.LastGrantedDate, &s.Status, &s.CreatedAt, &s.BillingVersion, &s.Policy, &s.PlanName, &s.PriceCents, &s.DurationDays, &s.Revision, &s.Contract)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func InsertSubscription(ctx context.Context, q Q, s *Subscription) (*Subscription, error) {
	return scanSubscription(q.QueryRow(ctx,
		`INSERT INTO subscriptions (user_id, plan_id, order_id, starts_at, ends_at, daily_grant_cents, status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING `+subscriptionCols,
		s.UserID, s.PlanID, s.OrderID, s.StartsAt, s.EndsAt, s.DailyGrantCents))
}

func GetSubscription(ctx context.Context, q Q, id uuid.UUID) (*Subscription, error) {
	s, err := scanSubscription(q.QueryRow(ctx,
		`SELECT `+subscriptionCols+` FROM subscriptions WHERE id = $1`, id))
	return nilOnNoRows(s, err)
}

func HasBlockingSubscription(ctx context.Context, q Q, userID uuid.UUID, at time.Time) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscriptions WHERE user_id=$1 AND (status='refunding' OR (status='active' AND ends_at>$2)))`, userID, at).Scan(&exists)
	return exists, err
}

// GetActiveSubscriptionForPlanLocked 取同 user+plan 的 active 订阅并加行锁（续购顺延用）。
func GetActiveSubscriptionForPlanLocked(ctx context.Context, q Q, userID, planID uuid.UUID) (*Subscription, error) {
	s, err := scanSubscription(q.QueryRow(ctx,
		`SELECT `+subscriptionCols+` FROM subscriptions
		 WHERE user_id = $1 AND plan_id = $2 AND status = 'active'
		 ORDER BY ends_at DESC LIMIT 1 FOR UPDATE`, userID, planID))
	return nilOnNoRows(s, err)
}

// ActiveSubscriptionFlagsByUserIDs 批量判断用户是否有未到期的 active 订阅。
func ActiveSubscriptionFlagsByUserIDs(ctx context.Context, q Q, ids []uuid.UUID, now time.Time) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
		SELECT DISTINCT user_id
		FROM subscriptions
		WHERE user_id = ANY($1) AND status = 'active' AND ends_at > $2`, ids, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// GetCurrentSubscription 用户当前生效订阅（active 且未到期，ends_at 最晚的一条）。
func GetCurrentSubscription(ctx context.Context, q Q, userID uuid.UUID, now time.Time) (*Subscription, error) {
	s, err := scanSubscription(q.QueryRow(ctx,
		`SELECT s.id,s.user_id,s.plan_id,s.order_id,s.starts_at,s.ends_at,
		 COALESCE((SELECT p.daily_grant_cents FROM subscription_periods p WHERE p.subscription_id=s.id AND p.closed_at IS NULL AND p.starts_at<=$2 AND p.ends_at>$2 ORDER BY p.starts_at DESC LIMIT 1),s.daily_grant_cents),
		 s.last_granted_date,s.status,s.created_at,s.billing_version,s.policy_snapshot,s.plan_name_snapshot,s.price_snapshot,s.duration_snapshot,s.revision,s.billing_contract FROM subscriptions s
		 WHERE user_id = $1 AND status = 'active' AND starts_at <= $2 AND ends_at > $2
		 ORDER BY ends_at DESC LIMIT 1`, userID, now))
	return nilOnNoRows(s, err)
}

// ExtendSubscription 顺延 ends_at（调用方持有行锁）。
func ExtendSubscription(ctx context.Context, q Q, id uuid.UUID, newEndsAt time.Time) error {
	_, err := q.Exec(ctx, `UPDATE subscriptions SET ends_at = $2 WHERE id = $1`, id, newEndsAt)
	return err
}

// ExpireSubscriptions 批量把已到期的 active 订阅置为 expired，返回条数。
func ExpireSubscriptions(ctx context.Context, q Q, now time.Time) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `WITH expired AS (
 UPDATE subscriptions SET status='expired' WHERE status='active' AND ends_at<=$1 RETURNING id,user_id,plan_name_snapshot,billing_version
), notices AS (
 INSERT INTO notifications(user_id,kind,title,body,source_type,source_id,target_path)
 SELECT user_id,'order','订阅已到期',CASE WHEN billing_version=2 THEN '订阅已到期，未用周期额度已失效，不再重置新额度。原任务按预留来源结算，通用积分不受影响。' ELSE '历史订阅已到期，不再发放新的周期积分；历史通用积分按原规则保留。' END,'subscription_expired',id,'/subscriptions?subscription='||id::text FROM expired
 ON CONFLICT(source_type,source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL DO NOTHING
) SELECT count(*) FROM expired`, now).Scan(&count)
	return count, err
}

// ListSubscriptionsDueGrant 找出当日尚未发放的 active 未过期订阅。
// today 为北京时间日期字符串（YYYY-MM-DD）。
func ListSubscriptionsDueGrant(ctx context.Context, q Q, now time.Time, today string) ([]*Subscription, error) {
	rows, err := q.Query(ctx,
		`SELECT `+subscriptionCols+` FROM subscriptions
		 WHERE status = 'active' AND ends_at >= $1
		   AND (last_granted_date IS NULL OR last_granted_date < $2::date)
		 ORDER BY created_at`, now, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Subscription
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// SetSubscriptionGrantedDate 记录发放日（YYYY-MM-DD，北京时间日界）。
func SetSubscriptionGrantedDate(ctx context.Context, q Q, id uuid.UUID, date string) error {
	_, err := q.Exec(ctx,
		`UPDATE subscriptions SET last_granted_date = GREATEST(last_granted_date, $2::date) WHERE id = $1`, id, date)
	return err
}
