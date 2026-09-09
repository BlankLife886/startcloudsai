package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestSubscriptionLifecycleAPI(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, seed := makeOrder(t, st)
	if _, err := store.TransitionPendingOrderStatus(ctx, st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	makePlan := func(tier int, price, points int64) *store.Plan {
		p := store.DefaultSubscriptionPolicy()
		p.Tier = tier
		plan, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: uuid.NewString(), Name: "订阅测试", Kind: "subscription", DurationDays: 3, DailyGrantCents: points, PriceCents: price, Active: true, SubscriptionPolicy: p})
		if err != nil {
			t.Fatal(err)
		}
		return plan
	}
	base, target := makePlan(1, 300, 100), makePlan(2, 600, 200)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.URL.Path == "/createOrder" {
			method, _ := strconv.Atoi(r.Form.Get("type"))
			_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "data": gin.H{"payId": r.Form.Get("payId"), "orderId": "provider-" + r.Form.Get("payId"), "payType": method, "price": r.Form.Get("price"), "reallyPrice": r.Form.Get("price"), "payUrl": "https://example.com/qr", "state": 0, "isAuto": 0, "timeOut": 10, "date": time.Now().UnixMilli()}})
			return
		}
		_ = json.NewEncoder(w).Encode(gin.H{"code": 1})
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "lifecycle-secret", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client}
	router := srv.Router()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	request := func(method, path string, body any, session *http.Cookie) map[string]any {
		t.Helper()
		r := authRequest(t, router, method, path, body, session)
		if r.Code >= 400 {
			t.Fatalf("%s %s: %d %s", method, path, r.Code, r.Body.String())
		}
		var data struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(r.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		return data.Data
	}
	create := func(plan *store.Plan, quote string) map[string]any {
		return request("POST", "/api/v1/orders", gin.H{"planId": plan.ID, "paymentMethod": "alipay", "upgradeQuoteId": quote}, cookie)
	}
	pay := func(order map[string]any) {
		t.Helper()
		amount, _ := lanjingpay.FormatCents(int64(order["amountCents"].(float64)))
		for range 2 {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("GET", lanjingCallbackPath(client, order["id"].(string), "2", amount, amount), nil))
			if w.Code != 200 || w.Body.String() != "success" {
				t.Fatalf("payment: %d %s", w.Code, w.Body.String())
			}
		}
	}
	first := create(base, "")
	pay(first)
	current := request("GET", "/api/v1/me/subscription", nil, cookie)
	if current["active"] != true || current["billingVersion"] != float64(2) {
		t.Fatalf("current=%+v", current)
	}
	subID := current["id"].(string)
	ends := current["endsAt"]
	denied := authRequest(t, router, "POST", "/api/v1/orders", gin.H{"planId": target.ID, "paymentMethod": "alipay"}, cookie)
	if denied.Code != 409 {
		t.Fatalf("second subscription: %d", denied.Code)
	}
	topup, err := store.GetPlan(ctx, st.Pool, seed.PlanID)
	if err != nil {
		t.Fatal(err)
	}
	pack := create(topup, "")
	request("POST", "/api/v1/orders/"+pack["id"].(string)+"/close", nil, cookie)
	quote := request("POST", "/api/v1/me/subscriptions/"+subID+"/upgrade-quote", gin.H{"planId": target.ID}, cookie)
	upgraded := create(target, quote["id"].(string))
	pay(upgraded)
	current = request("GET", "/api/v1/me/subscription", nil, cookie)
	newStart, startErr := time.Parse(time.RFC3339Nano, current["startsAt"].(string))
	newEnd, endErr := time.Parse(time.RFC3339Nano, current["endsAt"].(string))
	oldEnd, _ := time.Parse(time.RFC3339Nano, ends.(string))
	if startErr != nil || endErr != nil || newEnd.Sub(newStart) != 72*time.Hour || !newEnd.After(oldEnd) || current["planId"] != target.ID.String() {
		t.Fatalf("upgrade did not restart full period: %+v", current)
	}
	w, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || w.SubscriptionBalanceCents != 200 {
		t.Fatalf("upgrade balance=%+v %v", w, err)
	}
	records := request("GET", "/api/v1/me/subscriptions/"+subID+"/grants", nil, cookie)
	if records["total"] != float64(2) {
		t.Fatalf("grant records=%+v", records)
	}
	preview := request("GET", "/api/v1/me/subscriptions/"+subID+"/refund-preview", nil, cookie)
	if preview["estimatedAmountCents"].(float64) <= 0 {
		t.Fatal("no refund quote")
	}
	refund := request("POST", "/api/v1/me/subscriptions/"+subID+"/refund", gin.H{"reason": "购买错误申请退订退款"}, cookie)
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "sub-admin@example.com", "admin", "test-hash")
	if err != nil {
		t.Fatal(err)
	}
	adminToken := auth.NewSessionToken()
	if err := store.InsertAdminSession(ctx, st.Pool, admin.ID, auth.HashToken(adminToken), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	adminCookie := &http.Cookie{Name: "sc_admin_session", Value: adminToken}
	review := "/api/v1/admin/subscription-changes/" + refund["id"].(string) + "/review"
	unauthorized := authRequest(t, router, "POST", review, gin.H{"action": "approve", "note": "不允许普通用户审核"}, cookie)
	if unauthorized.Code != 401 && unauthorized.Code != 403 {
		t.Fatal("user could review refund")
	}
	request("POST", review, gin.H{"action": "approve", "note": "INTERNAL-ONLY 已核查未使用订阅积分"}, adminCookie)
	publicChange := request("GET", "/api/v1/me/subscription-changes/"+refund["id"].(string), nil, cookie)
	encoded, _ := json.Marshal(publicChange)
	if strings.Contains(string(encoded), "INTERNAL-ONLY") || strings.Contains(string(encoded), admin.ID.String()) || publicChange["publicMessage"] == nil {
		t.Fatalf("private audit leaked: %s", encoded)
	}
	detail := request("GET", "/api/v1/admin/subscription-changes/"+refund["id"].(string), nil, adminCookie)
	if len(detail["orders"].([]any)) != 2 || len(detail["events"].([]any)) != 2 || len(detail["ledger"].([]any)) == 0 {
		t.Fatalf("missing accounting detail: %+v", detail)
	}
	search := request("GET", "/api/v1/admin/subscription-changes?q="+user.Email, nil, adminCookie)
	if search["total"].(float64) != 2 {
		t.Fatalf("account search failed: %+v", search)
	}
	previewCalc := preview["calculation"].(map[string]any)
	if previewCalc["spentPoints"] != float64(0) || previewCalc["paidCents"].(float64) <= 0 {
		t.Fatalf("missing refund basis: %+v", previewCalc)
	}
	w, err = store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || w.SubscriptionBalanceCents != 0 || w.SubscriptionHeldCents != 200 {
		t.Fatalf("refund hold=%+v %v", w, err)
	}
	bad := authRequest(t, router, "POST", review, gin.H{"action": "confirm_external_refund", "note": "缺少渠道退款流水号"}, adminCookie)
	if bad.Code != 409 {
		t.Fatal("refund confirmed without evidence")
	}
	request("POST", review, gin.H{"action": "confirm_external_refund", "note": "已在测试渠道确认实际退款成功", "providerReference": "test-refund-" + refund["id"].(string)}, adminCookie)
	current = request("GET", "/api/v1/me/subscription", nil, cookie)
	if current["active"] != false || current["blockingPurchase"] != false {
		t.Fatalf("subscription still blocks: %+v", current)
	}
	receipt := request("GET", "/api/v1/me/subscription-changes/"+refund["id"].(string), nil, cookie)
	if receipt["refundCalculation"] == nil {
		t.Fatal("confirmation discarded the refund calculation snapshot")
	}
	center := request("GET", "/api/v1/me/subscriptions", nil, cookie)
	if len(center["items"].([]any)) != 1 {
		t.Fatal("upgrade created a second subscription")
	}
	for _, source := range []string{"subscription_refund_reviewing", "subscription_refund_processing", "subscription_refund_completed", "subscription_upgrade_completed", "subscription_initial"} {
		want := 1
		if source == "subscription_initial" {
			want = 2
		}
		var count int
		if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id=$1 AND source_type=$2 AND target_path LIKE '/subscriptions?%'`, user.ID, source).Scan(&count); err != nil || count != want {
			t.Fatalf("notification %s count=%d err=%v", source, count, err)
		}
	}
	stats, err := store.UserWalletLedgerStats(ctx, st.Pool, user.ID)
	if err != nil || stats.ConsumedCount != 0 {
		t.Fatalf("refund collection counted as task spending: %+v %v", stats, err)
	}
	stranger, _ := makeOrder(t, st)
	otherToken := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, stranger.ID, auth.HashToken(otherToken), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	forbidden := authRequest(t, router, "GET", "/api/v1/me/subscriptions/"+subID+"/grants", nil, &http.Cookie{Name: cfg.SessionCookieName, Value: otherToken})
	if forbidden.Code != 404 {
		t.Fatal("another user accessed subscription grants")
	}

	manualOrder := create(base, "")
	pay(manualOrder)
	manualSub, err := store.SubscriptionForPaidOrder(ctx, st.Pool, uuid.MustParse(manualOrder["id"].(string)))
	if err != nil || manualSub == nil {
		t.Fatalf("manual subscription: %+v %v", manualSub, err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.FreezeFeatureCredits(ctx, tx, user.ID, 1, "text_to_image", "test", "manual-consumed", nil); err != nil {
			return err
		}
		_, err := wallet.SettleFeatureCredits(ctx, tx, user.ID, 1, "test", "manual-consumed", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	manualPath := "/api/v1/admin/orders/" + manualOrder["id"].(string) + "/subscription-refund"
	manualInput := gin.H{"amountCents": 200, "note": "INTERNAL-ONLY 人工协商例外退还两元", "confirmed": true}
	for _, method := range []string{"GET", "POST"} {
		for _, sessions := range [][]*http.Cookie{nil, {cookie}} {
			response := authRequest(t, router, method, manualPath, manualInput, sessions...)
			if response.Code != 401 && response.Code != 403 {
				t.Fatalf("manual endpoint allowed non-admin: %d %s", response.Code, response.Body.String())
			}
		}
	}
	forged := authRequest(t, router, "POST", "/api/v1/me/subscriptions/"+manualSub.ID.String()+"/refund", gin.H{"reason": "尝试通过传参绕过退款限制", "manualRefund": true, "confirmed": true, "amountCents": 200}, cookie)
	if forged.Code != 409 && forged.Code != 422 {
		t.Fatalf("user forged manual override: %d %s", forged.Code, forged.Body.String())
	}
	manualPreview := request("GET", manualPath, nil, adminCookie)
	if manualPreview["maxManualAmountCents"] != float64(300) || manualPreview["calculation"].(map[string]any)["spentPoints"] != float64(1) {
		t.Fatalf("incorrect manual preview: %+v", manualPreview)
	}
	unconfirmed := authRequest(t, router, "POST", manualPath, gin.H{"amountCents": 200, "note": "必须明确确认人工例外退款"}, adminCookie)
	if unconfirmed.Code != 422 {
		t.Fatalf("accepted unconfirmed manual refund: %d", unconfirmed.Code)
	}
	manual := request("POST", manualPath, manualInput, adminCookie)
	if manual["status"] != "processing" || manual["snapshot"].(map[string]any)["manualRefund"] != true {
		t.Fatalf("manual refund pretended completed: %+v", manual)
	}
	manualID := manual["id"].(string)
	publicManual := request("GET", "/api/v1/me/subscription-changes/"+manualID, nil, cookie)
	encoded, _ = json.Marshal(publicManual)
	if strings.Contains(string(encoded), "INTERNAL-ONLY") || strings.Contains(string(encoded), admin.ID.String()) {
		t.Fatalf("manual note leaked: %s", encoded)
	}
	w, err = store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || w.SubscriptionHeldCents != 99 {
		t.Fatalf("manual request did not freeze unused credits: %+v %v", w, err)
	}
	request("POST", "/api/v1/admin/subscription-changes/"+manualID+"/review", gin.H{"action": "confirm_external_refund", "note": "已核对模拟渠道例外退款成功", "providerReference": "manual-api-" + manualID}, adminCookie)
	manualReceipt := request("GET", "/api/v1/me/subscription-changes/"+manualID, nil, cookie)
	if manualReceipt["status"] != "completed" || manualReceipt["amountCents"] != float64(200) {
		t.Fatalf("manual confirmation failed: %+v", manualReceipt)
	}
	endedFound := false
	for _, value := range request("GET", "/api/v1/me/subscriptions", nil, cookie)["items"].([]any) {
		item := value.(map[string]any)
		if item["id"] != manualSub.ID.String() {
			continue
		}
		endedFound = true
		if item["status"] != "cancelled" || item["revokedPoints"] != float64(99) || item["spentPoints"] != float64(1) || item["nextGrantAt"] != nil || item["frozenPoints"] != float64(0) || item["canChange"] != false {
			t.Fatalf("ended subscription overview is stale: %+v", item)
		}
	}
	if !endedFound {
		t.Fatal("ended subscription disappeared from history")
	}
}
