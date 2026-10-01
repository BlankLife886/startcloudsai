-- +goose NO TRANSACTION
-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_admin_created_id ON users (created_at DESC, id DESC) WHERE role = 'user';
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_admin_status_created_id ON users (status, created_at DESC, id DESC) WHERE role = 'user';
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_email_trgm ON users USING gin ((email::text) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_username_trgm ON users USING gin (username gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_admin_audit_method_created_id ON admin_audit_logs (method, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_redemption_status_created_id ON redemption_codes (status, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tasks_admin_type_created_id ON tasks (type, created_at DESC, id DESC) WHERE admin_cleared_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tasks_admin_prompt_trgm ON tasks USING gin (prompt gin_trgm_ops) WHERE admin_cleared_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_assistant_runs_admin_prompt_trgm ON assistant_runs USING gin (prompt gin_trgm_ops) WHERE admin_cleared_at IS NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS ix_assistant_runs_admin_prompt_trgm;
DROP INDEX CONCURRENTLY IF EXISTS ix_tasks_admin_prompt_trgm;
DROP INDEX CONCURRENTLY IF EXISTS ix_tasks_admin_type_created_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_redemption_status_created_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_admin_audit_method_created_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_users_username_trgm;
DROP INDEX CONCURRENTLY IF EXISTS ix_users_email_trgm;
DROP INDEX CONCURRENTLY IF EXISTS ix_users_admin_status_created_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_users_admin_created_id;
