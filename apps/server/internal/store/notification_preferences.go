package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// GetNotificationPreferences 没有保存过时返回 nil。
func GetNotificationPreferences(ctx context.Context, q Q, userID uuid.UUID) (json.RawMessage, error) {
	var prefs json.RawMessage
	err := q.QueryRow(ctx, `SELECT prefs FROM user_notification_preferences WHERE user_id = $1`, userID).Scan(&prefs)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return prefs, err
}

func SaveNotificationPreferences(ctx context.Context, q Q, userID uuid.UUID, prefs json.RawMessage) error {
	_, err := q.Exec(ctx, `
		INSERT INTO user_notification_preferences (user_id, prefs) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
		userID, prefs)
	return err
}
