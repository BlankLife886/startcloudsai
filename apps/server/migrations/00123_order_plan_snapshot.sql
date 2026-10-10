-- +goose Up
ALTER TABLE orders
  ADD COLUMN plan_name_snapshot text,
  ADD COLUMN plan_kind_snapshot text,
  ADD COLUMN plan_duration_days_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN plan_daily_grant_snapshot bigint NOT NULL DEFAULT 0,
  ADD COLUMN subscription_ends_at timestamptz;

-- Historical purchases have no recoverable catalog snapshot. Leave them null.

-- +goose Down
ALTER TABLE orders
  DROP COLUMN subscription_ends_at,
  DROP COLUMN plan_daily_grant_snapshot,
  DROP COLUMN plan_duration_days_snapshot,
  DROP COLUMN plan_kind_snapshot,
  DROP COLUMN plan_name_snapshot;
