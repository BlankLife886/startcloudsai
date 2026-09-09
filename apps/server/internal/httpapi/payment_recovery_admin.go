package httpapi

import (
	"fmt"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Uses the existing authenticated, audited reconciliation endpoint; never creates a provider order.
func (s *Server) adminReconcileOrRecover(c *gin.Context) {
	var input struct {
		OrderID         string `json:"orderId"`
		ProviderOrderID string `json:"providerOrderId"`
		Resolution      string `json:"resolution"`
		Note            string `json:"note"`
	}
	if c.Request.ContentLength != 0 {
		if err := bindJSON(c, &input); err != nil {
			fail(c, err)
			return
		}
	}
	if input.OrderID == "" && input.ProviderOrderID == "" && input.Resolution == "" {
		client, _, err := s.resolveLanjingPay(c.Request.Context())
		if err != nil || client == nil {
			fail(c, apperr.E("payment_unavailable", "支付渠道不可用", 503))
			return
		}
		checked, counts, err := s.runPaymentReconciliationBatch(c.Request.Context(), 100)
		if err != nil {
			fail(c, err)
			return
		}
		ok(c, gin.H{"checked": checked, "outcomes": counts})
		return
	}
	id, err := uuid.Parse(input.OrderID)
	providerID := strings.TrimSpace(input.ProviderOrderID)
	if err != nil || (providerID == "" && input.Resolution != "not_created") || len(providerID) > 128 {
		fail(c, apperr.E("validation_error", "请提供有效的平台订单号和渠道单号", 422))
		return
	}
	ctx := c.Request.Context()
	order, err := store.GetOrder(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if order == nil || order.Provider != "lanjing" {
		fail(c, apperr.E("order_not_found", "蓝鲸订单不存在", 404))
		return
	}
	if input.Resolution == "not_created" {
		note := strings.TrimSpace(input.Note)
		if providerID != "" || order.ProviderOrderID != nil || len([]rune(note)) < 6 || len([]rune(note)) > 300 {
			fail(c, apperr.E("validation_error", "仅适用于无渠道单号的订单，必须填写 6-300 字核查说明", 422))
			return
		}
		actor, exists := c.Get(ctxAdminUserKey)
		if !exists {
			fail(c, apperr.E("auth_required", "需要管理员身份", 401))
			return
		}
		note = fmt.Sprintf("%s (admin: %s)", note, actor.(*store.User).ID.String())
		err := s.St.Tx(ctx, func(tx pgx.Tx) error {
			fresh, err := store.ResolveUnboundOrderNotCreated(ctx, tx, id)
			if err != nil {
				return err
			}
			if err := store.InsertPaymentReconciliation(ctx, tx, store.PaymentReconciliation{OrderID: id, Provider: "lanjing", LocalStatus: fresh.Status, ExpectedAmountCents: expectedProviderPayAmount(fresh), Outcome: "manual_not_created", Detail: &note}); err != nil {
				return err
			}
			return store.ResolveOrderReconciliationRisks(ctx, tx, id)
		})
		if err != nil {
			fail(c, apperr.E("order_recovery_conflict", "订单状态已变化或核查结果未保存，请刷新后重试", 409))
			return
		}
		ok(c, gin.H{"checked": 1, "outcomes": map[string]int{"manual_not_created": 1}})
		return
	}
	if input.Resolution != "" {
		fail(c, apperr.E("validation_error", "不支持的核查方式", 422))
		return
	}
	if order.ProviderOrderID != nil && *order.ProviderOrderID != providerID {
		fail(c, apperr.E("order_provider_conflict", "订单已关联其他渠道单号", 409))
		return
	}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		fail(c, apperr.E("payment_unavailable", "支付渠道不可用", 503))
		return
	}
	remote, err := client.GetOrder(ctx, providerID)
	if err != nil {
		fail(c, apperr.E("payment_provider_error", "渠道订单读取失败", 502))
		return
	}
	amount, amountErr := remote.ReallyPriceCents()
	if validateRemoteOrder(order, remote, false, false) != nil || remote.ProviderOrderID != providerID || amountErr != nil || amount != expectedProviderPayAmount(order) {
		fail(c, apperr.E("order_provider_mismatch", "渠道订单的身份、金额或支付方式不匹配", 409))
		return
	}
	var expiresAt *time.Time
	if expiry := remote.ExpiresAt(); !expiry.IsZero() {
		expiresAt = &expiry
	}
	order, err = store.SetOrderProviderDetails(ctx, s.St.Pool, id, providerID, amount, lanjingPaymentMethod(remote.Type), remote.PayURL, remote.IsAuto == 1, expiresAt)
	if err != nil {
		fail(c, err)
		return
	}
	order.ReconcileLeaseID = nil // Manual verification does not own a scheduler lease.
	result, err := s.reconcilePaymentOrder(ctx, order)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"checked": 1, "outcomes": map[string]int{result.Outcome: 1}})
}
