package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestListenerStateHealth(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name    string
		state   lanjingpay.ServerState
		stale   time.Duration
		healthy bool
	}{
		{"online fresh", lanjingpay.ServerState{State: 1, LastHeartbeat: now.Add(-10 * time.Second)}, 2 * time.Minute, true},
		{"online stale heartbeat", lanjingpay.ServerState{State: 1, LastHeartbeat: now.Add(-5 * time.Minute)}, 2 * time.Minute, false},
		{"stale check disabled", lanjingpay.ServerState{State: 1, LastHeartbeat: now.Add(-5 * time.Minute)}, 0, true},
		{"online without heartbeat", lanjingpay.ServerState{State: 1}, 2 * time.Minute, true},
		{"offline", lanjingpay.ServerState{State: 0, LastHeartbeat: now}, 2 * time.Minute, false},
		{"unbound", lanjingpay.ServerState{State: -1}, 2 * time.Minute, false},
	}
	for _, tc := range cases {
		if healthy, reason := listenerStateHealth(&tc.state, tc.stale, now); healthy != tc.healthy || healthy != (reason == "") {
			t.Errorf("%s: healthy=%t reason=%q", tc.name, healthy, reason)
		}
	}
}

func TestLatePaymentReconciliationCadence(t *testing.T) {
	now := time.Now()
	providerID := "late"
	at := func(d time.Duration) *time.Time { v := now.Add(-d); return &v }
	for _, tc := range []struct {
		closedFor time.Duration
		want      time.Duration
	}{{time.Minute, 30 * time.Second}, {time.Hour, 2 * time.Minute}, {5 * time.Hour, 10 * time.Minute}} {
		order := &store.Order{Status: "expired", ProviderOrderID: &providerID, CreatedAt: now.Add(-tc.closedFor - 5*time.Minute), ProviderExpiresAt: at(tc.closedFor)}
		if got := reconciliationDelay(order, false, now); got != tc.want {
			t.Errorf("closed %s: delay %s, want %s", tc.closedFor, got, tc.want)
		}
	}
	old := &store.Order{Status: "expired", ProviderOrderID: &providerID, CreatedAt: now.Add(-26 * time.Hour), ProviderExpiresAt: at(26 * time.Hour)}
	if got := reconciliationDelay(old, false, now); got != 0 {
		t.Errorf("past late window: %s", got)
	}
}

func TestPaymentChannelClosesAfterRepeatedLookupFailures(t *testing.T) {
	fake := newFakeLanjing(t)
	client := fake.client()
	srv := &Server{}
	fake.setListener(1, true)
	for i := 1; i <= paymentListenerLookupTolerance; i++ {
		snap := srv.checkPaymentListener(context.Background(), client)
		if want := i < paymentListenerLookupTolerance; snap.Healthy != want {
			t.Fatalf("failure %d: healthy=%t want %t", i, snap.Healthy, want)
		}
	}
	if srv.paymentChannelOnline(context.Background(), client) {
		t.Fatal("checkout stayed open after repeated lookup failures")
	}
	fake.setListener(1, false)
	if !srv.checkPaymentListener(context.Background(), client).Healthy {
		t.Fatal("successful lookup did not restore the channel")
	}
}

func TestPaymentListenerMonitorAlertsAndRechecksOnRecovery(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	fake := newFakeLanjing(t)
	srv := &Server{Cfg: config.Load(), St: st, LanjingPay: fake.client()}

	_, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "outage-order", order.AmountCents, "alipay")
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET status='expired',reconcile_after=now()+interval '10 minutes' WHERE id=$1`, order.ID); err != nil {
		t.Fatal(err)
	}

	fake.setListener(0, false)
	srv.monitorPaymentListener(ctx)
	if srv.paymentListener.snapshot().AlertActive {
		t.Fatal("alerted on the first unhealthy check")
	}
	if srv.paymentChannelOnline(ctx, srv.LanjingPay) {
		t.Fatal("checkout open while the listener is offline")
	}
	srv.monitorPaymentListener(ctx)
	if snap := srv.paymentListener.snapshot(); !snap.AlertActive || snap.DownSince.IsZero() {
		t.Fatalf("no alert after repeated offline checks: %+v", snap)
	}
	if n := countOpenListenerRisks(t, st); n != 1 {
		t.Fatalf("open listener risks = %d, want 1", n)
	}
	srv.monitorPaymentListener(ctx) // still down, within the re-alert interval
	if n := countOpenListenerRisks(t, st); n != 1 {
		t.Fatalf("duplicate listener risk while down: %d", n)
	}

	fake.setListener(1, false)
	srv.monitorPaymentListener(ctx)
	if snap := srv.paymentListener.snapshot(); snap.AlertActive || !snap.Healthy {
		t.Fatalf("recovery not detected: %+v", snap)
	}
	if n := countOpenListenerRisks(t, st); n != 0 {
		t.Fatalf("listener risk left open after recovery: %d", n)
	}
	var due bool
	if err := st.Pool.QueryRow(ctx, `SELECT reconcile_after<=now() FROM orders WHERE id=$1`, order.ID).Scan(&due); err != nil || !due {
		t.Fatalf("closed order not re-checked after recovery: due=%t err=%v", due, err)
	}
}

func countOpenListenerRisks(t *testing.T, st *store.Store) int {
	t.Helper()
	var n int
	if err := st.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM security_risk_events WHERE category='payment_listener' AND resolved_at IS NULL`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestUserPaymentCheckRecoversLatePaymentOnClosedOrder(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "late-paid", order.AmountCents, "alipay")
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET status='expired',reconcile_after=now()+interval '10 minutes' WHERE id=$1`, order.ID); err != nil {
		t.Fatal(err)
	}
	var lookups atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/getOrder" {
			http.NotFound(w, r)
			return
		}
		lookups.Add(1)
		_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "data": gin.H{
			"payId": order.ID.String(), "orderId": "late-paid", "payType": 2,
			"price": "9.90", "reallyPrice": "9.90", "state": 1,
			"isAuto": 0, "timeOut": 5, "date": time.Now().UnixMilli(),
		}})
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "test", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client, UsageLimiter: auth.NewMemoryUsageLimiter()}
	router := srv.Router()
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}

	listed := authRequest(t, router, "GET", "/api/v1/orders/"+order.ID.String(), nil, cookie)
	var before struct {
		Data struct {
			PaymentCheckAvailable bool `json:"paymentCheckAvailable"`
		} `json:"data"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &before); err != nil || !before.Data.PaymentCheckAvailable {
		t.Fatalf("payment check not offered on expired order: %s", listed.Body.String())
	}

	response := authRequest(t, router, "POST", "/api/v1/orders/"+order.ID.String()+"/payment-check", nil, cookie)
	var body struct {
		Data struct {
			Status                string `json:"status"`
			Checked               bool   `json:"checked"`
			PaymentCheckAvailable bool   `json:"paymentCheckAvailable"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != 200 ||
		body.Data.Status != "completed" || !body.Data.Checked || body.Data.PaymentCheckAvailable {
		t.Fatalf("late payment not recovered: %d %s", response.Code, response.Body.String())
	}
	wallet, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || wallet.BalanceCents == 0 {
		t.Fatalf("late payment not credited: %+v %v", wallet, err)
	}

	// A completed order is answered without asking the provider again.
	calls := lookups.Load()
	again := authRequest(t, router, "POST", "/api/v1/orders/"+order.ID.String()+"/payment-check", nil, cookie)
	if again.Code != 200 || lookups.Load() != calls {
		t.Fatalf("completed order re-checked: %d calls=%d→%d", again.Code, calls, lookups.Load())
	}
}

func TestUserPaymentCheckIsRateLimited(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "unpaid", order.AmountCents, "alipay")
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET status='expired' WHERE id=$1`, order.ID); err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "data": gin.H{
			"payId": order.ID.String(), "orderId": "unpaid", "payType": 2,
			"price": "9.90", "reallyPrice": "9.90", "state": -1,
			"isAuto": 0, "timeOut": 5, "date": time.Now().UnixMilli(),
		}})
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "test", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client, UsageLimiter: auth.NewMemoryUsageLimiter()}
	router := srv.Router()
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	path := "/api/v1/orders/" + order.ID.String() + "/payment-check"
	if first := authRequest(t, router, "POST", path, nil, cookie); first.Code != 200 {
		t.Fatalf("first check: %d %s", first.Code, first.Body.String())
	}
	if second := authRequest(t, router, "POST", path, nil, cookie); second.Code != 429 {
		t.Fatalf("second check not limited: %d %s", second.Code, second.Body.String())
	}
	fresh, err := store.GetOrder(ctx, st.Pool, order.ID)
	if err != nil || fresh.Status != "expired" || fresh.PaidAt != nil {
		t.Fatalf("unpaid order changed: %+v %v", fresh, err)
	}
}
