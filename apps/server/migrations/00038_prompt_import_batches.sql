-- +goose Up
ALTER TABLE prompt_library
    ADD COLUMN new_until timestamptz,
    ADD COLUMN content_fingerprint text NOT NULL DEFAULT '';

UPDATE prompt_library
SET new_until = created_at + interval '24 hours'
WHERE created_at >= now() - interval '24 hours';

UPDATE prompt_library
SET content_fingerprint = encode(digest(lower(regexp_replace(trim(prompt), '\s+', ' ', 'g')), 'sha256'), 'hex')
WHERE content_fingerprint = '';

CREATE INDEX ix_prompt_library_new_until
    ON prompt_library (new_until DESC, id DESC)
    WHERE active AND new_until IS NOT NULL;
CREATE INDEX ix_prompt_library_fingerprint
    ON prompt_library (content_fingerprint)
    WHERE content_fingerprint <> '';

CREATE TABLE prompt_import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'fetching'
        CHECK (status IN ('fetching','review','publishing','completed','failed')),
    analysis_mode text NOT NULL DEFAULT 'rules'
        CHECK (analysis_mode IN ('manual','rules','ai')),
    source_count integer NOT NULL DEFAULT 0,
    fetched_count integer NOT NULL DEFAULT 0,
    unique_count integer NOT NULL DEFAULT 0,
    duplicate_count integer NOT NULL DEFAULT 0,
    approved_count integer NOT NULL DEFAULT 0,
    rejected_count integer NOT NULL DEFAULT 0,
    imported_count integer NOT NULL DEFAULT 0,
    updated_count integer NOT NULL DEFAULT 0,
    failed_source_count integer NOT NULL DEFAULT 0,
    error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    analyzed_at timestamptz,
    completed_at timestamptz
);
CREATE INDEX ix_prompt_import_batches_created
    ON prompt_import_batches (created_at DESC, id DESC);

CREATE TABLE prompt_import_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES prompt_import_batches(id) ON DELETE CASCADE,
    source_id text NOT NULL DEFAULT '',
    source_name text NOT NULL DEFAULT '',
    source_item_key text NOT NULL DEFAULT '',
    title text NOT NULL,
    prompt text NOT NULL,
    task_type text NOT NULL
        CHECK (task_type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle')),
    category text NOT NULL DEFAULT 'other',
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    cover_key text,
    content_fingerprint text NOT NULL,
    duplicate_kind text NOT NULL DEFAULT 'none'
        CHECK (duplicate_kind IN ('none','batch','library','possible')),
    duplicate_ref_id uuid,
    duplicate_title text NOT NULL DEFAULT '',
    duplicate_action text NOT NULL DEFAULT 'keep'
        CHECK (duplicate_action IN ('pending','keep','drop')),
    compliance_status text NOT NULL DEFAULT 'pending'
        CHECK (compliance_status IN ('pending','safe','blocked')),
    compliance_reason text NOT NULL DEFAULT '',
    review_status text NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','approved','rejected')),
    review_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_prompt_import_items_batch_review
    ON prompt_import_items (batch_id, review_status, duplicate_action, created_at ASC);
CREATE INDEX ix_prompt_import_items_batch_duplicate
    ON prompt_import_items (batch_id, duplicate_kind, duplicate_action, created_at ASC);
CREATE INDEX ix_prompt_import_items_fingerprint
    ON prompt_import_items (content_fingerprint);

-- +goose Down
DROP TABLE IF EXISTS prompt_import_items;
DROP TABLE IF EXISTS prompt_import_batches;
DROP INDEX IF EXISTS ix_prompt_library_fingerprint;
DROP INDEX IF EXISTS ix_prompt_library_new_until;
ALTER TABLE prompt_library
    DROP COLUMN IF EXISTS content_fingerprint,
    DROP COLUMN IF EXISTS new_until;
