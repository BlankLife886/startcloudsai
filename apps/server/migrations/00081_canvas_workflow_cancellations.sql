-- +goose Up
ALTER TABLE canvas_workflow_runs
    ADD COLUMN canceled_node_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT ck_canvas_workflow_runs_canceled_node_ids
        CHECK (jsonb_typeof(canceled_node_ids) = 'array');

-- +goose Down
ALTER TABLE canvas_workflow_runs
    DROP CONSTRAINT IF EXISTS ck_canvas_workflow_runs_canceled_node_ids,
    DROP COLUMN IF EXISTS canceled_node_ids;
