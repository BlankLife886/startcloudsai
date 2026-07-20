// 订阅：开通 + 首日发放 / 续购顺延 / 每日发放幂等（北京日界）/ 过期回收。
package subscription_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func newUser(t *testing.T, st *store.Store) *store.User {
	t.Helper()
	ctx := context.Background()
	email := fmt.Sprintf("u-%s@test.dev", uuid.NewString()[:8])
	user, err := store.InsertUser(ctx, st.Pool, email, "tester", "x", "user", nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
	return user
}

func newSubPlan(t *testing.T, st *store.Store, days int, daily int64) *store.Plan {
	t.Helper()
	plan, err := store.InsertPlan(context.Background(), st.Pool, &store.Plan{
		Code: "sub-" + uuid.NewString()[:6], Name: "月度订阅", Kind: "subscription",
		PriceCents: 2900, DurationDays: days, DailyGrantCents: daily, Active: true,
	})
	if err != nil {
		t.Fatalf("insert plan: %v", err)
	}
	return plan
}

func newOrder(t *testing.T, st *store.Store, userID uuid.UUID, plan *store.Plan) *store.Order {
	t.Helper()
	order, err := store.InsertOrder(context.Background(), st.Pool, userID, plan.ID,
		plan.PriceCents, plan.GrantCents, plan.BonusCents, "mock")
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}
	return order
}

func balance(t *testing.T, st *store.Store, userID uuid.UUID) int64 {
	t.Helper()
	w, err := store.GetWallet(context.Background(), st.Pool, userID)
	if err != nil || w == nil {
		t.Fatalf("get wallet: %v", err)
	}
	return w.BalanceCents
}

func applyOrder(t *testing.T, st *store.Store, order *store.Order, plan *store.Plan, now time.Time) *store.Subscription {
	t.Helper()
	var sub *store.Subscription
	err := st.Tx(context.Background(), func(tx pgx.Tx) error {
		var aerr error
		sub, aerr = subscription.ApplyOrder(context.Background(), tx, order, plan, now)
		return aerr
	})
	if err != nil {
		t.Fatalf("apply order: %v", err)
	}
	return sub
}

func TestApplyOrderCreatesAndExtends(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 30, 100)
	now := time.Now().UTC()

	// 开通：新建订阅 + 首日发放
	sub := applyOrder(t, st, newOrder(t, st, user.ID, plan), plan, now)
	wantEnds := now.Add(30 * 24 * time.Hour)
	if sub.EndsAt.Sub(wantEnds).Abs() > time.Second {
		t.Fatalf("ends_at = %v, want %v", sub.EndsAt, wantEnds)
	}
	if balance(t, st, user.ID) != 100 {
		t.Fatalf("balance = %d, want 100 (first-day grant)", balance(t, st, user.ID))
	}

	// 同日续购：ends_at 顺延 30 天，首日额度不重复发（幂等键同日）
	sub2 := applyOrder(t, st, newOrder(t, st, user.ID, plan), plan, now)
	if sub2.ID != sub.ID {
		t.Fatalf("renewal should extend existing subscription, got new %s", sub2.ID)
	}
	wantEnds = now.Add(60 * 24 * time.Hour)
	if sub2.EndsAt.Sub(wantEnds).Abs() > time.Second {
		t.Fatalf("extended ends_at = %v, want %v", sub2.EndsAt, wantEnds)
	}
	if balance(t, st, user.ID) != 100 {
		t.Fatalf("balance = %d, want 100 (no double grant same day)", balance(t, st, user.ID))
	}
	var count int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM subscriptions WHERE user_id = $1`, user.ID).Scan(&count); err != nil {
		t.Fatalf("count subs: %v", err)
	}
	if count != 1 {
		t.Fatalf("subscriptions = %d, want 1", count)
	}
}

func TestTickDailyGrantIdempotentAndNextDay(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 30, 100)
	now := time.Now().UTC()
	sub := applyOrder(t, st, newOrder(t, st, user.ID, plan), plan, now)

	// 当日重复 Tick：已发放，不重复入账
	for range 2 {
		if err := subscription.Tick(ctx, st, now); err != nil {
			t.Fatalf("tick: %v", err)
		}
	}
	if balance(t, st, user.ID) != 100 {
		t.Fatalf("balance = %d, want 100 after same-day ticks", balance(t, st, user.ID))
	}

	// 次日 Tick：发放第二笔，幂等键 subId/日期
	nextDay := now.Add(24 * time.Hour)
	if err := subscription.Tick(ctx, st, nextDay); err != nil {
		t.Fatalf("next-day tick: %v", err)
	}
	if balance(t, st, user.ID) != 200 {
		t.Fatalf("balance = %d, want 200 after next-day tick", balance(t, st, user.ID))
	}
	var sourceID string
	wantKey := fmt.Sprintf("%s/%s", sub.ID, subscription.BeijingDate(nextDay))
	if err := st.Pool.QueryRow(ctx,
		`SELECT source_id FROM wallet_ledger WHERE kind = 'grant' AND source_type = 'subscription_daily' AND source_id = $1`,
		wantKey).Scan(&sourceID); err != nil {
		t.Fatalf("expected ledger key %s: %v", wantKey, err)
	}
	// 次日重复：仍幂等
	if err := subscription.Tick(ctx, st, nextDay); err != nil {
		t.Fatalf("next-day replay tick: %v", err)
	}
	if balance(t, st, user.ID) != 200 {
		t.Fatalf("balance = %d, want 200 after replay", balance(t, st, user.ID))
	}
}

func TestTickExpiresEndedSubscriptions(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 30, 100)
	now := time.Now().UTC()
	sub := applyOrder(t, st, newOrder(t, st, user.ID, plan), plan, now)

	// 30 天后 +1h：订阅到期 → expired，且不再发放
	after := now.Add(30*24*time.Hour + time.Hour)
	if err := subscription.Tick(ctx, st, after); err != nil {
		t.Fatalf("tick after expiry: %v", err)
	}
	fresh, err := store.GetSubscription(ctx, st.Pool, sub.ID)
	if err != nil || fresh == nil {
		t.Fatalf("get sub: %v", err)
	}
	if fresh.Status != "expired" {
		t.Fatalf("status = %s, want expired", fresh.Status)
	}
	if balance(t, st, user.ID) != 100 {
		t.Fatalf("balance = %d, want 100 (only first-day grant)", balance(t, st, user.ID))
	}
	// 过期后当前订阅查询返回空
	current, err := store.GetCurrentSubscription(ctx, st.Pool, user.ID, after)
	if err != nil {
		t.Fatalf("get current: %v", err)
	}
	if current != nil {
		t.Fatalf("current = %v, want nil after expiry", current.ID)
	}
}
