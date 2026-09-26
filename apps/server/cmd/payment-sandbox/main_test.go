package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestSandboxSeededSubscriptionScenarios(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	l := &lab{st: st, users: map[string]account{}, plans: map[string]*store.Plan{}, clock: time.Date(2026, 9, 6, 4, 0, 0, 0, time.UTC), adminPassword: "Lab-test-only-password"}
	if err := l.seed(ctx); err != nil {
		t.Fatal(err)
	}
	check := func(key string, expected int64) {
		t.Helper()
		w, err := store.GetWallet(ctx, st.Pool, l.users[key].ID)
		if err != nil {
			t.Fatal(err)
		}
		if w.BalanceCents != expected {
			t.Fatalf("%s balance=%d, want %d", key, w.BalanceCents, expected)
		}
	}
	check("renewal", 200)
	check("catchup", 100)
	for range 2 {
		if err := subscription.Tick(ctx, st, l.clock); err != nil {
			t.Fatal(err)
		}
		check("catchup", 500)
		check("renewal", 200)
	}
	for range 2 {
		if err := subscription.Tick(ctx, st, l.clock.AddDate(0, 0, 1)); err != nil {
			t.Fatal(err)
		}
		check("renewal", 1100)
		check("catchup", 500)
	}
}

func TestSandboxAuthorization(t *testing.T) {
	l := &lab{base: "http://127.0.0.1:8140", token: "test-key"}
	for _, tc := range []struct {
		name, method, origin, key string
		want                      bool
	}{
		{"valid", "POST", l.base, l.token, true},
		{"foreign origin", "POST", "https://example.com", l.token, false},
		{"missing origin", "POST", "", l.token, false},
		{"missing key", "POST", l.base, "", false},
		{"read method", "GET", l.base, l.token, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, l.base+"/__sandbox/action", nil)
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("X-Sandbox-Key", tc.key)
			if got := l.authorized(r); got != tc.want {
				t.Fatalf("authorized=%v, want %v", got, tc.want)
			}
		})
	}
	r := httptest.NewRequest("POST", l.base+"/__sandbox/enter", strings.NewReader(url.Values{"key": {l.token}}.Encode()))
	r.Header.Set("Origin", l.base)
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if !l.authorized(r) {
		t.Fatal("same-origin login form rejected")
	}
}

func TestSandboxCookieIsolation(t *testing.T) {
	l := &lab{userCookie: "lab_user_test", adminCookie: "lab_admin_test"}
	l.api = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Cookie"); got != "lab_user_test=user; sc_admin_session=admin" {
			t.Errorf("unexpected forwarded cookies: %s", got)
		}
		http.SetCookie(w, &http.Cookie{Name: "sc_admin_session", Value: "new", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
		w.WriteHeader(200)
	})
	r := httptest.NewRequest("GET", "/api/v1/orders", nil)
	r.Header.Set("Cookie", "sc_session=real; sc_admin_session=real-admin; lab_user_test=user; lab_admin_test=admin")
	w := httptest.NewRecorder()
	l.proxyAPI(w, r)
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != l.adminCookie || !cookies[0].HttpOnly {
		t.Fatalf("unexpected cookies: %#v", cookies)
	}
	w = httptest.NewRecorder()
	l.proxyAPI(w, httptest.NewRequest("POST", "/api/v1/tasks", nil))
	if w.Code != 403 {
		t.Fatalf("unrelated mutation allowed: %d", w.Code)
	}
}

func TestSandboxProviderModes(t *testing.T) {
	l := &lab{mode: "normal", gateway: map[string]*gatewayOrder{}}
	server := httptest.NewServer(http.HandlerFunc(l.provider))
	defer server.Close()
	l.base = server.URL
	var err error
	l.client, err = lanjingpay.New(server.URL+"/__sandbox/provider", "test-secret", server.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	input := lanjingpay.CreateOrderInput{MerchantOrderID: "test-order", Param: "test-order", Type: lanjingpay.Alipay, AmountCents: 990}
	order, err := l.client.CreateOrder(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if order.MerchantOrderID != input.MerchantOrderID || order.State != 0 {
		t.Fatalf("unexpected order: %#v", order)
	}
	for _, mode := range []string{"ambiguous", "not_created"} {
		l.mu.Lock()
		before := len(l.gateway)
		l.mode = mode
		l.mu.Unlock()
		if _, err := l.client.CreateOrder(context.Background(), input); err == nil {
			t.Fatalf("%s should fail", mode)
		}
		l.mu.Lock()
		want := before
		if mode == "ambiguous" {
			want++
		}
		if len(l.gateway) != want || l.mode != "normal" {
			t.Errorf("bad one-shot mode %s", mode)
		}
		l.mu.Unlock()
	}
	for _, origin := range []string{"", "https://example.com"} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/__sandbox/provider/createOrder", strings.NewReader("type=2&price=9.90&payId=bad"))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.Header.Set("Origin", origin)
		l.provider(w, r)
		if w.Code != 403 {
			t.Fatalf("unsigned/foreign request accepted: %d", w.Code)
		}
	}
}
