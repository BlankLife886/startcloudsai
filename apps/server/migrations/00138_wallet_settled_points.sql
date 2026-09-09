-- +goose Up
ALTER TABLE wallet_ledger ADD COLUMN settled_points bigint CHECK(settled_points IS NULL OR (settled_points>=0 AND kind='spend'));

-- Restore only amounts supported by matching reservation records. Remarks are not accounting data.
WITH facts AS (
 SELECT spent.id,
  reservation.normal_cents+reservation.trial_cents-reservation.normal_remaining_cents-reservation.trial_remaining_cents-COALESCE(released.delta_cents,0) AS points,
  reservation.normal_cents+reservation.trial_cents AS reserved
 FROM wallet_ledger spent
 JOIN credit_reservations reservation ON reservation.source_type=spent.source_type AND reservation.source_id=spent.source_id
 JOIN wallet_ledger frozen ON frozen.kind='freeze' AND frozen.source_type=spent.source_type AND frozen.source_id=spent.source_id AND frozen.user_id=spent.user_id
 LEFT JOIN wallet_ledger released ON released.kind='release' AND released.source_type=spent.source_type AND released.source_id=spent.source_id AND released.user_id=spent.user_id
 WHERE spent.kind='spend' AND spent.delta_cents=0
  AND spent.source_type NOT IN ('subscription_cycle_expiry','subscription_upgrade_exchange','subscription_refund_hold')
  AND -frozen.delta_cents=reservation.normal_cents+reservation.trial_cents
  AND COALESCE(released.delta_cents,0)>=0
  AND NOT EXISTS(SELECT 1 FROM wallet_ledger expiry WHERE expiry.source_type='subscription_cycle_expiry' AND expiry.source_id=released.id::text)
)
UPDATE wallet_ledger w SET settled_points=f.points FROM facts f WHERE w.id=f.id AND f.points>=0 AND f.points<=f.reserved;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM wallet_ledger WHERE settled_points IS NOT NULL) THEN
  RAISE EXCEPTION 'settlement facts exist; rollback requires an audited migration';
 END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE wallet_ledger DROP COLUMN settled_points;
