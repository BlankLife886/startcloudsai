-- +goose Up
ALTER TABLE plans ADD COLUMN price_lock_eligible boolean NOT NULL DEFAULT false, ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN price_lock_eligible_snapshot boolean NOT NULL DEFAULT false, ADD COLUMN plan_revision_snapshot integer NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN billing_contract jsonb;
CREATE TABLE billing_price_books(id text PRIMARY KEY, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE plan_versions(plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,revision integer NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(plan_id,revision));
INSERT INTO plan_versions(plan_id,revision,snapshot) SELECT id,revision,to_jsonb(plans) FROM plans;
-- +goose StatementBegin
CREATE FUNCTION version_billing_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'updated_at'-'revision')=(to_jsonb(OLD)-'updated_at'-'revision') THEN RETURN NEW; END IF;
  NEW.revision=OLD.revision+1;
 END IF;
 INSERT INTO plan_versions(plan_id,revision,snapshot) VALUES(NEW.id,NEW.revision,to_jsonb(NEW)) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
-- +goose StatementEnd
-- Updates are versioned before mutation; initial inserts are recorded after the FK exists.
CREATE TRIGGER billing_plan_version BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION version_billing_plan();
CREATE TRIGGER billing_plan_initial_version AFTER INSERT ON plans FOR EACH ROW EXECUTE FUNCTION version_billing_plan();

CREATE TABLE topup_credit_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
 plan_id uuid NOT NULL REFERENCES plans(id),plan_name text NOT NULL,plan_revision integer NOT NULL,
 price_lock_eligible boolean NOT NULL,granted_points bigint NOT NULL CHECK(granted_points>0),
 available_points bigint NOT NULL CHECK(available_points>=0),frozen_points bigint NOT NULL DEFAULT 0 CHECK(frozen_points>=0),
 spent_points bigint NOT NULL DEFAULT 0 CHECK(spent_points>=0),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(granted_points=available_points+frozen_points+spent_points)
);
CREATE INDEX ix_topup_credit_user ON topup_credit_lots(user_id,created_at,id);
CREATE TABLE topup_credit_allocations (
 lot_id uuid NOT NULL REFERENCES topup_credit_lots(id),source_type text NOT NULL,source_id text NOT NULL,
 allocated_points bigint NOT NULL CHECK(allocated_points>0),remaining_points bigint NOT NULL CHECK(remaining_points>=0),
 settled_points bigint NOT NULL DEFAULT 0 CHECK(settled_points>=0),released_points bigint NOT NULL DEFAULT 0 CHECK(released_points>=0),
 PRIMARY KEY(source_type,source_id,lot_id),CHECK(allocated_points=remaining_points+settled_points+released_points)
);
ALTER TABLE subscription_credit_allocations ADD COLUMN settled_points bigint NOT NULL DEFAULT 0,
 ADD COLUMN released_points bigint NOT NULL DEFAULT 0,ADD COLUMN expired_points bigint NOT NULL DEFAULT 0,
 ADD COLUMN accounting_version integer NOT NULL DEFAULT 1;
CREATE TABLE billing_decisions(
 user_id uuid NOT NULL REFERENCES users(id),source_type text NOT NULL,source_id text NOT NULL,
 subscription_id uuid REFERENCES subscriptions(id),contract_id uuid,price_book_id text REFERENCES billing_price_books(id),
 snapshot jsonb NOT NULL,settled_points bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(source_type,source_id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_billing_decisions_contract ON billing_decisions(subscription_id,contract_id);
CREATE INDEX ix_billing_decisions_task ON billing_decisions((split_part(source_id,'/',1)));

-- Prevent uninstrumented/old debit paths from silently reusing spent eligible credits.
-- +goose StatementBegin
CREATE FUNCTION check_topup_credit_collateral() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid uuid; a bigint; f bigint; wa bigint; wf bigint; sf bigint;
BEGIN
 uid=COALESCE(NEW.user_id,OLD.user_id);
 SELECT balance_cents,frozen_cents INTO wa,wf FROM wallets WHERE user_id=uid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT COALESCE(sum(available_points),0),COALESCE(sum(frozen_points),0) INTO a,f FROM topup_credit_lots WHERE user_id=uid;
 SELECT COALESCE(sum(frozen_points),0) INTO sf FROM subscription_credit_lots WHERE user_id=uid;
 IF a>wa OR f+sf>wf THEN RAISE EXCEPTION 'topup credit collateral mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER topup_wallet_collateral AFTER INSERT OR UPDATE ON wallets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_topup_credit_collateral();
CREATE CONSTRAINT TRIGGER topup_lot_collateral AFTER INSERT OR UPDATE OR DELETE ON topup_credit_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_topup_credit_collateral();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN IF EXISTS(SELECT 1 FROM topup_credit_lots) OR EXISTS(SELECT 1 FROM subscriptions WHERE billing_contract IS NOT NULL) THEN RAISE EXCEPTION 'contract data exists; audited rollback required'; END IF; END $$;
-- +goose StatementEnd
DROP TRIGGER topup_wallet_collateral ON wallets;
DROP TRIGGER topup_lot_collateral ON topup_credit_lots;
DROP FUNCTION check_topup_credit_collateral();
DROP TABLE billing_decisions,topup_credit_allocations,topup_credit_lots;
ALTER TABLE subscription_credit_allocations DROP COLUMN settled_points,DROP COLUMN released_points,DROP COLUMN expired_points,DROP COLUMN accounting_version;
DROP TRIGGER billing_plan_version ON plans;
DROP TRIGGER billing_plan_initial_version ON plans;
DROP FUNCTION version_billing_plan();
DROP TABLE plan_versions,billing_price_books;
ALTER TABLE subscriptions DROP COLUMN billing_contract;
ALTER TABLE orders DROP COLUMN price_lock_eligible_snapshot,DROP COLUMN plan_revision_snapshot;
ALTER TABLE plans DROP COLUMN price_lock_eligible,DROP COLUMN revision;
