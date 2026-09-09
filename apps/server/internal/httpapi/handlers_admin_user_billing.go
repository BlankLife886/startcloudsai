package httpapi

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"strconv"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (s *Server) billingUserID(c *gin.Context) (uuid.UUID, error) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		return id, err
	}
	u, err := store.GetUserByID(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		return id, err
	}
	if u == nil || u.Role != "user" {
		return id, apperr.E("not_found", "用户不存在", 404)
	}
	return id, nil
}

func billingPage(c *gin.Context) (int, int, error) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 10000 {
		return 0, 0, apperr.E("validation_error", "无效页码", 422)
	}
	size, err := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if err != nil || size < 1 || size > 100 {
		return 0, 0, apperr.E("validation_error", "每页须为1-100条", 422)
	}
	return page, size, nil
}

func (s *Server) adminUserBilling(c *gin.Context, _ *store.User) {
	id, err := s.billingUserID(c)
	if err != nil {
		fail(c, err)
		return
	}
	page, size, err := billingPage(c)
	if err != nil {
		fail(c, err)
		return
	}
	at := s.subscriptionNow()
	ctx := store.WithBillingTime(c.Request.Context(), at)
	tx, err := s.St.Pool.Begin(ctx)
	if err != nil {
		fail(c, err)
		return
	}
	defer tx.Rollback(ctx)
	wallet, err := store.GetWallet(ctx, tx, id)
	if err != nil {
		fail(c, err)
		return
	}
	rows, total, err := store.ListUserSubscriptionBenefits(ctx, tx, id, page, size)
	if err != nil {
		fail(c, err)
		return
	}
	subscriptions := []gin.H{}
	for _, r := range rows {
		d := subscriptionDict(r.Subscription, at)
		d["availablePoints"], d["taskFrozenPoints"], d["heldPoints"], d["spentPoints"], d["expiredPoints"] = r.Available, r.Frozen, r.Held, r.Spent, r.Expired
		d["changing"] = r.Changing
		if r.Status == "active" && r.EndsAt.After(at) && !r.Changing {
			d["nextResetAt"] = r.NextReset
		} else {
			d["nextResetAt"] = nil
		}
		subscriptions = append(subscriptions, d)
	}
	pending, err := store.ListOrderAccounting(ctx, tx, store.OrderFilter{UserID: &id, PendingOnly: true}, 10, nil)
	if err != nil {
		fail(c, err)
		return
	}
	pendingOrders := []gin.H{}
	for _, o := range pending {
		pendingOrders = append(pendingOrders, accountingOrderDict(o))
	}
	changes, err := store.ListSubscriptionChanges(ctx, tx, &id)
	if err != nil {
		fail(c, err)
		return
	}
	actions := []*store.SubscriptionChange{}
	for _, ch := range changes {
		if store.Contains([]string{"pending", "reviewing", "processing"}, ch.Status) {
			actions = append(actions, ch)
		}
	}
	concurrency, err := store.GetUserConcurrency(ctx, tx, id)
	if err != nil {
		fail(c, err)
		return
	}
	active, err := store.GetCurrentSubscription(ctx, tx, id, at)
	if err != nil {
		fail(c, err)
		return
	}
	eligibility := gin.H{"eligible": false, "reason": "暂无有效订阅"}
	if active != nil && active.BillingVersion == 2 {
		calc, e := subscription.RefundCalculation(ctx, tx, active, at)
		if e != nil {
			eligibility["reason"] = "退款依据不完整，需人工核查"
		} else {
			reason := "可申请审核"
			can := true
			switch {
			case len(actions) > 0:
				reason = "已有订阅变更正在处理"
				can = false
			case calc.SpentPoints > 0:
				reason = "已使用订阅积分，需人工例外处理"
				can = false
			case calc.ProtectedUsagePoints > 0:
				reason = "已使用订阅价格保护，需人工例外处理"
				can = false
			case calc.TaskFrozenPoints > 0 || calc.ProtectedTopupFrozenPoints > 0:
				reason = "仍有任务预留积分，须等待结算"
				can = false
			}
			eligibility = gin.H{"eligible": can, "reason": reason, "calculation": calc, "subscriptionId": active.ID}
		}
	} else if len(actions) > 0 {
		eligibility["reason"] = "已有订阅变更正在处理"
	} else if active != nil {
		eligibility["reason"] = "历史订阅需人工核查退款依据"
	}
	protected, err := store.ActiveBillingSubscription(ctx, tx, id, false)
	if err != nil {
		fail(c, err)
		return
	}
	protection := gin.H{"available": false, "reason": "当前无生效的订阅价格保护"}
	if protected != nil && protected.Contract != nil && protected.Contract.LockModelPrices {
		protection = gin.H{"available": true, "allowTopup": protected.Contract.AllowTopupPriceLock, "reason": "账户已具备订阅价格保护，实际价格仍按任务范围及资金来源判断"}
	}
	finance, err := store.SummarizeOrderAccounting(ctx, tx, store.OrderFilter{UserID: &id})
	if err != nil {
		fail(c, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		fail(c, err)
		return
	}
	other := int64(0)
	if wallet != nil {
		other = max(wallet.BalanceCents-wallet.EligibleTopupPoints-wallet.OrdinaryTopupPoints, 0)
	}
	c.Header("Cache-Control", "no-store")
	ok(c, gin.H{"items": subscriptions, "total": total, "page": page, "wallet": walletDict(wallet), "unclassifiedNormalPoints": other, "pendingOrders": pendingOrders, "pendingChanges": actions, "refundEligibility": eligibility, "protection": protection, "concurrency": concurrency, "finance": finance})
}

func (s *Server) adminUserCreditLots(c *gin.Context, u *store.User)       { s.userCreditLots(c, false) }
func (s *Server) adminExportUserCreditLots(c *gin.Context, u *store.User) { s.userCreditLots(c, true) }
func (s *Server) userCreditLots(c *gin.Context, export bool) {
	id, err := s.billingUserID(c)
	if err != nil {
		fail(c, err)
		return
	}
	page, size, err := billingPage(c)
	if err != nil {
		fail(c, err)
		return
	}
	f := store.CreditLotFilter{UserID: id, Bucket: c.Query("bucket"), State: c.Query("state")}
	if (f.Bucket != "" && !store.Contains([]string{"topup", "subscription"}, f.Bucket)) || (f.State != "" && !store.Contains([]string{"available", "frozen", "held", "spent", "expired", "revoked"}, f.State)) {
		fail(c, apperr.E("validation_error", "无效的积分批次筛选", 422))
		return
	}
	if export {
		page, size = 1, 5001
	}
	ctx := store.WithBillingTime(c.Request.Context(), s.subscriptionNow())
	tx, err := s.St.Pool.Begin(ctx)
	if err != nil {
		fail(c, err)
		return
	}
	defer tx.Rollback(ctx)
	if err := store.ExpireSubscriptionCredits(ctx, tx, id, s.subscriptionNow()); err != nil {
		fail(c, err)
		return
	}
	items, summary, err := store.ListUserCreditLots(ctx, tx, f, page, size)
	if err != nil {
		fail(c, err)
		return
	}
	if export && summary.Total > 5000 {
		fail(c, apperr.E("validation_error", "单次最多导出5000个批次，请缩小筛选范围", 422))
		return
	}
	if err := tx.Commit(ctx); err != nil {
		fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	if !export {
		ok(c, gin.H{"items": items, "total": summary.Total, "summary": summary, "page": page})
		return
	}
	var output bytes.Buffer
	output.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&output)
	_ = writer.Write([]string{"批次编号", "来源", "套餐", "订单号", "订阅编号", "发放积分", "可用", "任务冻结", "变更冻结", "已消费", "已过期", "权益回收", "冻结原因", "充值锁价资格", "每元积分", "到期时间", "入账时间"})
	for _, l := range items {
		orderID, subID, expiry, rate := "", "", "", ""
		if l.OrderID != nil {
			orderID = l.OrderID.String()
		}
		if l.SubscriptionID != nil {
			subID = l.SubscriptionID.String()
		}
		if l.ExpiresAt != nil {
			expiry = l.ExpiresAt.In(promptDayLocation).Format("2006-01-02 15:04:05")
		}
		if l.RechargePolicy != nil {
			rate = fmt.Sprint(l.RechargePolicy.PointsPerYuan)
		}
		bucket, eligibility, hold := "充值积分", "不符合", ""
		if l.PriceLockEligible {
			eligibility = "符合"
		}
		if l.Bucket == "subscription" {
			bucket, eligibility = "订阅积分", "按订阅权益"
		}
		if l.HoldReason == "refund" {
			hold = "退订审核"
		} else if l.HoldReason == "upgrade" {
			hold = "升级待支付"
		}
		_ = writer.Write(safeCSVRow(l.ID.String(), bucket, l.Name, orderID, subID, fmt.Sprint(l.GrantedPoints), fmt.Sprint(l.AvailablePoints), fmt.Sprint(l.FrozenPoints), fmt.Sprint(l.HeldPoints), fmt.Sprint(l.SpentPoints), fmt.Sprint(l.ExpiredPoints), fmt.Sprint(l.RevokedPoints), hold, eligibility, rate, expiry, l.CreatedAt.In(promptDayLocation).Format("2006-01-02 15:04:05")))
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		fail(c, err)
		return
	}
	if err := s.recordBillingExport(c, "credit-lots.export", len(items), f); err != nil {
		fail(c, err)
		return
	}
	c.Header("Content-Disposition", `attachment; filename="credit-lots-`+id.String()+`.csv"`)
	c.Data(200, "text/csv; charset=utf-8", output.Bytes())
}
