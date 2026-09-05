-- +goose Up
ALTER TABLE orders
    ADD COLUMN provider_pay_amount_cents bigint,
    ADD COLUMN payment_method text;

ALTER TABLE orders
    ADD CONSTRAINT ck_orders_provider_pay_amount
        CHECK (provider_pay_amount_cents IS NULL OR provider_pay_amount_cents > 0),
    ADD CONSTRAINT ck_orders_payment_method
        CHECK (payment_method IS NULL OR payment_method IN ('alipay', 'wechat'));

-- +goose Down
ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS ck_orders_payment_method,
    DROP CONSTRAINT IF EXISTS ck_orders_provider_pay_amount,
    DROP COLUMN IF EXISTS payment_method,
    DROP COLUMN IF EXISTS provider_pay_amount_cents;
