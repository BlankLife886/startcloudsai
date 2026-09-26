-- +goose Up
-- 可选平台日志：只保存脱敏后的安全、运维和用户操作事件。
-- 日志总开关默认关闭；开启后仍受保留期与逻辑容量双重限制。
CREATE TABLE platform_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category text NOT NULL CHECK (category IN ('security', 'operations', 'user')),
    level text NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    service text NOT NULL DEFAULT '',
    event text NOT NULL,
    message text NOT NULL DEFAULT '',
    request_id text,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    admin_id uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    task_id uuid,
    client_ip inet,
    status_code integer,
    duration_ms bigint,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    size_bytes bigint NOT NULL DEFAULT 256 CHECK (size_bytes > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_platform_logs_created ON platform_logs (created_at DESC, id DESC);
CREATE INDEX ix_platform_logs_category_created ON platform_logs (category, created_at DESC, id DESC);
CREATE INDEX ix_platform_logs_level_created ON platform_logs (level, created_at DESC, id DESC);
CREATE INDEX ix_platform_logs_task_created ON platform_logs (task_id, created_at DESC) WHERE task_id IS NOT NULL;
CREATE INDEX ix_platform_logs_user_created ON platform_logs (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX ix_platform_logs_request ON platform_logs (request_id) WHERE request_id IS NOT NULL;

INSERT INTO app_settings (key, value) VALUES
    ('platform_logging_enabled', 'false'::jsonb),
    ('platform_log_security_enabled', 'true'::jsonb),
    ('platform_log_operations_enabled', 'true'::jsonb),
    ('platform_log_user_enabled', 'false'::jsonb),
    ('platform_log_retention_days', '7'::jsonb),
    ('platform_log_max_mb', '256'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- +goose Down
DELETE FROM app_settings WHERE key IN (
    'platform_logging_enabled',
    'platform_log_security_enabled',
    'platform_log_operations_enabled',
    'platform_log_user_enabled',
    'platform_log_retention_days',
    'platform_log_max_mb'
);
DROP TABLE IF EXISTS platform_logs;
