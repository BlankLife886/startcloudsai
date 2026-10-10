-- +goose NO TRANSACTION
-- +goose Up
-- 商品库改为按 (created_at, id) 倒序游标分页，避免翻页期间编辑的商品被跳过。
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ecommerce_products_user_created_id ON ecommerce_products (user_id, created_at DESC, id DESC);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS ix_ecommerce_products_user_created_id;
