package httpapi

import (
	"strconv"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/gin-gonic/gin"
)

const (
	highCostRequestsPerMinute = 60
	uploadRequestsPerMinute   = 30
	uploadBytesPerDay         = int64(2 << 30)
	uploadStorageMaxBytes     = int64(5 << 30)
	registrationsPerIPDay     = 5
	publicMetadataPerMinute   = 120
	promptActionsPerMinute    = 120

	// 发码额度只约束"能发多少封验证码邮件"，与 LoginLimiter 的失败计数分开，
	// 因此额度耗尽不会妨碍用户校验已经收到的验证码。
	//
	// 按 IP 的上限放得很宽：校园、公司和运营商 NAT 会让大量正常用户共用一个出口
	// 地址，这里主要用于挡住拿本站群发验证码骚扰他人的行为。真正的猜测防护来自
	// 每个邮箱每小时 8 封、每封最多 5 次尝试——即便打满 IP 额度，单个邮箱每小时
	// 也只有 40 次猜测机会，对 6 位验证码毫无威胁。
	loginCodesPerEmailHour = 8
	loginCodesPerIPHour    = 200
)

func (s *Server) enforceUsageLimit(c *gin.Context, scope, subject string, limit, cost int64, window time.Duration) bool {
	if err := s.takeUsageLimit(c, scope, subject, limit, cost, window); err != nil {
		fail(c, err)
		return false
	}
	return true
}

func (s *Server) takeUsageLimit(c *gin.Context, scope, subject string, limit, cost int64, window time.Duration) error {
	return s.takeUsageLimitMessage(c, scope, subject, limit, cost, window, "操作过于频繁，请稍后再试")
}

// takeUsageLimitMessage 与 takeUsageLimit 相同，但允许调用方给出更贴合场景的
// 提示语；限流原因不同（例如发码额度与通用写操作）时用户需要不同的下一步指引。
func (s *Server) takeUsageLimitMessage(c *gin.Context, scope, subject string, limit, cost int64, window time.Duration, message string) error {
	if s.UsageLimiter == nil {
		return nil
	}
	retryAfter, allowed, err := s.UsageLimiter.Take(c.Request.Context(), scope, subject, limit, cost, window)
	if err != nil {
		return apperr.E("security_limit_unavailable", "请求保护服务暂时不可用，请稍后重试", 503)
	}
	if allowed {
		return nil
	}
	seconds := int64((retryAfter + time.Second - 1) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	c.Header("Retry-After", strconv.FormatInt(seconds, 10))
	return apperr.E("rate_limited", message, 429)
}
