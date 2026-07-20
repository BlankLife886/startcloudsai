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
