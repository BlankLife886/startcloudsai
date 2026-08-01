-- +goose Up
INSERT INTO app_settings (key, value)
VALUES ('user_max_running_tasks', '100'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = '100'::jsonb, updated_at = now()
WHERE app_settings.value = '3'::jsonb;

-- +goose Down
UPDATE app_settings
SET value = '3'::jsonb, updated_at = now()
WHERE key = 'user_max_running_tasks' AND value = '100'::jsonb;
