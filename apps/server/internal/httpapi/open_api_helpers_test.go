package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAPISecretIsPrefixedAndHashed(t *testing.T) {
	secret, err := newAPISecret()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(secret, "sk-sc-") || len(secret) < 40 {
		t.Fatalf("unexpected secret format: %q", secret)
	}
	hash := hashAPISecret(secret)
	if hash == secret || len(hash) != 64 || strings.Contains(hash, "sk-sc-") {
		t.Fatalf("secret was not irreversibly hashed: %q", hash)
	}
}

func TestDeveloperAPIGateDefaultsToDisabled(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{St: st}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/open/v1/models", nil)
	called := false
	srv.openAPIOnly("models:read", func(c *gin.Context) { called = true })(c)

	if called {
		t.Fatal("disabled Open API reached the protected handler")
	}
	if recorder.Code != http.StatusNotFound || !strings.Contains(recorder.Body.String(), `"code":"open_api_disabled"`) {
		t.Fatalf("disabled response = %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestDeveloperAPIGateAllowsAuthenticationWhenEnabled(t *testing.T) {
	st := testdb.Setup(t)
	raw, _ := json.Marshal(map[string]settings.PageControl{
		"developer_api": {Status: settings.PageStatusNormal},
	})
	if err := settings.Set(context.Background(), st.Pool, "page_controls", raw); err != nil {
		t.Fatal(err)
	}
	srv := &Server{St: st}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/open/v1/models", nil)
	srv.openAPIOnly("models:read", func(c *gin.Context) {
		t.Fatal("request without API key reached the protected handler")
	})(c)

	if recorder.Code != http.StatusUnauthorized || !strings.Contains(recorder.Body.String(), `"code":"api_key_required"`) {
		t.Fatalf("enabled response = %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestDeveloperAPIGateBlocksUserManagementEndpoints(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{St: st}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/me/api-keys", nil)
	called := false
	srv.developerAPIOnly(func(c *gin.Context) { called = true })(c)
	if called || recorder.Code != http.StatusNotFound {
		t.Fatalf("management gate called=%v response=%d %s", called, recorder.Code, recorder.Body.String())
	}
}

func TestNormalizeOpenAPIModelIDs(t *testing.T) {
	cfg := modelconfig.Config{Models: []modelconfig.Model{
		{ID: "image", Kind: modelconfig.ModelKindImage, Public: true, Enabled: true},
		{ID: "chat", Kind: modelconfig.ModelKindChat, Public: true, Enabled: true},
		{ID: "private", Kind: modelconfig.ModelKindImage, Public: false, Enabled: true},
	}}
	ids, err := normalizeOpenAPIModelIDs(cfg, []string{" image ", "image", ""})
	if err != nil || len(ids) != 1 || ids[0] != "image" {
		t.Fatalf("normalized ids = %#v err=%v", ids, err)
	}
	for _, denied := range []string{"chat", "private", "missing"} {
		if _, err := normalizeOpenAPIModelIDs(cfg, []string{denied}); err == nil {
			t.Fatalf("model %q should be denied", denied)
		}
	}
}

func TestAPIKeyIPAllowlistSupportsAddressAndCIDR(t *testing.T) {
	if !ipAllowed("203.0.113.9", []string{"203.0.113.9"}) {
		t.Fatal("exact IP should be allowed")
	}
	if !ipAllowed("10.20.30.40", []string{"10.20.0.0/16"}) {
		t.Fatal("CIDR member should be allowed")
	}
	if ipAllowed("198.51.100.1", []string{"203.0.113.0/24"}) {
		t.Fatal("foreign IP should be denied")
	}
	if !ipAllowed("198.51.100.1", nil) {
		t.Fatal("empty allowlist should allow all addresses")
	}
}

func TestNormalizeWebhookEvents(t *testing.T) {
	events, err := normalizeWebhookEvents([]string{"task.failed", "task.failed", "task.succeeded"})
	if err != nil || len(events) != 2 || events[0] != "task.failed" || events[1] != "task.succeeded" {
		t.Fatalf("events = %#v err=%v", events, err)
	}
	if _, err := normalizeWebhookEvents([]string{"task.running"}); err == nil {
		t.Fatal("unsupported event should fail")
	}
}
