-- +goose Up
CREATE INDEX ix_tasks_running_provider
    ON tasks ((params ->> '_providerConfigId'))
    WHERE status = 'running';

-- +goose Down
DROP INDEX IF EXISTS ix_tasks_running_provider;
