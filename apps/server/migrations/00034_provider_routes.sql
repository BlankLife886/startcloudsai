-- +goose Up
CREATE INDEX ix_tasks_running_provider_route
    ON tasks ((COALESCE(params ->> '_providerRouteKey', params ->> '_providerConfigId')))
    WHERE status = 'running';

CREATE INDEX ix_tasks_async_pending_provider_route
    ON tasks ((COALESCE(params ->> '_providerRouteKey', params ->> '_providerConfigId')), started_at)
    WHERE status = 'running' AND params ->> '_upstreamStage' = 'async_pending';

-- +goose Down
DROP INDEX IF EXISTS ix_tasks_async_pending_provider_route;
DROP INDEX IF EXISTS ix_tasks_running_provider_route;
