-- +goose Up
ALTER TABLE subscription_periods ADD COLUMN closed_at timestamptz;
ALTER TABLE subscription_credit_lots ADD COLUMN upgrade_hold boolean NOT NULL DEFAULT false,
 ADD COLUMN upgrade_revoked_points bigint NOT NULL DEFAULT 0 CHECK(upgrade_revoked_points>=0 AND upgrade_revoked_points<=revoked_points);

-- All payment-close paths already close their subscription change in the same statement.
-- +goose StatementBegin
CREATE FUNCTION release_cancelled_upgrade_credits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held bigint; balance bigint;
BEGIN
 IF NEW.kind='upgrade' AND NEW.status='cancelled' AND OLD.status='pending'
 AND NEW.snapshot->>'upgradeMode'='restart' THEN
  SELECT balance_cents+trial_balance_cents INTO balance FROM wallets WHERE user_id=NEW.user_id FOR UPDATE;
  SELECT COALESCE(sum(available_points),0) INTO held FROM subscription_credit_lots WHERE subscription_id=NEW.subscription_id AND upgrade_hold;
  UPDATE subscription_credit_lots SET upgrade_hold=false WHERE subscription_id=NEW.subscription_id AND upgrade_hold;
  IF held>0 THEN
   INSERT INTO wallet_ledger(user_id,kind,delta_cents,balance_after_cents,source_type,source_id,reason,credit_bucket)
   VALUES(NEW.user_id,'release',held,balance+(SELECT COALESCE(sum(available_points),0) FROM subscription_credit_lots WHERE user_id=NEW.user_id AND NOT refund_hold AND NOT upgrade_hold),
    'subscription_upgrade_exchange',NEW.id::text,'升级订单已关闭，恢复旧订阅积分','subscription') ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER subscription_upgrade_cancel_release AFTER UPDATE OF status ON subscription_changes
 FOR EACH ROW EXECUTE FUNCTION release_cancelled_upgrade_credits();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM subscription_changes WHERE snapshot->>'upgradeMode'='restart') THEN
  RAISE EXCEPTION 'restart upgrade records exist; rollback requires an audited migration';
 END IF;
END $$;
-- +goose StatementEnd
DROP TRIGGER subscription_upgrade_cancel_release ON subscription_changes;
DROP FUNCTION release_cancelled_upgrade_credits();
ALTER TABLE subscription_credit_lots DROP COLUMN upgrade_hold,DROP COLUMN upgrade_revoked_points;
ALTER TABLE subscription_periods DROP COLUMN closed_at;
