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
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
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

type verifyEmailIn struct {
	Email        string `json:"email"`
	Code         string `json:"code"`
	ReferralCode string `json:"referralCode"`
	SkipReferral bool   `json:"skipReferral"`
}

func (s *Server) verifyEmailCode(c *gin.Context) {
	var body verifyEmailIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	email, emailOK := normalizeLoginEmail(body.Email)
	code := strings.TrimSpace(body.Code)
	if !emailOK {
		fail(c, apperr.E("validation_error", "仅支持 Gmail、Googlemail 和 QQ 邮箱", 422))
		return
	}
	if len(code) != 6 {
		fail(c, apperr.E("invalid_code", "验证码错误或已过期", 401))
		return
	}
	clientIP := c.ClientIP()
	// 防爆破只按邮箱维度计数，不带 IP：校园、公司和运营商 NAT 会让成百上千的正常
	// 用户共用一个出口 IP，一旦按 IP 锁定，少数人输错验证码就会让同网络的所有人
	// 都登不进去。针对 IP 的滥用防护改由发码额度承担（见 takeLoginCodeQuota）：
	// 猜测验证码必须先有一封已发出的验证码，限制发码量即可限制总猜测量，而且不会
	// 妨碍任何人使用手里已经收到的验证码。
	if remain, allowed := s.LoginLimiter.Check(email, ""); !allowed {
		fail(c, apperr.E("rate_limited", auth.LockMessage(remain), 429))
		return
	}
	ctx := c.Request.Context()
	var user *store.User
	var token string
	created := false
	referralCode := s.referralCodeForRegistration(c, body)
	referralStatus := "none"
	codeState := emailCodeValid
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		var txErr error
		codeState, txErr = s.consumeEmailCodeTx(ctx, tx, email, code)
		if txErr != nil || codeState != emailCodeValid {
			return txErr
		}
		user, txErr = store.GetUserByEmail(ctx, tx, email)
		if txErr != nil {
			return txErr
		}
		now := time.Now().UTC()
		if user == nil {
			enabled, settingErr := settings.GetBool(ctx, tx, "registration_enabled")
			if settingErr != nil {
				return settingErr
			}
			if !enabled {
				return apperr.E("registration_closed", "当前未开放新用户注册", 403)
			}
			// 名额在所有前置校验都通过之后才扣：额度记在 Redis 里，不随事务回滚，
			// 提前扣会让"注册未开放"或一次偶发数据库错误白白吃掉用户当天的名额。
			// clientIP 为空时跳过，避免把空 subject 传给限流器换来一个 503。
			if clientIP != "" {
				if limitErr := s.takeUsageLimit(c, "registration-ip-day", clientIP, registrationsPerIPDay, 1, 24*time.Hour); limitErr != nil {
					return limitErr
				}
			}
			passwordHash, hashErr := auth.HashPassword(auth.NewSessionToken())
			if hashErr != nil {
				return hashErr
			}
			user, txErr = store.InsertUser(ctx, tx, email, randomProfileName(), passwordHash, "user", &now)
			if txErr != nil {
				return txErr
			}
			if txErr = store.InsertWallet(ctx, tx, user.ID); txErr != nil {
				return txErr
			}
			bonus, bonusErr := settings.GetInt(ctx, tx, "signup_bonus_cents")
			if bonusErr != nil {
				return bonusErr
			}
			if bonus > 0 {
				reason := "邮箱验证注册赠送"
				if _, txErr = wallet.Grant(ctx, tx, user.ID, bonus, "grant", "signup_bonus", user.ID.String(), &reason); txErr != nil {
					return txErr
				}
			}
			if referralStatus, txErr = referral.BindNewAccountResult(ctx, tx, user.ID, referralCode); txErr != nil {
				return txErr
			}
			created = true
		} else if user.Role != "user" || user.Status != "active" {
			return apperr.E("invalid_credentials", "账号已被禁用", 403)
		}
		if txErr = store.TouchLastLogin(ctx, tx, user.ID, now); txErr != nil {
			return txErr
		}
		token, txErr = s.createSession(c, tx, user.ID)
		return txErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	if codeState == emailCodeExpired {
		// 超时不计失败次数：用户该做的只是重新获取一封验证码。
		fail(c, apperr.E("code_expired", "验证码已过期，请重新获取", 401))
		return
	}
	if codeState == emailCodeLocked {
		s.LoginLimiter.Fail(email, "")
		fail(c, apperr.E("rate_limited", "验证码错误次数过多，请重新获取", 429))
		return
	}
	if codeState != emailCodeValid {
		// 失败才计数：只有真正猜错的验证码计入邮箱失败窗口，配合下方成功时的
		// Success 重置，形成 fail-to-count + success-to-reset。
		s.LoginLimiter.Fail(email, "")
		fail(c, apperr.E("invalid_code", "验证码错误或已过期", 401))
		return
	}
	s.LoginLimiter.Success(email)
	c.Set(ctxPlatformUserKey, user)
	s.setSessionCookie(c, token)
	if !created && referralCode != "" {
		referralStatus = "existing_account"
	}
	s.clearReferralCookie(c)
	// Login/register establishes a session cookie; 200 matches common auth
	// clients and avoids intermediaries that mishandle 201 bodies without Location.
	ok(c, gin.H{"user": userDict(user), "isNewUser": created, "referral": gin.H{"status": referralStatus, "message": referralBindingMessage(referralStatus)}})
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
	respondNoContent(c)
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
