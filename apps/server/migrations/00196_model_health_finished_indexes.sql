-- +goose NO TRANSACTION

-- +goose Up
-- 模型状态按完成时间统计所有终态（成功/失败/取消），已有的
-- ix_*_succeeded_finished 只覆盖成功，这里补全终态索引。
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tasks_finished
    ON tasks (finished_at)
    WHERE finished_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_assistant_runs_finished
    ON assistant_runs (finished_at)
    WHERE finished_at IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS ix_assistant_runs_finished;
DROP INDEX CONCURRENTLY IF EXISTS ix_tasks_finished;
