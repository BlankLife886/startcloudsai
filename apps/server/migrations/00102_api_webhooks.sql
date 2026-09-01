-- +goose Up
CREATE TABLE api_webhook_endpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label varchar(80) NOT NULL,
    url text NOT NULL,
    secret_encrypted text NOT NULL,
    events text[] NOT NULL DEFAULT ARRAY['task.succeeded','task.failed','task.canceled']::text[],
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_webhook_endpoints_user_idx ON api_webhook_endpoints (user_id, created_at DESC);

CREATE TABLE api_webhook_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id uuid NOT NULL REFERENCES api_webhook_endpoints(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    source_id text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_by text,
    locked_until timestamptz,
    response_status integer,
    response_body text,
    last_error text,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_api_webhook_delivery_status CHECK (status IN ('pending','delivered','dead')),
    CONSTRAINT ck_api_webhook_delivery_payload CHECK (jsonb_typeof(payload) = 'object'),
    UNIQUE (endpoint_id, event_type, source_id)
);
CREATE INDEX api_webhook_deliveries_ready_idx ON api_webhook_deliveries (next_attempt_at, created_at)
    WHERE status = 'pending';
CREATE INDEX api_webhook_deliveries_user_created_idx ON api_webhook_deliveries (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS api_webhook_deliveries;
DROP TABLE IF EXISTS api_webhook_endpoints;
