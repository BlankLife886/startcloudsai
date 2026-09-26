-- +goose Up
ALTER TABLE subscription_credit_lots ADD COLUMN expires_at timestamptz,
 ADD COLUMN expired_points bigint NOT NULL DEFAULT 0 CHECK(expired_points>=0 AND expired_points+upgrade_revoked_points<=revoked_points);
UPDATE subscription_credit_lots SET expires_at=scheduled_at+interval '24 hours';
-- Backfilling existing lots queues deferred collateral checks; flush them before DDL.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE subscription_credit_lots ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE subscription_periods ADD COLUMN skipped_grants integer NOT NULL DEFAULT 0 CHECK(skipped_grants>=0 AND skipped_grants<=granted_count);
CREATE INDEX ix_subscription_credit_expiry ON subscription_credit_lots(expires_at,user_id) WHERE available_points>0 AND NOT refund_hold AND NOT upgrade_hold;

-- +goose StatementBegin
CREATE FUNCTION expire_subscription_credit_lots(p_user uuid,p_at timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE account_balance bigint; expired record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM subscription_credit_lots WHERE user_id=p_user AND available_points>0
  AND expires_at<=p_at AND NOT refund_hold AND NOT upgrade_hold) THEN RETURN; END IF;
 SELECT balance_cents+trial_balance_cents INTO account_balance FROM wallets WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 FOR expired IN SELECT id,available_points,expires_at FROM subscription_credit_lots
  WHERE user_id=p_user AND available_points>0 AND expires_at<=p_at AND NOT refund_hold AND NOT upgrade_hold
  ORDER BY expires_at,id FOR UPDATE LOOP
  UPDATE subscription_credit_lots SET available_points=0,revoked_points=revoked_points+expired.available_points,
   expired_points=expired_points+expired.available_points WHERE id=expired.id;
  INSERT INTO wallet_ledger(user_id,kind,delta_cents,balance_after_cents,source_type,source_id,reason,credit_bucket)
  VALUES(p_user,'spend',-expired.available_points,account_balance+(SELECT COALESCE(sum(available_points),0) FROM subscription_credit_lots WHERE user_id=p_user AND NOT refund_hold AND NOT upgrade_hold),
   'subscription_cycle_expiry',expired.id::text,format('订阅周期到期，%s 未用积分失效（%s）',expired.available_points,expired.expires_at AT TIME ZONE 'Asia/Shanghai'),'subscription');
 END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM subscription_credit_lots WHERE expired_points>0) OR EXISTS(SELECT 1 FROM subscription_periods WHERE skipped_grants>0) THEN
  RAISE EXCEPTION 'cycle expiry records exist; rollback requires an audited migration';
 END IF;
END $$;
-- +goose StatementEnd
DROP FUNCTION expire_subscription_credit_lots(uuid,timestamptz);
DROP INDEX ix_subscription_credit_expiry;
ALTER TABLE subscription_credit_lots DROP COLUMN expires_at,DROP COLUMN expired_points;
ALTER TABLE subscription_periods DROP COLUMN skipped_grants;
