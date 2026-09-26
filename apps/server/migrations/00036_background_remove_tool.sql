-- +goose Up
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_type;

ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_type
    CHECK (type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle','image_to_3d','background_remove'));

-- +goose Down
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_type;

ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_type
    CHECK (type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle','image_to_3d'));
