package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// GetAppSetting 返回原始 JSON 值；不存在返回 nil。
func GetAppSetting(ctx context.Context, q Q, key string) (json.RawMessage, error) {
	var raw []byte
	err := q.QueryRow(ctx, `SELECT value FROM app_settings WHERE key = $1`, key).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return json.RawMessage(raw), nil
}

func GetAllAppSettings(ctx context.Context, q Q) (map[string]json.RawMessage, error) {
	rows, err := q.Query(ctx, `SELECT key, value FROM app_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		out[key] = json.RawMessage(raw)
	}
	return out, rows.Err()
}

func SetAppSetting(ctx context.Context, q Q, key string, value json.RawMessage, updatedAt time.Time) error {
	_, err := q.Exec(ctx,
		`INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
		key, value, updatedAt)
	return err
}
