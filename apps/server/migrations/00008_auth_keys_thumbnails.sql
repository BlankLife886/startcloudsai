-- +goose Up
CREATE TABLE user_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    subject text NOT NULL,
    email citext NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_identities_provider CHECK (provider IN ('github','google')),
    UNIQUE (provider, subject)
);
CREATE INDEX ix_user_identities_user_id ON user_identities (user_id);

CREATE TABLE email_login_codes (
    email citext PRIMARY KEY,
    code_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    requested_ip text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_login_states (
    state_hash text PRIMARY KEY,
    provider text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_oauth_login_states_provider CHECK (provider IN ('github','google'))
);

CREATE TABLE admin_access_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id uuid NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    name text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    prefix text NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_admin_access_keys_admin_id ON admin_access_keys (admin_id, created_at DESC);

ALTER TABLE tasks ADD COLUMN thumbnail_keys jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX ix_admin_audit_logs_created_at ON admin_audit_logs (created_at);

-- Password authentication is no longer available to users. Existing hashes are
-- retained only to keep migrations reversible; all sessions remain valid.

-- +goose Down
DROP INDEX IF EXISTS ix_admin_audit_logs_created_at;
ALTER TABLE tasks DROP COLUMN IF EXISTS thumbnail_keys;
DROP TABLE IF EXISTS admin_access_keys;
DROP TABLE IF EXISTS oauth_login_states;
DROP TABLE IF EXISTS email_login_codes;
DROP TABLE IF EXISTS user_identities;
