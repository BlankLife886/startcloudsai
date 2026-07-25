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
	"net/smtp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const emailCodeTTL = 10 * time.Minute

func supportedLoginEmail(email string) bool {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	switch strings.ToLower(email[at+1:]) {
	case "gmail.com", "googlemail.com", "qq.com":
		return true
	default:
		return false
	}
}

func emailAuthPurpose(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "register":
		return "register", true
	case "login":
		return "login", true
	default:
		return "", false
	}
}

func (s *Server) loginCodeHash(email, purpose, code string) string {
	mac := hmac.New(sha256.New, []byte(s.Cfg.AppSecret))
	_, _ = mac.Write([]byte(strings.ToLower(email) + "\x00" + purpose + "\x00" + code))
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

func (s *Server) sendLoginCode(email, purpose, code string) error {
	if s.Cfg.SMTPAddr == "" || s.Cfg.SMTPFrom == "" {
		if s.Cfg.AppEnv == "development" {
			return nil
		}
		return fmt.Errorf("SMTP 未配置")
	}
	host := s.Cfg.SMTPAddr
	if colon := strings.LastIndex(host, ":"); colon > 0 {
		host = host[:colon]
	}
	var smtpAuth smtp.Auth
	if s.Cfg.SMTPUser != "" {
		smtpAuth = smtp.PlainAuth("", s.Cfg.SMTPUser, s.Cfg.SMTPPassword, host)
	}
	action := "sign in"
	if purpose == "register" {
		action = "registration"
	}
	message := []byte("From: " + s.Cfg.SMTPFrom + "\r\n" +
		"To: " + email + "\r\n" +
		"Subject: StarCloudsAI " + action + " code\r\n" +
		"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" +
		"Your login code is: " + code + "\r\nIt expires in 10 minutes.\r\n")
	return smtp.SendMail(s.Cfg.SMTPAddr, smtpAuth, s.Cfg.SMTPFrom, []string{email}, message)
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
		Email   string `json:"email"`
		Purpose string `json:"purpose"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	purpose, purposeOK := emailAuthPurpose(body.Purpose)
	if !purposeOK {
		fail(c, apperr.E("validation_error", "purpose: 仅支持 register 或 login", 422))
		return
	}
	if !validEmail(email) || !supportedLoginEmail(email) {
		fail(c, apperr.E("validation_error", "仅支持 Gmail、Googlemail 和 QQ 邮箱", 422))
		return
	}
	if remain, allowed := s.LoginLimiter.Reserve(email, c.ClientIP()); !allowed {
		fail(c, apperr.E("rate_limited", auth.LockMessage(remain), 429))
		return
	}
	ctx := c.Request.Context()
	user, err := store.GetUserByEmail(ctx, s.St.Pool, email)
	if err != nil {
		fail(c, err)
		return
	}
	if purpose == "register" && user != nil {
		fail(c, apperr.E("email_exists", "该邮箱已注册，请直接登录", 409))
		return
	}
	if purpose == "login" && (user == nil || user.Role != "user") {
		fail(c, apperr.E("registration_required", "该邮箱尚未注册", 404))
		return
	}
	if purpose == "login" && user.Status != "active" {
		fail(c, apperr.E("invalid_credentials", "账号已被禁用", 403))
		return
	}
	if _, _, _, _, created, err := store.GetEmailLoginCodeForUpdate(ctx, s.St.Pool, email); err == nil && time.Since(created) < time.Minute {
		fail(c, apperr.E("rate_limited", "验证码发送过于频繁，请稍后再试", 429))
		return
	}
	code := randomDigits(6)
	var ip *string
	if v := c.ClientIP(); v != "" {
		ip = &v
	}
	if err := store.UpsertEmailLoginCode(ctx, s.St.Pool, email, purpose, s.loginCodeHash(email, purpose, code), time.Now().UTC().Add(emailCodeTTL), ip); err != nil {
		fail(c, err)
		return
	}
	if err := s.sendLoginCode(email, purpose, code); err != nil {
		_ = store.DeleteEmailLoginCode(ctx, s.St.Pool, email)
		fail(c, apperr.E("email_unavailable", "验证码邮件发送失败，请稍后重试", 503))
		return
	}
	result := gin.H{"expiresIn": int(emailCodeTTL.Seconds()), "resendAfter": 60}
	if s.Cfg.AppEnv == "development" && s.Cfg.SMTPAddr == "" {
		result["developmentCode"] = code
	}
	ok(c, result)
}

func (s *Server) consumeEmailCode(ctx context.Context, email, purpose, code string) error {
	invalidCode := false
	locked := false
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		storedPurpose, hash, expires, attempts, _, err := store.GetEmailLoginCodeForUpdate(ctx, tx, email)
		if errors.Is(err, pgx.ErrNoRows) {
			invalidCode = true
			return nil
		}
		if err != nil {
			return err
		}
		if expires.Before(time.Now().UTC()) {
			invalidCode = true
			return store.DeleteEmailLoginCode(ctx, tx, email)
		}
		if attempts >= 5 {
			locked = true
			return nil
		}
		if storedPurpose != purpose || !hmac.Equal([]byte(hash), []byte(s.loginCodeHash(email, purpose, code))) {
			invalidCode = true
			return store.IncrementEmailLoginAttempts(ctx, tx, email)
		}
		return store.DeleteEmailLoginCode(ctx, tx, email)
	})
	if err != nil {
		return err
	}
	if locked {
		return apperr.E("rate_limited", "验证码错误次数过多，请重新获取", 429)
	}
	if invalidCode {
		return apperr.E("invalid_code", "验证码错误或已过期", 401)
	}
	return nil
}
