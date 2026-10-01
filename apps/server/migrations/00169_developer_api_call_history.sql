-- +goose NO TRANSACTION
-- +goose Up
-- 开发者控制台按用户倒序分页展示 /v1 调用记录。
CREATE INDEX CONCURRENTLY IF NOT EXISTS developer_api_billing_user_created_idx
    ON developer_api_billing_requests (user_id, created_at DESC, billing_id DESC);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS developer_api_billing_user_created_idx;
