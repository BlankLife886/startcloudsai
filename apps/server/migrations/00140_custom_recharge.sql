-- +goose Up
ALTER TABLE plans ADD COLUMN recharge_policy jsonb;
ALTER TABLE plans ADD CONSTRAINT recharge_topup_only CHECK(recharge_policy IS NULL OR kind='topup');
CREATE UNIQUE INDEX uq_plans_one_custom_recharge ON plans((kind)) WHERE active AND recharge_policy IS NOT NULL;
ALTER TABLE orders ADD COLUMN recharge_policy_snapshot jsonb;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM orders WHERE recharge_policy_snapshot IS NOT NULL) THEN
  RAISE EXCEPTION 'custom recharge orders exist; audited rollback required';
 END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE orders DROP COLUMN recharge_policy_snapshot;
DROP INDEX uq_plans_one_custom_recharge;
ALTER TABLE plans DROP CONSTRAINT recharge_topup_only, DROP COLUMN recharge_policy;
