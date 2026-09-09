-- +goose Up
CREATE TABLE canvas_workflow_template_seed_versions (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS canvas_workflow_template_seed_versions;
