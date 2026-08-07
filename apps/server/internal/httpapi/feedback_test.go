package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestUserFeedbackSubmissionAndAdminResolution(t *testing.T) {
	env := newCommunityEnv(t)
	_, userToken := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")

	payload := gin.H{
		"category": "generation",
		"title":    "批量生图结果数量不完整",
		"content":  "提交十张图片后只显示了八张，希望能够确认剩余任务的处理状态。",
		"pageUrl":  "http://localhost/text-to-image",
	}
	if w := env.do(t, http.MethodPost, "/api/v1/me/feedback", payload, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous submit status = %d, body=%s", w.Code, w.Body.String())
	}

	submitted := env.do(t, http.MethodPost, "/api/v1/me/feedback", payload, userToken)
	if submitted.Code != http.StatusCreated {
		t.Fatalf("submit status = %d, body=%s", submitted.Code, submitted.Body.String())
	}
	feedback, _ := decode(t, submitted)
	feedbackID, _ := feedback["id"].(string)
	if feedbackID == "" || feedback["status"] != "open" {
		t.Fatalf("submitted feedback = %#v", feedback)
	}

	mine := env.do(t, http.MethodGet, "/api/v1/me/feedback?limit=20", nil, userToken)
	mineData, _ := decode(t, mine)
	items, _ := mineData["items"].([]any)
	if mine.Code != http.StatusOK || len(items) != 1 {
		t.Fatalf("my feedback status=%d data=%#v", mine.Code, mineData)
	}

	other := env.do(t, http.MethodGet, "/api/v1/me/feedback?limit=20", nil, otherToken)
	otherData, _ := decode(t, other)
	otherItems, _ := otherData["items"].([]any)
	if other.Code != http.StatusOK || len(otherItems) != 0 {
		t.Fatalf("other feedback status=%d data=%#v", other.Code, otherData)
	}

	adminList := env.do(t, http.MethodGet, "/api/v1/admin/feedback?status=open&search=批量生图&limit=20", nil, adminToken)
	adminData, _ := decode(t, adminList)
	adminItems, _ := adminData["items"].([]any)
	if adminList.Code != http.StatusOK || len(adminItems) != 1 || adminData["total"] != float64(1) {
		t.Fatalf("admin feedback status=%d data=%#v", adminList.Code, adminData)
	}

	resolved := env.do(t, http.MethodPatch, "/api/v1/admin/feedback/"+feedbackID, gin.H{
		"status":     "resolved",
		"adminReply": "已修复结果同步问题，请刷新历史记录查看完整图片。",
	}, adminToken)
	if resolved.Code != http.StatusOK {
		t.Fatalf("resolve status = %d, body=%s", resolved.Code, resolved.Body.String())
	}
	resolvedData, _ := decode(t, resolved)
	if resolvedData["status"] != "resolved" || resolvedData["adminReply"] == nil {
		t.Fatalf("resolved feedback = %#v", resolvedData)
	}

	updated := env.do(t, http.MethodGet, "/api/v1/me/feedback?limit=20", nil, userToken)
	updatedData, _ := decode(t, updated)
	updatedItems := updatedData["items"].([]any)
	updatedItem := updatedItems[0].(map[string]any)
	if updatedItem["status"] != "resolved" || updatedItem["adminReply"] == nil {
		t.Fatalf("updated user feedback = %#v", updatedItem)
	}

	invalid := env.do(t, http.MethodPost, "/api/v1/me/feedback", gin.H{
		"category": "bad",
		"title":    "短",
		"content":  "内容也太短",
	}, userToken)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid status = %d, body=%s", invalid.Code, invalid.Body.String())
	}

	unsafeURL := env.do(t, http.MethodPost, "/api/v1/me/feedback", gin.H{
		"category": "bug",
		"title":    "问题页面链接不应该执行脚本",
		"content":  "验证反馈页面只接受正常的站内路径或网页地址。",
		"pageUrl":  "javascript:alert(document.domain)",
	}, userToken)
	if unsafeURL.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unsafe URL status = %d, body=%s", unsafeURL.Code, unsafeURL.Body.String())
	}
}

func TestFeedbackResolutionRequiresReply(t *testing.T) {
	env := newCommunityEnv(t)
	_, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")

	submitted := env.do(t, http.MethodPost, "/api/v1/me/feedback", gin.H{
		"category": "suggestion",
		"title":    "建议增加更多画布快捷键",
		"content":  "希望增加复制节点和快速对齐等常用快捷键，提升设计效率。",
	}, userToken)
	data, _ := decode(t, submitted)
	id := data["id"].(string)

	resolved := env.do(t, http.MethodPatch, "/api/v1/admin/feedback/"+id, gin.H{
		"status": "resolved",
	}, adminToken)
	if resolved.Code != http.StatusUnprocessableEntity {
		t.Fatalf("resolve without reply status = %d, body=%s", resolved.Code, resolved.Body.String())
	}
}

func TestAdoptedSuggestionRewardsExactlyOnce(t *testing.T) {
	env := newCommunityEnv(t)
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	if err := store.InsertWallet(context.Background(), env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}

	submitted := env.do(t, http.MethodPost, "/api/v1/me/feedback", gin.H{
		"category": "suggestion",
		"title":    "建议增加批量任务筛选器",
		"content":  "希望任务页面支持按服务商、失败原因和提交批次组合筛选。",
	}, userToken)
	data, _ := decode(t, submitted)
	id := data["id"].(string)
	payload := gin.H{
		"status": "resolved", "adminReply": "建议已进入产品计划。", "adopted": true, "rewardCents": 120,
	}
	for attempt := 0; attempt < 2; attempt++ {
		reviewed := env.do(t, http.MethodPatch, "/api/v1/admin/feedback/"+id, payload, adminToken)
		if reviewed.Code != http.StatusOK {
			t.Fatalf("review %d status=%d body=%s", attempt, reviewed.Code, reviewed.Body.String())
		}
	}

	wallet, err := store.GetWallet(context.Background(), env.st.Pool, user.ID)
	if err != nil || wallet == nil || wallet.BalanceCents != 120 {
		t.Fatalf("wallet=%#v err=%v", wallet, err)
	}
	var rewards int
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM wallet_ledger
		WHERE user_id=$1 AND kind='grant' AND source_type='feedback_adoption'`, user.ID).Scan(&rewards); err != nil {
		t.Fatal(err)
	}
	if rewards != 1 {
		t.Fatalf("feedback adoption rewards=%d, want 1", rewards)
	}
}
