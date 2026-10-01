-- +goose Up
-- 订单状态收敛为 pending / completed / failed / expired / cancelled。
-- 「已确认收款」不再是独立状态：paid_at 有值即表示渠道已确认收款，
-- 若尚未 completed，对账任务会持续补发权益。
-- 旧的 uncertain / paid：有渠道单号的回到 pending，由对账任务向渠道查询后收敛；
-- 没有渠道单号的无法向渠道查询，记为 failed（迟到的验签回调仍会入账）。
UPDATE orders SET status='pending', reconcile_after=now(), reconcile_attempts=0
 WHERE status IN ('uncertain','paid') AND provider_order_id IS NOT NULL;
UPDATE orders SET status='failed', reconcile_after=now(), reconcile_attempts=0
 WHERE status IN ('uncertain','paid') AND provider_order_id IS NULL;
ALTER TABLE orders DROP CONSTRAINT ck_orders_status;
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN ('pending','completed','failed','expired','cancelled'));
-- 最近一次向渠道查询失败的原因；查询成功时清空。
ALTER TABLE orders ADD COLUMN provider_check_error text;
CREATE INDEX ix_orders_user_unsettled ON orders (user_id)
 WHERE status='pending' OR (paid_at IS NOT NULL AND status<>'completed');

-- +goose Down
DROP INDEX ix_orders_user_unsettled;
ALTER TABLE orders DROP COLUMN provider_check_error;
ALTER TABLE orders DROP CONSTRAINT ck_orders_status;
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN ('pending','uncertain','paid','completed','failed','expired','cancelled'));
