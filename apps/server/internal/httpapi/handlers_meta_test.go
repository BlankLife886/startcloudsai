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

func TestPricingReturnsStructuredModelRoutePrices(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	if err := settings.Set(ctx, st.Pool, "task_prices", json.RawMessage(`{"t2i":9,"puzzle":5}`)); err != nil {
		t.Fatal(err)
	}
	discount := int64(20)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "provider", Name: "Provider", Adapter: "openai", Enabled: true}}
	cfg.Models = []modelconfig.Model{
		{ID: "standard", Name: "Standard", ProviderID: "provider", UpstreamModel: "image", Kind: "image", PriceCents: 30, Public: true, Enabled: true},
		{ID: "discounted", Name: "Discounted", ProviderID: "provider", UpstreamModel: "image", Kind: "image", PriceCents: 40, DiscountPriceCents: &discount, Public: true, Enabled: true},
	}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/pricing", nil)
	(&Server{St: st}).pricing(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			TaskPrices      map[string]int64                  `json:"taskPrices"`
			TaskPointPrices map[string]int64                  `json:"taskPointPrices"`
			TaskPriceRanges map[string]modelconfig.PriceRange `json:"taskPriceRanges"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.TaskPrices["t2i"] != 30 || response.Data.TaskPrices["puzzle"] != 5 {
		t.Fatalf("task prices = %#v", response.Data.TaskPrices)
	}
	if response.Data.TaskPointPrices["t2i"] != 30 || response.Data.TaskPointPrices["puzzle"] != 5 {
		t.Fatalf("task point prices = %#v", response.Data.TaskPointPrices)
	}
	if got := response.Data.TaskPriceRanges["t2i"]; got.MinCents != 20 || got.MaxCents != 30 {
		t.Fatalf("t2i price range = %#v", got)
	}
}

func TestRuntimeConfigExposesOnlyPublicModelMapping(t *testing.T) {
	st := testdb.Setup(t)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "RS Image", Adapter: "openai", BaseURL: "https://secret.example.com",
		APIKey: "secret-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{
		{ID: "public-image", Name: "公开图片模型", ProviderID: "provider", UpstreamModel: "private-upstream-id", Kind: "image", PriceCents: 3, Public: true, Enabled: true},
		{ID: "private-image", Name: "内部模型", ProviderID: "provider", UpstreamModel: "private", Kind: "image", Public: false, Enabled: true},
	}
	if err := modelconfig.Save(context.Background(), st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/runtime-config", nil)
	(&Server{St: st}).runtimeConfig(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	for _, secret := range []string{"secret-key", "secret.example.com", "private-upstream-id", "内部模型"} {
		if strings.Contains(body, secret) {
			t.Fatalf("runtime config leaked %q: %s", secret, body)
		}
	}
	if !strings.Contains(body, "public-image") || !strings.Contains(body, "公开图片模型") {
		t.Fatalf("public model missing: %s", body)
	}
	if strings.Contains(body, "RS Image · 公开图片模型") {
		t.Fatalf("user-facing model label contains provider prefix: %s", body)
	}
	if !strings.Contains(body, `"creditCost":3`) || !strings.Contains(body, `"pricePoints":3`) ||
		!strings.Contains(body, `"standardPricePoints":3`) {
		t.Fatalf("runtime config missing integer point price: %s", body)
	}
}

func TestRuntimeConfigSeparatesBackgroundRemovalTools(t *testing.T) {
	st := testdb.Setup(t)
	discount := int64(6)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "crun-secret-route", Name: "CRUN Internal", Adapter: "crun",
		BaseURL: "https://secret-tool.example.com", APIKey: "secret-tool-key", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{{
		ID: "background-removal", Name: "背景移除", ProviderID: "crun-secret-route",
		UpstreamModel: "image-background-remove", Kind: modelconfig.ModelKindImageTool,
		Tool: modelconfig.ImageToolBackgroundRemove, PriceCents: 9, DiscountPriceCents: &discount,
		Public: true, Enabled: true, Default: true,
	}}
	if err := modelconfig.Save(context.Background(), st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/runtime-config", nil)
	(&Server{St: st}).runtimeConfig(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			Features map[string]struct {
				Enabled bool `json:"enabled"`
				Config  struct {
					BackgroundRemovalModels []struct {
						ID                  string `json:"id"`
						Tool                string `json:"tool"`
						PricePoints         int64  `json:"pricePoints"`
						StandardPricePoints int64  `json:"standardPricePoints"`
						DiscountPricePoints *int64 `json:"discountPricePoints"`
					} `json:"backgroundRemovalModels"`
					PublicModels []struct {
						ID string `json:"id"`
					} `json:"publicModels"`
				} `json:"config"`
			} `json:"features"`
			AIModelCatalog struct {
				PublicModels []struct {
					ID string `json:"id"`
				} `json:"publicModels"`
			} `json:"aiModelCatalog"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	feature := response.Data.Features["ai.imageTools"]
	if !feature.Enabled || len(feature.Config.BackgroundRemovalModels) != 1 {
		t.Fatalf("image tools feature = %#v", feature)
	}
	tool := feature.Config.BackgroundRemovalModels[0]
	if tool.ID != "background-removal" || tool.Tool != modelconfig.ImageToolBackgroundRemove ||
		tool.PricePoints != 6 || tool.StandardPricePoints != 9 || tool.DiscountPricePoints == nil || *tool.DiscountPricePoints != 6 {
		t.Fatalf("background removal model = %#v", tool)
	}
	for _, model := range response.Data.AIModelCatalog.PublicModels {
		if model.ID == tool.ID {
			t.Fatalf("image tool leaked into generation models: %#v", response.Data.AIModelCatalog.PublicModels)
		}
	}
	body := recorder.Body.String()
	for _, secret := range []string{"secret-tool-key", "secret-tool.example.com", "image-background-remove", "crun-secret-route", "CRUN Internal"} {
		if strings.Contains(body, secret) {
			t.Fatalf("runtime config leaked %q: %s", secret, body)
		}
	}
}

func TestRuntimeConfigUsesWorkspaceSpecificModels(t *testing.T) {
	st := testdb.Setup(t)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: "openai", BaseURL: "https://example.com",
		APIKey: "secret", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{
		{ID: "t2i-model", Name: "文生图模型", ProviderID: "provider", UpstreamModel: "upstream-a", Kind: "image", Resolutions: []string{"1K", "2K"}, Public: true, Enabled: true},
		{ID: "game-model", Name: "游戏模型", ProviderID: "provider", UpstreamModel: "upstream-b", Kind: "image", Resolutions: []string{"4K"}, Public: true, Enabled: true},
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceT2I:     {ModelIDs: []string{"t2i-model"}},
		modelconfig.WorkspaceGameArt: {ModelIDs: []string{"game-model"}},
	}
	if err := modelconfig.Save(context.Background(), st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/runtime-config", nil)
	(&Server{St: st}).runtimeConfig(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			Features map[string]struct {
				Config struct {
					PublicModels []struct {
						ID                       string              `json:"id"`
						Label                    string              `json:"label"`
						Resolutions              []string            `json:"resolutions"`
						AspectRatiosByResolution map[string][]string `json:"aspectRatiosByResolution"`
					} `json:"publicModels"`
				} `json:"config"`
			} `json:"features"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	t2i := response.Data.Features["ai.wallpaperGeneration"].Config.PublicModels
	game := response.Data.Features["ai.gameDesign"].Config.PublicModels
	if len(t2i) != 1 || t2i[0].ID != "t2i-model" || t2i[0].Label != "文生图模型" || len(t2i[0].Resolutions) != 2 {
		t.Fatalf("t2i models = %#v", t2i)
	}
	if len(t2i[0].AspectRatiosByResolution["1K"]) != len(modelconfig.ImageAspectRatios) ||
		len(t2i[0].AspectRatiosByResolution["2K"]) != len(modelconfig.ImageAspectRatios) {
		t.Fatalf("t2i ratio controls = %#v", t2i[0].AspectRatiosByResolution)
	}
	if len(game) != 1 || game[0].ID != "game-model" || game[0].Label != "游戏模型" || len(game[0].Resolutions) != 1 || game[0].Resolutions[0] != "4K" {
		t.Fatalf("game models = %#v", game)
	}
}
