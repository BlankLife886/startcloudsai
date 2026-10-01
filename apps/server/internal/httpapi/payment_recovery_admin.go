package httpapi

import (
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// adminReconcileOrRecover runs on the audited reconciliation endpoint and never
// creates a provider order:
//   - no body: reconcile the next due batch;
//   - {orderId, resolution:"check"}: check one order with the provider now;
//   - {orderId, providerOrderId}: attach the cloud order found in the provider
//     console to a local order that has none, then check it.
func (s *Server) adminReconcileOrRecover(c *gin.Context) {
	var input struct {
		OrderID         string `json:"orderId"`
		ProviderOrderID string `json:"providerOrderId"`
		Resolution      string `json:"resolution"`
	}
	if c.Request.ContentLength != 0 {
		if err := bindJSON(c, &input); err != nil {
			fail(c, err)
			return
		}
	}
	ctx := c.Request.Context()
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil {
		client = nil
	}
	if input.OrderID == "" && input.ProviderOrderID == "" && input.Resolution == "" {
		if client == nil {
			fail(c, apperr.E("payment_unavailable", "支付渠道不可用", 503))
			return
		}
		checked, counts, err := s.runPaymentReconciliationBatch(ctx, 100)
		if err != nil {
			fail(c, err)
			return
		}
		ok(c, gin.H{"checked": checked, "outcomes": counts})
		return
	}
	id, err := uuid.Parse(input.OrderID)
	providerID := strings.TrimSpace(input.ProviderOrderID)
	if err != nil || len(providerID) > 128 || (input.Resolution != "check" && input.Resolution != "") ||
		(input.Resolution == "check") == (providerID != "") {
		fail(c, apperr.E("validation_error", "请提供平台订单号，以及「立即核实」或要关联的渠道订单号", 422))
		return
	}
	order, err := store.GetOrder(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if order == nil || order.Provider != "lanjing" {
		fail(c, apperr.E("order_not_found", "蓝鲸订单不存在", 404))
		return
	}
	if providerID != "" && (order.ProviderOrderID == nil || *order.ProviderOrderID != providerID) {
		if client == nil {
			fail(c, apperr.E("payment_unavailable", "支付渠道不可用", 503))
			return
		}
		if order.ProviderOrderID != nil {
			fail(c, apperr.E("order_provider_conflict", "订单已关联渠道订单号，不能覆盖", 409))
			return
		}
		remote, err := client.GetOrder(ctx, providerID)
		if err != nil {
			fail(c, apperr.E("payment_provider_error", "渠道订单读取失败："+err.Error(), 502))
			return
		}
		price, priceErr := remote.PriceCents()
		paid, paidErr := remote.ReallyPriceCents()
		if remote.MerchantOrderID != order.ID.String() || remote.ProviderOrderID != providerID || priceErr != nil ||
			price != order.AmountCents || paidErr != nil || lanjingPaymentMethod(remote.Type) == "" {
			fail(c, apperr.E("order_provider_mismatch", "渠道订单的商户订单号或金额与本订单不一致", 409))
			return
		}
		var expiresAt *time.Time
		if value := remote.ExpiresAt(); !value.IsZero() {
			expiresAt = &value
		}
		order, err = store.BindOrderProvider(ctx, s.St.Pool, id, providerID, paid, lanjingPaymentMethod(remote.Type),
			remote.PayURL, remote.IsAuto == 1, expiresAt, false)
		if err != nil {
			fail(c, apperr.E("order_provider_conflict", "订单状态已变化，请刷新后重试", 409))
			return
		}
	}
	result, err := s.reconcilePaymentOrder(ctx, order, true)
	if err != nil {
		fail(c, apperr.E("payment_provider_error", "核实未完成："+err.Error(), 502))
		return
	}
	fresh, _ := store.GetOrder(ctx, s.St.Pool, id)
	out := gin.H{"checked": 1, "outcomes": map[string]int{result.Outcome: 1}, "result": result}
	if fresh != nil {
		out["order"] = orderDict(fresh)
	}
	ok(c, out)
}
