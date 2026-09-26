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
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestRestartUpgradeCreditUsesTimeAndConsumedPoints(t *testing.T) {
	for _, tc := range []struct {
		name          string
		elapsed       time.Duration
		spent, credit int64
	}{
		{"unused last day", 48 * time.Hour, 0, 663},
		{"used last day", 48 * time.Hour, 90, 66},
		{"last hour", 71 * time.Hour, 10, 27},
		{"first cycle used", time.Hour, 100, 1326},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			u := newUser(t, st)
			base, target := rollingPlan(t, st, 1, 100, 1990), rollingPlan(t, st, 2, 300, 3990)
			at := time.Now().UTC().Truncate(time.Second)
			sub := rollingSubscription(t, st, u, base, at.Add(-tc.elapsed))
			if err := subscription.Tick(ctx, st, at); err != nil {
				t.Fatal(err)
			}
			if tc.spent > 0 {
				if err := st.Tx(ctx, func(tx pgx.Tx) error {
					if _, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, tc.spent, "text_to_image", "test", "consume", nil); err != nil {
						return err
					}
					_, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, tc.spent, "test", "consume", nil)
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}
			q, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at)
			if err != nil {
				t.Fatal(err)
			}
			if q.AmountCents != 3990-tc.credit || q.Snapshot.UpgradeCredit.CreditCents != tc.credit || q.Snapshot.UpgradeMode != "restart" {
				t.Fatalf("quote=%+v credit=%+v", q, q.Snapshot.UpgradeCredit)
			}
			order, _, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, q.ID, at)
			if err != nil {
				t.Fatal(err)
			}
			payAt := at.Add(5 * time.Minute)
			for range 2 {
				if err := st.Tx(ctx, func(tx pgx.Tx) error {
					if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, payAt); err != nil {
						return err
					}
					_, err := subscription.ApplyUpgrade(ctx, tx, order, payAt)
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}
			current, err := store.GetSubscription(ctx, st.Pool, sub.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !current.StartsAt.Equal(payAt) || !current.EndsAt.Equal(payAt.Add(72*time.Hour)) {
				t.Fatalf("period=%+v", current)
			}
			rollingBalance(t, st, u.ID, 300)
			for _, step := range []struct {
				elapsed time.Duration
				balance int64
			}{{24*time.Hour - time.Second, 300}, {24 * time.Hour, 300}, {48 * time.Hour, 300}, {72 * time.Hour, 0}} {
				if err := subscription.Tick(ctx, st, payAt.Add(step.elapsed)); err != nil {
					t.Fatal(err)
				}
				rollingBalance(t, st, u.ID, step.balance)
			}
			var recalled, used int64
			if err := st.Pool.QueryRow(ctx, `SELECT sum(upgrade_revoked_points),sum(spent_points) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&recalled, &used); err != nil || recalled != q.Snapshot.UpgradeCredit.ReclaimPoints || used != tc.spent {
				t.Fatalf("recall=%d used=%d %v", recalled, used, err)
			}
		})
	}
}

func TestRestartUpgradeLocksAndCancellationRestoresEntitlement(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	base, target := rollingPlan(t, st, 1, 100, 300), rollingPlan(t, st, 2, 200, 600)
	at := time.Now().UTC().Truncate(time.Second)
	sub := rollingSubscription(t, st, u, base, at)
	q, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at)
	if err != nil {
		t.Fatal(err)
	}
	order, _, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, q.ID, at)
	if err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 0)
	w, err := store.GetWallet(ctx, st.Pool, u.ID)
	if err != nil || w.SubscriptionUpgradeHeldCents != 100 || w.SubscriptionHeldCents != 0 {
		t.Fatalf("hold=%+v %v", w, err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 1, "text_to_image", "test", "while-held", nil)
		return err
	}); err == nil {
		t.Fatal("spent locked entitlement")
	}
	if err := subscription.Tick(ctx, st, at.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 0)
	if _, err := store.TransitionPendingOrderStatus(ctx, st.Pool, order.ID, "cancelled"); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 100)
	if err := subscription.Tick(ctx, st, at.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 100)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := subscription.ApplyUpgrade(ctx, tx, order, at.Add(time.Hour))
		return err
	}); err == nil {
		t.Fatal("late payment used a cancelled discount")
	}
	stats, err := store.UserWalletLedgerStats(ctx, st.Pool, u.ID)
	if err != nil || stats.ConsumedCount != 0 {
		t.Fatalf("exchange counted as task spend: %+v %v", stats, err)
	}
}

func TestRestartUpgradeRejectsChangedQuoteAndPendingTasks(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	base, target := rollingPlan(t, st, 1, 100, 300), rollingPlan(t, st, 2, 200, 600)
	at := time.Now().UTC().Truncate(time.Second)
	sub := rollingSubscription(t, st, u, base, at)
	q, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 1, "text_to_image", "test", "pending", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at); err == nil {
		t.Fatal("quoted unsettled task")
	}
	if _, _, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, q.ID, at); err == nil {
		t.Fatal("ordered unsettled task")
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 1, "test", "pending", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, q.ID, at); err == nil {
		t.Fatal("used stale credit quote")
	}
}

func TestRepeatedRestartUpgradeDoesNotReuseHistoricalValue(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	base, target, third := rollingPlan(t, st, 1, 100, 300), rollingPlan(t, st, 2, 200, 600), rollingPlan(t, st, 3, 300, 900)
	at := time.Now().UTC().Truncate(time.Second)
	sub := rollingSubscription(t, st, u, base, at.Add(-48*time.Hour))
	sourcePlan := base
	for _, step := range []struct {
		target *store.Plan
		price  int64
	}{{target, 500}, {third, 300}} {
		q, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, step.target.ID, at)
		if err != nil {
			t.Fatal(err)
		}
		if q.AmountCents != step.price {
			t.Fatalf("repeat quote=%d want=%d", q.AmountCents, step.price)
		}
		if q.Snapshot.SourcePlan == nil || q.Snapshot.SourcePlan.PlanID != sourcePlan.ID || q.Snapshot.SourcePlan.PlanName != sourcePlan.Name || q.Snapshot.SourcePlan.DailyPoints != sourcePlan.DailyGrantCents {
			t.Fatalf("wrong upgrade source: %+v", q.Snapshot.SourcePlan)
		}
		order, _, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, q.ID, at)
		if err != nil {
			t.Fatal(err)
		}
		if err := st.Tx(ctx, func(tx pgx.Tx) error {
			if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, at); err != nil {
				return err
			}
			_, err := subscription.ApplyUpgrade(ctx, tx, order, at)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		sourcePlan = step.target
	}
	rollingBalance(t, st, u.ID, 300)
	current, err := store.GetSubscription(ctx, st.Pool, sub.ID)
	if err != nil {
		t.Fatal(err)
	}
	calc, err := subscription.RefundCalculation(ctx, st.Pool, current, at)
	if err != nil || calc.PaidCents != 1100 || calc.MaxRefundCents != 900 {
		t.Fatalf("refund duplicated old value: %+v %v", calc, err)
	}
	// A scope-compatible upgrade quote still belongs to one user only.
	if _, _, err := store.GetOrInsertUpgradeOrder(ctx, st, uuid.New(), uuid.New(), at); err == nil {
		t.Fatal("unknown quote accepted")
	}
	// Simulate pre-provenance records and catalog renames, then replay the data migration.
	if _, err := st.Pool.Exec(ctx, `UPDATE subscription_changes SET snapshot=snapshot-'sourcePlan' WHERE subscription_id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE plans SET name='目录后来改名' WHERE id=ANY($1)`, []uuid.UUID{base.ID, target.ID, third.ID}); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../migrations/00136_subscription_upgrade_source.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := st.Pool.Exec(ctx, strings.Split(string(migration), "-- +goose Down")[0]); err != nil {
			t.Fatal(err)
		}
	}
	changes, err := store.ListSubscriptionChanges(ctx, st.Pool, &u.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range changes {
		want := base
		if change.TargetPlanID != nil && *change.TargetPlanID == third.ID {
			want = target
		}
		if change.Snapshot.SourcePlan == nil || change.Snapshot.SourcePlan.PlanID != want.ID || change.Snapshot.SourcePlan.PlanName != want.Name || change.Snapshot.SourcePlan.PriceCents != want.PriceCents {
			t.Fatalf("incorrect historical provenance: %+v", change.Snapshot.SourcePlan)
		}
	}
}

func TestRestartUpgradeUsesTargetFullDuration(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	base, target := rollingPlan(t, st, 1, 100, 300), rollingPlan(t, st, 2, 200, 600)
	target.DurationDays = 6
	if err := store.UpdatePlan(ctx, st.Pool, target); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Truncate(time.Second)
	sub := rollingSubscription(t, st, u, base, at.Add(-24*time.Hour))
	quote, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at)
	if err != nil || quote.AmountCents != 400 || quote.Snapshot.DurationDays != 6 {
		t.Fatalf("full-duration quote=%+v %v", quote, err)
	}
}
