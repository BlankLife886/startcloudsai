-- +goose Up
DELETE FROM app_settings WHERE key = 'crun_points_per_credit_milli';

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_type;
ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_type
    CHECK (type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','background_remove'));

-- +goose Down
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_type;
ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_type
    CHECK (type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','background_remove','crun_media'));

INSERT INTO app_settings (key, value)
VALUES ('crun_points_per_credit_milli', '4000'::jsonb)
ON CONFLICT (key) DO NOTHING;
