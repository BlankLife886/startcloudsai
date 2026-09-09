-- +goose NO TRANSACTION

-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tasks_succeeded_finished
    ON tasks (finished_at)
    WHERE status = 'succeeded';

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_assistant_runs_succeeded_finished
    ON assistant_runs (finished_at)
    WHERE status = 'succeeded';

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS ix_assistant_runs_succeeded_finished;
DROP INDEX CONCURRENTLY IF EXISTS ix_tasks_succeeded_finished;
