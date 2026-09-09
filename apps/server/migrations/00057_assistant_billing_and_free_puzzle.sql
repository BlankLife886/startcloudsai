-- +goose Up
ALTER TABLE assistant_runs
    ADD COLUMN reserved_cents bigint NOT NULL DEFAULT 0,
    ADD COLUMN cost_cents bigint NOT NULL DEFAULT 0,
    ADD COLUMN billing_generation integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_assistant_runs_reserved_cents_nonneg CHECK (reserved_cents >= 0),
    ADD CONSTRAINT ck_assistant_runs_cost_cents_nonneg CHECK (cost_cents >= 0),
    ADD CONSTRAINT ck_assistant_runs_cost_within_reservation CHECK (cost_cents <= reserved_cents),
    ADD CONSTRAINT ck_assistant_runs_billing_generation_nonneg CHECK (billing_generation >= 0);

UPDATE app_settings
SET value = jsonb_set(value, '{puzzle}', '0'::jsonb, true),
    updated_at = now()
WHERE key = 'task_prices';

-- +goose Down
ALTER TABLE assistant_runs
    DROP CONSTRAINT IF EXISTS ck_assistant_runs_billing_generation_nonneg,
    DROP CONSTRAINT IF EXISTS ck_assistant_runs_cost_within_reservation,
    DROP CONSTRAINT IF EXISTS ck_assistant_runs_cost_cents_nonneg,
    DROP CONSTRAINT IF EXISTS ck_assistant_runs_reserved_cents_nonneg,
    DROP COLUMN IF EXISTS billing_generation,
    DROP COLUMN IF EXISTS cost_cents,
    DROP COLUMN IF EXISTS reserved_cents;
