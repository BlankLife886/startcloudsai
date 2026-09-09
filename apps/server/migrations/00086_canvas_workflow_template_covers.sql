-- +goose Up
ALTER TABLE canvas_workflow_templates
    ADD COLUMN cover_key text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE canvas_workflow_templates
    DROP COLUMN IF EXISTS cover_key;
