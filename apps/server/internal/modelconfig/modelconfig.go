package modelconfig

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	SettingKey = "model_dispatch_config"
	Version    = 3

	AdapterOpenAI = "openai"
	AdapterCRUN   = "crun"

	ModelKindImage = "image"
	ModelKindChat  = "chat"

	WorkspaceAssistant  = "assistant"
	WorkspaceT2I        = "t2i"
	WorkspaceColoring   = "coloring"
	WorkspaceUIDesign   = "ui_design"
	WorkspaceModelSheet = "model_sheet"
	WorkspaceGameArt    = "game_art"
)

var WorkspaceKeys = []string{
	WorkspaceAssistant,
	WorkspaceT2I,
	WorkspaceColoring,
	WorkspaceUIDesign,
	WorkspaceModelSheet,
	WorkspaceGameArt,
}

var ImageTaskTypes = []string{
	"t2i", "coloring", "ui_design", "ui_design_asset", "model_sheet", "game_art",
}

var ImageAspectRatios = []string{
	"auto", "16:9", "9:16", "1:1", "3:2", "2:3", "5:4", "4:5", "4:3", "3:4", "21:9", "9:21",
}

var ImageQualities = []string{"low", "medium", "high"}
var ImageOutputFormats = []string{"png", "jpeg", "webp"}
var ImageModerationLevels = []string{"auto", "low"}

type Provider struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Adapter          string   `json:"adapter"`
	BaseURL          string   `json:"baseUrl"`
	APIKey           string   `json:"apiKey"`
	TimeoutSecs      int      `json:"timeoutSecs"`
	MaxConcurrency   int      `json:"maxConcurrency"`
	Enabled          bool     `json:"enabled"`
	DiscoveredModels []string `json:"discoveredModels"`
}

// UnmarshalJSON migrates the previous provider type + key-pool representation
// into the single-key adapter representation when the stored setting is read.
func (p *Provider) UnmarshalJSON(data []byte) error {
	var raw struct {
		ID               string   `json:"id"`
		Name             string   `json:"name"`
		Adapter          string   `json:"adapter"`
		Type             string   `json:"type"`
		BaseURL          string   `json:"baseUrl"`
		APIKey           string   `json:"apiKey"`
		TimeoutSecs      int      `json:"timeoutSecs"`
		MaxConcurrency   int      `json:"maxConcurrency"`
		Enabled          bool     `json:"enabled"`
		DiscoveredModels []string `json:"discoveredModels"`
		Keys             []struct {
			Secret  string `json:"secret"`
			Enabled bool   `json:"enabled"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	adapter := strings.TrimSpace(raw.Adapter)
	if adapter == "" {
		if raw.Type == "crun" {
			adapter = AdapterCRUN
		} else {
			adapter = AdapterOpenAI
		}
	}
	apiKey := raw.APIKey
	if apiKey == "" {
		for _, key := range raw.Keys {
			if key.Enabled && strings.TrimSpace(key.Secret) != "" {
				apiKey = key.Secret
				break
			}
		}
	}
	*p = Provider{
		ID: raw.ID, Name: raw.Name, Adapter: adapter, BaseURL: raw.BaseURL,
		APIKey: apiKey, TimeoutSecs: raw.TimeoutSecs, MaxConcurrency: raw.MaxConcurrency, Enabled: raw.Enabled,
		DiscoveredModels: raw.DiscoveredModels,
	}
	return nil
}

type Model struct {
	ID                          string              `json:"id"`
	Name                        string              `json:"name"`
	ProviderID                  string              `json:"providerId"`
	UpstreamModel               string              `json:"upstreamModel"`
	Kind                        string              `json:"kind"`
	Description                 string              `json:"description,omitempty"`
	PriceCents                  int64               `json:"priceCents"`
	DiscountPriceCents          *int64              `json:"discountPriceCents"`
	FastMode                    bool                `json:"fastMode"`
	MinSeconds                  int                 `json:"minSeconds"`
	MaxSeconds                  int                 `json:"maxSeconds"`
	Resolutions                 []string            `json:"resolutions"`
	AspectRatios                []string            `json:"aspectRatios"`
	AspectRatiosByResolution    map[string][]string `json:"aspectRatiosByResolution"`
	Qualities                   []string            `json:"qualities"`
	TransparentBackground       bool                `json:"transparentBackground"`
	OutputFormats               []string            `json:"outputFormats"`
	ModerationLevels            []string            `json:"moderationLevels"`
	MaxReferenceImages          int                 `json:"maxReferenceImages"`
	Public                      bool                `json:"public"`
	Default                     bool                `json:"default"`
	Enabled                     bool                `json:"enabled"`
	transparentBackgroundSet    bool
	maxReferenceImagesSet       bool
	aspectRatiosByResolutionSet bool
	legacyAutoAspectRatios      map[string][]string
}

func (m *Model) UnmarshalJSON(data []byte) error {
	type alias Model
	var raw struct {
		alias
		Public                   *bool                      `json:"public"`
		TransparentBackground    *bool                      `json:"transparentBackground"`
		MaxReferenceImages       *int                       `json:"maxReferenceImages"`
		AspectRatiosByResolution map[string]json.RawMessage `json:"aspectRatiosByResolution"`
		AutoAspectRatios         map[string]json.RawMessage `json:"autoAspectRatios"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*m = Model(raw.alias)
	decodeRatioMap := func(source map[string]json.RawMessage) (map[string][]string, error) {
		result := make(map[string][]string, len(source))
		for resolution, encoded := range source {
			var values []string
			if err := json.Unmarshal(encoded, &values); err != nil {
				var legacy string
				if legacyErr := json.Unmarshal(encoded, &legacy); legacyErr != nil {
					return nil, err
				}
				values = []string{legacy}
			}
			result[resolution] = values
		}
		return result, nil
	}
	var err error
	m.AspectRatiosByResolution, err = decodeRatioMap(raw.AspectRatiosByResolution)
	if err != nil {
		return err
	}
	m.aspectRatiosByResolutionSet = raw.AspectRatiosByResolution != nil
	m.legacyAutoAspectRatios, err = decodeRatioMap(raw.AutoAspectRatios)
	if err != nil {
		return err
	}
	if m.Kind == "" {
		m.Kind = ModelKindImage
	}
	if raw.Public == nil {
		m.Public = true
	} else {
		m.Public = *raw.Public
	}
	if raw.TransparentBackground == nil {
		m.TransparentBackground = m.Kind == ModelKindImage
	} else {
		m.TransparentBackground = *raw.TransparentBackground
		m.transparentBackgroundSet = true
	}
	if raw.MaxReferenceImages == nil && m.Kind == ModelKindImage {
		m.MaxReferenceImages = 4
	} else if raw.MaxReferenceImages != nil {
		m.MaxReferenceImages = *raw.MaxReferenceImages
		m.maxReferenceImagesSet = true
	}
	return nil
}

type Config struct {
	Version    int                         `json:"version"`
	Providers  []Provider                  `json:"providers"`
	Models     []Model                     `json:"models"`
	Workspaces map[string]WorkspaceBinding `json:"workspaces"`
}

type WorkspaceBinding struct {
	ModelIDs        []string          `json:"modelIds"`
	DefaultModelIDs map[string]string `json:"defaultModelIds"`
}

type Selection struct {
	Provider Provider
	Model    Model
}

type PriceRange struct {
	MinCents int64 `json:"minCents"`
	MaxCents int64 `json:"maxCents"`
}

func Empty() Config {
	return Config{
		Version: Version, Providers: []Provider{}, Models: []Model{},
		Workspaces: map[string]WorkspaceBinding{},
	}
}

func Load(ctx context.Context, q store.Q) (Config, error) {
	raw, err := store.GetAppSetting(ctx, q, SettingKey)
	if err != nil {
		return Config{}, err
	}
	if len(raw) == 0 {
		return Empty(), nil
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, err
	}
	normalize(&cfg)
	return cfg, nil
}

func Save(ctx context.Context, q store.Q, cfg Config) error {
	normalize(&cfg)
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return store.SetAppSetting(ctx, q, SettingKey, raw, time.Now().UTC())
}

func normalize(cfg *Config) {
	cfg.Version = Version
	if cfg.Providers == nil {
		cfg.Providers = []Provider{}
	}
	if cfg.Models == nil {
		cfg.Models = []Model{}
	}
	if cfg.Workspaces == nil {
		cfg.Workspaces = map[string]WorkspaceBinding{}
	}
	for index := range cfg.Providers {
		provider := &cfg.Providers[index]
		provider.ID = strings.TrimSpace(provider.ID)
		provider.Name = strings.TrimSpace(provider.Name)
		provider.Adapter = strings.TrimSpace(provider.Adapter)
		provider.BaseURL = strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
		if provider.Adapter == AdapterCRUN {
			provider.BaseURL = strings.TrimSuffix(provider.BaseURL, "/api/v1")
		}
		provider.DiscoveredModels = cleanStrings(provider.DiscoveredModels)
		if provider.MaxConcurrency <= 0 {
			provider.MaxConcurrency = 100
		}
	}
	defaultKinds := map[string]bool{}
	for index := range cfg.Models {
		model := &cfg.Models[index]
		model.ID = strings.TrimSpace(model.ID)
		model.Name = strings.TrimSpace(model.Name)
		model.ProviderID = strings.TrimSpace(model.ProviderID)
		model.UpstreamModel = strings.TrimSpace(model.UpstreamModel)
		model.Kind = strings.TrimSpace(model.Kind)
		if model.Kind == "" {
			model.Kind = ModelKindImage
		}
		model.Description = strings.TrimSpace(model.Description)
		model.Resolutions = cleanStrings(model.Resolutions)
		if model.Kind == ModelKindImage {
			if !model.transparentBackgroundSet {
				model.TransparentBackground = true
			}
			if !model.maxReferenceImagesSet {
				model.MaxReferenceImages = 4
			}
			if model.AspectRatios == nil {
				model.AspectRatios = append([]string(nil), ImageAspectRatios...)
			}
			if model.Qualities == nil {
				model.Qualities = append([]string(nil), ImageQualities...)
			}
			if model.OutputFormats == nil {
				model.OutputFormats = append([]string(nil), ImageOutputFormats...)
			}
			if model.ModerationLevels == nil {
				model.ModerationLevels = append([]string(nil), ImageModerationLevels...)
			}
			model.AspectRatios = cleanEnum(model.AspectRatios, ImageAspectRatios)
			model.AspectRatiosByResolution = normalizeAspectRatiosByResolution(*model)
			if union := aspectRatioUnion(model.AspectRatiosByResolution); len(union) > 0 {
				model.AspectRatios = union
			}
			model.Qualities = cleanEnum(model.Qualities, ImageQualities)
			model.OutputFormats = cleanEnum(model.OutputFormats, ImageOutputFormats)
			model.ModerationLevels = cleanEnum(model.ModerationLevels, ImageModerationLevels)
		}
		if model.Default {
			switch {
			case !model.Enabled || !model.Public:
				model.Default = false
			case defaultKinds[model.Kind]:
				model.Default = false
			default:
				defaultKinds[model.Kind] = true
			}
		}
	}
	for _, kind := range []string{ModelKindImage, ModelKindChat} {
		if defaultKinds[kind] {
			continue
		}
		for index := range cfg.Models {
			model := &cfg.Models[index]
			if model.Kind == kind && model.Enabled && model.Public {
				model.Default = true
				defaultKinds[kind] = true
				break
			}
		}
	}
	normalizedWorkspaces := make(map[string]WorkspaceBinding, len(cfg.Workspaces))
	for key, binding := range cfg.Workspaces {
		binding.ModelIDs = cleanStrings(binding.ModelIDs)
		defaultModelIDs := make(map[string]string, len(binding.DefaultModelIDs))
		for kind, modelID := range binding.DefaultModelIDs {
			kind = strings.TrimSpace(kind)
			modelID = strings.TrimSpace(modelID)
			if kind != "" && modelID != "" {
				defaultModelIDs[kind] = modelID
			}
		}
		binding.DefaultModelIDs = defaultModelIDs
		normalizedWorkspaces[strings.TrimSpace(key)] = binding
	}
	cfg.Workspaces = normalizedWorkspaces
}

func cleanEnum(values, allowed []string) []string {
	selected := make(map[string]bool, len(values))
	for _, value := range values {
		selected[strings.ToLower(strings.TrimSpace(value))] = true
	}
	out := make([]string, 0, len(values))
	for _, value := range allowed {
		if selected[value] {
			out = append(out, value)
		}
	}
	return out
}

func cleanStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func containsFold(values []string, requested string) bool {
	for _, value := range values {
		if strings.EqualFold(value, requested) {
			return true
		}
	}
	return false
}

func firstConcreteAspectRatio(model Model) string {
	for _, ratio := range model.AspectRatios {
		ratio = strings.ToLower(strings.TrimSpace(ratio))
		if ratio != "" && ratio != "auto" {
			return ratio
		}
	}
	return "1:1"
}

func normalizeAspectRatiosByResolution(model Model) map[string][]string {
	provided := make(map[string][]string, len(model.AspectRatiosByResolution))
	for resolution, ratios := range model.AspectRatiosByResolution {
		provided[strings.ToUpper(strings.TrimSpace(resolution))] = ratios
	}
	legacy := make(map[string][]string, len(model.legacyAutoAspectRatios))
	for resolution, ratios := range model.legacyAutoAspectRatios {
		legacy[strings.ToUpper(strings.TrimSpace(resolution))] = ratios
	}
	fallback := cleanEnum(model.AspectRatios, ImageAspectRatios)
	if len(fallback) == 0 {
		fallback = append([]string(nil), ImageAspectRatios...)
	}
	result := make(map[string][]string, len(model.Resolutions))
	for _, resolution := range model.Resolutions {
		key := strings.ToUpper(strings.TrimSpace(resolution))
		source := provided[key]
		if !model.aspectRatiosByResolutionSet && len(provided) == 0 {
			if legacyRatios, ok := legacy[key]; ok {
				source = append([]string(nil), legacyRatios...)
				if containsFold(model.AspectRatios, "auto") {
					source = append([]string{"auto"}, source...)
				}
			} else {
				source = fallback
			}
		}
		ratios := cleanEnum(source, ImageAspectRatios)
		if len(ratios) == 0 {
			ratios = append([]string(nil), fallback...)
		}
		result[key] = ratios
	}
	return result
}

func aspectRatioUnion(rules map[string][]string) []string {
	selected := make(map[string]bool)
	for _, ratios := range rules {
		for _, ratio := range ratios {
			selected[strings.ToLower(strings.TrimSpace(ratio))] = true
		}
	}
	result := make([]string, 0, len(selected))
	for _, ratio := range ImageAspectRatios {
		if selected[ratio] {
			result = append(result, ratio)
		}
	}
	return result
}

// AspectRatiosForResolution returns the user-selectable ratios for a resolution.
func AspectRatiosForResolution(model Model, resolution string) []string {
	rules := normalizeAspectRatiosByResolution(model)
	if ratios := rules[strings.ToUpper(strings.TrimSpace(resolution))]; len(ratios) > 0 {
		return append([]string(nil), ratios...)
	}
	return append([]string(nil), model.AspectRatios...)
}

// AutoAspectRatioCandidates returns concrete output boundaries for Auto.
func AutoAspectRatioCandidates(model Model, resolution string) []string {
	ratios := AspectRatiosForResolution(model, resolution)
	result := make([]string, 0, len(ratios))
	for _, ratio := range ratios {
		if ratio != "auto" {
			result = append(result, ratio)
		}
	}
	if len(result) > 0 {
		return result
	}
	return []string{firstConcreteAspectRatio(model)}
}

func ValidAdapter(value string) bool {
	return value == AdapterOpenAI || value == AdapterCRUN
}

func ValidModelKind(value string) bool {
	return value == ModelKindImage || value == ModelKindChat
}

func ValidWorkspace(value string) bool {
	for _, key := range WorkspaceKeys {
		if value == key {
			return true
		}
	}
	return false
}

func workspaceAllowsKind(workspace, kind string) bool {
	return kind == ModelKindImage || (workspace == WorkspaceAssistant && kind == ModelKindChat)
}

func Validate(cfg Config) error {
	normalize(&cfg)
	providers := make(map[string]Provider, len(cfg.Providers))
	for _, provider := range cfg.Providers {
		if provider.ID == "" || provider.Name == "" || !ValidAdapter(provider.Adapter) {
			return errors.New("服务商 ID、名称或协议无效")
		}
		if _, exists := providers[provider.ID]; exists {
			return fmt.Errorf("服务商 ID 重复：%s", provider.ID)
		}
		if provider.BaseURL == "" {
			return fmt.Errorf("服务商 %s 缺少 Base URL", provider.Name)
		}
		if provider.Enabled && strings.TrimSpace(provider.APIKey) == "" {
			return fmt.Errorf("服务商 %s 缺少 API Key", provider.Name)
		}
		if provider.TimeoutSecs < 0 || provider.TimeoutSecs > 1800 {
			return fmt.Errorf("服务商 %s 的超时须在 0-1800 秒之间", provider.Name)
		}
		if provider.MaxConcurrency < 1 || provider.MaxConcurrency > 10000 {
			return fmt.Errorf("服务商 %s 的并发容量须在 1-10000 之间", provider.Name)
		}
		providers[provider.ID] = provider
	}
	models := make(map[string]Model, len(cfg.Models))
	defaults := map[string]bool{}
	for _, model := range cfg.Models {
		if model.ID == "" || model.Name == "" || model.UpstreamModel == "" || !ValidModelKind(model.Kind) {
			return errors.New("模型 ID、名称、类型和上游模型不能为空")
		}
		if _, exists := models[model.ID]; exists {
			return fmt.Errorf("模型 ID 重复：%s", model.ID)
		}
		if _, exists := providers[model.ProviderID]; !exists {
			return fmt.Errorf("模型 %s 没有关联有效服务商", model.Name)
		}
		if model.PriceCents < 0 || (model.DiscountPriceCents != nil && *model.DiscountPriceCents < 0) {
			return fmt.Errorf("模型 %s 的价格不能为负", model.Name)
		}
		if model.DiscountPriceCents != nil && *model.DiscountPriceCents > model.PriceCents {
			return fmt.Errorf("模型 %s 的折扣价不能高于标准价", model.Name)
		}
		if model.MinSeconds < 0 || model.MaxSeconds < model.MinSeconds || model.MaxSeconds > 3600 {
			return fmt.Errorf("模型 %s 的预计耗时无效", model.Name)
		}
		if model.Default {
			if !model.Enabled || !model.Public {
				return fmt.Errorf("默认模型 %s 必须启用并对用户开放", model.Name)
			}
			if defaults[model.Kind] {
				return fmt.Errorf("%s 类型只能设置一个默认模型", model.Kind)
			}
			defaults[model.Kind] = true
		}
		for _, resolution := range model.Resolutions {
			if resolution != "1K" && resolution != "2K" && resolution != "4K" {
				return fmt.Errorf("模型 %s 包含无效分辨率", model.Name)
			}
		}
		if model.Kind == ModelKindImage {
			if len(model.AspectRatios) == 0 {
				return fmt.Errorf("模型 %s 至少需要一个宽高比", model.Name)
			}
			for _, resolution := range model.Resolutions {
				ratios := model.AspectRatiosByResolution[strings.ToUpper(resolution)]
				if len(ratios) == 0 {
					return fmt.Errorf("模型 %s 的 %s 比例控制不能为空", model.Name, resolution)
				}
				if containsFold(ratios, "auto") {
					hasConcrete := false
					for _, ratio := range ratios {
						if ratio != "auto" {
							hasConcrete = true
							break
						}
					}
					if !hasConcrete {
						return fmt.Errorf("模型 %s 的 %s 选择 Auto 时至少需要一个固定比例", model.Name, resolution)
					}
				}
			}
			if len(model.Qualities) == 0 {
				return fmt.Errorf("模型 %s 至少需要一个输出质量", model.Name)
			}
			if model.MaxReferenceImages < 0 || model.MaxReferenceImages > 16 {
				return fmt.Errorf("模型 %s 的参考图数量须在 0-16 之间", model.Name)
			}
		}
		models[model.ID] = model
	}
	for workspace, binding := range cfg.Workspaces {
		if !ValidWorkspace(workspace) {
			return fmt.Errorf("页面模型分配包含未知页面：%s", workspace)
		}
		assigned := make(map[string]bool, len(binding.ModelIDs))
		for _, modelID := range binding.ModelIDs {
			model, exists := models[modelID]
			if !exists {
				return fmt.Errorf("页面 %s 分配了不存在的模型：%s", workspace, modelID)
			}
			if !workspaceAllowsKind(workspace, model.Kind) {
				return fmt.Errorf("页面 %s 不支持 %s 类型模型", workspace, model.Kind)
			}
			if !model.Enabled || !model.Public {
				return fmt.Errorf("页面 %s 分配的模型 %s 必须启用并对用户开放", workspace, model.Name)
			}
			assigned[modelID] = true
		}
		for kind, modelID := range binding.DefaultModelIDs {
			if !ValidModelKind(kind) || !workspaceAllowsKind(workspace, kind) {
				return fmt.Errorf("页面 %s 的默认模型类型无效：%s", workspace, kind)
			}
			model, exists := models[modelID]
			if !exists || !assigned[modelID] || model.Kind != kind {
				return fmt.Errorf("页面 %s 的默认模型必须包含在该页面的可选模型中", workspace)
			}
		}
	}
	return nil
}

func maskSecret(secret string) string {
	if secret == "" {
		return ""
	}
	runes := []rune(secret)
	if len(runes) <= 4 {
		return "****"
	}
	return "****" + string(runes[len(runes)-4:])
}

func AdminView(ctx context.Context, q store.Q, masterKey string) (Config, error) {
	cfg, err := Load(ctx, q)
	if err != nil {
		return Config{}, err
	}
	for index := range cfg.Providers {
		stored := cfg.Providers[index].APIKey
		if stored == "" {
			continue
		}
		plain, err := settings.DecryptSecret(stored, masterKey)
		if err != nil {
			return Config{}, err
		}
		cfg.Providers[index].APIKey = maskSecret(plain)
	}
	return cfg, nil
}

func PrepareAdminSave(ctx context.Context, q store.Q, input Config, masterKey string) (Config, error) {
	existing, err := Load(ctx, q)
	if err != nil {
		return Config{}, err
	}
	existingKeys := make(map[string]string, len(existing.Providers))
	for _, provider := range existing.Providers {
		existingKeys[provider.ID] = provider.APIKey
	}
	for index := range input.Providers {
		provider := &input.Providers[index]
		secret := strings.TrimSpace(provider.APIKey)
		if secret == "" || strings.HasPrefix(secret, "****") {
			if stored := existingKeys[provider.ID]; stored != "" {
				provider.APIKey = stored
				continue
			}
			provider.APIKey = ""
			continue
		}
		encrypted, err := settings.EncryptSecret(secret, masterKey)
		if err != nil {
			return Config{}, err
		}
		provider.APIKey = encrypted
	}
	if err := Validate(input); err != nil {
		return Config{}, err
	}
	normalize(&input)
	return input, nil
}

func Runtime(ctx context.Context, q store.Q, masterKey string) (Config, error) {
	cfg, err := Load(ctx, q)
	if err != nil {
		return Config{}, err
	}
	for index := range cfg.Providers {
		stored := cfg.Providers[index].APIKey
		if stored == "" {
			continue
		}
		plain, err := settings.DecryptSecret(stored, masterKey)
		if err != nil {
			return Config{}, err
		}
		cfg.Providers[index].APIKey = plain
	}
	return cfg, nil
}

func EffectivePrice(model Model) int64 {
	if model.DiscountPriceCents != nil {
		return *model.DiscountPriceCents
	}
	return model.PriceCents
}

func activeProviders(cfg Config) map[string]Provider {
	providers := make(map[string]Provider, len(cfg.Providers))
	for _, provider := range cfg.Providers {
		if provider.Enabled {
			providers[provider.ID] = provider
		}
	}
	return providers
}

func SelectPublic(cfg Config, kind, requestedModelID string) (*Selection, bool) {
	normalize(&cfg)
	providers := activeProviders(cfg)
	requestedModelID = strings.TrimSpace(requestedModelID)
	if requestedModelID == "standard" {
		requestedModelID = ""
	}
	var fallback *Selection
	for _, model := range cfg.Models {
		provider, providerOK := providers[model.ProviderID]
		if !providerOK || !model.Enabled || !model.Public || model.Kind != kind {
			continue
		}
		selection := &Selection{Provider: provider, Model: model}
		if requestedModelID != "" && model.ID == requestedModelID {
			return selection, true
		}
		if fallback == nil || model.Default {
			copy := selection
			fallback = copy
			if model.Default && requestedModelID == "" {
				return fallback, true
			}
		}
	}
	if requestedModelID != "" {
		return nil, false
	}
	return fallback, fallback != nil
}

// PublicModelsForWorkspace returns only the models explicitly assigned to a
// page. A missing binding keeps Version 2 behavior; a present empty binding
// intentionally disables models for that page.
func PublicModelsForWorkspace(cfg Config, workspace, kind string) []Selection {
	normalize(&cfg)
	binding, configured := cfg.Workspaces[workspace]
	if workspace == "" || !configured {
		return PublicModels(cfg, kind)
	}
	allowed := make(map[string]bool, len(binding.ModelIDs))
	for _, modelID := range binding.ModelIDs {
		allowed[modelID] = true
	}
	models := PublicModels(cfg, kind)
	out := make([]Selection, 0, len(models))
	for _, selection := range models {
		if allowed[selection.Model.ID] {
			out = append(out, selection)
		}
	}
	defaultID := binding.DefaultModelIDs[kind]
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Model.ID == defaultID {
			return true
		}
		if out[j].Model.ID == defaultID {
			return false
		}
		if out[i].Model.Default != out[j].Model.Default {
			return out[i].Model.Default
		}
		return out[i].Model.Name < out[j].Model.Name
	})
	return out
}

func SelectPublicForWorkspace(cfg Config, workspace, kind, requestedModelID string) (*Selection, bool) {
	normalize(&cfg)
	requestedModelID = strings.TrimSpace(requestedModelID)
	if requestedModelID == "standard" {
		requestedModelID = ""
	}
	models := PublicModelsForWorkspace(cfg, workspace, kind)
	if requestedModelID != "" {
		for index := range models {
			if models[index].Model.ID == requestedModelID {
				return &models[index], true
			}
		}
		return nil, false
	}
	if binding, configured := cfg.Workspaces[workspace]; configured {
		if defaultID := strings.TrimSpace(binding.DefaultModelIDs[kind]); defaultID != "" {
			for index := range models {
				if models[index].Model.ID == defaultID {
					return &models[index], true
				}
			}
		}
	}
	if len(models) == 0 {
		return nil, false
	}
	return &models[0], true
}

func HasWorkspaceBinding(cfg Config, workspace string) bool {
	_, configured := cfg.Workspaces[workspace]
	return configured
}

func WorkspaceForTaskType(taskType string) (string, bool) {
	switch strings.TrimSpace(taskType) {
	case "t2i":
		return WorkspaceT2I, true
	case "coloring":
		return WorkspaceColoring, true
	case "ui_design", "ui_design_asset":
		return WorkspaceUIDesign, true
	case "model_sheet":
		return WorkspaceModelSheet, true
	case "game_art":
		return WorkspaceGameArt, true
	case "assistant_image":
		return WorkspaceAssistant, true
	default:
		return "", false
	}
}

func HasPublicKind(cfg Config, kind string) bool {
	_, found := SelectPublic(cfg, kind, "")
	return found
}

func FindExecution(cfg Config, providerID, modelID string) (*Selection, bool) {
	providers := activeProviders(cfg)
	provider, providerOK := providers[providerID]
	if !providerOK || strings.TrimSpace(provider.APIKey) == "" {
		return nil, false
	}
	for _, model := range cfg.Models {
		if model.ID == modelID && model.ProviderID == providerID && model.Enabled {
			return &Selection{Provider: provider, Model: model}, true
		}
	}
	return nil, false
}

// ExecutionCandidates returns interchangeable execution routes for a selected
// public model. Providers join the same pool by configuring an enabled model
// with the same adapter, kind and upstream model ID.
func ExecutionCandidates(cfg Config, providerID, modelID string) []Selection {
	normalize(&cfg)
	providers := activeProviders(cfg)
	var selected Model
	found := false
	for _, model := range cfg.Models {
		if model.ID == modelID && model.ProviderID == providerID {
			selected, found = model, true
			break
		}
	}
	if !found {
		return nil
	}
	var selectedProvider Provider
	for _, provider := range cfg.Providers {
		if provider.ID == selected.ProviderID {
			selectedProvider = provider
			break
		}
	}
	if selectedProvider.ID == "" {
		return nil
	}
	out := make([]Selection, 0, len(providers))
	seenProviders := map[string]bool{}
	for _, model := range cfg.Models {
		provider, providerOK := providers[model.ProviderID]
		if !providerOK || seenProviders[provider.ID] || strings.TrimSpace(provider.APIKey) == "" ||
			!model.Enabled || model.Kind != selected.Kind || model.UpstreamModel != selected.UpstreamModel ||
			provider.Adapter != selectedProvider.Adapter {
			continue
		}
		seenProviders[provider.ID] = true
		out = append(out, Selection{Provider: provider, Model: model})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Provider.ID == providerID {
			return true
		}
		if out[j].Provider.ID == providerID {
			return false
		}
		return out[i].Provider.ID < out[j].Provider.ID
	})
	return out
}

func PublicModels(cfg Config, kind string) []Selection {
	providers := activeProviders(cfg)
	out := make([]Selection, 0, len(cfg.Models))
	for _, model := range cfg.Models {
		provider, ok := providers[model.ProviderID]
		if !ok || !model.Enabled || !model.Public || (kind != "" && model.Kind != kind) {
			continue
		}
		out = append(out, Selection{Provider: provider, Model: model})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Model.Default != out[j].Model.Default {
			return out[i].Model.Default
		}
		return out[i].Model.Name < out[j].Model.Name
	})
	return out
}

func OverlayTaskPrices(cfg Config, legacy map[string]int64) (map[string]int64, map[string]PriceRange) {
	prices := make(map[string]int64, len(legacy))
	for key, price := range legacy {
		prices[key] = price
	}
	ranges := make(map[string]PriceRange, len(ImageTaskTypes))
	for _, taskType := range ImageTaskTypes {
		workspace, _ := WorkspaceForTaskType(taskType)
		models := PublicModelsForWorkspace(cfg, workspace, ModelKindImage)
		if len(models) == 0 {
			continue
		}
		rangeValue := PriceRange{MinCents: EffectivePrice(models[0].Model), MaxCents: EffectivePrice(models[0].Model)}
		for _, selection := range models[1:] {
			price := EffectivePrice(selection.Model)
			if price < rangeValue.MinCents {
				rangeValue.MinCents = price
			}
			if price > rangeValue.MaxCents {
				rangeValue.MaxCents = price
			}
		}
		prices[taskType] = rangeValue.MaxCents
		ranges[taskType] = rangeValue
	}
	return prices, ranges
}
