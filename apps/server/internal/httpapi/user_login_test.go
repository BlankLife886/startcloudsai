package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func newUserLoginTestServer(st *store.Store) *Server {
	cfg := config.Load()
	cfg.AppEnv = "development"
	cfg.AppSecret = "test-app-secret-at-least-thirty-two-bytes"
	cfg.SMTPAddr = ""
	cfg.SMTPFrom = ""
	return &Server{Cfg: cfg, St: st, LoginLimiter: auth.NewLoginLimiter(), AdminLoginLimiter: auth.NewLoginLimiter(), RedeemLimiter: auth.NewRedeemLimiter()}
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

func TestEmailRegistrationAndCodeLogin(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	email := "verified.user@gmail.com"

	sent := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": email, "purpose": "register"})
	if sent.Code != http.StatusOK {
		t.Fatalf("send register code = %d %s", sent.Code, sent.Body.String())
	}
	registered := authRequest(t, engine, http.MethodPost, "/api/auth/register", gin.H{
		"email": email, "username": "Verified User", "code": developmentCode(t, sent.Body.Bytes()),
	})
	if registered.Code != http.StatusOK || len(registered.Result().Cookies()) == 0 {
		t.Fatalf("register = %d %s", registered.Code, registered.Body.String())
	}
	if duplicate := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": email, "purpose": "register"}); duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate register code = %d %s", duplicate.Code, duplicate.Body.String())
	}
	loginCodeResponse := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": email, "purpose": "login"})
	if loginCodeResponse.Code != http.StatusOK {
		t.Fatalf("send login code = %d %s", loginCodeResponse.Code, loginCodeResponse.Body.String())
	}
	loginCode := developmentCode(t, loginCodeResponse.Body.Bytes())
	if wrong := authRequest(t, engine, http.MethodPost, "/api/auth/login", gin.H{"email": email, "code": "000000"}); wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong login code = %d %s", wrong.Code, wrong.Body.String())
	}
	if login := authRequest(t, engine, http.MethodPost, "/api/auth/login", gin.H{"email": email, "code": loginCode}); login.Code != http.StatusOK || len(login.Result().Cookies()) == 0 {
		t.Fatalf("code login = %d %s", login.Code, login.Body.String())
	}
}

func TestEmailCodeExpiryPurposeAndAttemptLimit(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	ctx := context.Background()
	email := "attempts@googlemail.com"
	if err := store.UpsertEmailLoginCode(ctx, st.Pool, email, "register", s.loginCodeHash(email, "register", "123456"), time.Now().Add(-time.Minute), nil); err != nil {
		t.Fatal(err)
	}
	if err := s.consumeEmailCode(ctx, email, "register", "123456"); err == nil {
		t.Fatal("expired code accepted")
	}
	if err := store.UpsertEmailLoginCode(ctx, st.Pool, email, "register", s.loginCodeHash(email, "register", "123456"), time.Now().Add(time.Minute), nil); err != nil {
		t.Fatal(err)
	}
	if err := s.consumeEmailCode(ctx, email, "login", "123456"); err == nil {
		t.Fatal("cross-purpose code accepted")
	}
	for i := 0; i < 4; i++ {
		if err := s.consumeEmailCode(ctx, email, "register", "654321"); err == nil {
			t.Fatalf("wrong attempt %d accepted", i+1)
		}
	}
	if err := s.consumeEmailCode(ctx, email, "register", "123456"); err == nil {
		t.Fatal("locked code accepted")
	}
}

func TestEmailDomainRestrictionAndOAuthRemoval(t *testing.T) {
	s := newUserLoginTestServer(nil)
	engine := s.Router()
	for _, email := range []string{"user@outlook.com", "user@example.com", "user@qq.com.evil.test"} {
		w := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": email, "purpose": "register"})
		if w.Code != http.StatusUnprocessableEntity {
			t.Fatalf("unsupported email %q = %d %s", email, w.Code, w.Body.String())
		}
	}
	if w := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": "user@gmail.com", "purpose": "reset"}); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("removed reset purpose = %d %s", w.Code, w.Body.String())
	}
	for _, path := range []string{"/api/auth/oauth/google", "/api/auth/oauth/github", "/api/auth/oauth/github/callback", "/api/auth/password/reset"} {
		if w := authRequest(t, engine, http.MethodGet, path, nil); w.Code != http.StatusNotFound {
			t.Fatalf("removed auth route %s = %d %s", path, w.Code, w.Body.String())
		}
	}
	providers := authRequest(t, engine, http.MethodGet, "/api/auth/providers", nil)
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
