-- +goose Up
-- 新通知提醒偏好（提示音、按分类提醒/静默、免打扰时段）；没有记录时用默认值。
CREATE TABLE user_notification_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    prefs jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS user_notification_preferences;
