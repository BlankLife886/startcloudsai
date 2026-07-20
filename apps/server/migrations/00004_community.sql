-- +goose Up
CREATE TABLE prompt_library (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    prompt text NOT NULL,
    task_type text NOT NULL,
    category text,
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    cover_key text,
    sort integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_prompt_library_task_type CHECK (task_type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle'))
);
CREATE INDEX ix_prompt_library_active_created ON prompt_library (active, created_at DESC);

CREATE TABLE gallery_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    sort integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gallery_submissions
    ADD COLUMN featured boolean NOT NULL DEFAULT false,
    ADD COLUMN category_id uuid REFERENCES gallery_categories(id) ON DELETE SET NULL,
    ADD COLUMN sort integer NOT NULL DEFAULT 0;
CREATE INDEX ix_gallery_submissions_featured ON gallery_submissions (featured, created_at DESC) WHERE featured;
CREATE INDEX ix_gallery_submissions_category ON gallery_submissions (category_id, created_at DESC) WHERE category_id IS NOT NULL;
CREATE INDEX ix_gallery_submissions_user_created ON gallery_submissions (user_id, created_at DESC);

ALTER TABLE users ADD COLUMN submission_banned_until timestamptz;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS submission_banned_until;
DROP INDEX IF EXISTS ix_gallery_submissions_user_created;
ALTER TABLE gallery_submissions
    DROP COLUMN IF EXISTS sort,
    DROP COLUMN IF EXISTS category_id,
    DROP COLUMN IF EXISTS featured;
DROP TABLE IF EXISTS gallery_categories;
DROP TABLE IF EXISTS prompt_library;
