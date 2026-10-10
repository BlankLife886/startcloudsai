-- +goose Up
ALTER TABLE assistant_runs
    ADD COLUMN idempotency_key varchar(160),
    ADD COLUMN request_fingerprint varchar(64),
    ADD COLUMN attempt integer NOT NULL DEFAULT 0,
    ADD COLUMN lease_owner text,
    ADD COLUMN lease_until timestamptz,
    ADD COLUMN heartbeat_at timestamptz,
    ADD CONSTRAINT ck_assistant_runs_attempt_nonneg CHECK (attempt >= 0),
    ADD CONSTRAINT ck_assistant_runs_idempotency_pair CHECK (
        (idempotency_key IS NULL AND request_fingerprint IS NULL)
        OR (idempotency_key IS NOT NULL AND request_fingerprint IS NOT NULL)
    );

CREATE UNIQUE INDEX assistant_runs_user_idempotency_idx
    ON assistant_runs (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX assistant_runs_expired_lease_idx
    ON assistant_runs (lease_until, id)
    WHERE status = 'running';

-- Give binaries deployed before this migration time to finish. New workers use
-- short renewable leases after claiming queued runs.
UPDATE assistant_runs
SET lease_owner = 'pre-reliability-migration',
    heartbeat_at = now(),
    lease_until = now() + interval '15 minutes'
WHERE status = 'running';

CREATE TABLE assistant_run_outbox (
    run_id uuid PRIMARY KEY REFERENCES assistant_runs(id) ON DELETE CASCADE,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_run_outbox_ready_idx
    ON assistant_run_outbox (next_attempt_at, created_at, run_id);

INSERT INTO assistant_run_outbox (run_id)
SELECT id FROM assistant_runs WHERE status = 'queued'
ON CONFLICT (run_id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS assistant_run_outbox;
DROP INDEX IF EXISTS assistant_runs_expired_lease_idx;
DROP INDEX IF EXISTS assistant_runs_user_idempotency_idx;

ALTER TABLE assistant_runs
    DROP CONSTRAINT IF EXISTS ck_assistant_runs_idempotency_pair,
    DROP CONSTRAINT IF EXISTS ck_assistant_runs_attempt_nonneg,
    DROP COLUMN IF EXISTS heartbeat_at,
    DROP COLUMN IF EXISTS lease_until,
    DROP COLUMN IF EXISTS lease_owner,
    DROP COLUMN IF EXISTS attempt,
    DROP COLUMN IF EXISTS request_fingerprint,
    DROP COLUMN IF EXISTS idempotency_key;
