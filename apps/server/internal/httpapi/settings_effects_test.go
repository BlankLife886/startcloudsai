package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// 系统设置保存后必须真实改变用户侧行为：以下用例先写设置，再走用户会调用的接口验证效果。

func setSetting(t *testing.T, st *store.Store, key, raw string) {
	t.Helper()
	if err := settings.Set(context.Background(), st.Pool, key, json.RawMessage(raw)); err != nil {
		t.Fatalf("set %s: %v", key, err)
	}
}

func cookieRequest(engine http.Handler, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	var reader *strings.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = strings.NewReader(string(raw))
	} else {
		reader = strings.NewReader("")
	}
	request := httptest.NewRequest(method, path, reader)
	request.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	return recorder
}

func TestSettingsEffectSignupBonusFollowsConfiguredAmount(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	ctx := context.Background()
	for _, tc := range []struct {
		email string
		bonus string
		want  int64
	}{
		{"bonus.two.fifty@qq.com", "250", 250},
		{"bonus.zero@qq.com", "0", 0},
	} {
		setSetting(t, st, "signup_bonus_cents", tc.bonus)
		code := requestDevelopmentCode(t, engine, tc.email)
		response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": tc.email, "code": code})
		if response.Code != http.StatusOK {
			t.Fatalf("%s register = %d %s", tc.email, response.Code, response.Body.String())
		}
		user, err := store.GetUserByEmail(ctx, st.Pool, tc.email)
		if err != nil || user == nil {
			t.Fatalf("user %s: %v %v", tc.email, user, err)
		}
		wallet, err := store.GetWallet(ctx, st.Pool, user.ID)
		if err != nil || wallet.BalanceCents != tc.want {
			t.Fatalf("%s wallet = %+v err=%v, want %d", tc.email, wallet, err, tc.want)
		}
	}
}

func TestSettingsEffectPromptLimitsReachRuntimeConfigAndTaskCreation(t *testing.T) {
	s, st, _, cookie := createEmailAccount(t, "prompt.limits@qq.com")
	engine := s.Router()
	setSetting(t, st, "t2i_prompt_max_chars", "150")
	setSetting(t, st, "assistant_message_max_chars", "300")
	setSetting(t, st, "studio_hub_prompt_max_chars", "400")

	runtime := cookieRequest(engine, http.MethodGet, "/api/v1/runtime-config", nil, nil)
	if runtime.Code != http.StatusOK {
		t.Fatalf("runtime-config = %d %s", runtime.Code, runtime.Body.String())
	}
	var body struct {
		Data struct {
			PromptInputLimits map[string]int `json:"promptInputLimits"`
		} `json:"data"`
	}
	_ = json.Unmarshal(runtime.Body.Bytes(), &body)
	limits := body.Data.PromptInputLimits
	if limits["t2iPromptMaxChars"] != 150 || limits["assistantMessageMaxChars"] != 300 || limits["studioHubPromptMaxChars"] != 400 {
		t.Fatalf("promptInputLimits = %v", limits)
	}

	tooLong := cookieRequest(engine, http.MethodPost, "/api/v1/tasks", gin.H{"type": "t2i", "prompt": strings.Repeat("长", 200)}, cookie)
	if tooLong.Code != http.StatusUnprocessableEntity || !strings.Contains(tooLong.Body.String(), "不能超过 150") {
		t.Fatalf("200-char t2i prompt = %d %s, want 422 mentioning the 150 limit", tooLong.Code, tooLong.Body.String())
	}
	withinLimit := cookieRequest(engine, http.MethodPost, "/api/v1/tasks", gin.H{"type": "t2i", "prompt": strings.Repeat("短", 120)}, cookie)
	if strings.Contains(withinLimit.Body.String(), "不能超过") {
		t.Fatalf("120-char t2i prompt rejected by the length limit: %s", withinLimit.Body.String())
	}
}

func TestSettingsEffectPaymentSwitchesGatePlansAndOrders(t *testing.T) {
	s, st, _, cookie := createEmailAccount(t, "payment.switches@qq.com")
	engine := s.Router()
	encrypted, err := settings.EncryptSecret("payment-switch-secret", s.Cfg.AppSecret)
	if err != nil {
		t.Fatal(err)
	}
	secret, _ := json.Marshal(encrypted)
	setSetting(t, st, "lanjing_pay_enabled", "true")
	setSetting(t, st, "lanjing_pay_base_url", `"https://2347537.pay.lanjingzf.com"`)
	setSetting(t, st, "lanjing_pay_secret", string(secret))
	setSetting(t, st, "lanjing_pay_notify_url", `"https://example.com/api/v1/payments/lanjing/notify"`)
	setSetting(t, st, "lanjing_pay_alipay_enabled", "true")
	setSetting(t, st, "lanjing_pay_wechat_enabled", "false")

	type plansBody struct {
		Data struct {
			PaymentEnabled bool     `json:"paymentEnabled"`
			PaymentMethods []string `json:"paymentMethods"`
		} `json:"data"`
	}
	readPlans := func() plansBody {
		t.Helper()
		response := cookieRequest(engine, http.MethodGet, "/api/v1/plans", nil, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("plans = %d %s", response.Code, response.Body.String())
		}
		var out plansBody
		_ = json.Unmarshal(response.Body.Bytes(), &out)
		return out
	}

	plans := readPlans()
	if !plans.Data.PaymentEnabled || strings.Join(plans.Data.PaymentMethods, ",") != "alipay" {
		t.Fatalf("with wechat off plans = %+v, want only alipay", plans.Data)
	}
	wechatOrder := cookieRequest(engine, http.MethodPost, "/api/v1/orders", gin.H{"paymentMethod": "wechat", "planId": "00000000-0000-0000-0000-000000000000"}, cookie)
	if wechatOrder.Code != http.StatusUnprocessableEntity || !strings.Contains(wechatOrder.Body.String(), "payment_method_unavailable") {
		t.Fatalf("wechat order while disabled = %d %s", wechatOrder.Code, wechatOrder.Body.String())
	}

	setSetting(t, st, "lanjing_pay_enabled", "false")
	plans = readPlans()
	if plans.Data.PaymentEnabled {
		t.Fatalf("payment disabled but plans report enabled: %+v", plans.Data)
	}
	disabledOrder := cookieRequest(engine, http.MethodPost, "/api/v1/orders", gin.H{"paymentMethod": "alipay", "planId": "00000000-0000-0000-0000-000000000000"}, cookie)
	if disabledOrder.Code != http.StatusServiceUnavailable {
		t.Fatalf("order with payment disabled = %d %s, want 503", disabledOrder.Code, disabledOrder.Body.String())
	}
}

func TestSettingsEffectSuggestionRewardCapLimitsAdoptionReward(t *testing.T) {
	env := newCommunityEnv(t)
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	if err := store.InsertWallet(context.Background(), env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	setSetting(t, env.st, "suggestion_reward_max_cents", "300")
	submitted := env.do(t, http.MethodPost, "/api/v1/me/feedback", gin.H{
		"category": "suggestion", "title": "建议支持批量导出", "content": "希望任务列表可以一次导出选中的全部图片。",
	}, userToken)
	data, _ := decode(t, submitted)
	id := data["id"].(string)

	overCap := env.do(t, http.MethodPatch, "/api/v1/admin/feedback/"+id, gin.H{
		"status": "resolved", "adminReply": "已采纳。", "adopted": true, "rewardCents": 500,
	}, adminToken)
	if overCap.Code != http.StatusUnprocessableEntity || !strings.Contains(overCap.Body.String(), "1-300") {
		t.Fatalf("reward 500 over cap 300 = %d %s", overCap.Code, overCap.Body.String())
	}
	atCap := env.do(t, http.MethodPatch, "/api/v1/admin/feedback/"+id, gin.H{
		"status": "resolved", "adminReply": "已采纳。", "adopted": true, "rewardCents": 300,
	}, adminToken)
	if atCap.Code != http.StatusOK {
		t.Fatalf("reward 300 at cap = %d %s", atCap.Code, atCap.Body.String())
	}
	wallet, err := store.GetWallet(context.Background(), env.st.Pool, user.ID)
	if err != nil || wallet.BalanceCents != 300 {
		t.Fatalf("wallet after adoption = %+v err=%v, want 300", wallet, err)
	}
}

func TestSettingsEffectImageAnalysisUsesConfiguredProviderModelAndEffort(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	s := newUserLoginTestServer(st)

	type captured struct {
		path, auth, model, effort string
	}
	requests := make(chan captured, 4)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		effort, _ := body["reasoning_effort"].(string)
		if reasoning, ok := body["reasoning"].(map[string]any); ok && effort == "" {
			effort, _ = reasoning["effort"].(string)
		}
		model, _ := body["model"].(string)
		requests <- captured{path: r.URL.Path, auth: r.Header.Get("Authorization"), model: model, effort: effort}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"一张测试图片"}}]}`))
	}))
	defer upstream.Close()

	key, err := settings.EncryptSecret("analysis-upstream-key", s.Cfg.AppSecret)
	if err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "vision-provider", Name: "Vision", Adapter: "openai", Enabled: true, TimeoutSecs: 10,
		Routes: []modelconfig.ProviderRoute{{ID: "primary", Name: "Primary", BaseURL: upstream.URL, APIKey: key, TimeoutSecs: 10, Enabled: true}},
	}}
	cfg.Models = []modelconfig.Model{{
		ID: "vision-model", Name: "Vision Model", ProviderID: "vision-provider", UpstreamModel: "vision-upstream-v1",
		Kind: "chat", Enabled: true, SupportedReasoningEfforts: []string{"low", "high"},
	}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}

	// 未配置：后台图片分析不可用
	if _, err := s.adminImageAnalysisClient(ctx); err == nil || !strings.Contains(err.Error(), "尚未正确配置") {
		t.Fatalf("unconfigured analysis client err = %v", err)
	}

	setSetting(t, st, "admin_image_analysis_provider_id", `"vision-provider"`)
	setSetting(t, st, "admin_image_analysis_model_id", `"vision-model"`)
	setSetting(t, st, "admin_image_analysis_reasoning_effort", `"high"`)
	client, err := s.adminImageAnalysisClient(ctx)
	if err != nil {
		t.Fatalf("configured analysis client: %v", err)
	}
	_, _ = client.CompleteChatTextWithImages(ctx, []sub2api.Message{{Role: "user", Content: "描述这张图片"}}, nil, nil)
	select {
	case got := <-requests:
		if got.model != "vision-upstream-v1" || got.effort != "high" || got.auth != "Bearer analysis-upstream-key" {
			t.Fatalf("analysis request = %+v, want model vision-upstream-v1, effort high, configured key", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("analysis client never called the configured upstream")
	}
}
