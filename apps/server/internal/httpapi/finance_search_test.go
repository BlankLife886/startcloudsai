package httpapi

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"testing"
	"time"
)

func TestFinanceReconciliationPaginationAndDateScope(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	now := time.Now().UTC()
	for i := 0; i < 26; i++ {
		order, err := store.InsertOrder(ctx, st.Pool, user.ID, seed.PlanID, 1000, 1000, 0, "lanjing")
		if err != nil {
			t.Fatal(err)
		}
		if err = store.InsertPaymentReconciliation(ctx, st.Pool, store.PaymentReconciliation{OrderID: order.ID, Provider: "lanjing", LocalStatus: "pending", ExpectedAmountCents: 1000, Outcome: "provider_error"}); err != nil {
			t.Fatal(err)
		}
	}
	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	filter := store.AdminListFilter{From: &from, To: &to}
	first, total, err := store.SearchPaymentReconciliations(ctx, st.Pool, true, 20, 1, filter)
	if err != nil {
		t.Fatal(err)
	}
	second, total2, err := store.SearchPaymentReconciliations(ctx, st.Pool, true, 20, 2, filter)
	if err != nil {
		t.Fatal(err)
	}
	if total != 26 || total2 != 26 || len(first) != 20 || len(second) != 6 {
		t.Fatalf("pagination mismatch %d/%d %d/%d", total, total2, len(first), len(second))
	}
	from = now.Add(24 * time.Hour)
	to = from.Add(time.Hour)
	empty, total, err := store.SearchPaymentReconciliations(ctx, st.Pool, true, 20, 1, store.AdminListFilter{From: &from, To: &to})
	if err != nil || total != 0 || len(empty) != 0 {
		t.Fatalf("date filter failed: %d %v", total, err)
	}
	_, _, err = store.SearchSubscriptionChanges(ctx, st.Pool, "", "", "", 1, filter)
	if err != nil {
		t.Fatalf("subscription date query invalid: %v", err)
	}
}
