-- +goose Up
CREATE TABLE admin_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email citext NOT NULL UNIQUE,
    username text NOT NULL,
    password_hash text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_admin_accounts_status CHECK (status IN ('active','disabled'))
);

CREATE TABLE admin_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id uuid NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    ip text,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_admin_sessions_admin_id ON admin_sessions (admin_id);
CREATE INDEX ix_admin_sessions_expires_at ON admin_sessions (expires_at);

-- 保留既有管理员的 id 与密码哈希，让升级后可继续登录；后续密码独立维护。
INSERT INTO admin_accounts (id, email, username, password_hash, status, last_login_at, created_at)
SELECT id, email, username, password_hash,
       CASE WHEN status = 'active' THEN 'active' ELSE 'disabled' END,
       last_login_at, created_at
FROM users
WHERE role = 'admin'
   OR id IN (SELECT admin_id FROM admin_audit_logs WHERE admin_id IS NOT NULL)
   OR id IN (SELECT reviewed_by FROM gallery_submissions WHERE reviewed_by IS NOT NULL)
   OR id IN (SELECT created_by FROM redemption_codes WHERE created_by IS NOT NULL)
ON CONFLICT (email) DO NOTHING;

-- 旧用户会话不能继续取得管理权限。
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'admin');

ALTER TABLE admin_audit_logs DROP CONSTRAINT admin_audit_logs_admin_id_fkey;
ALTER TABLE admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL;

ALTER TABLE gallery_submissions DROP CONSTRAINT gallery_submissions_reviewed_by_fkey;
ALTER TABLE gallery_submissions
    ADD CONSTRAINT gallery_submissions_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES admin_accounts(id) ON DELETE SET NULL;

ALTER TABLE redemption_codes DROP CONSTRAINT redemption_codes_created_by_fkey;
ALTER TABLE redemption_codes
    ADD CONSTRAINT redemption_codes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES admin_accounts(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE redemption_codes DROP CONSTRAINT redemption_codes_created_by_fkey;
UPDATE redemption_codes r SET created_by = NULL
WHERE created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.created_by);
ALTER TABLE redemption_codes
    ADD CONSTRAINT redemption_codes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE gallery_submissions DROP CONSTRAINT gallery_submissions_reviewed_by_fkey;
UPDATE gallery_submissions g SET reviewed_by = NULL
WHERE reviewed_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.reviewed_by);
ALTER TABLE gallery_submissions
    ADD CONSTRAINT gallery_submissions_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE admin_audit_logs DROP CONSTRAINT admin_audit_logs_admin_id_fkey;
UPDATE admin_audit_logs a SET admin_id = NULL
WHERE admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.admin_id);
ALTER TABLE admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL;

DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS admin_accounts;
