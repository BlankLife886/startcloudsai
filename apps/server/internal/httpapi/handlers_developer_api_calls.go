package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// developerAPICallReasons explains, for the developer console, why a call was
// refunded. Codes come from developerUpstreamError and the billing helpers.
var developerAPICallReasons = map[string]string{
	"upstream_rejected":         "请求未被模型接受，已退回",
	openAIContentPolicyCode:     "内容不符合安全规范，在每日免扣次数内，已退回",
	"upstream_misconfigured":    "模型暂时不可用，已退回",
	"upstream_rate_limited":     "模型请求较多，已退回",
	"upstream_error":            "模型服务出错，已退回",
	"upstream_unreachable":      "模型服务连接中断，已退回",
	"request_timeout":           "处理超时，已退回",
	"request_aborted":           "收到回答前调用方已断开，已退回",
	"image_result_unavailable":  "没有生成图片，已退回",
	"billing_settlement_failed": "平台记账失败，已退回",
}

// myDeveloperAPICalls lists the caller's /v1 requests with what each one cost.
// These charges are kept out of the wallet history and shown here instead.
func (s *Server) myDeveloperAPICalls(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, page, err := pageWindow(c, 20, 100)
	if err != nil {
		fail(c, err)
		return
	}
	var keyID *uuid.UUID
	if raw := strings.TrimSpace(c.Query("key")); raw != "" {
		parsed, parseErr := uuid.Parse(raw)
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "key 参数无效", http.StatusUnprocessableEntity))
			return
		}
		keyID = &parsed
	}
	ctx := c.Request.Context()
	total, err := store.CountDeveloperAPICallsCapped(ctx, s.St.Pool, user.ID, keyID)
	if err != nil {
		fail(c, err)
		return
	}
	calls, err := store.ListDeveloperAPICalls(ctx, s.St.Pool, user.ID, keyID, limit, (page-1)*limit)
	if err != nil {
		fail(c, err)
		return
	}
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	names := make(map[string]string, len(cfg.Models))
	for _, model := range cfg.Models {
		names[model.ID] = openAIPublicModelID(model)
	}
	items := make([]gin.H, 0, len(calls))
	for _, call := range calls {
		items = append(items, developerAPICallDict(call, names))
	}
	ok(c, gin.H{"items": items, "page": page, "pageSize": limit, "total": total.Value, "totalCapped": total.Capped})
}

func developerAPICallDict(call *store.DeveloperAPICall, modelNames map[string]string) gin.H {
	kind, operation := "chat", "对话"
	if call.SourceType == store.DeveloperAPIImageLedgerSource {
		kind, operation = "image", "生成图片"
		if call.Operation == "edit" {
			operation = "编辑图片"
		}
	}
	model := call.APIModelName
	if model == "" {
		model = modelNames[call.ModelID]
	}
	if model == "" && call.ModelID != "" {
		model = "已下线的模型"
	}
	status, charged, reason := "pending", int64(0), "处理中"
	switch call.Status {
	case store.DeveloperAPIRequestSucceeded:
		status, charged, reason = "charged", call.PriceCents, ""
		if call.Note == "client_disconnected" {
			reason = "结果已产生，调用方中途断开，照常扣费"
		}
		if call.ErrorCode == openAIContentPolicyCode {
			reason = "内容不符合安全规范被拒绝，照常扣费"
		}
	case store.DeveloperAPIRequestFailed:
		status, reason = "refunded", developerAPICallReasons[call.ErrorCode]
		if reason == "" {
			reason = "请求失败，已退回"
		}
	case store.DeveloperAPIRequestExpired:
		status, reason = "refunded", "请求未完成，预留已自动退回"
	}
	item := gin.H{
		"createdAt": call.CreatedAt.UTC().Format(time.RFC3339), "kind": kind, "operation": operation, "model": model,
		"status": status, "chargedCents": charged, "reason": reason, "key": nil,
	}
	if call.KeyLabel != nil && call.KeyPrefix != nil {
		item["key"] = gin.H{"label": *call.KeyLabel, "prefix": apiKeyDisplayPrefix(*call.KeyPrefix)}
	}
	if kind == "image" && call.Units > 0 {
		item["images"] = call.Units
	}
	if call.TotalTokens != nil || call.PromptTokens != nil || call.CompletionTokens != nil {
		item["tokens"] = gin.H{"prompt": call.PromptTokens, "completion": call.CompletionTokens, "total": call.TotalTokens}
	}
	return item
}

// myAPIUsageSummary is the one-line developer API total shown on the wallet
// and subscription pages, since API charges are kept out of wallet history.
// The month follows UTC, like the Key quotas.
func (s *Server) myAPIUsageSummary(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	now := time.Now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	points, calls, err := store.UserAPISpend(c.Request.Context(), s.St.Pool, user.ID, monthStart)
	if err != nil {
		fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	ok(c, gin.H{"monthPoints": points, "monthCalls": calls, "monthStart": monthStart.Format(time.RFC3339)})
}
