-- +goose Up
ALTER TABLE gallery_submissions
    ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE gallery_submissions
    DROP COLUMN IF EXISTS tags;
