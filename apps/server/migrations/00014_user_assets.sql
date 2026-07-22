-- +goose Up
CREATE TABLE user_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title varchar(120) NOT NULL,
    file_key text NOT NULL,
    thumbnail_key text NOT NULL,
    content_type varchar(80) NOT NULL DEFAULT 'image/jpeg',
    size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, file_key)
);

CREATE INDEX user_assets_user_created_idx
    ON user_assets (user_id, created_at DESC, id DESC);

-- +goose Down
DROP TABLE IF EXISTS user_assets;
