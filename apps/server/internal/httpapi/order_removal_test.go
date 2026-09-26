package httpapi

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestExpiredOrderRemovalPreservesPaymentRecovery(t *testing.T) {
	env := newCommunityEnv(t)
	admin, adminToken := env.newUserSession(t, "admin")
	ctx := context.Background()
	plan, err := store.InsertPlan(ctx, env.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "删除测试", Kind: "topup", PriceCents: 100, GrantCents: 100, Active: true})
	if err != nil {
		t.Fatal(err)
	}
	makeOrder := func(status string) (*store.User, string, *store.Order) {
		user, token := env.newUserSession(t, "user")
		order, err := store.InsertOrder(ctx, env.st.Pool, user.ID, plan.ID, 100, 100, 0, "lanjing")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = env.st.Pool.Exec(ctx, `UPDATE orders SET status=$2 WHERE id=$1`, order.ID, status); err != nil {
			t.Fatal(err)
		}
		return user, token, order
	}
	remove := func(id uuid.UUID) int {
		return env.do(t, "DELETE", "/api/v1/admin/orders/"+id.String(), nil, adminToken).Code
	}
	for _, status := range []string{"pending", "uncertain", "paid", "completed", "cancelled", "failed"} {
		_, _, o := makeOrder(status)
		if code := remove(o.ID); code != 409 {
			t.Fatalf("deleted %s: %d", status, code)
		}
	}
	user, token, order := makeOrder("expired")
	if r := env.do(t, "DELETE", "/api/v1/admin/orders/"+order.ID.String(), nil, token); r.Code != 401 {
		t.Fatalf("non-admin delete=%d", r.Code)
	}
	if code := remove(order.ID); code != 204 {
		t.Fatalf("delete=%d", code)
	}
	if code := remove(order.ID); code != 204 {
		t.Fatalf("idempotent delete=%d", code)
	}
	var actor uuid.UUID
	var removedAt time.Time
	if err := env.st.Pool.QueryRow(ctx, `SELECT admin_deleted_by,admin_deleted_at FROM orders WHERE id=$1`, order.ID).Scan(&actor, &removedAt); err != nil || actor != admin.ID {
		t.Fatalf("missing removal audit: %v", err)
	}
	retained, err := store.GetOrder(ctx, env.st.Pool, order.ID)
	if err != nil || retained == nil || retained.Status != "expired" {
		t.Fatalf("original row was lost: %v", err)
	}
	summary, err := store.GetUserOrderSummary(ctx, env.st.Pool, user.ID)
	if err != nil || summary.Total != 0 {
		t.Fatalf("user count=%+v %v", summary, err)
	}
	rows, err := store.ListOrders(ctx, env.st.Pool, &user.ID, "", nil, 20, nil)
	if err != nil || len(rows) != 0 {
		t.Fatalf("removed user order remains: %v", err)
	}
	r := env.do(t, "GET", "/api/v1/admin/orders?userId="+user.ID.String(), nil, adminToken)
	d, _ := decode(t, r)
	if r.Code != 200 || d["total"] != float64(0) {
		t.Fatalf("admin count=%d %s", r.Code, r.Body.String())
	}
	r = env.do(t, "GET", "/api/v1/admin/orders/export?userId="+user.ID.String(), nil, adminToken)
	if r.Code != 200 || strings.Contains(r.Body.String(), order.ID.String()) {
		t.Fatal("removed order remains in export")
	}
	callback := func(id uuid.UUID, valid bool, fingerprint string) {
		if _, err := env.st.Pool.Exec(ctx, `INSERT INTO payment_callback_events(fingerprint,order_id,paid_amount_cents,signature_valid,outcome) VALUES($1,$2,100,$3,'late-receipt')`, strings.Repeat(fingerprint, 64), id, valid); err != nil {
			t.Fatal(err)
		}
	}
	callback(order.ID, false, "a")
	summary, err = store.GetUserOrderSummary(ctx, env.st.Pool, user.ID)
	if err != nil || summary.Total != 0 {
		t.Fatal("invalid callback restored an order")
	}
	callback(order.ID, true, "b")
	summary, err = store.GetUserOrderSummary(ctx, env.st.Pool, user.ID)
	if err != nil || summary.Total != 1 {
		t.Fatalf("late receipt stayed hidden: %+v %v", summary, err)
	}
	if code := remove(order.ID); code != 409 {
		t.Fatalf("deleted order with late receipt: %d", code)
	}
	if err = env.st.Tx(ctx, func(tx pgx.Tx) error {
		updated, err := store.CompleteOrderUpdate(ctx, tx, order.ID, time.Now())
		if err == nil && !updated {
			t.Error("late payment could not complete")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	summary, err = store.GetUserOrderSummary(ctx, env.st.Pool, user.ID)
	if err != nil || summary.Completed != 1 {
		t.Fatalf("completed order stayed hidden: %+v %v", summary, err)
	}
	if code := remove(uuid.New()); code != 404 {
		t.Fatalf("missing order delete=%d", code)
	}

	// Existing receipt dates, grants and reconciliation work must prevent removal.
	for _, kind := range []string{"paid-date", "grant", "reconciliation", "lease"} {
		u, _, o := makeOrder("expired")
		switch kind {
		case "paid-date":
			_, err = env.st.Pool.Exec(ctx, `UPDATE orders SET paid_at=now() WHERE id=$1`, o.ID)
		case "grant":
			source := o.ID.String()
			reason := "保留已发放记录"
			_, err = store.InsertLedgerEntry(ctx, env.st.Pool, u.ID, "grant", 100, 100, "order", &source, &reason, "normal")
		case "reconciliation":
			_, err = env.st.Pool.Exec(ctx, `INSERT INTO payment_reconciliations(order_id,provider,local_status,provider_state,expected_amount_cents,outcome) VALUES($1,'lanjing','expired',2,100,'paid')`, o.ID)
		case "lease":
			_, err = env.st.Pool.Exec(ctx, `UPDATE orders SET reconcile_lease_id=$2 WHERE id=$1`, o.ID, uuid.New())
		}
		if err != nil {
			t.Fatal(err)
		}
		if code := remove(o.ID); code != 409 {
			t.Fatalf("deleted %s evidence: %d", kind, code)
		}
	}
	// The order lock serializes deletion against settlement; paid orders remain visible.
	_, _, staleLease := makeOrder("expired")
	if _, err = env.st.Pool.Exec(ctx, `UPDATE orders SET reconcile_lease_id=$2,reconcile_lease_until=now()-interval '1 minute' WHERE id=$1`, staleLease.ID, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if code := remove(staleLease.ID); code != 204 {
		t.Fatalf("expired reconciliation lease blocked cleanup: %d", code)
	}
	raceUser, _, raceOrder := makeOrder("expired")
	var wg sync.WaitGroup
	wg.Add(2)
	var deleteCode int
	var paymentErr error
	go func() { defer wg.Done(); deleteCode = remove(raceOrder.ID) }()
	go func() {
		defer wg.Done()
		paymentErr = env.st.Tx(ctx, func(tx pgx.Tx) error {
			_, err := store.CompleteOrderUpdate(ctx, tx, raceOrder.ID, time.Now())
			return err
		})
	}()
	wg.Wait()
	if paymentErr != nil || (deleteCode != 204 && deleteCode != 409) {
		t.Fatalf("race=%d %v", deleteCode, paymentErr)
	}
	summary, err = store.GetUserOrderSummary(ctx, env.st.Pool, raceUser.ID)
	if err != nil || summary.Completed != 1 {
		t.Fatalf("settled race order was hidden: %+v %v", summary, err)
	}
}
