-- +goose Up
INSERT INTO app_settings (key, value)
VALUES
    ('user_max_concurrent_tasks', '20'::jsonb),
    ('global_max_concurrent_tasks', '2000'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now()
WHERE app_settings.key = 'user_max_concurrent_tasks' AND (app_settings.value #>> '{}')::int <= 10
   OR app_settings.key = 'global_max_concurrent_tasks' AND (app_settings.value #>> '{}')::int <= 32;

-- +goose Down
UPDATE app_settings
SET value = CASE key
    WHEN 'user_max_concurrent_tasks' THEN '2'::jsonb
    ELSE '4'::jsonb
END,
updated_at = now()
WHERE (key = 'user_max_concurrent_tasks' AND value = '20'::jsonb)
   OR (key = 'global_max_concurrent_tasks' AND value = '2000'::jsonb);
