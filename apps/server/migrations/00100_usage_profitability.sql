-- +goose Up
CREATE TABLE usage_profit_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type text NOT NULL,
    source_id text NOT NULL,
    billing_generation integer NOT NULL DEFAULT 0,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    event_status text NOT NULL,
    workspace text NOT NULL DEFAULT '',
    provider_id text NOT NULL DEFAULT '',
    route_id text NOT NULL DEFAULT '',
    model_id text NOT NULL DEFAULT '',
    units integer NOT NULL DEFAULT 1,
    revenue_cents bigint NOT NULL DEFAULT 0,
    upstream_cost_cents bigint NOT NULL DEFAULT 0,
    gross_profit_cents bigint GENERATED ALWAYS AS (revenue_cents - upstream_cost_cents) STORED,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_usage_profit_source CHECK (source_type IN ('task','assistant_run')),
    CONSTRAINT ck_usage_profit_status CHECK (event_status IN ('succeeded','failed','canceled')),
    CONSTRAINT ck_usage_profit_generation CHECK (billing_generation >= 0),
    CONSTRAINT ck_usage_profit_units CHECK (units >= 0),
    CONSTRAINT ck_usage_profit_revenue CHECK (revenue_cents >= 0),
    CONSTRAINT ck_usage_profit_upstream_cost CHECK (upstream_cost_cents >= 0),
    CONSTRAINT ck_usage_profit_metadata CHECK (jsonb_typeof(metadata) = 'object'),
    UNIQUE (source_type, source_id, billing_generation)
);

CREATE INDEX usage_profit_ledger_created_idx ON usage_profit_ledger (created_at DESC, id DESC);
CREATE INDEX usage_profit_ledger_model_created_idx ON usage_profit_ledger (model_id, created_at DESC);
CREATE INDEX usage_profit_ledger_provider_created_idx ON usage_profit_ledger (provider_id, created_at DESC);
CREATE INDEX usage_profit_ledger_user_created_idx ON usage_profit_ledger (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS usage_profit_ledger;
