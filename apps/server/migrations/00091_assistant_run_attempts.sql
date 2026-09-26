-- +goose Up
CREATE TABLE assistant_run_attempts (
    run_id uuid NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    attempt integer NOT NULL CHECK (attempt > 0),
    status varchar(20) NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'succeeded', 'failed', 'requeued', 'canceled', 'interrupted', 'superseded')),
    lease_owner text,
    provider_route_key text,
    provider_name text,
    model text,
    requested_mode varchar(20) NOT NULL,
    resolved_mode varchar(20) NOT NULL DEFAULT '',
    error_code text,
    error_message text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    PRIMARY KEY (run_id, attempt)
);

CREATE INDEX assistant_run_attempts_status_started_idx
    ON assistant_run_attempts (status, started_at DESC);
CREATE INDEX assistant_run_attempts_route_started_idx
    ON assistant_run_attempts (provider_route_key, started_at DESC)
    WHERE provider_route_key IS NOT NULL;

-- +goose Down
DROP TABLE IF EXISTS assistant_run_attempts;
