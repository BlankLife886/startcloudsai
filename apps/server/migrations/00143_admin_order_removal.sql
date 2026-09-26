-- +goose Up
ALTER TABLE orders ADD COLUMN admin_deleted_at timestamptz,
 ADD COLUMN admin_deleted_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL;
CREATE INDEX ix_reconciliation_received_order ON payment_reconciliations(order_id)
 WHERE provider_state=2 OR provider_paid_amount_cents>0;

-- +goose Down
DROP INDEX ix_reconciliation_received_order;
ALTER TABLE orders DROP COLUMN admin_deleted_at,DROP COLUMN admin_deleted_by;
