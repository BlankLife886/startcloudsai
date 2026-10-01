-- +goose Up
ALTER TABLE changelog_entries
    ADD COLUMN IF NOT EXISTS source_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_changelog_entries_source_key
    ON changelog_entries (source_key);

CREATE TABLE changelog_seed_versions (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS changelog_seed_versions;
DROP INDEX IF EXISTS uq_changelog_entries_source_key;
ALTER TABLE changelog_entries DROP COLUMN IF EXISTS source_key;
