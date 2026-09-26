-- +goose Up
CREATE TABLE user_asset_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(64) NOT NULL,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_asset_groups_name_length CHECK (char_length(name) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX user_asset_groups_user_name_uidx
    ON user_asset_groups (user_id, lower(name));

CREATE INDEX user_asset_groups_user_sort_idx
    ON user_asset_groups (user_id, sort ASC, created_at ASC, id ASC);

ALTER TABLE user_assets
    ADD COLUMN group_id uuid REFERENCES user_asset_groups(id) ON DELETE SET NULL;

CREATE INDEX user_assets_user_group_created_idx
    ON user_assets (user_id, group_id, created_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS user_assets_user_group_created_idx;
ALTER TABLE user_assets DROP COLUMN IF EXISTS group_id;
DROP TABLE IF EXISTS user_asset_groups;
