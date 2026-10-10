-- +goose Up
ALTER TABLE orders
    ADD COLUMN provider_pay_url text,
    ADD COLUMN requires_manual_amount boolean,
    ADD COLUMN provider_expires_at timestamptz;

ALTER TABLE orders
    ADD CONSTRAINT ck_orders_provider_pay_url
        CHECK (provider_pay_url IS NULL OR (length(btrim(provider_pay_url)) BETWEEN 1 AND 4096));

-- +goose Down
ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS ck_orders_provider_pay_url,
    DROP COLUMN IF EXISTS provider_expires_at,
    DROP COLUMN IF EXISTS requires_manual_amount,
    DROP COLUMN IF EXISTS provider_pay_url;
