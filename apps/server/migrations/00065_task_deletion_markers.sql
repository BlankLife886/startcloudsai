-- +goose Up
ALTER TABLE tasks
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deletion_actor text,
    ADD COLUMN deleted_output_count integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_tasks_deletion_actor
        CHECK (deletion_actor IS NULL OR deletion_actor IN ('user', 'admin', 'system')),
    ADD CONSTRAINT ck_tasks_deleted_output_count CHECK (deleted_output_count >= 0),
    ADD CONSTRAINT ck_tasks_deletion_marker
        CHECK ((deleted_at IS NULL) = (deletion_actor IS NULL));

CREATE INDEX ix_tasks_user_created_visible
    ON tasks (user_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS ix_tasks_user_created_visible;
ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS ck_tasks_deletion_marker,
    DROP CONSTRAINT IF EXISTS ck_tasks_deleted_output_count,
    DROP CONSTRAINT IF EXISTS ck_tasks_deletion_actor,
    DROP COLUMN IF EXISTS deleted_output_count,
    DROP COLUMN IF EXISTS deletion_actor,
    DROP COLUMN IF EXISTS deleted_at;
