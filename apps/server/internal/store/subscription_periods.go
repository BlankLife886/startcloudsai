package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type SubscriptionPeriod struct {
	ID              uuid.UUID
	SubscriptionID  uuid.UUID
	OrderID         *uuid.UUID
	StartsAt        time.Time
	EndsAt          time.Time
	GrantStartsOn   time.Time
	GrantEndsOn     time.Time
	NextGrantOn     time.Time
	DailyGrantCents int64
}

const periodCols = `id, subscription_id, order_id, starts_at, ends_at, grant_starts_on, grant_ends_on, next_grant_on, daily_grant_cents`

func scanSubscriptionPeriod(row pgx.Row) (*SubscriptionPeriod, error) {
	var p SubscriptionPeriod
	err := row.Scan(&p.ID, &p.SubscriptionID, &p.OrderID, &p.StartsAt, &p.EndsAt, &p.GrantStartsOn, &p.GrantEndsOn, &p.NextGrantOn, &p.DailyGrantCents)
	return nilOnNoRows(&p, err)
}

func GetSubscriptionForUpdate(ctx context.Context, q Q, id uuid.UUID) (*Subscription, error) {
	s, err := scanSubscription(q.QueryRow(ctx, `SELECT `+subscriptionCols+` FROM subscriptions WHERE id=$1 FOR UPDATE`, id))
	return nilOnNoRows(s, err)
}

func GetSubscriptionPeriodForOrder(ctx context.Context, q Q, orderID uuid.UUID) (*SubscriptionPeriod, error) {
	return scanSubscriptionPeriod(q.QueryRow(ctx, `SELECT `+periodCols+` FROM subscription_periods WHERE order_id=$1`, orderID))
}

func InsertLegacySubscriptionPeriod(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `INSERT INTO subscription_periods (subscription_id,starts_at,ends_at,grant_starts_on,grant_ends_on,next_grant_on,daily_grant_cents)
 SELECT id,starts_at,ends_at,(starts_at AT TIME ZONE 'Asia/Shanghai')::date,
 GREATEST((ends_at AT TIME ZONE 'Asia/Shanghai')::date,(starts_at AT TIME ZONE 'Asia/Shanghai')::date+1),
 (starts_at AT TIME ZONE 'Asia/Shanghai')::date,daily_grant_cents FROM subscriptions
 WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM subscription_periods WHERE subscription_id=$1) ON CONFLICT DO NOTHING`, id)
	return err
}

func InsertSubscriptionPeriod(ctx context.Context, q Q, p *SubscriptionPeriod) (*SubscriptionPeriod, error) {
	return scanSubscriptionPeriod(q.QueryRow(ctx, `INSERT INTO subscription_periods
 (subscription_id,order_id,starts_at,ends_at,grant_starts_on,grant_ends_on,next_grant_on,daily_grant_cents)
 VALUES($1,$2,$3,$4,$5,$6,$5,$7) RETURNING `+periodCols, p.SubscriptionID, p.OrderID, p.StartsAt, p.EndsAt, p.GrantStartsOn, p.GrantEndsOn, p.DailyGrantCents))
}

func GetSubscriptionPeriodForUpdate(ctx context.Context, q Q, id uuid.UUID) (*SubscriptionPeriod, error) {
	return scanSubscriptionPeriod(q.QueryRow(ctx, `SELECT `+periodCols+` FROM subscription_periods WHERE id=$1 FOR UPDATE`, id))
}

func GetSubscriptionPeriodAt(ctx context.Context, q Q, id uuid.UUID, now time.Time) (*SubscriptionPeriod, error) {
	return scanSubscriptionPeriod(q.QueryRow(ctx, `SELECT `+periodCols+` FROM subscription_periods
 WHERE subscription_id=$1 AND starts_at<=$2 AND ends_at>$2 ORDER BY starts_at DESC LIMIT 1`, id, now))
}

func AdvanceSubscriptionPeriod(ctx context.Context, q Q, id uuid.UUID, next time.Time) error {
	_, err := q.Exec(ctx, `UPDATE subscription_periods SET next_grant_on=GREATEST(next_grant_on,$2::date) WHERE id=$1`, id, next)
	return err
}

func ListSubscriptionPeriodsDue(ctx context.Context, q Q, now time.Time, today string, limit int) ([]*SubscriptionPeriod, error) {
	rows, err := q.Query(ctx, `SELECT `+periodCols+` FROM subscription_periods p
 WHERE p.cadence='legacy_day' AND p.starts_at<=$1 AND p.next_grant_on< p.grant_ends_on AND p.next_grant_on<=$2::date
 AND EXISTS(SELECT 1 FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.id=p.subscription_id AND u.deleted_at IS NULL)
 ORDER BY p.next_grant_on,p.id LIMIT $3`, now, today, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*SubscriptionPeriod{}
	for rows.Next() {
		p, err := scanSubscriptionPeriod(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
