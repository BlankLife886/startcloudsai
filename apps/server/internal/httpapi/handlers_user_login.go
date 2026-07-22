package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/smtp"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const (
	emailCodeTTL  = 10 * time.Minute
	oauthStateTTL = 10 * time.Minute
)

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
	case "reset":
		return "reset", true
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
	action := "registration"
	if purpose == "reset" {
		action = "password reset"
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
		"github":       s.Cfg.GitHubClientID != "" && s.Cfg.GitHubClientSecret != "",
		"email":        s.Cfg.AppEnv == "development" || (s.Cfg.SMTPAddr != "" && s.Cfg.SMTPFrom != ""),
		"password":     true,
		"emailDomains": []string{"gmail.com", "googlemail.com", "qq.com"},
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
		fail(c, apperr.E("validation_error", "purpose: 仅支持 register 或 reset", 422))
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
	if purpose == "reset" && user == nil {
		fail(c, apperr.E("registration_required", "该邮箱尚未注册", 404))
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

func (s *Server) verifiedUser(ctx context.Context, tx pgx.Tx, email, username, provider, subject string) (*store.User, bool, error) {
	if provider != "email" {
		if user, err := store.GetUserByIdentity(ctx, tx, provider, subject); err != nil {
			return nil, false, err
		} else if user != nil {
			return user, false, nil
		}
	}
	user, err := store.GetUserByEmail(ctx, tx, email)
	if err != nil {
		return nil, false, err
	}
	created := false
	if user == nil {
		enabled, err := settings.GetBool(ctx, tx, "registration_enabled")
		if err != nil {
			return nil, false, err
		}
		if !enabled {
			return nil, false, apperr.E("registration_closed", "当前未开放新用户注册", 403)
		}
		if username == "" {
			username = strings.Split(email, "@")[0]
		}
		disabledPassword, err := auth.HashPassword(auth.NewSessionToken())
		if err != nil {
			return nil, false, err
		}
		now := time.Now().UTC()
		user, err = store.InsertUser(ctx, tx, email, username, disabledPassword, "user", &now)
		if err != nil {
			return nil, false, err
		}
		if err = store.InsertWallet(ctx, tx, user.ID); err != nil {
			return nil, false, err
		}
		bonus, err := settings.GetInt(ctx, tx, "signup_bonus_cents")
		if err != nil {
			return nil, false, err
		}
		if bonus > 0 {
			reason := "验证注册赠送"
			if _, err = wallet.Grant(ctx, tx, user.ID, bonus, "grant", "verified_signup_bonus", user.ID.String(), &reason); err != nil {
				return nil, false, err
			}
		}
		created = true
	}
	if user.Role != "user" || user.Status != "active" {
		return nil, false, apperr.E("invalid_credentials", "账号不可用", 403)
	}
	if provider != "email" {
		if err := store.UpsertUserIdentity(ctx, tx, user.ID, provider, subject, email); err != nil {
			return nil, false, err
		}
	}
	return user, created, nil
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

type oauthProvider struct{ clientID, clientSecret, authorizeURL, tokenURL, userURL, scope string }

func (s *Server) oauthConfig(provider string) (oauthProvider, bool) {
	switch provider {
	case "github":
		return oauthProvider{s.Cfg.GitHubClientID, s.Cfg.GitHubClientSecret, "https://github.com/login/oauth/authorize", "https://github.com/login/oauth/access_token", "https://api.github.com/user", "read:user user:email"}, s.Cfg.GitHubClientID != "" && s.Cfg.GitHubClientSecret != ""
	default:
		return oauthProvider{}, false
	}
}

func (s *Server) oauthCallbackURL() string {
	return strings.TrimRight(s.Cfg.PublicBaseURL, "/") + "/api/auth/oauth/github/callback"
}

func (s *Server) oauthStart(c *gin.Context) {
	provider := "github"
	cfg, enabled := s.oauthConfig(provider)
	if !enabled {
		fail(c, apperr.E("provider_unavailable", "登录方式尚未配置", 503))
		return
	}
	state := auth.NewSessionToken()
	if err := store.InsertOAuthState(c.Request.Context(), s.St.Pool, auth.HashToken(state), provider, time.Now().UTC().Add(oauthStateTTL)); err != nil {
		fail(c, err)
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("sc_oauth_state", state, int(oauthStateTTL.Seconds()), "/api/auth/oauth/", "", s.Cfg.AppEnv == "production", true)
	q := url.Values{"client_id": {cfg.clientID}, "redirect_uri": {s.oauthCallbackURL()}, "scope": {cfg.scope}, "state": {state}, "response_type": {"code"}}
	c.Redirect(http.StatusFound, cfg.authorizeURL+"?"+q.Encode())
}

func oauthJSON(ctx context.Context, method, endpoint string, values url.Values, token string, out any) error {
	var body io.Reader
	if values != nil {
		body = strings.NewReader(values.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	if values != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "StarCloudsAI")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("OAuth 服务返回 %d", resp.StatusCode)
	}
	return json.Unmarshal(data, out)
}

func (s *Server) oauthCallback(c *gin.Context) {
	provider := "github"
	cfg, enabled := s.oauthConfig(provider)
	state := c.Query("state")
	cookieState, _ := c.Cookie("sc_oauth_state")
	c.SetCookie("sc_oauth_state", "", -1, "/api/auth/oauth/", "", s.Cfg.AppEnv == "production", true)
	if !enabled || state == "" || cookieState == "" || !hmac.Equal([]byte(state), []byte(cookieState)) {
		s.oauthFailure(c, "登录状态已失效")
		return
	}
	valid, err := store.ConsumeOAuthState(c.Request.Context(), s.St.Pool, auth.HashToken(state), provider, time.Now().UTC())
	if err != nil || !valid || c.Query("code") == "" {
		s.oauthFailure(c, "登录授权失败")
		return
	}
	values := url.Values{"client_id": {cfg.clientID}, "client_secret": {cfg.clientSecret}, "code": {c.Query("code")}, "redirect_uri": {s.oauthCallbackURL()}}
	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	if err = oauthJSON(c.Request.Context(), http.MethodPost, cfg.tokenURL, values, "", &tokenResp); err != nil || tokenResp.AccessToken == "" {
		s.oauthFailure(c, "登录授权失败")
		return
	}
	email, username, subject, verified, err := s.oauthProfile(c.Request.Context(), cfg.userURL, tokenResp.AccessToken)
	if err != nil || !verified || !validEmail(email) {
		s.oauthFailure(c, "第三方账号未提供已验证邮箱")
		return
	}
	ctx := c.Request.Context()
	var user *store.User
	var sessionToken string
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		user, _, err = s.verifiedUser(ctx, tx, email, username, provider, subject)
		if err != nil {
			return err
		}
		if err = store.TouchLastLogin(ctx, tx, user.ID, time.Now().UTC()); err != nil {
			return err
		}
		sessionToken, err = s.createSession(c, tx, user.ID)
		return err
	})
	if err != nil {
		s.oauthFailure(c, "账号登录失败")
		return
	}
	s.setSessionCookie(c, sessionToken)
	c.Redirect(http.StatusFound, "/auth?oauth=success")
}

func (s *Server) oauthProfile(ctx context.Context, endpoint, token string) (email, username, subject string, verified bool, err error) {
	var p struct {
		ID                 int64
		Login, Name, Email string
	}
	if err = oauthJSON(ctx, http.MethodGet, endpoint, nil, token, &p); err != nil {
		return
	}
	email = strings.ToLower(p.Email)
	verified = email != ""
	if !verified {
		var emails []struct {
			Email             string
			Primary, Verified bool
		}
		if err = oauthJSON(ctx, http.MethodGet, "https://api.github.com/user/emails", nil, token, &emails); err != nil {
			return
		}
		for _, item := range emails {
			if item.Verified && (item.Primary || email == "") {
				email = strings.ToLower(item.Email)
				verified = true
				if item.Primary {
					break
				}
			}
		}
	}
	username = p.Name
	if username == "" {
		username = p.Login
	}
	subject = fmt.Sprint(p.ID)
	return
}

func (s *Server) oauthFailure(c *gin.Context, message string) {
	c.Redirect(http.StatusFound, "/auth?error="+url.QueryEscape(message))
}
