-- +goose Up
CREATE TABLE canvas_projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL,
    document jsonb NOT NULL DEFAULT '{"version":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_canvas_projects_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT ck_canvas_projects_revision_positive CHECK (revision >= 1),
    CONSTRAINT ck_canvas_projects_document_object CHECK (jsonb_typeof(document) = 'object')
);
CREATE INDEX ix_canvas_projects_user_updated ON canvas_projects (user_id, updated_at DESC, id DESC);

-- +goose Down
DROP TABLE IF EXISTS canvas_projects;
