-- +goose NO TRANSACTION
-- +goose Up
-- 后台“开发者 API”页按时间倒序浏览全站 /v1 调用记录。
CREATE INDEX CONCURRENTLY IF NOT EXISTS developer_api_billing_created_idx
    ON developer_api_billing_requests (created_at DESC, billing_id DESC);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS developer_api_billing_created_idx;
