-- +goose Up
CREATE INDEX ix_tasks_async_pending_provider
    ON tasks ((params ->> '_providerConfigId'), started_at)
    WHERE status = 'running' AND params ->> '_upstreamStage' = 'async_pending';

-- +goose Down
DROP INDEX IF EXISTS ix_tasks_async_pending_provider;
