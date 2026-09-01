package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	downloadUserRequestsPerMinute = int64(600)
	downloadIPRequestsPerMinute   = int64(1200)
	downloadUserBytesPerDay       = int64(20 << 30)
	downloadIPBytesPerDay         = int64(50 << 30)
	downloadUserConcurrency       = int64(8)
	downloadIPConcurrency         = int64(24)
)

func validIPAddress(value string) bool { return net.ParseIP(strings.TrimSpace(value)) != nil }

func ipAllowed(ip string, allowlist []string) bool {
	if len(allowlist) == 0 {
		return true
	}
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil {
		return false
	}
	for _, raw := range allowlist {
		value := strings.TrimSpace(raw)
		if candidate := net.ParseIP(value); candidate != nil && candidate.Equal(parsed) {
			return true
		}
		if _, network, err := net.ParseCIDR(value); err == nil && network.Contains(parsed) {
			return true
		}
	}
	return false
}

func (s *Server) recordRisk(_ context.Context, item store.NewSecurityRiskEvent) {
	if s == nil || s.St == nil {
		return
	}
	// Risk evidence is best-effort but synchronous: a process crash immediately
	// after the denial must not routinely lose the event.
	recordCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = store.InsertSecurityRiskEvent(recordCtx, s.St.Pool, item)
}

func (s *Server) securityBlocked(ctx context.Context, subjectType, subjectValue, scope string, now time.Time) (time.Time, bool) {
	if s == nil || s.St == nil || subjectValue == "" {
		return time.Time{}, false
	}
	blocked, expiresAt, err := store.IsSecurityBlocked(ctx, s.St.Pool, subjectType, subjectValue, scope, now)
	return expiresAt, err == nil && blocked
}

func (s *Server) blockRisk(ctx context.Context, subjectType, subjectValue, scope, reason string, duration time.Duration, event store.NewSecurityRiskEvent) {
	if s == nil || s.St == nil || subjectValue == "" {
		return
	}
	_ = store.UpsertSecurityBlock(ctx, s.St.Pool, subjectType, subjectValue, scope, reason, time.Now().UTC().Add(duration))
	s.recordRisk(ctx, event)
}

type fileEgressLease struct {
	s       *Server
	userKey string
	ip      string
}

func (lease *fileEgressLease) release() {
	if lease == nil || lease.s == nil || lease.s.ConcurrencyLimiter == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if lease.userKey != "" {
		_ = lease.s.ConcurrencyLimiter.Release(ctx, "file-user", lease.userKey)
	}
	if lease.ip != "" {
		_ = lease.s.ConcurrencyLimiter.Release(ctx, "file-ip", lease.ip)
	}
}

func (s *Server) beginFileEgress(c *gin.Context, user *store.User) (*fileEgressLease, error) {
	now := time.Now().UTC()
	ip := strings.TrimSpace(c.ClientIP())
	userKey := ""
	var userID *uuid.UUID
	if user != nil {
		userKey = user.ID.String()
		id := user.ID
		userID = &id
		if expiresAt, blocked := s.securityBlocked(c.Request.Context(), "user", userKey, "download", now); blocked {
			return nil, apperr.E("download_temporarily_blocked", "下载访问已临时受限，请在 "+expiresAt.Local().Format("15:04")+" 后重试", 429)
		}
	}
	if ip != "" {
		if expiresAt, blocked := s.securityBlocked(c.Request.Context(), "ip", ip, "download", now); blocked {
			return nil, apperr.E("download_temporarily_blocked", "当前网络下载访问已临时受限，请在 "+expiresAt.Local().Format("15:04")+" 后重试", 429)
		}
	}
	check := func(scope, subject string, limit int64) error {
		if subject == "" {
			return nil
		}
		return s.takeUsageLimit(c, scope, subject, limit, 1, time.Minute)
	}
	if err := check("download-request-user", userKey, downloadUserRequestsPerMinute); err != nil {
		event := store.NewSecurityRiskEvent{UserID: userID, ClientIP: ip, Category: "download_abuse", Severity: "high", Score: 75, Action: "blocked", Reason: "账号下载请求频率超过限制"}
		s.blockRisk(c.Request.Context(), "user", userKey, "download", event.Reason, 10*time.Minute, event)
		return nil, err
	}
	if err := check("download-request-ip", ip, downloadIPRequestsPerMinute); err != nil {
		event := store.NewSecurityRiskEvent{UserID: userID, ClientIP: ip, Category: "download_abuse", Severity: "high", Score: 80, Action: "blocked", Reason: "来源 IP 下载请求频率超过限制"}
		s.blockRisk(c.Request.Context(), "ip", ip, "download", event.Reason, 10*time.Minute, event)
		return nil, err
	}
	lease := &fileEgressLease{s: s, userKey: userKey, ip: ip}
	acquire := func(scope, subject string, limit int64) error {
		if subject == "" || s.ConcurrencyLimiter == nil {
			return nil
		}
		allowed, err := s.ConcurrencyLimiter.Acquire(c.Request.Context(), scope, subject, limit, 2*time.Minute)
		if err != nil {
			return apperr.E("security_limit_unavailable", "下载保护服务暂时不可用，请稍后重试", 503)
		}
		if !allowed {
			return apperr.E("download_concurrency_limited", "同时下载数量过多，请等待已有下载完成", 429)
		}
		return nil
	}
	if err := acquire("file-user", userKey, downloadUserConcurrency); err != nil {
		return nil, err
	}
	if err := acquire("file-ip", ip, downloadIPConcurrency); err != nil {
		lease.release()
		return nil, err
	}
	return lease, nil
}

func (s *Server) chargeFileEgress(c *gin.Context, user *store.User, bytes int64) error {
	if bytes <= 0 {
		return nil
	}
	ip := strings.TrimSpace(c.ClientIP())
	var userID *uuid.UUID
	if user != nil {
		id := user.ID
		userID = &id
		if err := s.takeUsageLimit(c, "download-bytes-user", user.ID.String(), downloadUserBytesPerDay, bytes, 24*time.Hour); err != nil {
			event := store.NewSecurityRiskEvent{UserID: userID, ClientIP: ip, Category: "download_egress", Severity: "high", Score: 80, Action: "blocked", Reason: "账号单日下载流量超过限制", Metadata: map[string]any{"bytes": bytes}}
			s.blockRisk(c.Request.Context(), "user", user.ID.String(), "download", event.Reason, time.Hour, event)
			return err
		}
	}
	if ip != "" {
		if err := s.takeUsageLimit(c, "download-bytes-ip", ip, downloadIPBytesPerDay, bytes, 24*time.Hour); err != nil {
			event := store.NewSecurityRiskEvent{UserID: userID, ClientIP: ip, Category: "download_egress", Severity: "high", Score: 85, Action: "blocked", Reason: "来源 IP 单日下载流量超过限制", Metadata: map[string]any{"bytes": bytes}}
			s.blockRisk(c.Request.Context(), "ip", ip, "download", event.Reason, time.Hour, event)
			return err
		}
	}
	return nil
}

func paymentCallbackFingerprint(values ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(values, "\x00")))
	return hex.EncodeToString(sum[:])
}

func parsePositiveLimit(value, name string, minimum, maximum int64) (int64, error) {
	if value == "" {
		return 0, nil
	}
	var result int64
	if _, err := fmt.Sscan(value, &result); err != nil || result < minimum || result > maximum {
		return 0, fmt.Errorf("%s out of range", name)
	}
	return result, nil
}
