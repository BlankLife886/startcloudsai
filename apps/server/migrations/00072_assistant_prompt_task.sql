-- +goose Up
ALTER TABLE prompt_library DROP CONSTRAINT IF EXISTS ck_prompt_library_task_type;
ALTER TABLE prompt_library
    ADD CONSTRAINT ck_prompt_library_task_type
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','infinite_canvas','assistant'));

ALTER TABLE prompt_sources DROP CONSTRAINT IF EXISTS prompt_sources_task_type_check;
ALTER TABLE prompt_sources
    ADD CONSTRAINT prompt_sources_task_type_check
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','infinite_canvas','assistant'));

ALTER TABLE prompt_import_items DROP CONSTRAINT IF EXISTS prompt_import_items_task_type_check;
ALTER TABLE prompt_import_items
    ADD CONSTRAINT prompt_import_items_task_type_check
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','infinite_canvas','assistant'));

-- +goose Down
UPDATE prompt_library SET task_type = 't2i' WHERE task_type = 'assistant';
UPDATE prompt_sources SET task_type = 't2i' WHERE task_type = 'assistant';
UPDATE prompt_import_items SET task_type = 't2i' WHERE task_type = 'assistant';

ALTER TABLE prompt_import_items DROP CONSTRAINT IF EXISTS prompt_import_items_task_type_check;
ALTER TABLE prompt_import_items
    ADD CONSTRAINT prompt_import_items_task_type_check
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','infinite_canvas'));

ALTER TABLE prompt_sources DROP CONSTRAINT IF EXISTS prompt_sources_task_type_check;
ALTER TABLE prompt_sources
    ADD CONSTRAINT prompt_sources_task_type_check
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','infinite_canvas'));

ALTER TABLE prompt_library DROP CONSTRAINT IF EXISTS ck_prompt_library_task_type;
ALTER TABLE prompt_library
    ADD CONSTRAINT ck_prompt_library_task_type
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','infinite_canvas'));
