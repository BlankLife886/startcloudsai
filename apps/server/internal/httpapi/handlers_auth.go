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
	Email    string  `json:"email"`
	Password string  `json:"password"`
	Username *string `json:"username"`
}

func (s *Server) register(c *gin.Context) {
	var body registerIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if !validEmail(body.Email) {
		fail(c, apperr.E("validation_error", "email: 邮箱格式不正确", 422))
		return
	}
	if len(body.Password) < 6 || len(body.Password) > 128 {
		fail(c, apperr.E("validation_error", "password: 长度须在 6-128 之间", 422))
		return
	}
	if body.Username != nil && len([]rune(*body.Username)) > 64 {
		fail(c, apperr.E("validation_error", "username: 长度不能超过 64", 422))
		return
	}
	ctx := c.Request.Context()

	enabled, err := settings.GetBool(ctx, s.St.Pool, "registration_enabled")
	if err != nil {
		fail(c, err)
		return
	}
	if !enabled {
		fail(c, apperr.E("validation_error", "当前未开放注册", 403))
		return
	}

	email := strings.ToLower(body.Email)
	existing, err := store.GetUserByEmail(ctx, s.St.Pool, email)
	if err != nil {
		fail(c, err)
		return
	}
	if existing != nil {
		fail(c, apperr.E("email_exists", "该邮箱已注册", 409))
		return
	}

	username := strings.TrimSpace(email[:strings.Index(email, "@")])
	if body.Username != nil && strings.TrimSpace(*body.Username) != "" {
		username = strings.TrimSpace(*body.Username)
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
		var ierr error
		user, ierr = store.InsertUser(ctx, tx, email, username, passwordHash, "user", &now)
		if ierr != nil {
			return ierr
		}
		if ierr = store.InsertWallet(ctx, tx, user.ID); ierr != nil {
			return ierr
		}
		bonus, ierr := settings.GetInt(ctx, tx, "signup_bonus_cents")
		if ierr != nil {
			return ierr
		}
		if bonus > 0 {
			reason := "注册赠送"
			if _, ierr = wallet.Grant(ctx, tx, user.ID, bonus, "grant", "signup_bonus", user.ID.String(), &reason); ierr != nil {
				return ierr
			}
		}
		token, ierr = s.createSession(c, tx, user.ID)
		return ierr
	})
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("email_exists", "该邮箱已注册", 409))
			return
		}
		fail(c, err)
		return
	}
	s.setSessionCookie(c, token)
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
	if !validEmail(body.Email) {
		fail(c, apperr.E("validation_error", "email: 邮箱格式不正确", 422))
		return
	}
	ctx := c.Request.Context()
	user, err := store.GetUserByEmail(ctx, s.St.Pool, strings.ToLower(body.Email))
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil || !auth.VerifyPassword(body.Password, user.PasswordHash) {
		fail(c, apperr.E("invalid_credentials", "邮箱或密码错误", 401))
		return
	}
	if user.Status != "active" {
		fail(c, apperr.E("invalid_credentials", "账号已被禁用", 403))
		return
	}
	var token string
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if terr := store.TouchLastLogin(ctx, tx, user.ID, time.Now().UTC()); terr != nil {
			return terr
		}
		var serr error
		token, serr = s.createSession(c, tx, user.ID)
		return serr
	})
	if err != nil {
		fail(c, err)
		return
	}
	s.setSessionCookie(c, token)
	ok(c, gin.H{"user": userDict(user)})
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
