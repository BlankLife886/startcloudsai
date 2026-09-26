package store

import (
	"context"
	"github.com/google/uuid"
	"time"
)

func PrepareOrderPayment(ctx context.Context, q Q, id uuid.UUID, method string) (*Order, error) {
	return scanOrder(q.QueryRow(ctx, `UPDATE orders SET status='uncertain',payment_method=COALESCE(payment_method,$2),
	 provider_pay_amount_cents=COALESCE(provider_pay_amount_cents,amount_cents),reconcile_after=now()+interval '1 minute',reconcile_lease_id=NULL,reconcile_lease_until=NULL
 WHERE id=$1 AND status IN ('pending','uncertain') AND provider_order_id IS NULL RETURNING `+orderCols, id, method))
}

func MarkOrderUncertain(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE orders SET status='uncertain' WHERE id=$1 AND status='pending'`, id)
	return err
}

func MarkOrderPaymentVerified(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE orders SET status='paid',paid_at=COALESCE(paid_at,now()),reconcile_after=now() WHERE id=$1 AND status IN ('uncertain','failed','cancelled')`, id)
	return err
}

func ResolveUnboundOrderNotCreated(ctx context.Context, q Q, id uuid.UUID) (*Order, error) {
	return scanOrder(q.QueryRow(ctx, `WITH closed AS (
 UPDATE orders SET status='failed',reconcile_after='infinity',reconcile_lease_id=NULL,reconcile_lease_until=NULL
 WHERE id=$1 AND status='uncertain' AND provider_order_id IS NULL RETURNING `+orderCols+`
), changed_quotes AS (
 UPDATE subscription_changes SET status='cancelled',updated_at=now()
 WHERE id IN (SELECT subscription_change_id FROM closed) AND kind='upgrade' AND status='pending'
) SELECT `+orderCols+` FROM closed`, id))
}

// Claims are short leases: failed processes cannot permanently remove work from the queue.
func ClaimOrdersForReconciliation(ctx context.Context, q Q, now time.Time, limit int) ([]*Order, error) {
	token := uuid.New()
	rows, err := q.Query(ctx, `UPDATE orders SET reconcile_lease_id=$3,reconcile_lease_until=$1+interval '2 minutes'
 WHERE id IN (SELECT id FROM orders WHERE provider='lanjing' AND reconcile_after<=$1
 AND (reconcile_lease_until IS NULL OR reconcile_lease_until<$1)
 AND (status IN ('pending','uncertain','paid','failed') OR created_at>=$1-interval '30 days')
 ORDER BY CASE WHEN status IN ('pending','uncertain','paid') THEN 0 ELSE 1 END,reconcile_after,created_at,id
 LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING `+orderCols, now, min(max(limit, 1), 50), token)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func FinishOrderReconciliation(ctx context.Context, q Q, order *Order, next time.Time, failed bool) error {
	_, err := q.Exec(ctx, `UPDATE orders SET reconcile_after=$3,last_reconciled_at=now(),
 reconcile_attempts=CASE WHEN $4 THEN reconcile_attempts+1 ELSE 0 END,
 reconcile_lease_id=NULL,reconcile_lease_until=NULL WHERE id=$1 AND reconcile_lease_id=$2`, order.ID, order.ReconcileLeaseID, next, failed)
	return err
}

func ReleaseOrderReconciliation(ctx context.Context, q Q, order *Order) error {
	_, err := q.Exec(ctx, `UPDATE orders SET reconcile_lease_id=NULL,reconcile_lease_until=NULL WHERE id=$1 AND reconcile_lease_id=$2`, order.ID, order.ReconcileLeaseID)
	return err
}

func ResolveOrderReconciliationRisks(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE security_risk_events SET resolved_at=now(),resolution_note='Payment reconciliation verified'
	 WHERE category='payment_reconciliation' AND metadata->>'orderId'=$1 AND resolved_at IS NULL`, id.String())
	return err
}
