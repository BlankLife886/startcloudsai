-- +goose Up
CREATE TABLE task_upstream_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    task_attempt integer NOT NULL,
    provider_id text NOT NULL,
    route_id text NOT NULL DEFAULT '',
    route_key text NOT NULL,
    adapter text NOT NULL,
    upstream_model text NOT NULL DEFAULT '',
    base_url text NOT NULL DEFAULT '',
    api_key_encrypted text NOT NULL DEFAULT '',
    timeout_secs integer NOT NULL DEFAULT 300,
    max_concurrency integer NOT NULL DEFAULT 1,
    upstream_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'pending',
    submitted_at timestamptz NOT NULL DEFAULT now(),
    failover_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    failover_scheduled_at timestamptz,
    last_polled_at timestamptz,
    last_error text NOT NULL DEFAULT '',
    poll_owner text,
    poll_lease_until timestamptz,
    finished_at timestamptz,
    CONSTRAINT uq_task_upstream_attempt UNIQUE (task_id, task_attempt, route_key),
    CONSTRAINT ck_task_upstream_attempt_status CHECK (status IN ('submitting', 'pending', 'succeeded', 'failed', 'expired', 'superseded')),
    CONSTRAINT ck_task_upstream_attempt_times CHECK (failover_at <= expires_at)
);

CREATE INDEX ix_task_upstream_attempts_route_pending
    ON task_upstream_attempts (route_key, submitted_at)
    WHERE status IN ('submitting', 'pending');

CREATE INDEX ix_task_upstream_attempts_task_active
    ON task_upstream_attempts (task_id, status);

-- Preserve async work created by the previous worker version during a rolling
-- deployment. OpenAI-compatible jobs use the local task UUID upstream; CRUN
-- IDs were already persisted in task params.
INSERT INTO task_upstream_attempts (
    task_id, task_attempt, provider_id, route_id, route_key, adapter,
    upstream_model, upstream_task_ids, status, submitted_at, failover_at, expires_at
)
SELECT
    id,
    attempt,
    COALESCE(params->>'_providerConfigId', ''),
    COALESCE(params->>'_providerRouteId', ''),
    COALESCE(params->>'_providerRouteKey', params->>'_providerConfigId', ''),
    COALESCE(params->>'_serviceProvider', 'openai'),
    model,
    CASE
        WHEN jsonb_typeof(params->'_crunTaskIds') = 'array' THEN params->'_crunTaskIds'
        ELSE jsonb_build_array(id::text)
    END,
    'pending',
    COALESCE(started_at, created_at),
    COALESCE(started_at, created_at) + interval '5 minutes',
    COALESCE(started_at, created_at) + interval '30 minutes'
FROM tasks
WHERE status = 'running'
  AND params->>'_upstreamStage' = 'async_pending'
  AND COALESCE(params->>'_providerRouteKey', params->>'_providerConfigId', '') <> ''
ON CONFLICT ON CONSTRAINT uq_task_upstream_attempt DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS task_upstream_attempts;
