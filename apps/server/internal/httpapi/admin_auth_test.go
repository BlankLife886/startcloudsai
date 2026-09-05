package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func authRequest(t *testing.T, engine http.Handler, method, path string, body any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, req)
	return recorder
}

func TestUserAndAdminAuthenticationAreIsolated(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userHash, _ := auth.HashPassword("user-password")
	adminHash, _ := auth.HashPassword("admin-password")

	user, err := store.InsertUser(ctx, st.Pool, "same@gmail.com", "user", userHash, "user", nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
	_, err = store.UpsertAdminAccount(ctx, st.Pool, "same@gmail.com", "admin", adminHash)
	if err != nil {
		t.Fatalf("insert admin: %v", err)
	}
	cfg := config.Load()
	server := &Server{
		Cfg:               cfg,
		St:                st,
		LoginLimiter:      auth.NewLoginLimiter(),
		AdminLoginLimiter: auth.NewLoginLimiter(),
		RedeemLimiter:     auth.NewRedeemLimiter(),
	}
	engine := server.Router()

	// 用户端没有密码登录入口；管理员密码与用户会话完全独立。
	if w := authRequest(t, engine, "POST", "/api/v1/auth/login", gin.H{
		"email": "same@gmail.com", "password": "admin-password",
	}); w.Code != 404 {
		t.Fatalf("removed user password login accepted admin password: %d %s", w.Code, w.Body.String())
	}
	if w := authRequest(t, engine, "POST", "/api/v1/admin/auth/session", gin.H{
		"email": "same@gmail.com", "password": "user-password",
	}); w.Code != 401 {
		t.Fatalf("user password entered on admin login: %d %s", w.Code, w.Body.String())
	}
	userToken := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(userToken), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	adminLogin := authRequest(t, engine, "POST", "/api/v1/admin/auth/session", gin.H{
		"email": "same@gmail.com", "password": "admin-password",
	})
	if adminLogin.Code != http.StatusCreated {
		t.Fatalf("admin login failed: %d %s", adminLogin.Code, adminLogin.Body.String())
	}

	findCookie := func(recorder *httptest.ResponseRecorder, name string) *http.Cookie {
		t.Helper()
		for _, cookie := range recorder.Result().Cookies() {
			if cookie.Name == name {
				return cookie
			}
		}
		t.Fatalf("response did not set cookie %s", name)
		return nil
	}
	userCookie := &http.Cookie{Name: cfg.SessionCookieName, Value: userToken, Path: "/"}
	adminCookie := findCookie(adminLogin, adminSessionCookieName)
	if userCookie.Path != "/" || adminCookie.Path != "/api/v1/admin" {
		t.Fatalf("cookie paths = (%q, %q), want (\"/\", \"/api/v1/admin\")", userCookie.Path, adminCookie.Path)
	}
	if w := authRequest(t, engine, "GET", "/api/v1/admin/statistics", nil, userCookie); w.Code != 401 {
		t.Fatalf("user cookie accessed admin route: %d %s", w.Code, w.Body.String())
	}
	if w := authRequest(t, engine, "GET", "/api/v1/admin/statistics", nil, adminCookie); w.Code != 200 {
		t.Fatalf("admin cookie rejected: %d %s", w.Code, w.Body.String())
	}
	if w := authRequest(t, engine, "GET", "/api/v1/auth/session", nil, adminCookie); w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"user":null`)) {
		t.Fatalf("admin cookie leaked into user auth: %d %s", w.Code, w.Body.String())
	}

	changePassword := authRequest(t, engine, "PATCH", "/api/v1/admin/auth/password", gin.H{
		"old": "admin-password", "new": "changed-admin-password",
	}, adminCookie)
	if changePassword.Code != 200 {
		t.Fatalf("admin password change failed: %d %s", changePassword.Code, changePassword.Body.String())
	}
	if w := authRequest(t, engine, "GET", "/api/v1/admin/statistics", nil, adminCookie); w.Code != 401 {
		t.Fatalf("admin session survived password change: %d %s", w.Code, w.Body.String())
	}
	if w := authRequest(t, engine, "POST", "/api/v1/admin/auth/session", gin.H{
		"email": "same@gmail.com", "password": "admin-password",
	}); w.Code != 401 {
		t.Fatalf("old admin password remained valid: %d %s", w.Code, w.Body.String())
	}
	if w := authRequest(t, engine, "POST", "/api/v1/admin/auth/session", gin.H{
		"email": "same@gmail.com", "password": "changed-admin-password",
	}); w.Code != http.StatusCreated {
		t.Fatalf("new admin password rejected: %d %s", w.Code, w.Body.String())
	}
	if w := authRequest(t, engine, "GET", "/api/v1/auth/session", nil, userCookie); w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"email":"same@gmail.com"`)) {
		t.Fatalf("user session changed with admin password: %d %s", w.Code, w.Body.String())
	}
}

func TestAdminSessionRenewalRefreshesBrowserCookie(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	adminHash, err := auth.HashPassword("admin-password")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "admin@gmail.com", "admin", adminHash)
	if err != nil {
		t.Fatalf("insert admin: %v", err)
	}
	token := auth.NewSessionToken()
	if err := store.InsertAdminSession(ctx, st.Pool, admin.ID, auth.HashToken(token),
		time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatalf("insert admin session: %v", err)
	}

	cfg := config.Load()
	server := &Server{
		Cfg:               cfg,
		St:                st,
		LoginLimiter:      auth.NewLoginLimiter(),
		AdminLoginLimiter: auth.NewLoginLimiter(),
		RedeemLimiter:     auth.NewRedeemLimiter(),
	}
	requestCookie := &http.Cookie{
		Name:  adminSessionCookieName,
		Value: token,
		Path:  "/api/v1/admin",
	}
	response := authRequest(t, server.Router(), "GET", "/api/v1/admin/auth/session", nil, requestCookie)
	if response.Code != http.StatusOK {
		t.Fatalf("admin session renewal failed: %d %s", response.Code, response.Body.String())
	}

	var renewedCookie *http.Cookie
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == adminSessionCookieName {
			renewedCookie = cookie
			break
		}
	}
	if renewedCookie == nil {
		t.Fatal("renewal updated the database but did not refresh the browser cookie")
	}
	if renewedCookie.Value != token || renewedCookie.Path != "/api/v1/admin" {
		t.Fatalf("renewed cookie = %#v", renewedCookie)
	}
	if renewedCookie.MaxAge != int(adminSessionTTL/time.Second) {
		t.Fatalf("renewed cookie MaxAge = %d, want %d", renewedCookie.MaxAge, int(adminSessionTTL/time.Second))
	}

	renewedSession, err := store.GetAdminSessionByTokenHash(ctx, st.Pool, auth.HashToken(token))
	if err != nil {
		t.Fatal(err)
	}
	if renewedSession == nil || time.Until(renewedSession.ExpiresAt) < 11*time.Hour {
		t.Fatalf("database session was not renewed: %#v", renewedSession)
	}
}
