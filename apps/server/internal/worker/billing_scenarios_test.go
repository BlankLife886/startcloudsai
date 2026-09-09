package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/httpapi"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
)

type billingScenario struct {
	t                      *testing.T
	ctx                    context.Context
	st                     *store.Store
	cfg                    *config.Config
	api                    http.Handler
	worker                 *Worker
	pay                    *lanjingpay.Client
	adminToken             string
	modelServer            *httptest.Server
	mu                     sync.Mutex
	gate                   chan struct{}
	active, peak, calls    int
	activeUsers, peakUsers map[string]int
	userNames              map[string]string
}
type scenarioAccount struct {
	ID          uuid.UUID
	Token, Name string
}

func scenarioCheck(t *testing.T, name string, want, got any) {
	t.Helper()
	expected, actual := fmt.Sprint(want), fmt.Sprint(got)
	raw, _ := json.Marshal(map[string]any{"test": t.Name(), "name": name, "expected": expected, "actual": actual, "passed": expected == actual})
	fmt.Printf("BILLING_SCENARIO %s\n", raw)
	if expected != actual {
		t.Fatalf("%s: want %s, got %s", name, expected, actual)
	}
}

func newBillingScenario(t *testing.T) *billingScenario {
	t.Helper()
	parent, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	ctx, cancel := context.WithTimeout(parent, 90*time.Second)
	t.Cleanup(func() { cancel(); stop() })
	e := &billingScenario{t: t, ctx: ctx, st: testdb.Setup(t), activeUsers: map[string]int{}, peakUsers: map[string]int{}, userNames: map[string]string{}}
	e.cfg = config.Load()
	e.cfg.AppEnv = "development"
	e.cfg.AppSecret = "billing-scenario-local-only-secret-0001"
	e.cfg.RedisURL = ""
	e.cfg.WorkerConcurrency = 64
	e.cfg.WorkerImageMemoryMiB = 512
	e.modelServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" && r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		e.mu.Lock()
		owner := ""
		for id := range e.userNames {
			if strings.Contains(string(body), "SCENARIO_USER="+id) {
				owner = id
				break
			}
		}
		if owner != "" {
			e.activeUsers[owner]++
			if e.activeUsers[owner] > e.peakUsers[owner] {
				e.peakUsers[owner] = e.activeUsers[owner]
			}
		}
		e.active++
		e.calls++
		if e.active > e.peak {
			e.peak = e.active
		}
		gate := e.gate
		e.mu.Unlock()
		defer func() {
			e.mu.Lock()
			e.active--
			if owner != "" {
				e.activeUsers[owner]--
			}
			e.mu.Unlock()
		}()
		if gate != nil {
			select {
			case <-gate:
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"场景测试完成\"}}]}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(e.modelServer.Close)
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/createOrder" {
			method, _ := strconv.Atoi(r.Form.Get("type"))
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "data": map[string]any{"payId": r.Form.Get("payId"), "orderId": "scenario-" + r.Form.Get("payId"), "payType": method, "price": r.Form.Get("price"), "reallyPrice": r.Form.Get("price"), "payUrl": "https://example.invalid/scenario-qr", "state": 0, "isAuto": 0, "timeOut": 10, "date": time.Now().UnixMilli()}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 1})
	}))
	t.Cleanup(gateway.Close)
	var err error
	e.pay, err = lanjingpay.New(gateway.URL, "scenario-payment-secret", "http://scenario.test/api/v1/payments/lanjing/notify", 3*time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	e.api = (&httpapi.Server{Cfg: e.cfg, St: e.st, LanjingPay: e.pay}).Router()
	admin, err := store.UpsertAdminAccount(ctx, e.st.Pool, "scenario-admin@test.dev", "场景管理员", "x")
	if err != nil {
		t.Fatal(err)
	}
	e.adminToken = auth.NewSessionToken()
	if err = store.InsertAdminSession(ctx, e.st.Pool, admin.ID, auth.HashToken(e.adminToken), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	e.worker = New(e.cfg, e.st, nil, nil, nil)
	e.setModelPrice(3)
	t.Cleanup(func() { e.release(); cancel() })
	return e
}

func (e *billingScenario) request(method, path, token string, body any) (map[string]any, int) {
	e.t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(raw)).WithContext(e.ctx)
	req.Header.Set("Content-Type", "application/json")
	cookie := e.cfg.SessionCookieName
	if strings.HasPrefix(path, "/api/v1/admin/") {
		cookie = "sc_admin_session"
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: cookie, Value: token})
	}
	response := httptest.NewRecorder()
	e.api.ServeHTTP(response, req)
	var payload struct {
		Data  map[string]any `json:"data"`
		Error string         `json:"error"`
		Code  string         `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		e.t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
	}
	if response.Code >= 400 {
		return map[string]any{"error": payload.Error, "code": payload.Code}, response.Code
	}
	return payload.Data, response.Code
}
func (e *billingScenario) must(method, path, token string, body any) map[string]any {
	e.t.Helper()
	data, status := e.request(method, path, token, body)
	if status >= 400 {
		e.t.Fatalf("%s %s: %d %+v", method, path, status, data)
	}
	return data
}
func (e *billingScenario) account(name string) scenarioAccount {
	e.t.Helper()
	u, err := store.InsertUser(e.ctx, e.st.Pool, uuid.NewString()+"@scenario.test", name, "x", "user", nil)
	if err != nil {
		e.t.Fatal(err)
	}
	if err = store.InsertWallet(e.ctx, e.st.Pool, u.ID); err != nil {
		e.t.Fatal(err)
	}
	token := auth.NewSessionToken()
	if err = store.InsertSession(e.ctx, e.st.Pool, u.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		e.t.Fatal(err)
	}
	e.mu.Lock()
	e.userNames[u.ID.String()] = name
	e.mu.Unlock()
	return scenarioAccount{ID: u.ID, Token: token, Name: name}
}
func (e *billingScenario) plan(name string, price, points int64, tier, bonus int, lock, topup bool) map[string]any {
	policy := store.DefaultSubscriptionPolicy()
	policy.Tier = tier
	policy.ConcurrencyBonus = &bonus
	policy.LockModelPrices = &lock
	policy.AllowTopupPriceLock = topup
	return e.must("POST", "/api/v1/admin/plans", e.adminToken, map[string]any{"code": uuid.NewString(), "name": name, "kind": "subscription", "priceCents": price, "grantCents": 0, "durationDays": 30, "dailyGrantCents": points, "active": true, "subscriptionPolicy": policy})
}
func (e *billingScenario) setModelPrice(price int64) {
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "scenario-provider", Name: "本地模拟模型", Adapter: modelconfig.AdapterOpenAI, Enabled: true, Routes: []modelconfig.ProviderRoute{{ID: "scenario-route", Name: "本地线路", BaseURL: e.modelServer.URL, APIKey: "local-only-key", MaxConcurrency: 64, Enabled: true}}}}
	cfg.Models = []modelconfig.Model{{ID: "scenario-chat", Name: "测试对话模型", ProviderID: "scenario-provider", UpstreamModel: "scenario-chat", Kind: modelconfig.ModelKindChat, PriceCents: price, Public: true, Enabled: true, Default: true}}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceAssistant: {ModelIDs: []string{"scenario-chat"}}, modelconfig.WorkspaceCanvas: {ModelIDs: []string{"scenario-chat"}}}
	e.must("PUT", "/api/v1/admin/model-config", e.adminToken, cfg)
}
func (e *billingScenario) payOrder(order map[string]any) {
	e.t.Helper()
	id := order["id"].(string)
	amount, _ := lanjingpay.FormatCents(int64(order["amountCents"].(float64)))
	q := url.Values{"payId": {id}, "param": {id}, "type": {"2"}, "price": {amount}, "reallyPrice": {amount}, "sign": {e.pay.CallbackSignature(id, id, "2", amount, amount)}}
	r := httptest.NewRecorder()
	e.api.ServeHTTP(r, httptest.NewRequest("GET", "/api/v1/payments/lanjing/notify?"+q.Encode(), nil).WithContext(e.ctx))
	if r.Code != 200 || r.Body.String() != "success" {
		e.t.Fatalf("payment: %d %s", r.Code, r.Body.String())
	}
}
func (e *billingScenario) buy(a scenarioAccount, p map[string]any) map[string]any {
	order := e.must("POST", "/api/v1/orders", a.Token, map[string]any{"planId": p["id"], "paymentMethod": "alipay", "expectedPlanRevision": p["revision"]})
	e.payOrder(order)
	return order
}
func (e *billingScenario) pack(a scenarioAccount, eligible bool) {
	p := e.must("POST", "/api/v1/admin/plans", e.adminToken, map[string]any{"code": uuid.NewString(), "name": "场景额度包", "kind": "topup", "priceCents": 300, "grantCents": 100, "priceLockEligible": eligible, "active": true})
	order := e.must("POST", "/api/v1/orders", a.Token, map[string]any{"planId": p["id"], "paymentMethod": "alipay"})
	e.payOrder(order)
}
func (e *billingScenario) queue(a scenarioAccount, workspace string, allowQueue bool) (uuid.UUID, int, map[string]any) {
	conversation := e.must("POST", "/api/v1/assistant/conversations", a.Token, map[string]any{"title": "计费场景", "workspace": workspace})
	data, status := e.request("POST", "/api/v1/assistant/runs", a.Token, map[string]any{"conversationId": conversation["id"], "prompt": "只回复一句测试完成。SCENARIO_USER=" + a.ID.String(), "mode": "chat", "model": "scenario-chat", "workspace": workspace, "queue": allowQueue, "idempotencyKey": uuid.NewString()})
	if status >= 400 {
		return uuid.Nil, status, data
	}
	return uuid.MustParse(data["run"].(map[string]any)["id"].(string)), status, data
}
func (e *billingScenario) queueRun(a scenarioAccount, workspace string) uuid.UUID {
	e.t.Helper()
	id, status, data := e.queue(a, workspace, true)
	if status >= 400 {
		e.t.Fatalf("queue %s: %d %+v", a.Name, status, data)
	}
	return id
}
func (e *billingScenario) use(a scenarioAccount) int64 {
	e.t.Helper()
	id := e.queueRun(a, modelconfig.WorkspaceAssistant)
	run, err := e.worker.claimAssistantRun(e.ctx, id, "scenario-"+uuid.NewString())
	if err != nil || run == nil {
		e.t.Fatalf("claim=%+v %v", run, err)
	}
	if err = e.worker.executeAssistantRun(e.ctx, run); err != nil {
		e.t.Fatal(err)
	}
	stored, err := store.GetAssistantRun(e.ctx, e.st.Pool, id)
	if err != nil || stored.Status != "succeeded" {
		e.t.Fatalf("run=%+v %v", stored, err)
	}
	return stored.CostCents
}
func (e *billingScenario) subscription(a scenarioAccount) map[string]any {
	return e.must("GET", "/api/v1/me/subscription", a.Token, nil)
}
func (e *billingScenario) upgrade(a scenarioAccount, p map[string]any) {
	sub := e.subscription(a)
	quote := e.must("POST", "/api/v1/me/subscriptions/"+sub["id"].(string)+"/upgrade-quote", a.Token, map[string]any{"planId": p["id"]})
	order := e.must("POST", "/api/v1/orders", a.Token, map[string]any{"planId": p["id"], "paymentMethod": "alipay", "upgradeQuoteId": quote["id"]})
	e.payOrder(order)
}

func TestBillingScenarioPlanPrice(t *testing.T) {
	e := newBillingScenario(t)
	p := e.plan("调价前套餐", 1990, 100, 1, 2, true, false)
	active, pending, late := e.account("已订阅用户"), e.account("待支付用户"), e.account("新购买用户")
	e.buy(active, p)
	order := e.must("POST", "/api/v1/orders", pending.Token, map[string]any{"planId": p["id"], "paymentMethod": "alipay", "expectedPlanRevision": p["revision"]})
	changed := e.must("PATCH", "/api/v1/admin/plans/"+p["id"].(string), e.adminToken, map[string]any{"priceCents": 2990, "dailyGrantCents": 200, "subscriptionPolicy": map[string]any{"version": 2, "series": "general", "tier": 1, "channels": []string{"web", "api"}, "featureKeys": []string{}, "modelIds": []string{}, "concurrencyBonus": 4, "lockModelPrices": true}})
	_, status := e.request("POST", "/api/v1/orders", late.Token, map[string]any{"planId": p["id"], "paymentMethod": "alipay", "expectedPlanRevision": p["revision"]})
	scenarioCheck(t, "旧页面按旧版本建单被拦截", 409, status)
	e.payOrder(order)
	var paidAmount int64
	if err := e.st.Pool.QueryRow(e.ctx, `SELECT amount_cents FROM orders WHERE id=$1 AND status='completed'`, order["id"]).Scan(&paidAmount); err != nil {
		t.Fatal(err)
	}
	scenarioCheck(t, "调价前已建订单仍按原金额支付（元）", "19.90", fmt.Sprintf("%.2f", float64(paidAmount)/100))
	scenarioCheck(t, "待支付订单开通后保留原每日额度", float64(100), e.subscription(pending)["dailyGrantCents"])
	scenarioCheck(t, "已订阅用户保留原每日额度", float64(100), e.subscription(active)["dailyGrantCents"])
	newOrder := e.buy(late, changed)
	scenarioCheck(t, "新订单使用新套餐价格（元）", "29.90", fmt.Sprintf("%.2f", newOrder["amountCents"].(float64)/100))
	scenarioCheck(t, "新订阅使用新每日额度", float64(200), e.subscription(late)["dailyGrantCents"])
	scenarioCheck(t, "调价后老订阅实际调用与扣费", int64(3), e.use(active))
	account, err := store.GetUserConcurrency(e.ctx, e.st.Pool, active.ID)
	if err != nil {
		t.Fatal(err)
	}
	scenarioCheck(t, "已订阅用户保留原并发加成", 6, account.Limit)
}

func TestBillingScenarioModelPrice(t *testing.T) {
	e := newBillingScenario(t)
	protected := e.plan("锁价订阅", 1990, 30, 1, 2, true, true)
	unlocked := e.plan("不锁价订阅", 990, 30, 1, 0, false, false)
	old, fresh, plain, unlockedUser, refundable := e.account("旧锁价用户"), e.account("新锁价用户"), e.account("普通额度包用户"), e.account("不锁价用户"), e.account("退款重购用户")
	e.buy(old, protected)
	e.buy(unlockedUser, unlocked)
	e.buy(refundable, protected)
	e.pack(plain, false)
	scenarioCheck(t, "模型调价前真实调用扣3积分", int64(3), e.use(old))
	queued := e.queueRun(plain, modelconfig.WorkspaceAssistant)
	e.setModelPrice(5)
	run, err := e.worker.claimAssistantRun(e.ctx, queued, "price-snapshot")
	if err != nil || run == nil {
		t.Fatalf("claim %v", err)
	}
	if err = e.worker.executeAssistantRun(e.ctx, run); err != nil {
		t.Fatal(err)
	}
	stored, _ := store.GetAssistantRun(e.ctx, e.st.Pool, queued)
	scenarioCheck(t, "已确认并排队的调用仍按旧报价结算", int64(3), stored.CostCents)
	scenarioCheck(t, "旧锁价订阅调价后仍扣3积分", int64(3), e.use(old))
	e.buy(fresh, protected)
	scenarioCheck(t, "调价后新订阅实际扣5积分", int64(5), e.use(fresh))
	scenarioCheck(t, "不锁价订阅实际扣5积分", int64(5), e.use(unlockedUser))
	scenarioCheck(t, "普通额度包用户实际扣5积分", int64(5), e.use(plain))
	e.pack(old, true)
	for range 8 {
		if used := e.use(old); used != 3 {
			t.Fatalf("draining subscription used=%d", used)
		}
	}
	scenarioCheck(t, "订阅额度耗尽后合格额度包沿用锁价", int64(3), e.use(old))
	target := e.plan("升级套餐", 3990, 60, 2, 4, true, true)
	e.upgrade(old, target)
	scenarioCheck(t, "升级后按新模型价格扣5积分", int64(5), e.use(old))
	sub := e.subscription(refundable)
	refund := e.must("POST", "/api/v1/me/subscriptions/"+sub["id"].(string)+"/refund", refundable.Token, map[string]any{"reason": "场景测试未使用订阅退款"})
	e.must("POST", "/api/v1/admin/subscription-changes/"+refund["id"].(string)+"/review", e.adminToken, map[string]any{"action": "approve", "note": "测试核实未使用权益同意退款"})
	e.must("POST", "/api/v1/admin/subscription-changes/"+refund["id"].(string)+"/review", e.adminToken, map[string]any{"action": "confirm_external_refund", "note": "仅测试数据的模拟退款确认", "providerReference": "scenario-refund", "confirmed": true})
	e.buy(refundable, protected)
	scenarioCheck(t, "退款后重购按新模型价格扣5积分", int64(5), e.use(refundable))
	var spent int64
	if err = e.st.Pool.QueryRow(e.ctx, `SELECT sum(spent_points) FROM subscription_credit_lots WHERE user_id=$1`, old.ID).Scan(&spent); err != nil {
		t.Fatal(err)
	}
	scenarioCheck(t, "账本实际订阅消费累计与调用一致", int64(35), spent)
	e.mu.Lock()
	calls := e.calls
	e.mu.Unlock()
	scenarioCheck(t, "所有消费均发生了模型HTTP调用", 17, calls)
}
