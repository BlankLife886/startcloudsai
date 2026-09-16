-- +goose Up
-- Manual, admin-granted concurrency added on top of the base setting and any
-- subscription bonus. Capped like SubscriptionPolicy.ExtraConcurrency.
ALTER TABLE users
    ADD COLUMN concurrency_bonus int NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_users_concurrency_bonus CHECK (concurrency_bonus >= 0 AND concurrency_bonus <= 1000);

-- +goose Down
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_concurrency_bonus;
ALTER TABLE users DROP COLUMN IF EXISTS concurrency_bonus;
