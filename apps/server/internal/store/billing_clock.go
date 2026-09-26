package store

import (
	"context"
	"github.com/google/uuid"
	"time"
)

type billingClockKey struct{}

func WithBillingClock(ctx context.Context, clock func() time.Time) context.Context {
	return context.WithValue(ctx, billingClockKey{}, clock)
}

func WithBillingTime(ctx context.Context, at time.Time) context.Context {
	return WithBillingClock(ctx, func() time.Time { return at })
}

func BillingTime(ctx context.Context) time.Time {
	if clock, ok := ctx.Value(billingClockKey{}).(func() time.Time); ok {
		return clock().UTC()
	}
	return time.Now().UTC()
}

func ExpireSubscriptionCredits(ctx context.Context, q Q, userID uuid.UUID, at time.Time) error {
	_, err := q.Exec(ctx, `SELECT expire_subscription_credit_lots($1,$2)`, userID, at)
	return err
}
