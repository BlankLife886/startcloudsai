package httpapi

import (
	"context"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func securityAdminLimit(c *gin.Context) int {
	value, err := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if err != nil {
		return 100
	}
	return min(max(value, 1), 200)
}

func (s *Server) adminSecurityRisks(c *gin.Context, _ *store.User) {
	items, err := store.ListSecurityRiskEvents(c.Request.Context(), s.St.Pool, c.Query("unresolved") != "false", securityAdminLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	blocks, err := store.ListSecurityBlocks(c.Request.Context(), s.St.Pool, true, securityAdminLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items, "activeBlocks": blocks})
}

func (s *Server) adminResolveSecurityRisk(c *gin.Context, admin *store.User) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	changed, err := store.ResolveSecurityRiskEvent(c.Request.Context(), s.St.Pool, id, admin.ID, body.Note)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("risk_not_found", "风险事件不存在或已处理", 404))
		return
	}
	respondNoContent(c)
}

func (s *Server) adminRevokeSecurityBlock(c *gin.Context, _ *store.User) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	changed, err := store.RevokeSecurityBlock(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("block_not_found", "限制不存在或已解除", 404))
		return
	}
	respondNoContent(c)
}

func (s *Server) adminUnfreezeAPIKey(c *gin.Context, _ *store.User) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效", 422))
		return
	}
	changed, err := store.UnfreezeUserAPIKey(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("api_key_not_frozen", "API Key 不存在或未被冻结", 404))
		return
	}
	respondNoContent(c)
}

func (s *Server) adminUploadHashBlocks(c *gin.Context, _ *store.User) {
	items, err := store.ListUploadHashBlocks(c.Request.Context(), s.St.Pool, securityAdminLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items})
}

func (s *Server) adminAddUploadHashBlock(c *gin.Context, admin *store.User) {
	var body struct {
		SHA256 string `json:"sha256"`
		Reason string `json:"reason"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.SHA256 = strings.ToLower(strings.TrimSpace(body.SHA256))
	body.Reason = strings.TrimSpace(body.Reason)
	decoded, err := hex.DecodeString(body.SHA256)
	if err != nil || len(decoded) != 32 || body.Reason == "" || len([]rune(body.Reason)) > 300 {
		fail(c, apperr.E("validation_error", "sha256 必须为 64 位十六进制，原因须为 1-300 字", 422))
		return
	}
	if err := store.UpsertUploadHashBlock(c.Request.Context(), s.St.Pool, body.SHA256, body.Reason, admin.ID); err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, gin.H{"sha256": body.SHA256, "reason": body.Reason})
}

func (s *Server) adminRemoveUploadHashBlock(c *gin.Context, _ *store.User) {
	hash := strings.ToLower(strings.TrimSpace(c.Param("sha256")))
	changed, err := store.DisableUploadHashBlock(c.Request.Context(), s.St.Pool, hash)
	if err != nil {
		fail(c, err)
		return
	}
	if !changed {
		fail(c, apperr.E("hash_not_found", "哈希规则不存在或已停用", 404))
		return
	}
	respondNoContent(c)
}

func pointer[T any](value T) *T { return &value }

func (s *Server) reconcilePaymentOrder(ctx context.Context, order *store.Order) (*store.PaymentReconciliation, error) {
	result := &store.PaymentReconciliation{OrderID: order.ID, Provider: order.Provider, LocalStatus: order.Status,
		ExpectedAmountCents: order.AmountCents, Outcome: "provider_error"}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		if err == nil {
			err = fmt.Errorf("支付渠道未配置")
		}
		result.Detail = pointer(err.Error())
		_ = store.InsertPaymentReconciliation(ctx, s.St.Pool, *result)
		return result, err
	}
	remote, err := client.GetOrder(ctx, *order.ProviderOrderID)
	if err != nil {
		result.Detail = pointer(err.Error())
		_ = store.InsertPaymentReconciliation(ctx, s.St.Pool, *result)
		return result, nil
	}
	result.ProviderState = pointer(remote.State)
	providerAmount, priceErr := remote.PriceCents()
	paidAmount, paidErr := remote.ReallyPriceCents()
	if priceErr == nil {
		result.ProviderAmountCents = pointer(providerAmount)
	}
	if paidErr == nil {
		result.ProviderPaidAmountCents = pointer(paidAmount)
	}
	identityValid := remote.MerchantOrderID == order.ID.String() && remote.ProviderOrderID == *order.ProviderOrderID
	if !identityValid || priceErr != nil || providerAmount != order.AmountCents {
		result.Outcome = "identity_or_amount_mismatch"
		result.Detail = pointer("上游订单身份或标价与本站不一致")
	} else if remote.State == 1 || remote.State == 2 {
		if paidErr != nil || paidAmount != order.AmountCents {
			result.Outcome = "paid_amount_mismatch"
			result.Detail = pointer("上游实付金额与本站订单金额不一致")
		} else if order.Status == "completed" {
			result.Outcome = "matched"
		} else if order.Status == "pending" || order.Status == "paid" {
			if _, err := s.completeOrder(ctx, order); err != nil {
				result.Outcome = "repair_failed"
				result.Detail = pointer(err.Error())
			} else {
				result.Outcome = "repaired"
				result.Detail = pointer("上游已支付，本站已自动补齐到账")
			}
		} else {
			result.Outcome = "local_terminal_mismatch"
			result.Detail = pointer("上游已支付，但本站订单处于不可自动修复的终态")
		}
	} else if order.Status == "completed" {
		result.Outcome = "local_ahead"
		result.Detail = pointer("本站已完成，但上游尚未确认支付")
	} else {
		result.Outcome = "matched"
	}
	if result.Outcome != "matched" && result.Outcome != "repaired" {
		s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &order.UserID, Category: "payment_reconciliation",
			Severity: "critical", Score: 100, Action: "observed", Reason: *result.Detail,
			Metadata: map[string]any{"orderId": order.ID.String(), "outcome": result.Outcome}})
	}
	return result, store.InsertPaymentReconciliation(ctx, s.St.Pool, *result)
}

func (s *Server) adminRunPaymentReconciliation(c *gin.Context, _ *store.User) {
	orders, err := store.ListOrdersForReconciliation(c.Request.Context(), s.St.Pool, time.Now().UTC().Add(-30*24*time.Hour), 500)
	if err != nil {
		fail(c, err)
		return
	}
	counts := map[string]int{}
	for _, order := range orders {
		result, err := s.reconcilePaymentOrder(c.Request.Context(), order)
		if err != nil {
			counts["provider_error"]++
			continue
		}
		counts[result.Outcome]++
	}
	ok(c, gin.H{"checked": len(orders), "outcomes": counts})
}

func (s *Server) adminPaymentReconciliations(c *gin.Context, _ *store.User) {
	items, err := store.ListPaymentReconciliations(c.Request.Context(), s.St.Pool, c.Query("issues") != "false", securityAdminLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items})
}
