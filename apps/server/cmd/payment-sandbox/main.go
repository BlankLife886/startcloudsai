// A loopback-only payment lab. Never use this command as a production server.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/httpapi"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type gatewayOrder struct {
	ID         string    `json:"id"`
	MerchantID string    `json:"merchantId"`
	Amount     int64     `json:"amountCents"`
	Method     int       `json:"method"`
	State      int       `json:"state"`
	CreatedAt  time.Time `json:"createdAt"`
}
type account struct {
	Key   string    `json:"key"`
	Name  string    `json:"name"`
	Email string    `json:"email"`
	ID    uuid.UUID `json:"id"`
}
type lab struct {
	scenarioBinary, scenarioDB                                                    string
	scenarioContext                                                               context.Context
	scenarioCancel                                                                context.CancelFunc
	scenarioDone                                                                  chan struct{}
	scenarioRuns                                                                  map[string]*scenarioReport
	stateFile                                                                     string
	persistMu                                                                     sync.Mutex
	clockAnchor                                                                   time.Time
	st                                                                            *store.Store
	api                                                                           http.Handler
	client                                                                        *lanjingpay.Client
	base, host, dbName, token, userCookie, adminCookie, adminToken, adminPassword string
	adminID                                                                       uuid.UUID
	users                                                                         map[string]account
	plans                                                                         map[string]*store.Plan
	mu                                                                            sync.Mutex
	mode                                                                          string
	gateway                                                                       map[string]*gatewayOrder
	creates                                                                       int
	lastMessage                                                                   string
	clock                                                                         time.Time
}

func secret() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func localURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") {
		return nil, errors.New("only loopback HTTP targets are permitted")
	}
	return u, nil
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	port := flag.Int("port", 8144, "loopback gateway port")
	webRaw := flag.String("web", "http://127.0.0.1:8145", "local React dev server")
	adminRaw := flag.String("admin", "http://127.0.0.1:8146", "local Vue dev server")
	adminDB := flag.String("db-admin", "postgres://localhost:5432/postgres?sslmode=disable", "local database administration connection")
	resumePath := flag.String("resume", "", "restore isolated sandbox snapshot")
	stateFile := flag.String("state-file", "", "persist isolated sandbox state")
	scenarioBinary := flag.String("scenario-bin", "", "compiled local billing scenario tests")
	flag.Parse()
	var saved *savedLab
	if *resumePath != "" {
		var err error
		saved, err = readSavedLab(*resumePath)
		if err != nil {
			return err
		}
	}
	webURL, err := localURL(*webRaw)
	if err != nil {
		return err
	}
	adminURL, err := localURL(*adminRaw)
	if err != nil {
		return err
	}
	dbURL, err := url.Parse(*adminDB)
	if err != nil {
		return err
	}
	if (dbURL.Scheme != "postgres" && dbURL.Scheme != "postgresql") || (dbURL.Hostname() != "localhost" && dbURL.Hostname() != "127.0.0.1" && dbURL.Hostname() != "::1") {
		return errors.New("sandbox database must be local PostgreSQL")
	}
	scenarioDB := dbURL.String()
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return err
	}
	defer listener.Close()
	// The lab intentionally does not inherit real mail, storage or provider credentials.
	os.Clearenv()
	_ = os.Setenv("APP_ENV", "development")
	_ = os.Setenv("APP_SECRET", secret())
	_ = os.Setenv("GIN_MODE", "release")
	gin.SetMode(gin.ReleaseMode)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	conn, err := pgx.Connect(ctx, dbURL.String())
	if err != nil {
		return err
	}
	dbName := "sc_payment_lab_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if saved != nil {
		dbName = saved.DB
	} else {
		_, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{dbName}.Sanitize())
	}
	_ = conn.Close(ctx)
	if err != nil {
		return err
	}
	dbURL.Path = "/" + dbName
	if err := store.Migrate(dbURL.String()); err != nil {
		return err
	}
	st, err := store.New(ctx, dbURL.String())
	if err != nil {
		return err
	}
	defer st.Close()
	host := fmt.Sprintf("127.0.0.1:%d", *port)
	l := &lab{st: st, base: "http://" + host, host: host, dbName: dbName, token: secret(), mode: "normal", gateway: map[string]*gatewayOrder{}, users: map[string]account{}, plans: map[string]*store.Plan{}, clock: time.Now().UTC()}
	l.stateFile = *stateFile
	l.scenarioBinary, l.scenarioDB, l.scenarioContext = *scenarioBinary, scenarioDB, ctx
	l.clockAnchor = time.Now()
	l.userCookie = "lab_user_" + dbName
	l.adminCookie = "lab_admin_" + dbName
	l.adminPassword = "Lab-" + secret()[:16]
	cfg := config.Load()
	cfg.DatabaseURL = dbURL.String()
	cfg.AllowedOrigins = l.base
	cfg.SessionCookieName = l.userCookie
	cfg.RedisURL = ""
	service, err := httpapi.New(cfg, st, nil, nil, nil)
	if err != nil {
		return err
	}
	defer service.Close()
	l.client, err = lanjingpay.New(l.base+"/__sandbox/provider", secret(), l.base+"/api/v1/payments/lanjing/notify", 3*time.Second, true)
	if err != nil {
		return err
	}
	service.LanjingPay = l.client
	service.SubscriptionClock = l.currentClock
	l.api = service.Router()
	if saved != nil {
		err = l.resume(ctx, saved)
	} else {
		err = l.seed(ctx)
	}
	if err != nil {
		return err
	}
	if err := l.ensureUpgradePlan(ctx); err != nil {
		return err
	}
	if err := l.ensureLifecycleAccount(ctx); err != nil {
		return err
	}
	l.persist()
	defer l.persist()
	webProxy := httputil.NewSingleHostReverseProxy(webURL)
	adminProxy := httputil.NewSingleHostReverseProxy(adminURL)
	mux := http.NewServeMux()
	mux.HandleFunc("/__sandbox/provider/", l.provider)
	mux.HandleFunc("/__sandbox/state", l.state)
	mux.HandleFunc("/__sandbox/scenarios", l.scenarios)
	mux.HandleFunc("/__sandbox/action", l.action)
	mux.HandleFunc("/__sandbox/enter", l.enter)
	mux.HandleFunc("/__sandbox/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__sandbox/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = template.Must(template.New("lab").Parse(consoleHTML)).Execute(w, map[string]string{"Token": l.token, "DB": l.dbName})
	})
	mux.HandleFunc("/api/", l.proxyAPI)
	mux.Handle("/admin/", adminProxy)
	mux.Handle("/", webProxy)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != l.host {
			http.Error(w, "invalid sandbox host", 403)
			return
		}
		w.Header().Set("Referrer-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/__sandbox/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		mux.ServeHTTP(w, r)
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		l.stopScenario()
		l.waitScenario()
		shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("PAYMENT LAB READY %s/__sandbox/ database=%s", l.base, l.dbName)
	log.Printf("Test admin: admin@payment.test / %s", l.adminPassword)
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (l *lab) seed(ctx context.Context) error {
	if _, err := l.st.Pool.Exec(ctx, `UPDATE plans SET active=false`); err != nil {
		return err
	}
	for _, item := range []account{{Key: "demo", Name: "支付测试", Email: "payment@example.com"}, {Key: "renewal", Name: "续订测试", Email: "renewal@example.com"}, {Key: "catchup", Name: "补发测试", Email: "catchup@example.com"}, {Key: "bulk", Name: "批量对账", Email: "bulk@example.com"}} {
		u, err := store.InsertUser(ctx, l.st.Pool, item.Email, item.Name, "sandbox-no-password", "user", nil)
		if err != nil {
			return err
		}
		if err := store.InsertWallet(ctx, l.st.Pool, u.ID); err != nil {
			return err
		}
		item.ID = u.ID
		l.users[item.Key] = item
	}
	hash, err := auth.HashPassword(l.adminPassword)
	if err != nil {
		return err
	}
	admin, err := store.UpsertAdminAccount(ctx, l.st.Pool, "admin@payment.test", "支付测试管理员", hash)
	if err != nil {
		return err
	}
	l.adminID = admin.ID
	l.adminToken = auth.NewSessionToken()
	if err := store.InsertAdminSession(ctx, l.st.Pool, admin.ID, auth.HashToken(l.adminToken), time.Now().Add(24*time.Hour), nil, nil); err != nil {
		return err
	}
	for _, entry := range []struct {
		key string
		p   store.Plan
	}{
		{"basic", store.Plan{Code: "lab-basic", Name: "基础测试额度包", Kind: "topup", PriceCents: 990, GrantCents: 1000, BonusCents: 200, Active: true, Features: []string{"测试积分入账", "支持重复回调验证"}}},
		{"plus", store.Plan{Code: "lab-plus", Name: "进阶测试额度包", Kind: "topup", PriceCents: 2990, GrantCents: 3000, BonusCents: 800, Active: true, Recommended: true, Features: []string{"测试订单复用", "支持取消与到账验证"}}},
		{"sub", store.Plan{Code: "lab-sub", Name: "三日订阅测试", Kind: "subscription", PriceCents: 1990, DurationDays: 3, DailyGrantCents: 100, Active: true}},
		{"renewal", store.Plan{Code: "lab-renewal", Name: "分批续订场景", Kind: "subscription", PriceCents: 990, DurationDays: 2, DailyGrantCents: 100, Active: false}},
		{"catchup", store.Plan{Code: "lab-catchup", Name: "逾期补发场景", Kind: "subscription", PriceCents: 990, DurationDays: 5, DailyGrantCents: 100, Active: false}},
	} {
		if entry.key == "renewal" || entry.key == "catchup" {
			entry.p.SubscriptionPolicy = store.SubscriptionPolicy{Version: 1}
		}
		p, err := store.InsertPlan(ctx, l.st.Pool, &entry.p)
		if err != nil {
			return err
		}
		l.plans[entry.key] = p
	}
	if err := l.seedSubscription(ctx, "renewal", l.plans["renewal"], l.clock.AddDate(0, 0, -1)); err != nil {
		return err
	}
	changed := *l.plans["renewal"]
	changed.DurationDays = 3
	changed.DailyGrantCents = 900
	if _, err := l.st.Pool.Exec(ctx, `UPDATE plans SET duration_days=3,daily_grant_cents=900 WHERE id=$1`, changed.ID); err != nil {
		return err
	}
	if err := l.seedSubscription(ctx, "renewal", &changed, l.clock); err != nil {
		return err
	}
	if err := l.seedSubscription(ctx, "catchup", l.plans["catchup"], l.clock.AddDate(0, 0, -7)); err != nil {
		return err
	}
	return nil
}

func (l *lab) seedSubscription(ctx context.Context, key string, plan *store.Plan, at time.Time) error {
	order, err := store.InsertOrder(ctx, l.st.Pool, l.users[key].ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "sandbox-seed")
	if err != nil {
		return err
	}
	return l.st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE orders SET created_at=$2 WHERE id=$1`, order.ID, at); err != nil {
			return err
		}
		if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, at); err != nil {
			return err
		}
		if _, err := subscription.ApplyOrder(ctx, tx, order, plan, at); err != nil {
			return err
		}
		p, err := store.GetSubscriptionPeriodForOrder(ctx, tx, order.ID)
		if err != nil {
			return err
		}
		return store.SetOrderSubscriptionPeriod(ctx, tx, order.ID, p.StartsAt, p.EndsAt)
	})
}

func output(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (l *lab) authorized(r *http.Request) bool {
	if r.Method != http.MethodPost || r.Header.Get("Origin") != l.base {
		return false
	}
	if r.Header.Get("X-Sandbox-Key") == l.token {
		return true
	}
	_ = r.ParseForm()
	return r.Form.Get("key") == l.token
}
func (l *lab) userSession(ctx context.Context, id uuid.UUID) (string, error) {
	token := auth.NewSessionToken()
	err := store.InsertSession(ctx, l.st.Pool, id, auth.HashToken(token), time.Now().Add(24*time.Hour), nil, nil)
	return token, err
}
func (l *lab) enter(w http.ResponseWriter, r *http.Request) {
	if !l.authorized(r) {
		http.Error(w, "sandbox authorization required", 403)
		return
	}
	_ = r.ParseForm()
	key := r.Form.Get("account")
	dest := r.Form.Get("dest")
	if key == "admin" {
		http.SetCookie(w, &http.Cookie{Name: l.adminCookie, Value: l.adminToken, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 86400})
		http.Redirect(w, r, "/admin/security-center", 303)
		return
	}
	a, ok := l.users[key]
	if !ok {
		http.Error(w, "unknown account", 400)
		return
	}
	if dest != "/orders" && dest != "/pricing" && dest != "/wallet" && dest != "/subscriptions" {
		dest = "/orders"
	}
	token, err := l.userSession(r.Context(), a.ID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: l.userCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 86400})
	http.Redirect(w, r, dest, 303)
}

// Namespacing both cookie directions prevents logging out the user's other local apps.
type cookieWriter struct {
	http.ResponseWriter
	adminName string
	started   bool
}

func (w *cookieWriter) WriteHeader(status int) {
	if w.started {
		return
	}
	w.started = true
	values := w.Header().Values("Set-Cookie")
	w.Header().Del("Set-Cookie")
	for _, value := range values {
		cookie, err := http.ParseSetCookie(value)
		if err != nil {
			continue
		}
		if cookie.Name == "sc_admin_session" {
			cookie.Name = w.adminName
		}
		w.Header().Add("Set-Cookie", cookie.String())
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *cookieWriter) Write(b []byte) (int, error) {
	if !w.started {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(b)
}
func (l *lab) proxyAPI(w http.ResponseWriter, r *http.Request) {
	// Only billing-related mutations are enabled in this harness.
	if r.Method != "GET" && r.Method != "HEAD" {
		p := r.URL.Path
		allowed := p == "/api/v1/orders" || (strings.HasPrefix(p, "/api/v1/orders/") && strings.HasSuffix(p, "/close")) || p == "/api/v1/admin/payment-reconciliations/run" || p == "/api/v1/admin/auth/session" || p == "/api/v1/auth/session"
		allowed = allowed || strings.HasPrefix(p, "/api/v1/me/subscriptions/") || (strings.HasPrefix(p, "/api/v1/admin/subscription-changes/") && strings.HasSuffix(p, "/review"))
		allowed = allowed || (strings.HasPrefix(p, "/api/v1/admin/orders/") && strings.HasSuffix(p, "/subscription-refund"))
		allowed = allowed || ((r.Method == "POST" || r.Method == "PATCH") && (p == "/api/v1/admin/plans" || strings.HasPrefix(p, "/api/v1/admin/plans/")))
		if !allowed {
			output(w, 403, map[string]any{"success": false, "code": "sandbox_read_only", "error": "测试环境仅开放订单和支付操作"})
			return
		}
	}
	copy := r.Clone(r.Context())
	copy.Header = r.Header.Clone()
	copy.Header.Del("Cookie")
	for _, c := range r.Cookies() {
		if c.Name == l.userCookie {
			copy.AddCookie(c)
		}
		if c.Name == l.adminCookie {
			copy.AddCookie(&http.Cookie{Name: "sc_admin_session", Value: c.Value})
		}
	}
	l.api.ServeHTTP(&cookieWriter{ResponseWriter: w, adminName: l.adminCookie}, copy)
}

func (l *lab) callbackURL(o gatewayOrder) string {
	amount, _ := lanjingpay.FormatCents(o.Amount)
	method := strconv.Itoa(o.Method)
	q := url.Values{"payId": {o.MerchantID}, "param": {o.MerchantID}, "type": {method}, "price": {amount}, "reallyPrice": {amount}, "sign": {l.client.CallbackSignature(o.MerchantID, o.MerchantID, method, amount, amount)}}
	return l.base + "/api/v1/payments/lanjing/notify?" + q.Encode()
}
func (l *lab) call(method, path string, body any, admin bool) (map[string]any, error) {
	var encoded []byte
	if body != nil {
		encoded, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, l.base+path, bytes.NewReader(encoded))
	req.Header.Set("Origin", l.base)
	req.RemoteAddr = "127.0.0.1:1"
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if admin {
		req.AddCookie(&http.Cookie{Name: "sc_admin_session", Value: l.adminToken})
	}
	recorder := httptest.NewRecorder()
	l.api.ServeHTTP(recorder, req)
	if recorder.Code >= 400 {
		return nil, fmt.Errorf("API %d: %s", recorder.Code, recorder.Body.String())
	}
	var result map[string]any
	if json.Unmarshal(recorder.Body.Bytes(), &result) != nil {
		return map[string]any{"result": recorder.Body.String()}, nil
	}
	return result, nil
}
func (l *lab) provider(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" && origin != l.base {
		http.Error(w, "invalid sandbox origin", 403)
		return
	}
	if r.Method != "POST" {
		http.Error(w, "POST required", 405)
		return
	}
	_ = r.ParseForm()
	path := strings.TrimPrefix(r.URL.Path, "/__sandbox/provider")
	l.mu.Lock()
	defer func() { l.mu.Unlock(); l.persist() }()
	if path == "/getState" {
		output(w, 200, map[string]any{"code": 1, "data": map[string]any{"state": 1, "lastheart": time.Now().UnixMilli(), "lastpay": time.Now().UnixMilli()}})
		return
	}
	var o *gatewayOrder
	if path == "/createOrder" {
		method, err := strconv.Atoi(r.Form.Get("type"))
		if err != nil {
			http.Error(w, "bad type", 400)
			return
		}
		amount, err := lanjingpay.ParseCents(r.Form.Get("price"))
		if err != nil {
			http.Error(w, "bad price", 400)
			return
		}
		if r.Form.Get("sign") != l.client.CreateSignature(r.Form.Get("payId"), r.Form.Get("param"), lanjingpay.PaymentType(method), r.Form.Get("price")) {
			http.Error(w, "invalid create signature", 403)
			return
		}
		l.creates++
		mode := l.mode
		l.mode = "normal"
		if mode == "not_created" {
			http.Error(w, "simulated timeout without creating an order", 504)
			return
		}
		o = &gatewayOrder{ID: "lab-" + uuid.NewString()[:8], MerchantID: r.Form.Get("payId"), Amount: amount, Method: method, CreatedAt: time.Now().UTC()}
		l.gateway[o.ID] = o
		if mode == "ambiguous" {
			http.Error(w, "simulated lost create response", 504)
			return
		}
	} else {
		o = l.gateway[r.Form.Get("orderId")]
	}
	if o == nil {
		output(w, 200, map[string]any{"code": -1, "msg": "order not found"})
		return
	}
	if o.State == 0 && time.Since(o.CreatedAt) > 10*time.Minute {
		o.State = -1
	}
	switch path {
	case "/checkOrder":
		if o.State == 1 {
			output(w, 200, map[string]any{"code": 1, "data": l.callbackURL(*o)})
		} else {
			output(w, 200, map[string]any{"code": -1, "msg": "not paid"})
		}
		return
	case "/closeOrder":
		if o.State == 1 {
			output(w, 200, map[string]any{"code": -1, "msg": "order paid"})
		} else {
			o.State = -1
			output(w, 200, map[string]any{"code": 1, "data": "closed"})
		}
		return
	case "/getOrder", "/createOrder":
	default:
		http.NotFound(w, r)
		return
	}
	amount, _ := lanjingpay.FormatCents(o.Amount)
	output(w, 200, map[string]any{"code": 1, "data": map[string]any{"payId": o.MerchantID, "orderId": o.ID, "payType": o.Method, "price": amount, "reallyPrice": amount, "payUrl": l.base + "/__sandbox/?pay=" + o.ID, "state": o.State, "isAuto": 0, "timeOut": 10, "date": o.CreatedAt.UnixMilli()}})
}

func (l *lab) state(w http.ResponseWriter, r *http.Request) {
	l.mu.Lock()
	mode, creates, clock := l.mode, l.creates, l.currentClockLocked()
	scenarios := l.scenarioSnapshotLocked()
	gateways := []gatewayOrder{}
	for _, o := range l.gateway {
		gateways = append(gateways, *o)
	}
	l.mu.Unlock()
	sort.Slice(gateways, func(i, j int) bool { return gateways[i].CreatedAt.After(gateways[j].CreatedAt) })
	r = r.WithContext(store.WithBillingTime(r.Context(), clock))
	accounts := []map[string]any{}
	for _, key := range []string{"demo", "subscriptions", "renewal", "catchup", "bulk"} {
		a := l.users[key]
		wallet, err := store.GetWallet(r.Context(), l.st.Pool, a.ID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		summary, err := store.GetUserOrderSummary(r.Context(), l.st.Pool, a.ID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		current, err := store.GetCurrentSubscription(r.Context(), l.st.Pool, a.ID, clock)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		var available, spent, held int64
		if current != nil && current.BillingVersion == 2 {
			if err := l.st.Pool.QueryRow(r.Context(), `SELECT COALESCE(sum(available_points) FILTER(WHERE NOT refund_hold AND NOT upgrade_hold),0),COALESCE(sum(spent_points),0),COALESCE(sum(available_points) FILTER(WHERE refund_hold),0) FROM subscription_credit_lots WHERE subscription_id=$1`, current.ID).Scan(&available, &spent, &held); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		accounts = append(accounts, map[string]any{"account": a, "balance": wallet.BalanceCents + wallet.SubscriptionBalanceCents, "summary": summary, "subscription": current, "subscriptionAvailable": available, "subscriptionSpent": spent, "subscriptionHeld": held})
	}
	var checked int
	_ = l.st.Pool.QueryRow(r.Context(), `SELECT count(*) FROM orders WHERE provider='lanjing' AND last_reconciled_at IS NOT NULL`).Scan(&checked)
	output(w, 200, map[string]any{"db": l.dbName, "mode": mode, "creates": creates, "gateways": gateways, "accounts": accounts, "checked": checked, "clock": clock, "adminEmail": "admin@payment.test", "adminPassword": l.adminPassword, "scenarios": scenarios})
}
func (l *lab) action(w http.ResponseWriter, r *http.Request) {
	if !l.authorized(r) {
		http.Error(w, "sandbox authorization required", 403)
		return
	}
	var in struct {
		Action         string `json:"action"`
		Mode           string `json:"mode"`
		ID             string `json:"id"`
		Account        string `json:"account"`
		SubscriptionID string `json:"subscriptionId"`
		Points         int64  `json:"points"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		http.Error(w, "invalid action", 400)
		return
	}
	ctx := r.Context()
	defer l.persist()
	var result any = "ok"
	var err error
	switch in.Action {
	case "scenario_run":
		result, err = l.startScenario(in.ID)
		if err != nil {
			output(w, 409, map[string]any{"error": err.Error()})
			return
		}
	case "scenario_stop":
		l.stopScenario()
		result = "正在停止测试"
	case "consume_subscription":
		subID, subErr := uuid.Parse(in.SubscriptionID)
		opID, opErr := uuid.Parse(in.ID)
		if subErr != nil || opErr != nil {
			output(w, 400, map[string]any{"error": "无效订阅或操作编号"})
			return
		}
		if err := l.consumeSubscription(ctx, in.Account, subID, opID, in.Points); err != nil {
			output(w, 409, map[string]any{"error": err.Error()})
			return
		}
		result = fmt.Sprintf("已模拟使用 %d 订阅积分。刷新该账号的「我的订阅」可测试退款限制。", in.Points)
	case "mode":
		if in.Mode != "normal" && in.Mode != "ambiguous" && in.Mode != "not_created" {
			http.Error(w, "invalid mode", 400)
			return
		}
		l.mu.Lock()
		l.mode = in.Mode
		l.mu.Unlock()
	case "pay", "paid_only", "callback", "expire":
		l.mu.Lock()
		o := l.gateway[in.ID]
		if o == nil {
			l.mu.Unlock()
			http.Error(w, "unknown provider order", 404)
			return
		}
		if in.Action == "expire" {
			o.State = -1
		} else if in.Action != "callback" {
			if o.State == -1 {
				l.mu.Unlock()
				http.Error(w, "order expired", 409)
				return
			}
			o.State = 1
		}
		snapshot := *o
		l.mu.Unlock()
		if in.Action == "callback" && snapshot.State != 1 {
			http.Error(w, "mark payment first", 409)
			return
		}
		if in.Action == "pay" || in.Action == "callback" {
			u, _ := url.Parse(l.callbackURL(snapshot))
			result, err = l.call("GET", u.RequestURI(), nil, false)
		}
	case "reconcile":
		_, err = l.st.Pool.Exec(ctx, `UPDATE orders SET reconcile_after=now() WHERE provider='lanjing' AND last_reconciled_at IS NULL AND reconcile_after<'infinity'::timestamptz`)
		if err == nil {
			result, err = l.call("POST", "/api/v1/admin/payment-reconciliations/run", nil, true)
		}
	case "catchup":
		l.mu.Lock()
		clock := l.currentClockLocked()
		l.mu.Unlock()
		err = subscription.Tick(ctx, l.st, clock)
	case "advance":
		l.mu.Lock()
		l.clock = l.clock.AddDate(0, 0, 1)
		clock := l.currentClockLocked()
		l.mu.Unlock()
		err = subscription.Tick(ctx, l.st, clock)
		result = map[string]any{"simulatedAt": clock}
	case "bulk":
		var exists int
		err = l.st.Pool.QueryRow(ctx, `SELECT count(*) FROM orders WHERE user_id=$1`, l.users["bulk"].ID).Scan(&exists)
		if err == nil && exists == 0 {
			_, err = l.st.Pool.Exec(ctx, `INSERT INTO orders(user_id,plan_id,amount_cents,grant_cents,bonus_cents,provider,status,created_at)
   SELECT $1,$2,990,1000,200,'lanjing','uncertain',now()-interval '60 days' FROM generate_series(1,550)`, l.users["bulk"].ID, l.plans["basic"].ID)
		}
		result = "550 笔历史待核实订单已准备，可连续运行对账验证覆盖"
	default:
		http.Error(w, "unknown action", 400)
		return
	}
	if err != nil {
		output(w, 500, map[string]any{"error": err.Error()})
		return
	}
	output(w, 200, map[string]any{"result": result})
}
