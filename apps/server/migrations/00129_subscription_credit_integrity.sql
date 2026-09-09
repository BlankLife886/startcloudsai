-- +goose Up
CREATE INDEX ix_subscription_lots_available ON subscription_credit_lots(user_id,granted_at,id) WHERE available_points>0 AND NOT refund_hold;
CREATE INDEX ix_subscription_lots_frozen ON subscription_credit_lots(user_id) WHERE frozen_points>0;
-- +goose StatementBegin
CREATE FUNCTION check_subscription_credit_collateral() RETURNS trigger AS $$
DECLARE reserved bigint; backing bigint;
BEGIN
 SELECT COALESCE(sum(frozen_points),0) INTO reserved FROM subscription_credit_lots WHERE user_id=NEW.user_id AND frozen_points>0;
 SELECT frozen_cents INTO backing FROM wallets WHERE user_id=NEW.user_id;
 IF reserved>COALESCE(backing,0) THEN
  RAISE EXCEPTION 'subscription reservation collateral mismatch' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='wallets' THEN
  IF NEW.frozen_cents<OLD.frozen_cents AND reserved>0 AND current_setting('app.subscription_funding',true) IS DISTINCT FROM 'v2' THEN
   RAISE EXCEPTION 'scoped subscription settlement requires an upgraded worker' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER subscription_wallet_collateral AFTER UPDATE ON wallets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_subscription_credit_collateral();
CREATE CONSTRAINT TRIGGER subscription_lot_collateral AFTER INSERT OR UPDATE ON subscription_credit_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_subscription_credit_collateral();

-- +goose Down
DROP TRIGGER subscription_wallet_collateral ON wallets;
DROP TRIGGER subscription_lot_collateral ON subscription_credit_lots;
DROP FUNCTION check_subscription_credit_collateral();
DROP INDEX ix_subscription_lots_frozen;
DROP INDEX ix_subscription_lots_available;
