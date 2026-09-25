-- +goose Up
-- 提交请求超时（结果不确定）后，上游若始终回答"不知道这个任务"，说明它没有收到请求；
-- 记录这三个事实，让轮询无需等满线路超时就能提前重提或失败。仅新增可空/有默认值的列，
-- 与旧版本 worker 兼容。
ALTER TABLE task_upstream_attempts
    ADD COLUMN IF NOT EXISTS submit_unconfirmed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS upstream_seen_at timestamptz,
    ADD COLUMN IF NOT EXISTS upstream_missing_since timestamptz;

-- +goose Down
ALTER TABLE task_upstream_attempts
    DROP COLUMN IF EXISTS upstream_missing_since,
    DROP COLUMN IF EXISTS upstream_seen_at,
    DROP COLUMN IF EXISTS submit_unconfirmed;
