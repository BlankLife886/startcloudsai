package httpapi

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// 滑动续期：剩余有效期低于该阈值时刷新 expires_at，避免每个请求都写库
const renewThreshold = 15 * 24 * time.Hour

// currentUser 从 cookie session 解析当前用户；未登录/失效返回 nil。
func (s *Server) currentUser(c *gin.Context) (*store.User, error) {
	token, err := c.Cookie(s.Cfg.SessionCookieName)
	if err != nil || token == "" {
		return nil, nil
	}
	ctx := c.Request.Context()
	now := time.Now().UTC()
	session, err := store.GetSessionByTokenHash(ctx, s.St.Pool, auth.HashToken(token))
	if err != nil {
		return nil, err
	}
	if session == nil || !session.ExpiresAt.After(now) {
		return nil, nil
	}
	user, err := store.GetUserByID(ctx, s.St.Pool, session.UserID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Status != "active" {
		return nil, nil
	}
	// 30 天滑动续期：剩余不足阈值时延长
	if session.ExpiresAt.Sub(now) < renewThreshold {
		newExpiry := now.Add(time.Duration(s.Cfg.SessionTTLDays) * 24 * time.Hour)
		if err := store.UpdateSessionExpiry(ctx, s.St.Pool, session.ID, newExpiry); err != nil {
			return nil, err
		}
	}
	return user, nil
}

// requireUser 未登录返回 auth_required。
func (s *Server) requireUser(c *gin.Context) (*store.User, error) {
	user, err := s.currentUser(c)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, apperr.E("auth_required", "请先登录", 401)
	}
	return user, nil
}

// requireAdmin 非管理员返回 admin_required。
func (s *Server) requireAdmin(c *gin.Context) (*store.User, error) {
	user, err := s.requireUser(c)
	if err != nil {
		return nil, err
	}
	if user.Role != "admin" {
		return nil, apperr.E("admin_required", "需要管理员权限", 403)
	}
	return user, nil
}

// adminOnly 包装后台 handler：先校验管理员，再执行。
func (s *Server) adminOnly(h func(c *gin.Context, admin *store.User)) gin.HandlerFunc {
	return func(c *gin.Context) {
		admin, err := s.requireAdmin(c)
		if err != nil {
			fail(c, err)
			return
		}
		h(c, admin)
	}
}
