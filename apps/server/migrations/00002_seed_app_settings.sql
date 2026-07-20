-- +goose Up
INSERT INTO app_settings (key, value) VALUES
    ('task_prices', '{"t2i": 20, "coloring": 30, "ui_design": 30, "model_sheet": 40, "game_art": 30, "puzzle": 10}'::jsonb),
    ('user_max_running_tasks', '3'::jsonb),
    ('signup_bonus_cents', '100'::jsonb),
    ('registration_enabled', 'true'::jsonb),
    ('task_models', '{"default": "gpt-image-2"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- +goose Down
DELETE FROM app_settings WHERE key IN ('task_prices', 'user_max_running_tasks', 'signup_bonus_cents', 'registration_enabled', 'task_models');
