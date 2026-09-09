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
)

func (s *Server) enforceUsageLimit(c *gin.Context, scope, subject string, limit, cost int64, window time.Duration) bool {
	if err := s.takeUsageLimit(c, scope, subject, limit, cost, window); err != nil {
		fail(c, err)
		return false
	}
	return true
}

func (s *Server) takeUsageLimit(c *gin.Context, scope, subject string, limit, cost int64, window time.Duration) error {
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
	return apperr.E("rate_limited", "操作过于频繁，请稍后再试", 429)
}
