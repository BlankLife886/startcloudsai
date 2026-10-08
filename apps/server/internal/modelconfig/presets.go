package modelconfig

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// PresetSettingKey stores the admin-edited vendor presets. When it is unset
// the built-in defaults below are served.
const PresetSettingKey = "model_provider_presets"

// Preset regions group vendors in the admin picker.
const (
	PresetRegionGlobal = "global"
	PresetRegionCN     = "cn"
	PresetRegionRelay  = "relay"
)

// ProviderPreset is a reusable vendor template: creating a provider from it
// pre-fills the connection fields, which the admin can still edit.
type ProviderPreset struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Region      string         `json:"region"`
	Description string         `json:"description,omitempty"`
	Adapter     string         `json:"adapter"`
	BaseURL     string         `json:"baseUrl"`
	APIPath     string         `json:"apiPath,omitempty"`
	AuthStyle   string         `json:"authStyle,omitempty"`
	ImageAPI    string         `json:"imageApi,omitempty"`
	Compat      *RequestCompat `json:"compat,omitempty"`
	KeyURL      string         `json:"keyUrl,omitempty"`
}

//go:embed presets_default.json
var defaultPresetsJSON []byte

// DefaultPresets returns a fresh copy of the built-in vendor presets.
func DefaultPresets() []ProviderPreset {
	var presets []ProviderPreset
	if err := json.Unmarshal(defaultPresetsJSON, &presets); err != nil {
		panic(fmt.Sprintf("modelconfig: invalid built-in presets: %v", err))
	}
	return NormalizePresets(presets)
}

// LoadPresets returns the stored presets, or the defaults when none are saved.
func LoadPresets(ctx context.Context, q store.Q) ([]ProviderPreset, bool, error) {
	raw, err := store.GetAppSetting(ctx, q, PresetSettingKey)
	if err != nil {
		return nil, false, err
	}
	if len(raw) == 0 {
		return DefaultPresets(), false, nil
	}
	var presets []ProviderPreset
	if err := json.Unmarshal(raw, &presets); err != nil {
		return nil, false, err
	}
	return NormalizePresets(presets), true, nil
}

// SavePresets validates and stores the admin's preset list.
func SavePresets(ctx context.Context, q store.Q, presets []ProviderPreset) ([]ProviderPreset, error) {
	presets = NormalizePresets(presets)
	if err := ValidatePresets(presets); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(presets)
	if err != nil {
		return nil, err
	}
	if err := store.SetAppSetting(ctx, q, PresetSettingKey, raw, time.Now().UTC()); err != nil {
		return nil, err
	}
	return presets, nil
}

// ResetPresets drops the stored list so the built-in defaults apply again.
func ResetPresets(ctx context.Context, q store.Q) error {
	_, err := q.Exec(ctx, `DELETE FROM app_settings WHERE key = $1`, PresetSettingKey)
	return err
}

func NormalizePresets(presets []ProviderPreset) []ProviderPreset {
	out := make([]ProviderPreset, 0, len(presets))
	for _, preset := range presets {
		preset.ID = strings.TrimSpace(preset.ID)
		preset.Name = strings.TrimSpace(preset.Name)
		preset.Region = strings.TrimSpace(preset.Region)
		if preset.Region == "" {
			preset.Region = PresetRegionRelay
		}
		preset.Description = strings.TrimSpace(preset.Description)
		preset.Adapter = strings.TrimSpace(preset.Adapter)
		if preset.Adapter == "" {
			preset.Adapter = AdapterOpenAI
		}
		preset.BaseURL = strings.TrimRight(strings.TrimSpace(preset.BaseURL), "/")
		preset.APIPath = NormalizeAPIPath(preset.APIPath)
		preset.AuthStyle = strings.TrimSpace(preset.AuthStyle)
		preset.ImageAPI = strings.TrimSpace(preset.ImageAPI)
		preset.Compat = normalizeCompat(preset.Compat)
		preset.KeyURL = strings.TrimSpace(preset.KeyURL)
		out = append(out, preset)
	}
	return out
}

func ValidatePresets(presets []ProviderPreset) error {
	seen := map[string]bool{}
	for _, preset := range presets {
		if preset.ID == "" || preset.Name == "" {
			return errors.New("厂商预设的 ID 和名称不能为空")
		}
		if seen[preset.ID] {
			return fmt.Errorf("厂商预设 ID 重复：%s", preset.ID)
		}
		seen[preset.ID] = true
		owner := "厂商预设 " + preset.Name
		if !ValidAdapter(preset.Adapter) {
			return fmt.Errorf("%s 的协议无效", owner)
		}
		switch preset.Region {
		case PresetRegionGlobal, PresetRegionCN, PresetRegionRelay:
		default:
			return fmt.Errorf("%s 的分组无效", owner)
		}
		if err := validateAPIPath(owner, preset.APIPath); err != nil {
			return err
		}
		if preset.AuthStyle != "" && !containsExact(authStyles, preset.AuthStyle) {
			return fmt.Errorf("%s 的鉴权方式无效", owner)
		}
		if preset.ImageAPI != ImageAPIAuto && preset.ImageAPI != ImageAPIStandard {
			return fmt.Errorf("%s 的生图接口类型无效", owner)
		}
		if err := validateCompat(owner, preset.Compat); err != nil {
			return err
		}
	}
	return nil
}

// FindPreset looks a preset up by ID.
func FindPreset(presets []ProviderPreset, id string) (ProviderPreset, bool) {
	for _, preset := range presets {
		if preset.ID == id {
			return preset, true
		}
	}
	return ProviderPreset{}, false
}
