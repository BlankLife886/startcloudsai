// 订单完成幂等：重复完成不重复入账。
package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
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
	expiresAt := time.Now().Add(5 * time.Minute)
	order, err := store.BindOrderProvider(ctx, st.Pool, order.ID, providerOrderID, payAmountCents,
		paymentMethod, "https://qr.example/pay", false, &expiresAt, true)
	if err != nil {
		t.Fatal(err)
	}
	// Due for reconciliation right away, as if the first check interval passed.
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET reconcile_after=now() WHERE id=$1`, order.ID); err != nil {
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

func TestOrderDictNormalizesStoredPaymentURL(t *testing.T) {
	encoded := "https%3A%2F%2Fqr.alipay.com%2Fstored"
	providerID, expiresAt := "provider-stored", time.Now().Add(time.Minute)
	order := &store.Order{ID: uuid.New(), PlanID: uuid.New(), Status: "pending", ProviderOrderID: &providerID,
		ProviderPayURL: &encoded, ProviderExpiresAt: &expiresAt, CreatedAt: time.Now()}
	out := orderDict(order)
	if got := out["payUrl"]; got == nil || *(got.(*string)) != "https://qr.alipay.com/stored" {
		t.Fatalf("payUrl = %#v", got)
	}
}

func TestPendingOrderCreationSerialized(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seedOrder := makeOrder(t, st)
	if _, err := store.CloseOrder(ctx, st.Pool, seedOrder.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	const attempts = 12
	var waitGroup sync.WaitGroup
	results := make(chan *store.Order, attempts)
	errors := make(chan error, attempts)
	created := make(chan bool, attempts)
	for range attempts {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			order, wasCreated, err := store.GetOrInsertPendingOrder(ctx, st, user.ID, seedOrder.PlanID,
				seedOrder.AmountCents, seedOrder.GrantCents, seedOrder.BonusCents, "lanjing")
			if err != nil {
				errors <- err
				return
			}
			results <- order
			created <- wasCreated
		}()
	}
	waitGroup.Wait()
	close(results)
	close(errors)
	close(created)
	for err := range errors {
		t.Fatal(err)
	}
	var orderID uuid.UUID
	resultCount := 0
	for order := range results {
		resultCount++
		if orderID == uuid.Nil {
			orderID = order.ID
		} else if order.ID != orderID {
			t.Fatalf("concurrent order IDs differ: %s and %s", orderID, order.ID)
		}
	}
	createdCount := 0
	for wasCreated := range created {
		if wasCreated {
			createdCount++
		}
	}
	if resultCount != attempts || createdCount != 1 {
		t.Fatalf("results=%d created=%d, want %d/1", resultCount, createdCount, attempts)
	}
}

func TestCloseLanjingOrderTreatsProviderExpiryAsSuccess(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "provider-expired", order.AmountCents, "alipay")
	closeCalls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/closeOrder":
			closeCalls++
			_ = json.NewEncoder(w).Encode(gin.H{"code": 0, "msg": "订单已关闭", "data": nil})
		case "/getOrder":
			_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "msg": "ok", "data": gin.H{
				"payId": order.ID.String(), "orderId": "provider-expired", "payType": 2,
				"price": 9.90, "reallyPrice": 9.90, "payUrl": "", "isAuto": 1,
				"state": -1, "timeOut": 5, "date": time.Now().Add(-10 * time.Minute).UnixMilli(),
			}})
		case "/checkOrder":
			_ = json.NewEncoder(w).Encode(gin.H{"code": -1, "msg": "expired", "data": nil})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "close-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client}
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	for attempt := 0; attempt < 2; attempt++ {
		recorder := authRequest(t, srv.Router(), http.MethodPost, "/api/v1/orders/"+order.ID.String()+"/close", nil, cookie)
		if recorder.Code != http.StatusOK {
			t.Fatalf("close attempt %d = %d %s", attempt, recorder.Code, recorder.Body.String())
		}
		var response struct {
			Data struct {
				Status string `json:"status"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Data.Status != "expired" {
			t.Fatalf("close response %d = %+v err=%v", attempt, response.Data, err)
		}
	}
	if closeCalls != 1 {
		t.Fatalf("provider close calls = %d, want 1", closeCalls)
	}
}

func TestCloseLanjingOrderTreatsMissingProviderOrderAsExpired(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "provider-missing", order.AmountCents, "alipay")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/closeOrder", "/getOrder", "/checkOrder":
			_ = json.NewEncoder(w).Encode(gin.H{"code": -1, "msg": "云端订单编号不存在", "data": nil})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "missing-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client}
	recorder := authRequest(t, srv.Router(), http.MethodPost, "/api/v1/orders/"+order.ID.String()+"/close", nil,
		&http.Cookie{Name: cfg.SessionCookieName, Value: token})
	if recorder.Code != http.StatusOK {
		t.Fatalf("close missing provider order = %d %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Data.Status != "expired" {
		t.Fatalf("close missing response = %+v err=%v", response.Data, err)
	}
}

func TestPaidCallbackRepairsCancelledOrder(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "provider-race", order.AmountCents, "alipay")
	if _, err := store.CloseOrder(ctx, st.Pool, order.ID, "cancelled"); err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.NotFoundHandler())
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "race-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: config.Load(), St: st, LanjingPay: client}
	recorder := httptest.NewRecorder()
	srv.Router().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet,
		lanjingCallbackPath(client, order.ID.String(), "2", "9.90", "9.90"), nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "success" {
		t.Fatalf("callback = %d %q", recorder.Code, recorder.Body.String())
	}
	fresh, err := store.GetOrder(ctx, st.Pool, order.ID)
	if err != nil || fresh.Status != "completed" {
		t.Fatalf("repaired order = %+v err=%v", fresh, err)
	}
	wallet, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || wallet.BalanceCents != order.GrantCents+order.BonusCents {
		t.Fatalf("wallet = %+v err=%v", wallet, err)
	}
}

func TestListOrdersPreservesPlanSnapshotAndStatusFilter(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, order := makeOrder(t, st)
	if _, err := st.Pool.Exec(ctx, `
		UPDATE plans
		SET kind = 'subscription', duration_days = 30, daily_grant_cents = 150
		WHERE id = $1`, order.PlanID); err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: cfg, St: st}
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	recorder := authRequest(t, srv.Router(), http.MethodGet, "/api/v1/orders?status=pending", nil, cookie)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list orders = %d %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			Items []struct {
				ID              string `json:"id"`
				PlanName        string `json:"planName"`
				PlanKind        string `json:"planKind"`
				DurationDays    int    `json:"durationDays"`
				DailyGrantCents int64  `json:"dailyGrantCents"`
				Status          string `json:"status"`
			} `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Data.Items) != 1 || response.Data.Items[0].ID != order.ID.String() ||
		response.Data.Items[0].PlanName != "基础包" || response.Data.Items[0].PlanKind != "topup" ||
		response.Data.Items[0].DurationDays != 0 || response.Data.Items[0].DailyGrantCents != 0 ||
		response.Data.Items[0].Status != "pending" {
		t.Fatalf("listed orders = %+v", response.Data.Items)
	}
	invalid := authRequest(t, srv.Router(), http.MethodGet, "/api/v1/orders?status=unknown", nil, cookie)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid status = %d %s", invalid.Code, invalid.Body.String())
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
	// A verified callback that contradicts the order is acknowledged (retrying
	// cannot fix it) and recorded for review, but never credited.
	if recorder.Code != http.StatusOK || recorder.Body.String() != "success" {
		t.Fatalf("callback = %d %q", recorder.Code, recorder.Body.String())
	}
	var outcome string
	if err := st.Pool.QueryRow(context.Background(), `SELECT outcome FROM payment_callback_events WHERE order_id=$1`, order.ID).Scan(&outcome); err != nil || outcome != "order_mismatch" {
		t.Fatalf("callback outcome = %q %v", outcome, err)
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
	}{
		{name: "paid amount", paymentType: "2", reallyPrice: "9.92"},
		{name: "payment method", paymentType: "1", reallyPrice: "9.91"},
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
			if recorder.Code != http.StatusOK || recorder.Body.String() != "success" {
				t.Fatalf("callback = %d %q", recorder.Code, recorder.Body.String())
			}
			fresh, err := store.GetOrder(context.Background(), st.Pool, order.ID)
			if err != nil || fresh.PaidAt != nil || fresh.Status != "pending" {
				t.Fatalf("mismatched callback changed order: %+v %v", fresh, err)
			}
			wallet, err := store.GetWallet(context.Background(), st.Pool, user.ID)
			if err != nil || wallet.BalanceCents != 0 {
				t.Fatalf("wallet after rejected callback = %+v err=%v", wallet, err)
			}
		})
	}
}

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
	if _, err := st.Pool.Exec(ctx, `UPDATE plans SET duration_days=90, daily_grant_cents=900 WHERE id=$1`, plan.ID); err != nil {
		t.Fatal(err)
	}

	completed, err := srv.completeOrder(ctx, order)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if completed.Status != "completed" {
		t.Fatalf("status = %s, want completed", completed.Status)
	}
	if completed.SubscriptionEndsAt == nil || completed.SubscriptionEndsAt.Sub(*completed.CompletedAt) < 29*24*time.Hour || completed.SubscriptionEndsAt.Sub(*completed.CompletedAt) > 31*24*time.Hour {
		t.Fatalf("subscription end must reflect the purchased 30 days: %+v", completed)
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
	if wallet.SubscriptionBalanceCents != 150 || wallet.BalanceCents != 0 {
		t.Fatalf("subscription balance = %d, normal=%d", wallet.SubscriptionBalanceCents, wallet.BalanceCents)
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
	if wallet.SubscriptionBalanceCents != 150 || wallet.BalanceCents != 0 {
		t.Fatalf("subscription balance = %d, normal=%d after replay", wallet.SubscriptionBalanceCents, wallet.BalanceCents)
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
