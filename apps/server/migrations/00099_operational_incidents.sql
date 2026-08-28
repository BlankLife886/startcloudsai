-- +goose Up
CREATE TABLE operational_incidents (
    incident_key text PRIMARY KEY,
    severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
    title text NOT NULL,
    summary text NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    occurrences bigint NOT NULL DEFAULT 1 CHECK (occurrences > 0),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    resolved_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_operational_incidents_status_seen
    ON operational_incidents (status, last_seen_at DESC);

-- +goose Down
DROP TABLE IF EXISTS operational_incidents;
