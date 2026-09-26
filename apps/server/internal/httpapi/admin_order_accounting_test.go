package httpapi

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/google/uuid"
)

func TestAdminOrderAccountingUsesConfirmedReceipts(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, token := env.newUserSession(t, "admin")
	u, seed := makeOrder(t, env.st)
	for _, state := range []struct {
		status string
		amount int64
	}{{"cancelled", 200}, {"paid", 1000}, {"completed", 3000}} {
		o, err := store.InsertOrder(ctx, env.st.Pool, u.ID, seed.PlanID, state.amount, 100, 0, "mock")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := env.st.Pool.Exec(ctx, `UPDATE orders SET status=$2,paid_at=CASE WHEN $2 IN ('paid','completed') THEN now() ELSE NULL END,provider_pay_amount_cents=CASE WHEN $2='paid' THEN 1001 ELSE NULL END WHERE id=$1`, o.ID, state.status); err != nil {
			t.Fatal(err)
		}
	}
	response := env.do(t, "GET", "/api/v1/admin/orders?limit=1&userId="+u.ID.String(), nil, token)
	if response.Code != 200 {
		t.Fatalf("list=%d %s", response.Code, response.Body.String())
	}
	data, _ := decode(t, response)
	s := data["summary"].(map[string]any)
	if s["receivedCents"] != float64(4001) || s["netCents"] != float64(4001) || s["total"] != float64(4) {
		t.Fatalf("summary=%+v", s)
	}
	detail := env.do(t, "GET", "/api/v1/admin/orders/"+seed.ID.String(), nil, token)
	if detail.Code != 200 {
		t.Fatalf("detail=%d %s", detail.Code, detail.Body.String())
	}
	d, _ := decode(t, detail)
	f := d["finance"].(map[string]any)
	if f["receivedCents"] != float64(0) || f["receiptConfirmed"] != false {
		t.Fatalf("unpaid finance=%+v", f)
	}
	for _, query := range []string{"kind=bad", "kind=pending&status=pending", "createdFrom=broken", "createdFrom=2026-09-10&createdTo=2026-09-01", "minAmount=2&maxAmount=1"} {
		r := env.do(t, "GET", "/api/v1/admin/orders?"+query, nil, token)
		if r.Code != 422 {
			t.Fatalf("invalid filter=%s status=%d %s", query, r.Code, r.Body.String())
		}
	}
	if r := env.do(t, "GET", "/api/v1/admin/orders/export", nil, ""); r.Code != 401 {
		t.Fatalf("anonymous export=%d", r.Code)
	}
	r := env.do(t, "GET", "/api/v1/admin/orders?search="+seed.ID.String(), nil, token)
	d, _ = decode(t, r)
	if r.Code != 200 || d["total"] != float64(1) {
		t.Fatalf("id search=%d %s", r.Code, r.Body.String())
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE users SET username='=HYPERLINK("unsafe")' WHERE id=$1`, u.ID); err != nil {
		t.Fatal(err)
	}
	r = env.do(t, "GET", "/api/v1/admin/orders/export?userId="+u.ID.String()+"&status=pending", nil, token)
	if r.Code != 200 || !strings.Contains(r.Body.String(), "'=HYPERLINK") || !strings.Contains(r.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("csv=%d %s", r.Code, r.Body.String())
	}
}

func TestOrderRefundTotalsDoNotDuplicateAcrossUpgradePayments(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, token := env.newUserSession(t, "admin")
	u, _ := env.newUserSession(t, "user")
	p, err := store.InsertPlan(ctx, env.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "订阅测试", Kind: "subscription", PriceCents: 1000, DailyGrantCents: 100, DurationDays: 3})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.InsertOrder(ctx, env.st.Pool, u.ID, p.ID, 1000, 0, 0, "mock")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteOrderUpdate(ctx, env.st.Pool, first.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	sub, err := store.InsertSubscription(ctx, env.st.Pool, &store.Subscription{UserID: u.ID, PlanID: p.ID, OrderID: &first.ID, StartsAt: time.Now(), EndsAt: time.Now().Add(72 * time.Hour), DailyGrantCents: 100})
	if err != nil {
		t.Fatal(err)
	}
	change, err := store.InsertSubscriptionChange(ctx, env.st.Pool, &store.SubscriptionChange{UserID: u.ID, SubscriptionID: sub.ID, Kind: "upgrade", Status: "completed", TargetPlanID: &p.ID, AmountCents: 3000})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.InsertOrder(ctx, env.st.Pool, u.ID, p.ID, 3000, 0, 0, "mock")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE orders SET subscription_change_id=$2 WHERE id=$1`, second.ID, change.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteOrderUpdate(ctx, env.st.Pool, second.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertSubscriptionChange(ctx, env.st.Pool, &store.SubscriptionChange{UserID: u.ID, SubscriptionID: sub.ID, Kind: "refund", Status: "completed", AmountCents: 500}); err != nil {
		t.Fatal(err)
	}
	full := env.do(t, "GET", "/api/v1/admin/orders?userId="+u.ID.String(), nil, token)
	if full.Code != 200 {
		t.Fatalf("list=%d %s", full.Code, full.Body.String())
	}
	d, _ := decode(t, full)
	s := d["summary"].(map[string]any)
	if s["receivedCents"] != float64(4000) || s["refundedCents"] != float64(500) || s["netCents"] != float64(3500) {
		t.Fatalf("summary=%+v", s)
	}
	for _, item := range d["items"].([]any) {
		f := item.(map[string]any)["finance"].(map[string]any)
		if f["refundedCents"] != nil || f["netCents"] != nil || f["refundNeedsAllocation"] != true {
			t.Fatalf("invented per-order refund=%+v", f)
		}
	}
	r := env.do(t, "GET", "/api/v1/admin/orders?search="+url.QueryEscape(second.ID.String()), nil, token)
	d, _ = decode(t, r)
	s = d["summary"].(map[string]any)
	if s["netCents"] != nil || s["partialRefundCents"] != float64(500) {
		t.Fatalf("partial selection=%+v", s)
	}
}

func TestOrderDetailKeepsOriginalBenefitsAfterUpgrade(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, admin := env.newUserSession(t, "admin")
	u, _ := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, u.ID); err != nil {
		t.Fatal(err)
	}
	policy := store.DefaultSubscriptionPolicy()
	bonus := 2
	policy.ConcurrencyBonus = &bonus
	p, err := store.InsertPlan(ctx, env.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "原三日订阅", Kind: "subscription", PriceCents: 1000, DailyGrantCents: 100, DurationDays: 3, Active: true, SubscriptionPolicy: policy})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC()
	srv := &Server{St: env.st, Cfg: env.cfg, SubscriptionClock: func() time.Time { return at }}
	first, err := store.InsertOrder(ctx, env.st.Pool, u.ID, p.ID, 1000, 0, 0, "mock")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := srv.completeOrder(ctx, first); err != nil {
		t.Fatal(err)
	}
	sub, err := store.GetCurrentSubscription(ctx, env.st.Pool, u.ID, at)
	if err != nil || sub == nil {
		t.Fatalf("sub=%+v %v", sub, err)
	}
	originalID := sub.Contract.ID
	policy.Tier = 2
	nextBonus := 4
	policy.ConcurrencyBonus = &nextBonus
	target, err := store.InsertPlan(ctx, env.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "新七日订阅", Kind: "subscription", PriceCents: 3000, DailyGrantCents: 200, DurationDays: 7, Active: true, SubscriptionPolicy: policy})
	if err != nil {
		t.Fatal(err)
	}
	at = at.Add(time.Minute)
	quote, err := subscription.QuoteUpgrade(ctx, env.st, u.ID, sub.ID, target.ID, at)
	if err != nil {
		t.Fatal(err)
	}
	upgrade, _, err := store.GetOrInsertUpgradeOrder(ctx, env.st, u.ID, quote.ID, at)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := srv.completeOrder(ctx, upgrade); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE plans SET name='后续改名',daily_grant_cents=900 WHERE id=$1`, p.ID); err != nil {
		t.Fatal(err)
	}
	r := env.do(t, "GET", "/api/v1/admin/orders/"+first.ID.String(), nil, admin)
	if r.Code != 200 {
		t.Fatalf("detail=%d %s", r.Code, r.Body.String())
	}
	d, _ := decode(t, r)
	if d["planName"] != "原三日订阅" || d["dailyGrantCents"] != float64(100) || d["benefitRecord"].(map[string]any)["id"] != originalID.String() {
		t.Fatalf("old order rewritten=%+v", d)
	}
	r = env.do(t, "GET", "/api/v1/admin/orders/"+upgrade.ID.String(), nil, admin)
	d, _ = decode(t, r)
	if r.Code != 200 || d["finance"].(map[string]any)["kind"] != "upgrade" || d["benefitRecord"].(map[string]any)["id"] == originalID.String() {
		t.Fatalf("upgrade=%d %s", r.Code, r.Body.String())
	}
}
