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

func TestExecutionCandidatesOnlyReturnsEquivalentRoutes(t *testing.T) {
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
	if len(candidates) != 2 || candidates[0].Provider.ID != "provider" || candidates[1].Provider.ID != "backup" {
		t.Fatalf("execution candidates = %#v", candidates)
	}
}

func TestExecutionCandidatesCanFailOverFromDisabledRoute(t *testing.T) {
	cfg := testConfig()
	cfg.Providers[0].Enabled = false
	cfg.Providers = append(cfg.Providers, Provider{
		ID: "backup", Name: "备用", Adapter: AdapterOpenAI, APIKey: "backup-secret", Enabled: true, MaxConcurrency: 100,
	})
	cfg.Models = append(cfg.Models, Model{
		ID: "backup-image", Name: "备用高质量", ProviderID: "backup", UpstreamModel: "image-quality", Kind: ModelKindImage, Enabled: true,
	})
	candidates := ExecutionCandidates(cfg, "provider", "image-quality")
	if len(candidates) != 1 || candidates[0].Provider.ID != "backup" {
		t.Fatalf("disabled route failover candidates = %#v", candidates)
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
	if !model.TransparentBackground || model.MaxReferenceImages != 4 {
		t.Fatalf("legacy defaults = transparent %v, references %d", model.TransparentBackground, model.MaxReferenceImages)
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
	cfg.Providers[0].APIKey = "plain-secret-1234"
	cfg.Providers[0].DiscoveredModels = []string{" z-model ", "a-model", "z-model"}

	prepared, err := PrepareAdminSave(ctx, st.Pool, cfg, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	storedKey := prepared.Providers[0].APIKey
	if storedKey == "plain-secret-1234" || strings.Contains(storedKey, "plain-secret") {
		t.Fatalf("API key was not encrypted: %q", storedKey)
	}
	if err := Save(ctx, st.Pool, prepared); err != nil {
		t.Fatal(err)
	}
	adminView, err := AdminView(ctx, st.Pool, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if got := adminView.Providers[0].APIKey; got != "****1234" {
		t.Fatalf("masked API key = %q", got)
	}
	if got := adminView.Providers[0].DiscoveredModels; len(got) != 2 || got[0] != "a-model" || got[1] != "z-model" {
		t.Fatalf("discovered models = %#v", got)
	}
	preserved, err := PrepareAdminSave(ctx, st.Pool, adminView, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if preserved.Providers[0].APIKey != storedKey {
		t.Fatal("masked save replaced the stored API key")
	}
	runtimeCfg, err := Runtime(ctx, st.Pool, masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if runtimeCfg.Providers[0].APIKey != "plain-secret-1234" {
		t.Fatalf("runtime API key = %q", runtimeCfg.Providers[0].APIKey)
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
