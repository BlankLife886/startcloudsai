-- +goose Up
CREATE INDEX ix_tasks_user_active
    ON tasks (user_id)
    WHERE status IN ('queued', 'running');

CREATE INDEX ix_tasks_user_running
    ON tasks (user_id)
    WHERE status = 'running';

CREATE INDEX ix_tasks_queued_created_partial
    ON tasks (created_at)
    WHERE status = 'queued';

CREATE INDEX ix_tasks_running_started_partial
    ON tasks (started_at)
    WHERE status = 'running';

-- +goose Down
DROP INDEX IF EXISTS ix_tasks_running_started_partial;
DROP INDEX IF EXISTS ix_tasks_queued_created_partial;
DROP INDEX IF EXISTS ix_tasks_user_running;
DROP INDEX IF EXISTS ix_tasks_user_active;
