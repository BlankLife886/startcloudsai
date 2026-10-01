-- +goose Up
ALTER TABLE orders DROP CONSTRAINT ck_orders_status;
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN ('pending','uncertain','paid','completed','failed','expired'));
ALTER TABLE orders
  ADD COLUMN subscription_starts_at timestamptz,
  ADD COLUMN reconcile_after timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN reconcile_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN reconcile_lease_id uuid,
  ADD COLUMN reconcile_lease_until timestamptz,
  ADD COLUMN last_reconciled_at timestamptz;
CREATE INDEX ix_orders_reconcile_due ON orders (reconcile_after, created_at, id) WHERE provider='lanjing';

CREATE TABLE subscription_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  order_id uuid UNIQUE REFERENCES orders(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  grant_starts_on date NOT NULL,
  grant_ends_on date NOT NULL,
  next_grant_on date NOT NULL,
  daily_grant_cents bigint NOT NULL CHECK (daily_grant_cents > 0),
  CHECK (ends_at > starts_at AND grant_ends_on > grant_starts_on)
);
CREATE UNIQUE INDEX uq_subscription_legacy_period ON subscription_periods (subscription_id) WHERE order_id IS NULL;
CREATE INDEX ix_subscription_periods_due ON subscription_periods (next_grant_on, id) WHERE next_grant_on < grant_ends_on;
CREATE INDEX ix_subscription_periods_timeline ON subscription_periods (subscription_id, starts_at);

-- Use persisted subscription terms, never today's plan catalog, for legacy recovery.
INSERT INTO subscription_periods (subscription_id, starts_at, ends_at, grant_starts_on, grant_ends_on, next_grant_on, daily_grant_cents)
SELECT id, starts_at, ends_at, (starts_at AT TIME ZONE 'Asia/Shanghai')::date,
  GREATEST((ends_at AT TIME ZONE 'Asia/Shanghai')::date, (starts_at AT TIME ZONE 'Asia/Shanghai')::date + 1),
  (starts_at AT TIME ZONE 'Asia/Shanghai')::date, daily_grant_cents
FROM subscriptions WHERE daily_grant_cents > 0 AND ends_at > starts_at;

-- +goose Down
-- Refuse rollback while unresolved orders exist; never silently declare them failed.
ALTER TABLE orders DROP CONSTRAINT ck_orders_status;
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN ('pending','paid','completed','failed','expired'));
DROP TABLE subscription_periods;
DROP INDEX ix_orders_reconcile_due;
ALTER TABLE orders DROP COLUMN subscription_starts_at, DROP COLUMN last_reconciled_at, DROP COLUMN reconcile_lease_until, DROP COLUMN reconcile_lease_id, DROP COLUMN reconcile_attempts, DROP COLUMN reconcile_after;
