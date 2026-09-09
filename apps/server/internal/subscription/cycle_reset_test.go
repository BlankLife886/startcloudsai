package subscription_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/jackc/pgx/v5"
)

func TestCycleResetPreservesInFlightReservationsWithoutRestoringExpiredCredits(t *testing.T) {
	for _, operation := range []string{"release", "spend"} {
		t.Run(operation, func(t *testing.T) {
			st := testdb.Setup(t)
			at := time.Now().UTC().Truncate(time.Second)
			ctx := store.WithBillingTime(context.Background(), at)
			u := newUser(t, st)
			p := rollingPlan(t, st, 1, 100, 300)
			sub := rollingSubscription(t, st, u, p, at)
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				if _, err := wallet.Grant(ctx, tx, u.ID, 500, "grant", "test", "topup", nil); err != nil {
					return err
				}
				_, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 20, "text_to_image", "test", "in-flight", nil)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			next := at.Add(24 * time.Hour)
			nextCtx := store.WithBillingTime(ctx, next)
			if err := subscription.Tick(ctx, st, next); err != nil {
				t.Fatal(err)
			}
			w, err := store.GetWallet(nextCtx, st.Pool, u.ID)
			if err != nil || w.SubscriptionBalanceCents != 100 || w.SubscriptionFrozenCents != 20 || w.BalanceCents != 500 {
				t.Fatalf("reset changed reservation: %+v %v", w, err)
			}
			for range 2 {
				if err := st.Tx(nextCtx, func(tx pgx.Tx) error {
					if operation == "release" {
						entry, err := wallet.ReleaseFeatureCredits(nextCtx, tx, u.ID, 20, "test", "in-flight", nil)
						if err == nil && entry != nil && (entry.DeltaCents != 0 || entry.BalanceAfterCents != 600) {
							t.Fatalf("expired release overstated balance: %+v", entry)
						}
						return err
					}
					_, err := wallet.SettleFeatureCredits(nextCtx, tx, u.ID, 20, "test", "in-flight", nil)
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}
			w, err = store.GetWallet(nextCtx, st.Pool, u.ID)
			if err != nil || w.SubscriptionBalanceCents != 100 || w.SubscriptionFrozenCents != 0 || w.BalanceCents != 500 {
				t.Fatalf("old cycle leaked into new quota: %+v %v", w, err)
			}
			var expired, spent int64
			if err := st.Pool.QueryRow(ctx, `SELECT sum(expired_points),sum(spent_points) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&expired, &spent); err != nil {
				t.Fatal(err)
			}
			if operation == "release" && (expired != 100 || spent != 0) {
				t.Fatalf("release expired=%d spent=%d", expired, spent)
			}
			if operation == "spend" && (expired != 80 || spent != 20) {
				t.Fatalf("settle expired=%d spent=%d", expired, spent)
			}
			stats, err := store.UserWalletLedgerStats(nextCtx, st.Pool, u.ID)
			if err != nil {
				t.Fatal(err)
			}
			if operation == "release" && stats.ConsumedCount != 0 {
				t.Fatalf("expiry counted as consumption: %+v", stats)
			}
		})
	}
}

func TestExpiredCreditsCannotBeSpentBeforeWorkerRuns(t *testing.T) {
	st := testdb.Setup(t)
	at := time.Now().UTC().Truncate(time.Second)
	ctx := store.WithBillingTime(context.Background(), at)
	u := newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	rollingSubscription(t, st, u, p, at)
	nextCtx := store.WithBillingTime(ctx, at.Add(24*time.Hour))
	if err := st.Tx(nextCtx, func(tx pgx.Tx) error {
		_, err := wallet.FreezeFeatureCredits(nextCtx, tx, u.ID, 1, "text_to_image", "test", "too-late", nil)
		return err
	}); err == nil {
		t.Fatal("spent expired credits before worker")
	}
	w, err := store.GetWallet(nextCtx, st.Pool, u.ID)
	if err != nil || w.SubscriptionBalanceCents != 0 {
		t.Fatalf("stale wallet: %+v %v", w, err)
	}
	if err := subscription.Tick(nextCtx, st, at.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	w, err = store.GetWallet(nextCtx, st.Pool, u.ID)
	if err != nil || w.SubscriptionBalanceCents != 100 {
		t.Fatalf("new quota: %+v %v", w, err)
	}
}

func TestMissedCyclesSkipExpiredAllowancesAndOnlyGrantCurrentQuota(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	p.DurationDays = 1200
	if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Truncate(time.Second)
	sub := rollingSubscription(t, st, u, p, at.Add(-1000*24*time.Hour))
	for range 2 {
		if err := subscription.Tick(ctx, st, at); err != nil {
			t.Fatal(err)
		}
	}
	w, err := store.GetWallet(store.WithBillingTime(ctx, at), st.Pool, u.ID)
	if err != nil || w.SubscriptionBalanceCents != 100 {
		t.Fatalf("catchup accumulated quota: %+v %v", w, err)
	}
	var skipped, lots int
	if err := st.Pool.QueryRow(ctx, `SELECT skipped_grants FROM subscription_periods WHERE subscription_id=$1`, sub.ID).Scan(&skipped); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&lots); err != nil {
		t.Fatal(err)
	}
	if skipped != 999 || lots != 2 {
		t.Fatalf("catchup skipped=%d lots=%d", skipped, lots)
	}
}

func TestCycleResetMigrationWithExistingCreditsAndReservations(t *testing.T) {
	st := testdb.Setup(t)
	at := time.Now().UTC().Truncate(time.Second)
	ctx := store.WithBillingTime(context.Background(), at)
	u := newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	rollingSubscription(t, st, u, p, at)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 20, "text_to_image", "test", "migration-held", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../migrations/00137_subscription_cycle_reset.sql")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(string(data), "-- +goose Down")
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, parts[1]); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, parts[0])
		return err
	}); err != nil {
		t.Fatal(err)
	}
	w, err := store.GetWallet(ctx, st.Pool, u.ID)
	if err != nil || w.SubscriptionBalanceCents != 80 || w.SubscriptionFrozenCents != 20 {
		t.Fatalf("migration changed funded balances: %+v %v", w, err)
	}
}
