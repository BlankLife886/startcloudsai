package httpapi

import (
	"context"
	"crypto/hmac"
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
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func (s *Server) listPlans(c *gin.Context) {
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
		"items":          items,
		"paymentEnabled": client != nil && configErr == nil && len(methods) > 0,
		"paymentMethods": methods,
	})
}

type orderCreateIn struct {
	PlanID        string `json:"planId"`
	PaymentMethod string `json:"paymentMethod"`
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
	order, err := store.InsertOrder(ctx, s.St.Pool, user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "lanjing")
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
		_, _ = store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "failed")
		log.Printf("create lanjing payment for order %s: %v", order.ID, err)
		fail(c, apperr.E("payment_provider_error", "支付渠道暂时不可用，请稍后重试", 502))
		return
	}
	if err := validateRemoteOrder(order, remote); err != nil {
		_ = client.CloseOrder(ctx, remote.ProviderOrderID)
		_, _ = store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "failed")
		log.Printf("invalid lanjing payment response for order %s: %v", order.ID, err)
		fail(c, apperr.E("payment_provider_error", "支付渠道返回异常，请稍后重试", 502))
		return
	}
	order, err = store.SetOrderProviderID(ctx, s.St.Pool, order.ID, remote.ProviderOrderID)
	if err != nil {
		_ = client.CloseOrder(ctx, remote.ProviderOrderID)
		fail(c, err)
		return
	}
	respondCreated(c, lanjingOrderDict(order, remote))
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
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListOrders(c.Request.Context(), s.St.Pool, &user.ID, "", nil, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(o *store.Order) gin.H { return orderDict(o, nil) }))
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
	order, remote, err := s.syncLanjingOrder(c.Request.Context(), order)
	if err != nil {
		log.Printf("sync lanjing order %s: %v", order.ID, err)
	}
	if remote != nil {
		ok(c, lanjingOrderDict(order, remote))
		return
	}
	ok(c, orderDict(order, nil))
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

func validateRemoteOrder(order *store.Order, remote *lanjingpay.Order) error {
	if remote == nil || remote.ProviderOrderID == "" || remote.PayURL == "" {
		return fmt.Errorf("missing provider order data")
	}
	if remote.MerchantOrderID != order.ID.String() {
		return fmt.Errorf("merchant order mismatch")
	}
	priceCents, err := remote.PriceCents()
	if err != nil || priceCents != order.AmountCents {
		return fmt.Errorf("price mismatch")
	}
	return nil
}

func lanjingOrderDict(order *store.Order, remote *lanjingpay.Order) gin.H {
	payURL := remote.PayURL
	out := orderDict(order, &payURL)
	out["providerOrderId"] = remote.ProviderOrderID
	out["paymentMethod"] = map[lanjingpay.PaymentType]string{
		lanjingpay.Wechat: "wechat",
		lanjingpay.Alipay: "alipay",
	}[remote.Type]
	if cents, err := remote.ReallyPriceCents(); err == nil {
		out["payAmountCents"] = cents
	}
	out["requiresManualAmount"] = remote.IsAuto == 1
	out["providerState"] = remote.State
	if expiresAt := remote.ExpiresAt(); !expiresAt.IsZero() {
		out["expiresAt"] = isoValue(expiresAt)
	}
	return out
}

func (s *Server) syncLanjingOrder(ctx context.Context, order *store.Order) (*store.Order, *lanjingpay.Order, error) {
	if order.Provider != "lanjing" || order.ProviderOrderID == nil || order.Status != "pending" {
		return order, nil, nil
	}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		return order, nil, err
	}
	remote, err := client.GetOrder(ctx, *order.ProviderOrderID)
	if err != nil {
		return order, nil, err
	}
	if err := validateRemoteOrder(order, remote); err != nil {
		return order, remote, err
	}
	switch remote.State {
	case 1, 2:
		completed, err := s.completeOrder(ctx, order)
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
	if order.Status != "pending" {
		ok(c, orderDict(order, nil))
		return
	}
	client, _, configErr := s.resolveLanjingPay(ctx)
	if configErr != nil || client == nil || order.Provider != "lanjing" || order.ProviderOrderID == nil {
		fail(c, apperr.E("payment_unavailable", "支付渠道尚未配置", 503))
		return
	}
	if err := client.CloseOrder(ctx, *order.ProviderOrderID); err != nil {
		fresh, _, syncErr := s.syncLanjingOrder(ctx, order)
		if syncErr == nil && fresh != nil && fresh.Status == "completed" {
			ok(c, orderDict(fresh, nil))
			return
		}
		log.Printf("close lanjing order %s: %v", order.ID, err)
		fail(c, apperr.E("payment_provider_error", "订单暂时无法关闭，请稍后重试", 502))
		return
	}
	if _, err := store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "expired"); err != nil {
		fail(c, err)
		return
	}
	order, err = store.GetOrder(ctx, s.St.Pool, order.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, orderDict(order, nil))
}

func (s *Server) lanjingPaymentNotify(c *gin.Context) {
	client, _, err := s.resolveLanjingPay(c.Request.Context())
	if err != nil || client == nil {
		c.String(http.StatusServiceUnavailable, "payment_unavailable")
		return
	}
	payID := strings.TrimSpace(c.Query("payId"))
	param := strings.TrimSpace(c.Query("param"))
	paymentType := strings.TrimSpace(c.Query("type"))
	price := strings.TrimSpace(c.Query("price"))
	reallyPrice := strings.TrimSpace(c.Query("reallyPrice"))
	signature := strings.TrimSpace(c.Query("sign"))
	if payID == "" || param == "" || price == "" || reallyPrice == "" || signature == "" {
		c.String(http.StatusBadRequest, "invalid_request")
		return
	}
	if paymentType != strconv.Itoa(int(lanjingpay.Wechat)) && paymentType != strconv.Itoa(int(lanjingpay.Alipay)) {
		c.String(http.StatusBadRequest, "invalid_type")
		return
	}
	if !client.VerifyCallback(payID, param, paymentType, price, reallyPrice, signature) {
		c.String(http.StatusUnauthorized, "error_sign")
		return
	}
	orderID, err := uuid.Parse(payID)
	if err != nil || param != payID {
		c.String(http.StatusBadRequest, "invalid_order")
		return
	}
	priceCents, err := lanjingpay.ParseCents(price)
	if err != nil {
		c.String(http.StatusBadRequest, "invalid_price")
		return
	}
	reallyPriceCents, err := lanjingpay.ParseCents(reallyPrice)
	if err != nil || reallyPriceCents <= 0 {
		c.String(http.StatusBadRequest, "invalid_really_price")
		return
	}
	ctx := c.Request.Context()
	order, err := store.GetOrder(ctx, s.St.Pool, orderID)
	if err != nil {
		log.Printf("read callback order %s: %v", payID, err)
		c.String(http.StatusInternalServerError, "error")
		return
	}
	if order == nil || order.Provider != "lanjing" || order.AmountCents != priceCents {
		c.String(http.StatusBadRequest, "invalid_order")
		return
	}
	if _, err := s.completeOrder(ctx, order); err != nil {
		log.Printf("complete callback order %s: %v", payID, err)
		c.String(http.StatusInternalServerError, "error")
		return
	}
	c.String(http.StatusOK, "success")
}

// completeOrder 完成订单：pending/paid → completed，同一事务内按套餐类型分叉——
// kind=topup 幂等入账 grant+bonus；kind=subscription 创建/顺延订阅并发放首日额度
// （ledger 不记录订阅本金，额度发放时逐日记）。
// 已 completed 的订单视为幂等重放，直接返回成功，不重复入账
// （ledger 幂等键 ('grant','order',order_id) 双保险）。
// 通知在事务提交后尽力而为（M4 解耦）。
// 当前没有 HTTP 路由暴露支付或补单；此函数只用于历史数据兼容和迁移测试。
func (s *Server) completeOrder(ctx context.Context, order *store.Order) (*store.Order, error) {
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
				sub, err = subscription.ApplyOrder(ctx, tx, order, plan, time.Now().UTC())
				if err != nil {
					return err
				}
			} else {
				total := order.GrantCents + order.BonusCents
				reason := fmt.Sprintf("订单入账（含赠送 %d 分）", order.BonusCents)
				if _, err := wallet.Grant(ctx, tx, order.UserID, total, "grant", "order", order.ID.String(), &reason); err != nil {
					return err
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
	if err == nil && completedNow {
		title, body := "充值到账", fmt.Sprintf("订单已完成，%d 分已入账到你的钱包。", order.GrantCents+order.BonusCents)
		if plan.Kind == "subscription" && sub != nil {
			title = "订阅开通成功"
			body = fmt.Sprintf("「%s」订阅已生效，每日发放 %d 分，有效期至 %s。",
				plan.Name, sub.DailyGrantCents, subscription.BeijingDate(sub.EndsAt))
		}
		if nerr := store.InsertNotification(ctx, s.St.Pool, &order.UserID, "order", title, &body); nerr != nil {
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
	now := time.Now().UTC()
	sub, err := store.GetCurrentSubscription(ctx, s.St.Pool, user.ID, now)
	if err != nil {
		fail(c, err)
		return
	}
	if sub == nil {
		ok(c, gin.H{"active": false, "planName": nil, "endsAt": nil, "dailyGrantCents": 0, "grantedToday": false})
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
	ok(c, gin.H{
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
