package httpapi

import (
	"strconv"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

func (s *Server) adminSubscriptionAudit(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	section := c.DefaultQuery("section", "payments")
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 10000 || !store.Contains([]string{"payments", "changes", "lots", "usage", "events"}, section) {
		fail(c, apperr.E("validation_error", "无效的核查分类或页码", 422))
		return
	}
	at := s.subscriptionNow()
	ctx := store.WithBillingTime(c.Request.Context(), at)
	tx, err := s.St.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		fail(c, err)
		return
	}
	// RefundCalculation projects expirations; roll back so inspecting a chain never mutates it.
	defer tx.Rollback(ctx)
	sub, err := store.SubscriptionForPaidOrder(ctx, tx, id)
	if err != nil {
		fail(c, err)
		return
	}
	if sub == nil {
		fail(c, apperr.E("not_found", "未找到该已完成订单对应的订阅", 404))
		return
	}
	user, err := store.GetUserByID(ctx, tx, sub.UserID)
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil {
		user = &store.User{ID: sub.UserID}
	}
	var calculation *store.RefundCalculation
	calculationError := ""
	if sub.BillingVersion == 2 {
		calculationTx, e := tx.Begin(ctx)
		if e != nil {
			fail(c, e)
			return
		}
		calculation, err = subscription.RefundCalculation(ctx, calculationTx, sub, at)
		if err != nil {
			_ = calculationTx.Rollback(ctx)
			calculation = nil
			calculationError = "退款核算依据不完整，请结合历史记录人工核查"
		} else if err = calculationTx.Commit(ctx); err != nil {
			fail(c, err)
			return
		}
	} else {
		calculationError = "历史订阅没有完整的周期核算依据"
	}
	wallet, err := store.GetWallet(ctx, tx, sub.UserID)
	if err != nil {
		fail(c, err)
		return
	}
	credits, err := store.GetSubscriptionAuditCredits(ctx, tx, sub)
	if err != nil {
		fail(c, err)
		return
	}
	finance, err := store.SummarizeOrderAccounting(ctx, tx, store.OrderFilter{UserID: &sub.UserID, SubscriptionID: &sub.ID})
	if err != nil {
		fail(c, err)
		return
	}
	accountFinance, err := store.SummarizeOrderAccounting(ctx, tx, store.OrderFilter{UserID: &sub.UserID})
	if err != nil {
		fail(c, err)
		return
	}
	result, err := store.ListSubscriptionAuditPage(ctx, tx, sub, section, page)
	if err != nil {
		fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	ok(c, gin.H{"orderId": id, "user": gin.H{"id": user.ID, "username": user.Username, "email": user.Email}, "subscription": subscriptionDict(sub, at),
		"wallet": walletDict(wallet), "credits": credits, "finance": finance, "accountFinance": accountFinance, "calculation": calculation, "calculationError": calculationError,
		"section": section, "records": result, "asOf": at})
}
