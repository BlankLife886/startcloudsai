-- +goose Up
ALTER TABLE announcements
    ADD COLUMN config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- +goose Down
ALTER TABLE announcements DROP COLUMN IF EXISTS config;
