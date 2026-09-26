-- +goose Up
ALTER TABLE plans ADD COLUMN subscription_policy jsonb NOT NULL DEFAULT '{"version":2,"series":"general","tier":1,"channels":["web","api"],"featureKeys":[],"modelIds":[]}';
ALTER TABLE orders ADD COLUMN subscription_policy_snapshot jsonb NOT NULL DEFAULT '{}', ADD COLUMN subscription_change_id uuid;
ALTER TABLE subscriptions ADD COLUMN billing_version integer NOT NULL DEFAULT 1,
 ADD COLUMN policy_snapshot jsonb NOT NULL DEFAULT '{}', ADD COLUMN plan_name_snapshot text NOT NULL DEFAULT '',
 ADD COLUMN price_snapshot bigint NOT NULL DEFAULT 0, ADD COLUMN duration_snapshot integer NOT NULL DEFAULT 0,
 ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE subscriptions DROP CONSTRAINT ck_subscriptions_status;
ALTER TABLE subscriptions ADD CONSTRAINT ck_subscriptions_status CHECK (status IN ('active','expired','refunding','cancelled'));
ALTER TABLE subscription_periods ADD COLUMN cadence text NOT NULL DEFAULT 'legacy_day',
 ADD COLUMN next_grant_at timestamptz, ADD COLUMN granted_count integer NOT NULL DEFAULT 0,
 ADD COLUMN total_grants integer NOT NULL DEFAULT 0;
CREATE INDEX ix_subscription_periods_rolling_due ON subscription_periods(next_grant_at) WHERE cadence='rolling_24h';

CREATE TABLE subscription_credit_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL REFERENCES subscriptions(id),
 user_id uuid NOT NULL REFERENCES users(id), order_id uuid NOT NULL REFERENCES orders(id),
 source_id text UNIQUE NOT NULL, scheduled_at timestamptz NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(),
 granted_points bigint NOT NULL CHECK(granted_points>=0), available_points bigint NOT NULL CHECK(available_points>=0),
 frozen_points bigint NOT NULL DEFAULT 0 CHECK(frozen_points>=0), spent_points bigint NOT NULL DEFAULT 0 CHECK(spent_points>=0),
 revoked_points bigint NOT NULL DEFAULT 0 CHECK(revoked_points>=0), refund_hold boolean NOT NULL DEFAULT false,
 policy jsonb NOT NULL, grant_kind text NOT NULL DEFAULT 'cycle',
 CHECK(granted_points=available_points+frozen_points+spent_points+revoked_points)
);
CREATE INDEX ix_subscription_credit_lots_user ON subscription_credit_lots(user_id,granted_at,id);
CREATE TABLE subscription_credit_allocations (
 lot_id uuid NOT NULL REFERENCES subscription_credit_lots(id), source_type text NOT NULL, source_id text NOT NULL,
 remaining_points bigint NOT NULL CHECK(remaining_points>=0), allocated_points bigint NOT NULL CHECK(allocated_points>=0),
 PRIMARY KEY(source_type,source_id,lot_id)
);
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS ck_wallet_ledger_credit_bucket;
ALTER TABLE wallet_ledger ADD CONSTRAINT ck_wallet_ledger_credit_bucket CHECK(credit_bucket IN ('normal','trial','mixed','subscription'));

CREATE TABLE subscription_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 subscription_id uuid NOT NULL REFERENCES subscriptions(id), kind text NOT NULL CHECK(kind IN ('upgrade','refund')),
 status text NOT NULL CHECK(status IN ('quoted','pending','reviewing','processing','completed','rejected','cancelled')),
 target_plan_id uuid REFERENCES plans(id), expected_revision integer NOT NULL, amount_cents bigint NOT NULL CHECK(amount_cents>=0),
 snapshot jsonb NOT NULL DEFAULT '{}', reason text NOT NULL DEFAULT '', review_note text NOT NULL DEFAULT '',
 provider_reference text UNIQUE, reviewed_by uuid REFERENCES admin_accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
 completed_at timestamptz
);
CREATE UNIQUE INDEX uq_subscription_refund_open ON subscription_changes(subscription_id) WHERE kind='refund' AND status IN ('reviewing','processing');
CREATE INDEX ix_subscription_changes_user ON subscription_changes(user_id,created_at DESC);
ALTER TABLE orders ADD CONSTRAINT fk_orders_subscription_change FOREIGN KEY(subscription_change_id) REFERENCES subscription_changes(id);
CREATE UNIQUE INDEX uq_orders_subscription_change ON orders(subscription_change_id) WHERE subscription_change_id IS NOT NULL;

-- +goose Down
-- These records carry money and immutable scope snapshots; refuse lossy rollback.
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM subscriptions WHERE billing_version=2) OR EXISTS(SELECT 1 FROM subscription_changes)
 OR EXISTS(SELECT 1 FROM orders WHERE plan_kind_snapshot='subscription' AND subscription_policy_snapshot->>'version'='2') THEN
  RAISE EXCEPTION 'subscription v2 records exist; rollback requires an audited migration';
 END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE orders DROP CONSTRAINT fk_orders_subscription_change;
DROP INDEX uq_orders_subscription_change;
DROP TABLE subscription_changes;
DROP TABLE subscription_credit_allocations;
DROP TABLE subscription_credit_lots;
ALTER TABLE wallet_ledger DROP CONSTRAINT ck_wallet_ledger_credit_bucket;
ALTER TABLE wallet_ledger ADD CONSTRAINT ck_wallet_ledger_credit_bucket CHECK(credit_bucket IN ('normal','trial','mixed'));
ALTER TABLE subscription_periods DROP COLUMN cadence,DROP COLUMN next_grant_at,DROP COLUMN granted_count,DROP COLUMN total_grants;
ALTER TABLE subscriptions DROP CONSTRAINT ck_subscriptions_status;
ALTER TABLE subscriptions ADD CONSTRAINT ck_subscriptions_status CHECK(status IN ('active','expired'));
ALTER TABLE subscriptions DROP COLUMN billing_version,DROP COLUMN policy_snapshot,DROP COLUMN plan_name_snapshot,DROP COLUMN price_snapshot,DROP COLUMN duration_snapshot,DROP COLUMN revision;
ALTER TABLE orders DROP COLUMN subscription_policy_snapshot,DROP COLUMN subscription_change_id;
ALTER TABLE plans DROP COLUMN subscription_policy;
