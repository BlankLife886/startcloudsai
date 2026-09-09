package httpapi

import (
	"context"
	"crypto/hmac"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
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
	for _, p := range plans {
		items = append(items, planDict(p, false))
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
		"items":           items,
		"baseConcurrency": baseConcurrency,
		"paymentEnabled":  client != nil && configErr == nil && len(methods) > 0,
		"paymentMethods":  methods,
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
	if plan.RechargePolicy != nil {
		if body.AmountYuan == nil || body.ExpectedPlanRevision == nil || body.UpgradeQuoteID != "" {
			fail(c, apperr.E("validation_error", "自定义充值须提供整数元金额及当前配置版本，不能用于订阅升级", 422))
			return
		}
		if *body.ExpectedPlanRevision != plan.Revision {
			fail(c, apperr.E("plan_changed", "充值规则已更新，请刷新后确认到账积分", 409))
			return
		}
		plan, err = store.QuoteRecharge(plan, *body.AmountYuan)
		if err != nil {
			fail(c, apperr.E("validation_error", err.Error(), 422))
			return
		}
	} else if body.AmountYuan != nil || (body.ExpectedPlanRevision != nil && (plan.Kind != "subscription" || body.UpgradeQuoteID != "")) {
		fail(c, apperr.E("validation_error", "该套餐不支持自定义充值金额", 422))
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
		if body.AmountYuan != nil {
			return store.GetOrInsertRechargeOrder(ctx, s.St, user.ID, plan.ID, *body.AmountYuan, *body.ExpectedPlanRevision, "lanjing")
		}
		if upgradeID != nil {
			return store.GetOrInsertUpgradeOrder(ctx, s.St, user.ID, *upgradeID, s.subscriptionNow())
		}
		if body.ExpectedPlanRevision != nil {
			return store.GetOrInsertPendingOrderAtRevision(ctx, s.St, user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "lanjing", *body.ExpectedPlanRevision, s.subscriptionNow())
		}
		return store.GetOrInsertPendingOrder(ctx, s.St, user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "lanjing", s.subscriptionNow())
	}
	existingOrders, err := store.ListPendingOrdersForUser(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	for _, existing := range existingOrders {
		if existing.RechargePolicy != nil && body.AmountYuan == nil {
			fail(c, userUnsettledOrderError())
			return
		}
		if body.AmountYuan != nil && (existing.RechargePolicy == nil || existing.AmountCents != plan.PriceCents) {
			fail(c, userUnsettledOrderError())
			return
		}
		if (upgradeID == nil) != (existing.SubscriptionChangeID == nil) || (upgradeID != nil && *upgradeID != *existing.SubscriptionChangeID) {
			fail(c, userUnsettledOrderError())
			return
		}
		if existing.PlanID != plan.ID {
			fail(c, userUnsettledOrderError())
			return
		}
	}
	var reusable *store.Order
	for _, existing := range existingOrders {
		if existing.Provider != "lanjing" {
			fail(c, apperr.E("payment_order_conflict", "该套餐存在其他渠道的待处理订单", 409))
			return
		}
		if existing.Status == "uncertain" || existing.Status == "paid" || existing.ProviderOrderID == nil {
			if existing.Status == "pending" {
				if err := store.MarkOrderUncertain(ctx, s.St.Pool, existing.ID); err != nil {
					fail(c, err)
					return
				}
				existing, err = store.GetOrder(ctx, s.St.Pool, existing.ID)
				if err != nil {
					fail(c, err)
					return
				}
			}
			out := orderDict(existing, nil)
			out["reused"] = true
			c.JSON(http.StatusAccepted, gin.H{"success": true, "data": out})
			return
		}
		if reusable == nil && (body.AmountYuan != nil || orderMatchesCheckout(existing, plan, paymentType)) {
			reusable = existing
		}
	}
	for _, existing := range existingOrders {
		if reusable != nil && existing.ID == reusable.ID {
			continue
		}
		if _, err := s.cancelPendingLanjingOrder(ctx, existing); err != nil {
			log.Printf("close duplicate lanjing order %s: %v", existing.ID, err)
			fail(c, apperr.E("payment_order_conflict", "该套餐存在无法自动关闭的待支付订单，请先在我的订单中取消", 409))
			return
		}
	}
	if reusable != nil {
		fresh, remote, syncErr := s.syncLanjingOrder(ctx, reusable)
		if syncErr != nil {
			log.Printf("sync reusable lanjing order %s: %v", reusable.ID, syncErr)
			fail(c, apperr.E("payment_provider_error", "现有待支付订单暂时无法读取，请稍后重试", 502))
			return
		}
		if fresh.Status == "pending" {
			out := lanjingOrderDict(fresh, remote)
			out["reused"] = true
			ok(c, out)
			return
		}
	}
	order, created, err := createPending()
	if err != nil {
		if errors.Is(err, store.ErrAlreadySubscribed) {
			err = apperr.E("subscription_exists", "已有有效订阅，请前往我的订阅管理", 409)
		}
		if errors.Is(err, store.ErrSubscriptionChangeInvalid) {
			err = apperr.E("upgrade_quote_invalid", "升级报价已失效，请重新获取", 409)
		}
		if errors.Is(err, store.ErrUserUnsettledOrder) {
			err = userUnsettledOrderError()
		}
		if errors.Is(err, store.ErrOrderPlanChanged) {
			err = apperr.E("plan_changed", "套餐已更新，请重新选择方案", 409)
		}
		fail(c, err)
		return
	}
	if !created {
		if upgradeID != nil && store.Contains([]string{"completed", "cancelled", "expired", "failed"}, order.Status) {
			ok(c, orderDict(order, nil))
			return
		}
		if order.Provider != "lanjing" {
			fail(c, apperr.E("payment_order_conflict", "该套餐已有待支付订单，请先处理现有订单", 409))
			return
		}
		if order.ProviderOrderID == nil {
			if err := store.MarkOrderUncertain(ctx, s.St.Pool, order.ID); err != nil {
				fail(c, err)
				return
			}
			fresh, err := store.GetOrder(ctx, s.St.Pool, order.ID)
			if err != nil {
				fail(c, err)
				return
			}
			c.JSON(http.StatusAccepted, gin.H{"success": true, "data": orderDict(fresh, nil)})
			return
		}
		fresh, remote, syncErr := s.syncLanjingOrder(ctx, order)
		if syncErr != nil {
			log.Printf("sync existing lanjing order %s: %v", order.ID, syncErr)
			if order.ProviderPayURL != nil {
				out := orderDict(order, nil)
				out["reused"] = true
				ok(c, out)
				return
			}
			fail(c, apperr.E("payment_provider_error", "现有待支付订单暂时无法读取，请稍后重试", 502))
			return
		}
		if fresh.Status == "pending" {
			var out gin.H
			if remote != nil {
				out = lanjingOrderDict(fresh, remote)
			} else {
				out = orderDict(fresh, nil)
			}
			out["reused"] = true
			ok(c, out)
			return
		}
		order, created, err = createPending()
		if err != nil {
			if errors.Is(err, store.ErrAlreadySubscribed) {
				err = apperr.E("subscription_exists", "已有有效订阅，请前往我的订阅管理", 409)
			}
			if errors.Is(err, store.ErrSubscriptionChangeInvalid) {
				err = apperr.E("upgrade_quote_invalid", "升级报价已失效，请重新获取", 409)
			}
			if errors.Is(err, store.ErrUserUnsettledOrder) {
				err = userUnsettledOrderError()
			}
			if errors.Is(err, store.ErrOrderPlanChanged) {
				err = apperr.E("plan_changed", "套餐已更新，请重新选择方案", 409)
			}
			fail(c, err)
			return
		}
		if !created {
			fail(c, apperr.E("payment_order_creating", "该套餐订单正在创建，请稍后重试", 409))
			return
		}
	}
	order, err = store.PrepareOrderPayment(ctx, s.St.Pool, order.ID, lanjingPaymentMethod(paymentType))
	if err != nil {
		fail(c, err)
		return
	}
	remote, err := client.CreateOrder(ctx, lanjingpay.CreateOrderInput{
		MerchantOrderID: order.ID.String(),
		Param:           order.ID.String(),
		Type:            paymentType,
		AmountCents:     order.AmountCents,
	})
	if err != nil {
		log.Printf("create lanjing payment for order %s: %v", order.ID, err)
		c.JSON(http.StatusAccepted, gin.H{"success": true, "data": orderDict(order, nil)})
		return
	}
	if err := validateRemoteOrder(order, remote, true, true); err != nil {
		_ = client.CloseOrder(ctx, remote.ProviderOrderID)
		_, _ = store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "failed")
		log.Printf("invalid lanjing payment response for order %s: %v", order.ID, err)
		if errors.Is(err, errProviderAdjustedAmount) {
			fail(c, apperr.E("payment_amount_conflict", "当前金额已有待支付订单，支付渠道无法保持套餐标价，请稍后重试", 409))
			return
		}
		fail(c, apperr.E("payment_provider_error", "支付渠道返回异常，请稍后重试", 502))
		return
	}
	if remote.Type != paymentType {
		_ = client.CloseOrder(ctx, remote.ProviderOrderID)
		_, _ = store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "failed")
		log.Printf("invalid lanjing payment type for order %s: requested=%d returned=%d", order.ID, paymentType, remote.Type)
		fail(c, apperr.E("payment_provider_error", "支付渠道返回异常，请稍后重试", 502))
		return
	}
	payAmountCents, _ := remote.ReallyPriceCents()
	var expiresAt *time.Time
	if value := remote.ExpiresAt(); !value.IsZero() {
		expiresAt = &value
	}
	persistCtx, persistCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer persistCancel()
	updated, err := store.SetOrderProviderDetails(persistCtx, s.St.Pool, order.ID, remote.ProviderOrderID,
		payAmountCents, lanjingPaymentMethod(remote.Type), remote.PayURL, remote.IsAuto == 1, expiresAt)
	if err != nil {
		log.Printf("persist lanjing payment for order %s: %v", order.ID, err)
		c.JSON(http.StatusAccepted, gin.H{"success": true, "data": orderDict(order, nil)})
		return
	}
	respondCreated(c, lanjingOrderDict(updated, remote))
}

func userUnsettledOrderError() error {
	return apperr.E("user_unsettled_order", "你已有一笔待处理订单，请先在「我的订单」中完成支付或取消；待核实或到账确认中的订单需等待处理完成", http.StatusConflict)
}

func orderMatchesCheckout(order *store.Order, plan *store.Plan, paymentType lanjingpay.PaymentType) bool {
	if order == nil || plan == nil || order.Provider != "lanjing" || order.ProviderOrderID == nil ||
		order.AmountCents != plan.PriceCents || order.GrantCents != plan.GrantCents || order.BonusCents != plan.BonusCents ||
		expectedProviderPayAmount(order) != plan.PriceCents || order.PaymentMethod == nil {
		return false
	}
	if order.PlanKind != nil && (*order.PlanKind != plan.Kind || order.PlanDurationDays != plan.DurationDays || order.PlanDailyGrantCents != plan.DailyGrantCents) {
		return false
	}
	return *order.PaymentMethod == lanjingPaymentMethod(paymentType)
}

func (s *Server) resolveLanjingPay(ctx context.Context) (*lanjingpay.Client, settings.LanjingPayConfig, error) {
	if s.LanjingPay != nil {
		return s.LanjingPay, settings.LanjingPayConfig{
			Enabled: true, AlipayEnabled: true, WechatEnabled: true,
		}, nil
	}
	if s.Cfg == nil || s.St == nil {
		return nil, settings.LanjingPayConfig{}, nil
	}
	env := settings.LanjingPayConfig{
		Enabled:       s.Cfg.LanjingPayEnabled(),
		BaseURL:       s.Cfg.LanjingPayBaseURL,
		Secret:        s.Cfg.LanjingPaySecret,
		NotifyURL:     s.Cfg.LanjingPayNotifyURL,
		TimeoutSecs:   s.Cfg.LanjingPayTimeoutSecs,
		AlipayEnabled: true,
		WechatEnabled: true,
	}
	resolved, err := settings.ResolveLanjingPay(ctx, s.St.Pool, env, s.Cfg.AppSecret)
	if err != nil || !resolved.Enabled {
		return nil, resolved, err
	}
	if resolved.Secret == "" || resolved.NotifyURL == "" || resolved.BaseURL == "" {
		return nil, resolved, fmt.Errorf("enabled payment configuration is incomplete")
	}
	client, err := lanjingpay.New(
		resolved.BaseURL,
		resolved.Secret,
		resolved.NotifyURL,
		time.Duration(resolved.TimeoutSecs)*time.Second,
		s.Cfg.AppEnv != "production",
	)
	return client, resolved, err
}

func (s *Server) listOrders(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && !store.Contains(store.OrderStatuses, status) {
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
		out := orderDict(o, nil)
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
	fresh, remote, err := s.syncLanjingOrder(c.Request.Context(), order)
	if fresh != nil {
		order = fresh
	}
	out := orderDict(order, nil)
	if err != nil {
		log.Printf("sync lanjing order %s: %v", order.ID, err)
		out["syncError"] = "支付渠道暂时无法确认状态，请稍后刷新"
	} else if remote != nil {
		out = lanjingOrderDict(order, remote)
	}
	if order.PlanKind == nil {
		if plan, planErr := store.GetPlan(c.Request.Context(), s.St.Pool, order.PlanID); planErr == nil && plan != nil {
			out["planName"], out["planKind"] = plan.Name, plan.Kind
			out["durationDays"], out["dailyGrantCents"] = plan.DurationDays, plan.DailyGrantCents
		}
	}
	ok(c, out)
}

func parseLanjingPaymentType(method string) (lanjingpay.PaymentType, error) {
	switch strings.ToLower(strings.TrimSpace(method)) {
	case "wechat":
		return lanjingpay.Wechat, nil
	case "alipay":
		return lanjingpay.Alipay, nil
	default:
		return 0, apperr.E("validation_error", "paymentMethod: 仅支持 alipay 或 wechat", 422)
	}
}

func lanjingPaymentMethod(paymentType lanjingpay.PaymentType) string {
	switch paymentType {
	case lanjingpay.Wechat:
		return "wechat"
	case lanjingpay.Alipay:
		return "alipay"
	default:
		return ""
	}
}

func expectedProviderPayAmount(order *store.Order) int64 {
	if order.ProviderPayAmountCents != nil {
		return *order.ProviderPayAmountCents
	}
	return order.AmountCents
}

func validateRemoteOrder(order *store.Order, remote *lanjingpay.Order, requirePayURL, requireExactAmount bool) error {
	if remote == nil || remote.ProviderOrderID == "" || (requirePayURL && remote.PayURL == "") {
		return fmt.Errorf("missing provider order data")
	}
	if remote.MerchantOrderID != order.ID.String() {
		return fmt.Errorf("merchant order mismatch")
	}
	if order.ProviderOrderID != nil && remote.ProviderOrderID != *order.ProviderOrderID {
		return fmt.Errorf("provider order mismatch")
	}
	priceCents, err := remote.PriceCents()
	if err != nil || priceCents != order.AmountCents {
		return fmt.Errorf("price mismatch")
	}
	payAmountCents, err := remote.ReallyPriceCents()
	if err != nil || payAmountCents <= 0 {
		return fmt.Errorf("invalid paid amount")
	}
	if requireExactAmount && payAmountCents != order.AmountCents {
		return fmt.Errorf("%w: expected %d, got %d", errProviderAdjustedAmount, order.AmountCents, payAmountCents)
	}
	paymentMethod := lanjingPaymentMethod(remote.Type)
	if paymentMethod == "" {
		return fmt.Errorf("invalid payment type")
	}
	if order.ProviderPayAmountCents != nil && payAmountCents != *order.ProviderPayAmountCents {
		return fmt.Errorf("paid amount mismatch")
	}
	if order.PaymentMethod != nil && paymentMethod != *order.PaymentMethod {
		return fmt.Errorf("payment type mismatch")
	}
	if remote.IsAuto != 0 && remote.IsAuto != 1 {
		return fmt.Errorf("invalid manual amount flag")
	}
	if remote.State < -1 || remote.State > 2 {
		return fmt.Errorf("invalid provider state")
	}
	if requirePayURL && remote.State != 0 {
		return fmt.Errorf("new provider order is not pending")
	}
	return nil
}

func validatePaymentConfirmation(order *store.Order, confirmation *lanjingpay.PaymentConfirmation) error {
	if confirmation == nil || confirmation.MerchantOrderID != order.ID.String() || confirmation.Param != order.ID.String() {
		return fmt.Errorf("merchant order mismatch")
	}
	paymentMethod := lanjingPaymentMethod(confirmation.Type)
	if paymentMethod == "" || (order.PaymentMethod != nil && paymentMethod != *order.PaymentMethod) {
		return fmt.Errorf("payment type mismatch")
	}
	priceCents, err := lanjingpay.ParseCents(confirmation.Price)
	if err != nil || priceCents != order.AmountCents {
		return fmt.Errorf("price mismatch")
	}
	paidAmountCents, err := lanjingpay.ParseCents(confirmation.ReallyPrice)
	if err != nil || paidAmountCents != expectedProviderPayAmount(order) {
		return fmt.Errorf("paid amount mismatch")
	}
	return nil
}

func isLanjingUnpaid(err error) bool {
	var apiErr *lanjingpay.APIError
	return errors.As(err, &apiErr) && apiErr.Code == -1
}

func lanjingOrderDict(order *store.Order, remote *lanjingpay.Order) gin.H {
	payURL := remote.PayURL
	out := orderDict(order, &payURL)
	out["providerOrderId"] = remote.ProviderOrderID
	out["paymentMethod"] = lanjingPaymentMethod(remote.Type)
	if cents, err := remote.ReallyPriceCents(); err == nil {
		out["payAmountCents"] = cents
	}
	if remote.IsAuto == 0 || remote.IsAuto == 1 {
		out["requiresManualAmount"] = remote.IsAuto == 1
	}
	out["providerState"] = remote.State
	if expiresAt := remote.ExpiresAt(); !expiresAt.IsZero() {
		out["expiresAt"] = isoValue(expiresAt)
	}
	return out
}

func (s *Server) syncLanjingOrder(ctx context.Context, order *store.Order) (*store.Order, *lanjingpay.Order, error) {
	if order.Provider != "lanjing" || order.ProviderOrderID == nil || (order.Status != "pending" && order.Status != "paid" && order.Status != "uncertain") {
		return order, nil, nil
	}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		if err == nil {
			err = fmt.Errorf("payment provider unavailable")
		}
		return order, nil, err
	}
	remote, err := client.GetOrder(ctx, *order.ProviderOrderID)
	if err != nil {
		return order, nil, err
	}
	if err := validateRemoteOrder(order, remote, false, false); err != nil {
		return order, remote, err
	}
	var expiresAt *time.Time
	if value := remote.ExpiresAt(); !value.IsZero() {
		expiresAt = &value
	}
	updated, err := store.UpdateOrderPaymentDisplay(ctx, s.St.Pool, order.ID, remote.PayURL, remote.IsAuto == 1, expiresAt)
	if err != nil {
		return order, remote, err
	}
	order = updated
	confirmation, checkErr := client.CheckOrder(ctx, *order.ProviderOrderID)
	if checkErr == nil {
		if err := validatePaymentConfirmation(order, confirmation); err != nil {
			return order, remote, fmt.Errorf("invalid lanjing payment confirmation: %w", err)
		}
		completed, err := s.completeVerifiedOrder(ctx, order)
		return completed, remote, err
	}
	if !isLanjingUnpaid(checkErr) {
		return order, remote, checkErr
	}
	switch remote.State {
	case 1, 2:
		completed, err := s.completeVerifiedOrder(ctx, order)
		return completed, remote, err
	case -1:
		if _, err := store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "expired"); err != nil {
			return order, remote, err
		}
		fresh, err := store.GetOrder(ctx, s.St.Pool, order.ID)
		return fresh, remote, err
	default:
		return order, remote, nil
	}
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
	if order.Status == "uncertain" {
		fail(c, apperr.E("payment_verification_pending", "支付结果正在核实，暂不能取消或重复下单", 409))
		return
	}
	if order.Status != "pending" {
		ok(c, orderDict(order, nil))
		return
	}
	order, err = s.cancelPendingLanjingOrder(ctx, order)
	if err != nil {
		log.Printf("close lanjing order %s: %v", orderID, err)
		fail(c, apperr.E("payment_provider_error", "订单暂时无法关闭，请稍后重试", 502))
		return
	}
	ok(c, orderDict(order, nil))
}

func (s *Server) cancelPendingLanjingOrder(ctx context.Context, order *store.Order) (*store.Order, error) {
	if order == nil || order.Status != "pending" {
		return order, nil
	}
	if order.Provider == "lanjing" && order.ProviderOrderID == nil {
		if _, err := store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "cancelled"); err != nil {
			return order, err
		}
		return store.GetOrder(ctx, s.St.Pool, order.ID)
	}
	client, _, configErr := s.resolveLanjingPay(ctx)
	if configErr != nil || client == nil || order.Provider != "lanjing" || order.ProviderOrderID == nil {
		return order, fmt.Errorf("payment provider unavailable")
	}
	if closeErr := client.CloseOrder(ctx, *order.ProviderOrderID); closeErr != nil {
		confirmation, checkErr := client.CheckOrder(ctx, *order.ProviderOrderID)
		if checkErr == nil {
			if err := validatePaymentConfirmation(order, confirmation); err != nil {
				return order, fmt.Errorf("invalid lanjing payment confirmation: %w", err)
			}
			return s.completeVerifiedOrder(ctx, order)
		}
		fresh, _, syncErr := s.syncLanjingOrder(ctx, order)
		if syncErr == nil && fresh != nil && (fresh.Status == "completed" || fresh.Status == "expired") {
			return fresh, nil
		}
		if lanjingpay.IsTerminalOrderError(closeErr) || lanjingpay.IsTerminalOrderError(checkErr) ||
			lanjingpay.IsTerminalOrderError(syncErr) {
			if _, err := store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "expired"); err != nil {
				return order, err
			}
			return store.GetOrder(ctx, s.St.Pool, order.ID)
		}
		return order, closeErr
	}
	if _, err := store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "cancelled"); err != nil {
		return order, err
	}
	return store.GetOrder(ctx, s.St.Pool, order.ID)
}

func (s *Server) lanjingPaymentNotify(c *gin.Context) {
	if s.UsageLimiter != nil {
		_, allowed, err := s.UsageLimiter.Take(c.Request.Context(), "payment-callback-ip", c.ClientIP(), 120, 1, time.Minute)
		if err != nil {
			c.String(http.StatusServiceUnavailable, "callback_protection_unavailable")
			return
		}
		if !allowed {
			c.Header("Retry-After", "60")
			c.String(http.StatusTooManyRequests, "rate_limited")
			return
		}
	}
	payID := strings.TrimSpace(c.Query("payId"))
	param := strings.TrimSpace(c.Query("param"))
	paymentType := strings.TrimSpace(c.Query("type"))
	price := strings.TrimSpace(c.Query("price"))
	reallyPrice := strings.TrimSpace(c.Query("reallyPrice"))
	signature := strings.TrimSpace(c.Query("sign"))
	fingerprint := paymentCallbackFingerprint(payID, param, paymentType, price, reallyPrice, signature)
	outcome, detail := "invalid_request", ""
	var orderID *uuid.UUID
	var providerOrderID string
	var amountCents, paidAmountCents *int64
	signatureValid := false
	defer func() {
		auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = store.InsertPaymentCallbackEvent(auditCtx, s.St.Pool, fingerprint, orderID, providerOrderID,
			amountCents, paidAmountCents, c.ClientIP(), signatureValid, outcome, detail)
	}()
	client, _, err := s.resolveLanjingPay(c.Request.Context())
	if err != nil || client == nil {
		outcome, detail = "provider_unavailable", "支付配置不可用"
		c.String(http.StatusServiceUnavailable, "payment_unavailable")
		return
	}
	if payID == "" || param == "" || price == "" || reallyPrice == "" || signature == "" {
		c.String(http.StatusBadRequest, "invalid_request")
		return
	}
	parsedPaymentType, err := strconv.Atoi(paymentType)
	callbackPaymentMethod := lanjingPaymentMethod(lanjingpay.PaymentType(parsedPaymentType))
	if err != nil || callbackPaymentMethod == "" {
		outcome = "invalid_type"
		c.String(http.StatusBadRequest, "invalid_type")
		return
	}
	signatureValid = client.VerifyCallback(payID, param, paymentType, price, reallyPrice, signature)
	if !signatureValid {
		outcome = "invalid_signature"
		c.String(http.StatusUnauthorized, "error_sign")
		return
	}
	parsedOrderID, err := uuid.Parse(payID)
	if err != nil || param != payID {
		outcome = "invalid_order"
		c.String(http.StatusBadRequest, "invalid_order")
		return
	}
	orderID = &parsedOrderID
	priceCents, err := lanjingpay.ParseCents(price)
	if err != nil {
		outcome = "invalid_price"
		c.String(http.StatusBadRequest, "invalid_price")
		return
	}
	amountCents = &priceCents
	reallyPriceCents, err := lanjingpay.ParseCents(reallyPrice)
	if err != nil || reallyPriceCents <= 0 {
		outcome = "invalid_paid_amount"
		c.String(http.StatusBadRequest, "invalid_really_price")
		return
	}
	paidAmountCents = &reallyPriceCents
	ctx := c.Request.Context()
	order, err := store.GetOrder(ctx, s.St.Pool, parsedOrderID)
	if err != nil {
		outcome, detail = "database_error", err.Error()
		log.Printf("read callback order %s: %v", payID, err)
		c.String(http.StatusInternalServerError, "error")
		return
	}
	if order == nil || order.Provider != "lanjing" || order.AmountCents != priceCents {
		outcome = "order_mismatch"
		c.String(http.StatusBadRequest, "invalid_order")
		return
	}
	if order.ProviderOrderID != nil {
		providerOrderID = *order.ProviderOrderID
	}
	if order.PaymentMethod != nil && callbackPaymentMethod != *order.PaymentMethod {
		outcome, detail = "payment_method_mismatch", "支付渠道与订单不一致"
		s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &order.UserID, ClientIP: c.ClientIP(),
			Category: "payment_method_mismatch", Severity: "critical", Score: 100, Action: "blocked",
			Reason: detail, Metadata: map[string]any{"orderId": order.ID.String(), "expected": *order.PaymentMethod, "actual": callbackPaymentMethod}})
		c.String(http.StatusBadRequest, "invalid_type")
		return
	}
	expectedPayAmountCents := expectedProviderPayAmount(order)
	if reallyPriceCents != expectedPayAmountCents {
		outcome, detail = "amount_mismatch", "实付金额与订单金额不一致"
		s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &order.UserID, ClientIP: c.ClientIP(),
			Category: "payment_amount_mismatch", Severity: "critical", Score: 100, Action: "blocked",
			Reason: detail, Metadata: map[string]any{"orderId": order.ID.String(), "expected": expectedPayAmountCents, "paid": reallyPriceCents}})
		c.String(http.StatusBadRequest, "invalid_really_price")
		return
	}
	settleCtx, settleCancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer settleCancel()
	if _, err := s.completeVerifiedOrder(settleCtx, order); err != nil {
		outcome, detail = "completion_failed", err.Error()
		log.Printf("complete callback order %s: %v", payID, err)
		c.String(http.StatusInternalServerError, "error")
		return
	}
	outcome, detail = "completed", ""
	c.String(http.StatusOK, "success")
}

// completeOrder 完成订单：pending/paid → completed，同一事务内按套餐类型分叉——
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
	var result *store.Order
	var sub *store.Subscription
	completedNow := false
	run := func() error {
		completedNow = false
		sub = nil
		return s.St.Tx(ctx, func(tx pgx.Tx) error {
			if verified {
				if err := store.MarkOrderPaymentVerified(ctx, tx, order.ID); err != nil {
					return err
				}
			}
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
	ok(c, orderDict(order, nil))
}
