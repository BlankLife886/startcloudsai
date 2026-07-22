package httpapi

import (
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

var errBadBody = apperr.E("validation_error", "参数校验失败", 422)

// bindJSON 解析请求体，格式错误统一 422 validation_error。
func bindJSON(c *gin.Context, dst any) error {
	if err := c.ShouldBindJSON(dst); err != nil {
		return errBadBody
	}
	return nil
}

// validEmail 与 pydantic EmailStr 近似：RFC 地址 + 域名带点。
func validEmail(email string) bool {
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		return false
	}
	at := strings.LastIndex(email, "@")
	return at > 0 && strings.Contains(email[at+1:], ".")
}

func (s *Server) setSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(s.Cfg.SessionCookieName, token, s.Cfg.SessionTTLDays*86400, "/", "",
		s.Cfg.AppEnv == "production", true)
}

// createSession 在事务内写 session 记录，返回明文 token。
func (s *Server) createSession(c *gin.Context, q store.Q, userID uuid.UUID) (string, error) {
	token := auth.NewSessionToken()
	expiresAt := time.Now().UTC().Add(time.Duration(s.Cfg.SessionTTLDays) * 24 * time.Hour)
	var ip *string
	if v := c.ClientIP(); v != "" {
		ip = &v
	}
	var userAgent *string
	if ua := c.GetHeader("User-Agent"); ua != "" {
		r := []rune(ua)
		if len(r) > 500 {
			r = r[:500]
		}
		v := string(r)
		userAgent = &v
	}
	if err := store.InsertSession(c.Request.Context(), q, userID, auth.HashToken(token), expiresAt, ip, userAgent); err != nil {
		return "", err
	}
	return token, nil
}

type registerIn struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Code     string `json:"code"`
	Password string `json:"password"`
}

func (s *Server) register(c *gin.Context) {
	var body registerIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	username := strings.TrimSpace(body.Username)
	code := strings.TrimSpace(body.Code)
	if !validEmail(email) || !supportedLoginEmail(email) {
		fail(c, apperr.E("validation_error", "仅支持 Gmail、Googlemail 和 QQ 邮箱", 422))
		return
	}
	if username == "" || len([]rune(username)) > 64 {
		fail(c, apperr.E("validation_error", "username: 长度须在 1-64 之间", 422))
		return
	}
	if len(code) != 6 {
		fail(c, apperr.E("invalid_code", "验证码错误或已过期", 401))
		return
	}
	if auth.ValidateUserPassword(body.Password) != nil {
		fail(c, apperr.E("validation_error", "password: 长度须在 8-72 字节之间", 422))
		return
	}
	ctx := c.Request.Context()
	enabled, err := settings.GetBool(ctx, s.St.Pool, "registration_enabled")
	if err != nil {
		fail(c, err)
		return
	}
	if !enabled {
		fail(c, apperr.E("registration_closed", "当前未开放注册", 403))
		return
	}
	existing, err := store.GetUserByEmail(ctx, s.St.Pool, email)
	if err != nil {
		fail(c, err)
		return
	}
	if existing != nil {
		fail(c, apperr.E("email_exists", "该邮箱已注册，请直接登录", 409))
		return
	}
	if err = s.consumeEmailCode(ctx, email, "register", code); err != nil {
		fail(c, err)
		return
	}
	passwordHash, err := auth.HashPassword(body.Password)
	if err != nil {
		fail(c, err)
		return
	}
	var user *store.User
	var token string
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		var txErr error
		user, txErr = store.InsertUser(ctx, tx, email, username, passwordHash, "user", &now)
		if txErr != nil {
			return txErr
		}
		if txErr = store.InsertWallet(ctx, tx, user.ID); txErr != nil {
			return txErr
		}
		bonus, txErr := settings.GetInt(ctx, tx, "signup_bonus_cents")
		if txErr != nil {
			return txErr
		}
		if bonus > 0 {
			reason := "邮箱验证注册赠送"
			if _, txErr = wallet.Grant(ctx, tx, user.ID, bonus, "grant", "signup_bonus", user.ID.String(), &reason); txErr != nil {
				return txErr
			}
		}
		token, txErr = s.createSession(c, tx, user.ID)
		return txErr
	})
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("email_exists", "该邮箱已注册，请直接登录", 409))
			return
		}
		fail(c, err)
		return
	}
	s.setSessionCookie(c, token)
	s.LoginLimiter.SuccessAttempt(email, c.ClientIP())
	ok(c, gin.H{"user": userDict(user)})
}

type loginIn struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) login(c *gin.Context) {
	var body loginIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if !validEmail(email) || !supportedLoginEmail(email) {
		fail(c, apperr.E("validation_error", "仅支持 Gmail、Googlemail 和 QQ 邮箱", 422))
		return
	}
	clientIP := c.ClientIP()
	if remain, allowed := s.LoginLimiter.Reserve(email, clientIP); !allowed {
		fail(c, apperr.E("rate_limited", auth.LockMessage(remain), 429))
		return
	}
	ctx := c.Request.Context()
	user, err := store.GetUserByEmail(ctx, s.St.Pool, email)
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil || user.Role != "user" || !auth.VerifyPassword(body.Password, user.PasswordHash) {
		fail(c, apperr.E("invalid_credentials", "邮箱或密码错误", 401))
		return
	}
	if user.Status != "active" {
		fail(c, apperr.E("invalid_credentials", "账号已被禁用", 403))
		return
	}
	var token string
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if txErr := store.TouchLastLogin(ctx, tx, user.ID, time.Now().UTC()); txErr != nil {
			return txErr
		}
		var txErr error
		token, txErr = s.createSession(c, tx, user.ID)
		return txErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	s.LoginLimiter.SuccessAttempt(email, clientIP)
	s.setSessionCookie(c, token)
	ok(c, gin.H{"user": userDict(user)})
}

func (s *Server) resetUserPassword(c *gin.Context) {
	var body struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	code := strings.TrimSpace(body.Code)
	if !validEmail(email) || !supportedLoginEmail(email) || len(code) != 6 {
		fail(c, apperr.E("invalid_code", "验证码错误或已过期", 401))
		return
	}
	if auth.ValidateUserPassword(body.Password) != nil {
		fail(c, apperr.E("validation_error", "password: 长度须在 8-72 字节之间", 422))
		return
	}
	ctx := c.Request.Context()
	user, err := store.GetUserByEmail(ctx, s.St.Pool, email)
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil || user.Role != "user" {
		fail(c, apperr.E("registration_required", "该邮箱尚未注册", 404))
		return
	}
	if err = s.consumeEmailCode(ctx, email, "reset", code); err != nil {
		fail(c, err)
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		fail(c, err)
		return
	}
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if txErr := store.UpdateUserPassword(ctx, tx, user.ID, hash); txErr != nil {
			return txErr
		}
		_, txErr := store.DeleteSessionsByUser(ctx, tx, user.ID)
		return txErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(s.Cfg.SessionCookieName, "", -1, "/", "", s.Cfg.AppEnv == "production", true)
	s.LoginLimiter.SuccessAttempt(email, c.ClientIP())
	ok(c, gin.H{})
}

func (s *Server) logout(c *gin.Context) {
	if token, err := c.Cookie(s.Cfg.SessionCookieName); err == nil && token != "" {
		if err := store.DeleteSessionByTokenHash(c.Request.Context(), s.St.Pool, auth.HashToken(token)); err != nil {
			fail(c, err)
			return
		}
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(s.Cfg.SessionCookieName, "", -1, "/", "", s.Cfg.AppEnv == "production", true)
	ok(c, gin.H{})
}

func (s *Server) authMe(c *gin.Context) {
	user, err := s.currentUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil {
		ok(c, gin.H{"user": nil})
		return
	}
	ok(c, gin.H{"user": userDict(user)})
}
