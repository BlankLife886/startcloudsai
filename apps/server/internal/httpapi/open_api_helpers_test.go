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
	"github.com/BlankLife886/startcloudsai/server/internal/store"
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
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	called := false
	srv.openAPIOnly(func(c *gin.Context) { called = true })(c)

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
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	srv.openAPIOnly(func(c *gin.Context) {
		t.Fatal("request without API key reached the protected handler")
	})(c)

	if recorder.Code != http.StatusUnauthorized || !strings.Contains(recorder.Body.String(), `"code":"invalid_api_key"`) {
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

// developerCatalogFixture binds one image model to the text-to-image
// workspace (so /v1 can run it) and leaves a second one unbound and a third private.
func developerCatalogFixture() (modelconfig.Config, modelconfig.Model) {
	provider := modelconfig.Provider{ID: "p", Name: "p", Adapter: modelconfig.AdapterOpenAI, BaseURL: "http://upstream.invalid", APIKey: "k", Enabled: true}
	wire := modelconfig.Model{ID: "model-0000-internal", Name: "gpt-image-2", ProviderID: provider.ID, UpstreamModel: "u",
		Kind: modelconfig.ModelKindImage, PriceCents: 20, Enabled: true, Public: true, Default: true, DeveloperAPI: true, MaxImages: 1,
		Resolutions: []string{"1K"}, AspectRatios: []string{"1:1"}}
	unbound := wire
	unbound.ID, unbound.Name, unbound.Default = "model-1111-unbound", "unbound", false
	private := wire
	private.ID, private.Name, private.Default, private.Public = "model-2222-private", "private", false, false
	return modelconfig.Config{Version: modelconfig.Version, Providers: []modelconfig.Provider{provider},
		Models: []modelconfig.Model{wire, unbound, private},
		Workspaces: map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceT2I: {
			ModelIDs: []string{wire.ID, private.ID}, DefaultModelIDs: map[string]string{modelconfig.ModelKindImage: wire.ID},
		}},
	}, wire
}

// A Key allowlist accepts callable catalog entries only, and records the
// site models behind them for the legacy column.
func TestNormalizeAPIModelIDs(t *testing.T) {
	entries := []*store.DeveloperAPIModel{
		{ID: "apim_live", TargetModelID: "model-0000-internal", Status: store.DeveloperAPIModelLive},
		{ID: "apim_vip", TargetModelID: "model-0000-internal", Status: store.DeveloperAPIModelLive},
		{ID: "apim_draft", TargetModelID: "model-1111-unbound", Status: store.DeveloperAPIModelDraft},
	}
	ids, targets, err := normalizeAPIModelIDs(entries, []string{" apim_live ", "apim_live", "", "apim_vip"})
	if err != nil || len(ids) != 2 || ids[0] != "apim_live" || len(targets) != 1 || targets[0] != "model-0000-internal" {
		t.Fatalf("normalized = %#v %#v err=%v", ids, targets, err)
	}
	for _, denied := range []string{"apim_draft", "model-0000-internal", "missing"} {
		if _, _, err := normalizeAPIModelIDs(entries, []string{denied}); err == nil {
			t.Fatalf("%q should be denied", denied)
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

func TestAPIKeyDisplayPrefixShowsFourSecretCharacters(t *testing.T) {
	for stored, want := range map[string]string{
		"sk-sc-Ab3dEf9hIj2k": "sk-sc-Ab3d",
		"sk-sc-Ab":           "sk-sc-Ab",
		"":                   "",
	} {
		if got := apiKeyDisplayPrefix(stored); got != want {
			t.Fatalf("apiKeyDisplayPrefix(%q) = %q, want %q", stored, got, want)
		}
	}
}

// The console lists callable catalog entries by their catalog id and public
// name. Workspace binding no longer matters: an entry pointing at a site model
// that is not bound to text-to-image is still offered; drafts are not.
func TestDeveloperModelItemsListOnlyV1Models(t *testing.T) {
	cfg, wire := developerCatalogFixture()
	entries := []*store.DeveloperAPIModel{
		{ID: "apim_wire", APIName: "gpt-image-2", Kind: "image", TargetModelID: wire.ID, Status: store.DeveloperAPIModelLive, PriceMode: store.DeveloperAPIPriceFollow},
		{ID: "apim_unbound", APIName: "unbound-api", Kind: "image", TargetModelID: "model-1111-unbound", Status: store.DeveloperAPIModelLive, PriceMode: store.DeveloperAPIPriceFollow},
		{ID: "apim_draft", APIName: "private-api", Kind: "image", TargetModelID: "model-2222-private", Status: store.DeveloperAPIModelDraft, PriceMode: store.DeveloperAPIPriceFollow},
	}
	items := developerModelItems(entries, cfg)
	if len(items) != 2 || items[0]["id"] != "apim_wire" || items[0]["model"] != "gpt-image-2" || items[1]["model"] != "unbound-api" {
		t.Fatalf("developer catalog = %#v", items)
	}
}
