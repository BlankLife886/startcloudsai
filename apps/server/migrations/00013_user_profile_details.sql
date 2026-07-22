-- +goose Up
ALTER TABLE users
    ADD COLUMN bio text NOT NULL DEFAULT '',
    ADD COLUMN location text NOT NULL DEFAULT '',
    ADD COLUMN website_url text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE users
    DROP COLUMN IF EXISTS website_url,
    DROP COLUMN IF EXISTS location,
    DROP COLUMN IF EXISTS bio;
