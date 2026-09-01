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
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

var errProviderAdjustedAmount = errors.New("provider adjusted payment amount")

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
	existingOrders, err := store.ListPendingOrdersForPlan(ctx, s.St.Pool, user.ID, plan.ID)
	if err != nil {
		fail(c, err)
		return
	}
	var reusable *store.Order
	for _, existing := range existingOrders {
		if reusable == nil && orderMatchesCheckout(existing, plan, paymentType) {
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
	order, created, err := store.GetOrInsertPendingOrder(ctx, s.St, user.ID, plan.ID, plan.PriceCents,
		plan.GrantCents, plan.BonusCents, "lanjing")
	if err != nil {
		fail(c, err)
		return
	}
	if !created {
		if order.Provider != "lanjing" {
			fail(c, apperr.E("payment_order_conflict", "该套餐已有待支付订单，请先处理现有订单", 409))
			return
		}
		if order.ProviderOrderID == nil {
			fail(c, apperr.E("payment_order_creating", "该套餐订单正在创建，请稍后重试", 409))
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
		order, created, err = store.GetOrInsertPendingOrder(ctx, s.St, user.ID, plan.ID, plan.PriceCents,
			plan.GrantCents, plan.BonusCents, "lanjing")
		if err != nil {
			fail(c, err)
			return
		}
		if !created {
			fail(c, apperr.E("payment_order_creating", "该套餐订单正在创建，请稍后重试", 409))
			return
		}
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
	order, err = store.SetOrderProviderDetails(ctx, s.St.Pool, order.ID, remote.ProviderOrderID,
		payAmountCents, lanjingPaymentMethod(remote.Type), remote.PayURL, remote.IsAuto == 1, expiresAt)
	if err != nil {
		_ = client.CloseOrder(ctx, remote.ProviderOrderID)
		fail(c, err)
		return
	}
	respondCreated(c, lanjingOrderDict(order, remote))
}

func orderMatchesCheckout(order *store.Order, plan *store.Plan, paymentType lanjingpay.PaymentType) bool {
	if order == nil || plan == nil || order.Provider != "lanjing" || order.ProviderOrderID == nil ||
		order.AmountCents != plan.PriceCents || order.GrantCents != plan.GrantCents || order.BonusCents != plan.BonusCents ||
		expectedProviderPayAmount(order) != plan.PriceCents || order.PaymentMethod == nil {
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
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	rows, err := store.ListOrders(ctx, s.St.Pool, &user.ID, status, nil, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	planIDs := make([]uuid.UUID, 0, len(rows))
	seenPlans := make(map[uuid.UUID]bool, len(rows))
	for _, order := range rows {
		if !seenPlans[order.PlanID] {
			seenPlans[order.PlanID] = true
			planIDs = append(planIDs, order.PlanID)
		}
	}
	plans, err := store.GetPlansByIDs(ctx, s.St.Pool, planIDs)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(o *store.Order) gin.H {
		out := orderDict(o, nil)
		if plan := plans[o.PlanID]; plan != nil {
			out["planName"] = plan.Name
			out["planKind"] = plan.Kind
			out["durationDays"] = plan.DurationDays
			out["dailyGrantCents"] = plan.DailyGrantCents
		}
		return out
	}))
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
	if err := validateRemoteOrder(order, remote, false, false); err != nil {
		return order, remote, err
	}
	var expiresAt *time.Time
	if value := remote.ExpiresAt(); !value.IsZero() {
		expiresAt = &value
	}
	order, err = store.UpdateOrderPaymentDisplay(ctx, s.St.Pool, order.ID, remote.PayURL, remote.IsAuto == 1, expiresAt)
	if err != nil {
		return order, remote, err
	}
	confirmation, checkErr := client.CheckOrder(ctx, *order.ProviderOrderID)
	if checkErr == nil {
		if err := validatePaymentConfirmation(order, confirmation); err != nil {
			return order, remote, fmt.Errorf("invalid lanjing payment confirmation: %w", err)
		}
		completed, err := s.completeOrder(ctx, order)
		return completed, remote, err
	}
	if !isLanjingUnpaid(checkErr) {
		return order, remote, checkErr
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
		if _, err := store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "expired"); err != nil {
			return order, err
		}
		return store.GetOrder(ctx, s.St.Pool, order.ID)
	}
	client, _, configErr := s.resolveLanjingPay(ctx)
	if configErr != nil || client == nil || order.Provider != "lanjing" || order.ProviderOrderID == nil {
		return order, fmt.Errorf("payment provider unavailable")
	}
	if err := client.CloseOrder(ctx, *order.ProviderOrderID); err != nil {
		fresh, _, syncErr := s.syncLanjingOrder(ctx, order)
		if syncErr == nil && fresh != nil && (fresh.Status == "completed" || fresh.Status == "expired") {
			return fresh, nil
		}
		return order, err
	}
	if _, err := store.TransitionPendingOrderStatus(ctx, s.St.Pool, order.ID, "expired"); err != nil {
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
		_, _ = store.InsertPaymentCallbackEvent(context.Background(), s.St.Pool, fingerprint, orderID, providerOrderID,
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
	if _, err := s.completeOrder(ctx, order); err != nil {
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
