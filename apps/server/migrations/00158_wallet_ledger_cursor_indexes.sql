-- +goose NO TRANSACTION
-- +goose Up
-- 全站账本按 (created_at, id) 倒序游标分页；BRIN 只能做范围过滤，不能提供排序，
-- 没有这个索引时每页都要全表扫描后排序。
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_wallet_ledger_created_id ON wallet_ledger (created_at DESC, id DESC);
-- 单用户账本游标带上 id 决胜列，替代只含 (user_id, created_at) 的旧索引，省去额外排序。
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_wallet_ledger_user_created_id ON wallet_ledger (user_id, created_at DESC, id DESC);
DROP INDEX CONCURRENTLY IF EXISTS ix_wallet_ledger_user_created;

-- +goose Down
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_wallet_ledger_user_created ON wallet_ledger (user_id, created_at);
DROP INDEX CONCURRENTLY IF EXISTS ix_wallet_ledger_user_created_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_wallet_ledger_created_id;
