package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
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
	if response.Data.TaskPrices["t2i"] != 30 || response.Data.TaskPrices["puzzle"] != 0 {
		t.Fatalf("task prices = %#v", response.Data.TaskPrices)
	}
	if response.Data.TaskPointPrices["t2i"] != 30 || response.Data.TaskPointPrices["puzzle"] != 0 {
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
	for _, secret := range []string{
		"secret-key", "secret.example.com", "private-upstream-id", "内部模型", "RS Image",
		`"providerId"`, `"providerName"`, `"adapter":"openai"`,
	} {
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

func TestRuntimeConfigExposesImageUpscalePlatformPriceTiers(t *testing.T) {
	st := testdb.Setup(t)
	highDiscount := int64(4)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "crun", Name: "CRUN", Adapter: modelconfig.AdapterCRUN,
		BaseURL: "https://api.crun.ai", APIKey: "secret", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{{
		ID: "upscale", Name: "高清放大", ProviderID: "crun", UpstreamModel: "image-upscaler-basic",
		Kind: modelconfig.ModelKindImageTool, Tool: modelconfig.ImageToolUpscale, PriceCents: 3,
		ImageUpscalePricing: &modelconfig.ImageUpscalePricing{
			ThresholdPixels: 2048, HighPriceCents: 5, HighDiscountPriceCents: &highDiscount,
		},
		UpstreamInputFields: []string{"img_urls"},
		UpstreamInputSchema: map[string]any{"properties": map[string]any{"img_urls": map[string]any{"type": "array"}}},
		Public:              true, Enabled: true,
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
	body := recorder.Body.String()
	for _, expected := range []string{
		`"thresholdPixels":2048`, `"lowPricePoints":3`,
		`"highStandardPricePoints":5`, `"highPricePoints":4`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("runtime config missing %s: %s", expected, body)
		}
	}
}

func TestRuntimeConfigAndPricingExposeWorkspaceModelPrice(t *testing.T) {
	st := testdb.Setup(t)
	discount := int64(12)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: "openai",
		BaseURL: "https://api.example.com", APIKey: "secret", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{{
		ID: "shared-image", Name: "Shared Image", ProviderID: "provider",
		UpstreamModel: "shared-upstream", Kind: modelconfig.ModelKindImage,
		PriceCents: 30, Public: true, Default: true, Enabled: true,
	}}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceT2I: {
			ModelIDs: []string{"shared-image"},
			ModelPricing: map[string]modelconfig.WorkspaceModelPricing{
				"shared-image": {PriceCents: 18, DiscountPriceCents: &discount},
			},
		},
	}
	if err := modelconfig.Save(context.Background(), st.Pool, cfg); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/runtime-config", nil)
	(&Server{St: st}).runtimeConfig(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("runtime status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var runtimeResponse struct {
		Data struct {
			Features map[string]struct {
				Config struct {
					PublicModels []struct {
						ID                       string `json:"id"`
						PricePoints              int64  `json:"pricePoints"`
						StandardPricePoints      int64  `json:"standardPricePoints"`
						DiscountPricePoints      *int64 `json:"discountPricePoints"`
						WorkspacePriceOverridden bool   `json:"workspacePriceOverridden"`
					} `json:"publicModels"`
				} `json:"config"`
			} `json:"features"`
			AIModelCatalog struct {
				PublicModels []struct {
					ID          string `json:"id"`
					PricePoints int64  `json:"pricePoints"`
				} `json:"publicModels"`
			} `json:"aiModelCatalog"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &runtimeResponse); err != nil {
		t.Fatal(err)
	}
	models := runtimeResponse.Data.Features["ai.wallpaperGeneration"].Config.PublicModels
	if len(models) != 1 || models[0].PricePoints != 12 || models[0].StandardPricePoints != 18 ||
		models[0].DiscountPricePoints == nil || *models[0].DiscountPricePoints != 12 || !models[0].WorkspacePriceOverridden {
		t.Fatalf("workspace runtime models = %#v", models)
	}
	if catalog := runtimeResponse.Data.AIModelCatalog.PublicModels; len(catalog) != 1 || catalog[0].PricePoints != 30 {
		t.Fatalf("base catalog models = %#v", catalog)
	}

	recorder = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/pricing", nil)
	(&Server{St: st}).pricing(c)
	var pricingResponse struct {
		Data struct {
			TaskPointPrices map[string]int64 `json:"taskPointPrices"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &pricingResponse); err != nil {
		t.Fatal(err)
	}
	if pricingResponse.Data.TaskPointPrices["t2i"] != 12 {
		t.Fatalf("t2i public price = %#v", pricingResponse.Data.TaskPointPrices)
	}
}

func TestRuntimeConfigExposesResolvedPageControls(t *testing.T) {
	st := testdb.Setup(t)
	raw := json.RawMessage(`{"studio":{"status":"maintenance","reason":"系统升级"}}`)
	if err := settings.Set(context.Background(), st.Pool, "page_controls", raw); err != nil {
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
			PageControls map[string]settings.PageControl `json:"pageControls"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if got := response.Data.PageControls["studio"]; got.Status != settings.PageStatusMaintenance || got.Reason != "系统升级" {
		t.Fatalf("studio control = %#v", got)
	}
	if got := response.Data.PageControls["activity.failure"]; got.Status != settings.PageStatusRemoved {
		t.Fatalf("default failure control = %#v", got)
	}
	if got := response.Data.PageControls["developer_api"]; got.Status != settings.PageStatusRemoved {
		t.Fatalf("default developer API control = %#v", got)
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
		{ID: "ui-analysis", Name: "元素分析模型", ProviderID: "provider", UpstreamModel: "upstream-chat", Kind: "chat", Public: true, Enabled: true},
		{ID: "ecommerce-analysis", Name: "商品分析模型", ProviderID: "provider", UpstreamModel: "upstream-commerce-chat", Kind: "chat", Public: true, Enabled: true},
		{ID: "canvas-image", Name: "画布生图模型", ProviderID: "provider", UpstreamModel: "upstream-canvas-image", Kind: "image", Public: true, Enabled: true},
		{ID: "canvas-chat", Name: "画布文本模型", ProviderID: "provider", UpstreamModel: "provider/gpt-5-5", Kind: "chat", Public: true, Enabled: true},
		{ID: "canvas-chat-alias-56", Name: "画布别名模型", ProviderID: "provider", UpstreamModel: "provider/gpt-5-6", Kind: "chat", Public: true, Enabled: true},
		{
			ID: "canvas-chat-sol", Name: "画布 Sol 模型", ProviderID: "provider", UpstreamModel: "provider/gpt-5.6-sol",
			Kind: "chat", PriceCents: 7, Public: true, Enabled: true,
			SupportedReasoningEfforts: []string{"low", "medium", "high", "xhigh", "max"},
		},
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceT2I:     {ModelIDs: []string{"t2i-model"}},
		modelconfig.WorkspaceGameArt: {ModelIDs: []string{"game-model"}},
		modelconfig.WorkspaceUIDesign: {
			ModelIDs:        []string{"ui-analysis"},
			DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: "ui-analysis"},
		},
		modelconfig.WorkspaceEcommerce: {
			ModelIDs:        []string{"ecommerce-analysis"},
			DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: "ecommerce-analysis"},
		},
		modelconfig.WorkspaceCanvas: {
			ModelIDs: []string{"canvas-image", "canvas-chat", "canvas-chat-alias-56", "canvas-chat-sol"},
			DefaultModelIDs: map[string]string{
				modelconfig.ModelKindImage: "canvas-image",
				modelconfig.ModelKindChat:  "canvas-chat",
			},
		},
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
					AnalysisModels []struct {
						ID      string `json:"id"`
						Model   string `json:"model"`
						Label   string `json:"label"`
						Default bool   `json:"default"`
					} `json:"analysisModels"`
					ImageModels []struct {
						ID      string `json:"id"`
						Default bool   `json:"default"`
					} `json:"imageModels"`
					TextModels []struct {
						ID                        string   `json:"id"`
						Default                   bool     `json:"default"`
						SupportedReasoningEfforts []string `json:"supportedReasoningEfforts"`
						DefaultReasoningEffort    string   `json:"defaultReasoningEffort"`
						ReasoningPrices           map[string]struct {
							AssistantStandardPricePoints   int64 `json:"assistantStandardPricePoints"`
							AssistantPricePoints           int64 `json:"assistantPricePoints"`
							CanvasAgentStandardPricePoints int64 `json:"canvasAgentStandardPricePoints"`
							CanvasAgentPricePoints         int64 `json:"canvasAgentPricePoints"`
						} `json:"reasoningPrices"`
					} `json:"textModels"`
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
	analysis := response.Data.Features["ai.uiDesign"].Config.AnalysisModels
	if len(analysis) != 1 || analysis[0].ID != "ui-analysis" || analysis[0].Model != "ui-analysis" ||
		analysis[0].Label != "元素分析模型" || !analysis[0].Default {
		t.Fatalf("UI analysis models = %#v", analysis)
	}
	ecommerceAnalysis := response.Data.Features["ai.ecommerceDesign"].Config.AnalysisModels
	if len(ecommerceAnalysis) != 1 || ecommerceAnalysis[0].ID != "ecommerce-analysis" ||
		ecommerceAnalysis[0].Model != "ecommerce-analysis" || ecommerceAnalysis[0].Label != "商品分析模型" ||
		!ecommerceAnalysis[0].Default {
		t.Fatalf("ecommerce analysis models = %#v", ecommerceAnalysis)
	}
	canvas := response.Data.Features["ai.infiniteCanvas"].Config
	if len(canvas.ImageModels) != 1 || canvas.ImageModels[0].ID != "canvas-image" || !canvas.ImageModels[0].Default {
		t.Fatalf("canvas image models = %#v", canvas.ImageModels)
	}
	if len(canvas.TextModels) != 3 || canvas.TextModels[0].ID != "canvas-chat" || !canvas.TextModels[0].Default {
		t.Fatalf("canvas text models = %#v", canvas.TextModels)
	}
	wantReasoningProfiles := map[string]struct {
		efforts       []string
		defaultEffort string
	}{
		"canvas-chat":          {efforts: []string{}},
		"canvas-chat-alias-56": {efforts: []string{}},
		"canvas-chat-sol":      {efforts: []string{"low", "medium", "high", "xhigh", "max"}, defaultEffort: "medium"},
	}
	for _, got := range canvas.TextModels {
		want, ok := wantReasoningProfiles[got.ID]
		if !ok || !reflect.DeepEqual(got.SupportedReasoningEfforts, want.efforts) || got.DefaultReasoningEffort != want.defaultEffort {
			t.Fatalf("canvas reasoning profile = %#v", got)
		}
		if got.ID == "canvas-chat-sol" {
			if len(got.ReasoningPrices) != 5 || got.ReasoningPrices["medium"].CanvasAgentPricePoints != 21 || got.ReasoningPrices["high"].CanvasAgentPricePoints != 35 {
				t.Fatalf("canvas reasoning prices = %#v", got.ReasoningPrices)
			}
		} else if len(got.ReasoningPrices) != 0 {
			t.Fatalf("unexpected alias reasoning prices = %#v", got.ReasoningPrices)
		}
	}
}

func TestRuntimeConfigFallsBackToAssistantChatForUIDesignAnalysis(t *testing.T) {
	st := testdb.Setup(t)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{
		ID: "provider", Name: "Provider", Adapter: "openai", BaseURL: "https://example.com",
		APIKey: "secret", Enabled: true,
	}}
	cfg.Models = []modelconfig.Model{{
		ID: "assistant-chat", Name: "助手视觉模型", ProviderID: "provider", UpstreamModel: "upstream-chat",
		Kind: modelconfig.ModelKindChat, Public: true, Enabled: true,
	}}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{
		modelconfig.WorkspaceAssistant: {
			ModelIDs:        []string{"assistant-chat"},
			DefaultModelIDs: map[string]string{modelconfig.ModelKindChat: "assistant-chat"},
		},
		modelconfig.WorkspaceUIDesign: {ModelIDs: []string{}},
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
					AnalysisModels []struct {
						Model string `json:"model"`
					} `json:"analysisModels"`
					TextModels []struct {
						Model string `json:"model"`
					} `json:"textModels"`
				} `json:"config"`
			} `json:"features"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	models := response.Data.Features["ai.uiDesign"].Config.AnalysisModels
	if len(models) != 1 || models[0].Model != "assistant-chat" {
		t.Fatalf("UI design analysis fallback = %#v", models)
	}
	assistantModels := response.Data.Features["ai.assistant"].Config.TextModels
	if len(assistantModels) != 1 || assistantModels[0].Model != "assistant-chat" {
		t.Fatalf("assistant text models = %#v", assistantModels)
	}
}
