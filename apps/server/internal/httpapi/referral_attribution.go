package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

const referralCookieName = "sc_referral"
const referralAttributionTTL = 30 * 24 * time.Hour

func signReferralCookie(code, secret string, expires time.Time) string {
	payload := code + "." + strconv.FormatInt(expires.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("referral-attribution/v1:" + payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + hex.EncodeToString(mac.Sum(nil))
}
func readReferralCookie(value, secret string, now time.Time) (string, time.Time) {
	if len(value) > 256 {
		return "", time.Time{}
	}
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return "", time.Time{}
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", time.Time{}
	}
	fields := strings.Split(string(raw), ".")
	if len(fields) != 2 || len(fields[0]) != 16 {
		return "", time.Time{}
	}
	at, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return "", time.Time{}
	}
	expires := time.Unix(at, 0)
	if !expires.After(now) || expires.After(now.Add(referralAttributionTTL+time.Minute)) {
		return "", time.Time{}
	}
	signature, err := hex.DecodeString(parts[1])
	if err != nil {
		return "", time.Time{}
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("referral-attribution/v1:" + string(raw)))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return "", time.Time{}
	}
	return fields[0], expires
}
func (s *Server) clearReferralCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(referralCookieName, "", -1, "/", "", s.Cfg.AppEnv == "production", true)
}
func (s *Server) referralCodeForRegistration(c *gin.Context, body verifyEmailIn) string {
	if body.SkipReferral {
		return ""
	}
	if code := strings.TrimSpace(body.ReferralCode); code != "" {
		return code
	}
	value, _ := c.Cookie(referralCookieName)
	code, _ := readReferralCookie(value, s.Cfg.AppSecret, time.Now())
	return code
}
func referralBindingMessage(status string) string {
	switch status {
	case "bound":
		return "注册成功，已绑定邀请关系"
	case "invalid":
		return "注册成功，但邀请码无效，未绑定邀请关系"
	case "disabled":
		return "注册成功，邀请活动暂未开启，未绑定邀请关系"
	case "existing_account":
		return "登录成功，已有账号不能补绑或更换邀请人"
	}
	return ""
}
func (s *Server) referralAttribution(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if c.Request.Method == http.MethodDelete {
		s.clearReferralCookie(c)
		ok(c, gin.H{"status": "none"})
		return
	}
	if !s.enforceUsageLimit(c, "referral-attribution-minute", c.ClientIP(), 30, 1, time.Minute) {
		return
	}
	user, err := s.currentUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	if user != nil {
		s.clearReferralCookie(c)
		ok(c, gin.H{"status": "existing_account", "message": "已有账号不能绑定新的邀请关系"})
		return
	}
	cfg, err := referral.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if !cfg.Enabled {
		s.clearReferralCookie(c)
		ok(c, gin.H{"status": "disabled", "message": "邀请活动暂未开启，仍可正常注册"})
		return
	}
	var code string
	var expires time.Time
	if c.Request.Method == http.MethodPost {
		var body struct {
			Code string `json:"code"`
		}
		if err := bindJSON(c, &body); err != nil {
			fail(c, err)
			return
		}
		code = strings.ToUpper(strings.TrimSpace(body.Code))
		expires = time.Now().Add(referralAttributionTTL)
	} else {
		value, _ := c.Cookie(referralCookieName)
		code, expires = readReferralCookie(value, s.Cfg.AppSecret, time.Now())
		if code == "" {
			ok(c, gin.H{"status": "none"})
			return
		}
	}
	var name string
	if len(code) == 16 {
		err = s.St.Pool.QueryRow(c.Request.Context(), `SELECT u.username FROM referral_codes r JOIN users u ON u.id=r.user_id WHERE r.code=$1 AND u.status='active' AND u.role='user'`, code).Scan(&name)
	} else {
		err = fmt.Errorf("invalid code")
	}
	if err != nil {
		if len(code) == 16 && !errors.Is(err, pgx.ErrNoRows) {
			fail(c, err)
			return
		}
		ok(c, gin.H{"status": "invalid", "message": "邀请码无效或邀请人不可用，继续注册将不绑定邀请关系"})
		return
	}
	if c.Request.Method == http.MethodPost {
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(referralCookieName, signReferralCookie(code, s.Cfg.AppSecret, expires), int(referralAttributionTTL.Seconds()), "/", "", s.Cfg.AppEnv == "production", true)
	}
	ok(c, gin.H{"status": "valid", "code": code, "inviterName": name, "expiresAt": expires, "message": "邀请资格已保留，首次注册成功后绑定"})
}
