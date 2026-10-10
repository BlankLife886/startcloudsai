-- +goose Up
CREATE TABLE canvas_project_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version_number integer NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    title text NOT NULL,
    document jsonb NOT NULL,
    input_schema jsonb NOT NULL DEFAULT '{"version":1,"inputs":[]}'::jsonb,
    change_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    CONSTRAINT ux_canvas_project_versions_number UNIQUE (project_id, version_number),
    CONSTRAINT ck_canvas_project_versions_number CHECK (version_number > 0),
    CONSTRAINT ck_canvas_project_versions_status CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT ck_canvas_project_versions_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT ck_canvas_project_versions_document_object CHECK (jsonb_typeof(document) = 'object'),
    CONSTRAINT ck_canvas_project_versions_input_schema_object CHECK (jsonb_typeof(input_schema) = 'object'),
    CONSTRAINT ck_canvas_project_versions_change_note_length CHECK (char_length(change_note) <= 500)
);

CREATE UNIQUE INDEX ux_canvas_project_versions_published
    ON canvas_project_versions (project_id)
    WHERE status = 'published';
CREATE INDEX ix_canvas_project_versions_user_project_created
    ON canvas_project_versions (user_id, project_id, version_number DESC);

ALTER TABLE canvas_projects
    ADD COLUMN published_version_id uuid,
    ADD CONSTRAINT fk_canvas_projects_published_version
        FOREIGN KEY (published_version_id) REFERENCES canvas_project_versions(id) ON DELETE SET NULL;

ALTER TABLE canvas_workflow_runs
    ADD COLUMN project_revision bigint NOT NULL DEFAULT 1,
    ADD COLUMN project_version_id uuid REFERENCES canvas_project_versions(id) ON DELETE SET NULL,
    ADD COLUMN input_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN node_metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN total_cost_cents bigint NOT NULL DEFAULT 0,
    ADD COLUMN retry_of_run_id uuid REFERENCES canvas_workflow_runs(id) ON DELETE SET NULL,
    ADD COLUMN error_node_id text,
    ADD CONSTRAINT ck_canvas_workflow_runs_project_revision CHECK (project_revision > 0),
    ADD CONSTRAINT ck_canvas_workflow_runs_input_values CHECK (jsonb_typeof(input_values) = 'object'),
    ADD CONSTRAINT ck_canvas_workflow_runs_node_metrics CHECK (jsonb_typeof(node_metrics) = 'array'),
    ADD CONSTRAINT ck_canvas_workflow_runs_total_cost CHECK (total_cost_cents >= 0);

CREATE INDEX ix_canvas_workflow_runs_user_project_started
    ON canvas_workflow_runs (user_id, project_id, started_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS ix_canvas_workflow_runs_user_project_started;
ALTER TABLE canvas_workflow_runs
    DROP CONSTRAINT IF EXISTS ck_canvas_workflow_runs_total_cost,
    DROP CONSTRAINT IF EXISTS ck_canvas_workflow_runs_node_metrics,
    DROP CONSTRAINT IF EXISTS ck_canvas_workflow_runs_input_values,
    DROP CONSTRAINT IF EXISTS ck_canvas_workflow_runs_project_revision,
    DROP COLUMN IF EXISTS error_node_id,
    DROP COLUMN IF EXISTS retry_of_run_id,
    DROP COLUMN IF EXISTS total_cost_cents,
    DROP COLUMN IF EXISTS node_metrics,
    DROP COLUMN IF EXISTS input_values,
    DROP COLUMN IF EXISTS project_version_id,
    DROP COLUMN IF EXISTS project_revision;

ALTER TABLE canvas_projects
    DROP CONSTRAINT IF EXISTS fk_canvas_projects_published_version,
    DROP COLUMN IF EXISTS published_version_id;

DROP TABLE IF EXISTS canvas_project_versions;
