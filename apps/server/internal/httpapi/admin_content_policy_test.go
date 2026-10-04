package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/contentpolicy"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAdminContentPolicyConfigViolationsAndRefund(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, adminToken := env.newUserSession(t, "admin")
	user, userToken := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}

	if denied := env.do(t, http.MethodGet, "/api/v1/admin/content-policy/config", nil, userToken); denied.Code == http.StatusOK {
		t.Fatal("non-admin read the content policy config")
	}

	// 保存自定义规则：每天免扣 1 次，并加一个新说法。
	cfg := contentpolicy.DefaultConfig()
	cfg.DailyFreeCount = 1
	cfg.PolicyPhrases = append(cfg.PolicyPhrases, "社区准则")
	if response := env.do(t, http.MethodPut, "/api/v1/admin/content-policy/config", cfg, adminToken); response.Code != http.StatusOK {
		t.Fatalf("save: %d %s", response.Code, response.Body.String())
	}
	if response := env.do(t, http.MethodPut, "/api/v1/admin/content-policy/config", map[string]any{"dailyFreeCount": -1, "policyPhrases": []string{"x"}}, adminToken); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid config accepted: %d", response.Code)
	}
	var tested struct {
		Data contentpolicy.TestResult `json:"data"`
	}
	response := env.do(t, http.MethodPost, "/api/v1/admin/content-policy/test", map[string]any{"message": "该内容违反了社区准则"}, adminToken)
	if err := json.Unmarshal(response.Body.Bytes(), &tested); err != nil || !tested.Data.Violation || tested.Data.Rule != "社区准则" {
		t.Fatalf("test saved rules: %d %s", response.Code, response.Body.String())
	}

	// 第一次违规在免扣次数内，第二次扣费。
	var charged *store.ContentPolicyViolation
	for i := 0; i < 2; i++ {
		decision, err := contentpolicy.Decide(ctx, env.st.Pool, contentpolicy.Event{
			UserID: user.ID, SourceType: contentpolicy.SourceTask, SourceID: uuid.NewString(), Feature: "wallpaper-image-generation",
			Prompt: "违规提示词", ErrorCode: "upstream_error", Message: "该内容违反了社区准则", AmountCents: 4,
		}, time.Now().UTC())
		if err != nil {
			t.Fatal(err)
		}
		charged = decision.Record
	}
	if charged.Status != store.ContentPolicyCharged {
		t.Fatalf("second violation = %#v", charged)
	}

	var summary struct {
		Data struct {
			Violations   int64 `json:"violations"`
			Charged      int64 `json:"charged"`
			Waived       int64 `json:"waived"`
			ChargedCents int64 `json:"chargedCents"`
			TopUsers     []struct {
				Violations int64 `json:"violations"`
			} `json:"topUsers"`
		} `json:"data"`
	}
	response = env.do(t, http.MethodGet, "/api/v1/admin/content-policy/summary", nil, adminToken)
	if err := json.Unmarshal(response.Body.Bytes(), &summary); err != nil || summary.Data.Violations != 2 || summary.Data.Charged != 1 ||
		summary.Data.Waived != 1 || summary.Data.ChargedCents != 4 || len(summary.Data.TopUsers) != 1 || summary.Data.TopUsers[0].Violations != 2 {
		t.Fatalf("summary: %d %s", response.Code, response.Body.String())
	}
	var list struct {
		Data struct {
			Items []struct {
				ID     string `json:"id"`
				Prompt string `json:"prompt"`
				Status string `json:"status"`
			} `json:"items"`
			Total int64 `json:"total"`
		} `json:"data"`
	}
	response = env.do(t, http.MethodGet, "/api/v1/admin/content-policy/violations?status=charged&search=违规提示词&user="+user.Email, nil, adminToken)
	if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil || list.Data.Total != 1 || list.Data.Items[0].Prompt != "违规提示词" {
		t.Fatalf("list: %d %s", response.Code, response.Body.String())
	}

	// 退回误判的扣费：积分入账、记录变为已退回、不能重复退回。
	refundPath := "/api/v1/admin/content-policy/violations/" + charged.ID.String() + "/refund"
	if response := env.do(t, http.MethodPost, refundPath, map[string]any{"note": "误判"}, adminToken); response.Code != http.StatusOK {
		t.Fatalf("refund: %d %s", response.Code, response.Body.String())
	}
	wallet, err := store.GetWallet(ctx, env.st.Pool, user.ID)
	if err != nil || wallet.BalanceCents != 4 {
		t.Fatalf("wallet after refund = %#v err=%v", wallet, err)
	}
	if response := env.do(t, http.MethodPost, refundPath, map[string]any{}, adminToken); response.Code != http.StatusConflict {
		t.Fatalf("second refund: %d %s", response.Code, response.Body.String())
	}
}
