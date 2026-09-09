package worker

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestSubscriptionGrantsHavePeriodicRecovery(t *testing.T) {
	configs, err := (&staticPeriodicConfigProvider{}).GetConfigs()
	if err != nil {
		t.Fatal(err)
	}
	for _, cfg := range configs {
		if cfg.Task.Type() == typeGrantSubscriptions {
			if cfg.Cronspec != "@every 1m" {
				t.Fatalf("subscription cadence=%s", cfg.Cronspec)
			}
			return
		}
	}
	t.Fatal("subscription catch-up cron missing")
}

func TestSubscriptionStartupAndPeriodicGrantsAreIdempotent(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u, err := store.InsertUser(ctx, st.Pool, "grant-"+uuid.NewString()+"@test.dev", "grants", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, u.ID); err != nil {
		t.Fatal(err)
	}
	p, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: "grant-" + uuid.NewString(), Name: "Rolling grant", Kind: "subscription", DurationDays: 3, DailyGrantCents: 100, PriceCents: 300, Active: true, SubscriptionPolicy: store.DefaultSubscriptionPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	o, err := store.InsertOrder(ctx, st.Pool, u.ID, p.ID, p.PriceCents, 0, 0, "mock")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC().Add(-25 * time.Hour)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := store.CompleteOrderUpdate(ctx, tx, o.ID, start); err != nil {
			return err
		}
		_, err := subscription.ApplyOrder(ctx, tx, o, p, start)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	w := &Worker{St: st}
	if err := w.grantSubscriptions(ctx); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := w.handleGrantSubscriptions(ctx, nil); err != nil {
			t.Fatal(err)
		}
	}
	var lots int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM subscription_credit_lots WHERE user_id=$1`, u.ID).Scan(&lots); err != nil {
		t.Fatal(err)
	}
	balance, err := store.GetWallet(ctx, st.Pool, u.ID)
	if err != nil || lots != 2 || balance.SubscriptionBalanceCents != 100 || balance.BalanceCents != 0 {
		t.Fatalf("lots=%d wallet=%+v err=%v", lots, balance, err)
	}
}
