package httpapi

// Lanjing (V免签-style) payment integration.
//
// Order lifecycle (orders.status):
//
//	pending ──provider paid──▶ completed
//	   │
//	   ├─ provider expired / unknown ─▶ expired
//	   ├─ user cancelled ─────────────▶ cancelled
//	   └─ provider order not created ─▶ failed
//
// paid_at records provider-confirmed payment independently of status. A paid
// order that is not completed yet is "confirming" and the reconciler retries
// delivery. A verified payment completes an order from any closed status too,
// so a late payment is never lost.
//
// Only fixed-amount QR codes are supported: the provider must return
// reallyPrice == price and isAuto == 0. When another order already holds the
// same amount the provider adjusts reallyPrice; that checkout is closed and the
// user is asked to retry later.
//
// Payment is confirmed by the signed async callback, and as a fallback by
// /getOrder lookups (provider state 1 or 2) from the user's polling and the
// background reconciler.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	// A pending order without a bound provider order is abandoned after this.
	unboundOrderTimeout = 2 * time.Minute
	// Used when the provider omits the order timestamp or timeout.
	defaultProviderOrderTTL = 5 * time.Minute
	// A pending order is not reused when its QR code expires sooner than this.
	minReusableQRTime = 30 * time.Second
	// User-triggered provider lookups for one order are at most this frequent.
	userCheckInterval = 3 * time.Second
	// Closed orders keep being checked for late payments for this long.
	latePaymentWindow = 25 * time.Hour
)

// paymentAnomaly is a provider answer that contradicts the local order. It is
// never repaired automatically and is surfaced to administrators.
type paymentAnomaly struct{ reason string }

func (e *paymentAnomaly) Error() string { return e.reason }

func isPaymentAnomaly(err error) bool {
	var anomaly *paymentAnomaly
	return errors.As(err, &anomaly)
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

// paymentQRAvailable reports whether the order's QR code may still be paid.
func paymentQRAvailable(order *store.Order, now time.Time, margin time.Duration) bool {
	return order.Status == "pending" && order.PaidAt == nil && order.ProviderOrderID != nil &&
		order.ProviderPayURL != nil && strings.TrimSpace(*order.ProviderPayURL) != "" &&
		order.ProviderExpiresAt != nil && order.ProviderExpiresAt.After(now.Add(margin))
}

// orderPaymentState is the single user-facing summary of an order.
func orderPaymentState(order *store.Order, now time.Time) string {
	switch {
	case order.Status == "completed":
		return "completed"
	case order.PaidAt != nil:
		return "confirming"
	case order.Status != "pending":
		return order.Status
	case order.ProviderOrderID == nil:
		return "creating"
	case paymentQRAvailable(order, now, 0):
		return "awaiting_payment"
	default:
		// The QR code has expired; waiting for the provider to confirm the
		// order expired or report a payment made just before the deadline.
		return "timed_out"
	}
}

// ---------- payment channel health ----------

type paymentChannelCache struct {
	mu        sync.Mutex
	checkedAt time.Time
	online    bool
}

const paymentChannelCacheTTL = 20 * time.Second

// paymentChannelOnline asks the provider whether the phone listener is online.
// A listener that is offline cannot observe payments, so checkout is refused.
// A failed health lookup does not block checkout; the order flow itself
// reports provider failures.
func (s *Server) paymentChannelOnline(ctx context.Context, client *lanjingpay.Client) bool {
	cache := &s.paymentChannel
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if !cache.checkedAt.IsZero() && time.Since(cache.checkedAt) < paymentChannelCacheTTL {
		return cache.online
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	state, err := client.GetServerState(lookupCtx)
	if err != nil {
		log.Printf("lanjing pay listener state unavailable: %v", err)
		return true
	}
	cache.checkedAt, cache.online = time.Now(), state.State == 1
	if !cache.online {
		log.Printf("lanjing pay listener offline: state=%d lastHeartbeat=%s", state.State, state.LastHeartbeat)
	}
	return cache.online
}

// ---------- opening a payment ----------

// openLanjingPayment creates the provider order for a pending local order and
// binds it. Any outcome other than a usable fixed-amount QR code closes the
// local order; a verified callback can still complete it later.
func (s *Server) openLanjingPayment(ctx context.Context, client *lanjingpay.Client, order *store.Order, paymentType lanjingpay.PaymentType) (*store.Order, error) {
	remote, createErr := client.CreateOrder(ctx, lanjingpay.CreateOrderInput{
		MerchantOrderID: order.ID.String(),
		Param:           order.ID.String(),
		Type:            paymentType,
		AmountCents:     order.AmountCents,
	})
	persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	fail := func(outcome, detail, providerID string, userErr error) (*store.Order, error) {
		if _, err := store.CloseOrder(persistCtx, s.St.Pool, order.ID, "failed"); err != nil {
			log.Printf("close failed lanjing order %s: %v", order.ID, err)
		}
		if outcome != "" {
			s.recordPaymentIssue(persistCtx, order, outcome, detail, providerID)
		}
		return nil, userErr
	}
	if createErr != nil {
		log.Printf("create lanjing order %s: %v", order.ID, createErr)
		var apiErr *lanjingpay.APIError
		if errors.As(createErr, &apiErr) {
			return fail("", "", "", apperr.E("payment_create_failed", "支付通道暂时无法创建订单，请稍后重试", 502))
		}
		// The provider may have created an order we never saw. No QR code was
		// shown, so it cannot be paid by this user; a callback still completes it.
		return fail("create_result_unknown", "建单请求无响应："+createErr.Error(), "",
			apperr.E("payment_provider_timeout", "支付通道响应超时，请稍后重试", 502))
	}
	if remote.ProviderOrderID == "" || remote.MerchantOrderID != order.ID.String() {
		return fail("invalid_provider_identity", fmt.Sprintf("渠道返回的订单身份不匹配（payId=%s orderId=%s），未关单，需人工核查", remote.MerchantOrderID, remote.ProviderOrderID),
			remote.ProviderOrderID, apperr.E("payment_provider_error", "支付通道返回异常，请稍后重试", 502))
	}
	payAmount, _ := remote.ReallyPriceCents()
	expiresAt := remote.ExpiresAt()
	if expiresAt.IsZero() {
		expiresAt = time.Now().Add(defaultProviderOrderTTL)
	}
	bound, bindErr := store.BindOrderProvider(persistCtx, s.St.Pool, order.ID, remote.ProviderOrderID, payAmount,
		lanjingPaymentMethod(paymentType), remote.PayURL, remote.IsAuto == 1, &expiresAt, true)
	if bindErr != nil {
		// A signed callback may already have settled the order (the provider can
		// notify before answering). Keep that payment and attach the cloud ID.
		if latest, err := store.GetOrder(persistCtx, s.St.Pool, order.ID); err == nil && latest != nil && latest.PaidAt != nil {
			if attached, err := store.BindOrderProvider(persistCtx, s.St.Pool, order.ID, remote.ProviderOrderID, payAmount,
				lanjingPaymentMethod(paymentType), remote.PayURL, remote.IsAuto == 1, &expiresAt, false); err == nil {
				return attached, nil
			}
			return latest, nil
		}
		closeErr := client.CloseOrder(persistCtx, remote.ProviderOrderID)
		detail := fmt.Sprintf("渠道已建单但本站未能绑定：%v；渠道关单结果：%v", bindErr, closeErr)
		return fail("provider_binding_failed", detail, remote.ProviderOrderID,
			apperr.E("payment_provider_error", "订单创建失败，请稍后重试", 502))
	}
	reject, outcome, detail := checkNewProviderOrder(bound, remote, paymentType)
	if reject == nil {
		return bound, nil
	}
	if err := client.CloseOrder(persistCtx, remote.ProviderOrderID); err != nil {
		outcome, detail = "close_result_unknown", fmt.Sprintf("%s；渠道关单失败：%v", detail, err)
	}
	return fail(outcome, detail, remote.ProviderOrderID, reject)
}

// checkNewProviderOrder validates a freshly created provider order. It returns
// the user-facing rejection plus an admin issue (outcome may be empty when the
// rejection is an expected, non-actionable condition).
func checkNewProviderOrder(order *store.Order, remote *lanjingpay.Order, paymentType lanjingpay.PaymentType) (error, string, string) {
	priceCents, priceErr := remote.PriceCents()
	payCents, payErr := remote.ReallyPriceCents()
	switch {
	case priceErr != nil || priceCents != order.AmountCents:
		return apperr.E("payment_provider_error", "支付通道返回异常，请稍后重试", 502),
			"identity_or_amount_mismatch", fmt.Sprintf("渠道订单标价 %q 与本站金额 %d 分不一致，已关单", remote.Price, order.AmountCents)
	case remote.Type != paymentType:
		return apperr.E("payment_provider_error", "支付通道返回异常，请稍后重试", 502),
			"identity_or_amount_mismatch", fmt.Sprintf("渠道支付方式 %d 与请求的 %d 不一致，已关单", remote.Type, paymentType)
	case payErr != nil || payCents != order.AmountCents:
		// Another open order holds this amount, so the provider shifted it.
		return apperr.E("payment_channel_busy", "当前有其他用户正在支付相同金额，请 1-2 分钟后再试", 409), "", ""
	case remote.IsAuto != 0:
		return apperr.E("payment_qr_missing", "该金额暂未配置收款码，请联系客服", 503),
			"fixed_qr_missing", fmt.Sprintf("渠道没有 %s 元的固定金额收款码（isAuto=%d），请在渠道后台上传", remote.Price, remote.IsAuto)
	case remote.PayURL == "" || remote.State != 0:
		return apperr.E("payment_provider_error", "支付通道返回异常，请稍后重试", 502),
			"invalid_provider_order", fmt.Sprintf("新建渠道订单不可支付（state=%d，二维码为空=%t），已关单", remote.State, remote.PayURL == "")
	}
	return nil, "", ""
}

// ---------- syncing with the provider ----------

// syncLanjingOrder moves a local order to the state the provider reports. It
// returns the refreshed order, the provider order when one was read, and an
// error when the provider could not be read or contradicts the local order.
func (s *Server) syncLanjingOrder(ctx context.Context, client *lanjingpay.Client, order *store.Order) (*store.Order, *lanjingpay.Order, error) {
	if order.Provider != "lanjing" || order.Status == "completed" {
		return order, nil, nil
	}
	if order.PaidAt != nil {
		completed, err := s.completeVerifiedOrder(ctx, order)
		return firstOrder(completed, order), nil, err
	}
	if order.ProviderOrderID == nil {
		if order.Status == "pending" && time.Since(order.CreatedAt) > unboundOrderTimeout {
			return s.closeLocalOrder(ctx, order, "failed")
		}
		return order, nil, nil
	}
	remote, err := client.GetOrder(ctx, *order.ProviderOrderID)
	if err != nil {
		if lanjingpay.IsOrderNotFound(err) && order.Status == "pending" {
			return s.closeLocalOrder(ctx, order, "expired")
		}
		return order, nil, err
	}
	if remote.MerchantOrderID != order.ID.String() || remote.ProviderOrderID != *order.ProviderOrderID {
		return order, remote, &paymentAnomaly{fmt.Sprintf("渠道订单身份不一致（payId=%s）", remote.MerchantOrderID)}
	}
	if price, err := remote.PriceCents(); err != nil || price != order.AmountCents {
		return order, remote, &paymentAnomaly{fmt.Sprintf("渠道订单标价 %q 与本站金额 %d 分不一致", remote.Price, order.AmountCents)}
	}
	switch remote.State {
	case 1, 2:
		paid, err := remote.ReallyPriceCents()
		if err != nil || paid != expectedProviderPayAmount(order) {
			return order, remote, &paymentAnomaly{fmt.Sprintf("渠道实付 %q 与应付 %d 分不一致", remote.ReallyPrice, expectedProviderPayAmount(order))}
		}
		if order.PaymentMethod != nil && lanjingPaymentMethod(remote.Type) != *order.PaymentMethod {
			return order, remote, &paymentAnomaly{"渠道支付方式与订单不一致"}
		}
		completed, err := s.completeVerifiedOrder(ctx, order)
		return firstOrder(completed, order), remote, err
	case -1:
		if order.Status == "pending" {
			closed, _, err := s.closeLocalOrder(ctx, order, "expired")
			return closed, remote, err
		}
	}
	return order, remote, nil
}

func firstOrder(preferred, fallback *store.Order) *store.Order {
	if preferred != nil {
		return preferred
	}
	return fallback
}

func (s *Server) closeLocalOrder(ctx context.Context, order *store.Order, status string) (*store.Order, *lanjingpay.Order, error) {
	if _, err := store.CloseOrder(ctx, s.St.Pool, order.ID, status); err != nil {
		return order, nil, err
	}
	fresh, err := store.GetOrder(ctx, s.St.Pool, order.ID)
	return firstOrder(fresh, order), nil, err
}

// refreshUserOrder syncs an unsettled order on behalf of the polling user,
// at most once per userCheckInterval across all callers.
func (s *Server) refreshUserOrder(ctx context.Context, order *store.Order) *store.Order {
	if order.Provider != "lanjing" || !(order.Status == "pending" || (order.PaidAt != nil && order.Status != "completed")) {
		return order
	}
	claimed, err := store.MarkOrderChecked(ctx, s.St.Pool, order.ID, userCheckInterval)
	if err != nil || !claimed {
		return order
	}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		return order
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	fresh, _, syncErr := s.syncLanjingOrder(lookupCtx, client, order)
	s.saveCheckResult(context.WithoutCancel(ctx), order.ID, syncErr)
	if latest, err := store.GetOrder(ctx, s.St.Pool, order.ID); err == nil && latest != nil {
		return latest
	}
	return fresh
}

func (s *Server) saveCheckResult(ctx context.Context, orderID uuid.UUID, syncErr error) {
	var message *string
	if syncErr != nil {
		text := syncErr.Error()
		if runes := []rune(text); len(runes) > 300 {
			text = string(runes[:300])
		}
		message = &text
	}
	if err := store.SetOrderCheckError(ctx, s.St.Pool, orderID, message); err != nil {
		log.Printf("save payment check result %s: %v", orderID, err)
	}
}

// ---------- user cancellation ----------

// cancelLanjingOrder closes an unpaid order at the provider first, so a QR
// code the user still holds stops accepting payments. If the provider refuses
// because the order was just paid, the payment is delivered instead.
func (s *Server) cancelLanjingOrder(ctx context.Context, order *store.Order) (*store.Order, error) {
	if order.Status != "pending" || order.PaidAt != nil {
		return order, nil
	}
	if order.ProviderOrderID == nil {
		if time.Since(order.CreatedAt) < unboundOrderTimeout {
			return order, apperr.E("payment_order_creating", "订单正在创建，请稍后再取消", 409)
		}
		closed, _, err := s.closeLocalOrder(ctx, order, "cancelled")
		return closed, err
	}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		return order, apperr.E("payment_unavailable", "支付渠道暂不可用，请稍后重试", 503)
	}
	closeErr := client.CloseOrder(ctx, *order.ProviderOrderID)
	if closeErr == nil {
		closed, _, err := s.closeLocalOrder(ctx, order, "cancelled")
		return closed, err
	}
	fresh, _, syncErr := s.syncLanjingOrder(ctx, client, order)
	if syncErr == nil && fresh.Status != "pending" {
		return fresh, nil
	}
	log.Printf("close lanjing order %s: close=%v sync=%v", order.ID, closeErr, syncErr)
	return order, apperr.E("payment_provider_error", "订单暂时无法关闭，请稍后重试", 502)
}

// ---------- async callback ----------

// lanjingPaymentNotify handles the provider's GET callback. The provider
// retries for 24 hours until it reads "success". Once the payment is durably
// recorded the answer is "success" even if delivery fails (the reconciler
// retries delivery); a verified callback that contradicts the order is
// recorded for review and also acknowledged, because retrying cannot fix it.
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
	signatureValid = client.VerifyCallback(payID, param, paymentType, price, reallyPrice, signature)
	if !signatureValid {
		outcome = "invalid_signature"
		c.String(http.StatusUnauthorized, "error_sign")
		return
	}
	// The signature proves the provider sent this. From here on, problems are
	// recorded for review and acknowledged so the provider stops retrying.
	acknowledge := func(result, reason string) {
		outcome, detail = result, reason
		c.String(http.StatusOK, "success")
	}
	if cents, err := lanjingpay.ParseCents(price); err == nil {
		amountCents = &cents
	}
	if cents, err := lanjingpay.ParseCents(reallyPrice); err == nil {
		paidAmountCents = &cents
	}
	parsedOrderID, err := uuid.Parse(payID)
	if err != nil || param != payID {
		acknowledge("invalid_order", "回调订单号无法识别")
		return
	}
	orderID = &parsedOrderID
	ctx := c.Request.Context()
	order, err := store.GetOrder(ctx, s.St.Pool, parsedOrderID)
	if err != nil {
		outcome, detail = "database_error", err.Error()
		c.String(http.StatusInternalServerError, "error")
		return
	}
	if order == nil || order.Provider != "lanjing" {
		orderID = nil
		acknowledge("order_not_found", "回调订单不存在："+payID)
		return
	}
	if order.ProviderOrderID != nil {
		providerOrderID = *order.ProviderOrderID
	}
	method := ""
	if n, err := strconv.Atoi(paymentType); err == nil {
		method = lanjingPaymentMethod(lanjingpay.PaymentType(n))
	}
	var mismatch string
	switch {
	case amountCents == nil || *amountCents != order.AmountCents:
		mismatch = fmt.Sprintf("回调标价 %s 与订单金额 %d 分不一致", price, order.AmountCents)
	case paidAmountCents == nil || *paidAmountCents != expectedProviderPayAmount(order):
		mismatch = fmt.Sprintf("回调实付 %s 与应付 %d 分不一致", reallyPrice, expectedProviderPayAmount(order))
	case method == "" || (order.PaymentMethod != nil && method != *order.PaymentMethod):
		mismatch = "回调支付方式与订单不一致"
	}
	if mismatch != "" {
		s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &order.UserID, ClientIP: c.ClientIP(),
			Category: "payment_callback_mismatch", Severity: "critical", Score: 100, Action: "blocked",
			Reason: mismatch, Metadata: map[string]any{"orderId": order.ID.String(), "price": price, "reallyPrice": reallyPrice, "type": paymentType}})
		acknowledge("order_mismatch", mismatch)
		return
	}
	settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	if err := store.RecordOrderPayment(settleCtx, s.St.Pool, order.ID); err != nil {
		outcome, detail = "database_error", err.Error()
		c.String(http.StatusInternalServerError, "error")
		return
	}
	if _, err := s.completeVerifiedOrder(settleCtx, order); err != nil {
		log.Printf("deliver paid order %s: %v", order.ID, err)
		acknowledge("delivery_pending", "已记录收款，权益发放失败将自动重试："+err.Error())
		return
	}
	acknowledge("completed", "")
}

// ---------- reconciliation ----------

// reconcilePaymentOrder syncs one order with the provider. Scheduled runs
// record the result only when it changed something or needs attention; a
// manual check (by an administrator) is always recorded.
func (s *Server) reconcilePaymentOrder(ctx context.Context, order *store.Order, manual bool) (*store.PaymentReconciliation, error) {
	result := &store.PaymentReconciliation{OrderID: order.ID, Provider: order.Provider, LocalStatus: order.Status,
		ExpectedAmountCents: expectedProviderPayAmount(order), Outcome: "matched"}
	if order.ProviderOrderID == nil && order.PaidAt == nil {
		// Nothing to ask the provider: it can only be looked up by cloud order ID.
		fresh := order
		if order.Status == "pending" && time.Since(order.CreatedAt) > unboundOrderTimeout {
			closed, _, err := s.closeLocalOrder(ctx, order, "failed")
			if err != nil {
				return nil, err
			}
			fresh = closed
		}
		result.LocalStatus, result.Outcome = fresh.Status, "provider_id_missing"
		result.Detail = pointer("没有渠道订单号，无法向渠道查询：收到验签回调会自动入账；也可在渠道后台找到云端订单号后手动关联")
		if manual || fresh.Status != order.Status {
			recorded, err := store.RecordPaymentReconciliation(ctx, s.St.Pool, *result)
			if err != nil {
				return nil, err
			}
			result = &recorded
		}
		return result, nil
	}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		if err == nil {
			err = fmt.Errorf("支付渠道未配置")
		}
		return nil, err
	}
	wasPaid := order.PaidAt != nil
	fresh, remote, syncErr := s.syncLanjingOrder(ctx, client, order)
	if fresh != nil {
		result.LocalStatus = fresh.Status
	}
	if remote != nil {
		result.ProviderState = pointer(remote.State)
		if cents, err := remote.PriceCents(); err == nil {
			result.ProviderAmountCents = &cents
		}
		if cents, err := remote.ReallyPriceCents(); err == nil {
			result.ProviderPaidAmountCents = &cents
		}
	}
	switch {
	case isPaymentAnomaly(syncErr):
		result.Outcome, result.Detail = "identity_or_amount_mismatch", pointer(syncErr.Error())
	case syncErr != nil && (wasPaid || (remote != nil && (remote.State == 1 || remote.State == 2))):
		result.Outcome, result.Detail = "repair_failed", pointer("渠道已收款，权益发放失败："+syncErr.Error())
	case syncErr != nil:
		result.Outcome, result.Detail = "provider_error", pointer(syncErr.Error())
	case fresh != nil && fresh.Status == "completed" && order.Status != "completed":
		result.Outcome, result.Detail = "repaired", pointer("渠道已收款，本站已补齐到账")
	case fresh != nil && fresh.Status != order.Status:
		result.Outcome, result.Detail = "closed", pointer("订单已按渠道状态关闭为 "+fresh.Status)
	}
	s.saveCheckResult(ctx, order.ID, syncErr)
	// Routine "still pending" checks are not recorded; provider errors are
	// recorded on the first attempt and then every 10th to bound the noise.
	record := manual || (result.Outcome != "matched" && (result.Outcome != "provider_error" || order.ReconcileAttempts%10 == 0))
	if record {
		if recorded, err := store.RecordPaymentReconciliation(ctx, s.St.Pool, *result); err != nil {
			log.Printf("record reconciliation %s: %v", order.ID, err)
		} else {
			result = &recorded
		}
	}
	switch result.Outcome {
	case "repaired":
		_ = store.ResolveOrderReconciliationRisks(ctx, s.St.Pool, order.ID)
	case "identity_or_amount_mismatch", "repair_failed":
		if order.ReconcileAttempts%10 == 0 {
			s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &order.UserID, Category: "payment_reconciliation",
				Severity: "high", Score: 60, Action: "observed", Reason: *result.Detail,
				Metadata: map[string]any{"orderId": order.ID.String(), "outcome": result.Outcome}})
		}
	}
	return result, nil
}

// reconciliationDelay schedules the next provider check for an order.
func reconciliationDelay(order *store.Order, failed bool, now time.Time) time.Duration {
	backoff := func(base, ceiling time.Duration) time.Duration {
		return min(base*time.Duration(1<<min(max(order.ReconcileAttempts, 0), 10)), ceiling)
	}
	switch {
	case order.Status == "completed":
		return 0 // never again
	case order.PaidAt != nil:
		return backoff(30*time.Second, 30*time.Minute)
	case order.Status == "pending" && failed:
		return backoff(10*time.Second, 5*time.Minute)
	case order.Status == "pending" && order.ProviderOrderID == nil:
		return 30 * time.Second
	case order.Status == "pending":
		if order.ProviderExpiresAt != nil && now.After(order.ProviderExpiresAt.Add(10*time.Minute)) {
			return time.Minute
		}
		return 10 * time.Second
	case order.ProviderOrderID != nil && now.Before(order.CreatedAt.Add(latePaymentWindow)):
		return 10 * time.Minute
	default:
		return 0
	}
}

func (s *Server) runPaymentReconciliationBatch(parent context.Context, limit int) (int, map[string]int, error) {
	ctx, cancel := context.WithTimeout(parent, 45*time.Second)
	defer cancel()
	counts := map[string]int{}
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		return 0, counts, err
	}
	checked := 0
	for checked < limit && ctx.Err() == nil {
		orders, err := store.ClaimOrdersForReconciliation(ctx, s.St.Pool, time.Now().UTC(), min(20, limit-checked))
		if err != nil {
			return checked, counts, err
		}
		if len(orders) == 0 {
			break
		}
		for i, order := range orders {
			if ctx.Err() != nil {
				releaseCtx, releaseCancel := context.WithTimeout(context.WithoutCancel(parent), 3*time.Second)
				for _, remaining := range orders[i:] {
					_ = store.ReleaseOrderReconciliation(releaseCtx, s.St.Pool, remaining)
				}
				releaseCancel()
				counts["deferred"] += len(orders) - i
				return checked, counts, nil
			}
			result, err := s.reconcilePaymentOrder(ctx, order, false)
			outcome := "provider_error"
			if result != nil {
				outcome = result.Outcome
			}
			counts[outcome]++
			checked++
			failed := err != nil || (outcome != "matched" && outcome != "repaired" && outcome != "closed")
			finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(parent), 3*time.Second)
			latest, readErr := store.GetOrder(finishCtx, s.St.Pool, order.ID)
			if readErr != nil || latest == nil {
				latest = order
			}
			latest.ReconcileAttempts, latest.ReconcileLeaseID = order.ReconcileAttempts, order.ReconcileLeaseID
			next := time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
			if delay := reconciliationDelay(latest, failed, time.Now()); delay > 0 {
				next = time.Now().Add(delay)
			}
			if err := store.FinishOrderReconciliation(finishCtx, s.St.Pool, order, next, failed); err != nil {
				log.Printf("persist reconciliation schedule %s: %v", order.ID, err)
			}
			finishCancel()
		}
	}
	return checked, counts, nil
}

// recordPaymentIssue makes a payment problem visible in the admin
// reconciliation list and the security risk feed.
func (s *Server) recordPaymentIssue(ctx context.Context, order *store.Order, outcome, detail, providerID string) {
	if runes := []rune(detail); len(runes) > 1000 {
		detail = string(runes[:1000])
	}
	entry := store.PaymentReconciliation{OrderID: order.ID, Provider: "lanjing", LocalStatus: order.Status, ExpectedAmountCents: order.AmountCents, Outcome: outcome, Detail: &detail}
	if err := store.InsertPaymentReconciliation(ctx, s.St.Pool, entry); err != nil {
		log.Printf("payment issue audit order=%s outcome=%s: %v", order.ID, outcome, err)
	}
	s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &order.UserID, Category: "payment_reconciliation", Severity: "high", Score: 60, Action: "observed", Reason: detail, Metadata: map[string]any{"orderId": order.ID.String(), "providerOrderId": providerID, "outcome": outcome}})
}
