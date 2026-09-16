package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func newUserLoginTestServer(st *store.Store) *Server {
	cfg := config.Load()
	cfg.AppEnv = "development"
	cfg.AppSecret = "test-app-secret-at-least-thirty-two-bytes"
	cfg.SMTPAddr = ""
	cfg.SMTPFrom = ""
	// 回显验证码需要显式开关（不再随 development 自动开启），测试依赖回显取码。
	cfg.DevLoginCodeEcho = true
	return &Server{
		Cfg: cfg, St: st, LoginLimiter: auth.NewLoginLimiter(), AdminLoginLimiter: auth.NewLoginLimiter(),
		RedeemLimiter: auth.NewRedeemLimiter(), UsageLimiter: auth.NewMemoryUsageLimiter(),
	}
}

func developmentCode(t *testing.T, responseBody []byte) string {
	t.Helper()
	var response struct {
		Data struct {
			DevelopmentCode string `json:"developmentCode"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &response); err != nil || len(response.Data.DevelopmentCode) != 6 {
		t.Fatalf("development code response invalid: err=%v body=%s", err, responseBody)
	}
	return response.Data.DevelopmentCode
}

func requestDevelopmentCode(t *testing.T, engine http.Handler, email string) string {
	t.Helper()
	w := authRequest(t, engine, http.MethodPost, "/api/v1/auth/email-verification-codes", gin.H{"email": email})
	if w.Code != http.StatusOK {
		t.Fatalf("send code for %q = %d %s", email, w.Code, w.Body.String())
	}
	return developmentCode(t, w.Body.Bytes())
}

type verifyEmailResponse struct {
	Data struct {
		IsNewUser bool `json:"isNewUser"`
		User      struct {
			ID       string `json:"id"`
			Email    string `json:"email"`
			Username string `json:"username"`
		} `json:"user"`
	} `json:"data"`
}

func decodeVerifyEmailResponse(t *testing.T, body []byte) verifyEmailResponse {
	t.Helper()
	var response verifyEmailResponse
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("decode verify response: %v body=%s", err, body)
	}
	return response
}

func TestUnifiedEmailAuthenticationCreatesThenLogsIn(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	firstAlias := "first.user+campaign@googlemail.com"
	code := requestDevelopmentCode(t, engine, firstAlias)

	wrong := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": firstAlias, "code": "000000"})
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong code = %d %s", wrong.Code, wrong.Body.String())
	}
	created := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": firstAlias, "code": code})
	if created.Code != http.StatusOK || len(created.Result().Cookies()) == 0 {
		t.Fatalf("first verify = %d %s", created.Code, created.Body.String())
	}
	createdBody := decodeVerifyEmailResponse(t, created.Body.Bytes())
	if !createdBody.Data.IsNewUser || createdBody.Data.User.Email != "firstuser@gmail.com" || !strings.HasPrefix(createdBody.Data.User.Username, "星空用户 ") {
		t.Fatalf("unexpected first user response: %s", created.Body.String())
	}

	user, err := store.GetUserByEmail(context.Background(), st.Pool, "firstuser@gmail.com")
	if err != nil || user == nil {
		t.Fatalf("canonical user missing: user=%v err=%v", user, err)
	}
	wallet, err := store.GetWallet(context.Background(), st.Pool, user.ID)
	if err != nil || wallet == nil || wallet.BalanceCents != 100 {
		t.Fatalf("signup bonus wallet=%v err=%v", wallet, err)
	}

	returningAlias := "f.i.r.s.t.u.s.e.r+return@gmail.com"
	returningCode := requestDevelopmentCode(t, engine, returningAlias)
	returning := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": returningAlias, "code": returningCode})
	if returning.Code != http.StatusOK {
		t.Fatalf("returning verify = %d %s", returning.Code, returning.Body.String())
	}
	returningBody := decodeVerifyEmailResponse(t, returning.Body.Bytes())
	if returningBody.Data.IsNewUser || returningBody.Data.User.ID != createdBody.Data.User.ID {
		t.Fatalf("alias created duplicate user: %s", returning.Body.String())
	}
	wallet, err = store.GetWallet(context.Background(), st.Pool, user.ID)
	if err != nil || wallet.BalanceCents != 100 {
		t.Fatalf("returning login changed signup bonus: wallet=%v err=%v", wallet, err)
	}
}

func TestUnifiedEmailAuthenticationPreservesCodeWhenRegistrationClosed(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	ctx := context.Background()
	if err := settings.Set(ctx, st.Pool, "registration_enabled", json.RawMessage(`false`)); err != nil {
		t.Fatal(err)
	}
	email := "closed.registration@qq.com"
	code := requestDevelopmentCode(t, engine, email)

	closed := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
	if closed.Code != http.StatusForbidden {
		t.Fatalf("closed registration = %d %s", closed.Code, closed.Body.String())
	}
	if err := settings.Set(ctx, st.Pool, "registration_enabled", json.RawMessage(`true`)); err != nil {
		t.Fatal(err)
	}
	retry := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
	if retry.Code != http.StatusOK {
		t.Fatalf("code was consumed by rolled back registration = %d %s", retry.Code, retry.Body.String())
	}
}

func TestUnifiedEmailAuthenticationLimitsNewAccountsPerIP(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	for index := 0; index < registrationsPerIPDay; index++ {
		email := fmt.Sprintf("security-registration-%d@qq.com", index)
		code := requestDevelopmentCode(t, engine, email)
		response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
		if response.Code != http.StatusOK {
			t.Fatalf("registration %d = %d %s", index, response.Code, response.Body.String())
		}
	}
	email := "security-registration-overflow@qq.com"
	code := requestDevelopmentCode(t, engine, email)
	response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), `"code":"rate_limited"`) {
		t.Fatalf("overflow registration = %d %s", response.Code, response.Body.String())
	}
	if user, err := store.GetUserByEmail(context.Background(), st.Pool, email); err != nil || user != nil {
		t.Fatalf("limited account was created: user=%v err=%v", user, err)
	}
}

// allowImmediateResend 让上一封验证码越过 60 秒重发间隔，用来在测试里模拟
// 用户隔一段时间反复点"重新发送"，而不必真的等待。
func allowImmediateResend(t *testing.T, st *store.Store, email string) {
	t.Helper()
	if _, err := st.Pool.Exec(context.Background(),
		`UPDATE email_login_codes SET created_at = now() - interval '2 minutes' WHERE email=$1`,
		email); err != nil {
		t.Fatalf("backdate login code for %q: %v", email, err)
	}
}

// 重发验证码不是"登录失败"，不能消耗防爆破额度。否则收不到邮件而多点几次重发的
// 用户会被锁定，拿着刚收到的有效验证码也登不进去。
func TestResendingLoginCodeKeepsVerificationAvailable(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	email := "resend.user@qq.com"

	var code string
	for index := 0; index < 6; index++ {
		if index > 0 {
			allowImmediateResend(t, st, email)
		}
		code = requestDevelopmentCode(t, engine, email)
	}

	response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
	if response.Code != http.StatusOK {
		t.Fatalf("verification blocked after repeated resends = %d %s", response.Code, response.Body.String())
	}
}

// 发码额度只拒绝继续发邮件；已经送到用户手里的验证码必须仍然能完成登录。
func TestLoginCodeQuotaDoesNotInvalidateIssuedCode(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	email := "quota.user@qq.com"

	var code string
	for index := 0; index < loginCodesPerEmailHour; index++ {
		if index > 0 {
			allowImmediateResend(t, st, email)
		}
		code = requestDevelopmentCode(t, engine, email)
	}

	allowImmediateResend(t, st, email)
	exhausted := authRequest(t, engine, http.MethodPost, "/api/v1/auth/email-verification-codes", gin.H{"email": email})
	if exhausted.Code != http.StatusTooManyRequests || !strings.Contains(exhausted.Body.String(), `"code":"rate_limited"`) {
		t.Fatalf("send beyond quota = %d %s", exhausted.Code, exhausted.Body.String())
	}

	response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
	if response.Code != http.StatusOK {
		t.Fatalf("exhausted send quota invalidated the issued code = %d %s", response.Code, response.Body.String())
	}
}

// 被 60 秒重发间隔拦掉的请求没有发出邮件，既不能消耗发码额度，也不能作废用户
// 手里那封还没用的验证码。
func TestBlockedResendPreservesCodeAndQuota(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	email := "impatient.user@qq.com"

	code := requestDevelopmentCode(t, engine, email)
	for index := 0; index < loginCodesPerEmailHour+3; index++ {
		blocked := authRequest(t, engine, http.MethodPost, "/api/v1/auth/email-verification-codes", gin.H{"email": email})
		if blocked.Code != http.StatusTooManyRequests {
			t.Fatalf("resend %d within cooldown = %d %s", index, blocked.Code, blocked.Body.String())
		}
	}

	response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
	if response.Code != http.StatusOK {
		t.Fatalf("rapid resend clicks broke login = %d %s", response.Code, response.Body.String())
	}
}

// expireLoginCode 把验证码置为已过期，模拟邮件迟到、用户收到时已超时。
func expireLoginCode(t *testing.T, st *store.Store, email string) {
	t.Helper()
	if _, err := st.Pool.Exec(context.Background(),
		`UPDATE email_login_codes SET expires_at = now() - interval '1 minute' WHERE email=$1`,
		email); err != nil {
		t.Fatalf("expire login code for %q: %v", email, err)
	}
}

// 验证码超时不是猜测行为：它必须返回 code_expired，且不能消耗防爆破额度，
// 否则邮件多延迟几次用户就会被锁在门外。
func TestExpiredLoginCodeDoesNotCountAsBruteForce(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	email := "slow.mail@qq.com"

	// 连续 5 次"收到的验证码已过期"，次数已达旧的邮箱锁定阈值。
	for index := 0; index < 5; index++ {
		code := requestDevelopmentCode(t, engine, email)
		expireLoginCode(t, st, email)
		response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
		if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"code_expired"`) {
			t.Fatalf("expired code %d = %d %s", index, response.Code, response.Body.String())
		}
		allowImmediateResend(t, st, email)
	}

	// 第 6 次拿到的新验证码必须还能正常登录。
	code := requestDevelopmentCode(t, engine, email)
	response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
	if response.Code != http.StatusOK {
		t.Fatalf("expired codes locked the account out = %d %s", response.Code, response.Body.String())
	}
}

// 同一出口 IP（校园/公司/运营商 NAT）上别人输错验证码，不能牵连其他用户登录。
func TestWrongCodesFromSharedIPDoNotBlockOtherUsers(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()

	// 25 次来自同一 IP 的错误验证码，超过旧的 IP 锁定阈值（20 次 / 15 分钟）。
	for index := 0; index < 25; index++ {
		email := fmt.Sprintf("nat.neighbour-%d@qq.com", index)
		requestDevelopmentCode(t, engine, email)
		wrong := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": "000000"})
		if wrong.Code != http.StatusUnauthorized {
			t.Fatalf("neighbour %d wrong code = %d %s", index, wrong.Code, wrong.Body.String())
		}
	}

	victim := "innocent.user@qq.com"
	code := requestDevelopmentCode(t, engine, victim)
	response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": victim, "code": code})
	if response.Code != http.StatusOK {
		t.Fatalf("shared IP lockout blocked an innocent user = %d %s", response.Code, response.Body.String())
	}
}

// 注册未开放时被拒绝，不能白扣掉该 IP 当天的注册名额。
func TestClosedRegistrationDoesNotConsumeIPQuota(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	ctx := context.Background()

	if err := settings.Set(ctx, st.Pool, "registration_enabled", json.RawMessage(`false`)); err != nil {
		t.Fatal(err)
	}
	// 关闭注册期间反复尝试，次数超过每 IP 每天的注册名额。
	for index := 0; index < registrationsPerIPDay+2; index++ {
		email := fmt.Sprintf("closed-attempt-%d@qq.com", index)
		code := requestDevelopmentCode(t, engine, email)
		closed := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
		if closed.Code != http.StatusForbidden {
			t.Fatalf("attempt %d while closed = %d %s", index, closed.Code, closed.Body.String())
		}
	}

	if err := settings.Set(ctx, st.Pool, "registration_enabled", json.RawMessage(`true`)); err != nil {
		t.Fatal(err)
	}
	// 重新开放后，该 IP 的名额必须完好无损。
	for index := 0; index < registrationsPerIPDay; index++ {
		email := fmt.Sprintf("reopened-%d@qq.com", index)
		code := requestDevelopmentCode(t, engine, email)
		response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": code})
		if response.Code != http.StatusOK {
			t.Fatalf("registration %d after reopening = %d %s", index, response.Code, response.Body.String())
		}
	}
}

// 真正猜错验证码仍然必须触发防爆破锁定。
func TestWrongLoginCodesStillLockVerification(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	email := "bruteforce.user@qq.com"
	requestDevelopmentCode(t, engine, email)

	for index := 0; index < 5; index++ {
		wrong := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": "000000"})
		if wrong.Code != http.StatusUnauthorized && wrong.Code != http.StatusTooManyRequests {
			t.Fatalf("wrong code %d = %d %s", index, wrong.Code, wrong.Body.String())
		}
	}
	locked := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{"email": email, "code": "000000"})
	if locked.Code != http.StatusTooManyRequests {
		t.Fatalf("brute force was not locked out = %d %s", locked.Code, locked.Body.String())
	}
	// 锁定期间也不允许继续获取新验证码。
	allowImmediateResend(t, st, email)
	send := authRequest(t, engine, http.MethodPost, "/api/v1/auth/email-verification-codes", gin.H{"email": email})
	if send.Code != http.StatusTooManyRequests {
		t.Fatalf("locked email could still request codes = %d %s", send.Code, send.Body.String())
	}
}

func TestNormalizeLoginEmail(t *testing.T) {
	tests := map[string]string{
		" First.User+tag@GoogleMail.com ": "firstuser@gmail.com",
		"first.user@gmail.com":            "firstuser@gmail.com",
		"123456@qq.com":                   "123456@qq.com",
	}
	for input, expected := range tests {
		actual, ok := normalizeLoginEmail(input)
		if !ok || actual != expected {
			t.Fatalf("normalize %q = %q, %v; want %q", input, actual, ok, expected)
		}
	}
	for _, input := range []string{"user@outlook.com", "user@example.com", "user@qq.com.evil.test", "@gmail.com"} {
		if actual, ok := normalizeLoginEmail(input); ok {
			t.Fatalf("unsupported email %q normalized to %q", input, actual)
		}
	}
}

func TestRemovedUserAuthRoutesAndProviders(t *testing.T) {
	s := newUserLoginTestServer(nil)
	engine := s.Router()
	for _, path := range []string{
		"/api/v1/auth/register", "/api/v1/auth/login", "/api/v1/auth/password/reset",
		"/api/v1/auth/oauth/google", "/api/v1/auth/oauth/github", "/api/v1/auth/oauth/github/callback",
	} {
		if w := authRequest(t, engine, http.MethodGet, path, nil); w.Code != http.StatusNotFound {
			t.Fatalf("removed auth route %s = %d %s", path, w.Code, w.Body.String())
		}
	}
	providers := authRequest(t, engine, http.MethodGet, "/api/v1/auth/providers", nil)
	var payload struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(providers.Body.Bytes(), &payload); err != nil {
		t.Fatalf("providers response: %v", err)
	}
	for _, removed := range []string{"github", "password"} {
		if _, exists := payload.Data[removed]; exists {
			t.Fatalf("removed provider %q still exposed: %s", removed, providers.Body.String())
		}
	}
}

func TestEmailAuthenticationUnavailableWithoutDeliveryChannel(t *testing.T) {
	s := newUserLoginTestServer(nil)
	s.Cfg.DevLoginCodeEcho = false
	engine := s.Router()

	providers := authRequest(t, engine, http.MethodGet, "/api/v1/auth/providers", nil)
	var payload struct {
		Data struct {
			Email bool `json:"email"`
		} `json:"data"`
	}
	if err := json.Unmarshal(providers.Body.Bytes(), &payload); err != nil {
		t.Fatalf("providers response: %v", err)
	}
	if payload.Data.Email {
		t.Fatalf("email provider enabled without SMTP or development code echo: %s", providers.Body.String())
	}

	response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/email-verification-codes", gin.H{"email": "unavailable@qq.com"})
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "email_unavailable") {
		t.Fatalf("request without delivery channel = %d %s", response.Code, response.Body.String())
	}
}
