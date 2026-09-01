// 订单完成幂等：重复完成不重复入账。
package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func makeOrder(t *testing.T, st *store.Store) (*store.User, *store.Order) {
	t.Helper()
	ctx := context.Background()
	email := fmt.Sprintf("u-%s@test.dev", uuid.NewString()[:8])
	user, err := store.InsertUser(ctx, st.Pool, email, "tester", "x", "user", nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
	plan, err := store.InsertPlan(ctx, st.Pool, &store.Plan{
		Code: "p-" + uuid.NewString()[:6], Name: "基础包", PriceCents: 990, GrantCents: 1000, BonusCents: 200, Active: true,
	})
	if err != nil {
		t.Fatalf("insert plan: %v", err)
	}
	order, err := store.InsertOrder(ctx, st.Pool, user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "mock")
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}
	return user, order
}

func prepareLanjingOrder(t *testing.T, st *store.Store, order *store.Order, providerOrderID string, payAmountCents int64, paymentMethod string) *store.Order {
	t.Helper()
	ctx := context.Background()
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET provider = 'lanjing' WHERE id = $1`, order.ID); err != nil {
		t.Fatal(err)
	}
	order, err := store.SetOrderProviderDetails(ctx, st.Pool, order.ID, providerOrderID, payAmountCents, paymentMethod)
	if err != nil {
		t.Fatal(err)
	}
	return order
}

func lanjingCallbackPath(client *lanjingpay.Client, orderID, paymentType, price, reallyPrice string) string {
	values := url.Values{
		"payId":       {orderID},
		"param":       {orderID},
		"type":        {paymentType},
		"price":       {price},
		"reallyPrice": {reallyPrice},
	}
	values.Set("sign", client.CallbackSignature(orderID, orderID, paymentType, price, reallyPrice))
	return "/api/v1/payments/lanjing/notify?" + values.Encode()
}

func TestCreateLanjingOrderPersistsProviderPaymentSnapshot(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seedOrder := makeOrder(t, st)

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/createOrder" {
			http.NotFound(w, r)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse provider form: %v", err)
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		if got := r.Form.Get("type"); got != "2" {
			t.Errorf("payment type = %q, want 2", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "msg": "ok", "data": gin.H{
			"payId": r.Form.Get("payId"), "orderId": "provider-adjusted", "payType": 2,
			"price": 9.90, "reallyPrice": 9.91, "payUrl": "https://qr.example/pay",
			"isAuto": 1, "state": 0, "timeOut": 5, "date": time.Now().UnixMilli(),
		}})
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "create-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client}
	recorder := authRequest(t, srv.Router(), http.MethodPost, "/api/v1/orders", gin.H{
		"planId": seedOrder.PlanID.String(), "paymentMethod": "alipay",
	}, &http.Cookie{Name: cfg.SessionCookieName, Value: token})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create order = %d %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			ID              string `json:"id"`
			PayAmountCents  int64  `json:"payAmountCents"`
			PaymentMethod   string `json:"paymentMethod"`
			ProviderOrderID string `json:"providerOrderId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.PayAmountCents != 991 || response.Data.PaymentMethod != "alipay" || response.Data.ProviderOrderID != "provider-adjusted" {
		t.Fatalf("payment response = %+v", response.Data)
	}
	createdID, err := uuid.Parse(response.Data.ID)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.GetOrder(ctx, st.Pool, createdID)
	if err != nil || created == nil {
		t.Fatalf("get created order: order=%v err=%v", created, err)
	}
	if created.ProviderPayAmountCents == nil || *created.ProviderPayAmountCents != 991 || created.PaymentMethod == nil || *created.PaymentMethod != "alipay" {
		t.Fatalf("stored payment snapshot = amount %v method %v", created.ProviderPayAmountCents, created.PaymentMethod)
	}
}

func TestCompleteOrderCreditsOnce(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{St: st}
	ctx := context.Background()
	user, order := makeOrder(t, st)

	completed, err := srv.completeOrder(ctx, order)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if completed.Status != "completed" {
		t.Fatalf("status = %s, want completed", completed.Status)
	}

	// 重复完成：幂等成功，不重复入账
	again, err := srv.completeOrder(ctx, completed)
	if err != nil {
		t.Fatalf("complete replay: %v", err)
	}
	if again.Status != "completed" {
		t.Fatalf("replay status = %s, want completed", again.Status)
	}

	wallet, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || wallet == nil {
		t.Fatalf("get wallet: %v", err)
	}
	if wallet.BalanceCents != 1200 { // grant 1000 + bonus 200，只入账一次
		t.Fatalf("balance = %d, want 1200", wallet.BalanceCents)
	}
	var grantCount int
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM wallet_ledger WHERE kind = 'grant' AND source_id = $1`, order.ID.String()).Scan(&grantCount); err != nil {
		t.Fatalf("count grants: %v", err)
	}
	if grantCount != 1 {
		t.Fatalf("grant count = %d, want 1", grantCount)
	}
	var sourceType string
	var sourceID uuid.UUID
	if err := st.Pool.QueryRow(ctx, `
		SELECT source_type, source_id FROM notifications
		WHERE user_id = $1 AND kind = 'order' ORDER BY created_at DESC LIMIT 1`,
		user.ID).Scan(&sourceType, &sourceID); err != nil {
		t.Fatalf("get order notification source: %v", err)
	}
	if sourceType != "order" || sourceID != order.ID {
		t.Fatalf("notification source = %s/%s, want order/%s", sourceType, sourceID, order.ID)
	}
}

func TestLanjingPaymentCallbackCreditsOnce(t *testing.T) {
	st := testdb.Setup(t)
	user, order := makeOrder(t, st)
	if _, err := st.Pool.Exec(context.Background(), `UPDATE orders SET provider = 'lanjing' WHERE id = $1`, order.ID); err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "callback-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client}
	values := url.Values{
		"payId":       {order.ID.String()},
		"param":       {order.ID.String()},
		"type":        {"2"},
		"price":       {"9.90"},
		"reallyPrice": {"9.90"},
	}
	values.Set("sign", client.CallbackSignature(
		values.Get("payId"), values.Get("param"), values.Get("type"), values.Get("price"), values.Get("reallyPrice"),
	))
	path := "/api/v1/payments/lanjing/notify?" + values.Encode()
	for attempt := 0; attempt < 2; attempt++ {
		recorder := httptest.NewRecorder()
		srv.Router().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK || recorder.Body.String() != "success" {
			t.Fatalf("callback %d = %d %q", attempt, recorder.Code, recorder.Body.String())
		}
	}
	wallet, err := store.GetWallet(context.Background(), st.Pool, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if wallet.BalanceCents != order.GrantCents+order.BonusCents {
		t.Fatalf("balance = %d", wallet.BalanceCents)
	}
	var entries int
	if err := st.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM wallet_ledger WHERE source_type = 'order' AND source_id = $1`, order.ID.String()).Scan(&entries); err != nil {
		t.Fatal(err)
	}
	if entries != 1 {
		t.Fatalf("ledger entries = %d, want 1", entries)
	}
}

func TestLanjingPaymentCallbackRejectsTamperedPrice(t *testing.T) {
	st := testdb.Setup(t)
	user, order := makeOrder(t, st)
	if _, err := st.Pool.Exec(context.Background(), `UPDATE orders SET provider = 'lanjing' WHERE id = $1`, order.ID); err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.NotFoundHandler())
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "callback-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client}
	values := url.Values{
		"payId":       {order.ID.String()},
		"param":       {order.ID.String()},
		"type":        {"2"},
		"price":       {"0.01"},
		"reallyPrice": {"0.01"},
	}
	values.Set("sign", client.CallbackSignature(
		values.Get("payId"), values.Get("param"), values.Get("type"), values.Get("price"), values.Get("reallyPrice"),
	))
	recorder := httptest.NewRecorder()
	srv.Router().ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet, "/api/v1/payments/lanjing/notify?"+values.Encode(), nil,
	))
	if recorder.Code != http.StatusBadRequest || recorder.Body.String() != "invalid_order" {
		t.Fatalf("callback = %d %q", recorder.Code, recorder.Body.String())
	}
	wallet, err := store.GetWallet(context.Background(), st.Pool, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if wallet.BalanceCents != 0 {
		t.Fatalf("balance = %d, want 0", wallet.BalanceCents)
	}
}

func TestLanjingPaymentCallbackAcceptsAdjustedProviderAmount(t *testing.T) {
	st := testdb.Setup(t)
	user, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "provider-adjusted", 991, "alipay")
	provider := httptest.NewServer(http.NotFoundHandler())
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "callback-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: config.Load(), St: st, LanjingPay: client}
	recorder := httptest.NewRecorder()
	srv.Router().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet,
		lanjingCallbackPath(client, order.ID.String(), "2", "9.90", "9.91"), nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "success" {
		t.Fatalf("callback = %d %q", recorder.Code, recorder.Body.String())
	}
	wallet, err := store.GetWallet(context.Background(), st.Pool, user.ID)
	if err != nil || wallet.BalanceCents != order.GrantCents+order.BonusCents {
		t.Fatalf("wallet after callback = %+v err=%v", wallet, err)
	}
	var providerOrderID *string
	if err := st.Pool.QueryRow(context.Background(), `SELECT provider_order_id FROM payment_callback_events WHERE order_id = $1`, order.ID).Scan(&providerOrderID); err != nil {
		t.Fatal(err)
	}
	if providerOrderID == nil || *providerOrderID != "provider-adjusted" {
		t.Fatalf("callback provider order id = %v", providerOrderID)
	}
}

func TestLanjingPaymentCallbackRejectsSnapshotMismatch(t *testing.T) {
	tests := []struct {
		name        string
		paymentType string
		reallyPrice string
		wantBody    string
	}{
		{name: "paid amount", paymentType: "2", reallyPrice: "9.92", wantBody: "invalid_really_price"},
		{name: "payment method", paymentType: "1", reallyPrice: "9.91", wantBody: "invalid_type"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			st := testdb.Setup(t)
			user, order := makeOrder(t, st)
			order = prepareLanjingOrder(t, st, order, "provider-snapshot", 991, "alipay")
			provider := httptest.NewServer(http.NotFoundHandler())
			defer provider.Close()
			client, err := lanjingpay.New(provider.URL, "callback-secret", provider.URL+"/notify", time.Second, true)
			if err != nil {
				t.Fatal(err)
			}
			srv := &Server{Cfg: config.Load(), St: st, LanjingPay: client}
			recorder := httptest.NewRecorder()
			srv.Router().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet,
				lanjingCallbackPath(client, order.ID.String(), test.paymentType, "9.90", test.reallyPrice), nil))
			if recorder.Code != http.StatusBadRequest || recorder.Body.String() != test.wantBody {
				t.Fatalf("callback = %d %q", recorder.Code, recorder.Body.String())
			}
			wallet, err := store.GetWallet(context.Background(), st.Pool, user.ID)
			if err != nil || wallet.BalanceCents != 0 {
				t.Fatalf("wallet after rejected callback = %+v err=%v", wallet, err)
			}
		})
	}
}

func TestReconcileLanjingOrderUsesProviderPaymentSnapshot(t *testing.T) {
	st := testdb.Setup(t)
	_, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "provider-reconcile", 991, "alipay")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/getOrder" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "msg": "ok", "data": gin.H{
			"payId": order.ID.String(), "orderId": "provider-reconcile", "payType": 2,
			"price": 9.90, "reallyPrice": 9.91, "payUrl": "https://qr.example/pay",
			"isAuto": 1, "state": 1, "timeOut": 5, "date": time.Now().UnixMilli(),
		}})
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "reconcile-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{St: st, LanjingPay: client}
	result, err := srv.reconcilePaymentOrder(context.Background(), order)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "repaired" || result.ExpectedAmountCents != 991 {
		t.Fatalf("reconciliation = %+v", result)
	}
	fresh, err := store.GetOrder(context.Background(), st.Pool, order.ID)
	if err != nil || fresh.Status != "completed" {
		t.Fatalf("reconciled order = %+v err=%v", fresh, err)
	}
}

// 订单完成分叉：kind=subscription 不入账本金，创建订阅并发放首日额度；重复补单不顺延。
func TestCompleteSubscriptionOrderForks(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{St: st}
	ctx := context.Background()

	email := fmt.Sprintf("u-%s@test.dev", uuid.NewString()[:8])
	user, err := store.InsertUser(ctx, st.Pool, email, "tester", "x", "user", nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
	plan, err := store.InsertPlan(ctx, st.Pool, &store.Plan{
		Code: "sub-" + uuid.NewString()[:6], Name: "月度订阅", Kind: "subscription",
		PriceCents: 2900, DurationDays: 30, DailyGrantCents: 150, Active: true,
	})
	if err != nil {
		t.Fatalf("insert plan: %v", err)
	}
	order, err := store.InsertOrder(ctx, st.Pool, user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "mock")
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}

	completed, err := srv.completeOrder(ctx, order)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if completed.Status != "completed" {
		t.Fatalf("status = %s, want completed", completed.Status)
	}
	// 不走订单本金入账
	var orderGrants int
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM wallet_ledger WHERE kind = 'grant' AND source_type = 'order' AND source_id = $1`,
		order.ID.String()).Scan(&orderGrants); err != nil {
		t.Fatalf("count order grants: %v", err)
	}
	if orderGrants != 0 {
		t.Fatalf("order grants = %d, want 0 for subscription", orderGrants)
	}
	// 订阅生效 + 首日发放
	sub, err := store.GetCurrentSubscription(ctx, st.Pool, user.ID, time.Now().UTC())
	if err != nil || sub == nil {
		t.Fatalf("get subscription: %v (%v)", err, sub)
	}
	if sub.DailyGrantCents != 150 {
		t.Fatalf("dailyGrantCents = %d, want 150", sub.DailyGrantCents)
	}
	wallet, _ := store.GetWallet(ctx, st.Pool, user.ID)
	if wallet.BalanceCents != 150 {
		t.Fatalf("balance = %d, want 150 (first-day grant)", wallet.BalanceCents)
	}

	// 重复补单：幂等返回，不顺延不重复发放
	fresh, _ := store.GetOrder(ctx, st.Pool, order.ID)
	if _, err := srv.completeOrder(ctx, fresh); err != nil {
		t.Fatalf("replay: %v", err)
	}
	sub2, _ := store.GetCurrentSubscription(ctx, st.Pool, user.ID, time.Now().UTC())
	if !sub2.EndsAt.Equal(sub.EndsAt) {
		t.Fatalf("ends_at changed on replay: %v → %v", sub.EndsAt, sub2.EndsAt)
	}
	wallet, _ = store.GetWallet(ctx, st.Pool, user.ID)
	if wallet.BalanceCents != 150 {
		t.Fatalf("balance = %d, want 150 after replay", wallet.BalanceCents)
	}
}

// 已完成订单再次 complete（从 DB 重新读出后传入）返回原订单，不抛 order_not_payable。
func TestCompletedOrderReplayFromFreshRead(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{St: st}
	ctx := context.Background()
	_, order := makeOrder(t, st)

	if _, err := srv.completeOrder(ctx, order); err != nil {
		t.Fatalf("complete: %v", err)
	}
	fresh, err := store.GetOrder(ctx, st.Pool, order.ID)
	if err != nil || fresh == nil {
		t.Fatalf("get order: %v", err)
	}
	result, err := srv.completeOrder(ctx, fresh)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if result.ID != order.ID || result.Status != "completed" {
		t.Fatalf("replay result = (%s, %s), want original completed order", result.ID, result.Status)
	}
}
