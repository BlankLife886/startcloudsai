package modelconfig

import (
	"strings"
	"testing"
)

func tieredMatrix(base int64) map[string]map[string]ImageTierPrice {
	matrix := map[string]map[string]ImageTierPrice{}
	for r, resolution := range ImageResolutions {
		row := map[string]ImageTierPrice{}
		for q, quality := range DefaultImageQualities {
			price := base * int64(r+1) * int64(q+1)
			row[quality] = ImageTierPrice{PriceCents: price, UpstreamCostCents: price / 2}
		}
		matrix[resolution] = row
	}
	return matrix
}

func tieredConfig() Config {
	cfg := testConfig()
	for index := range cfg.Models {
		if cfg.Models[index].Kind == ModelKindImage {
			cfg.Models[index].Resolutions = []string{"1K", "2K", "4K"}
		}
	}
	cfg.Models[0].ImagePricing = tieredMatrix(10)
	return cfg
}

func TestImageBillingTierDefaultsAndExactSizes(t *testing.T) {
	cfg := tieredConfig()
	normalize(&cfg)
	model := cfg.Models[0]
	cases := []struct {
		params map[string]any
		want   ImageTier
	}{
		{map[string]any{}, ImageTier{"1K", "medium"}},
		{map[string]any{"quality": "auto", "resolution": "2k"}, ImageTier{"2K", "medium"}},
		{map[string]any{"quality": "hd", "resolutionScale": "4K"}, ImageTier{"4K", "high"}},
		{map[string]any{"quality": "standard"}, ImageTier{"1K", "medium"}},
		{map[string]any{"sizeMode": "exact", "exactWidth": 1536, "exactHeight": 1024, "quality": "low"}, ImageTier{"1K", "low"}},
		{map[string]any{"sizeMode": "exact", "exactWidth": 2048, "exactHeight": 2048}, ImageTier{"2K", "medium"}},
		{map[string]any{"sizeMode": "exact", "exactWidth": 3840, "exactHeight": 2160, "resolution": "1K"}, ImageTier{"4K", "medium"}},
	}
	for _, tc := range cases {
		if got := ImageBillingTier(model, tc.params); got != tc.want {
			t.Errorf("ImageBillingTier(%v) = %v, want %v", tc.params, got, tc.want)
		}
	}
	model.DefaultQuality = "low"
	if got := ImageBillingTier(model, map[string]any{"quality": "auto"}); got.Quality != "low" {
		t.Errorf("auto must bill the admin default quality, got %v", got)
	}
}

func TestResolveImageTierPriceUsesCellAndFallsBack(t *testing.T) {
	cfg := tieredConfig()
	normalize(&cfg)
	model := cfg.Models[0]
	discount := int64(50)
	model.ImagePricing["4K"]["high"] = ImageTierPrice{PriceCents: 90, DiscountPriceCents: &discount, UpstreamCostCents: 40}
	price := ResolveImageTierPrice(model, ImageTier{"4K", "high"})
	if price.PriceCents != 90 || price.EffectiveCents != 50 {
		t.Fatalf("4K high = %#v", price)
	}
	if cost := ImageTierUpstreamCost(model, ImageTier{"4K", "high"}); cost != 40 {
		t.Fatalf("4K high cost = %d", cost)
	}
	if got := ResolveImageTierPrice(model, ImageTier{"2K", "low"}).EffectiveCents; got != 20 {
		t.Fatalf("2K low = %d", got)
	}
	flat := cfg.Models[1]
	if got := ResolveImageTierPrice(flat, ImageTier{"4K", "high"}).EffectiveCents; got != 20 {
		t.Fatalf("flat model must keep its price, got %d", got)
	}
	if low, high := ImagePriceBounds(model); low != 10 || high != 60 {
		t.Fatalf("bounds = %d..%d", low, high)
	}
	for _, row := range PublicImagePricing(model) {
		for _, cell := range row {
			if cell.UpstreamCostCents != 0 {
				t.Fatal("public matrix must not expose upstream cost")
			}
		}
	}
}

func TestValidateImagePricing(t *testing.T) {
	if err := Validate(tieredConfig()); err != nil {
		t.Fatalf("complete matrix rejected: %v", err)
	}
	expectError := func(name, want string, mutate func(*Config)) {
		t.Helper()
		cfg := tieredConfig()
		mutate(&cfg)
		err := Validate(cfg)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: err = %v, want %q", name, err, want)
		}
	}
	expectError("missing cell", "缺少 4K · high", func(cfg *Config) { delete(cfg.Models[0].ImagePricing["4K"], "high") })
	expectError("unknown resolution", "未开放的分辨率", func(cfg *Config) { cfg.Models[0].Resolutions = []string{"1K", "2K"} })
	expectError("inverted", "低于上游成本", func(cfg *Config) {
		cfg.Models[0].ImagePricing["2K"]["low"] = ImageTierPrice{PriceCents: 5, UpstreamCostCents: 6}
	})
	expectError("zero", "用户价格为 0", func(cfg *Config) {
		cfg.Models[0].ImagePricing["1K"]["low"] = ImageTierPrice{}
	})
	expectError("discount above standard", "折扣价不能高于标准价", func(cfg *Config) {
		discount := int64(99)
		cfg.Models[0].ImagePricing["1K"]["low"] = ImageTierPrice{PriceCents: 10, DiscountPriceCents: &discount}
	})
	expectError("default quality", "默认质量", func(cfg *Config) { cfg.Models[0].DefaultQuality = "ultra" })
	expectError("workspace override", "不能再设页面单价", func(cfg *Config) {
		cfg.Workspaces = map[string]WorkspaceBinding{WorkspaceT2I: {
			ModelIDs:     []string{"image-quality"},
			ModelPricing: map[string]WorkspaceModelPricing{"image-quality": {PriceCents: 30}},
		}}
	})
}

func TestAssistantMayUseTieredModels(t *testing.T) {
	cfg := tieredConfig()
	cfg.Workspaces = map[string]WorkspaceBinding{WorkspaceAssistant: {ModelIDs: []string{"image-quality"}}}
	if err := Validate(cfg); err != nil {
		t.Fatalf("assistant tiered model rejected: %v", err)
	}
}

func TestOverlayPricesUsesMatrixBounds(t *testing.T) {
	cfg := tieredConfig()
	_, ranges := OverlayTaskPrices(cfg, map[string]int64{})
	if got := ranges["t2i"]; got.MinCents != 10 || got.MaxCents != 90 {
		t.Fatalf("t2i range = %#v", got)
	}
}

func slotConfig() Config {
	cfg := tieredConfig()
	cfg.Models = append(cfg.Models,
		Model{ID: "backup-a", Name: "备用A", ProviderID: "provider", UpstreamModel: "backup-a", Kind: ModelKindImage, PriceCents: 1, Enabled: true, Resolutions: []string{"1K", "2K", "4K"}},
		Model{ID: "backup-b", Name: "备用B", ProviderID: "provider", UpstreamModel: "backup-b", Kind: ModelKindImage, PriceCents: 1, Enabled: true, Resolutions: []string{"1K"}},
	)
	cfg.Models[0].ResolutionSlots = map[string]ResolutionSlot{
		"1k": {PrimaryModelID: "image-quality", BackupModelIDs: []string{"backup-a", "backup-b"}, AutoFailover: true},
		"4K": {PrimaryModelID: "backup-a"},
	}
	return cfg
}

func TestResolutionSlotsNormalizeAndValidate(t *testing.T) {
	cfg := slotConfig()
	if err := Validate(cfg); err != nil {
		t.Fatalf("valid slots rejected: %v", err)
	}
	normalize(&cfg)
	slot, ok := SlotFor(cfg.Models[0], "1K")
	if !ok || strings.Join(slot.Chain(), ",") != "image-quality,backup-a,backup-b" {
		t.Fatalf("1K slot = %#v", slot)
	}
	if _, ok := SlotFor(cfg.Models[0], "2K"); ok {
		t.Fatal("2K has no slot")
	}
	expectError := func(name, want string, mutate func(*Config)) {
		t.Helper()
		cfg := slotConfig()
		mutate(&cfg)
		err := Validate(cfg)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: err = %v, want %q", name, err, want)
		}
	}
	expectError("auto without backup", "至少需要一个备用模型", func(cfg *Config) {
		cfg.Models[0].ResolutionSlots["4K"] = ResolutionSlot{PrimaryModelID: "backup-a", AutoFailover: true}
	})
	expectError("no primary", "必须指定一个主模型", func(cfg *Config) {
		cfg.Models[0].ResolutionSlots["4K"] = ResolutionSlot{BackupModelIDs: []string{"backup-a"}}
	})
	expectError("missing member", "不存在", func(cfg *Config) {
		cfg.Models[0].ResolutionSlots["4K"] = ResolutionSlot{PrimaryModelID: "ghost"}
	})
	expectError("duplicate", "重复出现", func(cfg *Config) {
		cfg.Models[0].ResolutionSlots["4K"] = ResolutionSlot{PrimaryModelID: "backup-a", BackupModelIDs: []string{"backup-a"}}
	})
	expectError("unsupported resolution", "不支持 4K", func(cfg *Config) {
		cfg.Models[0].ResolutionSlots["4K"] = ResolutionSlot{PrimaryModelID: "backup-b"}
	})
	expectError("disabled member", "未启用", func(cfg *Config) { cfg.Models[3].Enabled = false })
	expectError("quality", "不支持质量 high", func(cfg *Config) { cfg.Models[3].Qualities = []string{"low", "medium"} })
	expectError("cost above price", "上游成本高于用户价格", func(cfg *Config) {
		cfg.Models[3].ImagePricing = tieredMatrix(10)
		cfg.Models[3].ImagePricing["4K"]["high"] = ImageTierPrice{PriceCents: 1, UpstreamCostCents: 999}
	})
	expectError("slot outside resolutions", "不在该模型开放的分辨率", func(cfg *Config) {
		cfg.Models[1].ResolutionSlots = map[string]ResolutionSlot{"8K": {PrimaryModelID: "backup-a"}}
	})
	expectError("nested", "不能嵌套", func(cfg *Config) {
		cfg.Models[3].ResolutionSlots = map[string]ResolutionSlot{"1K": {PrimaryModelID: "backup-b"}}
	})
	expectError("ratio", "不支持比例", func(cfg *Config) {
		cfg.Models[3].AspectRatios = []string{"1:1"}
		cfg.Models[3].AspectRatiosByResolution = nil
	})
	expectError("edit only", "只支持改图", func(cfg *Config) {
		cfg.Models[3].UpstreamRequiredInputFields = []string{"img_urls", "prompt"}
	})
}

func TestNewerQualitiesAreOptInAndAutoCanBeItsOwnTier(t *testing.T) {
	cfg := tieredConfig()
	normalize(&cfg)
	if got := strings.Join(cfg.Models[0].Qualities, ","); got != "low,medium,high" {
		t.Fatalf("legacy models default to low/medium/high, got %s", got)
	}
	cfg = tieredConfig()
	model := &cfg.Models[0]
	model.Qualities = []string{"low", "high", "xhigh", "max", "auto"}
	model.ImagePricing = map[string]map[string]ImageTierPrice{}
	for _, resolution := range model.Resolutions {
		model.ImagePricing[resolution] = map[string]ImageTierPrice{}
		for index, quality := range model.Qualities {
			model.ImagePricing[resolution][quality] = ImageTierPrice{PriceCents: int64(10 + index)}
		}
	}
	if err := Validate(cfg); err != nil {
		t.Fatalf("xhigh/max/auto tiers rejected: %v", err)
	}
	normalize(&cfg)
	model = &cfg.Models[0]
	if got := ImageBillingTier(*model, map[string]any{"quality": "auto"}); got.Quality != "auto" {
		t.Fatalf("an offered auto quality is its own tier, got %v", got)
	}
	if got := ResolveImageTierPrice(*model, ImageTier{"2K", "max"}).EffectiveCents; got != 13 {
		t.Fatalf("2K max = %d", got)
	}
	delete(cfg.Models[0].ImagePricing["1K"], "xhigh")
	if err := Validate(cfg); err == nil || !strings.Contains(err.Error(), "缺少 1K · xhigh") {
		t.Fatalf("a selected quality must be priced: %v", err)
	}
}

func TestSlotMemberCapabilities(t *testing.T) {
	owner := Model{Name: "主人", Qualities: []string{"high"}, MaxReferenceImages: 4, AspectRatios: []string{"1:1"}, Resolutions: []string{"2K"}}
	member := Model{Name: "成员", Qualities: []string{"high"}, MaxReferenceImages: 4, AspectRatios: []string{"1:1"}, Resolutions: []string{"2K"}}
	if err := validateSlotMemberCapabilities(owner, member, "2K", "成员"); err != nil {
		t.Fatalf("compatible member rejected: %v", err)
	}
	noQuality := member
	noQuality.Qualities = nil
	if err := validateSlotMemberCapabilities(owner, noQuality, "2K", "成员"); err == nil || !strings.Contains(err.Error(), "没有开放任何质量档") {
		t.Fatalf("member without qualities = %v", err)
	}
	fewerRefs := member
	fewerRefs.MaxReferenceImages = 1
	if err := validateSlotMemberCapabilities(owner, fewerRefs, "2K", "成员"); err == nil || !strings.Contains(err.Error(), "张参考图") {
		t.Fatalf("member with fewer references = %v", err)
	}
}
