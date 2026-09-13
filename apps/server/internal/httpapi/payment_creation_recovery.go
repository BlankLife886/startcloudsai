package httpapi

import (
	"context"
	"fmt"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"log"
	"time"
)

func (s *Server) recordPaymentCreationIssue(ctx context.Context, order *store.Order, outcome, detail, providerID string) {
	if len(detail) > 1000 {
		detail = detail[:1000]
	}
	entry := store.PaymentReconciliation{OrderID: order.ID, Provider: "lanjing", LocalStatus: order.Status, ExpectedAmountCents: order.AmountCents, Outcome: outcome, Detail: &detail}
	if err := store.InsertPaymentReconciliation(ctx, s.St.Pool, entry); err != nil {
		log.Printf("payment recovery audit order=%s outcome=%s: %v", order.ID, outcome, err)
	}
	s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &order.UserID, Category: "payment_reconciliation", Severity: "high", Score: 60, Action: "observed", Reason: detail, Metadata: map[string]any{"orderId": order.ID.String(), "providerOrderId": providerID, "outcome": outcome}})
}

func (s *Server) closeRejectedPayment(parent context.Context, client *lanjingpay.Client, order *store.Order, remote *lanjingpay.Order, validationErr error) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 10*time.Second)
	defer cancel()
	if remote == nil || remote.ProviderOrderID == "" || remote.MerchantOrderID != order.ID.String() {
		s.recordPaymentCreationIssue(ctx, order, "invalid_provider_identity", "渠道返回订单身份不匹配，未执行关单，需人工核查", "")
		return
	}
	if err := client.CloseOrder(ctx, remote.ProviderOrderID); err != nil {
		s.recordPaymentCreationIssue(ctx, order, "close_result_unknown", fmt.Sprintf("异常建单后的关单未确认，渠道单号 %s；原因：%v", remote.ProviderOrderID, err), remote.ProviderOrderID)
		return
	}
	if _, err := store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "failed"); err != nil {
		s.recordPaymentCreationIssue(ctx, order, "local_close_failed", "渠道已关闭，但本站状态更新失败", remote.ProviderOrderID)
		return
	}
	s.recordPaymentCreationIssue(ctx, order, "invalid_creation_closed", "渠道异常订单已关闭："+validationErr.Error(), remote.ProviderOrderID)
}
