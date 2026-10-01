-- +goose Up
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_type;
ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_type
    CHECK (type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle','image_to_3d','background_remove'));

UPDATE tasks
SET type = 'ecommerce_design'
WHERE type = 'ui_design'
  AND (
      params->>'_kind' LIKE 'ui-design-ecommerce-%'
      OR params->>'source' = 'ecommerce-design'
  );

ALTER TABLE prompt_library DROP CONSTRAINT IF EXISTS ck_prompt_library_task_type;
ALTER TABLE prompt_library
    ADD CONSTRAINT ck_prompt_library_task_type
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle'));

ALTER TABLE prompt_sources DROP CONSTRAINT IF EXISTS prompt_sources_task_type_check;
ALTER TABLE prompt_sources
    ADD CONSTRAINT prompt_sources_task_type_check
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle'));

ALTER TABLE prompt_import_items DROP CONSTRAINT IF EXISTS prompt_import_items_task_type_check;
ALTER TABLE prompt_import_items
    ADD CONSTRAINT prompt_import_items_task_type_check
    CHECK (task_type IN ('t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art','puzzle'));

UPDATE app_settings
SET value = jsonb_set(value, '{ecommerce_design}', COALESCE(value->'ui_design', '30'::jsonb), true),
    updated_at = now()
WHERE key = 'task_prices'
  AND NOT (value ? 'ecommerce_design');

UPDATE app_settings
SET value = jsonb_set(value, '{ecommerce_design}', COALESCE(value->'ui_design', '"c2a"'::jsonb), true),
    updated_at = now()
WHERE key = 'image_service_routes'
  AND NOT (value ? 'ecommerce_design');

UPDATE app_settings
SET value = jsonb_set(
        value,
        '{ecommerce_design}',
        COALESCE(value->'ui_design', value->'default', '"gpt-image-2"'::jsonb),
        true
    ),
    updated_at = now()
WHERE key = 'task_models'
  AND NOT (value ? 'ecommerce_design');

UPDATE app_settings
SET value = jsonb_set(
        value,
        '{workspaces,ecommerce_design}',
        value#>'{workspaces,ui_design}',
        true
    ),
    updated_at = now()
WHERE key = 'model_dispatch_config'
  AND value#>'{workspaces,ui_design}' IS NOT NULL
  AND NOT ((value->'workspaces') ? 'ecommerce_design');

-- +goose Down
UPDATE tasks SET type = 'ui_design' WHERE type = 'ecommerce_design';
UPDATE prompt_library SET task_type = 'ui_design' WHERE task_type = 'ecommerce_design';
UPDATE prompt_sources SET task_type = 'ui_design' WHERE task_type = 'ecommerce_design';
UPDATE prompt_import_items SET task_type = 'ui_design' WHERE task_type = 'ecommerce_design';

ALTER TABLE prompt_import_items DROP CONSTRAINT IF EXISTS prompt_import_items_task_type_check;
ALTER TABLE prompt_import_items
    ADD CONSTRAINT prompt_import_items_task_type_check
    CHECK (task_type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle'));

ALTER TABLE prompt_sources DROP CONSTRAINT IF EXISTS prompt_sources_task_type_check;
ALTER TABLE prompt_sources
    ADD CONSTRAINT prompt_sources_task_type_check
    CHECK (task_type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle'));

ALTER TABLE prompt_library DROP CONSTRAINT IF EXISTS ck_prompt_library_task_type;
ALTER TABLE prompt_library
    ADD CONSTRAINT ck_prompt_library_task_type
    CHECK (task_type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_type;
ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_type
    CHECK (type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle','image_to_3d','background_remove'));

UPDATE app_settings
SET value = value - 'ecommerce_design', updated_at = now()
WHERE key IN ('task_prices', 'image_service_routes', 'task_models');

UPDATE app_settings
SET value = jsonb_set(value, '{workspaces}', (value->'workspaces') - 'ecommerce_design', true),
    updated_at = now()
WHERE key = 'model_dispatch_config'
  AND (value->'workspaces') ? 'ecommerce_design';
