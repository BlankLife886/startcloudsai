-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tasks_admin_history_idem
ON tasks (idempotency_key)
WHERE deleted_at IS NULL AND admin_cleared_at IS NULL AND idempotency_key IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_payment_reconciliations_order_latest
ON payment_reconciliations (order_id, id DESC);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS ix_payment_reconciliations_order_latest;
DROP INDEX CONCURRENTLY IF EXISTS ix_tasks_admin_history_idem;
