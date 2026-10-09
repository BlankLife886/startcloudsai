package httpapi

import (
	"context"
	"crypto/hmac"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

var errProviderAdjustedAmount = errors.New("provider adjusted payment amount")

func (s *Server) listPlans(c *gin.Context) {
	baseConcurrency, err := store.BaseUserConcurrency(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	plans, err := store.ListPlans(c.Request.Context(), s.St.Pool, true)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(plans))
	modelNames := s.modelNames(c.Request.Context())
	for _, p := range plans {
		item := planDict(p, false)
		if len(p.SubscriptionPolicy.ModelIDs) > 0 {
			item["modelNames"] = modelNames(p.SubscriptionPolicy.ModelIDs)
		}
		items = append(items, item)
	}
	client, paymentCfg, configErr := s.resolveLanjingPay(c.Request.Context())
	if configErr != nil {
		log.Printf("resolve lanjing pay for plans: %v", configErr)
	}
	methods := make([]string, 0, 2)
	if paymentCfg.AlipayEnabled {
		methods = append(methods, "alipay")
	}
	if paymentCfg.WechatEnabled {
		methods = append(methods, "wechat")
	}
	ok(c, gin.H{
		"items":                      items,
		"baseConcurrency":            baseConcurrency,
		"baseCanvasProjects":         settings.ResolveCanvasProjectMaxCount(c.Request.Context(), s.St.Pool),
		"baseAssistantConversations": settings.ResolveAssistantConversationPolicy(c.Request.Context(), s.St.Pool).MaxCount,
		"paymentEnabled":             client != nil && configErr == nil && len(methods) > 0,
		"paymentMethods":             methods,
	})
}

type orderCreateIn struct {
	AmountYuan           *int64 `json:"amountYuan"`
	ExpectedPlanRevision *int   `json:"expectedPlanRevision"`
	UpgradeQuoteID       string `json:"upgradeQuoteId"`
	PlanID               string `json:"planId"`
	PaymentMethod        string `json:"paymentMethod"`
}

func (s *Server) createOrder(c *gin.Context) {
	client, paymentCfg, configErr := s.resolveLanjingPay(c.Request.Context())
	if configErr != nil {
		log.Printf("resolve lanjing pay: %v", configErr)
		fail(c, apperr.E("payment_unavailable", "支付配置不完整", 503))
		return
	}
	if client == nil {
		fail(c, apperr.E("payment_unavailable", "支付渠道尚未配置", 503))
		return
	}
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body orderCreateIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	paymentType, err := parseLanjingPaymentType(body.PaymentMethod)
	if err != nil {
		fail(c, err)
		return
	}
	if (paymentType == lanjingpay.Alipay && !paymentCfg.AlipayEnabled) ||
		(paymentType == lanjingpay.Wechat && !paymentCfg.WechatEnabled) {
		fail(c, apperr.E("payment_method_unavailable", "该支付方式暂未开放", 422))
		return
	}
	planID, err := uuid.Parse(body.PlanID)
	if err != nil {
		fail(c, apperr.E("validation_error", "planId: 无效的 UUID", 422))
		return
	}
	ctx := c.Request.Context()
	plan, err := store.GetActivePlan(ctx, s.St.Pool, planID)
	if err != nil {
		fail(c, err)
		return
	}
	if plan == nil {
		fail(c, apperr.E("plan_not_found", "套餐不存在或已下架", 404))
		return
	}
	// Custom-amount top-up is retired: only fixed-amount QR codes are configured.
	if plan.RechargePolicy != nil || body.AmountYuan != nil {
		fail(c, apperr.E("custom_recharge_retired", "自定义金额充值已下线，请选择固定额度包", 422))
		return
	}
	if body.ExpectedPlanRevision != nil && (plan.Kind != "subscription" || body.UpgradeQuoteID != "") {
		fail(c, apperr.E("validation_error", "该套餐不支持指定方案版本", 422))
		return
	}
	if plan.Kind == "subscription" && body.ExpectedPlanRevision != nil {
		if *body.ExpectedPlanRevision < 1 {
			fail(c, apperr.E("validation_error", "无效的订阅方案版本", 422))
			return
		}
		if *body.ExpectedPlanRevision != plan.Revision {
			fail(c, apperr.E("plan_changed", "订阅方案已更新，请重新确认权益", 409))
			return
		}
	}
	var upgradeID *uuid.UUID
	if body.UpgradeQuoteID != "" {
		id, parseErr := uuid.Parse(body.UpgradeQuoteID)
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "无效的升级报价", 422))
			return
		}
		change, err := store.GetSubscriptionChange(ctx, s.St.Pool, id, false)
		if err != nil {
			fail(c, err)
			return
		}
		if change == nil || change.UserID != user.ID || change.Kind != "upgrade" || change.TargetPlanID == nil || *change.TargetPlanID != plan.ID {
			fail(c, apperr.E("upgrade_quote_invalid", "升级报价不可用，请重新获取", 409))
			return
		}
		upgradeID = &id
		plan.PriceCents = change.AmountCents
		plan.Name = change.Snapshot.PlanName
		plan.DailyGrantCents = change.Snapshot.DailyPoints
		plan.DurationDays = change.Snapshot.DurationDays
		plan.SubscriptionPolicy = change.Snapshot.Policy
		plan.GrantCents = 0
		plan.BonusCents = 0
	} else if plan.Kind == "subscription" {
		exists, err := store.HasBlockingSubscription(ctx, s.St.Pool, user.ID, s.subscriptionNow())
		if err != nil {
			fail(c, err)
			return
		}
		if exists {
			fail(c, apperr.E("subscription_exists", "你已有有效订阅，可购买额度包；升级或退订请前往我的订阅", 409))
			return
		}
	}
	createPending := func() (*store.Order, bool, error) {
		if upgradeID != nil {
			return store.GetOrInsertUpgradeOrder(ctx, s.St, user.ID, *upgradeID, s.subscriptionNow())
		}
		if body.ExpectedPlanRevision != nil {
			return store.GetOrInsertPendingOrderAtRevision(ctx, s.St, user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "lanjing", *body.ExpectedPlanRevision, s.subscriptionNow())
		}
		return store.GetOrInsertPendingOrder(ctx, s.St, user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "lanjing", s.subscriptionNow())
	}
	unsettled, err := store.ListUnsettledOrdersForUser(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	for _, existing := range unsettled {
		lookupCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
		fresh, _, syncErr := s.syncLanjingOrder(lookupCtx, client, existing)
		cancel()
		if syncErr != nil {
			log.Printf("sync unsettled order %s before checkout: %v", existing.ID, syncErr)
		}
		switch {
		case fresh.Status == "completed" || (fresh.Status != "pending" && fresh.PaidAt == nil):
			continue // settled by the sync above
		case fresh.PaidAt != nil:
			fail(c, apperr.E("payment_confirming", "你有一笔已付款的订单正在到账，请稍候，请勿重复支付", 409))
			return
		case !orderMatchesCheckout(fresh, plan, paymentType, upgradeID):
			fail(c, userUnsettledOrderError())
			return
		case fresh.ProviderOrderID == nil:
			fail(c, apperr.E("payment_order_creating", "订单正在创建，请稍候", 409))
			return
		case paymentQRAvailable(fresh, time.Now(), minReusableQRTime):
			out := orderDict(fresh)
			out["reused"] = true
			ok(c, out)
			return
		default:
			// The QR code is (nearly) expired; the provider has not closed it yet.
			fail(c, apperr.E("payment_order_expiring", "上一笔订单即将超时，请 1 分钟后再下单；如已付款请勿重复支付", 409))
			return
		}
	}
	if !s.paymentChannelOnline(ctx, client) {
		fail(c, apperr.E("payment_channel_offline", "收款通道暂时离线，请稍后再试", 503))
		return
	}
	order, created, err := createPending()
	if err != nil {
		switch {
		case errors.Is(err, store.ErrAlreadySubscribed):
			err = apperr.E("subscription_exists", "已有有效订阅，请前往我的订阅管理", 409)
		case errors.Is(err, store.ErrSubscriptionChangeInvalid):
			err = apperr.E("upgrade_quote_invalid", "升级报价已失效，请重新获取", 409)
		case errors.Is(err, store.ErrUserUnsettledOrder):
			err = userUnsettledOrderError()
		case errors.Is(err, store.ErrOrderPlanChanged):
			err = apperr.E("plan_changed", "套餐已更新，请重新选择方案", 409)
		}
		fail(c, err)
		return
	}
	if !created {
		// A concurrent checkout of this user created the order first, or an
		// upgrade quote already has its (single) order.
		if order.Status == "pending" {
			fail(c, apperr.E("payment_order_creating", "订单正在创建，请稍候", 409))
			return
		}
		fail(c, apperr.E("upgrade_quote_invalid", "升级报价已使用，请重新获取", 409))
		return
	}
	order, err = store.PrepareOrderPayment(ctx, s.St.Pool, order.ID, lanjingPaymentMethod(paymentType))
	if err != nil {
		fail(c, err)
		return
	}
	order, err = s.openLanjingPayment(ctx, client, order, paymentType)
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, orderDict(order))
}

func userUnsettledOrderError() error {
	return apperr.E("user_unsettled_order", "你有一笔未支付订单，请先完成支付，或在「我的订单」中取消后再下单", http.StatusConflict)
}

// orderMatchesCheckout reports whether a pending order is the same purchase
// the user is starting again, so its QR code can be shown instead of a new one.
func orderMatchesCheckout(order *store.Order, plan *store.Plan, paymentType lanjingpay.PaymentType, upgradeID *uuid.UUID) bool {
	if order.PlanID != plan.ID || order.AmountCents != plan.PriceCents || order.PaymentMethod == nil ||
		*order.PaymentMethod != lanjingPaymentMethod(paymentType) {
		return false
	}
	if (upgradeID == nil) != (order.SubscriptionChangeID == nil) || (upgradeID != nil && *upgradeID != *order.SubscriptionChangeID) {
		return false
	}
	return order.GrantCents == plan.GrantCents && order.BonusCents == plan.BonusCents
}

func (s *Server) listOrders(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && status != "unsettled" && status != "confirming" && !store.Contains(store.OrderStatuses, status) {
		fail(c, apperr.E("validation_error", "无效的订单状态", 422))
		return
	}
	query := strings.TrimSpace(c.Query("q"))
	if len([]rune(query)) > 100 {
		fail(c, apperr.E("validation_error", "搜索内容不能超过 100 个字符", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	rows, err := store.SearchUserOrders(ctx, s.St.Pool, user.ID, status, query, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	planIDs := make([]uuid.UUID, 0, len(rows))
	seenPlans := make(map[uuid.UUID]bool, len(rows))
	for _, order := range rows {
		if order.PlanKind == nil && !seenPlans[order.PlanID] {
			seenPlans[order.PlanID] = true
			planIDs = append(planIDs, order.PlanID)
		}
	}
	plans, err := store.GetPlansByIDs(ctx, s.St.Pool, planIDs)
	if err != nil {
		fail(c, err)
		return
	}
	summary, err := store.GetUserOrderSummary(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	page := buildPage(rows, limit, func(o *store.Order) gin.H {
		out := orderDict(o)
		if plan := plans[o.PlanID]; o.PlanKind == nil && plan != nil {
			out["planName"] = plan.Name
			out["planKind"] = plan.Kind
			out["durationDays"] = plan.DurationDays
			out["dailyGrantCents"] = plan.DailyGrantCents
		}
		return out
	})
	page["summary"] = summary
	ok(c, page)
}
func (s *Server) getOrder(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	orderID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	order, err := store.GetUserOrder(c.Request.Context(), s.St.Pool, user.ID, orderID)
	if err != nil {
		fail(c, err)
		return
	}
	if order == nil {
		fail(c, apperr.E("order_not_found", "订单不存在", 404))
		return
	}
	order = s.refreshUserOrder(c.Request.Context(), order)
	out := orderDict(order)
	if order.PlanKind == nil {
		if plan, planErr := store.GetPlan(c.Request.Context(), s.St.Pool, order.PlanID); planErr == nil && plan != nil {
			out["planName"], out["planKind"] = plan.Name, plan.Kind
			out["durationDays"], out["dailyGrantCents"] = plan.DurationDays, plan.DailyGrantCents
		}
	}
	ok(c, out)
}

func (s *Server) closeOrder(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	orderID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	order, err := store.GetUserOrder(ctx, s.St.Pool, user.ID, orderID)
	if err != nil {
		fail(c, err)
		return
	}
	if order == nil {
		fail(c, apperr.E("order_not_found", "订单不存在", 404))
		return
	}
	order, err = s.cancelLanjingOrder(ctx, order)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, orderDict(order))
}

// completeOrder 完成订单：任一未完成状态 → completed，同一事务内按套餐类型分叉——
// kind=topup 幂等入账 grant+bonus；kind=subscription 创建/顺延订阅并发放首日额度
// （ledger 不记录订阅本金，额度发放时逐日记）。
// 已 completed 的订单视为幂等重放，直接返回成功，不重复入账
// （ledger 幂等键 ('grant','order',order_id) 双保险）。
// 通知在事务提交后尽力而为（M4 解耦）。
// All completion paths share this transaction, including callbacks and reconciliation.
func (s *Server) completeOrder(ctx context.Context, order *store.Order) (*store.Order, error) {
	return s.completeOrderWithProof(ctx, order, false)
}

func (s *Server) completeVerifiedOrder(ctx context.Context, order *store.Order) (*store.Order, error) {
	return s.completeOrderWithProof(ctx, order, true)
}

func (s *Server) completeOrderWithProof(ctx context.Context, order *store.Order, verified bool) (*store.Order, error) {
	if order.Status == "completed" {
		return order, nil
	}
	plan, err := store.GetPlan(ctx, s.St.Pool, order.PlanID)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, apperr.E("plan_not_found", "套餐不存在", 404)
	}
	if order.PlanKind != nil {
		plan.Kind = *order.PlanKind
		plan.DurationDays = order.PlanDurationDays
		plan.DailyGrantCents = order.PlanDailyGrantCents
		if order.PlanName != nil {
			plan.Name = *order.PlanName
		}
	}
	if !verified && (order.Status == "cancelled" || order.Status == "failed") {
		// Only provider-confirmed payments may revive an order the user or the
		// provider closed.
		return nil, apperr.E("order_not_payable", "订单当前状态不可完成", 400)
	}
	if verified {
		// The receipt is committed on its own so a failed delivery below is
		// retried by the reconciler instead of being forgotten.
		if err := store.RecordOrderPayment(ctx, s.St.Pool, order.ID); err != nil {
			return nil, err
		}
	}
	var result *store.Order
	var sub *store.Subscription
	completedNow := false
	run := func() error {
		completedNow = false
		sub = nil
		return s.St.Tx(ctx, func(tx pgx.Tx) error {
			won, err := store.CompleteOrderUpdate(ctx, tx, order.ID, time.Now().UTC())
			if err != nil {
				return err
			}
			if !won {
				fresh, gerr := store.GetOrder(ctx, tx, order.ID)
				if gerr != nil {
					return gerr
				}
				if fresh != nil && fresh.Status == "completed" {
					result = fresh
					return nil
				}
				return apperr.E("order_not_payable", "订单当前状态不可完成", 400)
			}
			if plan.Kind == "subscription" {
				if order.SubscriptionChangeID != nil {
					sub, err = subscription.ApplyUpgrade(ctx, tx, order, s.subscriptionNow())
				} else {
					sub, err = subscription.ApplyOrder(ctx, tx, order, plan, s.subscriptionNow())
				}
				if err != nil {
					return err
				}
				if order.SubscriptionChangeID == nil {
					period, err := store.GetSubscriptionPeriodForOrder(ctx, tx, order.ID)
					if err != nil {
						return err
					}
					if period == nil {
						return fmt.Errorf("subscription period was not recorded")
					}
					if err := store.SetOrderSubscriptionPeriod(ctx, tx, order.ID, period.StartsAt, period.EndsAt); err != nil {
						return err
					}
				}
			} else {
				total := order.GrantCents + order.BonusCents
				reason := fmt.Sprintf("订单入账（含赠送 %d 积分）", order.BonusCents)
				if _, err := wallet.Grant(ctx, tx, order.UserID, total, "grant", "order", order.ID.String(), &reason); err != nil {
					return err
				}
				if err := store.RecordTopupCreditLot(ctx, tx, order); err != nil {
					return err
				}
				if verified && order.Provider == "lanjing" {
					if err := referral.Accrue(ctx, tx, order); err != nil {
						return err
					}
				}
			}
			fresh, err := store.GetOrder(ctx, tx, order.ID)
			if err != nil {
				return err
			}
			result = fresh
			completedNow = true
			return nil
		})
	}
	err = run()
	if err != nil && store.IsUniqueViolation(err, "uq_wallet_ledger_idem") {
		// 并发补单竞态：账本唯一键冲突 → 幂等重放（重试命中前置检查）
		err = run()
	}
	if err == nil && completedNow && !(plan.Kind == "subscription" && order.SubscriptionPolicy.Version == 2) {
		title, body := "充值到账", fmt.Sprintf("订单已完成，%d 积分已入账到你的钱包。", order.GrantCents+order.BonusCents)
		if plan.Kind == "subscription" && sub != nil {
			title = "订阅订单已确认"
			body = fmt.Sprintf("「%s」本次订阅每日 %d 分，按购买批次生效，有效期至 %s。",
				plan.Name, plan.DailyGrantCents, subscription.BeijingDate(sub.EndsAt))
		}
		if nerr := store.InsertNotificationWithSource(ctx, s.St.Pool, &order.UserID, "order", title, &body, "order", order.ID); nerr != nil {
			log.Printf("notify order %s completed: %v", order.ID, nerr)
		}
	}
	return result, err
}

// mySubscription 保留用于历史数据兼容；当前未注册 HTTP 路由。
func (s *Server) mySubscription(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	now := s.subscriptionNow()
	concurrency, err := store.GetUserConcurrency(store.WithBillingTime(ctx, now), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	sub, err := store.GetCurrentSubscription(ctx, s.St.Pool, user.ID, now)
	if err != nil {
		fail(c, err)
		return
	}
	if sub == nil {
		blocking, err := store.HasBlockingSubscription(ctx, s.St.Pool, user.ID, now)
		if err != nil {
			fail(c, err)
			return
		}
		ok(c, gin.H{"concurrency": concurrency, "active": false, "blockingPurchase": blocking, "planName": nil, "endsAt": nil, "dailyGrantCents": 0, "grantedToday": false})
		return
	}
	plan, err := store.GetPlan(ctx, s.St.Pool, sub.PlanID)
	if err != nil {
		fail(c, err)
		return
	}
	planName := ""
	if plan != nil {
		planName = plan.Name
	}
	if sub.PlanName != "" {
		planName = sub.PlanName
	}
	var next *time.Time
	if sub.BillingVersion == 2 {
		if err := s.St.Pool.QueryRow(ctx, `SELECT min(next_grant_at) FROM subscription_periods WHERE subscription_id=$1 AND closed_at IS NULL AND granted_count<total_grants AND NOT EXISTS(SELECT 1 FROM subscription_changes WHERE subscription_id=$1 AND kind='upgrade' AND status='pending' AND snapshot->>'upgradeMode'='restart')`, sub.ID).Scan(&next); err != nil {
			fail(c, err)
			return
		}
	}
	ok(c, gin.H{
		"id": sub.ID, "planId": sub.PlanID, "startsAt": sub.StartsAt, "billingVersion": sub.BillingVersion, "nextGrantAt": next, "policy": sub.Policy, "blockingPurchase": true,
		"concurrency":     concurrency,
		"contract":        sub.Contract,
		"active":          true,
		"planName":        planName,
		"endsAt":          isoValue(sub.EndsAt),
		"dailyGrantCents": sub.DailyGrantCents,
		"grantedToday":    subscription.GrantedOn(sub, subscription.BeijingDate(now)),
	})
}

type mockWebhookIn struct {
	OrderID string `json:"orderId"`
	Secret  string `json:"secret"`
}

func (s *Server) paymentWebhook(c *gin.Context) {
	if !s.Cfg.PaymentMockEnabled {
		fail(c, apperr.E("payment_unavailable", "支付渠道尚未配置", 503))
		return
	}
	if c.Param("provider") != "mock" {
		fail(c, apperr.E("not_found", "不支持的支付渠道", 404))
		return
	}
	var body mockWebhookIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	orderID, err := uuid.Parse(body.OrderID)
	if err != nil {
		fail(c, apperr.E("validation_error", "orderId: 无效的 UUID", 422))
		return
	}
	if !hmac.Equal([]byte(body.Secret), []byte(s.Cfg.PaymentWebhookSecret)) {
		fail(c, apperr.E("auth_required", "webhook 校验失败", 401))
		return
	}
	ctx := c.Request.Context()
	order, err := store.GetOrder(ctx, s.St.Pool, orderID)
	if err != nil {
		fail(c, err)
		return
	}
	if order == nil {
		fail(c, apperr.E("order_not_found", "订单不存在", 404))
		return
	}
	order, err = s.completeOrder(ctx, order)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, orderDict(order))
}
