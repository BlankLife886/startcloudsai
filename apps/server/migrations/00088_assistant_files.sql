-- +goose Up
CREATE TABLE assistant_files (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_key text NOT NULL UNIQUE REFERENCES user_upload_objects(object_key) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    content_type varchar(120) NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    sha256 varchar(64) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
    parser_version varchar(40) NOT NULL DEFAULT '',
    page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
    char_count integer NOT NULL DEFAULT 0 CHECK (char_count >= 0),
    segment_count integer NOT NULL DEFAULT 0 CHECK (segment_count >= 0),
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    lease_owner text,
    lease_until timestamptz,
    error_code text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE INDEX assistant_files_user_created_idx
    ON assistant_files (user_id, created_at DESC, id DESC);
CREATE INDEX assistant_files_ingestion_idx
    ON assistant_files (status, lease_until, created_at, id)
    WHERE status IN ('queued', 'processing');

CREATE TABLE assistant_file_segments (
    id bigserial PRIMARY KEY,
    file_id uuid NOT NULL REFERENCES assistant_files(id) ON DELETE CASCADE,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    locator jsonb NOT NULL DEFAULT '{}'::jsonb,
    content text NOT NULL CHECK (content <> ''),
    search_text tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (file_id, ordinal)
);

CREATE INDEX assistant_file_segments_search_idx
    ON assistant_file_segments USING gin (search_text);

ALTER TABLE user_upload_references
    DROP CONSTRAINT user_upload_references_reference_type_check;

ALTER TABLE user_upload_references
    ADD CONSTRAINT user_upload_references_reference_type_check
    CHECK (reference_type IN (
        'task_input',
        'user_asset',
        'user_avatar',
        'assistant_message',
        'assistant_run',
        'user_studio_figure',
        'assistant_file'
    ));

-- +goose Down
ALTER TABLE user_upload_references
    DROP CONSTRAINT user_upload_references_reference_type_check;

ALTER TABLE user_upload_references
    ADD CONSTRAINT user_upload_references_reference_type_check
    CHECK (reference_type IN (
        'task_input',
        'user_asset',
        'user_avatar',
        'assistant_message',
        'assistant_run',
        'user_studio_figure'
    ));

DROP TABLE IF EXISTS assistant_file_segments;
DROP TABLE IF EXISTS assistant_files;
