package modelconfig

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// ImageParamProfileSettingKey stores the admin-edited image parameter
// profiles. When it is unset the built-in profiles below are served.
const ImageParamProfileSettingKey = "model_image_param_profiles"

// Size modes of an image parameter profile.
const (
	ImageSizeModeSize       = "size"         // size=WxH, as sent by the platform
	ImageSizeModeAspect     = "aspect_ratio" // aspect field only
	ImageSizeModeAspectTier = "aspect_tier"  // aspect field + resolution tier field
	ImageSizeModeNone       = "none"         // no size at all
)

// Quality modes of an image parameter profile.
const (
	ImageQualitySend = "send" // pass the platform value (low/medium/high/xhigh/max/auto)
	ImageQualityMap  = "map"  // translate through QualityMap; unmapped values are dropped
	ImageQualityDrop = "drop" // never send quality
)

// Platform image fields a profile may decline to send (besides size and quality).
var ImageParamDroppable = []string{"background", "output_format", "output_compression", "moderation", "style", "input_fidelity", "user"}

var imageSizeModes = []string{ImageSizeModeSize, ImageSizeModeAspect, ImageSizeModeAspectTier, ImageSizeModeNone}
var imageQualityModes = []string{ImageQualitySend, ImageQualityMap, ImageQualityDrop}
var imageTiers = []string{"1K", "2K", "4K"}
var aspectRatioPattern = regexp.MustCompile(`^\d+(\.\d+)?:\d+(\.\d+)?$`)
var presetIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// ImageParamRules says how the platform's unified image options become the
// fields one upstream family expects (OpenAI, Grok, Gemini, …).
type ImageParamRules struct {
	SizeMode string `json:"sizeMode"`
	// AspectField names the ratio field (default aspect_ratio).
	AspectField string `json:"aspectField,omitempty"`
	// AspectRatios are the values the upstream accepts; the requested size
	// snaps to the closest one. Empty sends the exact reduced ratio.
	AspectRatios []string `json:"aspectRatios,omitempty"`
	// TierField names the resolution field for aspect_tier (e.g. resolution).
	TierField string `json:"tierField,omitempty"`
	// TierValues maps the platform tier (1K/2K/4K) to the upstream value; a
	// tier missing here falls back to the highest mapped tier below it.
	TierValues  map[string]string `json:"tierValues,omitempty"`
	QualityMode string            `json:"qualityMode"`
	QualityMap  map[string]string `json:"qualityMap,omitempty"`
	// Drop lists platform fields this upstream does not take.
	Drop []string `json:"drop,omitempty"`
}

// ImageParamCapabilities are suggested model options filled in when a model
// picks the profile; the admin can still change them on the model.
type ImageParamCapabilities struct {
	Resolutions        []string `json:"resolutions,omitempty"`
	AspectRatios       []string `json:"aspectRatios,omitempty"`
	Qualities          []string `json:"qualities,omitempty"`
	MaxReferenceImages *int     `json:"maxReferenceImages,omitempty"`
}

// ImageParamProfile is a named, admin-editable parameter dialect.
type ImageParamProfile struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Description  string                 `json:"description,omitempty"`
	Rules        ImageParamRules        `json:"rules"`
	Capabilities ImageParamCapabilities `json:"capabilities"`
}

//go:embed image_param_profiles_default.json
var defaultImageParamProfilesJSON []byte

// DefaultImageParamProfiles returns the built-in profiles.
func DefaultImageParamProfiles() []ImageParamProfile {
	var profiles []ImageParamProfile
	if err := json.Unmarshal(defaultImageParamProfilesJSON, &profiles); err != nil {
		panic("modelconfig: invalid image_param_profiles_default.json: " + err.Error())
	}
	return NormalizeImageParamProfiles(profiles)
}

// LoadImageParamProfiles returns the stored profiles, or the built-in ones.
func LoadImageParamProfiles(ctx context.Context, q store.Q) ([]ImageParamProfile, bool, error) {
	raw, err := store.GetAppSetting(ctx, q, ImageParamProfileSettingKey)
	if err != nil {
		return nil, false, err
	}
	if len(raw) == 0 {
		return DefaultImageParamProfiles(), false, nil
	}
	var profiles []ImageParamProfile
	if err := json.Unmarshal(raw, &profiles); err != nil {
		return nil, false, err
	}
	return NormalizeImageParamProfiles(profiles), true, nil
}

// SaveImageParamProfiles validates and stores the profile list, then
// refreshes the copies held by models that use them. A profile still used by
// a model cannot be removed.
func SaveImageParamProfiles(ctx context.Context, q store.Q, profiles []ImageParamProfile) ([]ImageParamProfile, error) {
	profiles = NormalizeImageParamProfiles(profiles)
	if err := ValidateImageParamProfiles(profiles); err != nil {
		return nil, err
	}
	if err := resyncModelImageParams(ctx, q, profiles); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(profiles)
	if err != nil {
		return nil, err
	}
	if err := store.SetAppSetting(ctx, q, ImageParamProfileSettingKey, raw, time.Now().UTC()); err != nil {
		return nil, err
	}
	return profiles, nil
}

// ResetImageParamProfiles restores the built-in profiles.
func ResetImageParamProfiles(ctx context.Context, q store.Q) error {
	if err := resyncModelImageParams(ctx, q, DefaultImageParamProfiles()); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `DELETE FROM app_settings WHERE key = $1`, ImageParamProfileSettingKey)
	return err
}

// resyncModelImageParams rewrites the stored model configuration so every
// model's copy of its profile rules matches profiles.
func resyncModelImageParams(ctx context.Context, q store.Q, profiles []ImageParamProfile) error {
	cfg, err := Load(ctx, q)
	if err != nil {
		return err
	}
	changed, err := embedImageParamRules(&cfg, profiles)
	if err != nil || !changed {
		return err
	}
	return Save(ctx, q, cfg)
}

// EmbedImageParamRules copies each referenced profile's rules onto the model,
// so task snapshots and every process carry the full rules.
func EmbedImageParamRules(ctx context.Context, q store.Q, cfg *Config) error {
	profiles, _, err := LoadImageParamProfiles(ctx, q)
	if err != nil {
		return err
	}
	_, err = embedImageParamRules(cfg, profiles)
	return err
}

// ResolveCompatImageParams fills compat's rules from its profile ID (for
// unsaved model drafts, e.g. model tests).
func ResolveCompatImageParams(ctx context.Context, q store.Q, compat *RequestCompat) error {
	if compat == nil || compat.ImageParams == "" {
		return nil
	}
	profiles, _, err := LoadImageParamProfiles(ctx, q)
	if err != nil {
		return err
	}
	profile, ok := FindImageParamProfile(profiles, compat.ImageParams)
	if !ok {
		return fmt.Errorf("生图参数档案不存在：%s", compat.ImageParams)
	}
	rules := profile.Rules
	compat.ImageParamRules = &rules
	return nil
}

func embedImageParamRules(cfg *Config, profiles []ImageParamProfile) (bool, error) {
	changed := false
	for index := range cfg.Models {
		model := &cfg.Models[index]
		if model.Compat == nil || model.Compat.ImageParams == "" {
			if model.Compat != nil && model.Compat.ImageParamRules != nil {
				model.Compat.ImageParamRules = nil
				changed = true
			}
			continue
		}
		profile, ok := FindImageParamProfile(profiles, model.Compat.ImageParams)
		if !ok {
			return false, fmt.Errorf("模型 %s 使用的生图参数档案不存在：%s", model.Name, model.Compat.ImageParams)
		}
		rules := profile.Rules
		before, _ := json.Marshal(model.Compat.ImageParamRules)
		after, _ := json.Marshal(&rules)
		if string(before) != string(after) {
			model.Compat.ImageParamRules = &rules
			changed = true
		}
	}
	return changed, nil
}

func NormalizeImageParamProfiles(profiles []ImageParamProfile) []ImageParamProfile {
	out := make([]ImageParamProfile, 0, len(profiles))
	for _, profile := range profiles {
		profile.ID = strings.TrimSpace(profile.ID)
		profile.Name = strings.TrimSpace(profile.Name)
		profile.Description = strings.TrimSpace(profile.Description)
		profile.Rules = normalizeImageParamRules(profile.Rules)
		profile.Capabilities.Resolutions = cleanStrings(profile.Capabilities.Resolutions)
		profile.Capabilities.AspectRatios = cleanStrings(profile.Capabilities.AspectRatios)
		profile.Capabilities.Qualities = cleanStrings(profile.Capabilities.Qualities)
		out = append(out, profile)
	}
	return out
}

func normalizeImageParamRules(rules ImageParamRules) ImageParamRules {
	rules.SizeMode = strings.TrimSpace(rules.SizeMode)
	if rules.SizeMode == "" {
		rules.SizeMode = ImageSizeModeSize
	}
	rules.AspectField = strings.TrimSpace(rules.AspectField)
	if rules.AspectField == "" && (rules.SizeMode == ImageSizeModeAspect || rules.SizeMode == ImageSizeModeAspectTier) {
		rules.AspectField = "aspect_ratio"
	}
	rules.AspectRatios = cleanStrings(rules.AspectRatios)
	rules.TierField = strings.TrimSpace(rules.TierField)
	rules.TierValues = cleanStringMap(rules.TierValues)
	rules.QualityMode = strings.TrimSpace(rules.QualityMode)
	if rules.QualityMode == "" {
		rules.QualityMode = ImageQualitySend
	}
	rules.QualityMap = cleanStringMap(rules.QualityMap)
	rules.Drop = cleanStrings(rules.Drop)
	return rules
}

func cleanStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	out := make(map[string]string, len(values))
	for key, value := range values {
		if key, value = strings.TrimSpace(key), strings.TrimSpace(value); key != "" && value != "" {
			out[key] = value
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func ValidateImageParamProfiles(profiles []ImageParamProfile) error {
	seen := map[string]bool{}
	for _, profile := range profiles {
		if profile.ID == "" || profile.Name == "" {
			return errors.New("生图参数档案的 ID 和名称不能为空")
		}
		if !presetIDPattern.MatchString(profile.ID) {
			return fmt.Errorf("生图参数档案 ID 只能用小写字母、数字、- 或 _：%s", profile.ID)
		}
		if seen[profile.ID] {
			return fmt.Errorf("生图参数档案 ID 重复：%s", profile.ID)
		}
		seen[profile.ID] = true
		if err := validateImageParamRules("生图参数档案 "+profile.Name, profile.Rules); err != nil {
			return err
		}
	}
	return nil
}

// NormalizeImageParamRules fills defaults and trims one set of rules.
func NormalizeImageParamRules(rules ImageParamRules) ImageParamRules {
	return normalizeImageParamRules(rules)
}

// ValidateImageParamRules checks one set of rules (e.g. a profile draft).
func ValidateImageParamRules(owner string, rules ImageParamRules) error {
	return validateImageParamRules(owner, normalizeImageParamRules(rules))
}

func validateImageParamRules(owner string, rules ImageParamRules) error {
	if !containsExact(imageSizeModes, rules.SizeMode) {
		return fmt.Errorf("%s 的尺寸写法无效", owner)
	}
	for _, field := range []string{rules.AspectField, rules.TierField} {
		if field != "" && (!paramNamePattern.MatchString(field) || protectedParams[field]) {
			return fmt.Errorf("%s 的字段名无效：%s", owner, field)
		}
	}
	if rules.SizeMode == ImageSizeModeAspectTier && (rules.TierField == "" || len(rules.TierValues) == 0) {
		return fmt.Errorf("%s 选了「比例 + 分辨率」，需要填写分辨率字段名和档位取值", owner)
	}
	for tier := range rules.TierValues {
		if !containsExact(imageTiers, tier) {
			return fmt.Errorf("%s 的分辨率档位只能是 1K、2K、4K：%s", owner, tier)
		}
	}
	for _, ratio := range rules.AspectRatios {
		if ratio != "auto" && !aspectRatioPattern.MatchString(ratio) {
			return fmt.Errorf("%s 的比例写法无效：%s", owner, ratio)
		}
	}
	if !containsExact(imageQualityModes, rules.QualityMode) {
		return fmt.Errorf("%s 的画质处理方式无效", owner)
	}
	if rules.QualityMode == ImageQualityMap && len(rules.QualityMap) == 0 {
		return fmt.Errorf("%s 选了「画质换值」，需要填写取值对照", owner)
	}
	for _, field := range rules.Drop {
		if !containsExact(ImageParamDroppable, field) {
			return fmt.Errorf("%s 不能移除字段：%s", owner, field)
		}
	}
	return nil
}

// FindImageParamProfile looks a profile up by ID.
func FindImageParamProfile(profiles []ImageParamProfile, id string) (ImageParamProfile, bool) {
	for _, profile := range profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return ImageParamProfile{}, false
}
