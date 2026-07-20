package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const subscriptionCols = `id, user_id, plan_id, order_id, starts_at, ends_at, daily_grant_cents, last_granted_date, status, created_at`

func scanSubscription(row pgx.Row) (*Subscription, error) {
	var s Subscription
	err := row.Scan(&s.ID, &s.UserID, &s.PlanID, &s.OrderID, &s.StartsAt, &s.EndsAt,
		&s.DailyGrantCents, &s.LastGrantedDate, &s.Status, &s.CreatedAt)
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

// GetActiveSubscriptionForPlanLocked 取同 user+plan 的 active 订阅并加行锁（续购顺延用）。
func GetActiveSubscriptionForPlanLocked(ctx context.Context, q Q, userID, planID uuid.UUID) (*Subscription, error) {
	s, err := scanSubscription(q.QueryRow(ctx,
		`SELECT `+subscriptionCols+` FROM subscriptions
		 WHERE user_id = $1 AND plan_id = $2 AND status = 'active'
		 ORDER BY ends_at DESC LIMIT 1 FOR UPDATE`, userID, planID))
	return nilOnNoRows(s, err)
}

// GetCurrentSubscription 用户当前生效订阅（active 且未到期，ends_at 最晚的一条）。
func GetCurrentSubscription(ctx context.Context, q Q, userID uuid.UUID, now time.Time) (*Subscription, error) {
	s, err := scanSubscription(q.QueryRow(ctx,
		`SELECT `+subscriptionCols+` FROM subscriptions
		 WHERE user_id = $1 AND status = 'active' AND ends_at > $2
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
	tag, err := q.Exec(ctx,
		`UPDATE subscriptions SET status = 'expired' WHERE status = 'active' AND ends_at < $1`, now)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
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
		`UPDATE subscriptions SET last_granted_date = $2::date WHERE id = $1`, id, date)
	return err
}
