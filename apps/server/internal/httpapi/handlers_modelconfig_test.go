package httpapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestModelConfigAdapters(t *testing.T) {
	if !modelconfig.ValidAdapter("openai") || !modelconfig.ValidAdapter("crun") {
		t.Fatal("expected OpenAI and CRUN adapters to be valid")
	}
	if modelconfig.ValidAdapter("sub2api") || modelconfig.ValidAdapter("c2a") {
		t.Fatal("legacy service names must not remain provider protocols")
	}
}

func TestAdminDiscoverProviderModelsAllowsExplicitProductionPrivateNetwork(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"test-image-model"}]}`))
	}))
	defer upstream.Close()

	body := []byte(`{"id":"provider-test","name":"Internal C2A","adapter":"openai","baseUrl":"` + upstream.URL + `","apiKey":"test-key","timeoutSecs":5,"enabled":true}`)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/model-config/discoveries", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")

	server := &Server{Cfg: &config.Config{AppEnv: "production", C2AAllowPrivate: true}}
	server.adminDiscoverProviderModels(ctx, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
}
