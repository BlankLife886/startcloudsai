package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	adminSessionCookieName = "sc_admin_session"
	adminSessionTTL        = 12 * time.Hour
	adminRenewThreshold    = 6 * time.Hour
)

func adminAccountDict(admin *store.AdminAccount) gin.H {
	return gin.H{
		"id":        admin.ID.String(),
		"email":     admin.Email,
		"username":  admin.Username,
		"role":      "admin",
		"createdAt": isoValue(admin.CreatedAt),
	}
}

func adminAccountAsUser(admin *store.AdminAccount) *store.User {
	return &store.User{
		ID:           admin.ID,
		Email:        admin.Email,
		Username:     admin.Username,
		PasswordHash: admin.PasswordHash,
		Role:         "admin",
		Status:       admin.Status,
		LastLoginAt:  admin.LastLoginAt,
		CreatedAt:    admin.CreatedAt,
	}
}

func (s *Server) setAdminSessionCookie(c *gin.Context, token string, maxAge int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(adminSessionCookieName, token, maxAge, "/api", "",
		s.Cfg.AppEnv == "production", true)
}

func (s *Server) createAdminSession(c *gin.Context, q store.Q, admin *store.AdminAccount) (string, error) {
	token := auth.NewSessionToken()
	expiresAt := time.Now().UTC().Add(adminSessionTTL)
	var ip *string
	if value := c.ClientIP(); value != "" {
		ip = &value
	}
	var userAgent *string
	if value := c.GetHeader("User-Agent"); value != "" {
		runes := []rune(value)
		if len(runes) > 500 {
			runes = runes[:500]
		}
		value = string(runes)
		userAgent = &value
	}
	if err := store.InsertAdminSession(c.Request.Context(), q, admin.ID, auth.HashToken(token),
		expiresAt, ip, userAgent); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Server) adminLogin(c *gin.Context) {
	auditEmail := ""
	var auditAdmin *store.AdminAccount
	defer func() {
		if auditEmail == "" {
			return
		}
		s.writeAdminAuthAudit("auth.login", auditEmail, c.Request.Method, c.Request.URL.Path,
			c.Writer.Status(), c.ClientIP(), auditAdmin)
	}()
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if !validEmail(email) {
		s.AdminLoginLimiter.Reserve("invalid", c.ClientIP())
		fail(c, apperr.E("validation_error", "email: 邮箱格式不正确", 422))
		return
	}
	auditEmail = truncateRunes(email, 254)
	clientIP := c.ClientIP()
	if remain, allowed := s.AdminLoginLimiter.Reserve(email, clientIP); !allowed {
		fail(c, apperr.E("rate_limited", auth.LockMessage(remain), 429))
		return
	}
	ctx := c.Request.Context()
	admin, err := store.GetAdminAccountByEmail(ctx, s.St.Pool, email)
	if err != nil {
		fail(c, err)
		return
	}
	if admin == nil || !auth.VerifyPassword(body.Password, admin.PasswordHash) {
		fail(c, apperr.E("invalid_credentials", "管理员邮箱或密码错误", 401))
		return
	}
	if admin.Status != "active" {
		fail(c, apperr.E("invalid_credentials", "管理员账号已停用", 403))
		return
	}
	s.AdminLoginLimiter.SuccessAttempt(email, clientIP)
	auditAdmin = admin

	var token string
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		if terr := store.TouchAdminLastLogin(ctx, tx, admin.ID, now); terr != nil {
			return terr
		}
		admin.LastLoginAt = &now
		var serr error
		token, serr = s.createAdminSession(c, tx, admin)
		return serr
	})
	if err != nil {
		fail(c, err)
		return
	}
	s.setAdminSessionCookie(c, token, int(adminSessionTTL/time.Second))
	ok(c, gin.H{"admin": adminAccountDict(admin)})
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) > max {
		return string(runes[:max])
	}
	return value
}

func (s *Server) adminLogout(c *gin.Context) {
	admin, err := s.currentAdminAccount(c)
	if err != nil {
		fail(c, err)
		return
	}
	defer func() {
		s.writeAdminAuthAudit("auth.logout", "", c.Request.Method, c.Request.URL.Path,
			c.Writer.Status(), c.ClientIP(), admin)
	}()
	if token, err := c.Cookie(adminSessionCookieName); err == nil && token != "" {
		if err := store.DeleteAdminSessionByTokenHash(c.Request.Context(), s.St.Pool,
			auth.HashToken(token)); err != nil {
			fail(c, err)
			return
		}
	}
	s.setAdminSessionCookie(c, "", -1)
	ok(c, gin.H{})
}

func (s *Server) adminAuthMe(c *gin.Context) {
	admin, err := s.currentAdminAccount(c)
	if err != nil {
		fail(c, err)
		return
	}
	if admin == nil {
		ok(c, gin.H{"admin": nil})
		return
	}
	ok(c, gin.H{"admin": adminAccountDict(admin)})
}

func (s *Server) adminChangePassword(c *gin.Context) {
	admin, err := s.requireAdminAccount(c)
	if err != nil {
		fail(c, err)
		return
	}
	defer func() {
		s.writeAdminAuthAudit("auth.password-change", "", c.Request.Method, c.Request.URL.Path,
			c.Writer.Status(), c.ClientIP(), admin)
	}()
	var body struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if !auth.VerifyPassword(body.Old, admin.PasswordHash) {
		fail(c, apperr.E("invalid_credentials", "原密码错误", 422))
		return
	}
	if auth.ValidateAdminPassword(body.New) != nil {
		fail(c, apperr.E("validation_error", "new: 长度须在 12-72 字节之间", 422))
		return
	}
	hash, err := auth.HashPassword(body.New)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if terr := store.UpdateAdminPassword(ctx, tx, admin.ID, hash); terr != nil {
			return terr
		}
		return store.DeleteAdminSessionsByAdmin(ctx, tx, admin.ID)
	})
	if err != nil {
		fail(c, err)
		return
	}
	s.setAdminSessionCookie(c, "", -1)
	ok(c, gin.H{})
}
