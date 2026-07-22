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

func TestEmailRegistrationLoginAndPasswordReset(t *testing.T) {
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	email := "verified.user@gmail.com"

	sent := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": email, "purpose": "register"})
	if sent.Code != http.StatusOK {
		t.Fatalf("send register code = %d %s", sent.Code, sent.Body.String())
	}
	registered := authRequest(t, engine, http.MethodPost, "/api/auth/register", gin.H{
		"email": email, "username": "Verified User", "code": developmentCode(t, sent.Body.Bytes()), "password": "password-123",
	})
	if registered.Code != http.StatusOK || len(registered.Result().Cookies()) == 0 {
		t.Fatalf("register = %d %s", registered.Code, registered.Body.String())
	}
	if duplicate := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": email, "purpose": "register"}); duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate register code = %d %s", duplicate.Code, duplicate.Body.String())
	}
	if wrong := authRequest(t, engine, http.MethodPost, "/api/auth/login", gin.H{"email": email, "password": "wrong-password"}); wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password = %d %s", wrong.Code, wrong.Body.String())
	}
	if login := authRequest(t, engine, http.MethodPost, "/api/auth/login", gin.H{"email": email, "password": "password-123"}); login.Code != http.StatusOK {
		t.Fatalf("login = %d %s", login.Code, login.Body.String())
	}

	resetSent := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": email, "purpose": "reset"})
	if resetSent.Code != http.StatusOK {
		t.Fatalf("send reset code = %d %s", resetSent.Code, resetSent.Body.String())
	}
	reset := authRequest(t, engine, http.MethodPost, "/api/auth/password/reset", gin.H{
		"email": email, "code": developmentCode(t, resetSent.Body.Bytes()), "password": "new-password-123",
	})
	if reset.Code != http.StatusOK {
		t.Fatalf("reset password = %d %s", reset.Code, reset.Body.String())
	}
	if old := authRequest(t, engine, http.MethodPost, "/api/auth/login", gin.H{"email": email, "password": "password-123"}); old.Code != http.StatusUnauthorized {
		t.Fatalf("old password after reset = %d %s", old.Code, old.Body.String())
	}
	if current := authRequest(t, engine, http.MethodPost, "/api/auth/login", gin.H{"email": email, "password": "new-password-123"}); current.Code != http.StatusOK {
		t.Fatalf("new password after reset = %d %s", current.Code, current.Body.String())
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
	if err := s.consumeEmailCode(ctx, email, "reset", "123456"); err == nil {
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

func TestEmailDomainRestrictionAndGoogleOAuthRemoval(t *testing.T) {
	s := newUserLoginTestServer(nil)
	for _, email := range []string{"user@outlook.com", "user@example.com", "user@qq.com.evil.test"} {
		w := authRequest(t, s.Router(), http.MethodPost, "/api/auth/email/code", gin.H{"email": email, "purpose": "register"})
		if w.Code != http.StatusUnprocessableEntity {
			t.Fatalf("unsupported email %q = %d %s", email, w.Code, w.Body.String())
		}
	}
	if w := authRequest(t, s.Router(), http.MethodGet, "/api/auth/oauth/google", nil); w.Code != http.StatusNotFound {
		t.Fatalf("google oauth route = %d %s", w.Code, w.Body.String())
	}
}
