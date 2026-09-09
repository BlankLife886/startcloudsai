-- +goose Up
ALTER TABLE canvas_workflow_runs
    ADD COLUMN result_policy text NOT NULL DEFAULT 'auto',
    ADD CONSTRAINT ck_canvas_workflow_runs_result_policy CHECK (result_policy IN ('auto', 'manual'));

CREATE TABLE canvas_workflow_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_version_id uuid NOT NULL REFERENCES canvas_project_versions(id) ON DELETE RESTRICT,
    title text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'queued',
    item_count integer NOT NULL,
    completed_count integer NOT NULL DEFAULT 0,
    succeeded_count integer NOT NULL DEFAULT 0,
    failed_count integer NOT NULL DEFAULT 0,
    canceled_count integer NOT NULL DEFAULT 0,
    total_cost_cents bigint NOT NULL DEFAULT 0,
    error_message text NOT NULL DEFAULT '',
    cancel_requested boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CONSTRAINT ck_canvas_workflow_batches_status CHECK (status IN ('queued', 'running', 'succeeded', 'partial_failed', 'failed', 'canceled')),
    CONSTRAINT ck_canvas_workflow_batches_item_count CHECK (item_count BETWEEN 1 AND 20),
    CONSTRAINT ck_canvas_workflow_batches_counts CHECK (
        completed_count >= 0 AND succeeded_count >= 0 AND failed_count >= 0 AND canceled_count >= 0
        AND completed_count = succeeded_count + failed_count + canceled_count
        AND completed_count <= item_count
    ),
    CONSTRAINT ck_canvas_workflow_batches_cost CHECK (total_cost_cents >= 0),
    CONSTRAINT ck_canvas_workflow_batches_title CHECK (char_length(title) <= 120),
    CONSTRAINT ck_canvas_workflow_batches_error CHECK (char_length(error_message) <= 2000)
);

CREATE TABLE canvas_workflow_batch_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES canvas_workflow_batches(id) ON DELETE CASCADE,
    position integer NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    input_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    run_id uuid UNIQUE REFERENCES canvas_workflow_runs(id) ON DELETE SET NULL,
    error_message text NOT NULL DEFAULT '',
    cost_cents bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CONSTRAINT ux_canvas_workflow_batch_items_position UNIQUE (batch_id, position),
    CONSTRAINT ck_canvas_workflow_batch_items_position CHECK (position >= 0),
    CONSTRAINT ck_canvas_workflow_batch_items_status CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')),
    CONSTRAINT ck_canvas_workflow_batch_items_input_values CHECK (jsonb_typeof(input_values) = 'object'),
    CONSTRAINT ck_canvas_workflow_batch_items_error CHECK (char_length(error_message) <= 2000),
    CONSTRAINT ck_canvas_workflow_batch_items_cost CHECK (cost_cents >= 0)
);

CREATE INDEX ix_canvas_workflow_batches_user_project_created
    ON canvas_workflow_batches (user_id, project_id, created_at DESC, id DESC);
CREATE INDEX ix_canvas_workflow_batches_dispatch
    ON canvas_workflow_batches (updated_at, created_at)
    WHERE status IN ('queued', 'running');
CREATE INDEX ix_canvas_workflow_batch_items_status
    ON canvas_workflow_batch_items (batch_id, status, position);

-- +goose Down
DROP TABLE IF EXISTS canvas_workflow_batch_items;
DROP TABLE IF EXISTS canvas_workflow_batches;
ALTER TABLE canvas_workflow_runs
    DROP CONSTRAINT IF EXISTS ck_canvas_workflow_runs_result_policy,
    DROP COLUMN IF EXISTS result_policy;
