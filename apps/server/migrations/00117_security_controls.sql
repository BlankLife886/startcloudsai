-- +goose Up
ALTER TABLE user_api_keys DROP CONSTRAINT ck_user_api_key_status;
ALTER TABLE user_api_keys
    ADD COLUMN ip_allowlist text[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN rate_limit_per_minute integer NOT NULL DEFAULT 120,
    ADD COLUMN daily_byte_limit bigint NOT NULL DEFAULT 2147483648,
    ADD COLUMN auto_frozen_at timestamptz,
    ADD COLUMN freeze_reason text,
    ADD CONSTRAINT ck_user_api_key_status CHECK (status IN ('active','frozen','revoked')),
    ADD CONSTRAINT ck_user_api_key_security_limits CHECK (
        rate_limit_per_minute BETWEEN 1 AND 10000
        AND daily_byte_limit BETWEEN 1048576 AND 1099511627776
    );

CREATE TABLE api_key_access_events (
    id bigserial PRIMARY KEY,
    api_key_id uuid REFERENCES user_api_keys(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    client_ip inet,
    method text NOT NULL,
    route text NOT NULL,
    status_code integer NOT NULL,
    request_bytes bigint NOT NULL DEFAULT 0,
    response_bytes bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_api_key_access_sizes CHECK (request_bytes >= 0 AND response_bytes >= 0)
);
CREATE INDEX api_key_access_key_created_idx ON api_key_access_events (api_key_id, created_at DESC);
CREATE INDEX api_key_access_user_created_idx ON api_key_access_events (user_id, created_at DESC);

CREATE TABLE security_risk_events (
    id bigserial PRIMARY KEY,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    api_key_id uuid REFERENCES user_api_keys(id) ON DELETE SET NULL,
    client_ip inet,
    category text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    score integer NOT NULL DEFAULT 0,
    action text NOT NULL DEFAULT 'observed',
    reason text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    resolved_at timestamptz,
    resolved_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    resolution_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_security_risk_severity CHECK (severity IN ('low','medium','high','critical')),
    CONSTRAINT ck_security_risk_action CHECK (action IN ('observed','limited','blocked','key_frozen')),
    CONSTRAINT ck_security_risk_score CHECK (score BETWEEN 0 AND 100)
);
CREATE INDEX security_risk_created_idx ON security_risk_events (created_at DESC);
CREATE INDEX security_risk_unresolved_idx ON security_risk_events (severity, created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX security_risk_user_idx ON security_risk_events (user_id, created_at DESC) WHERE user_id IS NOT NULL;

CREATE TABLE security_blocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type text NOT NULL,
    subject_value text NOT NULL,
    scope text NOT NULL DEFAULT '*',
    reason text NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_security_block_subject CHECK (subject_type IN ('user','api_key','ip'))
);
CREATE UNIQUE INDEX security_blocks_active_unique_idx
    ON security_blocks (subject_type, subject_value, scope)
    WHERE revoked_at IS NULL;
CREATE INDEX security_blocks_lookup_idx ON security_blocks (subject_type, subject_value, scope, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE upload_hash_blocklist (
    sha256 char(64) PRIMARY KEY,
    reason text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_upload_hash_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE payment_callback_events (
    id bigserial PRIMARY KEY,
    fingerprint char(64) NOT NULL UNIQUE,
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    provider_order_id text,
    amount_cents bigint,
    paid_amount_cents bigint,
    client_ip inet,
    signature_valid boolean NOT NULL DEFAULT false,
    outcome text NOT NULL,
    detail text,
    replay_count integer NOT NULL DEFAULT 0,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_callback_order_created_idx ON payment_callback_events (order_id, created_at DESC);

CREATE TABLE payment_reconciliations (
    id bigserial PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
    provider text NOT NULL,
    local_status text NOT NULL,
    provider_state integer,
    expected_amount_cents bigint NOT NULL,
    provider_amount_cents bigint,
    provider_paid_amount_cents bigint,
    outcome text NOT NULL,
    detail text,
    checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_reconciliation_checked_idx ON payment_reconciliations (checked_at DESC);
CREATE INDEX payment_reconciliation_issue_idx ON payment_reconciliations (outcome, checked_at DESC)
    WHERE outcome <> 'matched';

-- +goose Down
DROP TABLE IF EXISTS payment_reconciliations;
DROP TABLE IF EXISTS payment_callback_events;
DROP TABLE IF EXISTS upload_hash_blocklist;
DROP TABLE IF EXISTS security_blocks;
DROP TABLE IF EXISTS security_risk_events;
DROP TABLE IF EXISTS api_key_access_events;
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS ck_user_api_key_security_limits;
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS ck_user_api_key_status;
ALTER TABLE user_api_keys
    DROP COLUMN IF EXISTS freeze_reason,
    DROP COLUMN IF EXISTS auto_frozen_at,
    DROP COLUMN IF EXISTS daily_byte_limit,
    DROP COLUMN IF EXISTS rate_limit_per_minute,
    DROP COLUMN IF EXISTS ip_allowlist,
    ADD CONSTRAINT ck_user_api_key_status CHECK (status IN ('active','revoked'));
