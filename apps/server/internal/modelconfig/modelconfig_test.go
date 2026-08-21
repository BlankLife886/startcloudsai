package modelconfig

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func int64Pointer(value int64) *int64 { return &value }

func testConfig() Config {
	return Config{
		Version: Version,
		Providers: []Provider{{
			ID: "provider", Name: "图片服务", Adapter: AdapterOpenAI,
			BaseURL: "https://api.example.com", APIKey: "secret", Enabled: true,
		}},
		Models: []Model{
			{ID: "image-quality", Name: "高质量", ProviderID: "provider", UpstreamModel: "image-quality", Kind: ModelKindImage, PriceCents: 30, Public: true, Default: true, Enabled: true},
			{ID: "image-fast", Name: "快速", ProviderID: "provider", UpstreamModel: "image-fast", Kind: ModelKindImage, PriceCents: 20, Public: true, Enabled: true},
			{ID: "chat", Name: "对话", ProviderID: "provider", UpstreamModel: "chat-model", Kind: ModelKindChat, Public: true, Default: true, Enabled: true},
		},
	}
}

func TestSelectPublicUsesRequestedOrDefaultModel(t *testing.T) {
	cfg := testConfig()
	selected, ok := SelectPublic(cfg, ModelKindImage, "image-fast")
	if !ok || selected.Model.ID != "image-fast" || selected.Provider.ID != "provider" {
		t.Fatalf("requested selection = %#v", selected)
	}
	selected, ok = SelectPublic(cfg, ModelKindImage, "")
	if !ok || selected.Model.ID != "image-quality" {
		t.Fatalf("default selection = %#v", selected)
	}
	if _, ok = SelectPublic(cfg, ModelKindImage, "chat"); ok {
		t.Fatal("chat model must not be selectable for image generation")
	}
}

func TestChatModelContextDefaultsAndValidation(t *testing.T) {
	cfg := testConfig()
	selected, ok := SelectPublic(cfg, ModelKindChat, "chat")
	if !ok || selected.Model.ContextWindowTokens != 128_000 || selected.Model.MaxOutputTokens != 8_192 {
		t.Fatalf("chat context defaults = %#v", selected)
	}
	cfg.Models[2].ContextWindowTokens = 3_000
	if err := Validate(cfg); err == nil || !strings.Contains(err.Error(), "上下文窗口") {
		t.Fatalf("expected invalid context window, got %v", err)
	}
}

func TestWorkspaceSelectionUsesAssignedModelsAndPageDefault(t *testing.T) {
	cfg := testConfig()
	cfg.Workspaces = map[string]WorkspaceBinding{
		WorkspaceT2I: {
			ModelIDs:        []string{"image-fast"},
			DefaultModelIDs: map[string]string{ModelKindImage: "image-fast"},
		},
		WorkspaceColoring: {ModelIDs: []string{}},
	}
	selected, ok := SelectPublicForWorkspace(cfg, WorkspaceT2I, ModelKindImage, "")
	if !ok || selected.Model.ID != "image-fast" {
		t.Fatalf("workspace default selection = %#v", selected)
	}
	if _, ok := SelectPublicForWorkspace(cfg, WorkspaceT2I, ModelKindImage, "image-quality"); ok {
		t.Fatal("model assigned to another page must not be selectable")
	}
	if models := PublicModelsForWorkspace(cfg, WorkspaceColoring, ModelKindImage); len(models) != 0 {
		t.Fatalf("explicit empty workspace returned %#v", models)
	}
	if selected, ok := SelectPublicForWorkspace(cfg, WorkspaceGameArt, ModelKindImage, ""); !ok || selected.Model.ID != "image-quality" {
		t.Fatalf("missing workspace binding must keep legacy fallback: %#v", selected)
	}
}

func TestValidateWorkspaceAssignmentKinds(t *testing.T) {
	cfg := testConfig()
	cfg.Workspaces = map[string]WorkspaceBinding{
		WorkspaceT2I: {ModelIDs: []string{"chat"}},
	}
	if err := Validate(cfg); err == nil || !strings.Contains(err.Error(), "不支持 chat") {
		t.Fatalf("expected image workspace kind validation, got %v", err)
	}
	cfg.Workspaces = map[string]WorkspaceBinding{
		WorkspaceAssistant: {
			ModelIDs: []string{"chat", "image-fast"},
			DefaultModelIDs: map[string]string{
				ModelKindChat: "chat", ModelKindImage: "image-fast",
			},
		},
	}
	if err := Validate(cfg); err != nil {
		t.Fatalf("assistant mixed model assignment should be valid: %v", err)
	}
	cfg.Workspaces = map[string]WorkspaceBinding{
		WorkspaceUIDesign: {
			ModelIDs:        []string{"image-fast", "chat"},
			DefaultModelIDs: map[string]string{ModelKindImage: "image-fast", ModelKindChat: "chat"},
		},
	}
	if err := Validate(cfg); err != nil {
		t.Fatalf("UI design image and analysis model assignment should be valid: %v", err)
	}
	cfg.Workspaces = map[string]WorkspaceBinding{
		WorkspaceEcommerce: {
			ModelIDs:        []string{"image-fast", "chat"},
			DefaultModelIDs: map[string]string{ModelKindImage: "image-fast", ModelKindChat: "chat"},
		},
	}
	if err := Validate(cfg); err != nil {
		t.Fatalf("ecommerce image and analysis model assignment should be valid: %v", err)
	}
	cfg.Workspaces = map[string]WorkspaceBinding{
		WorkspaceCanvas: {
			ModelIDs:        []string{"image-fast", "chat"},
			DefaultModelIDs: map[string]string{ModelKindImage: "image-fast", ModelKindChat: "chat"},
		},
	}
	if err := Validate(cfg); err != nil {
		t.Fatalf("infinite canvas image and chat assignment should be valid: %v", err)
	}
}

func TestLegacyProviderMigratesToSingleKeyAdapter(t *testing.T) {
	var provider Provider
	err := json.Unmarshal([]byte(`{
		"id":"legacy","name":"Legacy","type":"sub2api","baseUrl":"https://api.example.com",
		"enabled":true,"keys":[{"secret":"encrypted-primary","enabled":true},{"secret":"other","enabled":true}]
	}`), &provider)
	if err != nil {
		t.Fatal(err)
	}
	if provider.Adapter != AdapterOpenAI || provider.APIKey != "encrypted-primary" {
		t.Fatalf("legacy provider = %#v", provider)
	}
}

func TestProviderConcurrencyDefaultsToOneHundred(t *testing.T) {
	cfg := testConfig()
	normalize(&cfg)
	if got := cfg.Providers[0].MaxConcurrency; got != 100 {
		t.Fatalf("default max concurrency = %d", got)
	}
}

func TestExecutionCandidatesStayWithinBoundProvider(t *testing.T) {
	cfg := testConfig()
	cfg.Providers = append(cfg.Providers,
		Provider{ID: "backup", Name: "备用", Adapter: AdapterOpenAI, APIKey: "backup-secret", Enabled: true, MaxConcurrency: 200},
		Provider{ID: "crun", Name: "CRUN", Adapter: AdapterCRUN, APIKey: "crun-secret", Enabled: true, MaxConcurrency: 200},
	)
	cfg.Models = append(cfg.Models,
		Model{ID: "backup-image", Name: "备用高质量", ProviderID: "backup", UpstreamModel: "image-quality", Kind: ModelKindImage, Enabled: true},
		Model{ID: "different-model", Name: "不同模型", ProviderID: "backup", UpstreamModel: "other-image", Kind: ModelKindImage, Enabled: true},
		Model{ID: "different-adapter", Name: "不同协议", ProviderID: "crun", UpstreamModel: "image-quality", Kind: ModelKindImage, Enabled: true},
	)
	candidates := ExecutionCandidates(cfg, "provider", "image-quality")
	if len(candidates) != 1 || candidates[0].Provider.ID != "provider" {
		t.Fatalf("execution candidates = %#v", candidates)
	}
}

func TestExecutionCandidatesAcrossProvidersRequireSameNameAndEffectivePrice(t *testing.T) {
	cfg := testConfig()
	equalDiscount := int64(30)
	cfg.Providers = append(cfg.Providers,
		Provider{ID: "equal", Name: "同价", Adapter: AdapterOpenAI, APIKey: "equal-secret", Enabled: true, MaxConcurrency: 200},
		Provider{ID: "expensive", Name: "异价", Adapter: AdapterOpenAI, APIKey: "expensive-secret", Enabled: true, MaxConcurrency: 200},
		Provider{ID: "different", Name: "异名", Adapter: AdapterOpenAI, APIKey: "different-secret", Enabled: true, MaxConcurrency: 200},
		Provider{ID: "private", Name: "未公开", Adapter: AdapterOpenAI, APIKey: "private-secret", Enabled: true, MaxConcurrency: 200},
	)
	cfg.Models = append(cfg.Models,
		Model{ID: "equal-model", Name: " 高质量 ", ProviderID: "equal", UpstreamModel: "provider-b-image", Kind: ModelKindImage, PriceCents: 50, DiscountPriceCents: &equalDiscount, Public: true, Enabled: true},
		Model{ID: "expensive-model", Name: "高质量", ProviderID: "expensive", UpstreamModel: "provider-c-image", Kind: ModelKindImage, PriceCents: 31, Public: true, Enabled: true},
		Model{ID: "different-model", Name: "高质量 Pro", ProviderID: "different", UpstreamModel: "provider-d-image", Kind: ModelKindImage, PriceCents: 30, Public: true, Enabled: true},
		Model{ID: "private-model", Name: "高质量", ProviderID: "private", UpstreamModel: "provider-e-image", Kind: ModelKindImage, PriceCents: 30, Public: false, Enabled: true},
	)
	candidates := ExecutionCandidatesRouteAcrossProviders(cfg, "provider", "image-quality", "", 30)
	if len(candidates) != 2 || candidates[0].Provider.ID != "provider" || candidates[1].Provider.ID != "equal" {
		t.Fatalf("cross-provider candidates = %#v", candidates)
	}
	if candidates[1].Model.UpstreamModel != "provider-b-image" {
		t.Fatalf("alternate upstream model = %q", candidates[1].Model.UpstreamModel)
	}

	candidates = ExecutionCandidatesRouteAcrossProviders(cfg, "provider", "image-quality", "", 29)
	if len(candidates) != 1 || candidates[0].Provider.ID != "provider" {
		t.Fatalf("price snapshot mismatch candidates = %#v", candidates)
	}
}

func TestBackgroundRemovalToolSelectionAndValidation(t *testing.T) {
	cfg := testConfig()
	cfg.Providers = append(cfg.Providers, Provider{
		ID: "crun-tool", Name: "CRUN Tool", Adapter: AdapterCRUN,
		BaseURL: "https://api.crun.ai", APIKey: "tool-secret", Enabled: true,
	})
	cfg.Models = append(cfg.Models, Model{
		ID: "remove-bg", Name: "背景移除", ProviderID: "crun-tool",
		UpstreamModel: "image-background-remove", Kind: ModelKindImageTool,
		Tool: ImageToolBackgroundRemove, PriceCents: 5, Public: true, Enabled: true,
	})
	if err := Validate(cfg); err != nil {
		t.Fatalf("valid background removal tool: %v", err)
	}
	selected, ok := SelectPublicImageTool(cfg, ImageToolBackgroundRemove, "")
	if !ok || selected.Model.ID != "remove-bg" || selected.Model.Tool != ImageToolBackgroundRemove {
		t.Fatalf("selected tool = %#v ok=%v", selected, ok)
	}

	invalid := cfg
	invalid.Models = append([]Model(nil), cfg.Models...)
	invalid.Models[len(invalid.Models)-1].Tool = "unknown_tool"
	if err := Validate(invalid); err == nil || !strings.Contains(err.Error(), "工具能力无效") {
		t.Fatalf("invalid tool validation = %v", err)
	}
}

func TestExecutionCandidatesExpandsProviderBaseURLRoutes(t *testing.T) {
	cfg := testConfig()
	cfg.Providers[0].Routes = []ProviderRoute{
		{ID: "primary", Name: "主线路", BaseURL: "https://a.example.com", APIKey: "a-key", MaxConcurrency: 100, Enabled: true},
		{ID: "backup", Name: "备用线路", BaseURL: "https://b.example.com", APIKey: "b-key", MaxConcurrency: 80, Enabled: true},
	}
	candidates := ExecutionCandidatesRoute(cfg, "provider", "image-quality", "backup")
	if len(candidates) != 2 || candidates[0].Provider.RouteID != "backup" || candidates[0].Provider.BaseURL != "https://b.example.com" {
		t.Fatalf("route candidates = %#v", candidates)
	}
	if ExecutionRouteKey(candidates[1].Provider) != "provider/primary" {
		t.Fatalf("second route key = %q", ExecutionRouteKey(candidates[1].Provider))
	}
}

func TestExecutionCandidatesDoNotCrossProviderWhenBoundProviderIsDisabled(t *testing.T) {
	cfg := testConfig()
	cfg.Providers[0].Enabled = false
	cfg.Providers = append(cfg.Providers, Provider{
		ID: "backup", Name: "备用", Adapter: AdapterOpenAI, APIKey: "backup-secret", Enabled: true, MaxConcurrency: 100,
	})
	cfg.Models = append(cfg.Models, Model{
		ID: "backup-image", Name: "备用高质量", ProviderID: "backup", UpstreamModel: "image-quality", Kind: ModelKindImage, Enabled: true,
	})
	candidates := ExecutionCandidates(cfg, "provider", "image-quality")
	if len(candidates) != 0 {
		t.Fatalf("disabled provider candidates = %#v", candidates)
	}
}

func TestLegacyImageModelReceivesDefaultCapabilities(t *testing.T) {
	var cfg Config
	if err := json.Unmarshal([]byte(`{
		"version":2,"providers":[],"models":[{
			"id":"legacy-image","name":"Legacy","kind":"image","enabled":true
		}],"workspaces":{}
	}`), &cfg); err != nil {
		t.Fatal(err)
	}
	normalize(&cfg)
	model := cfg.Models[0]
	if len(model.AspectRatios) != len(ImageAspectRatios) || len(model.Qualities) != len(ImageQualities) {
		t.Fatalf("legacy capabilities were not populated: %#v", model)
	}
	if !model.TransparentBackground || model.MaxReferenceImages != 4 || model.MaxImages != 4 {
		t.Fatalf("legacy defaults = transparent %v, references %d, images %d", model.TransparentBackground, model.MaxReferenceImages, model.MaxImages)
	}
}

func TestExplicitlyDisabledImageCapabilitiesStayDisabled(t *testing.T) {
	var cfg Config
	if err := json.Unmarshal([]byte(`{
		"version":3,"providers":[],"models":[{
			"id":"strict-image","name":"Strict","kind":"image","enabled":true,
			"aspectRatios":["1:1"],"qualities":["high"],
			"transparentBackground":false,"outputFormats":[],"moderationLevels":[],
			"maxReferenceImages":0
		}],"workspaces":{}
	}`), &cfg); err != nil {
		t.Fatal(err)
	}
	normalize(&cfg)
	model := cfg.Models[0]
	if model.TransparentBackground || model.MaxReferenceImages != 0 {
		t.Fatalf("explicit disabled flags were overwritten: %#v", model)
	}
	if model.OutputFormats == nil || len(model.OutputFormats) != 0 || model.ModerationLevels == nil || len(model.ModerationLevels) != 0 {
		t.Fatalf("built-in behavior markers were overwritten: %#v", model)
	}
}

func TestExplicitImageCountLimitKeepsItsValue(t *testing.T) {
	var model Model
	if err := json.Unmarshal([]byte(`{
		"id":"count-model","name":"Count model","kind":"image",
		"maxImages":8
	}`), &model); err != nil {
		t.Fatal(err)
	}
	if model.MaxImages != 8 || !model.maxImagesSet {
		t.Fatalf("max images = %d, set = %v", model.MaxImages, model.maxImagesSet)
	}
	if got := model.GenerationMaxImages(); got != 8 {
		t.Fatalf("GenerationMaxImages = %d", got)
	}
}

func TestExplicitReferenceImageLimitKeepsItsValue(t *testing.T) {
	var model Model
	if err := json.Unmarshal([]byte(`{
		"id":"reference-model","name":"Reference model","kind":"image",
		"maxReferenceImages":7
	}`), &model); err != nil {
		t.Fatal(err)
	}
	if model.MaxReferenceImages != 7 || !model.maxReferenceImagesSet {
		t.Fatalf("reference image limit = %d, set = %v", model.MaxReferenceImages, model.maxReferenceImagesSet)
	}
}

func TestAutoAspectRatioResolvesByResolution(t *testing.T) {
	model := Model{
		Resolutions:  []string{"1K", "2K", "4K"},
		AspectRatios: []string{"auto", "1:1", "3:2", "16:9"},
		AspectRatiosByResolution: map[string][]string{
			"1K": {"1:1", "3:2"}, "2K": {"3:2"}, "4K": {"16:9", "1:1"},
		},
	}
	if got := AutoAspectRatioCandidates(model, "4K"); len(got) != 2 || got[0] != "16:9" || got[1] != "1:1" {
		t.Fatalf("4K auto ratios = %#v", got)
	}
	if got := AutoAspectRatioCandidates(model, "2K"); len(got) != 1 || got[0] != "3:2" {
		t.Fatalf("2K auto ratios = %#v", got)
	}
}

func TestLegacyGlobalAspectRatiosPopulateEveryResolution(t *testing.T) {
	cfg := Config{Models: []Model{{
		Kind: ModelKindImage, Resolutions: []string{"1K", "4K"},
		AspectRatios: []string{"auto", "16:9", "1:1"},
	}}}
	normalize(&cfg)
	rules := cfg.Models[0].AspectRatiosByResolution
	if len(rules["1K"]) != 3 || rules["1K"][0] != "auto" || len(rules["4K"]) != 3 || rules["4K"][2] != "1:1" {
		t.Fatalf("legacy global ratio rules = %#v", rules)
	}
}

func TestLegacySingleAutoAspectRatioMigratesToMultiple(t *testing.T) {
	var model Model
	if err := json.Unmarshal([]byte(`{
		"kind":"image","resolutions":["4K"],"aspectRatios":["auto","16:9","1:1"],
		"autoAspectRatios":{"4K":"16:9"}
	}`), &model); err != nil {
		t.Fatal(err)
	}
	if got := AutoAspectRatioCandidates(model, "4K"); len(got) != 1 || got[0] != "16:9" {
		t.Fatalf("legacy single rule = %#v", got)
	}
	if got := AspectRatiosForResolution(model, "4K"); len(got) != 2 || got[0] != "auto" || got[1] != "16:9" {
		t.Fatalf("legacy user-selectable ratios = %#v", got)
	}
}

func TestAspectRatiosAreResolutionSpecific(t *testing.T) {
	model := Model{
		Resolutions:  []string{"1K", "4K"},
		AspectRatios: []string{"auto", "16:9", "1:1"},
		AspectRatiosByResolution: map[string][]string{
			"1K": {"auto", "16:9"},
			"4K": {"auto", "1:1"},
		},
	}
	if got := AspectRatiosForResolution(model, "4K"); len(got) != 2 || got[0] != "auto" || got[1] != "1:1" {
		t.Fatalf("4K ratios = %#v", got)
	}
	if got := AutoAspectRatioCandidates(model, "4K"); len(got) != 1 || got[0] != "1:1" {
		t.Fatalf("4K auto candidates = %#v", got)
	}
}

func TestAspectRatiosByResolutionJSONIsPreserved(t *testing.T) {
	var cfg Config
	if err := json.Unmarshal([]byte(`{
		"models":[{
			"kind":"image","resolutions":["1K","4K"],
			"aspectRatios":["auto","16:9","1:1"],
			"aspectRatiosByResolution":{"1K":["auto","16:9"],"4K":["auto","1:1"]}
		}]
	}`), &cfg); err != nil {
		t.Fatal(err)
	}
	normalize(&cfg)
	if got := cfg.Models[0].AspectRatiosByResolution["4K"]; len(got) != 2 || got[0] != "auto" || got[1] != "1:1" {
		t.Fatalf("new ratio controls were not preserved: %#v", cfg.Models[0].AspectRatiosByResolution)
	}
}

func TestAdminAPIKeyIsEncryptedMaskedAndPreserved(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	const masterKey = "model-config-test-master-key"
	cfg := testConfig()
	plainKeys := []string{"plain-secret-1234", "backup-secret-5678"}
	cfg.Providers[0].Routes = []ProviderRoute{
		{ID: "primary", Name: "主线路", BaseURL: "https://primary.example.com", APIKey: plainKeys[0], TimeoutSecs: 120, MaxConcurrency: 100, Enabled: true},
		{ID: "backup", Name: "备用线路", BaseURL: "https://backup.example.com", APIKey: plainKeys[1], TimeoutSecs: 90, MaxConcurrency: 80, Enabled: true},
	}
	cfg.Providers[0].DiscoveredModels = []string{" z-model ", "a-model", "z-model"}

	prepared, err := PrepareAdminSave(ctx, st.Pool, cfg, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	storedKeys := []string{prepared.Providers[0].Routes[0].APIKey, prepared.Providers[0].Routes[1].APIKey}
	for index, storedKey := range storedKeys {
		if storedKey == plainKeys[index] || strings.Contains(storedKey, "secret") {
			t.Fatalf("route %d API key was not encrypted: %q", index, storedKey)
		}
	}
	if err := Save(ctx, st.Pool, prepared); err != nil {
		t.Fatal(err)
	}
	adminView, err := AdminView(ctx, st.Pool, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if got := adminView.Providers[0].Routes[0].APIKey; got != "****1234" {
		t.Fatalf("primary masked API key = %q", got)
	}
	if got := adminView.Providers[0].Routes[1].APIKey; got != "****5678" {
		t.Fatalf("backup masked API key = %q", got)
	}
	if got := adminView.Providers[0].DiscoveredModels; len(got) != 2 || got[0] != "a-model" || got[1] != "z-model" {
		t.Fatalf("discovered models = %#v", got)
	}
	preserved, err := PrepareAdminSave(ctx, st.Pool, adminView, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	for index, storedKey := range storedKeys {
		if preserved.Providers[0].Routes[index].APIKey != storedKey {
			t.Fatalf("route %d masked save replaced the stored API key", index)
		}
	}
	runtimeCfg, err := Runtime(ctx, st.Pool, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if got := runtimeCfg.Providers[0].Routes[0].APIKey; got != "plain-secret-1234" {
		t.Fatalf("primary runtime API key = %q", got)
	}
	if got := runtimeCfg.Providers[0].Routes[1].APIKey; got != "backup-secret-5678" {
		t.Fatalf("backup runtime API key = %q", got)
	}
}

func TestOverlayPricesUsesAllPublicImageModels(t *testing.T) {
	cfg := testConfig()
	cfg.Models[1].DiscountPriceCents = int64Pointer(15)
	prices, ranges := OverlayTaskPrices(cfg, map[string]int64{"t2i": 9, "puzzle": 5})
	if prices["t2i"] != 30 || prices["puzzle"] != 5 {
		t.Fatalf("prices = %#v", prices)
	}
	if ranges["t2i"] != (PriceRange{MinCents: 15, MaxCents: 30}) {
		t.Fatalf("range = %#v", ranges["t2i"])
	}
}

func TestOverlayPricesUsesWorkspaceModels(t *testing.T) {
	cfg := testConfig()
	cfg.Workspaces = map[string]WorkspaceBinding{
		WorkspaceT2I:      {ModelIDs: []string{"image-fast"}},
		WorkspaceColoring: {ModelIDs: []string{"image-quality"}},
	}
	prices, ranges := OverlayTaskPrices(cfg, map[string]int64{})
	if prices["t2i"] != 20 || prices["coloring"] != 30 {
		t.Fatalf("workspace prices = %#v", prices)
	}
	if ranges["t2i"] != (PriceRange{MinCents: 20, MaxCents: 20}) {
		t.Fatalf("workspace range = %#v", ranges["t2i"])
	}
}

func TestEcommerceTaskUsesIndependentWorkspace(t *testing.T) {
	workspace, ok := WorkspaceForTaskType("ecommerce_design")
	if !ok || workspace != WorkspaceEcommerce {
		t.Fatalf("workspace = %q, ok = %v", workspace, ok)
	}
	if !ValidWorkspace(WorkspaceEcommerce) {
		t.Fatalf("ecommerce workspace must be a valid admin workspace")
	}
}
