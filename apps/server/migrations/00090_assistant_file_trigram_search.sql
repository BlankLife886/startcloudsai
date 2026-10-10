-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX assistant_file_segments_content_trgm_idx
    ON assistant_file_segments USING gin (content gin_trgm_ops);

-- +goose Down
DROP INDEX IF EXISTS assistant_file_segments_content_trgm_idx;
