package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestAdminUserBillingShowsImmutableLotsAndRefundHolds(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, admin := env.newUserSession(t, "admin")
	u, _ := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, u.ID); err != nil {
		t.Fatal(err)
	}
	p := rechargeTestPlan(t, env.st)
	order, _, err := store.GetOrInsertRechargeOrder(ctx, env.st, u.ID, p.ID, 30, p.Revision, "mock")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&Server{St: env.st, Cfg: env.cfg}).completeOrder(ctx, order); err != nil {
		t.Fatal(err)
	}
	subPlan, err := store.InsertPlan(ctx, env.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "原订阅名称", Kind: "subscription", PriceCents: 1000, DailyGrantCents: 100, DurationDays: 3, Active: true, SubscriptionPolicy: store.DefaultSubscriptionPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	subOrder, err := store.InsertOrder(ctx, env.st.Pool, u.ID, subPlan.ID, 1000, 0, 0, "mock")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&Server{St: env.st, Cfg: env.cfg}).completeOrder(ctx, subOrder); err != nil {
		t.Fatal(err)
	}
	sub, err := store.GetCurrentSubscription(ctx, env.st.Pool, u.ID, time.Now())
	if err != nil || sub == nil {
		t.Fatalf("sub=%+v %v", sub, err)
	}
	if _, err := subscription.RequestRefund(ctx, env.st, u.ID, sub.ID, "测试未使用权益的退订冻结", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE plans SET name='已改名',recharge_policy='{"pointsPerYuan":200,"priceLockMinYuan":100}' WHERE id=$1`, p.ID); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/admin/users/" + u.ID.String()
	r := env.do(t, "GET", path+"/billing", nil, admin)
	if r.Code != 200 {
		t.Fatalf("billing=%d %s", r.Code, r.Body.String())
	}
	d, _ := decode(t, r)
	w := d["wallet"].(map[string]any)
	if w["normalBalanceCents"] != float64(3000) || w["refundHeldCents"] != float64(100) || len(d["pendingChanges"].([]any)) != 1 {
		t.Fatalf("billing=%+v", d)
	}
	benefits := d["items"].([]any)
	if len(benefits) != 1 || benefits[0].(map[string]any)["planName"] != "原订阅名称" {
		t.Fatalf("benefits=%+v", benefits)
	}
	r = env.do(t, "GET", path+"/credit-lots?bucket=subscription&state=held", nil, admin)
	if r.Code != 200 {
		t.Fatalf("lots=%d %s", r.Code, r.Body.String())
	}
	d, _ = decode(t, r)
	items := d["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("held=%+v", d)
	}
	lot := items[0].(map[string]any)
	if lot["heldPoints"] != float64(100) || lot["availablePoints"] != float64(0) || lot["spentPoints"] != float64(0) || lot["holdReason"] != "refund" {
		t.Fatalf("held lot=%+v", lot)
	}
	r = env.do(t, "GET", path+"/credit-lots?bucket=topup", nil, admin)
	d, _ = decode(t, r)
	lot = d["items"].([]any)[0].(map[string]any)
	if lot["priceLockEligible"] != true || lot["rechargePolicy"].(map[string]any)["pointsPerYuan"] != float64(100) || lot["name"] != "自定义充值" {
		t.Fatalf("mutable lot snapshot=%+v", lot)
	}
	r = env.do(t, "GET", path+"/credit-lots/export?bucket=topup", nil, admin)
	if r.Code != 200 || !strings.Contains(r.Body.String(), order.ID.String()) || strings.Contains(r.Body.String(), subOrder.ID.String()) {
		t.Fatalf("export filter=%d %s", r.Code, r.Body.String())
	}
	other, _ := env.newUserSession(t, "user")
	r = env.do(t, "GET", "/api/v1/admin/users/"+other.ID.String()+"/credit-lots", nil, admin)
	d, _ = decode(t, r)
	if r.Code != 200 || d["total"] != float64(0) {
		t.Fatal("cross-user lots leaked")
	}
	if r = env.do(t, "GET", path+"/billing", nil, ""); r.Code != 401 {
		t.Fatalf("anonymous billing=%d", r.Code)
	}
}

func TestAdminCreditLotsConsumptionAndPaging(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, admin := env.newUserSession(t, "admin")
	u, _ := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, u.ID); err != nil {
		t.Fatal(err)
	}
	p := rechargeTestPlan(t, env.st)
	for range 3 {
		o, _, err := store.GetOrInsertRechargeOrder(ctx, env.st, u.ID, p.ID, 1, p.Revision, "mock")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := (&Server{St: env.st, Cfg: env.cfg}).completeOrder(ctx, o); err != nil {
			t.Fatal(err)
		}
	}
	if err := env.st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 50, "text_to_image", "test", "batch-consume", nil); err != nil {
			return err
		}
		if _, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 20, "test", "batch-consume", nil); err != nil {
			return err
		}
		_, err := wallet.ReleaseFeatureCredits(ctx, tx, u.ID, 30, "test", "batch-consume", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/admin/users/" + u.ID.String() + "/credit-lots"
	r := env.do(t, "GET", path+"?limit=1&page=1", nil, admin)
	if r.Code != 200 {
		t.Fatalf("page=%d %s", r.Code, r.Body.String())
	}
	d, _ := decode(t, r)
	first := d["items"].([]any)[0].(map[string]any)["id"]
	if d["total"] != float64(3) || d["summary"].(map[string]any)["spentPoints"] != float64(20) || d["summary"].(map[string]any)["availablePoints"] != float64(280) {
		t.Fatalf("summary=%+v", d)
	}
	r = env.do(t, "GET", path+"?limit=1&page=2", nil, admin)
	d, _ = decode(t, r)
	if d["items"].([]any)[0].(map[string]any)["id"] == first {
		t.Fatal("pagination repeated row")
	}
}
