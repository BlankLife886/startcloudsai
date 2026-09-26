package subscription_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/migrations"
	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func TestRenewalKeepsOldRateUntilPurchasedPeriodStarts(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 2, 100)
	now := time.Date(2026, 1, 1, 2, 0, 0, 0, time.UTC)
	first := newOrder(t, st, user.ID, plan)
	sub := applyOrder(t, st, first, plan, now)
	changed := *plan
	changed.DurationDays = 3
	changed.DailyGrantCents = 900
	if _, err := st.Pool.Exec(ctx, `UPDATE plans SET duration_days=3,daily_grant_cents=900 WHERE id=$1`, plan.ID); err != nil {
		t.Fatal(err)
	}
	renewed := applyOrder(t, st, newOrder(t, st, user.ID, &changed), &changed, now.Add(time.Hour))
	if renewed.ID != sub.ID || !renewed.EndsAt.Equal(now.AddDate(0, 0, 5)) {
		t.Fatalf("renewal=%+v", renewed)
	}
	if err := subscription.Tick(ctx, st, now.AddDate(0, 0, 2).Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if balance(t, st, user.ID) != 200 {
		t.Fatal("future rate applied before old period ended")
	}
	current, err := store.GetCurrentSubscription(ctx, st.Pool, user.ID, now.AddDate(0, 0, 1))
	if err != nil || current.DailyGrantCents != 100 {
		t.Fatalf("old current rate: %+v %v", current, err)
	}
	if err := subscription.Tick(ctx, st, now.AddDate(0, 0, 2).Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if balance(t, st, user.ID) != 1100 {
		t.Fatalf("new daily rate not applied: %d", balance(t, st, user.ID))
	}
	current, err = store.GetCurrentSubscription(ctx, st.Pool, user.ID, now.AddDate(0, 0, 2).Add(time.Minute))
	if err != nil || current.DailyGrantCents != 900 {
		t.Fatalf("new current rate: %+v %v", current, err)
	}
	for n := 0; n < 2; n++ {
		if err := subscription.Tick(ctx, st, now.AddDate(0, 0, 6)); err != nil {
			t.Fatal(err)
		}
	}
	if balance(t, st, user.ID) != 2900 {
		t.Fatalf("expected exactly 2*100+3*900, got %d", balance(t, st, user.ID))
	}
	repeated := applyOrder(t, st, first, plan, now.AddDate(0, 0, 7))
	if !repeated.EndsAt.Equal(renewed.EndsAt) {
		t.Fatal("order replay extended subscription")
	}
}

func TestCatchUpFillsHolesWithoutReplayingLaterCredits(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 5, 100)
	now := time.Date(2026, 2, 1, 3, 0, 0, 0, time.UTC)
	sub := applyOrder(t, st, newOrder(t, st, user.ID, plan), plan, now)
	// Simulate an old worker that skipped day two but granted day three.
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		return subscription.GrantDaily(ctx, tx, sub, subscription.BeijingDate(now.AddDate(0, 0, 2)))
	}); err != nil {
		t.Fatal(err)
	}
	if err := subscription.Tick(ctx, st, now.AddDate(0, 0, 3)); err != nil {
		t.Fatal(err)
	}
	if balance(t, st, user.ID) != 400 {
		t.Fatalf("hole recovery double/missed credits: %d", balance(t, st, user.ID))
	}
	fresh, err := store.GetSubscription(ctx, st.Pool, sub.ID)
	if err != nil || subscription.BeijingDate(*fresh.LastGrantedDate) != "2026-02-04" {
		t.Fatalf("grant marker moved backwards: %+v %v", fresh, err)
	}
}

func TestCatchUpUsesBoundedPersistentBatchesAfterExpiry(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 180, 10)
	now := time.Date(2025, 1, 1, 3, 0, 0, 0, time.UTC)
	applyOrder(t, st, newOrder(t, st, user.ID, plan), plan, now)
	after := now.AddDate(0, 0, 181)
	if err := subscription.Tick(ctx, st, after); err != nil {
		t.Fatal(err)
	}
	if balance(t, st, user.ID) != 610 {
		t.Fatalf("batch not bounded: %d", balance(t, st, user.ID))
	}
	for n := 0; n < 4; n++ {
		if err := subscription.Tick(ctx, st, after); err != nil {
			t.Fatal(err)
		}
	}
	if balance(t, st, user.ID) != 1800 {
		t.Fatalf("persistent catchup total: %d", balance(t, st, user.ID))
	}
}

func TestConcurrentFirstPurchasesShareOneSubscription(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 30, 100)
	orders := []*store.Order{newOrder(t, st, user.ID, plan), newOrder(t, st, user.ID, plan)}
	now := time.Now().UTC()
	results := make(chan error, 2)
	for _, order := range orders {
		go func(order *store.Order) {
			results <- st.Tx(ctx, func(tx pgx.Tx) error { _, err := subscription.ApplyOrder(ctx, tx, order, plan, now); return err })
		}(order)
	}
	for range orders {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM subscriptions WHERE user_id=$1`, user.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("subscriptions=%d %v", count, err)
	}
	current, err := store.GetCurrentSubscription(ctx, st.Pool, user.ID, now)
	if err != nil || current.EndsAt.Sub(now.AddDate(0, 0, 60)).Abs() > time.Second {
		t.Fatalf("duration: %+v %v", current, err)
	}
	if balance(t, st, user.ID) != 100 {
		t.Fatal("first day granted twice")
	}
}

func TestLegacySubscriptionMigrationPreservesRateAndFillsMissingDates(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 5, 100)
	now := time.Date(2026, 3, 1, 3, 0, 0, 0, time.UTC)
	sub := applyOrder(t, st, newOrder(t, st, user.ID, plan), plan, now)
	if err := st.Tx(ctx, func(tx pgx.Tx) error { return subscription.GrantDaily(ctx, tx, sub, "2026-03-03") }); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("pgx", st.Pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.DownTo(ctx, 123); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE plans SET daily_grant_cents=900 WHERE id=$1`, plan.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}
	if err := subscription.Tick(ctx, st, now.AddDate(0, 0, 6)); err != nil {
		t.Fatal(err)
	}
	if balance(t, st, user.ID) != 500 {
		t.Fatalf("legacy replay changed rate or duplicated ledger: %d", balance(t, st, user.ID))
	}
	var periods int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM subscription_periods WHERE subscription_id=$1 AND order_id IS NULL AND daily_grant_cents=100`, sub.ID).Scan(&periods); err != nil || periods != 1 {
		t.Fatalf("legacy period=%d %v", periods, err)
	}
}

func TestRecoveryMigrationRefusesToDiscardUncertainOrders(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUser(t, st)
	plan := newSubPlan(t, st, 5, 100)
	order := newOrder(t, st, user.ID, plan)
	if _, err := store.PrepareOrderPayment(ctx, st.Pool, order.ID, "alipay"); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("pgx", st.Pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.DownTo(ctx, 123); err == nil {
		t.Fatal("rollback discarded uncertain state")
	}
	var status string
	err = st.Pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, order.ID).Scan(&status)
	if err != nil || status != "uncertain" {
		t.Fatalf("failed rollback was not atomic: %s %v", status, err)
	}
}
