-- +goose Up
CREATE TABLE admin_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
    admin_email text NOT NULL DEFAULT '',
    method text NOT NULL,
    path text NOT NULL,
    action text NOT NULL,
    target_id text,
    status integer NOT NULL,
    ip text,
    detail jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_admin_audit_logs_created ON admin_audit_logs (created_at DESC);
CREATE INDEX ix_admin_audit_logs_admin_created ON admin_audit_logs (admin_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS admin_audit_logs;
