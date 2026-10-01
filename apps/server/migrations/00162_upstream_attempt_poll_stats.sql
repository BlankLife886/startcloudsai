-- +goose Up
-- 上游异步任务的轮询统计：上游早已完成、本端却迟迟没取到时，用于定位是查询失败还是其他原因。
-- 仅新增有默认值/可空的列，与旧版本 worker 兼容。
ALTER TABLE task_upstream_attempts
    ADD COLUMN IF NOT EXISTS poll_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS poll_error_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_poll_error text,
    ADD COLUMN IF NOT EXISTS last_poll_error_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_poll_ms integer;

-- +goose Down
ALTER TABLE task_upstream_attempts
    DROP COLUMN IF EXISTS last_poll_ms,
    DROP COLUMN IF EXISTS last_poll_error_at,
    DROP COLUMN IF EXISTS last_poll_error,
    DROP COLUMN IF EXISTS poll_error_count,
    DROP COLUMN IF EXISTS poll_count;
