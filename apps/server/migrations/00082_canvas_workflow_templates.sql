-- +goose Up
CREATE TABLE canvas_workflow_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    category text NOT NULL,
    category_label text NOT NULL,
    industry text NOT NULL DEFAULT '',
    summary text NOT NULL DEFAULT '',
    platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
    deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
    accent text NOT NULL DEFAULT '#6d5cff',
    document jsonb NOT NULL,
    node_count integer NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_canvas_workflow_templates_platforms CHECK (jsonb_typeof(platforms) = 'array'),
    CONSTRAINT ck_canvas_workflow_templates_deliverables CHECK (jsonb_typeof(deliverables) = 'array'),
    CONSTRAINT ck_canvas_workflow_templates_document CHECK (jsonb_typeof(document) = 'object'),
    CONSTRAINT ck_canvas_workflow_templates_node_count CHECK (node_count BETWEEN 1 AND 1000)
);

CREATE INDEX ix_canvas_workflow_templates_public
    ON canvas_workflow_templates (sort, created_at DESC)
    WHERE enabled = true;

-- +goose Down
DROP TABLE IF EXISTS canvas_workflow_templates;
