-- +goose Up
ALTER TABLE user_upload_objects
    ADD COLUMN size_bytes bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_user_upload_objects_size_bytes CHECK (size_bytes >= 0);

CREATE INDEX ix_user_upload_objects_user_live_size
    ON user_upload_objects (user_id)
    INCLUDE (size_bytes)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS ix_user_upload_objects_user_live_size;
ALTER TABLE user_upload_objects
    DROP CONSTRAINT IF EXISTS ck_user_upload_objects_size_bytes,
    DROP COLUMN IF EXISTS size_bytes;
