-- +goose Up
INSERT INTO app_settings (key, value)
VALUES ('global_max_active_tasks', '5000'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now()
WHERE (app_settings.value #>> '{}')::int < 5000;

-- +goose Down
UPDATE app_settings
SET value = '2000'::jsonb, updated_at = now()
WHERE key = 'global_max_active_tasks' AND value = '5000'::jsonb;
