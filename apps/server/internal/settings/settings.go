// Package settings 提供运营配置（app_settings 表）读写，缺省值兜底。
package settings

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Defaults 与 Python 版 settings_service.DEFAULTS 一致。
var Defaults = map[string]json.RawMessage{
	"task_prices":                 json.RawMessage(`{"t2i": 20, "coloring": 30, "ui_design": 30, "ecommerce_design": 30, "model_sheet": 40, "game_art": 30, "puzzle": 0}`),
	"user_max_running_tasks":      json.RawMessage(`100`),
	"user_max_running_images":     json.RawMessage(`400`),
	"user_max_concurrent_tasks":   json.RawMessage(`20`),
	"global_max_concurrent_tasks": json.RawMessage(`2000`),
	"global_max_active_tasks":     json.RawMessage(`12000`),
	"global_max_active_images":    json.RawMessage(`12000`),
	"task_failure_retry_count":    json.RawMessage(`2`),
	"task_retry_first_delay_secs": json.RawMessage(`3`),
	"task_retry_backoff_secs":     json.RawMessage(`15`),
	// 图片三级图（小图/展示图/原图）中变体的编码配置
	"image_variant_format":                        json.RawMessage(`"webp"`),
	"image_display_lossless":                      json.RawMessage(`false`),
	"image_display_quality":                       json.RawMessage(`85`),
	"image_display_max_edge":                      json.RawMessage(`2048`),
	"image_thumb_max_edge":                        json.RawMessage(`512`),
	"image_fetch_concurrency":                     json.RawMessage(`2`),
	"cross_provider_same_model_balancing_enabled": json.RawMessage(`false`),
	"signup_bonus_cents":                          json.RawMessage(`100`),
	"registration_enabled":                        json.RawMessage(`true`),
	"task_models":                                 json.RawMessage(`{"default": "gpt-image-2"}`),
	"image_service_routes":                        json.RawMessage(`{"t2i":"c2a","coloring":"c2a","ui_design":"c2a","ecommerce_design":"c2a","model_sheet":"c2a","game_art":"c2a","assistant_image":"sub2api","ui_design_asset":"sub2api"}`),
	"checkin_enabled":                             json.RawMessage(`true`),
	"checkin_campaign_title":                      json.RawMessage(`"连续签到领创作积分"`),
	"checkin_rewards":                             json.RawMessage(`[10,15,20,25,30,40,80]`),
	"growth_group_enabled":                        json.RawMessage(`true`),
	"growth_group_campaign_key":                   json.RawMessage(`"launch-2026"`),
	"growth_group_target_members":                 json.RawMessage(`3`),
	"growth_group_reward_cents":                   json.RawMessage(`30`),
	"growth_group_duration_hours":                 json.RawMessage(`48`),
	"growth_failure_bonus_enabled":                json.RawMessage(`true`),
	"growth_failure_bonus_cents":                  json.RawMessage(`3`),
	"growth_failure_bonus_daily_limit":            json.RawMessage(`3`),
	"growth_usage_rewards_enabled":                json.RawMessage(`true`),
	"growth_usage_milestones":                     json.RawMessage(`[{"units":10,"rewardCents":20},{"units":30,"rewardCents":50},{"units":100,"rewardCents":150}]`),
	"suggestion_reward_max_cents":                 json.RawMessage(`10000`),
	"page_controls":                               mustMarshalPageControls(PageControlDefaults()),
	// 社区投稿（v3）：开关 / 自动过审 / 每日限额（0 = 不限）
	"submission_enabled": json.RawMessage(`true`),
	"auto_approve":       json.RawMessage(`false`),
	"daily_limit":        json.RawMessage(`0`),
	// chatgpt2api 上游（空 = 使用环境变量）
	"c2a_base_url":     json.RawMessage(`""`),
	"c2a_api_key":      json.RawMessage(`""`),
	"c2a_timeout_secs": json.RawMessage(`0`),
	// Sub2API 对话/生图网关（空 = 使用环境变量）
	"sub2api_base_url":     json.RawMessage(`""`),
	"sub2api_api_key":      json.RawMessage(`""`),
	"sub2api_chat_model":   json.RawMessage(`""`),
	"sub2api_chat_models":  json.RawMessage(`{}`),
	"sub2api_image_model":  json.RawMessage(`""`),
	"sub2api_timeout_secs": json.RawMessage(`0`),
	// CRUN 异步图片服务（空 = 使用环境变量）
	"crun_base_url":     json.RawMessage(`""`),
	"crun_api_key":      json.RawMessage(`""`),
	"crun_timeout_secs": json.RawMessage(`0`),
}

var ImageServiceRouteKeys = []string{
	"t2i", "coloring", "ui_design", "ecommerce_design", "model_sheet", "game_art", "assistant_image", "ui_design_asset",
}

func validImageServiceRoute(key string) bool {
	for _, candidate := range ImageServiceRouteKeys {
		if candidate == key {
			return true
		}
	}
	return false
}

// ImageServiceProvider returns the configured image provider for a page/task route.
// Existing task pages remain on C2A; assistant image flows default to Sub2API.
func ImageServiceProvider(ctx context.Context, q store.Q, routeKey string) (string, error) {
	raw, err := Get(ctx, q, "image_service_routes")
	if err != nil {
		return "", err
	}
	routes := map[string]string{}
	if raw != nil {
		_ = json.Unmarshal(raw, &routes)
	}
	provider := strings.ToLower(strings.TrimSpace(routes[routeKey]))
	if provider == "c2a" || provider == "sub2api" || provider == "crun" {
		return provider, nil
	}
	if routeKey == "assistant_image" || routeKey == "ui_design_asset" {
		return "sub2api", nil
	}
	return "c2a", nil
}

func ValidImageServiceRoute(key string) bool { return validImageServiceRoute(key) }

// AllowedKeys 后台可读写的配置键。
var AllowedKeys = func() map[string]bool {
	m := map[string]bool{}
	for k := range Defaults {
		m[k] = true
	}
	return m
}()

// Get 返回配置的原始 JSON（缺省用 Defaults）。
func Get(ctx context.Context, q store.Q, key string) (json.RawMessage, error) {
	raw, err := store.GetAppSetting(ctx, q, key)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return Defaults[key], nil
	}
	return raw, nil
}

// GetAll 返回全部配置（DB 值覆盖缺省，仅 AllowedKeys）。
func GetAll(ctx context.Context, q store.Q) (map[string]json.RawMessage, error) {
	rows, err := store.GetAllAppSettings(ctx, q)
	if err != nil {
		return nil, err
	}
	merged := map[string]json.RawMessage{}
	for k, v := range Defaults {
		merged[k] = v
	}
	for k, v := range rows {
		if AllowedKeys[k] {
			merged[k] = v
		}
	}
	return merged, nil
}

// Set 写入配置。
func Set(ctx context.Context, q store.Q, key string, value json.RawMessage) error {
	return store.SetAppSetting(ctx, q, key, value, time.Now().UTC())
}

// GetBool / GetInt 类型化读取。
func GetBool(ctx context.Context, q store.Q, key string) (bool, error) {
	raw, err := Get(ctx, q, key)
	if err != nil || raw == nil {
		return false, err
	}
	var v bool
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, nil
	}
	return v, nil
}

func GetInt(ctx context.Context, q store.Q, key string) (int64, error) {
	raw, err := Get(ctx, q, key)
	if err != nil || raw == nil {
		return 0, err
	}
	var v int64
	if err := json.Unmarshal(raw, &v); err != nil {
		return 0, nil
	}
	return v, nil
}

func GetString(ctx context.Context, q store.Q, key string) (string, error) {
	raw, err := Get(ctx, q, key)
	if err != nil || raw == nil {
		return "", err
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", nil
	}
	return strings.TrimSpace(value), nil
}

func GetStrings(ctx context.Context, q store.Q, key string) ([]string, error) {
	raw, err := Get(ctx, q, key)
	if err != nil || raw == nil {
		return nil, err
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return []string{}, nil
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result, nil
}

// TaskPrices 返回任务单价表（原始 JSON 对象）。
func TaskPrices(ctx context.Context, q store.Q) (map[string]int64, json.RawMessage, error) {
	raw, err := Get(ctx, q, "task_prices")
	if err != nil {
		return nil, nil, err
	}
	prices := map[string]int64{}
	if raw != nil {
		_ = json.Unmarshal(raw, &prices)
	}
	for taskType := range prices {
		if !store.Contains(store.TaskTypes, taskType) {
			delete(prices, taskType)
		}
	}
	// AI 拼图完全在浏览器 Canvas 中执行，没有上游调用，存在该配置时强制免费。
	if _, exists := prices["puzzle"]; exists {
		prices["puzzle"] = 0
	}
	filtered, _ := json.Marshal(prices)
	return prices, filtered, nil
}

// TaskPriceCents 某类型单价（DB 值缺项时回落到默认表）。
func TaskPriceCents(ctx context.Context, q store.Q, taskType string) (int64, error) {
	if taskType == "puzzle" {
		return 0, nil
	}
	prices, _, err := TaskPrices(ctx, q)
	if err != nil {
		return 0, err
	}
	if p, ok := prices[taskType]; ok {
		return p, nil
	}
	var defaults map[string]int64
	_ = json.Unmarshal(Defaults["task_prices"], &defaults)
	return defaults[taskType], nil
}

// TaskModel 某类型使用的模型（task_models[type] → default → gpt-image-2）。
func TaskModel(ctx context.Context, q store.Q, taskType string) (string, error) {
	raw, err := Get(ctx, q, "task_models")
	if err != nil {
		return "", err
	}
	models := map[string]string{}
	if raw != nil {
		_ = json.Unmarshal(raw, &models)
	}
	if m := models[taskType]; m != "" {
		return m, nil
	}
	if m := models["default"]; m != "" {
		return m, nil
	}
	return "gpt-image-2", nil
}

// ImageVariantConfig 三级图变体（小图/展示图）的生效编码配置。
type ImageVariantConfig struct {
	Format         string // "webp" | "png"
	Lossless       bool   // 仅 webp 有意义
	Quality        int    // 仅有损 webp 有意义
	DisplayMaxEdge int
	ThumbMaxEdge   int
}

// ResolveImageVariants 读取后台配置并做边界兜底。
func ResolveImageVariants(ctx context.Context, q store.Q) (ImageVariantConfig, error) {
	cfg := ImageVariantConfig{Format: "webp", Quality: 85, DisplayMaxEdge: 2048, ThumbMaxEdge: 512}
	format, err := GetString(ctx, q, "image_variant_format")
	if err != nil {
		return cfg, err
	}
	if format == "png" {
		cfg.Format = "png"
	}
	lossless, err := GetBool(ctx, q, "image_display_lossless")
	if err != nil {
		return cfg, err
	}
	cfg.Lossless = lossless
	if quality, err := GetInt(ctx, q, "image_display_quality"); err != nil {
		return cfg, err
	} else if quality >= 1 && quality <= 100 {
		cfg.Quality = int(quality)
	}
	if edge, err := GetInt(ctx, q, "image_display_max_edge"); err != nil {
		return cfg, err
	} else if edge >= 512 && edge <= 8192 {
		cfg.DisplayMaxEdge = int(edge)
	}
	if edge, err := GetInt(ctx, q, "image_thumb_max_edge"); err != nil {
		return cfg, err
	} else if edge >= 128 && edge <= 1024 {
		cfg.ThumbMaxEdge = int(edge)
	}
	return cfg, nil
}

// C2AConfig chatgpt2api 生效配置。
type C2AConfig struct {
	BaseURL     string
	APIKey      string
	TimeoutSecs int
}

// ResolveC2A 返回生效的 chatgpt2api 配置：后台设置非空则覆盖环境变量默认值。
func ResolveC2A(ctx context.Context, q store.Q, envBaseURL, envAPIKey string, envTimeoutSecs int, masterKey string) (C2AConfig, error) {
	cfg := C2AConfig{BaseURL: envBaseURL, APIKey: envAPIKey, TimeoutSecs: envTimeoutSecs}
	readString := func(key string) (string, error) {
		raw, err := Get(ctx, q, key)
		if err != nil {
			return "", err
		}
		var v string
		if raw != nil {
			_ = json.Unmarshal(raw, &v)
		}
		return v, nil
	}
	if v, err := readString("c2a_base_url"); err != nil {
		return cfg, err
	} else if v != "" {
		cfg.BaseURL = v
	}
	if v, err := readString("c2a_api_key"); err != nil {
		return cfg, err
	} else if v != "" {
		plain, derr := DecryptSecret(v, masterKey)
		if derr != nil {
			return cfg, derr
		}
		cfg.APIKey = plain
	}
	rawTimeout, err := Get(ctx, q, "c2a_timeout_secs")
	if err != nil {
		return cfg, err
	}
	var timeout int
	if rawTimeout != nil {
		_ = json.Unmarshal(rawTimeout, &timeout)
	}
	if timeout > 0 {
		cfg.TimeoutSecs = timeout
	}
	return cfg, nil
}

// Sub2APIConfig 对话与生图助手的生效配置。
type Sub2APIConfig struct {
	BaseURL     string
	APIKey      string
	ChatModel   string
	ChatModels  map[string]string
	ImageModel  string
	TimeoutSecs int
}

// ResolveSub2API 返回后台设置覆盖环境变量后的 Sub2API 配置。
func ResolveSub2API(ctx context.Context, q store.Q, env Sub2APIConfig, masterKey string) (Sub2APIConfig, error) {
	cfg := env
	readString := func(key string) (string, error) {
		raw, err := Get(ctx, q, key)
		if err != nil {
			return "", err
		}
		var value string
		if raw != nil {
			_ = json.Unmarshal(raw, &value)
		}
		return value, nil
	}
	for key, target := range map[string]*string{
		"sub2api_base_url":    &cfg.BaseURL,
		"sub2api_chat_model":  &cfg.ChatModel,
		"sub2api_image_model": &cfg.ImageModel,
	} {
		value, err := readString(key)
		if err != nil {
			return cfg, err
		}
		if value != "" {
			*target = value
		}
	}
	rawModels, err := Get(ctx, q, "sub2api_chat_models")
	if err != nil {
		return cfg, err
	}
	if rawModels != nil {
		var models map[string]string
		if json.Unmarshal(rawModels, &models) == nil {
			cfg.ChatModels = make(map[string]string, len(models))
			for label, model := range models {
				label = strings.TrimSpace(label)
				model = strings.TrimSpace(model)
				if label != "" && model != "" {
					cfg.ChatModels[label] = model
				}
			}
		}
	}
	storedKey, err := readString("sub2api_api_key")
	if err != nil {
		return cfg, err
	}
	if storedKey != "" {
		plain, derr := DecryptSecret(storedKey, masterKey)
		if derr != nil {
			return cfg, derr
		}
		cfg.APIKey = plain
	}
	rawTimeout, err := Get(ctx, q, "sub2api_timeout_secs")
	if err != nil {
		return cfg, err
	}
	var timeout int
	if rawTimeout != nil {
		_ = json.Unmarshal(rawTimeout, &timeout)
	}
	if timeout > 0 {
		cfg.TimeoutSecs = timeout
	}
	return cfg, nil
}

type CRUNConfig struct {
	BaseURL     string
	APIKey      string
	TimeoutSecs int
}

type LanjingPayConfig struct {
	Enabled       bool
	BaseURL       string
	Secret        string
	NotifyURL     string
	TimeoutSecs   int
	AlipayEnabled bool
	WechatEnabled bool
}

// ResolveLanjingPay returns the effective payment configuration. Persisted
// admin settings override environment defaults and secrets stay encrypted at rest.
func ResolveLanjingPay(ctx context.Context, q store.Q, env LanjingPayConfig, masterKey string) (LanjingPayConfig, error) {
	cfg := env
	read := func(key string) (json.RawMessage, error) {
		return Get(ctx, q, key)
	}
	for key, target := range map[string]*string{
		"lanjing_pay_base_url":   &cfg.BaseURL,
		"lanjing_pay_notify_url": &cfg.NotifyURL,
	} {
		raw, err := read(key)
		if err != nil {
			return cfg, err
		}
		if raw != nil {
			var value string
			if json.Unmarshal(raw, &value) == nil && strings.TrimSpace(value) != "" {
				*target = strings.TrimSpace(value)
			}
		}
	}
	if raw, err := read("lanjing_pay_secret"); err != nil {
		return cfg, err
	} else if raw != nil {
		var stored string
		if json.Unmarshal(raw, &stored) == nil && stored != "" {
			plain, decryptErr := DecryptSecret(stored, masterKey)
			if decryptErr != nil {
				return cfg, decryptErr
			}
			cfg.Secret = plain
		}
	}
	for key, target := range map[string]*bool{
		"lanjing_pay_enabled":        &cfg.Enabled,
		"lanjing_pay_alipay_enabled": &cfg.AlipayEnabled,
		"lanjing_pay_wechat_enabled": &cfg.WechatEnabled,
	} {
		raw, err := read(key)
		if err != nil {
			return cfg, err
		}
		if raw != nil {
			_ = json.Unmarshal(raw, target)
		}
	}
	if raw, err := read("lanjing_pay_timeout_secs"); err != nil {
		return cfg, err
	} else if raw != nil {
		var timeout int
		if json.Unmarshal(raw, &timeout) == nil && timeout > 0 {
			cfg.TimeoutSecs = timeout
		}
	}
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.NotifyURL = strings.TrimSpace(cfg.NotifyURL)
	return cfg, nil
}

// ResolveCRUN returns the effective CRUN configuration with admin settings
// taking precedence over environment variables.
func ResolveCRUN(ctx context.Context, q store.Q, env CRUNConfig, masterKey string) (CRUNConfig, error) {
	cfg := env
	readString := func(key string) (string, error) {
		raw, err := Get(ctx, q, key)
		if err != nil {
			return "", err
		}
		var value string
		if raw != nil {
			_ = json.Unmarshal(raw, &value)
		}
		return strings.TrimSpace(value), nil
	}
	if value, err := readString("crun_base_url"); err != nil {
		return cfg, err
	} else if value != "" {
		cfg.BaseURL = value
	}
	storedKey, err := readString("crun_api_key")
	if err != nil {
		return cfg, err
	}
	if storedKey != "" {
		plain, decryptErr := DecryptSecret(storedKey, masterKey)
		if decryptErr != nil {
			return cfg, decryptErr
		}
		cfg.APIKey = plain
	}
	rawTimeout, err := Get(ctx, q, "crun_timeout_secs")
	if err != nil {
		return cfg, err
	}
	var timeout int
	if rawTimeout != nil {
		_ = json.Unmarshal(rawTimeout, &timeout)
	}
	if timeout > 0 {
		cfg.TimeoutSecs = timeout
	}
	return cfg, nil
}
