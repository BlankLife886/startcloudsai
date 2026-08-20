package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestSettingsToCamelMasksSub2APIKey(t *testing.T) {
	st := testdb.Setup(t)
	const masterKey = "test-master-key"
	encrypted, err := settings.EncryptSecret("sub2api-secret-1234", masterKey)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(encrypted)
	if err := settings.Set(context.Background(), st.Pool, "sub2api_api_key", raw); err != nil {
		t.Fatal(err)
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/api/v1/admin/settings", nil)
	srv := &Server{Cfg: &config.Config{AppSecret: masterKey, WorkerConcurrency: 32}, St: st}
	out, err := srv.settingsToCamel(c)
	if err != nil {
		t.Fatal(err)
	}
	masked, ok := out["sub2apiApiKey"].(json.RawMessage)
	if !ok || string(masked) != `"****1234"` {
		t.Fatalf("sub2apiApiKey = %#v", out["sub2apiApiKey"])
	}
	if out["workerConcurrencyCeiling"] != int64(32) || out["effectiveGlobalConcurrency"] != int64(2000) {
		t.Fatalf("concurrency settings = ceiling %#v effective %#v", out["workerConcurrencyCeiling"], out["effectiveGlobalConcurrency"])
	}
	retries, ok := out["taskFailureRetryCount"].(json.RawMessage)
	if !ok || string(retries) != "2" {
		t.Fatalf("taskFailureRetryCount = %#v, want 2", out["taskFailureRetryCount"])
	}
	balancing, ok := out["crossProviderSameModelBalancingEnabled"].(json.RawMessage)
	if !ok || string(balancing) != "false" {
		t.Fatalf("crossProviderSameModelBalancingEnabled = %#v, want false", out["crossProviderSameModelBalancingEnabled"])
	}
}

func TestAdminLanjingPaySettingsAreEncryptedAndResolved(t *testing.T) {
	st := testdb.Setup(t)
	const masterKey = "payment-settings-master-key"
	srv := &Server{Cfg: &config.Config{
		AppEnv: "development", AppSecret: masterKey,
		LanjingPayBaseURL: "https://2347537.pay.lanjingzf.com", LanjingPayTimeoutSecs: 10,
	}, St: st}

	for _, body := range []string{
		`{"lanjingPayEnabled":true}`,
		`{"lanjingPayEnabled":true,"lanjingPayBaseUrl":"https://pay.example.com","lanjingPaySecret":"secret","lanjingPayNotifyUrl":"http://127.0.0.1/notify","lanjingPayAlipayEnabled":false,"lanjingPayWechatEnabled":false,"lanjingPayTimeoutSecs":10}`,
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		srv.adminPutSettings(c, nil)
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("invalid payment body status = %d body=%s", recorder.Code, recorder.Body.String())
		}
	}

	const validBody = `{
		"lanjingPayEnabled":true,
		"lanjingPayBaseUrl":"https://pay.example.com/",
		"lanjingPaySecret":"merchant-secret-1234",
		"lanjingPayNotifyUrl":"http://127.0.0.1/api/v1/payments/lanjing/notify",
		"lanjingPayTimeoutSecs":12,
		"lanjingPayAlipayEnabled":true,
		"lanjingPayWechatEnabled":false
	}`
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(validBody))
	c.Request.Header.Set("Content-Type", "application/json")
	srv.adminPutSettings(c, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("valid payment settings status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	rawSecret, err := settings.Get(context.Background(), st.Pool, "lanjing_pay_secret")
	if err != nil || strings.Contains(string(rawSecret), "merchant-secret-1234") {
		t.Fatalf("secret stored in plaintext: %s err=%v", rawSecret, err)
	}
	resolved, err := settings.ResolveLanjingPay(context.Background(), st.Pool, settings.LanjingPayConfig{}, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if !resolved.Enabled || resolved.Secret != "merchant-secret-1234" || resolved.BaseURL != "https://pay.example.com" || resolved.TimeoutSecs != 12 || !resolved.AlipayEnabled || resolved.WechatEnabled {
		t.Fatalf("resolved payment settings = %#v", resolved)
	}

	getContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	getContext.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/settings", nil)
	out, err := srv.settingsToCamel(getContext)
	if err != nil {
		t.Fatal(err)
	}
	if out["lanjingPaySecret"] != "****1234" {
		t.Fatalf("masked payment secret = %#v", out["lanjingPaySecret"])
	}
}

func TestAdminPutSettingsValidatesTaskFailureRetryCount(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{Cfg: &config.Config{}, St: st}
	for _, body := range []string{`{"taskFailureRetryCount":-1}`, `{"taskFailureRetryCount":101}`} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		srv.adminPutSettings(c, nil)
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("body %s status = %d, want 422", body, recorder.Code)
		}
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(`{"taskFailureRetryCount":7,"crossProviderSameModelBalancingEnabled":true}`))
	c.Request.Header.Set("Content-Type", "application/json")
	srv.adminPutSettings(c, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("valid retry count status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	got, err := settings.GetInt(context.Background(), st.Pool, "task_failure_retry_count")
	if err != nil || got != 7 {
		t.Fatalf("stored retry count = %d err=%v, want 7", got, err)
	}
	balancingEnabled, err := settings.GetBool(context.Background(), st.Pool, "cross_provider_same_model_balancing_enabled")
	if err != nil || !balancingEnabled {
		t.Fatalf("stored cross-provider balancing = %v err=%v, want true", balancingEnabled, err)
	}
}

func TestAdminPutSettingsValidatesCheckinCampaign(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{Cfg: &config.Config{}, St: st}
	invalidBodies := []string{
		`{"checkinRewards":[10,20]}`,
		`{"checkinRewards":[10,20,30,40,50,60,-1]}`,
		`{"checkinRewards":[0,0,0,0,0,0,0]}`,
		`{"checkinCampaignTitle":"签"}`,
		`{"checkinEnabled":"yes"}`,
	}
	for _, body := range invalidBodies {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		srv.adminPutSettings(c, nil)
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("body %s status = %d, want 422; response=%s", body, recorder.Code, recorder.Body.String())
		}
	}

	const validBody = `{"checkinEnabled":true,"checkinCampaignTitle":"  夏日连续创作计划  ","checkinRewards":[8,12,18,25,35,50,100]}`
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(validBody))
	c.Request.Header.Set("Content-Type", "application/json")
	srv.adminPutSettings(c, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("valid checkin campaign status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	title, err := settings.Get(context.Background(), st.Pool, "checkin_campaign_title")
	if err != nil || string(title) != `"夏日连续创作计划"` {
		t.Fatalf("stored title = %s err=%v", title, err)
	}
	rewards, err := settings.Get(context.Background(), st.Pool, "checkin_rewards")
	var storedRewards []int64
	decodeErr := json.Unmarshal(rewards, &storedRewards)
	if err != nil || decodeErr != nil || len(storedRewards) != 7 || storedRewards[0] != 8 || storedRewards[6] != 100 {
		t.Fatalf("stored rewards = %s err=%v", rewards, err)
	}
}

func TestAdminPutSettingsValidatesGrowthPrograms(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{Cfg: &config.Config{}, St: st}
	invalidBodies := []string{
		`{"growthGroupTargetMembers":1}`,
		`{"growthGroupDurationHours":0}`,
		`{"growthFailureBonusDailyLimit":101}`,
		`{"growthGroupCampaignKey":"x"}`,
		`{"growthUsageMilestones":[]}`,
		`{"growthUsageMilestones":[{"units":10,"rewardCents":20},{"units":10,"rewardCents":30}]}`,
		`{"growthUsageMilestones":[{"units":10,"rewardCents":0}]}`,
	}
	for _, body := range invalidBodies {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		srv.adminPutSettings(c, nil)
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("body %s status = %d, want 422; response=%s", body, recorder.Code, recorder.Body.String())
		}
	}

	const validBody = `{
		"growthGroupEnabled":true,
		"growthGroupCampaignKey":" autumn-2026 ",
		"growthGroupTargetMembers":4,
		"growthGroupRewardCents":45,
		"growthGroupDurationHours":72,
		"growthFailureBonusEnabled":true,
		"growthFailureBonusCents":5,
		"growthFailureBonusDailyLimit":2,
		"growthUsageRewardsEnabled":true,
		"growthUsageMilestones":[{"units":20,"rewardCents":30},{"units":80,"rewardCents":120}],
		"suggestionRewardMaxCents":8000
	}`
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(validBody))
	c.Request.Header.Set("Content-Type", "application/json")
	srv.adminPutSettings(c, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("valid growth settings status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	campaign, err := settings.Get(context.Background(), st.Pool, "growth_group_campaign_key")
	if err != nil || string(campaign) != `"autumn-2026"` {
		t.Fatalf("stored campaign = %s err=%v", campaign, err)
	}
	milestones, err := settings.Get(context.Background(), st.Pool, "growth_usage_milestones")
	var storedMilestones []struct {
		Units       int64 `json:"units"`
		RewardCents int64 `json:"rewardCents"`
	}
	decodeErr := json.Unmarshal(milestones, &storedMilestones)
	if err != nil || decodeErr != nil || len(storedMilestones) != 2 || storedMilestones[1].RewardCents != 120 {
		t.Fatalf("stored milestones = %s err=%v decodeErr=%v", milestones, err, decodeErr)
	}
}

func TestAdminPutSettingsRejectsRetiredTrialCampaignFields(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{Cfg: &config.Config{}, St: st}
	retiredBodies := []string{
		`{"trialCampaignEnabled":true}`,
		`{"trialCampaignTitle":"新功能限量体验"}`,
		`{"trialCampaignFeatureKey":"ui_design"}`,
		`{"trialCampaignFeatureKeys":["ui_design","game_art"]}`,
		`{"trialCampaignAccessMode":"restricted"}`,
		`{"trialCampaignCapacity":100}`,
		`{"trialCampaignDisplayOffset":12}`,
	}
	for _, body := range retiredBodies {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		srv.adminPutSettings(c, nil)
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("retired body %s status = %d, want 422; response=%s", body, recorder.Code, recorder.Body.String())
		}
	}
}

func TestAdminPutSettingsValidatesPageControls(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{Cfg: &config.Config{}, St: st}
	invalidBodies := []string{
		`{"pageControls":{"unknown":{"status":"normal","reason":""}}}`,
		`{"pageControls":{"studio":{"status":"paused","reason":"暂停"}}}`,
	}
	for _, body := range invalidBodies {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		srv.adminPutSettings(c, nil)
		if recorder.Code != http.StatusUnprocessableEntity {
			t.Fatalf("body %s status = %d, want 422; response=%s", body, recorder.Code, recorder.Body.String())
		}
	}

	const validBody = `{"pageControls":{"studio":{"status":"maintenance","reason":"  系统升级中  "},"pricing":{"status":"normal","reason":""}}}`
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(validBody))
	c.Request.Header.Set("Content-Type", "application/json")
	srv.adminPutSettings(c, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("valid page controls status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	controls, err := settings.ResolvePageControls(context.Background(), st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	if got := controls["studio"]; got.Status != settings.PageStatusMaintenance || got.Reason != "系统升级中" {
		t.Fatalf("studio control = %#v", got)
	}
	if got := controls["activity.checkin"]; got.Status != settings.PageStatusRemoved {
		t.Fatalf("default check-in control = %#v", got)
	}
}

func TestAdminModelListCleansSortsAndCaps(t *testing.T) {
	models, total := adminModelList([]string{" z-model ", "a-model", "", "a-model", "m-model"}, 2)
	if total != 3 {
		t.Fatalf("total = %d, want 3", total)
	}
	if len(models) != 2 || models[0] != "a-model" || models[1] != "m-model" {
		t.Fatalf("models = %#v", models)
	}
}
