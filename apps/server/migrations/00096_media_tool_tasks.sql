-- +goose Up
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_type;
ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_type
    CHECK (type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','background_remove','media_tool'));

-- +goose Down
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_type;
ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_type
    CHECK (type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','background_remove'));
