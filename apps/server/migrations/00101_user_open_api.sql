-- +goose Up
CREATE TABLE user_api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_prefix varchar(20) NOT NULL,
    key_hash varchar(64) NOT NULL UNIQUE,
    label varchar(80) NOT NULL,
    status text NOT NULL DEFAULT 'active',
    scopes text[] NOT NULL DEFAULT ARRAY['models:read','files:write','tasks:write','tasks:read']::text[],
    allowed_model_ids text[] NOT NULL DEFAULT '{}'::text[],
    daily_task_limit integer NOT NULL DEFAULT 100,
    monthly_task_limit integer NOT NULL DEFAULT 2000,
    daily_spend_limit_cents bigint NOT NULL DEFAULT 10000,
    monthly_spend_limit_cents bigint NOT NULL DEFAULT 200000,
    expires_at timestamptz,
    last_used_at timestamptz,
    last_used_ip text,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_api_key_status CHECK (status IN ('active','revoked')),
    CONSTRAINT ck_user_api_key_limits CHECK (
        daily_task_limit BETWEEN 1 AND 100000
        AND monthly_task_limit BETWEEN 1 AND 1000000
        AND daily_spend_limit_cents BETWEEN 1 AND 1000000000
        AND monthly_spend_limit_cents BETWEEN 1 AND 10000000000
    )
);
CREATE INDEX user_api_keys_user_created_idx ON user_api_keys (user_id, created_at DESC);

CREATE TABLE api_key_usage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id uuid REFERENCES user_api_keys(id) ON DELETE SET NULL,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
    model_id text NOT NULL DEFAULT '',
    reserved_cents bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_api_key_usage_reserved CHECK (reserved_cents >= 0),
    UNIQUE (task_id)
);
CREATE INDEX api_key_usage_key_created_idx ON api_key_usage_events (api_key_id, created_at DESC);
CREATE INDEX api_key_usage_user_created_idx ON api_key_usage_events (user_id, created_at DESC);

ALTER TABLE usage_profit_ledger ADD COLUMN api_key_id uuid REFERENCES user_api_keys(id) ON DELETE SET NULL;
CREATE INDEX usage_profit_ledger_api_key_created_idx ON usage_profit_ledger (api_key_id, created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS usage_profit_ledger_api_key_created_idx;
ALTER TABLE usage_profit_ledger DROP COLUMN IF EXISTS api_key_id;
DROP TABLE IF EXISTS api_key_usage_events;
DROP TABLE IF EXISTS user_api_keys;
