package httpapi

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (s *Server) subscriptionNow() time.Time {
	if s.SubscriptionClock != nil && (s.Cfg == nil || s.Cfg.AppEnv != "production") {
		return s.SubscriptionClock().UTC()
	}
	return time.Now().UTC()
}

func subscriptionDict(sub *store.Subscription, at time.Time) gin.H {
	status := sub.Status
	if status == "active" && !sub.EndsAt.After(at) {
		status = "expired"
	}
	return gin.H{"contract": sub.Contract, "id": sub.ID, "planId": sub.PlanID, "planName": sub.PlanName, "orderId": sub.OrderID, "status": status, "startsAt": sub.StartsAt, "endsAt": sub.EndsAt, "dailyPoints": sub.DailyGrantCents, "billingVersion": sub.BillingVersion, "policy": sub.Policy, "revision": sub.Revision, "canChange": sub.BillingVersion == 2 && status == "active"}
}

func publicSubscriptionChange(change *store.SubscriptionChange) gin.H {
	return gin.H{"id": change.ID, "subscriptionId": change.SubscriptionID, "kind": change.Kind, "status": change.Status,
		"targetPlanId": change.TargetPlanID, "amountCents": change.AmountCents, "requestedAmountCents": change.RequestedAmountCents,
		"snapshot": change.Snapshot, "reason": change.Reason, "publicMessage": store.SubscriptionChangeMessage(change),
		"refundCalculation": change.RefundCalculation, "createdAt": change.CreatedAt, "updatedAt": change.UpdatedAt,
		"completedAt": change.CompletedAt, "expiresAt": change.ExpiresAt}
}

// modelNames maps the model config ids a plan stores to the names users see;
// ids missing from the catalogue fall back to the id itself.
func (s *Server) modelNames(ctx context.Context) func([]string) []string {
	byID := map[string]string{}
	if cfg, err := modelconfig.Load(ctx, s.St.Pool); err == nil {
		for _, model := range cfg.Models {
			byID[model.ID] = model.Name
		}
	}
	return func(ids []string) []string {
		names := make([]string, 0, len(ids))
		for _, id := range ids {
			if name := byID[id]; name != "" {
				names = append(names, name)
			} else {
				names = append(names, id)
			}
		}
		return names
	}
}

// myConcurrency 返回当前用户的执行并发额度（基础 + 订阅 + 手动）与占用，供前端按实际额度
// 控制同时提交的任务数；比 /me/subscriptions 轻，不做订阅积分过期等写操作。
func (s *Server) myConcurrency(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	concurrency, err := store.GetUserConcurrency(store.WithBillingTime(ctx, s.subscriptionNow()), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, concurrency)
}

func (s *Server) mySubscriptions(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	at := s.subscriptionNow()
	concurrency, err := store.GetUserConcurrency(store.WithBillingTime(ctx, at), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if err := store.ExpireSubscriptionCredits(ctx, s.St.Pool, user.ID, at); err != nil {
		fail(c, err)
		return
	}
	subscriptions, err := store.ListUserSubscriptions(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	modelNames := s.modelNames(ctx)
	items := []gin.H{}
	for _, sub := range subscriptions {
		item := subscriptionDict(sub, at)
		if len(sub.Policy.ModelIDs) > 0 {
			item["modelNames"] = modelNames(sub.Policy.ModelIDs)
		}
		if sub.PlanName == "" {
			p, err := store.GetPlan(ctx, s.St.Pool, sub.PlanID)
			if err != nil {
				fail(c, err)
				return
			}
			if p != nil {
				item["planName"] = p.Name
			}
		}
		progress, err := store.GetSubscriptionProgress(ctx, s.St.Pool, sub, at)
		if err != nil {
			fail(c, err)
			return
		}
		item["nextGrantAt"], item["grantedCycles"], item["totalCycles"] = progress.NextGrantAt, progress.GrantedCycles, progress.TotalCycles
		item["skippedCycles"] = progress.SkippedCycles
		item["availablePoints"] = nil
		if progress.AvailableKnown {
			item["availablePoints"] = progress.AvailablePoints
		}
		item["frozenPoints"], item["spentPoints"], item["issuedPoints"] = progress.FrozenPoints, progress.SpentPoints, progress.IssuedPoints
		item["hasPriorTerm"] = progress.HasPriorTerm
		item["currentTermSpentPoints"], item["priorTermSpentPoints"] = nil, nil
		if sub.BillingVersion == 2 && progress.UnattributedSpent == 0 {
			item["currentTermSpentPoints"], item["priorTermSpentPoints"] = progress.CurrentTermSpent, progress.SpentPoints-progress.CurrentTermSpent
		}
		item["revokedPoints"] = progress.RevokedPoints
		item["expiredPoints"] = progress.ExpiredPoints
		item["upgradeHeldPoints"], item["upgradeReclaimedPoints"] = progress.UpgradeHeld, progress.UpgradeRevoked
		item["upgrading"] = progress.Upgrading
		if progress.Upgrading {
			item["canChange"] = false
		}
		items = append(items, item)
	}
	changes, err := store.ListSubscriptionChanges(ctx, s.St.Pool, &user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	publicChanges := make([]gin.H, 0, len(changes))
	for _, change := range changes {
		publicChanges = append(publicChanges, publicSubscriptionChange(change))
	}
	ok(c, gin.H{"concurrency": concurrency, "baseCanvasProjects": settings.ResolveCanvasProjectMaxCount(ctx, s.St.Pool), "baseAssistantConversations": settings.ResolveAssistantConversationPolicy(ctx, s.St.Pool).MaxCount, "items": items, "changes": publicChanges, "serverTime": at, "refundMode": "manual_provider_confirmation"})
}
func (s *Server) mySubscriptionGrants(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	sub, err := store.GetSubscription(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if sub == nil || sub.UserID != user.ID {
		fail(c, apperr.E("not_found", "订阅不存在", 404))
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 || page > 10000 {
		fail(c, apperr.E("validation_error", "无效页码", 422))
		return
	}
	if (page-1)*20 >= store.ListCountCap {
		fail(c, errPageBeyondCap)
		return
	}
	type grant struct {
		ID          uuid.UUID  `json:"id"`
		OrderID     *uuid.UUID `json:"orderId"`
		ScheduledAt time.Time  `json:"scheduledAt"`
		GrantedAt   time.Time  `json:"grantedAt"`
		Points      int64      `json:"points"`
		Kind        string     `json:"kind"`
		SourceID    string     `json:"sourceId"`
	}
	items := []grant{}
	var total int
	sql := `SELECT id,order_id,scheduled_at,granted_at,granted_points,grant_kind,source_id FROM subscription_credit_lots WHERE subscription_id=$1 ORDER BY scheduled_at DESC,id DESC LIMIT 20 OFFSET $2`
	countSQL := `SELECT count(*) FROM subscription_credit_lots WHERE subscription_id=$1`
	if sub.BillingVersion == 1 {
		sql = `SELECT l.id,s.order_id,l.created_at,l.created_at,l.delta_cents,'legacy',l.source_id FROM wallet_ledger l JOIN subscriptions s ON s.id=$1 WHERE l.user_id=s.user_id AND l.source_type='subscription_daily' AND l.source_id LIKE s.id::text||'/%' ORDER BY l.source_id DESC,l.created_at DESC LIMIT 20 OFFSET $2`
		countSQL = `SELECT count(*) FROM wallet_ledger l JOIN subscriptions s ON s.id=$1 WHERE l.user_id=s.user_id AND l.source_type='subscription_daily' AND l.source_id LIKE s.id::text||'/%'`
	}
	if err := s.St.Pool.QueryRow(ctx, countSQL, id).Scan(&total); err != nil {
		fail(c, err)
		return
	}
	rows, err := s.St.Pool.Query(ctx, sql, id, (page-1)*20)
	if err != nil {
		fail(c, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var g grant
		if err := rows.Scan(&g.ID, &g.OrderID, &g.ScheduledAt, &g.GrantedAt, &g.Points, &g.Kind, &g.SourceID); err != nil {
			fail(c, err)
			return
		}
		items = append(items, g)
	}
	if err := rows.Err(); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items, "total": total, "page": page, "limit": 20})
}
func (s *Server) mySubscriptionUpgradeQuote(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var input struct {
		PlanID string `json:"planId"`
	}
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	planID, err := uuid.Parse(input.PlanID)
	if err != nil {
		fail(c, apperr.E("validation_error", "无效套餐", 422))
		return
	}
	quote, err := subscription.QuoteUpgrade(c.Request.Context(), s.St, user.ID, id, planID, s.subscriptionNow())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, quote)
}
func (s *Server) mySubscriptionChange(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	change, err := store.GetSubscriptionChange(c.Request.Context(), s.St.Pool, id, false)
	if err != nil {
		fail(c, err)
		return
	}
	if change == nil || change.UserID != user.ID {
		fail(c, apperr.E("not_found", "变更记录不存在", 404))
		return
	}
	ok(c, publicSubscriptionChange(change))
}
func (s *Server) mySubscriptionRefund(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	change, err := subscription.RequestRefund(c.Request.Context(), s.St, user.ID, id, input.Reason, s.subscriptionNow())
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, publicSubscriptionChange(change))
}

func (s *Server) mySubscriptionRefundPreview(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	_, err = subscription.PreviewRefund(c.Request.Context(), s.St, user.ID, id, s.subscriptionNow())
	if err != nil {
		fail(c, err)
		return
	}
	sub, err := store.GetSubscription(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	calculation, err := subscription.RefundCalculation(c.Request.Context(), s.St.Pool, sub, s.subscriptionNow())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"estimatedAmountCents": calculation.MaxRefundCents, "calculation": calculation, "requiresReview": true})
}
func (s *Server) adminSubscriptionChanges(c *gin.Context, _ *store.User) {
	filter, filterErr := adminListFilter(c)
	if filterErr != nil {
		fail(c, filterErr)
		return
	}
	page, parseErr := strconv.Atoi(c.DefaultQuery("page", "1"))
	query := strings.TrimSpace(c.Query("q"))
	status, kind := c.Query("status"), c.Query("kind")
	if parseErr != nil || page < 1 || page > 10000 || len([]rune(query)) > 100 || !store.Contains([]string{"", "reviewing", "processing", "completed", "rejected", "cancelled", "pending"}, status) || !store.Contains([]string{"", "refund", "upgrade"}, kind) {
		fail(c, apperr.E("validation_error", "筛选参数无效", 422))
		return
	}
	if (page-1)*25 >= store.ListCountCap {
		fail(c, errPageBeyondCap)
		return
	}
	items, total, err := store.SearchSubscriptionChanges(c.Request.Context(), s.St.Pool, query, status, kind, page, filter)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items, "total": total, "page": page, "limit": 25, "refundMode": "manual_provider_confirmation"})
}

func (s *Server) adminManualRefundPreview(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	tx, err := s.St.Pool.Begin(ctx)
	if err != nil {
		fail(c, err)
		return
	}
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
	if sub.BillingVersion != 2 || (sub.Status != "active" && sub.Status != "expired") {
		fail(c, apperr.E("refund_not_available", "该订阅已有变更正在处理、已退订或为旧版订阅", 409))
		return
	}
	calculation, err := subscription.RefundCalculation(ctx, tx, sub, s.subscriptionNow())
	if err != nil {
		fail(c, err)
		return
	}
	user, err := store.GetUserByID(ctx, tx, sub.UserID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"orderId": id, "subscription": subscriptionDict(sub, s.subscriptionNow()), "user": gin.H{"id": user.ID, "username": user.Username, "email": user.Email}, "calculation": calculation, "maxManualAmountCents": max(calculation.PaidCents-calculation.RefundedCents, 0)})
}

func (s *Server) adminRequestManualRefund(c *gin.Context, admin *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var input struct {
		AmountCents int64  `json:"amountCents"`
		Note        string `json:"note"`
		Confirmed   bool   `json:"confirmed"`
	}
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	if !input.Confirmed {
		fail(c, apperr.E("validation_error", "请明确确认人工例外退款及核定金额", 422))
		return
	}
	change, err := subscription.RequestManualRefund(c.Request.Context(), s.St, admin.ID, id, input.AmountCents, input.Note, s.subscriptionNow())
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, change)
}

func (s *Server) adminSubscriptionChangeDetail(c *gin.Context, _ *store.User) {
	page, parseErr := strconv.Atoi(c.DefaultQuery("ledgerPage", "1"))
	if parseErr != nil || page < 1 || page > 10000 {
		fail(c, apperr.E("validation_error", "无效流水页码", 422))
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	change, err := store.GetSubscriptionChange(ctx, s.St.Pool, id, false)
	if err != nil {
		fail(c, err)
		return
	}
	if change == nil {
		fail(c, apperr.E("not_found", "申请不存在", 404))
		return
	}
	sub, err := store.GetSubscription(ctx, s.St.Pool, change.SubscriptionID)
	if err != nil {
		fail(c, err)
		return
	}
	user, err := store.GetUserByID(ctx, s.St.Pool, change.UserID)
	if err != nil {
		fail(c, err)
		return
	}
	accountWallet, err := store.GetWallet(ctx, s.St.Pool, change.UserID)
	if err != nil {
		fail(c, err)
		return
	}
	calculation, err := subscription.RefundCalculation(ctx, s.St.Pool, sub, s.subscriptionNow())
	if err != nil {
		fail(c, err)
		return
	}
	orders, err := store.SubscriptionRelatedOrders(ctx, s.St.Pool, sub)
	if err != nil {
		fail(c, err)
		return
	}
	events, err := store.ListSubscriptionChangeEvents(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	ledger, total, err := store.SubscriptionRelatedLedger(ctx, s.St.Pool, sub, page)
	if err != nil {
		fail(c, err)
		return
	}
	orderItems := make([]gin.H, 0, len(orders))
	for _, o := range orders {
		orderItems = append(orderItems, orderDict(o))
	}
	ledgerItems := make([]gin.H, 0, len(ledger))
	for _, e := range ledger {
		ledgerItems = append(ledgerItems, ledgerDict(e))
	}
	ok(c, gin.H{"change": change, "subscription": subscriptionDict(sub, s.subscriptionNow()), "user": gin.H{"id": user.ID, "email": user.Email, "username": user.Username}, "wallet": walletDict(accountWallet), "currentCalculation": calculation, "orders": orderItems, "events": events, "ledger": ledgerItems, "ledgerLimit": 50, "ledgerPage": page, "ledgerTotal": total})
}
func (s *Server) adminReviewSubscriptionRefund(c *gin.Context, admin *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var input struct {
		Action              string `json:"action"`
		Note                string `json:"note"`
		ProviderReference   string `json:"providerReference"`
		ApprovedAmountCents *int64 `json:"approvedAmountCents"`
		CustomerMessage     string `json:"customerMessage"`
	}
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	var amount []int64
	if input.ApprovedAmountCents != nil {
		amount = append(amount, *input.ApprovedAmountCents)
	}
	if err := subscription.ReviewRefundWithMessage(c.Request.Context(), s.St, id, admin.ID, input.Action, input.Note, input.ProviderReference, input.CustomerMessage, s.subscriptionNow(), amount...); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"updated": true})
}
