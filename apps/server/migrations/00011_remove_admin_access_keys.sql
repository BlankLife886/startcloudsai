-- +goose Up
DROP TABLE IF EXISTS admin_access_keys;

-- +goose Down
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
