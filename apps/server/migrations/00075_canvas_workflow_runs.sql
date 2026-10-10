-- +goose Up
CREATE TABLE canvas_workflow_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'running',
    node_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    completed_node_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    current_node_id text,
    error_message text NOT NULL DEFAULT '',
    lease_expires_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CONSTRAINT ck_canvas_workflow_runs_status CHECK (status IN ('running', 'succeeded', 'failed', 'canceled')),
    CONSTRAINT ck_canvas_workflow_runs_node_ids CHECK (jsonb_typeof(node_ids) = 'array'),
    CONSTRAINT ck_canvas_workflow_runs_completed_node_ids CHECK (jsonb_typeof(completed_node_ids) = 'array')
);

CREATE UNIQUE INDEX ux_canvas_workflow_runs_active_project
    ON canvas_workflow_runs (project_id)
    WHERE status = 'running';
CREATE INDEX ix_canvas_workflow_runs_user_project_updated
    ON canvas_workflow_runs (user_id, project_id, updated_at DESC);

-- +goose Down
DROP TABLE IF EXISTS canvas_workflow_runs;
