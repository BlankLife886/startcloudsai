package httpapi

import (
	"bytes"
	"encoding/json"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDiscoverySelectedDraftRouteIgnoresEmptyPrimary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer selected-key" {
			t.Errorf("wrong route request: %s", r.URL.Path)
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"custom-model"}]}`))
	}))
	defer upstream.Close()
	body, _ := json.Marshal(map[string]any{"id": "draft", "adapter": "openai", "routes": []map[string]any{
		{"id": "empty", "baseUrl": "", "apiKey": ""},
		{"id": "selected", "baseUrl": upstream.URL, "apiKey": "selected-key", "timeoutSecs": 5},
	}})
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/model-config/discoveries?routeId=selected", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	server := &Server{Cfg: &config.Config{AppEnv: "production", C2AAllowPrivate: true}}
	server.adminDiscoverProviderModels(ctx, nil)
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var result struct {
		Data struct {
			Models []string `json:"models"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Data.Models) != 1 || result.Data.Models[0] != "custom-model" {
		t.Fatalf("missing observable models: %s", rec.Body.String())
	}
}
