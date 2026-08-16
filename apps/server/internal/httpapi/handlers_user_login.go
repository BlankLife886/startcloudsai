package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const emailCodeTTL = 3 * time.Minute

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
		buf[i] = byte('0' + v.Int64())
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
		"Your login code is: "+code+"\nIt expires in 3 minutes.\n",
	)
}

func (s *Server) authProviders(c *gin.Context) {
	ok(c, gin.H{
		"email":            s.Cfg.AppEnv == "development" || (s.Cfg.SMTPAddr != "" && s.Cfg.SMTPFrom != ""),
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
	if remain, allowed := s.LoginLimiter.Reserve(email, c.ClientIP()); !allowed {
		fail(c, apperr.E("rate_limited", auth.LockMessage(remain), 429))
		return
	}
	ctx := c.Request.Context()
	if _, _, _, _, created, err := store.GetEmailLoginCodeForUpdate(ctx, s.St.Pool, email); err == nil && time.Since(created) < time.Minute {
		fail(c, apperr.E("rate_limited", "验证码发送过于频繁，请稍后再试", 429))
		return
	}
	code := randomDigits(6)
	var ip *string
	if v := c.ClientIP(); v != "" {
		ip = &v
	}
	if err := store.UpsertEmailLoginCode(ctx, s.St.Pool, email, "authenticate", s.loginCodeHash(email, code), time.Now().UTC().Add(emailCodeTTL), ip); err != nil {
		fail(c, err)
		return
	}
	if err := s.sendLoginCode(email, code); err != nil {
		_ = store.DeleteEmailLoginCode(ctx, s.St.Pool, email)
		fail(c, apperr.E("email_unavailable", "验证码邮件发送失败，请稍后重试", 503))
		return
	}
	result := gin.H{"expiresIn": int(emailCodeTTL.Seconds()), "resendAfter": 60}
	if s.Cfg.AppEnv == "development" && s.Cfg.SMTPAddr == "" {
		result["developmentCode"] = code
	}
	respondCreated(c, result)
}

type emailCodeState uint8

const (
	emailCodeValid emailCodeState = iota
	emailCodeInvalid
	emailCodeLocked
)

func (s *Server) consumeEmailCodeTx(ctx context.Context, tx pgx.Tx, email, code string) (emailCodeState, error) {
	purpose, hash, expires, attempts, _, err := store.GetEmailLoginCodeForUpdate(ctx, tx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return emailCodeInvalid, nil
	}
	if err != nil {
		return emailCodeInvalid, err
	}
	if expires.Before(time.Now().UTC()) {
		return emailCodeInvalid, store.DeleteEmailLoginCode(ctx, tx, email)
	}
	if attempts >= 5 {
		return emailCodeLocked, nil
	}
	if purpose != "authenticate" || !hmac.Equal([]byte(hash), []byte(s.loginCodeHash(email, code))) {
		return emailCodeInvalid, store.IncrementEmailLoginAttempts(ctx, tx, email)
	}
	return emailCodeValid, store.DeleteEmailLoginCode(ctx, tx, email)
}
