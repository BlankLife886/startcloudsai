-- +goose Up
ALTER TABLE user_assets
    ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
    ADD COLUMN content_hash text,
    ADD COLUMN source_type text NOT NULL DEFAULT 'upload',
    ADD COLUMN source_id text,
    ADD COLUMN source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN parent_asset_id uuid REFERENCES user_assets(id) ON DELETE SET NULL,
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD CONSTRAINT ck_user_assets_tags_count CHECK (cardinality(tags) <= 30),
    ADD CONSTRAINT ck_user_assets_source_metadata_object CHECK (jsonb_typeof(source_metadata) = 'object');

CREATE INDEX user_assets_active_search_idx
    ON user_assets (user_id, group_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX user_assets_trash_idx
    ON user_assets (user_id, deleted_at DESC, id DESC)
    WHERE deleted_at IS NOT NULL;
CREATE INDEX user_assets_tags_gin_idx ON user_assets USING gin (tags);
CREATE INDEX user_assets_content_hash_idx
    ON user_assets (user_id, content_hash)
    WHERE content_hash IS NOT NULL;
CREATE INDEX user_assets_parent_idx ON user_assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS user_assets_parent_idx;
DROP INDEX IF EXISTS user_assets_content_hash_idx;
DROP INDEX IF EXISTS user_assets_tags_gin_idx;
DROP INDEX IF EXISTS user_assets_trash_idx;
DROP INDEX IF EXISTS user_assets_active_search_idx;
ALTER TABLE user_assets
    DROP CONSTRAINT IF EXISTS ck_user_assets_source_metadata_object,
    DROP CONSTRAINT IF EXISTS ck_user_assets_tags_count,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS parent_asset_id,
    DROP COLUMN IF EXISTS source_metadata,
    DROP COLUMN IF EXISTS source_id,
    DROP COLUMN IF EXISTS source_type,
    DROP COLUMN IF EXISTS content_hash,
    DROP COLUMN IF EXISTS tags;
