package httpapi

// Payment listener monitoring.
//
// Lanjing payments are observed by a phone app that reads Alipay/WeChat
// notifications. While that listener is down no payment is reported, so the
// server watches its state continuously instead of only at checkout:
//
//   - every paymentListenerCheckInterval the provider's /getState is read;
//   - an "online" listener whose heartbeat is older than the configured
//     threshold counts as offline (a frozen app can keep the flag set);
//   - repeated lookup failures close checkout instead of failing open;
//   - going offline raises a critical risk event and emails administrators,
//     repeated while it stays down; recovery emails again and re-checks every
//     order closed around the outage, because missed notifications are often
//     reported once the app comes back.

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	paymentListenerCheckInterval = 15 * time.Second
	// Checkout reuses a listener check at most this old.
	paymentChannelCacheTTL = 20 * time.Second
	// Checkout stays open through this many consecutive failed state lookups.
	paymentListenerLookupTolerance = 3
	// The monitor alerts after this many consecutive unhealthy checks, so a
	// single flap does not page anyone.
	paymentListenerAlertAfter = 2
	// An unresolved outage is re-sent at this interval.
	paymentListenerRealertInterval = 30 * time.Minute
	// Orders closed this long before an outage began are re-checked on recovery.
	paymentListenerRecoveryLookback = 30 * time.Minute
)

// paymentListenerTracker is the latest known listener health, shared by
// checkout and the background monitor.
type paymentListenerTracker struct {
	mu                sync.Mutex
	checkedAt         time.Time
	state             *lanjingpay.ServerState
	lookupErr         string
	consecutiveErrors int
	healthy           bool
	reason            string
	// Alerting state, owned by the monitor.
	unhealthyStreak int
	alertActive     bool
	downSince       time.Time
	lastAlertAt     time.Time
}

type paymentListenerSnapshot struct {
	CheckedAt         time.Time
	State             *lanjingpay.ServerState
	LookupErr         string
	ConsecutiveErrors int
	Healthy           bool
	Reason            string
	AlertActive       bool
	DownSince         time.Time
	LastAlertAt       time.Time
}

func (t *paymentListenerTracker) snapshotLocked() paymentListenerSnapshot {
	return paymentListenerSnapshot{CheckedAt: t.checkedAt, State: t.state, LookupErr: t.lookupErr,
		ConsecutiveErrors: t.consecutiveErrors, Healthy: t.healthy, Reason: t.reason,
		AlertActive: t.alertActive, DownSince: t.downSince, LastAlertAt: t.lastAlertAt}
}

func (t *paymentListenerTracker) snapshot() paymentListenerSnapshot {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.snapshotLocked()
}

// listenerStateHealth judges one successful /getState answer.
func listenerStateHealth(state *lanjingpay.ServerState, staleAfter time.Duration, now time.Time) (bool, string) {
	switch state.State {
	case 1:
	case -1:
		return false, "监听端未绑定"
	default:
		return false, "渠道报告监听端离线"
	}
	if staleAfter > 0 && !state.LastHeartbeat.IsZero() && now.Sub(state.LastHeartbeat) > staleAfter {
		return false, fmt.Sprintf("监听端心跳已停止 %s（阈值 %s）", formatOutage(now.Sub(state.LastHeartbeat)), formatOutage(staleAfter))
	}
	return true, ""
}

// checkPaymentListener reads the listener state once and records the result.
func (s *Server) checkPaymentListener(ctx context.Context, client *lanjingpay.Client) paymentListenerSnapshot {
	staleAfter := time.Duration(settings.DefaultPaymentListenerStaleSecs) * time.Second
	if s.St != nil {
		if cfg, err := settings.ResolvePaymentAlerts(ctx, s.St.Pool); err == nil {
			staleAfter = time.Duration(cfg.StaleAfterSecs) * time.Second
		}
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	state, err := client.GetServerState(lookupCtx)
	now := time.Now()

	t := &s.paymentListener
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.checkedAt.IsZero() {
		t.healthy = true
	}
	t.checkedAt = now
	if err != nil {
		t.consecutiveErrors++
		t.lookupErr = err.Error()
		log.Printf("lanjing pay listener state unavailable (%d in a row): %v", t.consecutiveErrors, err)
		if t.consecutiveErrors >= paymentListenerLookupTolerance {
			t.healthy, t.reason = false, fmt.Sprintf("监听状态连续 %d 次查询失败：%v", t.consecutiveErrors, err)
		}
		return t.snapshotLocked()
	}
	t.consecutiveErrors, t.lookupErr, t.state = 0, "", state
	wasHealthy := t.healthy
	t.healthy, t.reason = listenerStateHealth(state, staleAfter, now)
	if wasHealthy && !t.healthy {
		log.Printf("lanjing pay listener unhealthy: %s state=%d lastHeartbeat=%s", t.reason, state.State, state.LastHeartbeat)
	}
	return t.snapshotLocked()
}

// paymentChannelOnline reports whether checkout may open a payment. A listener
// that cannot observe payments refuses checkout; a few failed lookups do not,
// repeated failures do.
func (s *Server) paymentChannelOnline(ctx context.Context, client *lanjingpay.Client) bool {
	snap := s.paymentListener.snapshot()
	if snap.CheckedAt.IsZero() || time.Since(snap.CheckedAt) >= paymentChannelCacheTTL {
		snap = s.checkPaymentListener(ctx, client)
	}
	return snap.Healthy
}

// monitorPaymentListener runs one background check and raises or clears the
// outage alert.
func (s *Server) monitorPaymentListener(ctx context.Context) {
	client, _, err := s.resolveLanjingPay(ctx)
	if err != nil || client == nil {
		// Payment is disabled or misconfigured; there is no listener to watch.
		return
	}
	snap := s.checkPaymentListener(ctx, client)
	now := time.Now()

	t := &s.paymentListener
	t.mu.Lock()
	var raise, remind, recovered bool
	var downSince time.Time
	if snap.Healthy {
		t.unhealthyStreak = 0
		if t.alertActive {
			recovered, downSince = true, t.downSince
			t.alertActive, t.downSince = false, time.Time{}
		}
	} else {
		t.unhealthyStreak++
		switch {
		case !t.alertActive && t.unhealthyStreak >= paymentListenerAlertAfter:
			raise = true
			t.alertActive, t.lastAlertAt = true, now
			// The outage began at the first unhealthy check.
			t.downSince = now.Add(-time.Duration(t.unhealthyStreak-1) * paymentListenerCheckInterval)
		case t.alertActive && now.Sub(t.lastAlertAt) >= paymentListenerRealertInterval:
			remind = true
			t.lastAlertAt = now
		}
		downSince = t.downSince
	}
	t.mu.Unlock()

	switch {
	case raise:
		s.recordRisk(ctx, store.NewSecurityRiskEvent{Category: "payment_listener", Severity: "critical", Score: 90,
			Action: "limited", Reason: "支付监听端异常，已暂停收银：" + snap.Reason,
			Metadata: listenerMetadata(snap)})
		s.notifyPaymentAdmins("", "【告警】支付监听端异常，收款可能无法到账",
			listenerAlertBody("支付监听端异常。异常期间新订单将被拒绝，已付款订单无法自动确认。", snap, downSince, now))
	case remind:
		s.notifyPaymentAdmins("", fmt.Sprintf("【告警】支付监听端仍异常（已 %s）", formatOutage(now.Sub(downSince))),
			listenerAlertBody("支付监听端仍未恢复。", snap, downSince, now))
	case recovered:
		resolveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := store.ResolvePaymentListenerRisks(resolveCtx, s.St.Pool); err != nil {
			log.Printf("resolve payment listener risks: %v", err)
		}
		since := downSince.Add(-paymentListenerRecoveryLookback)
		expedited, err := store.ExpediteRecentLanjingOrders(resolveCtx, s.St.Pool, since)
		if err != nil {
			log.Printf("expedite orders after listener recovery: %v", err)
		}
		body := listenerAlertBody(fmt.Sprintf("支付监听端已恢复，异常持续约 %s。已安排立即重新核实 %d 笔 %s 以来的订单，如有漏单会自动入账。",
			formatOutage(now.Sub(downSince)), expedited, downSince.Add(-paymentListenerRecoveryLookback).In(beijing).Format("01-02 15:04")), snap, downSince, now)
		s.notifyPaymentAdmins("", "【恢复】支付监听端已恢复", body)
	}
}

var beijing = time.FixedZone("CST", 8*3600)

func formatOutage(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%d 秒", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%d 分钟", int(d.Minutes()))
	default:
		return fmt.Sprintf("%d 小时 %d 分钟", int(d.Hours()), int(d.Minutes())%60)
	}
}

func listenerMetadata(snap paymentListenerSnapshot) map[string]any {
	meta := map[string]any{"reason": snap.Reason, "lookupErrors": snap.ConsecutiveErrors}
	if snap.State != nil {
		meta["state"] = snap.State.State
		if !snap.State.LastHeartbeat.IsZero() {
			meta["lastHeartbeat"] = snap.State.LastHeartbeat.UTC().Format(time.RFC3339)
		}
	}
	return meta
}

func listenerAlertBody(lead string, snap paymentListenerSnapshot, downSince, now time.Time) string {
	formatTime := func(t time.Time) string {
		if t.IsZero() {
			return "暂无记录"
		}
		return t.In(beijing).Format("2006-01-02 15:04:05")
	}
	lines := []string{lead, ""}
	if snap.Reason != "" {
		lines = append(lines, "原因："+snap.Reason)
	}
	if !downSince.IsZero() {
		lines = append(lines, "开始时间："+formatTime(downSince))
	}
	if snap.State != nil {
		lines = append(lines, "最近心跳："+formatTime(snap.State.LastHeartbeat), "最近收款："+formatTime(snap.State.LastPayment))
	}
	if snap.LookupErr != "" {
		lines = append(lines, "查询错误："+snap.LookupErr)
	}
	lines = append(lines, "检测时间："+formatTime(now), "",
		"处理建议：检查收款手机是否联网、监听 App 是否在前台运行、通知权限和电池优化白名单是否被系统收回。",
		"恢复后系统会自动补查期间的订单，无需手动补单。")
	return strings.Join(lines, "\n")
}

// ---------- administrator email ----------

type paymentAlertMailer struct {
	mu     sync.Mutex
	sentAt map[string]time.Time
}

// paymentAlertDedupeWindow suppresses repeats of the same keyed alert.
const paymentAlertDedupeWindow = 6 * time.Hour

// notifyPaymentAdmins emails the configured payment alert recipients in the
// background. A non-empty dedupeKey sends that alert at most once per
// paymentAlertDedupeWindow.
func (s *Server) notifyPaymentAdmins(dedupeKey, subject, body string) {
	if s == nil || s.St == nil {
		return
	}
	if dedupeKey != "" {
		m := &s.paymentAlerts
		m.mu.Lock()
		if m.sentAt == nil {
			m.sentAt = map[string]time.Time{}
		}
		now := time.Now()
		for key, at := range m.sentAt {
			if now.Sub(at) >= paymentAlertDedupeWindow {
				delete(m.sentAt, key)
			}
		}
		if _, sent := m.sentAt[dedupeKey]; sent {
			m.mu.Unlock()
			return
		}
		m.sentAt[dedupeKey] = now
		m.mu.Unlock()
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		cfg, err := settings.ResolvePaymentAlerts(ctx, s.St.Pool)
		cancel()
		if err != nil {
			log.Printf("payment alert %q: load recipients: %v", subject, err)
			return
		}
		if len(cfg.Emails) == 0 {
			log.Printf("payment alert %q: no recipients configured", subject)
			return
		}
		if !s.smtpConfigured() {
			log.Printf("payment alert %q: SMTP not configured", subject)
			return
		}
		for _, to := range cfg.Emails {
			if err := s.sendPlainEmail(to, "StarCloudsAI "+subject, body); err != nil {
				log.Printf("payment alert %q to %s: %v", subject, to, err)
			}
		}
	}()
}

// ---------- admin endpoints ----------

// adminPaymentListenerStatus reports the monitor's latest view of the listener
// and whether alerts can actually be delivered.
func (s *Server) adminPaymentListenerStatus(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	cfg, err := settings.ResolvePaymentAlerts(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	snap := s.paymentListener.snapshot()
	out := gin.H{
		"monitoring":        s.Cfg != nil && s.Cfg.AppEnv == "production",
		"checkedAt":         nil,
		"healthy":           snap.Healthy,
		"reason":            snap.Reason,
		"lookupError":       snap.LookupErr,
		"alertActive":       snap.AlertActive,
		"downSince":         nil,
		"lastAlertAt":       nil,
		"alertEmails":       cfg.Emails,
		"staleAfterSecs":    cfg.StaleAfterSecs,
		"smtpConfigured":    s.smtpConfigured(),
		"checkIntervalSecs": int(paymentListenerCheckInterval.Seconds()),
	}
	if !snap.CheckedAt.IsZero() {
		out["checkedAt"] = isoValue(snap.CheckedAt)
	}
	if !snap.DownSince.IsZero() {
		out["downSince"] = isoValue(snap.DownSince)
	}
	if !snap.LastAlertAt.IsZero() {
		out["lastAlertAt"] = isoValue(snap.LastAlertAt)
	}
	ok(c, out)
}

// adminTestPaymentAlertEmail sends a test alert synchronously, to the given
// addresses (unsaved form values) or else to the saved recipients.
func (s *Server) adminTestPaymentAlertEmail(c *gin.Context, _ *store.User) {
	var input struct {
		Emails []string `json:"emails"`
	}
	if c.Request.ContentLength != 0 {
		if err := bindJSON(c, &input); err != nil {
			fail(c, err)
			return
		}
	}
	recipients := []string{}
	for _, item := range input.Emails {
		if strings.TrimSpace(item) == "" {
			continue
		}
		address, err := mailEnvelopeAddress(item)
		if err != nil {
			fail(c, apperr.E("validation_error", "邮箱格式不正确："+item, 422))
			return
		}
		recipients = append(recipients, address)
	}
	if len(recipients) == 0 {
		cfg, err := settings.ResolvePaymentAlerts(c.Request.Context(), s.St.Pool)
		if err != nil {
			fail(c, err)
			return
		}
		recipients = cfg.Emails
	}
	if len(recipients) == 0 {
		fail(c, apperr.E("validation_error", "请先填写告警邮箱", 422))
		return
	}
	if len(recipients) > 10 {
		fail(c, apperr.E("validation_error", "最多 10 个邮箱", 422))
		return
	}
	if !s.smtpConfigured() {
		fail(c, apperr.E("smtp_not_configured", "服务器未配置 SMTP（SMTP_ADDR / SMTP_FROM），无法发送邮件", 503))
		return
	}
	body := "这是一封支付告警测试邮件。\n\n收到它说明支付监听端离线、恢复以及支付异常时，告警会发到这个邮箱。\n发送时间：" +
		time.Now().In(beijing).Format("2006-01-02 15:04:05")
	results := []gin.H{}
	sent := 0
	for _, to := range recipients {
		item := gin.H{"email": to, "ok": true}
		if err := s.sendPlainEmail(to, "StarCloudsAI 支付告警测试", body); err != nil {
			item["ok"], item["error"] = false, err.Error()
		} else {
			sent++
		}
		results = append(results, item)
	}
	ok(c, gin.H{"sent": sent, "results": results})
}
