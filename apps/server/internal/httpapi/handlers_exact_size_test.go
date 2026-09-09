package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

func TestExactSizeAdminSaveAndPublicRuntime(t *testing.T) {
	st := testdb.Setup(t)
	srv := &Server{St: st, Cfg: &config.Config{AppSecret: "test-master-key"}}
	limits := modelconfig.DefaultExactSizeLimits()
	limits.MaxWidth = 8192
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "exact-provider", Name: "Exact Provider", Adapter: "openai", BaseURL: "https://example.com", APIKey: "test-key", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "exact-model", Name: "Exact Model", ProviderID: "exact-provider", UpstreamModel: "exact-image", Kind: "image", Public: true, Enabled: true, PriceCents: 20, MaxImages: 4, SupportsExactSize: true, ExactSizeLimits: &limits}}
	for _, enabled := range []bool{true, false} {
		cfg.Models[0].SupportsExactSize = enabled
		body, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/model-config", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		srv.adminPutModelConfig(c, nil)
		if recorder.Code != http.StatusOK {
			t.Fatalf("admin save status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		stored, err := modelconfig.Load(context.Background(), st.Pool)
		if err != nil {
			t.Fatal(err)
		}
		if stored.Models[0].SupportsExactSize != enabled || stored.Models[0].ExactSizeRules() != limits {
			t.Fatalf("stored exact capability = %#v", stored.Models[0])
		}
		recorder = httptest.NewRecorder()
		c, _ = gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/runtime-config", nil)
		srv.runtimeConfig(c)
		if recorder.Code != http.StatusOK {
			t.Fatalf("runtime status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		var response struct {
			Data struct {
				Models struct {
					Models []struct {
						ID                string                      `json:"id"`
						SupportsExactSize bool                        `json:"supportsExactSize"`
						ExactSizeLimits   modelconfig.ExactSizeLimits `json:"exactSizeLimits"`
					} `json:"models"`
				} `json:"aiModelCatalog"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if len(response.Data.Models.Models) != 1 {
			t.Fatalf("runtime model catalog missing: %s", recorder.Body.String())
		}
		item := response.Data.Models.Models[0]
		if item.SupportsExactSize != enabled || item.ExactSizeLimits != limits {
			t.Fatalf("runtime exact capability = %#v", item)
		}
	}
}

func TestExactSizeAssistantPreservesArbitraryPixels(t *testing.T) {
	body := assistantRunIn{Mode: "image", SizeMode: "exact", ExactWidth: 1001, ExactHeight: 777, Ratio: "auto", Resolution: "4K", RequestSize: "auto"}
	model := modelconfig.Model{Kind: modelconfig.ModelKindImage, SupportsExactSize: true, Resolutions: []string{}, AspectRatios: []string{"1:1"}}
	auto, err := normalizeAssistantConfiguredImageParameters(&body, model)
	if err != nil || auto || body.RequestSize != "1001x777" || body.Width != 1001 || body.Height != 777 || body.Resolution != "" || body.Ratio != "" {
		t.Fatalf("exact image converted: body=%#v auto=%v err=%v", body, auto, err)
	}
	model.SupportsExactSize = false
	if _, err := normalizeAssistantConfiguredImageParameters(&body, model); err == nil {
		t.Fatal("unsupported exact size was cleared instead of rejected")
	}
}

func TestExactSizeAssistantPlanPreservesPixelsBeyondLegacyRange(t *testing.T) {
	limits := modelconfig.DefaultExactSizeLimits()
	limits.MaxWidth = 8192
	model := modelconfig.Model{Kind: modelconfig.ModelKindImage, SupportsExactSize: true, ExactSizeLimits: &limits}
	items, err := sanitizeAssistantImagePlanItems([]assistantRunImagePlanItem{
		{Prompt: "wide banner", SizeMode: "exact", ExactWidth: 6001, ExactHeight: 999, Resolution: "4K", Ratio: "1:1", RequestSize: "1024x1024"},
		{Prompt: "poster", SizeMode: "exact", ExactWidth: 777, ExactHeight: 1001},
	}, nil, 2, &model, "1K")
	if err != nil {
		t.Fatal(err)
	}
	if items[0]["requestSize"] != "6001x999" || items[0]["width"] != 6001 || items[0]["sizeMode"] != "exact" || items[1]["requestSize"] != "777x1001" {
		t.Fatalf("plan exact sizes changed: %#v", items)
	}
}

func TestExactSizeOpenAPIValidatesConfiguredPixels(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, _ := makeOrder(t, st)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, user.ID, 100, "grant", "signup_bonus", user.ID.String(), nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := settings.Set(ctx, st.Pool, "page_controls", json.RawMessage(`{"developer_api":{"status":"normal","reason":""}}`)); err != nil {
		t.Fatal(err)
	}
	limits := modelconfig.DefaultExactSizeLimits()
	limits.MaxWidth = 8192
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "provider", Name: "Provider", Adapter: "openai", BaseURL: "https://example.com", APIKey: "test-secret", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "exact", Name: "Exact", ProviderID: "provider", UpstreamModel: "exact-image", Kind: "image", PriceCents: 20, Public: true, Enabled: true, SupportsExactSize: true, ExactSizeLimits: &limits}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	secret, err := newAPISecret()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertUserAPIKey(ctx, st.Pool, &store.UserAPIKey{
		UserID: user.ID, KeyPrefix: secret[:18], KeyHash: hashAPISecret(secret), Label: "exact size test",
		Scopes: []string{"models:read", "tasks:write"}, AllowedModelIDs: []string{"exact"},
		DailyTaskLimit: 100, MonthlyTaskLimit: 1000, DailySpendLimitCents: 10000, MonthlySpendLimitCents: 100000,
	}); err != nil {
		t.Fatal(err)
	}
	queue, err := taskflow.NewQueue("redis://127.0.0.1:1", 1)
	if err != nil {
		t.Fatal(err)
	}
	defer queue.Close()
	srv := &Server{St: st, Cfg: config.Load(), Queue: queue}
	router := srv.Router()
	request := func(path string, body any) *httptest.ResponseRecorder {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+secret)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}
	params := map[string]any{"modelId": "exact", "sizeMode": "exact", "exactWidth": 6001, "exactHeight": 999}
	body := map[string]any{"type": "t2i", "prompt": "精确海报", "count": 1, "params": params}
	if recorder := request("/api/open/v1/tasks/quote", body); recorder.Code != http.StatusOK {
		t.Fatalf("valid public exact quote status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	recorder := request("/api/open/v1/tasks", body)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("public exact submission status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var submitted struct {
		Data struct {
			Params map[string]any `json:"params"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &submitted); err != nil {
		t.Fatal(err)
	}
	if submitted.Data.Params["size"] != "6001x999" || submitted.Data.Params["sizeMode"] != "exact" {
		t.Fatalf("public submission changed pixels: %#v", submitted.Data.Params)
	}
	params["exactWidth"] = 9000
	if recorder := request("/api/open/v1/tasks/quote", body); recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid public exact quote status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	params["exactWidth"] = 6001
	cfg.Models[0].SupportsExactSize = false
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if recorder := request("/api/open/v1/tasks/quote", body); recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unsupported public exact quote status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
