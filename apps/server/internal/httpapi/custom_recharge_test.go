package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// rechargeTestPlan is a retired custom-amount plan, as left by migration 00176.
func rechargeTestPlan(t *testing.T, st *store.Store) *store.Plan {
	t.Helper()
	p, err := store.InsertPlan(context.Background(), st.Pool, &store.Plan{Code: uuid.NewString(), Name: "自定义充值", Kind: "topup", PriceCents: 100, GrantCents: 100, PriceLockEligible: true, RechargePolicy: &store.RechargePolicy{PointsPerYuan: 100, PriceLockMinYuan: 30}})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// insertHistoricRechargeOrder recreates an order bought before custom-amount
// top-up was retired, with its per-order conversion snapshot.
func insertHistoricRechargeOrder(t *testing.T, st *store.Store, userID uuid.UUID, plan *store.Plan, yuan int64) *store.Order {
	t.Helper()
	ctx := context.Background()
	order, err := store.InsertOrder(ctx, st.Pool, userID, plan.ID, yuan*100, yuan*plan.RechargePolicy.PointsPerYuan, 0, "mock")
	if err != nil {
		t.Fatal(err)
	}
	eligible := plan.PriceLockEligible && yuan >= plan.RechargePolicy.PriceLockMinYuan
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET price_lock_eligible_snapshot=$2,recharge_policy_snapshot=$3 WHERE id=$1`, order.ID, eligible, plan.RechargePolicy); err != nil {
		t.Fatal(err)
	}
	order, err = store.GetOrder(ctx, st.Pool, order.ID)
	if err != nil {
		t.Fatal(err)
	}
	return order
}

func TestCustomRechargeCheckoutIsRetired(t *testing.T) {
	env := newCheckoutEnv(t)
	plan := rechargeTestPlan(t, env.st)
	for _, body := range []gin.H{
		{"planId": plan.ID, "paymentMethod": "alipay", "amountYuan": 30, "expectedPlanRevision": plan.Revision},
		{"planId": env.planID, "paymentMethod": "alipay", "amountYuan": 30},
	} {
		r := authRequest(t, env.router, "POST", "/api/v1/orders", body, env.cookie)
		if r.Code < 400 || r.Code >= 500 {
			t.Fatalf("custom amount accepted: %d %s", r.Code, r.Body.String())
		}
	}
	if env.fake.count("/createOrder") != 0 {
		t.Fatal("retired custom recharge contacted the provider")
	}
	r := authRequest(t, env.router, "GET", "/api/v1/plans", nil)
	if strings.Contains(r.Body.String(), plan.ID.String()) || strings.Contains(r.Body.String(), "RechargeYuan") {
		t.Fatalf("catalog still sells custom recharge: %s", r.Body.String())
	}
}

func TestCustomRechargeCannotBeListedAgain(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "admin")
	policy := gin.H{"pointsPerYuan": 100, "priceLockMinYuan": 30}
	r := env.do(t, "POST", "/api/v1/admin/plans", gin.H{"code": "custom-recharge", "name": "自定义充值", "kind": "topup", "priceCents": 100, "grantCents": 100, "rechargePolicy": policy}, token)
	if _, code := decode(t, r); r.Code != 422 || code != "custom_recharge_retired" {
		t.Fatalf("create=%d %s", r.Code, r.Body.String())
	}
	plan := rechargeTestPlan(t, env.st)
	id := plan.ID.String()
	if r = env.do(t, "PATCH", "/api/v1/admin/plans/"+id, gin.H{"active": true}, token); r.Code != 422 {
		t.Fatalf("activate retired plan=%d %s", r.Code, r.Body.String())
	}
	if r = env.do(t, "PATCH", "/api/v1/admin/plans/"+id, gin.H{"rechargePolicy": policy}, token); r.Code != 422 {
		t.Fatalf("set policy=%d %s", r.Code, r.Body.String())
	}
	// The database refuses an active custom plan even outside the API.
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE plans SET active=true WHERE id=$1`, plan.ID); err == nil {
		t.Fatal("database accepted an active custom recharge plan")
	}
	// Historic plans stay readable and editable for everything else.
	if r = env.do(t, "PATCH", "/api/v1/admin/plans/"+id, gin.H{"name": "自定义充值（已下线）"}, token); r.Code != 200 {
		t.Fatalf("rename retired plan=%d %s", r.Code, r.Body.String())
	}
}

func TestHistoricCustomRechargeOrderStillSettles(t *testing.T) {
	env := newCheckoutEnv(t)
	plan := rechargeTestPlan(t, env.st)
	order := insertHistoricRechargeOrder(t, env.st, env.user.ID, plan, 30)
	if _, err := env.srv.completeOrder(context.Background(), order); err != nil {
		t.Fatal(err)
	}
	if env.balance() != 3000 {
		t.Fatalf("balance = %d", env.balance())
	}
}
