-- +goose Up
-- Old expired rows do not record the closure cause; do not guess cancellation.
ALTER TABLE orders DROP CONSTRAINT ck_orders_status;
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN ('pending','uncertain','paid','completed','failed','expired','cancelled'));

-- +goose Down
-- Refuse a lossy rollback while cancelled orders exist.
ALTER TABLE orders DROP CONSTRAINT ck_orders_status;
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN ('pending','uncertain','paid','completed','failed','expired'));
