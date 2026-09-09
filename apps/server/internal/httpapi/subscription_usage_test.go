package httpapi

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestSubscriptionUsageSplitPreservesRefundHistory(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	if _, err := env.st.Pool.Exec(ctx, `INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING`, user.ID); err != nil {
		t.Fatal(err)
	}
	makePlan := func(tier int, points, price int64) *store.Plan {
		p := store.DefaultSubscriptionPolicy()
		p.Tier = tier
		plan, err := store.InsertPlan(ctx, env.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "订阅用量测试", Kind: "subscription", PriceCents: price, DurationDays: 3, DailyGrantCents: points, SubscriptionPolicy: p, Active: true})
		if err != nil {
			t.Fatal(err)
		}
		return plan
	}
	base, mid, top := makePlan(1, 100, 1990), makePlan(2, 200, 3990), makePlan(3, 500, 12990)
	at := time.Now().UTC().Truncate(time.Second).Add(-2 * time.Hour)
	order, err := store.InsertOrder(ctx, env.st.Pool, user.ID, base.ID, base.PriceCents, 0, 0, "usage-test")
	if err != nil {
		t.Fatal(err)
	}
	var sub *store.Subscription
	if err = env.st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, at); err != nil {
			return err
		}
		var err error
		sub, err = subscription.ApplyOrder(ctx, tx, order, base, at)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	spend := func(points int64, source string, when time.Time) {
		c := store.WithBillingTime(ctx, when)
		if err := env.st.Tx(c, func(tx pgx.Tx) error {
			if _, err := wallet.FreezeFeatureCredits(c, tx, user.ID, points, "text_to_image", "usage-test", source, nil); err != nil {
				return err
			}
			_, err := wallet.SettleFeatureCredits(c, tx, user.ID, points, "usage-test", source, nil)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	read := func(current, prior, total int64, hasPrior bool) {
		r := env.do(t, "GET", "/api/v1/me/subscriptions", nil, token)
		if r.Code != 200 {
			t.Fatalf("list=%d %s", r.Code, r.Body.String())
		}
		d, _ := decode(t, r)
		item := d["items"].([]any)[0].(map[string]any)
		if item["currentTermSpentPoints"] != float64(current) || item["priorTermSpentPoints"] != float64(prior) || item["spentPoints"] != float64(total) || item["hasPriorTerm"] != hasPrior {
			t.Fatalf("usage=%#v", item)
		}
	}
	upgrade := func(target *store.Plan, when time.Time) {
		quote, err := subscription.QuoteUpgrade(ctx, env.st, user.ID, sub.ID, target.ID, when)
		if err != nil {
			t.Fatal(err)
		}
		order, _, err := store.GetOrInsertUpgradeOrder(ctx, env.st, user.ID, quote.ID, when)
		if err != nil {
			t.Fatal(err)
		}
		if err = env.st.Tx(ctx, func(tx pgx.Tx) error {
			if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, when); err != nil {
				return err
			}
			var err error
			sub, err = subscription.ApplyUpgrade(ctx, tx, order, when)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	spend(19, "before", at.Add(time.Minute))
	read(19, 0, 19, false)
	upgrade(mid, at.Add(30*time.Minute))
	read(0, 19, 19, true)
	spend(3, "after-first-upgrade", at.Add(31*time.Minute))
	read(3, 19, 22, true)
	upgrade(top, at.Add(time.Hour))
	read(0, 22, 22, true)
	if _, err := subscription.PreviewRefund(ctx, env.st, user.ID, sub.ID, time.Now()); err == nil {
		t.Fatal("splitting display usage must not reset refund eligibility")
	}
	admin, adminToken := env.newUserSession(t, "admin")
	auditPath := "/api/v1/admin/orders/" + order.ID.String() + "/subscription-audit"
	if r := env.do(t, "GET", auditPath, nil, token); r.Code != 401 {
		t.Fatalf("user accessed admin audit: %d", r.Code)
	}
	if r := env.do(t, "GET", auditPath+"?section=unknown", nil, adminToken); r.Code != 422 {
		t.Fatalf("invalid audit filter: %d", r.Code)
	}
	audit := func(section string, page int) map[string]any {
		r := env.do(t, "GET", fmt.Sprintf("%s?section=%s&page=%d", auditPath, section, page), nil, adminToken)
		if r.Code != 200 {
			t.Fatalf("audit %s: %d %s", section, r.Code, r.Body.String())
		}
		d, _ := decode(t, r)
		return d
	}
	for section, want := range map[string]int{"payments": 3, "lots": 3, "usage": 2, "changes": 2} {
		d := audit(section, 1)
		if d["records"].(map[string]any)["total"] != float64(want) {
			t.Fatalf("audit %s records=%#v", section, d["records"])
		}
		credits := d["credits"].(map[string]any)
		if credits["spent"] != float64(22) || credits["currentSpent"] != float64(0) || credits["priorSpent"] != float64(22) {
			t.Fatalf("audit credits=%#v", credits)
		}
		if section == "usage" {
			total := float64(0)
			for _, raw := range d["records"].(map[string]any)["items"].([]any) {
				total += raw.(map[string]any)["subscriptionSpent"].(float64)
			}
			if total != 22 {
				t.Fatalf("audit lost zero-delta settlement: %v", total)
			}
		}
	}
	for i := 0; i < 21; i++ {
		if _, err := env.st.Pool.Exec(ctx, `INSERT INTO payment_callback_events(fingerprint,order_id,outcome,signature_valid) VALUES($1,$2,$3,true)`, fmt.Sprintf("%064d", i), order.ID, fmt.Sprintf("audit-fixture-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	first, second := audit("events", 1), audit("events", 2)
	if len(first["records"].(map[string]any)["items"].([]any)) != 20 || len(second["records"].(map[string]any)["items"].([]any)) == 0 {
		t.Fatal("audit events did not paginate")
	}
	// Expiry projections returned by a read must not alter the real credit lots.
	oldEngine := env.engine
	cfg := *env.cfg
	cfg.AppEnv = "test"
	env.engine = (&Server{Cfg: &cfg, St: env.st, SubscriptionClock: func() time.Time { return time.Now().Add(48 * time.Hour) }}).Router()
	projected := audit("lots", 1)
	preview := env.do(t, "GET", "/api/v1/admin/orders/"+order.ID.String()+"/subscription-refund", nil, adminToken)
	if preview.Code != 200 {
		t.Fatalf("manual preview=%d %s", preview.Code, preview.Body.String())
	}
	env.engine = oldEngine
	if projected["credits"].(map[string]any)["available"] != float64(0) {
		t.Fatal("audit did not account for expiration")
	}
	var available int64
	if err := env.st.Pool.QueryRow(ctx, `SELECT sum(available_points) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&available); err != nil || available != 500 {
		t.Fatalf("audit changed actual balance: %d %v", available, err)
	}
	manual, err := subscription.RequestManualRefund(ctx, env.st, admin.ID, order.ID, 100, "测试人工协商保留使用部分", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err = subscription.ReviewRefund(ctx, env.st, manual.ID, admin.ID, "confirm_external_refund", "测试渠道退款确认记录", "AUDIT-REF-001", time.Now()); err != nil {
		t.Fatal(err)
	}
	closed := audit("changes", 1)
	if closed["finance"].(map[string]any)["refundedCents"] != float64(100) {
		t.Fatal("audit duplicated a refund across upgrades")
	}
	if closed["subscription"].(map[string]any)["status"] != "cancelled" {
		t.Fatal("closed subscription chain is not inspectable")
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE orders SET subscription_starts_at=NULL WHERE subscription_change_id IN(SELECT id FROM subscription_changes WHERE subscription_id=$1 AND kind='upgrade')`, sub.ID); err != nil {
		t.Fatal(err)
	}
	missingBasis := audit("payments", 1)
	if missingBasis["calculation"] != nil || missingBasis["calculationError"] == "" || missingBasis["records"].(map[string]any)["total"] != float64(3) {
		t.Fatal("missing refund basis hid the readable payment chain")
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE subscription_credit_allocations SET accounting_version=1 WHERE lot_id IN(SELECT id FROM subscription_credit_lots WHERE subscription_id=$1)`, sub.ID); err != nil {
		t.Fatal(err)
	}
	legacyUsage := audit("usage", 1)
	for _, raw := range legacyUsage["records"].(map[string]any)["items"].([]any) {
		if raw.(map[string]any)["subscriptionSpent"] != nil {
			t.Fatal("legacy missing settlements were presented as known consumption")
		}
	}
	// A legacy lot without a matching period must stay unknown instead of becoming current usage.
	orphanOrder, err := store.InsertOrder(ctx, env.st.Pool, user.ID, base.ID, base.PriceCents, 0, 0, "usage-unlinked")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = env.st.Pool.Exec(ctx, `UPDATE subscription_credit_lots SET order_id=$1 WHERE subscription_id=$2 AND spent_points>0`, orphanOrder.ID, sub.ID); err != nil {
		t.Fatal(err)
	}
	r := env.do(t, "GET", "/api/v1/me/subscriptions", nil, token)
	d, _ := decode(t, r)
	item := d["items"].([]any)[0].(map[string]any)
	if item["currentTermSpentPoints"] != nil || item["priorTermSpentPoints"] != nil || item["spentPoints"] != float64(22) {
		t.Fatalf("invented legacy split: %#v", item)
	}
}
