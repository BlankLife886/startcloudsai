-- +goose Up
ALTER TABLE canvas_workflow_runs ADD COLUMN input_signature text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE canvas_workflow_runs DROP COLUMN input_signature;
