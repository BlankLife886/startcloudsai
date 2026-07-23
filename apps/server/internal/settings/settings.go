// Package settings 提供运营配置（app_settings 表）读写，缺省值兜底。
package settings

import (
	"context"
	"encoding/json"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Defaults 与 Python 版 settings_service.DEFAULTS 一致。
var Defaults = map[string]json.RawMessage{
	"task_prices":            json.RawMessage(`{"t2i": 20, "coloring": 30, "ui_design": 30, "model_sheet": 40, "game_art": 30, "puzzle": 10}`),
	"user_max_running_tasks": json.RawMessage(`3`),
	"signup_bonus_cents":     json.RawMessage(`100`),
	"registration_enabled":   json.RawMessage(`true`),
	"task_models":            json.RawMessage(`{"default": "gpt-image-2"}`),
	"free_daily_cents":       json.RawMessage(`0`),
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
	"sub2api_image_model":  json.RawMessage(`""`),
	"sub2api_timeout_secs": json.RawMessage(`0`),
}

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
	return prices, raw, nil
}

// TaskPriceCents 某类型单价（DB 值缺项时回落到默认表）。
func TaskPriceCents(ctx context.Context, q store.Q, taskType string) (int64, error) {
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
