-- +goose Up
ALTER TABLE plans
    ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN badge text NOT NULL DEFAULT '',
    ADD COLUMN recommended boolean NOT NULL DEFAULT false,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE plans
    ADD CONSTRAINT ck_plans_price_nonnegative CHECK (price_cents >= 0),
    ADD CONSTRAINT ck_plans_grant_nonnegative CHECK (grant_cents >= 0),
    ADD CONSTRAINT ck_plans_bonus_nonnegative CHECK (bonus_cents >= 0),
    ADD CONSTRAINT ck_plans_duration_nonnegative CHECK (duration_days >= 0),
    ADD CONSTRAINT ck_plans_daily_grant_nonnegative CHECK (daily_grant_cents >= 0),
    ADD CONSTRAINT ck_plans_description_length CHECK (char_length(description) <= 500),
    ADD CONSTRAINT ck_plans_badge_length CHECK (char_length(badge) <= 24);

CREATE UNIQUE INDEX uq_plans_one_recommended
    ON plans (recommended)
    WHERE recommended = true;

-- +goose Down
DROP INDEX IF EXISTS uq_plans_one_recommended;
ALTER TABLE plans
    DROP CONSTRAINT IF EXISTS ck_plans_badge_length,
    DROP CONSTRAINT IF EXISTS ck_plans_description_length,
    DROP CONSTRAINT IF EXISTS ck_plans_daily_grant_nonnegative,
    DROP CONSTRAINT IF EXISTS ck_plans_duration_nonnegative,
    DROP CONSTRAINT IF EXISTS ck_plans_bonus_nonnegative,
    DROP CONSTRAINT IF EXISTS ck_plans_grant_nonnegative,
    DROP CONSTRAINT IF EXISTS ck_plans_price_nonnegative,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS recommended,
    DROP COLUMN IF EXISTS badge,
    DROP COLUMN IF EXISTS description;
