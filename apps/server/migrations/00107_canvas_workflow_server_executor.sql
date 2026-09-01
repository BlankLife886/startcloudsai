-- +goose Up
ALTER TABLE canvas_workflow_runs
    ADD COLUMN execution_mode text NOT NULL DEFAULT 'browser',
    ADD COLUMN executor_owner text,
    ADD COLUMN executor_lease_until timestamptz,
    ADD COLUMN result_document jsonb,
    ADD COLUMN result_applied boolean NOT NULL DEFAULT false,
    ADD COLUMN result_revision bigint,
    ADD CONSTRAINT ck_canvas_workflow_runs_execution_mode CHECK (execution_mode IN ('browser', 'server')),
    ADD CONSTRAINT ck_canvas_workflow_runs_result_document CHECK (result_document IS NULL OR jsonb_typeof(result_document) = 'object');

CREATE INDEX ix_canvas_workflow_runs_server_ready
    ON canvas_workflow_runs (executor_lease_until, updated_at)
    WHERE execution_mode = 'server' AND status = 'running';

CREATE TABLE canvas_workflow_run_nodes (
    run_id uuid NOT NULL REFERENCES canvas_workflow_runs(id) ON DELETE CASCADE,
    node_id text NOT NULL,
    title text NOT NULL DEFAULT '',
    dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'pending',
    task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
    output_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    thumbnail_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    error_message text NOT NULL DEFAULT '',
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, node_id),
    CONSTRAINT ck_canvas_workflow_run_nodes_dependencies CHECK (jsonb_typeof(dependencies) = 'array'),
    CONSTRAINT ck_canvas_workflow_run_nodes_status CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')),
    CONSTRAINT ck_canvas_workflow_run_nodes_output_keys CHECK (jsonb_typeof(output_keys) = 'array'),
    CONSTRAINT ck_canvas_workflow_run_nodes_thumbnail_keys CHECK (jsonb_typeof(thumbnail_keys) = 'array')
);

CREATE INDEX ix_canvas_workflow_run_nodes_task ON canvas_workflow_run_nodes (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX ix_canvas_workflow_run_nodes_status ON canvas_workflow_run_nodes (run_id, status, updated_at);

-- +goose Down
DROP TABLE IF EXISTS canvas_workflow_run_nodes;
DROP INDEX IF EXISTS ix_canvas_workflow_runs_server_ready;
ALTER TABLE canvas_workflow_runs
    DROP CONSTRAINT IF EXISTS ck_canvas_workflow_runs_result_document,
    DROP CONSTRAINT IF EXISTS ck_canvas_workflow_runs_execution_mode,
    DROP COLUMN IF EXISTS result_revision,
    DROP COLUMN IF EXISTS result_applied,
    DROP COLUMN IF EXISTS result_document,
    DROP COLUMN IF EXISTS executor_lease_until,
    DROP COLUMN IF EXISTS executor_owner,
    DROP COLUMN IF EXISTS execution_mode;
