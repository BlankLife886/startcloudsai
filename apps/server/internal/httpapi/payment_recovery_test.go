package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestAmbiguousCreateFailsOrderAndLateCallbackStillCredits(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	if _, err := store.CloseOrder(ctx, st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	fake := newFakeLanjing(t)
	fake.CreateFailure = "transport"
	client := fake.client()
	cfg := config.Load()
	router := (&Server{Cfg: cfg, St: st, LanjingPay: client}).Router()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	body := gin.H{"planId": seed.PlanID.String(), "paymentMethod": "alipay"}
	// No QR code was shown, so the order cannot be paid by the user: it fails
	// at once instead of blocking the next checkout.
	for n := 0; n < 2; n++ {
		response := authRequest(t, router, http.MethodPost, "/api/v1/orders", body, cookie)
		if response.Code != 502 || !strings.Contains(response.Body.String(), "payment_provider_timeout") {
			t.Fatalf("ambiguous create: %d %s", response.Code, response.Body.String())
		}
	}
	if fake.count("/createOrder") != 2 {
		t.Fatalf("provider create calls = %d", fake.count("/createOrder"))
	}
	var firstID string
	if err := st.Pool.QueryRow(ctx, `SELECT id FROM orders WHERE user_id=$1 AND id<>$2 ORDER BY created_at LIMIT 1`, user.ID, seed.ID).Scan(&firstID); err != nil {
		t.Fatal(err)
	}
	unsettled, err := store.ListUnsettledOrdersForUser(ctx, st.Pool, user.ID)
	if err != nil || len(unsettled) != 0 {
		t.Fatalf("failed creates still block checkout: %+v %v", unsettled, err)
	}
	// Should the provider have created the order anyway, its signed callback
	// is still credited exactly once.
	for n := 0; n < 2; n++ {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, lanjingCallbackPath(client, firstID, "2", "9.90", "9.90"), nil))
		if w.Code != 200 || w.Body.String() != "success" {
			t.Fatalf("callback = %d %s", w.Code, w.Body.String())
		}
	}
	wallet, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || wallet.BalanceCents != 1200 {
		t.Fatalf("wallet=%+v error=%v", wallet, err)
	}
}

func TestManualPaymentAssociationValidatesIdentityAndClearsIssue(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, order := makeOrder(t, st)
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET provider='lanjing' WHERE id=$1`, order.ID); err != nil {
		t.Fatal(err)
	}
	order, err := store.PrepareOrderPayment(ctx, st.Pool, order.ID, "alipay")
	if err != nil {
		t.Fatal(err)
	}
	var merchant atomic.Value
	merchant.Store(uuid.NewString())
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "data": gin.H{"payId": merchant.Load().(string), "orderId": "provider-recover", "payType": 2, "price": "9.90", "reallyPrice": "9.90", "payUrl": "https://qr.example/pay", "state": 1, "isAuto": 1}})
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "test-secret", "https://example.com/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: config.Load(), St: st, LanjingPay: client}
	result, err := srv.reconcilePaymentOrder(ctx, order, false)
	if err != nil || result.Outcome != "provider_id_missing" {
		t.Fatalf("missing channel: %+v %v", result, err)
	}
	// The business handler is exercised directly; production uses the existing admin-only audited route.
	router := gin.New()
	router.POST("/recover", srv.adminReconcileOrRecover)
	input := gin.H{"orderId": order.ID.String(), "providerOrderId": "provider-recover"}
	response := authRequest(t, router, http.MethodPost, "/recover", input)
	if response.Code != 409 {
		t.Fatalf("wrong merchant accepted: %s", response.Body.String())
	}
	fresh, _ := store.GetOrder(ctx, st.Pool, order.ID)
	if fresh.ProviderOrderID != nil {
		t.Fatal("unverified channel persisted")
	}
	merchant.Store(order.ID.String())
	for n := 0; n < 2; n++ {
		response = authRequest(t, router, http.MethodPost, "/recover", input)
		if response.Code != 200 {
			t.Fatalf("recovery: %s", response.Body.String())
		}
	}
	fresh, _ = store.GetOrder(ctx, st.Pool, order.ID)
	if fresh.Status != "completed" || fresh.ProviderOrderID == nil {
		t.Fatalf("order: %+v", fresh)
	}
	wallet, _ := store.GetWallet(ctx, st.Pool, user.ID)
	if wallet.BalanceCents != 1200 {
		t.Fatalf("wallet %d", wallet.BalanceCents)
	}
	issues, err := store.ListPaymentReconciliations(ctx, st.Pool, true, 100)
	if err != nil || len(issues) != 0 {
		t.Fatalf("stale issues: %+v %v", issues, err)
	}
	var risks int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM security_risk_events WHERE category='payment_reconciliation' AND resolved_at IS NULL`).Scan(&risks); err != nil || risks != 0 {
		t.Fatalf("risks=%d error=%v", risks, err)
	}
}

func TestReconciliationClaimsCoverOldOrdersAndRespectLeaseOwnership(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	if _, err := st.Pool.Exec(ctx, `INSERT INTO orders(user_id,plan_id,amount_cents,grant_cents,bonus_cents,provider,created_at)
 SELECT $1,$2,990,1000,200,'lanjing',now()-interval '60 days' FROM generate_series(1,550)`, user.ID, seed.PlanID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().Add(time.Second)
	seen := map[uuid.UUID]bool{}
	var last *store.Order
	for {
		batch, err := store.ClaimOrdersForReconciliation(ctx, st.Pool, now, 50)
		if err != nil {
			t.Fatal(err)
		}
		if len(batch) == 0 {
			break
		}
		for _, order := range batch {
			if seen[order.ID] {
				t.Fatal("duplicate claim")
			}
			seen[order.ID] = true
			last = order
			if err := store.FinishOrderReconciliation(ctx, st.Pool, order, now.Add(time.Hour), false); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(seen) != 550 {
		t.Fatalf("coverage=%d, want 550 including older than 30 days", len(seen))
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET reconcile_after=$2 WHERE id=$1`, last.ID, now); err != nil {
		t.Fatal(err)
	}
	first, err := store.ClaimOrdersForReconciliation(ctx, st.Pool, now, 1)
	if err != nil || len(first) != 1 {
		t.Fatal(err)
	}
	blocked, err := store.ClaimOrdersForReconciliation(ctx, st.Pool, now, 1)
	if err != nil || len(blocked) != 0 {
		t.Fatalf("leased work reclaimed %v", err)
	}
	second, err := store.ClaimOrdersForReconciliation(ctx, st.Pool, now.Add(3*time.Minute), 1)
	if err != nil || len(second) != 1 {
		t.Fatal(err)
	}
	if err := store.FinishOrderReconciliation(ctx, st.Pool, first[0], now.Add(time.Hour), true); err != nil {
		t.Fatal(err)
	}
	fresh, err := store.GetOrder(ctx, st.Pool, last.ID)
	if err != nil || fresh.ReconcileLeaseID == nil || *fresh.ReconcileLeaseID != *second[0].ReconcileLeaseID {
		t.Fatal("stale lease overwrote current owner")
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET reconcile_after=$1,reconcile_lease_id=NULL,reconcile_lease_until=NULL WHERE provider='lanjing'`, now); err != nil {
		t.Fatal(err)
	}
	type claim struct {
		items []*store.Order
		err   error
	}
	claims := make(chan claim, 2)
	for n := 0; n < 2; n++ {
		go func() {
			items, err := store.ClaimOrdersForReconciliation(ctx, st.Pool, now, 50)
			claims <- claim{items, err}
		}()
	}
	owners := map[uuid.UUID]bool{}
	for n := 0; n < 2; n++ {
		batch := <-claims
		if batch.err != nil {
			t.Fatal(batch.err)
		}
		for _, item := range batch.items {
			if owners[item.ID] {
				t.Fatal("parallel workers claimed the same order")
			}
			owners[item.ID] = true
		}
	}
	if len(owners) != 100 {
		t.Fatalf("parallel claim coverage=%d", len(owners))
	}
}

func TestVerifiedCallbackCanArriveBeforeCreateResponse(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	if _, err := store.CloseOrder(ctx, st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	var srv *Server
	var client *lanjingpay.Client
	var closes atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/closeOrder" {
			closes.Add(1)
			return
		}
		if r.URL.Path != "/createOrder" {
			http.NotFound(w, r)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Error(err)
			return
		}
		id := r.Form.Get("payId")
		callback := httptest.NewRecorder()
		srv.Router().ServeHTTP(callback, httptest.NewRequest(http.MethodGet, lanjingCallbackPath(client, id, "2", "9.90", "9.90"), nil))
		if callback.Code != 200 {
			t.Errorf("early callback: %s", callback.Body.String())
		}
		_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "data": gin.H{"payId": id, "orderId": "early-provider", "payType": 2, "price": 9.9, "reallyPrice": 9.9, "payUrl": "https://qr.example/pay", "state": 0, "isAuto": 0}})
	}))
	defer provider.Close()
	var err error
	client, err = lanjingpay.New(provider.URL, "test-secret", "https://example.com/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	srv = &Server{Cfg: cfg, St: st, LanjingPay: client}
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	response := authRequest(t, srv.Router(), http.MethodPost, "/api/v1/orders", gin.H{"planId": seed.PlanID.String(), "paymentMethod": "alipay"}, &http.Cookie{Name: cfg.SessionCookieName, Value: token})
	var data struct {
		Data struct {
			Status          string `json:"status"`
			ProviderOrderID string `json:"providerOrderId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if response.Code != 201 || data.Data.Status != "completed" || data.Data.ProviderOrderID != "early-provider" || closes.Load() != 0 {
		t.Fatalf("early race response=%s closes=%d", response.Body.String(), closes.Load())
	}
}

func TestReconciliationPersistsRetryBackoff(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	_, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "retry-provider", 990, "alipay")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "temporarily unavailable", 503) }))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "test-secret", "https://example.com/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: config.Load(), St: st, LanjingPay: client}
	checked, _, err := srv.runPaymentReconciliationBatch(ctx, 10)
	if err != nil || checked != 1 {
		t.Fatalf("checked=%d %v", checked, err)
	}
	fresh, _ := store.GetOrder(ctx, st.Pool, order.ID)
	if fresh.ReconcileAttempts != 1 || fresh.ReconcileLeaseID != nil {
		t.Fatalf("retry state=%+v", fresh)
	}
	checked, _, err = srv.runPaymentReconciliationBatch(ctx, 10)
	if err != nil || checked != 0 {
		t.Fatal("failed order immediately retried")
	}
	providerID := "retry-provider"
	if reconciliationDelay(&store.Order{Status: "pending", ProviderOrderID: &providerID, ReconcileAttempts: 99}, true, time.Now()) != 5*time.Minute {
		t.Fatal("backoff is not capped")
	}
}
