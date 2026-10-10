package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// checkoutEnv is one user with a topup plan (9.90 → 1200 points) and a fake provider.
type checkoutEnv struct {
	t      *testing.T
	st     *store.Store
	fake   *fakeLanjing
	srv    *Server
	router http.Handler
	user   *store.User
	planID uuid.UUID
	cookie *http.Cookie
}

func newCheckoutEnv(t *testing.T) *checkoutEnv {
	t.Helper()
	st := testdb.Setup(t)
	user, seed := makeOrder(t, st)
	if _, err := store.CloseOrder(context.Background(), st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	fake := newFakeLanjing(t)
	cfg := config.Load()
	srv := &Server{Cfg: cfg, St: st, LanjingPay: fake.client()}
	env := &checkoutEnv{t: t, st: st, fake: fake, srv: srv, router: srv.Router(), user: user, planID: seed.PlanID}
	env.cookie = env.login(user)
	return env
}

func (e *checkoutEnv) login(user *store.User) *http.Cookie {
	e.t.Helper()
	token := auth.NewSessionToken()
	if err := store.InsertSession(context.Background(), e.st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		e.t.Fatal(err)
	}
	return &http.Cookie{Name: e.srv.Cfg.SessionCookieName, Value: token}
}

// otherUser returns a second user's session, buying the same plan.
func (e *checkoutEnv) otherUser() *http.Cookie {
	e.t.Helper()
	other, _ := makeOrder(e.t, e.st)
	if _, err := e.st.Pool.Exec(context.Background(), `UPDATE orders SET status='failed' WHERE user_id=$1`, other.ID); err != nil {
		e.t.Fatal(err)
	}
	return e.login(other)
}

func (e *checkoutEnv) checkout(cookie *http.Cookie, method string) (*httptest.ResponseRecorder, map[string]any) {
	e.t.Helper()
	r := authRequest(e.t, e.router, http.MethodPost, "/api/v1/orders", gin.H{"planId": e.planID.String(), "paymentMethod": method}, cookie)
	data, _ := decode(e.t, r)
	return r, data
}

func (e *checkoutEnv) poll(id string) map[string]any {
	e.t.Helper()
	// Let the per-order lookup throttle pass.
	if _, err := e.st.Pool.Exec(context.Background(), `UPDATE orders SET last_reconciled_at=NULL WHERE id=$1`, id); err != nil {
		e.t.Fatal(err)
	}
	r := authRequest(e.t, e.router, http.MethodGet, "/api/v1/orders/"+id, nil, e.cookie)
	if r.Code != 200 {
		e.t.Fatalf("get order = %d %s", r.Code, r.Body.String())
	}
	data, _ := decode(e.t, r)
	return data
}

func (e *checkoutEnv) order(id string) *store.Order {
	e.t.Helper()
	o, err := store.GetOrder(context.Background(), e.st.Pool, uuid.MustParse(id))
	if err != nil || o == nil {
		e.t.Fatalf("order %s: %v", id, err)
	}
	return o
}

func (e *checkoutEnv) balance() int64 {
	e.t.Helper()
	w, err := store.GetWallet(context.Background(), e.st.Pool, e.user.ID)
	if err != nil {
		e.t.Fatal(err)
	}
	return w.BalanceCents
}

func (e *checkoutEnv) callback(providerID string) {
	e.t.Helper()
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, e.fake.callbackPath(providerID), nil))
	if w.Code != 200 || w.Body.String() != "success" {
		e.t.Fatalf("callback = %d %s", w.Code, w.Body.String())
	}
}

func TestCheckoutShowsFixedQRAndCallbackCreditsOnce(t *testing.T) {
	env := newCheckoutEnv(t)
	r, created := env.checkout(env.cookie, "alipay")
	if r.Code != 201 || created["paymentState"] != "awaiting_payment" || created["payUrl"] != "https://qr.alipay.com/fixed-9.90" ||
		created["payAmountCents"] != float64(990) || created["expiresAt"] == nil {
		t.Fatalf("checkout = %d %s", r.Code, r.Body.String())
	}
	id := created["id"].(string)
	// Opening the checkout again shows the same QR code instead of a second order.
	r, reused := env.checkout(env.cookie, "alipay")
	if r.Code != 200 || reused["id"] != id || reused["reused"] != true || env.fake.count("/createOrder") != 1 {
		t.Fatalf("reuse = %d %s", r.Code, r.Body.String())
	}
	providerID := env.fake.lastCreated()
	env.fake.setState(providerID, 1)
	env.callback(providerID)
	env.callback(providerID)
	if env.balance() != 1200 {
		t.Fatalf("balance = %d", env.balance())
	}
	done := env.poll(id)
	if done["status"] != "completed" || done["paymentState"] != "completed" || done["payUrl"] != nil {
		t.Fatalf("completed order = %+v", done)
	}
}

// The incident: the user paid, the callback never arrived, and the QR code
// stayed on screen. Polling must notice the provider's paid state.
func TestPollingCompletesPaidOrderWithoutCallback(t *testing.T) {
	for _, state := range []int{1, 2} { // 1 = paid, 2 = paid but callback failed
		env := newCheckoutEnv(t)
		_, created := env.checkout(env.cookie, "alipay")
		id := created["id"].(string)
		if got := env.poll(id); got["paymentState"] != "awaiting_payment" {
			t.Fatalf("unpaid poll = %+v", got)
		}
		env.fake.setState(env.fake.lastCreated(), state)
		got := env.poll(id)
		if got["status"] != "completed" || got["payUrl"] != nil {
			t.Fatalf("state %d poll = %+v", state, got)
		}
		if env.balance() != 1200 {
			t.Fatalf("state %d balance = %d", state, env.balance())
		}
	}
}

func TestReconcilerCompletesPaidOrderWithoutCallback(t *testing.T) {
	env := newCheckoutEnv(t)
	_, created := env.checkout(env.cookie, "wechat")
	id := created["id"].(string)
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE orders SET reconcile_after=now() WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	env.fake.setState(env.fake.lastCreated(), 1)
	checked, counts, err := env.srv.runPaymentReconciliationBatch(context.Background(), 10)
	if err != nil || checked != 1 || counts["repaired"] != 1 {
		t.Fatalf("reconcile checked=%d counts=%v err=%v", checked, counts, err)
	}
	if o := env.order(id); o.Status != "completed" || env.balance() != 1200 {
		t.Fatalf("order=%s balance=%d", o.Status, env.balance())
	}
}

func TestSameAmountConflictAsksSecondBuyerToRetry(t *testing.T) {
	env := newCheckoutEnv(t)
	first, _ := env.checkout(env.cookie, "alipay")
	if first.Code != 201 {
		t.Fatalf("first checkout = %d %s", first.Code, first.Body.String())
	}
	firstProvider := env.fake.lastCreated()
	r, _ := env.checkout(env.otherUser(), "alipay")
	if r.Code != 409 || !strings.Contains(r.Body.String(), "payment_channel_busy") {
		t.Fatalf("second buyer = %d %s", r.Code, r.Body.String())
	}
	shifted := env.fake.lastCreated()
	if shifted == firstProvider || env.fake.order(shifted).State != -1 {
		t.Fatalf("shifted provider order left open: %+v", env.fake.order(shifted))
	}
	if env.fake.order(firstProvider).State != 0 {
		t.Fatal("first buyer's QR code was closed")
	}
	var status string
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT status FROM orders WHERE provider_order_id=$1`, shifted).Scan(&status); err != nil || status != "failed" {
		t.Fatalf("second order status = %q %v", status, err)
	}
}

func TestMissingFixedQRCodeIsRejectedAndReported(t *testing.T) {
	env := newCheckoutEnv(t)
	env.fake.IsAuto = 1
	r, _ := env.checkout(env.cookie, "alipay")
	if r.Code != 503 || !strings.Contains(r.Body.String(), "payment_qr_missing") {
		t.Fatalf("checkout = %d %s", r.Code, r.Body.String())
	}
	if env.fake.order(env.fake.lastCreated()).State != -1 {
		t.Fatal("provider order without fixed QR left open")
	}
	issues, err := store.ListPaymentReconciliations(context.Background(), env.st.Pool, true, 10)
	if err != nil || len(issues) != 1 || issues[0].Outcome != "fixed_qr_missing" {
		t.Fatalf("issues = %+v %v", issues, err)
	}
	unsettled, _ := store.ListUnsettledOrdersForUser(context.Background(), env.st.Pool, env.user.ID)
	if len(unsettled) != 0 {
		t.Fatal("rejected checkout blocks the next one")
	}
}

func TestOfflineListenerRefusesCheckout(t *testing.T) {
	env := newCheckoutEnv(t)
	env.fake.ListenerState = 0
	r, _ := env.checkout(env.cookie, "alipay")
	if r.Code != 503 || !strings.Contains(r.Body.String(), "payment_channel_offline") || env.fake.count("/createOrder") != 0 {
		t.Fatalf("offline checkout = %d %s creates=%d", r.Code, r.Body.String(), env.fake.count("/createOrder"))
	}
}

func TestProviderRejectionFailsOrderImmediately(t *testing.T) {
	env := newCheckoutEnv(t)
	env.fake.CreateFailure = "监控端未绑定"
	r, _ := env.checkout(env.cookie, "alipay")
	if r.Code != 502 || !strings.Contains(r.Body.String(), "payment_create_failed") {
		t.Fatalf("checkout = %d %s", r.Code, r.Body.String())
	}
	env.fake.CreateFailure = ""
	if r, _ = env.checkout(env.cookie, "alipay"); r.Code != 201 {
		t.Fatalf("retry after rejection = %d %s", r.Code, r.Body.String())
	}
}

func TestUserCancelClosesProviderOrderOrDeliversPaidRace(t *testing.T) {
	env := newCheckoutEnv(t)
	_, created := env.checkout(env.cookie, "alipay")
	id := created["id"].(string)
	r := authRequest(t, env.router, http.MethodPost, "/api/v1/orders/"+id+"/close", nil, env.cookie)
	if data, _ := decode(t, r); r.Code != 200 || data["status"] != "cancelled" || env.fake.order(env.fake.lastCreated()).State != -1 {
		t.Fatalf("cancel = %d %s", r.Code, r.Body.String())
	}
	// Paid just before the user pressed cancel: the provider refuses to close.
	_, created = env.checkout(env.cookie, "alipay")
	id = created["id"].(string)
	env.fake.setState(env.fake.lastCreated(), 1)
	r = authRequest(t, env.router, http.MethodPost, "/api/v1/orders/"+id+"/close", nil, env.cookie)
	if data, _ := decode(t, r); r.Code != 200 || data["status"] != "completed" || env.balance() != 1200 {
		t.Fatalf("paid race cancel = %d %s balance=%d", r.Code, r.Body.String(), env.balance())
	}
}

func TestCancelFailsSafelyWhenProviderCannotClose(t *testing.T) {
	env := newCheckoutEnv(t)
	_, created := env.checkout(env.cookie, "alipay")
	id := created["id"].(string)
	env.fake.CloseFailure = "系统繁忙"
	r := authRequest(t, env.router, http.MethodPost, "/api/v1/orders/"+id+"/close", nil, env.cookie)
	if r.Code != 502 || env.order(id).Status != "pending" {
		t.Fatalf("cancel without provider close = %d %s status=%s", r.Code, r.Body.String(), env.order(id).Status)
	}
}

func TestExpiredOrderHidesQRAndStillAcceptsLatePayment(t *testing.T) {
	env := newCheckoutEnv(t)
	_, created := env.checkout(env.cookie, "alipay")
	id := created["id"].(string)
	providerID := env.fake.lastCreated()
	// The QR deadline passed but the provider has not expired the order yet.
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE orders SET provider_expires_at=now()-interval '1 second' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if got := env.poll(id); got["paymentState"] != "timed_out" || got["payUrl"] != nil {
		t.Fatalf("timed out order = %+v", got)
	}
	env.fake.setState(providerID, -1)
	if got := env.poll(id); got["status"] != "expired" || got["payUrl"] != nil {
		t.Fatalf("expired order = %+v", got)
	}
	// A new checkout is allowed once the old order is closed.
	if r, _ := env.checkout(env.cookie, "alipay"); r.Code != 201 {
		t.Fatalf("checkout after expiry = %d %s", r.Code, r.Body.String())
	}
	// A late signed callback for the expired order is still delivered.
	env.fake.setState(providerID, 1)
	env.callback(providerID)
	if env.order(id).Status != "completed" || env.balance() != 1200 {
		t.Fatalf("late payment status=%s balance=%d", env.order(id).Status, env.balance())
	}
}

func TestDifferentMethodNeedsExplicitCancel(t *testing.T) {
	env := newCheckoutEnv(t)
	if r, _ := env.checkout(env.cookie, "alipay"); r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	// The user may be paying the shown QR code right now; never close it silently.
	r, _ := env.checkout(env.cookie, "wechat")
	if r.Code != 409 || !strings.Contains(r.Body.String(), "user_unsettled_order") || env.fake.order(env.fake.lastCreated()).State != 0 {
		t.Fatalf("switch method = %d %s", r.Code, r.Body.String())
	}
}

func TestUnboundOrderFailsAfterTimeout(t *testing.T) {
	env := newCheckoutEnv(t)
	order, err := store.InsertOrder(context.Background(), env.st.Pool, env.user.ID, env.planID, 990, 1000, 200, "lanjing")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE orders SET created_at=now()-interval '3 minutes',reconcile_after=now() WHERE id=$1`, order.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.srv.runPaymentReconciliationBatch(context.Background(), 10); err != nil {
		t.Fatal(err)
	}
	if o := env.order(order.ID.String()); o.Status != "failed" {
		t.Fatalf("abandoned unbound order status = %s", o.Status)
	}
}

func TestCallbackForUnknownOrderIsAcknowledged(t *testing.T) {
	env := newCheckoutEnv(t)
	id := uuid.NewString()
	w := httptest.NewRecorder()
	env.router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, lanjingCallbackPath(env.srv.LanjingPay, id, "2", "9.90", "9.90"), nil))
	if w.Code != 200 || w.Body.String() != "success" {
		t.Fatalf("unknown order callback = %d %s", w.Code, w.Body.String())
	}
	var outcome string
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT outcome FROM payment_callback_events ORDER BY id DESC LIMIT 1`).Scan(&outcome); err != nil || outcome != "order_not_found" {
		t.Fatalf("outcome = %q %v", outcome, err)
	}
	bad := strings.Replace(lanjingCallbackPath(env.srv.LanjingPay, id, "2", "9.90", "9.90"), "sign=", "sign=0", 1)
	w = httptest.NewRecorder()
	env.router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, bad, nil))
	if w.Code != 401 || w.Body.String() != "error_sign" {
		t.Fatalf("bad signature = %d %s", w.Code, w.Body.String())
	}
}
