package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestMockPaymentRouteDisabled(t *testing.T) {
	cfg := config.Load()
	cfg.PaymentMockEnabled = false
	s := &Server{Cfg: cfg}
	w := authRequest(t, s.Router(), http.MethodPost, "/api/payments/webhook/mock", gin.H{
		"orderId": "00000000-0000-0000-0000-000000000000", "secret": "x",
	})
	if w.Code != http.StatusNotFound {
		t.Fatalf("mock webhook status = %d, want 404", w.Code)
	}
}

func TestPlansAreReadOnlyWhilePaymentIsDisabled(t *testing.T) {
	cfg := config.Load()
	s := &Server{Cfg: cfg}
	routes := s.Router().Routes()

	registered := map[string]bool{}
	for _, route := range routes {
		registered[route.Method+" "+route.Path] = true
	}
	if !registered[http.MethodGet+" /api/plans"] {
		t.Fatal("read-only plan list route is not registered")
	}
	for _, route := range []string{
		http.MethodPost + " /api/orders",
		http.MethodPost + " /api/payments/webhook/:provider",
	} {
		if registered[route] {
			t.Fatalf("payment write route unexpectedly registered: %s", route)
		}
	}
}

func TestUserPasswordChangeRotatesSessions(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	hash, _ := auth.HashPassword("old-password")
	user, err := store.InsertUser(ctx, st.Pool, "password-change@gmail.com", "user", hash, "user", nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
	tokens := []string{auth.NewSessionToken(), auth.NewSessionToken()}
	for _, token := range tokens {
		if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
			t.Fatalf("insert session: %v", err)
		}
	}
	cfg := config.Load()
	s := &Server{Cfg: cfg, St: st}
	w := authRequest(t, s.Router(), http.MethodPatch, "/api/me/profile", gin.H{
		"password": gin.H{"old": "old-password", "new": "new-password"},
	}, &http.Cookie{Name: cfg.SessionCookieName, Value: tokens[0]})
	if w.Code != http.StatusOK || len(w.Result().Cookies()) == 0 {
		t.Fatalf("password change = %d %s", w.Code, w.Body.String())
	}
	for _, token := range tokens {
		session, err := store.GetSessionByTokenHash(ctx, st.Pool, auth.HashToken(token))
		if err != nil || session != nil {
			t.Fatalf("old session survived password change: session=%v err=%v", session, err)
		}
	}
}
