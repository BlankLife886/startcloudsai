package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAdminPlanCRUDAndPublicCatalog(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	user, _ := env.newUserSession(t, "user")

	if response := env.do(t, http.MethodGet, "/api/v1/admin/plans", nil, ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous admin list status = %d", response.Code)
	}

	invalid := env.do(t, http.MethodPost, "/api/v1/admin/plans", gin.H{
		"code": "empty", "name": "空套餐", "kind": "topup", "priceCents": 0, "grantCents": 0,
	}, adminToken)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid topup status = %d body=%s", invalid.Code, invalid.Body.String())
	}

	created := env.do(t, http.MethodPost, "/api/v1/admin/plans", gin.H{
		"code": " CREATOR_1000 ", "name": " 创作者积分包 ", "description": " 适合持续创作 ",
		"badge": "热卖", "kind": "topup", "priceCents": 990, "grantCents": 1000,
		"bonusCents": 100, "features": []string{"全平台通用", "全平台通用", "永久有效"},
		"active": true, "recommended": true, "sort": 20,
	}, adminToken)
	createdData, _ := decode(t, created)
	if created.Code != http.StatusOK || createdData["code"] != "creator_1000" || createdData["recommended"] != true {
		t.Fatalf("create topup status=%d data=%#v", created.Code, createdData)
	}
	firstID := createdData["id"].(string)
	features, ok := createdData["features"].([]any)
	if !ok || len(features) != 2 {
		t.Fatalf("cleaned features = %#v", createdData["features"])
	}

	subscription := env.do(t, http.MethodPost, "/api/v1/admin/plans", gin.H{
		"code": "creator_monthly", "name": "创作者月度计划", "description": "每日补充创作积分",
		"kind": "subscription", "priceCents": 1990, "grantCents": 0, "dailyGrantCents": 100,
		"durationDays": 30, "features": []string{"每日发放 100 积分"}, "active": true,
		"recommended": true, "sort": 10,
	}, adminToken)
	subscriptionData, _ := decode(t, subscription)
	if subscription.Code != http.StatusOK || subscriptionData["recommended"] != true {
		t.Fatalf("create subscription status=%d data=%#v", subscription.Code, subscriptionData)
	}
	secondID := subscriptionData["id"].(string)

	list := env.do(t, http.MethodGet, "/api/v1/admin/plans", nil, adminToken)
	listData, _ := decode(t, list)
	items := listData["items"].([]any)
	if list.Code != http.StatusOK || len(items) != 2 {
		t.Fatalf("admin list status=%d data=%#v", list.Code, listData)
	}
	recommendedCount := 0
	for _, raw := range items {
		item := raw.(map[string]any)
		if item["recommended"] == true {
			recommendedCount++
			if item["id"] != secondID {
				t.Fatalf("recommended plan = %#v, want second plan", item)
			}
		}
	}
	if recommendedCount != 1 {
		t.Fatalf("recommended count = %d", recommendedCount)
	}

	public := env.do(t, http.MethodGet, "/api/v1/plans", nil, "")
	publicData, _ := decode(t, public)
	publicItems := publicData["items"].([]any)
	if public.Code != http.StatusOK || len(publicItems) != 2 || publicData["paymentEnabled"] != false {
		t.Fatalf("public plans status=%d data=%#v", public.Code, publicData)
	}

	extraTopup := env.do(t, http.MethodPost, "/api/v1/admin/plans", gin.H{
		"code": "creator_2000", "name": "创作者积分包 2", "kind": "topup",
		"priceCents": 1990, "grantCents": 2000, "active": true, "sort": 30,
	}, adminToken)
	extraData, _ := decode(t, extraTopup)
	if extraTopup.Code != http.StatusOK {
		t.Fatalf("create extra topup status=%d body=%s", extraTopup.Code, extraTopup.Body.String())
	}
	extraID := extraData["id"].(string)
	reordered := env.do(t, http.MethodPatch, "/api/v1/admin/plan-order", gin.H{
		"kind": "topup", "ids": []string{extraID, firstID},
	}, adminToken)
	if reordered.Code != http.StatusOK {
		t.Fatalf("reorder status=%d body=%s", reordered.Code, reordered.Body.String())
	}
	firstPlan, err := store.GetPlan(context.Background(), env.st.Pool, uuid.MustParse(firstID))
	if err != nil || firstPlan == nil {
		t.Fatalf("load first plan after reorder: %#v err=%v", firstPlan, err)
	}
	extraPlan, err := store.GetPlan(context.Background(), env.st.Pool, uuid.MustParse(extraID))
	if err != nil || extraPlan == nil {
		t.Fatalf("load extra plan after reorder: %#v err=%v", extraPlan, err)
	}
	if extraPlan.Sort >= firstPlan.Sort {
		t.Fatalf("reordered sorts = %d, %d; want extra before first", extraPlan.Sort, firstPlan.Sort)
	}
	if removed := env.do(t, http.MethodDelete, "/api/v1/admin/plans/"+extraID, nil, adminToken); removed.Code != http.StatusNoContent {
		t.Fatalf("delete extra topup status=%d body=%s", removed.Code, removed.Body.String())
	}

	patched := env.do(t, http.MethodPatch, "/api/v1/admin/plans/"+firstID, gin.H{
		"name": "新名称", "active": false, "description": "下架维护中",
	}, adminToken)
	patchedData, _ := decode(t, patched)
	if patched.Code != http.StatusOK || patchedData["name"] != "新名称" || patchedData["active"] != false {
		t.Fatalf("patch status=%d data=%#v", patched.Code, patchedData)
	}

	deleted := env.do(t, http.MethodDelete, "/api/v1/admin/plans/"+firstID, nil, adminToken)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete unused status=%d body=%s", deleted.Code, deleted.Body.String())
	}
	if plan, err := store.GetPlan(context.Background(), env.st.Pool, uuid.MustParse(firstID)); err != nil || plan != nil {
		t.Fatalf("deleted plan=%#v err=%v", plan, err)
	}

	if _, err := store.InsertOrder(context.Background(), env.st.Pool, user.ID, uuid.MustParse(secondID), 1990, 0, 0, "history"); err != nil {
		t.Fatal(err)
	}
	inUse := env.do(t, http.MethodDelete, "/api/v1/admin/plans/"+secondID, nil, adminToken)
	if _, code := decode(t, inUse); inUse.Code != http.StatusConflict || code != "plan_in_use" {
		t.Fatalf("delete referenced status=%d body=%s", inUse.Code, inUse.Body.String())
	}

	archived := env.do(t, http.MethodPatch, "/api/v1/admin/plans/"+secondID, gin.H{"active": false}, adminToken)
	if archived.Code != http.StatusOK {
		t.Fatalf("archive referenced status=%d body=%s", archived.Code, archived.Body.String())
	}
	public = env.do(t, http.MethodGet, "/api/v1/plans", nil, "")
	publicData, _ = decode(t, public)
	if len(publicData["items"].([]any)) != 0 {
		t.Fatalf("public archived plans = %#v", publicData["items"])
	}
}
