package httpapi

import (
	"context"
	"encoding/json"
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

func requestDevelopmentCode(t *testing.T, engine http.Handler, email string) string {
	t.Helper()
	w := authRequest(t, engine, http.MethodPost, "/api/auth/email/code", gin.H{"email": email})
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

	wrong := authRequest(t, engine, http.MethodPost, "/api/auth/email/verify", gin.H{"email": firstAlias, "code": "000000"})
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong code = %d %s", wrong.Code, wrong.Body.String())
	}
	created := authRequest(t, engine, http.MethodPost, "/api/auth/email/verify", gin.H{"email": firstAlias, "code": code})
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
	returning := authRequest(t, engine, http.MethodPost, "/api/auth/email/verify", gin.H{"email": returningAlias, "code": returningCode})
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

	closed := authRequest(t, engine, http.MethodPost, "/api/auth/email/verify", gin.H{"email": email, "code": code})
	if closed.Code != http.StatusForbidden {
		t.Fatalf("closed registration = %d %s", closed.Code, closed.Body.String())
	}
	if err := settings.Set(ctx, st.Pool, "registration_enabled", json.RawMessage(`true`)); err != nil {
		t.Fatal(err)
	}
	retry := authRequest(t, engine, http.MethodPost, "/api/auth/email/verify", gin.H{"email": email, "code": code})
	if retry.Code != http.StatusOK {
		t.Fatalf("code was consumed by rolled back registration = %d %s", retry.Code, retry.Body.String())
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
		"/api/auth/register", "/api/auth/login", "/api/auth/password/reset",
		"/api/auth/oauth/google", "/api/auth/oauth/github", "/api/auth/oauth/github/callback",
	} {
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
