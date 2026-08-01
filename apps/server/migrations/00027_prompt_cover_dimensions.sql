-- +goose Up
ALTER TABLE prompt_library
    ADD COLUMN cover_width integer,
    ADD COLUMN cover_height integer,
    ADD COLUMN cover_metadata_checked_at timestamptz;

ALTER TABLE prompt_library
    ADD CONSTRAINT prompt_library_cover_dimensions_valid CHECK (
        (cover_width IS NULL AND cover_height IS NULL)
        OR (cover_width > 0 AND cover_height > 0)
    );

-- +goose Down
ALTER TABLE prompt_library
    DROP CONSTRAINT IF EXISTS prompt_library_cover_dimensions_valid,
    DROP COLUMN IF EXISTS cover_metadata_checked_at,
    DROP COLUMN IF EXISTS cover_height,
    DROP COLUMN IF EXISTS cover_width;
