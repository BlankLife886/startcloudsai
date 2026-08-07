package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/redemption"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func mustActiveTrialCampaign(t *testing.T, env *communityEnv) *store.TrialCampaign {
	t.Helper()
	item, err := store.GetActiveTrialCampaign(context.Background(), env.st.Pool)
	if err != nil || item == nil {
		t.Fatalf("active trial campaign = %#v err=%v", item, err)
	}
	return item
}

func futureTrialCampaignExpiry() string {
	return time.Now().UTC().Add(30 * 24 * time.Hour).Format(time.RFC3339)
}

func updateTrialCampaign(t *testing.T, env *communityEnv, featureKeys []string, accessMode string, capacity, displayOffset int64) *store.TrialCampaign {
	t.Helper()
	item := mustActiveTrialCampaign(t, env)
	if featureKeys == nil {
		featureKeys = item.FeatureKeys
	}
	if accessMode == "" {
		accessMode = item.AccessMode
	}
	if capacity == 0 {
		capacity = item.Capacity
	}
	updated, err := store.UpdateTrialCampaign(
		context.Background(), env.st.Pool, item.ID, item.Title, featureKeys, accessMode,
		capacity, displayOffset, item.ExpiresAt, time.Now().UTC(),
	)
	if err != nil {
		t.Fatal(err)
	}
	return updated
}

func TestTrialAccessApplicationApprovalAndExclusiveRedemption(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, userToken := env.newUserSession(t, "user")
	other, otherToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatalf("insert user wallet: %v", err)
	}
	if err := store.InsertWallet(ctx, env.st.Pool, other.ID); err != nil {
		t.Fatalf("insert other wallet: %v", err)
	}

	payload := gin.H{
		"occupation": "Independent visual designer; Generative AI workflow consultant; Digital product designer; Creative technology educator",
		"reason":     "希望体验批量生成设计素材，并用于真实项目工作流测试。",
	}
	if w := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", payload, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous submit status = %d, body=%s", w.Code, w.Body.String())
	}
	tooMany := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "设计师、插画师、开发者、摄影师、学生",
		"reason":     "希望测试超过四个职业时服务端能拒绝本次体验资格申请。",
	}, userToken)
	if tooMany.Code != http.StatusUnprocessableEntity {
		t.Fatalf("too many occupations status = %d, body=%s", tooMany.Code, tooMany.Body.String())
	}

	submitted := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", payload, userToken)
	if submitted.Code != http.StatusCreated {
		t.Fatalf("submit status = %d, body=%s", submitted.Code, submitted.Body.String())
	}
	data, _ := decode(t, submitted)
	application, ok := data["application"].(map[string]any)
	if !ok || application["status"] != "pending" {
		t.Fatalf("submitted application = %#v", data["application"])
	}
	if application["featureKey"] != "text_to_image" {
		t.Fatalf("submitted feature = %#v", application)
	}
	feature, _ := application["feature"].(map[string]any)
	if feature["label"] != "文生图" || feature["route"] != "/text-to-image" {
		t.Fatalf("submitted feature metadata = %#v", feature)
	}
	applicationID, _ := application["id"].(string)
	if applicationID == "" {
		t.Fatal("missing application id")
	}

	duplicate := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", payload, userToken)
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d, body=%s", duplicate.Code, duplicate.Body.String())
	}
	_, code := decode(t, duplicate)
	if code != "trial_application_pending" {
		t.Fatalf("duplicate code = %q", code)
	}

	listed := env.do(t, http.MethodGet, "/api/v1/admin/trial-access-applications?status=pending&limit=20", nil, adminToken)
	if listed.Code != http.StatusOK {
		t.Fatalf("admin list status = %d, body=%s", listed.Code, listed.Body.String())
	}

	approved := env.do(t, http.MethodPatch, "/api/v1/admin/trial-access-applications/"+applicationID, gin.H{
		"status":     "approved",
		"grantCents": 500,
		"expiresAt":  time.Now().UTC().Add(30 * 24 * time.Hour).Format(time.RFC3339),
		"reviewNote": "符合体验用户要求",
	}, adminToken)
	if approved.Code != http.StatusOK {
		t.Fatalf("approve status = %d, body=%s", approved.Code, approved.Body.String())
	}
	approvedData, _ := decode(t, approved)
	if approvedData["status"] != "approved" || approvedData["rewardStatus"] != "active" {
		t.Fatalf("approved data = %#v", approvedData)
	}
	if approvedData["entitlementActive"] != true {
		t.Fatalf("approved entitlement = %#v", approvedData)
	}
	if _, exposed := approvedData["redemptionCode"]; exposed {
		t.Fatalf("admin approval must not expose redemption code: %#v", approvedData)
	}
	if got := int64(approvedData["rewardCents"].(float64)); got != 500 {
		t.Fatalf("reward cents = %d, want 500", got)
	}

	var approvalNotifications int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications
		 WHERE user_id = $1 AND kind = 'trial_access' AND title = '体验资格申请已通过'
		   AND body NOT LIKE '%SC-%'`, user.ID).Scan(&approvalNotifications); err != nil {
		t.Fatalf("count approval notifications: %v", err)
	}
	if approvalNotifications != 1 {
		t.Fatalf("approval notifications = %d, want 1", approvalNotifications)
	}

	storedApplication, err := store.GetTrialAccessApplicationByUser(ctx, env.st.Pool, user.ID)
	if err != nil || storedApplication == nil || storedApplication.RedemptionCode == nil {
		t.Fatalf("stored application = %#v, err=%v", storedApplication, err)
	}
	if _, _, redeemErr := redemption.Redeem(ctx, env.st, other.ID, *storedApplication.RedemptionCode); redeemErr == nil {
		t.Fatal("assigned trial code must not be redeemable by another user")
	}

	otherClaim := env.do(t, http.MethodPost, "/api/v1/me/trial-access-application/reward", nil, otherToken)
	if otherClaim.Code != http.StatusNotFound {
		t.Fatalf("other user claim status = %d, body=%s", otherClaim.Code, otherClaim.Body.String())
	}

	claimed := env.do(t, http.MethodPost, "/api/v1/me/trial-access-application/reward", nil, userToken)
	if claimed.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body=%s", claimed.Code, claimed.Body.String())
	}
	claimedData, _ := decode(t, claimed)
	if claimedData["alreadyClaimed"] != false || int64(claimedData["balanceCents"].(float64)) != 500 {
		t.Fatalf("claimed data = %#v", claimedData)
	}

	idempotent := env.do(t, http.MethodPost, "/api/v1/me/trial-access-application/reward", nil, userToken)
	if idempotent.Code != http.StatusOK {
		t.Fatalf("idempotent claim status = %d, body=%s", idempotent.Code, idempotent.Body.String())
	}
	idempotentData, _ := decode(t, idempotent)
	if idempotentData["alreadyClaimed"] != true || int64(idempotentData["balanceCents"].(float64)) != 500 {
		t.Fatalf("idempotent claim data = %#v", idempotentData)
	}
	wallet, err := store.GetWallet(ctx, env.st.Pool, user.ID)
	if err != nil || wallet == nil || wallet.BalanceCents != 0 || wallet.TrialBalanceCents != 500 || wallet.TrialFeatureKey == nil || *wallet.TrialFeatureKey != "text_to_image" {
		t.Fatalf("wallet = %#v, err=%v", wallet, err)
	}

	current := env.do(t, http.MethodGet, "/api/v1/me/trial-access-application", nil, userToken)
	if current.Code != http.StatusOK {
		t.Fatalf("current status = %d, body=%s", current.Code, current.Body.String())
	}
	currentData, _ := decode(t, current)
	currentApplication, _ := currentData["application"].(map[string]any)
	if currentApplication["rewardStatus"] != "redeemed" {
		t.Fatalf("current application = %#v", currentApplication)
	}
	if _, exposed := currentApplication["redemptionCode"]; exposed {
		t.Fatalf("user application must not expose redemption code: %#v", currentApplication)
	}

	reviewAgain := env.do(t, http.MethodPatch, "/api/v1/admin/trial-access-applications/"+applicationID, gin.H{
		"status":     "approved",
		"grantCents": 500,
	}, adminToken)
	if reviewAgain.Code != http.StatusConflict {
		t.Fatalf("second review status = %d, body=%s", reviewAgain.Code, reviewAgain.Body.String())
	}
}

func TestRejectedTrialAccessApplicationCanBeResubmitted(t *testing.T) {
	env := newCommunityEnv(t)
	_, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")

	submitted := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "学生",
		"reason":     "准备学习人工智能图像生成并制作作品集。",
	}, userToken)
	data, _ := decode(t, submitted)
	application := data["application"].(map[string]any)

	rejected := env.do(t, http.MethodPatch, "/api/v1/admin/trial-access-applications/"+application["id"].(string), gin.H{
		"status":     "rejected",
		"reviewNote": "请补充更具体的使用场景",
	}, adminToken)
	if rejected.Code != http.StatusOK {
		t.Fatalf("reject status = %d, body=%s", rejected.Code, rejected.Body.String())
	}
	if _, err := env.st.Pool.Exec(context.Background(),
		`UPDATE trial_access_applications SET created_at = '2020-01-01T00:00:00Z' WHERE id = $1`,
		application["id"].(string)); err != nil {
		t.Fatal(err)
	}

	resubmitted := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "视觉设计专业学生",
		"reason":     "计划用它完成毕业作品集中的角色设定、场景概念图和多版设计迭代。",
	}, userToken)
	if resubmitted.Code != http.StatusCreated {
		t.Fatalf("resubmit status = %d, body=%s", resubmitted.Code, resubmitted.Body.String())
	}
	resubmittedData, _ := decode(t, resubmitted)
	resubmittedApplication := resubmittedData["application"].(map[string]any)
	if resubmittedApplication["status"] != "pending" {
		t.Fatalf("resubmitted application = %#v", resubmittedApplication)
	}
	if int64(resubmittedApplication["applicationNo"].(float64)) != 2 || !strings.HasPrefix(resubmittedApplication["createdAt"].(string), "20") || strings.HasPrefix(resubmittedApplication["createdAt"].(string), "2020-") {
		t.Fatalf("resubmitted application did not receive a new position/time = %#v", resubmittedApplication)
	}
	campaignResponse := env.do(t, http.MethodGet, "/api/v1/trial-access-campaign", nil, "")
	campaignData, _ := decode(t, campaignResponse)
	campaign := campaignData["campaign"].(map[string]any)
	if int64(campaign["nextPosition"].(float64)) != 3 {
		t.Fatalf("next application position = %#v, want 3", campaign["nextPosition"])
	}
}

func submitTrialConcurrently(env *communityEnv, token string) (int, string) {
	body := []byte(`{"occupation":"产品设计师","reason":"希望参与新功能体验并验证真实工作流程。"}`)
	req := httptest.NewRequest(
		http.MethodPost, "/api/v1/me/trial-access-applications", bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: env.cfg.SessionCookieName, Value: token})
	recorder := httptest.NewRecorder()
	env.engine.ServeHTTP(recorder, req)
	var response struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(recorder.Body.Bytes(), &response)
	return recorder.Code, response.Code
}

func TestTrialCampaignCapacityIsAtomicUnderConcurrentSubmissions(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	updateTrialCampaign(t, env, nil, "", 2, 0)
	tokens := make([]string, 3)
	for index := range tokens {
		_, tokens[index] = env.newUserSession(t, "user")
	}

	type result struct {
		status int
		code   string
	}
	results := make(chan result, len(tokens))
	var wg sync.WaitGroup
	for _, token := range tokens {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, code := submitTrialConcurrently(env, token)
			results <- result{status: status, code: code}
		}()
	}
	wg.Wait()
	close(results)

	created, full := 0, 0
	for item := range results {
		switch {
		case item.status == http.StatusCreated:
			created++
		case item.status == http.StatusConflict && item.code == "trial_campaign_full":
			full++
		default:
			t.Fatalf("unexpected concurrent result: status=%d code=%q", item.status, item.code)
		}
	}
	if created != 2 || full != 1 {
		t.Fatalf("created=%d full=%d, want 2 and 1", created, full)
	}
	actual, err := store.CountAllTrialAccessApplications(ctx, env.st.Pool, mustActiveTrialCampaign(t, env).ID)
	if err != nil || actual != 2 {
		t.Fatalf("actual applications=%d err=%v, want 2", actual, err)
	}

	campaignResponse := env.do(t, http.MethodGet, "/api/v1/trial-access-campaign", nil, "")
	campaignData, _ := decode(t, campaignResponse)
	campaign := campaignData["campaign"].(map[string]any)
	if campaign["full"] != true || int64(campaign["remaining"].(float64)) != 0 {
		t.Fatalf("campaign = %#v", campaign)
	}
	feature := campaign["feature"].(map[string]any)
	if feature["key"] != "text_to_image" || feature["route"] != "/text-to-image" {
		t.Fatalf("campaign feature = %#v", feature)
	}
}

func TestTrialApplicationKeepsFeatureSnapshotWhenCampaignChanges(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	updateTrialCampaign(t, env, []string{"ui_design", "game_art"}, "", 0, 0)
	_, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")

	submitted := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "产品设计师",
		"reason":     "希望验证真实 UI 设计工作台并测试完整任务流程。",
	}, userToken)
	if submitted.Code != http.StatusCreated {
		t.Fatalf("submit status=%d body=%s", submitted.Code, submitted.Body.String())
	}
	data, _ := decode(t, submitted)
	application := data["application"].(map[string]any)
	if application["featureKey"] != "ui_design" {
		t.Fatalf("submitted application = %#v", application)
	}
	if keys, ok := application["featureKeys"].([]any); !ok || len(keys) != 2 || keys[1] != "game_art" {
		t.Fatalf("submitted feature keys = %#v", application["featureKeys"])
	}

	updateTrialCampaign(t, env, []string{"text_to_image"}, "", 0, 0)
	approved := env.do(t, http.MethodPatch, "/api/v1/admin/trial-access-applications/"+application["id"].(string), gin.H{
		"status": "approved", "grantCents": 500,
	}, adminToken)
	if approved.Code != http.StatusOK {
		t.Fatalf("approve status=%d body=%s", approved.Code, approved.Body.String())
	}
	approvedData, _ := decode(t, approved)
	if approvedData["featureKey"] != "ui_design" || approvedData["entitlementActive"] != true {
		t.Fatalf("approved snapshot = %#v", approvedData)
	}
	var entitlementCount int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM user_trial_feature_entitlements WHERE application_id = $1 AND revoked_at IS NULL`,
		application["id"].(string),
	).Scan(&entitlementCount); err != nil || entitlementCount != 2 {
		t.Fatalf("entitlement count = %d err=%v, want 2", entitlementCount, err)
	}

	current := env.do(t, http.MethodGet, "/api/v1/me/trial-access-application", nil, userToken)
	currentData, _ := decode(t, current)
	currentApplication := currentData["application"].(map[string]any)
	if currentApplication["featureKey"] != "ui_design" {
		t.Fatalf("current application changed with campaign = %#v", currentApplication)
	}
	if keys, ok := currentApplication["featureKeys"].([]any); !ok || len(keys) != 2 || keys[1] != "game_art" {
		t.Fatalf("current feature snapshot = %#v", currentApplication["featureKeys"])
	}
}

func TestTrialCampaignDisplayOffsetAffectsCapacityAndPosition(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	updateTrialCampaign(t, env, nil, "", 3, 2)
	_, firstToken := env.newUserSession(t, "user")
	_, secondToken := env.newUserSession(t, "user")
	payload := gin.H{
		"occupation": "产品设计师",
		"reason":     "希望参与新功能体验并验证真实工作流程。",
	}
	first := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", payload, firstToken)
	if first.Code != http.StatusCreated {
		t.Fatalf("first status=%d body=%s", first.Code, first.Body.String())
	}
	firstData, _ := decode(t, first)
	application := firstData["application"].(map[string]any)
	if int64(application["position"].(float64)) != 3 {
		t.Fatalf("application position = %#v, want 3", application["position"])
	}
	second := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", payload, secondToken)
	_, code := decode(t, second)
	if second.Code != http.StatusConflict || code != "trial_campaign_full" {
		t.Fatalf("second status=%d code=%q body=%s", second.Code, code, second.Body.String())
	}

	campaignResponse := env.do(t, http.MethodGet, "/api/v1/trial-access-campaign", nil, "")
	campaignData, _ := decode(t, campaignResponse)
	campaign := campaignData["campaign"].(map[string]any)
	actual, err := store.CountAllTrialAccessApplications(ctx, env.st.Pool, mustActiveTrialCampaign(t, env).ID)
	if err != nil || actual != 1 ||
		int64(campaign["displayApplied"].(float64)) != 3 ||
		int64(campaign["remaining"].(float64)) != 0 {
		t.Fatalf("campaign = %#v", campaign)
	}
	if _, exposed := campaign["displayOffset"]; exposed {
		t.Fatalf("public campaign exposed display offset: %#v", campaign)
	}
}

func TestTrialCampaignCRUDLifecycleAndRoundIsolation(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, userToken := env.newUserSession(t, "user")
	_, secondUserToken := env.newUserSession(t, "user")
	_, thirdUserToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")

	firstCampaign := mustActiveTrialCampaign(t, env)
	firstSubmit := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "产品设计师",
		"reason":     "希望参加第一期活动并验证真实产品工作流程。",
	}, userToken)
	if firstSubmit.Code != http.StatusCreated {
		t.Fatalf("first campaign submit status=%d body=%s", firstSubmit.Code, firstSubmit.Body.String())
	}
	lockedFeatureUpdate := env.do(t, http.MethodPatch, "/api/v1/admin/trial-campaigns/"+firstCampaign.ID.String(), gin.H{
		"title": "第一期修改测试", "featureKeys": []string{"ui_design"},
		"accessMode": "credit_only", "capacity": 100, "displayOffset": 0,
		"expiresAt": firstCampaign.ExpiresAt.Format(time.RFC3339),
	}, adminToken)
	_, lockedFeatureCode := decode(t, lockedFeatureUpdate)
	if lockedFeatureUpdate.Code != http.StatusConflict || lockedFeatureCode != "trial_campaign_features_locked" {
		t.Fatalf("locked feature update status=%d code=%q body=%s", lockedFeatureUpdate.Code, lockedFeatureCode, lockedFeatureUpdate.Body.String())
	}

	created := env.do(t, http.MethodPost, "/api/v1/admin/trial-campaigns", gin.H{
		"title":         "第二期全功能体验",
		"featureKeys":   []string{"text_to_image", "ui_design"},
		"accessMode":    "credit_only",
		"capacity":      20,
		"displayOffset": 3,
		"expiresAt":     futureTrialCampaignExpiry(),
	}, adminToken)
	if created.Code != http.StatusCreated {
		t.Fatalf("create campaign status=%d body=%s", created.Code, created.Body.String())
	}
	createdData, _ := decode(t, created)
	secondCampaignID, _ := createdData["id"].(string)
	if createdData["status"] != "draft" || secondCampaignID == "" {
		t.Fatalf("created campaign=%#v", createdData)
	}

	updated := env.do(t, http.MethodPatch, "/api/v1/admin/trial-campaigns/"+secondCampaignID, gin.H{
		"title":         "第二期多功能体验",
		"featureKeys":   []string{"text_to_image", "ui_design", "game_art"},
		"accessMode":    "restricted",
		"capacity":      30,
		"displayOffset": 2,
		"expiresAt":     createdData["expiresAt"],
	}, adminToken)
	if updated.Code != http.StatusOK {
		t.Fatalf("update campaign status=%d body=%s", updated.Code, updated.Body.String())
	}

	activated := env.do(t, http.MethodPost, "/api/v1/admin/trial-campaigns/"+secondCampaignID+"/activation", nil, adminToken)
	if activated.Code != http.StatusOK {
		t.Fatalf("activate campaign status=%d body=%s", activated.Code, activated.Body.String())
	}
	var activeCount int
	if err := env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM trial_campaigns WHERE status = 'active'`).Scan(&activeCount); err != nil || activeCount != 1 {
		t.Fatalf("active campaigns=%d err=%v", activeCount, err)
	}
	oldCampaign, err := store.GetTrialCampaign(ctx, env.st.Pool, firstCampaign.ID)
	if err != nil || oldCampaign == nil || oldCampaign.Status != "closed" {
		t.Fatalf("old campaign=%#v err=%v", oldCampaign, err)
	}

	secondSubmit := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "产品设计师",
		"reason":     "希望同一账号参加第二期活动并验证期次隔离。",
	}, userToken)
	if secondSubmit.Code != http.StatusCreated {
		t.Fatalf("second campaign submit status=%d body=%s", secondSubmit.Code, secondSubmit.Body.String())
	}
	secondSubmitData, _ := decode(t, secondSubmit)
	secondApplication := secondSubmitData["application"].(map[string]any)
	if secondApplication["campaignId"] != secondCampaignID || int64(secondApplication["applicationNo"].(float64)) != 1 {
		t.Fatalf("second campaign application=%#v", secondApplication)
	}
	approved := env.do(t, http.MethodPatch, "/api/v1/admin/trial-access-applications/"+secondApplication["id"].(string), gin.H{
		"status": "approved", "grantCents": 100,
	}, adminToken)
	if approved.Code != http.StatusOK {
		t.Fatalf("approve before close status=%d body=%s", approved.Code, approved.Body.String())
	}
	pendingSubmit := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "视觉设计师",
		"reason":     "提交一条待审核申请以验证关闭后的审核拦截。",
	}, secondUserToken)
	if pendingSubmit.Code != http.StatusCreated {
		t.Fatalf("pending submit status=%d body=%s", pendingSubmit.Code, pendingSubmit.Body.String())
	}
	pendingData, _ := decode(t, pendingSubmit)
	pendingApplication := pendingData["application"].(map[string]any)

	closed := env.do(t, http.MethodPost, "/api/v1/admin/trial-campaigns/"+secondCampaignID+"/closure", nil, adminToken)
	if closed.Code != http.StatusOK {
		t.Fatalf("close campaign status=%d body=%s", closed.Code, closed.Body.String())
	}
	public := env.do(t, http.MethodGet, "/api/v1/trial-access-campaign", nil, "")
	publicData, _ := decode(t, public)
	if publicData["campaign"] != nil {
		t.Fatalf("closed public campaign=%#v", publicData["campaign"])
	}
	blockedSubmit := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "设计师",
		"reason":     "活动关闭后这次申请必须被服务端拒绝。",
	}, thirdUserToken)
	_, blockedCode := decode(t, blockedSubmit)
	if blockedSubmit.Code != http.StatusConflict || blockedCode != "trial_campaign_closed" {
		t.Fatalf("closed submit status=%d code=%q", blockedSubmit.Code, blockedCode)
	}
	blockedReview := env.do(t, http.MethodPatch, "/api/v1/admin/trial-access-applications/"+pendingApplication["id"].(string), gin.H{
		"status": "approved", "grantCents": 100,
	}, adminToken)
	_, blockedReviewCode := decode(t, blockedReview)
	if blockedReview.Code != http.StatusConflict || blockedReviewCode != "trial_campaign_closed" {
		t.Fatalf("closed review status=%d code=%q body=%s", blockedReview.Code, blockedReviewCode, blockedReview.Body.String())
	}
	blockedClaim := env.do(t, http.MethodPost, "/api/v1/me/trial-access-application/reward", nil, userToken)
	_, blockedClaimCode := decode(t, blockedClaim)
	if blockedClaim.Code != http.StatusConflict || blockedClaimCode != "trial_campaign_closed" {
		t.Fatalf("closed claim status=%d code=%q body=%s", blockedClaim.Code, blockedClaimCode, blockedClaim.Body.String())
	}
	blockedReissue := env.do(t, http.MethodPost, "/api/v1/admin/trial-access-applications/"+secondApplication["id"].(string)+"/reward-reissues", gin.H{
		"grantCents": 100,
	}, adminToken)
	_, blockedReissueCode := decode(t, blockedReissue)
	if blockedReissue.Code != http.StatusConflict || blockedReissueCode != "trial_campaign_closed" {
		t.Fatalf("closed reissue status=%d code=%q body=%s", blockedReissue.Code, blockedReissueCode, blockedReissue.Body.String())
	}

	draft := env.do(t, http.MethodPost, "/api/v1/admin/trial-campaigns", gin.H{
		"title": "待删除草稿", "featureKeys": []string{"text_to_image"},
		"accessMode": "credit_only", "capacity": 10, "displayOffset": 0,
		"expiresAt": futureTrialCampaignExpiry(),
	}, adminToken)
	draftData, _ := decode(t, draft)
	deleted := env.do(t, http.MethodDelete, "/api/v1/admin/trial-campaigns/"+draftData["id"].(string), nil, adminToken)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete draft status=%d body=%s", deleted.Code, deleted.Body.String())
	}
}

func activateTrialCampaignConcurrently(env *communityEnv, token, campaignID string) int {
	req := httptest.NewRequest(
		http.MethodPost, "/api/v1/admin/trial-campaigns/"+campaignID+"/activation", nil,
	)
	req.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: token})
	recorder := httptest.NewRecorder()
	env.engine.ServeHTTP(recorder, req)
	return recorder.Code
}

func TestTrialCampaignConcurrentActivationLeavesExactlyOneActive(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	createCampaign := func(title string) string {
		response := env.do(t, http.MethodPost, "/api/v1/admin/trial-campaigns", gin.H{
			"title": title, "featureKeys": []string{"text_to_image"},
			"accessMode": "credit_only", "capacity": 100, "displayOffset": 0,
			"expiresAt": futureTrialCampaignExpiry(),
		}, adminToken)
		if response.Code != http.StatusCreated {
			t.Fatalf("create campaign status=%d body=%s", response.Code, response.Body.String())
		}
		data, _ := decode(t, response)
		return data["id"].(string)
	}
	firstID := createCampaign("并发激活测试一期")
	secondID := createCampaign("并发激活测试二期")

	start := make(chan struct{})
	results := make(chan int, 2)
	var wg sync.WaitGroup
	for _, campaignID := range []string{firstID, secondID} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			<-start
			results <- activateTrialCampaignConcurrently(env, adminToken, id)
		}(campaignID)
	}
	close(start)
	wg.Wait()
	close(results)
	for status := range results {
		if status != http.StatusOK {
			t.Fatalf("concurrent activation status=%d", status)
		}
	}

	var activeCount int
	var activeID string
	err := env.st.Pool.QueryRow(context.Background(),
		`SELECT count(*), COALESCE(max(id::text), '') FROM trial_campaigns WHERE status = 'active'`,
	).Scan(&activeCount, &activeID)
	if err != nil || activeCount != 1 || (activeID != firstID && activeID != secondID) {
		t.Fatalf("active campaigns=%d activeID=%q err=%v", activeCount, activeID, err)
	}
}

func TestTrialCampaignRequiresFiniteFutureExpiration(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	base := gin.H{
		"title": "截止时间校验活动", "featureKeys": []string{"text_to_image"},
		"accessMode": "credit_only", "capacity": 100, "displayOffset": 0,
	}
	for name, expiresAt := range map[string]any{
		"missing":  nil,
		"too_soon": time.Now().UTC().Add(time.Minute).Format(time.RFC3339),
		"too_long": time.Now().UTC().Add(366 * 24 * time.Hour).Format(time.RFC3339),
	} {
		payload := gin.H{}
		for key, value := range base {
			payload[key] = value
		}
		if expiresAt != nil {
			payload["expiresAt"] = expiresAt
		}
		response := env.do(t, http.MethodPost, "/api/v1/admin/trial-campaigns", payload, adminToken)
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%s expiration status=%d body=%s", name, response.Code, response.Body.String())
		}
	}
}

func TestTrialCampaignExpirationAutomaticallyClosesActivity(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	active := mustActiveTrialCampaign(t, env)
	user, userToken := env.newUserSession(t, "user")
	_, secondUserToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")

	submitted := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "产品设计师",
		"reason":     "验证体验活动到期后所有业务入口会自动停止。",
	}, userToken)
	if submitted.Code != http.StatusCreated {
		t.Fatalf("submit status=%d body=%s", submitted.Code, submitted.Body.String())
	}
	submittedData, _ := decode(t, submitted)
	application := submittedData["application"].(map[string]any)
	expiredAt := time.Now().UTC().Add(-time.Minute)
	if _, err := env.st.Pool.Exec(ctx,
		`UPDATE trial_campaigns SET created_at = $3, expires_at = $2 WHERE id = $1`,
		active.ID, expiredAt, expiredAt.Add(-time.Hour),
	); err != nil {
		t.Fatal(err)
	}

	public := env.do(t, http.MethodGet, "/api/v1/trial-access-campaign", nil, "")
	publicData, _ := decode(t, public)
	if public.Code != http.StatusOK || publicData["campaign"] != nil {
		t.Fatalf("expired public campaign status=%d data=%#v", public.Code, publicData)
	}
	stored, err := store.GetTrialCampaign(ctx, env.st.Pool, active.ID)
	if err != nil || stored == nil || stored.Status != "closed" || stored.ClosedAt == nil {
		t.Fatalf("expired stored campaign=%#v err=%v", stored, err)
	}
	var expirationNotifications int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications
		 WHERE user_id = $1 AND kind = 'trial_access' AND title = '体验活动已结束'`, user.ID,
	).Scan(&expirationNotifications); err != nil || expirationNotifications != 1 {
		t.Fatalf("expiration notifications=%d err=%v", expirationNotifications, err)
	}
	_ = env.do(t, http.MethodGet, "/api/v1/trial-access-campaign", nil, "")
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications
		 WHERE user_id = $1 AND kind = 'trial_access' AND title = '体验活动已结束'`, user.ID,
	).Scan(&expirationNotifications); err != nil || expirationNotifications != 1 {
		t.Fatalf("duplicate expiration notifications=%d err=%v", expirationNotifications, err)
	}

	blockedSubmit := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "视觉设计师",
		"reason":     "活动到期后这条新申请必须被服务端拒绝。",
	}, secondUserToken)
	_, submitCode := decode(t, blockedSubmit)
	if blockedSubmit.Code != http.StatusConflict || submitCode != "trial_campaign_closed" {
		t.Fatalf("expired submit status=%d code=%q body=%s", blockedSubmit.Code, submitCode, blockedSubmit.Body.String())
	}
	blockedReview := env.do(t, http.MethodPatch, "/api/v1/admin/trial-access-applications/"+application["id"].(string), gin.H{
		"status": "approved", "grantCents": 100,
	}, adminToken)
	_, reviewCode := decode(t, blockedReview)
	if blockedReview.Code != http.StatusConflict || reviewCode != "trial_campaign_closed" {
		t.Fatalf("expired review status=%d code=%q body=%s", blockedReview.Code, reviewCode, blockedReview.Body.String())
	}
	blockedActivation := env.do(t, http.MethodPost, "/api/v1/admin/trial-campaigns/"+active.ID.String()+"/activation", nil, adminToken)
	_, activationCode := decode(t, blockedActivation)
	if blockedActivation.Code != http.StatusConflict || activationCode != "trial_campaign_expired" {
		t.Fatalf("expired activation status=%d code=%q body=%s", blockedActivation.Code, activationCode, blockedActivation.Body.String())
	}

	newExpiry := futureTrialCampaignExpiry()
	updated := env.do(t, http.MethodPatch, "/api/v1/admin/trial-campaigns/"+active.ID.String(), gin.H{
		"title": active.Title, "featureKeys": active.FeatureKeys,
		"accessMode": active.AccessMode, "capacity": active.Capacity,
		"displayOffset": active.DisplayOffset, "expiresAt": newExpiry,
	}, adminToken)
	if updated.Code != http.StatusOK {
		t.Fatalf("renew expired campaign status=%d body=%s", updated.Code, updated.Body.String())
	}
	reactivated := env.do(t, http.MethodPost, "/api/v1/admin/trial-campaigns/"+active.ID.String()+"/activation", nil, adminToken)
	if reactivated.Code != http.StatusOK {
		t.Fatalf("reactivate renewed campaign status=%d body=%s", reactivated.Code, reactivated.Body.String())
	}
}

func TestExpiredTrialRewardCanBeReissued(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	submitted := env.do(t, http.MethodPost, "/api/v1/me/trial-access-applications", gin.H{
		"occupation": "视觉设计师",
		"reason":     "验证体验积分过期以后能够由管理员安全补发。",
	}, userToken)
	submittedData, _ := decode(t, submitted)
	application := submittedData["application"].(map[string]any)
	applicationID := application["id"].(string)
	approved := env.do(t, http.MethodPatch, "/api/v1/admin/trial-access-applications/"+applicationID, gin.H{
		"status": "approved", "grantCents": 300,
		"expiresAt": time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
	}, adminToken)
	if approved.Code != http.StatusOK {
		t.Fatalf("approve status=%d body=%s", approved.Code, approved.Body.String())
	}
	if _, err := env.st.Pool.Exec(ctx,
		`UPDATE redemption_codes SET expires_at = now() - interval '1 minute'
		 WHERE id = (SELECT redemption_code_id FROM trial_access_applications WHERE id = $1)`, applicationID); err != nil {
		t.Fatal(err)
	}
	current := env.do(t, http.MethodGet, "/api/v1/me/trial-access-application", nil, userToken)
	currentData, _ := decode(t, current)
	if currentData["application"].(map[string]any)["rewardStatus"] != "expired" {
		t.Fatalf("expired application=%#v", currentData["application"])
	}
	expiredClaim := env.do(t, http.MethodPost, "/api/v1/me/trial-access-application/reward", nil, userToken)
	_, expiredCode := decode(t, expiredClaim)
	if expiredClaim.Code != http.StatusGone || expiredCode != "code_expired" {
		t.Fatalf("expired claim status=%d code=%q body=%s", expiredClaim.Code, expiredCode, expiredClaim.Body.String())
	}
	reissued := env.do(t, http.MethodPost, "/api/v1/admin/trial-access-applications/"+applicationID+"/reward-reissues", gin.H{
		"grantCents": 450,
		"expiresAt":  time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339),
		"reviewNote": "已重新发放，请及时领取",
	}, adminToken)
	if reissued.Code != http.StatusOK {
		t.Fatalf("reissue status=%d body=%s", reissued.Code, reissued.Body.String())
	}
	reissuedData, _ := decode(t, reissued)
	if reissuedData["rewardStatus"] != "active" || int64(reissuedData["rewardCents"].(float64)) != 450 {
		t.Fatalf("reissued application=%#v", reissuedData)
	}
	claimed := env.do(t, http.MethodPost, "/api/v1/me/trial-access-application/reward", nil, userToken)
	if claimed.Code != http.StatusCreated {
		t.Fatalf("reissued claim status=%d body=%s", claimed.Code, claimed.Body.String())
	}
}
