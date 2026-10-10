package subscription_test

import (
	"context"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestRefundWindowThreeHoursPreservesPurchasedPolicy(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	start := time.Now().UTC().Truncate(time.Second)
	plan := rollingPlan(t, st, 1, 100, 300)
	if plan.SubscriptionPolicy.RefundGraceHours() != 3 {
		t.Fatal("new plan must default to three hours")
	}
	oldHours := 24
	plan.SubscriptionPolicy.RefundWindowHours = &oldHours
	if err := store.UpdatePlan(ctx, st.Pool, plan); err != nil {
		t.Fatal(err)
	}
	old := rollingSubscription(t, st, newUser(t, st), plan, start)
	newHours := 3
	plan.SubscriptionPolicy.RefundWindowHours = &newHours
	if err := store.UpdatePlan(ctx, st.Pool, plan); err != nil {
		t.Fatal(err)
	}
	fresh := rollingSubscription(t, st, newUser(t, st), plan, start)
	for _, tc := range []struct {
		name    string
		sub     *store.Subscription
		elapsed time.Duration
		full    bool
	}{
		{"new before limit", fresh, 3*time.Hour - time.Second, true},
		{"new at limit", fresh, 3 * time.Hour, true},
		{"new after limit", fresh, 3*time.Hour + time.Second, false},
		{"old after new limit", old, 4 * time.Hour, true},
		{"old at original limit", old, 24 * time.Hour, true},
		{"old after original limit", old, 24*time.Hour + time.Second, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calc, err := subscription.RefundCalculation(ctx, st.Pool, tc.sub, start.Add(tc.elapsed))
			if err != nil {
				t.Fatal(err)
			}
			if (calc.Rule == "unused_refund_window") != tc.full || (calc.MaxRefundCents == 300) != tc.full {
				t.Fatalf("full=%v calculation=%+v", tc.full, calc)
			}
		})
	}
}
