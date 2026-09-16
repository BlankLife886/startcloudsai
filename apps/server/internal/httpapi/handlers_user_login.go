package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// emailCodeTTL 给邮件投递留出足够余量：Gmail/QQ 偶发延迟几分钟很常见，过短的
// 有效期会让用户收到时验证码已经作废。每封验证码最多只允许 5 次猜测（见
// consumeEmailCodeTx），因此延长有效期不会实质降低 6 位验证码的强度。
const emailCodeTTL = 10 * time.Minute

func normalizeLoginEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if !validEmail(email) {
		return "", false
	}
	at := strings.LastIndex(email, "@")
	local, domain := email[:at], email[at+1:]
	switch domain {
	case "gmail.com", "googlemail.com":
		if plus := strings.IndexByte(local, '+'); plus >= 0 {
			local = local[:plus]
		}
		local = strings.ReplaceAll(local, ".", "")
		if local == "" {
			return "", false
		}
		return local + "@gmail.com", true
	case "qq.com":
		return email, true
	default:
		return "", false
	}
}

func (s *Server) loginCodeHash(email, code string) string {
	mac := hmac.New(sha256.New, []byte(s.Cfg.AppSecret))
	_, _ = mac.Write([]byte(email + "\x00" + code))
	return hex.EncodeToString(mac.Sum(nil))
}

func randomDigits(n int) string {
	buf := make([]byte, n)
	for i := range buf {
		v, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			panic(err)
		}
		buf[i] = "0123456789"[v.Int64()]
	}
	return string(buf)
}

func randomProfileName() string {
	return "星空用户 " + randomDigits(6)
}

func (s *Server) sendLoginCode(email, code string) error {
	return s.sendPlainEmail(
		email,
		"StarCloudsAI verification code",
		fmt.Sprintf("Your login code is: %s\nIt expires in %d minutes.\n",
			code, int(emailCodeTTL.Minutes())),
	)
}

// takeLoginCodeQuota 限制验证码邮件的发送量。它刻意与 LoginLimiter 分开计数：
// LoginLimiter 负责"验证码被猜错"的防爆破并且会拦住校验请求，而这里只在请求通过
// 重发间隔检查、即将发出一封新邮件时扣减额度；额度耗尽只会拒绝继续发码，不影响
// 用户校验手里已有的验证码。
func (s *Server) takeLoginCodeQuota(c *gin.Context, email, clientIP string) error {
	if err := s.takeUsageLimitMessage(c, "login-code-email-hour", email,
		loginCodesPerEmailHour, 1, time.Hour,
		"验证码获取次数过多，请稍后再试；已收到的验证码仍然可用"); err != nil {
		return err
	}
	if clientIP == "" {
		return nil
	}
	return s.takeUsageLimitMessage(c, "login-code-ip-hour", clientIP,
		loginCodesPerIPHour, 1, time.Hour,
		"当前网络获取验证码过于频繁，请稍后再试；已收到的验证码仍然可用")
}

func (s *Server) authProviders(c *gin.Context) {
	developmentCodeEcho := s.Cfg.AppEnv == "development" && s.Cfg.DevLoginCodeEcho && !s.smtpConfigured()
	ok(c, gin.H{
		"email":            developmentCodeEcho || s.smtpConfigured(),
		"verificationCode": true,
		"emailDomains":     []string{"gmail.com", "googlemail.com", "qq.com"},
	})
}

func (s *Server) requestEmailLoginCode(c *gin.Context) {
	var body struct {
		Email string `json:"email"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	email, emailOK := normalizeLoginEmail(body.Email)
	if !emailOK {
		fail(c, apperr.E("validation_error", "仅支持 Gmail、Googlemail 和 QQ 邮箱", 422))
		return
	}
	developmentCodeEcho := s.Cfg.AppEnv == "development" && s.Cfg.DevLoginCodeEcho && !s.smtpConfigured()
	if !developmentCodeEcho && !s.smtpConfigured() {
		fail(c, apperr.E("email_unavailable", "邮箱验证码服务暂不可用，请联系管理员", 503))
		return
	}
	clientIP := c.ClientIP()
	// 只读检查登录锁：因为验证码填错而被锁定的邮箱/IP 不允许继续获取新码。
	// 这里不能用 Reserve——它会把"发码"写进 LoginLimiter 的失败计数，导致从未
	// 输错过的用户重发几次就被锁住，拿着刚收到的有效验证码也登不进去。
	if remain, allowed := s.LoginLimiter.Check(email, clientIP); !allowed {
		fail(c, apperr.E("rate_limited", auth.LockMessage(remain), 429))
		return
	}
	ctx := c.Request.Context()
	// 重复点击要在扣减额度和覆盖已有验证码之前就被拦下：被防重发挡掉的请求既不
	// 发邮件，也不该消耗发码额度，更不能作废用户手里那封还没用的验证码。
	recent, err := store.RecentEmailLoginCodeExists(ctx, s.St.Pool, email, time.Minute)
	if err != nil {
		fail(c, err)
		return
	}
	if recent {
		fail(c, apperr.E("rate_limited", "验证码发送过于频繁，请稍后再试", 429))
		return
	}
	// 发码额度独立于登录失败计数，只限制"能发多少封邮件"。额度耗尽时这里直接
	// 返回，已经发出的验证码保持有效，用户仍然可以完成登录。
	if err := s.takeLoginCodeQuota(c, email, clientIP); err != nil {
		fail(c, err)
		return
	}
	code := randomDigits(6)
	var ip *string
	if clientIP != "" {
		ip = &clientIP
	}
	// 重发间隔检查与写入新码在同一条语句内完成，并发同邮箱请求只有一个能
	// 写入，不会出现两条邮件里的验证码互相覆盖导致先发的失效。
	written, err := store.UpsertEmailLoginCodeIfStale(ctx, s.St.Pool, email, "authenticate",
		s.loginCodeHash(email, code), time.Now().UTC().Add(emailCodeTTL), ip, time.Minute)
	if err != nil {
		fail(c, err)
		return
	}
	if !written {
		fail(c, apperr.E("rate_limited", "验证码发送过于频繁，请稍后再试", 429))
		return
	}
	if !developmentCodeEcho {
		if err := s.sendLoginCode(email, code); err != nil {
			_ = store.DeleteEmailLoginCode(ctx, s.St.Pool, email)
			fail(c, apperr.E("email_unavailable", "验证码邮件发送失败，请稍后重试", 503))
			return
		}
	}
	result := gin.H{"expiresIn": int(emailCodeTTL.Seconds()), "resendAfter": 60}
	// 验证码回显必须由 DEV_LOGIN_CODE_ECHO 显式开启（生产环境在 config 层强制
	// 关闭），APP_ENV=development 本身不再触发回显。
	if developmentCodeEcho {
		result["developmentCode"] = code
	}
	// Verification codes are ephemeral; 200 avoids 201-without-Location quirks
	// in some reverse proxies that can strip or alter the JSON body.
	ok(c, result)
}

type emailCodeState uint8

const (
	emailCodeValid emailCodeState = iota
	emailCodeInvalid
	emailCodeLocked
	emailCodeExpired
)

func (s *Server) consumeEmailCodeTx(ctx context.Context, tx pgx.Tx, email, code string) (emailCodeState, error) {
	purpose, hash, expires, attempts, _, err := store.GetEmailLoginCodeForUpdate(ctx, tx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return emailCodeInvalid, nil
	}
	if err != nil {
		return emailCodeInvalid, err
	}
	// 验证码超时不是猜测行为：邮件延迟送达是常态，用户拿着迟到的验证码提交时
	// 不能计入防爆破失败次数，否则几次延迟就会把人锁在门外。这一行只可能在
	// 真的发出过一封验证码之后走到，攻击者无法借它换取额外的猜测机会。
	if expires.Before(time.Now().UTC()) {
		return emailCodeExpired, store.DeleteEmailLoginCode(ctx, tx, email)
	}
	if attempts >= 5 {
		return emailCodeLocked, nil
	}
	if purpose != "authenticate" || !hmac.Equal([]byte(hash), []byte(s.loginCodeHash(email, code))) {
		return emailCodeInvalid, store.IncrementEmailLoginAttempts(ctx, tx, email)
	}
	return emailCodeValid, store.DeleteEmailLoginCode(ctx, tx, email)
}
