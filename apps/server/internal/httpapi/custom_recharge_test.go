package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func rechargeTestPlan(t *testing.T, st *store.Store) *store.Plan {
	t.Helper()
	p, err := store.InsertPlan(context.Background(), st.Pool, &store.Plan{Code: uuid.NewString(), Name: "自定义充值", Kind: "topup", PriceCents: 100, GrantCents: 100, Active: true, PriceLockEligible: true, RechargePolicy: &store.RechargePolicy{PointsPerYuan: 100, PriceLockMinYuan: 30}})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCustomRechargeAmountValidationAndPaymentSnapshot(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	if _, err := store.TransitionPendingOrderStatus(ctx, st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	plan := rechargeTestPlan(t, st)
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "simulated response loss", 504)
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "recharge-test", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	router := (&Server{Cfg: cfg, St: st, LanjingPay: client}).Router()
	create := func(amount any, revision int) *httptest.ResponseRecorder {
		return authRequest(t, router, "POST", "/api/v1/orders", gin.H{"planId": plan.ID, "paymentMethod": "alipay", "amountYuan": amount, "expectedPlanRevision": revision}, cookie)
	}
	for _, amount := range []any{nil, 0, -1, 0.5, 1.5, 1001, 100000, 100001, "1", json.Number("1e2")} {
		r := create(amount, plan.Revision)
		if r.Code != 422 {
			t.Fatalf("invalid amount=%v: %d %s", amount, r.Code, r.Body.String())
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid request contacted payment provider")
	}
	r := create(30, plan.Revision)
	if r.Code != 202 {
		t.Fatalf("create=%d %s", r.Code, r.Body.String())
	}
	pending, err := store.ListPendingOrdersForUser(ctx, st.Pool, user.ID)
	if err != nil || len(pending) != 1 {
		t.Fatalf("pending=%+v %v", pending, err)
	}
	order := pending[0]
	if order.AmountCents != 3000 || order.GrantCents != 3000 || !order.PriceLockEligible || order.RechargePolicy.PointsPerYuan != 100 {
		t.Fatalf("snapshot=%+v", order)
	}
	if r = create(1, plan.Revision); r.Code != 409 || !strings.Contains(r.Body.String(), "user_unsettled_order") {
		t.Fatalf("conflicting amount=%d %s", r.Code, r.Body.String())
	}
	if r = create(30, plan.Revision); r.Code != 202 || calls.Load() != 1 {
		t.Fatalf("reuse=%d calls=%d", r.Code, calls.Load())
	}
	oldRevision := plan.Revision
	plan.RechargePolicy = &store.RechargePolicy{PointsPerYuan: 200, PriceLockMinYuan: 1000}
	if err := store.UpdatePlan(ctx, st.Pool, plan); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		r = httptest.NewRecorder()
		router.ServeHTTP(r, httptest.NewRequest("GET", lanjingCallbackPath(client, order.ID.String(), "2", "30.00", "30.00"), nil))
		if r.Code != 200 || r.Body.String() != "success" {
			t.Fatalf("callback=%d %s", r.Code, r.Body.String())
		}
	}
	w, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || w.BalanceCents != 3000 || w.EligibleTopupPoints != 3000 {
		t.Fatalf("wallet=%+v %v", w, err)
	}
	var lots int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM topup_credit_lots WHERE order_id=$1`, order.ID).Scan(&lots); err != nil || lots != 1 {
		t.Fatalf("lots=%d %v", lots, err)
	}
	if r = create(1, oldRevision); r.Code != 409 || !strings.Contains(r.Body.String(), "plan_changed") {
		t.Fatalf("old quote=%d %s", r.Code, r.Body.String())
	}
	if r = create(1000, plan.Revision); r.Code != 202 {
		t.Fatalf("new rate=%d %s", r.Code, r.Body.String())
	}
	pending, err = store.ListPendingOrdersForUser(ctx, st.Pool, user.ID)
	if err != nil || len(pending) != 1 || pending[0].AmountCents != 100000 || pending[0].GrantCents != 200000 || !pending[0].PriceLockEligible {
		t.Fatalf("new snapshot=%+v %v", pending, err)
	}
}

func TestCustomRechargeThresholdAndConcurrentOrders(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	plan := rechargeTestPlan(t, st)
	if _, err := store.TransitionPendingOrderStatus(ctx, st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	for _, amount := range []int64{1, 29, 30, 31, 999, 1000} {
		quote, err := store.QuoteRecharge(plan, amount)
		if err != nil || quote.GrantCents != amount*100 || quote.PriceCents != amount*100 || quote.PriceLockEligible != (amount >= 30) {
			t.Fatalf("quote=%+v %v", quote, err)
		}
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	results := make(chan *store.Order, 12)
	errs := make(chan error, 12)
	for i := range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			o, _, err := store.GetOrInsertRechargeOrder(ctx, st, user.ID, plan.ID, int64(i%2+1), plan.Revision, "lanjing")
			if err != nil {
				errs <- err
			} else {
				results <- o
			}
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if !errors.Is(err, store.ErrUserUnsettledOrder) {
			t.Fatal(err)
		}
	}
	var id uuid.UUID
	for o := range results {
		if id != uuid.Nil && id != o.ID {
			t.Fatal("created multiple unpaid orders")
		}
		id = o.ID
	}
	if id == uuid.Nil {
		t.Fatal("no order created")
	}
}

func TestCustomRechargeOneYuanCreatesPaymentQRCode(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	plan := rechargeTestPlan(t, st)
	if _, err := store.TransitionPendingOrderStatus(ctx, st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/createOrder" {
			t.Errorf("unexpected provider path %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Error(err)
			return
		}
		if r.Form.Get("price") != "1.00" {
			t.Errorf("provider price=%q", r.Form.Get("price"))
		}
		_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "data": gin.H{"payId": r.Form.Get("payId"), "orderId": "custom-one-yuan", "payType": 2, "price": "1.00", "reallyPrice": "1.00", "payUrl": "https://qr.example/custom", "isAuto": 1, "state": 0, "timeOut": 5, "date": time.Now().UnixMilli()}})
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "recharge-qr", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	router := (&Server{Cfg: cfg, St: st, LanjingPay: client}).Router()
	r := authRequest(t, router, "POST", "/api/v1/orders", gin.H{"planId": plan.ID, "paymentMethod": "alipay", "amountYuan": 1, "expectedPlanRevision": plan.Revision}, &http.Cookie{Name: cfg.SessionCookieName, Value: token})
	d, _ := decode(t, r)
	if r.Code != 201 || d["amountCents"] != float64(100) || d["grantCents"] != float64(100) || d["payUrl"] != "https://qr.example/custom" || d["priceLockEligible"] != false {
		t.Fatalf("one-yuan order=%d %s", r.Code, r.Body.String())
	}
}

func TestAdminCustomRechargeConfiguration(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "admin")
	body := gin.H{"code": "custom-recharge", "name": "自定义充值", "kind": "topup", "priceCents": 100, "grantCents": 100, "priceLockEligible": true, "rechargePolicy": gin.H{"pointsPerYuan": 100, "priceLockMinYuan": 30}}
	r := env.do(t, "POST", "/api/v1/admin/plans", body, token)
	if r.Code != 200 {
		t.Fatalf("create=%d %s", r.Code, r.Body.String())
	}
	d, _ := decode(t, r)
	id := d["id"].(string)
	for _, policy := range []gin.H{{"pointsPerYuan": 0, "priceLockMinYuan": 30}, {"pointsPerYuan": 1.5, "priceLockMinYuan": 30}, {"pointsPerYuan": 100, "priceLockMinYuan": 0}} {
		r = env.do(t, "PATCH", "/api/v1/admin/plans/"+id, gin.H{"rechargePolicy": policy}, token)
		if r.Code != 422 {
			t.Fatalf("invalid config=%d %s", r.Code, r.Body.String())
		}
	}
	r = env.do(t, "PATCH", "/api/v1/admin/plans/"+id, gin.H{"rechargePolicy": gin.H{"pointsPerYuan": 120, "priceLockMinYuan": 50}}, token)
	d, _ = decode(t, r)
	if r.Code != 200 || d["grantCents"] != float64(120) || d["revision"] != float64(2) {
		t.Fatalf("update=%d %s", r.Code, r.Body.String())
	}
	r = env.do(t, "PATCH", "/api/v1/admin/plans/"+id, gin.H{"rechargePolicy": nil}, token)
	d, _ = decode(t, r)
	if r.Code != 200 || d["rechargePolicy"] != nil {
		t.Fatalf("clear=%d %s", r.Code, r.Body.String())
	}
}

func TestRechargeAndFixedPacksHaveIndependentVisibility(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "admin")
	create := func(code string, custom bool) string {
		body := gin.H{"code": code, "name": code, "kind": "topup", "priceCents": 100, "grantCents": 100, "active": true}
		if custom {
			body["rechargePolicy"] = gin.H{"pointsPerYuan": 100, "priceLockMinYuan": 30}
		}
		r := env.do(t, "POST", "/api/v1/admin/plans", body, token)
		if r.Code != 200 {
			t.Fatalf("create=%d %s", r.Code, r.Body.String())
		}
		d, _ := decode(t, r)
		return d["id"].(string)
	}
	fixed, custom := create("fixed-visibility", false), create("custom-visibility", true)
	for _, state := range [][2]bool{{true, true}, {true, false}, {false, true}, {false, false}} {
		for i, id := range []string{fixed, custom} {
			r := env.do(t, "PATCH", "/api/v1/admin/plans/"+id, gin.H{"active": state[i]}, token)
			if r.Code != 200 {
				t.Fatalf("toggle=%d %s", r.Code, r.Body.String())
			}
		}
		r := env.do(t, "GET", "/api/v1/plans", nil, "")
		if r.Code != 200 {
			t.Fatalf("catalog=%d %s", r.Code, r.Body.String())
		}
		d, _ := decode(t, r)
		present := map[string]bool{}
		for _, item := range d["items"].([]any) {
			present[item.(map[string]any)["id"].(string)] = true
		}
		if present[fixed] != state[0] || present[custom] != state[1] {
			t.Fatalf("visibility=%v expected=%v", present, state)
		}
	}
}
