package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestUserOrderAndSubscriptionSummaries(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	now := time.Now().UTC()

	buyer, err := store.InsertUser(ctx, st.Pool, "summary-"+uuid.NewString()+"@test.dev", "buyer", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	lapsed, err := store.InsertUser(ctx, st.Pool, "summary-"+uuid.NewString()+"@test.dev", "lapsed", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	idle, err := store.InsertUser(ctx, st.Pool, "summary-"+uuid.NewString()+"@test.dev", "idle", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	topup, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: "t-" + uuid.NewString()[:6], Name: "充值包", Kind: "topup", PriceCents: 990, GrantCents: 1000, Active: true})
	if err != nil {
		t.Fatal(err)
	}
	sub, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: "s-" + uuid.NewString()[:6], Name: "月度会员", Kind: "subscription", PriceCents: 2900, DurationDays: 30, DailyGrantCents: 100, Active: true})
	if err != nil {
		t.Fatal(err)
	}

	addOrder := func(userID uuid.UUID, plan *store.Plan, status string, paidAt *time.Time, payCents *int64, deleted bool) uuid.UUID {
		t.Helper()
		order, err := store.InsertOrder(ctx, st.Pool, userID, plan.ID, plan.PriceCents, plan.GrantCents, 0, "lanjing")
		if err != nil {
			t.Fatal(err)
		}
		var deletedAt *time.Time
		if deleted {
			deletedAt = &now
		}
		if _, err := st.Pool.Exec(ctx, `UPDATE orders SET status=$2::text,paid_at=$3::timestamptz,
 completed_at=CASE WHEN $2::text='completed' THEN COALESCE($3::timestamptz,now()) END,
 provider_pay_amount_cents=$4,admin_deleted_at=$5 WHERE id=$1`, order.ID, status, paidAt, payCents, deletedAt); err != nil {
			t.Fatal(err)
		}
		return order.ID
	}
	ago := func(d time.Duration) *time.Time { v := now.Add(-d); return &v }
	cents := func(v int64) *int64 { return &v }

	addOrder(buyer.ID, topup, "completed", ago(48*time.Hour), nil, false)          // 9.90
	addOrder(buyer.ID, topup, "completed", ago(time.Hour), cents(1000), false)     // actually paid 10.00
	subOrder := addOrder(buyer.ID, sub, "completed", ago(2*time.Hour), nil, false) // 29.00
	addOrder(buyer.ID, topup, "pending", nil, nil, false)                          // awaiting payment
	addOrder(buyer.ID, topup, "expired", nil, nil, false)                          // closed, never paid
	addOrder(buyer.ID, topup, "completed", ago(time.Hour), nil, true)              // removed by admin

	if _, err := store.InsertSubscription(ctx, st.Pool, &store.Subscription{UserID: buyer.ID, PlanID: sub.ID, OrderID: &subOrder,
		StartsAt: now.Add(-2 * time.Hour), EndsAt: now.Add(30 * 24 * time.Hour), DailyGrantCents: 100}); err != nil {
		t.Fatal(err)
	}
	old, err := store.InsertSubscription(ctx, st.Pool, &store.Subscription{UserID: lapsed.ID, PlanID: sub.ID,
		StartsAt: now.Add(-60 * 24 * time.Hour), EndsAt: now.Add(-30 * 24 * time.Hour), DailyGrantCents: 100})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE subscriptions SET status='expired' WHERE id=$1`, old.ID); err != nil {
		t.Fatal(err)
	}

	ids := []uuid.UUID{buyer.ID, lapsed.ID, idle.ID}
	orders, err := store.OrderSummariesByUserIDs(ctx, st.Pool, ids)
	if err != nil {
		t.Fatal(err)
	}
	got := orders[buyer.ID]
	if got.PaidCount != 3 || got.PaidCents != 990+1000+2900 {
		t.Fatalf("paid = %d / %d, want 3 / 4890", got.PaidCount, got.PaidCents)
	}
	if got.TopupCount != 2 || got.TopupCents != 1990 || got.SubscriptionCount != 1 || got.SubscriptionCents != 2900 {
		t.Fatalf("split = %+v", got)
	}
	if got.PendingCount != 1 {
		t.Fatalf("pending = %d, want 1", got.PendingCount)
	}
	if got.LastPaidAt == nil || got.LastPaidAt.Before(now.Add(-time.Hour-time.Minute)) {
		t.Fatalf("lastPaidAt = %v", got.LastPaidAt)
	}
	if _, found := orders[idle.ID]; found {
		t.Fatalf("user without orders should have no summary")
	}

	subs, err := store.LatestSubscriptionsByUserIDs(ctx, st.Pool, ids, now)
	if err != nil {
		t.Fatal(err)
	}
	if s := subs[buyer.ID]; !s.Active || s.PlanName != "月度会员" || s.Total != 1 {
		t.Fatalf("buyer subscription = %+v", s)
	}
	if s := subs[lapsed.ID]; s.Active || s.Status != "expired" || s.PlanName != "月度会员" {
		t.Fatalf("lapsed subscription = %+v", s)
	}
	if _, found := subs[idle.ID]; found {
		t.Fatalf("user without subscriptions should have no summary")
	}
}
