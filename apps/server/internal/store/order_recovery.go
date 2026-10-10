package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// PrepareOrderPayment records the chosen method on a pending order right before
// the provider order is created. If the process dies before the provider answer
// is bound, the reconciler fails the order after two minutes.
func PrepareOrderPayment(ctx context.Context, q Q, id uuid.UUID, method string) (*Order, error) {
	return scanOrder(q.QueryRow(ctx, `UPDATE orders SET payment_method=$2,provider_pay_amount_cents=amount_cents,
	 reconcile_after=now()+interval '2 minutes',reconcile_lease_id=NULL,reconcile_lease_until=NULL
 WHERE id=$1 AND status='pending' AND provider_order_id IS NULL RETURNING `+orderCols, id, method))
}

// RecordOrderPayment persists provider-confirmed payment before delivery runs in
// its own transaction, so a delivery failure never loses the receipt.
func RecordOrderPayment(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE orders SET paid_at=COALESCE(paid_at,now()),reconcile_after=now()+interval '30 seconds'
	 WHERE id=$1 AND status<>'completed'`, id)
	return err
}

// MarkOrderChecked throttles provider lookups and keeps the latest lookup error.
// It returns false when another caller checked the order within minInterval.
func MarkOrderChecked(ctx context.Context, q Q, id uuid.UUID, minInterval time.Duration) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE orders SET last_reconciled_at=now()
	 WHERE id=$1 AND (last_reconciled_at IS NULL OR last_reconciled_at<=now()-make_interval(secs=>$2))`, id, minInterval.Seconds())
	return tag.RowsAffected() > 0, err
}

func SetOrderCheckError(ctx context.Context, q Q, id uuid.UUID, message *string) error {
	_, err := q.Exec(ctx, `UPDATE orders SET provider_check_error=$2 WHERE id=$1`, id, message)
	return err
}

// ClaimOrdersForReconciliation leases due orders that can still change state:
// pending orders, paid-but-undelivered orders, and recently closed orders that
// may still receive a late payment. Claims are short leases so a crashed
// process cannot remove work from the queue.
func ClaimOrdersForReconciliation(ctx context.Context, q Q, now time.Time, limit int) ([]*Order, error) {
	token := uuid.New()
	rows, err := q.Query(ctx, `UPDATE orders SET reconcile_lease_id=$3,reconcile_lease_until=$1+interval '2 minutes'
 WHERE id IN (SELECT id FROM orders WHERE provider='lanjing' AND reconcile_after<=$1
 AND (reconcile_lease_until IS NULL OR reconcile_lease_until<$1)
 AND (`+UnsettledOrderSQL+` OR (status IN ('expired','cancelled','failed') AND provider_order_id IS NOT NULL AND created_at>=$1-interval '25 hours'))
 ORDER BY CASE WHEN `+UnsettledOrderSQL+` THEN 0 ELSE 1 END,reconcile_after,created_at,id
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

// ExpediteRecentLanjingOrders makes every unpaid order created since the given
// time due for reconciliation now, so payments a listener reported late are
// picked up immediately. It returns how many orders were rescheduled.
func ExpediteRecentLanjingOrders(ctx context.Context, q Q, since time.Time) (int64, error) {
	tag, err := q.Exec(ctx, `UPDATE orders SET reconcile_after=now()
 WHERE provider='lanjing' AND provider_order_id IS NOT NULL AND paid_at IS NULL
 AND status IN ('pending','expired','cancelled','failed') AND created_at>=GREATEST($1,now()-interval '25 hours')
 AND (reconcile_after IS NULL OR reconcile_after>now())`, since)
	return tag.RowsAffected(), err
}

// ExpediteOrderReconciliation makes one order due for reconciliation now.
func ExpediteOrderReconciliation(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE orders SET reconcile_after=LEAST(reconcile_after,now()) WHERE id=$1`, id)
	return err
}

func ResolvePaymentListenerRisks(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `UPDATE security_risk_events SET resolved_at=now(),resolution_note='Payment listener recovered'
	 WHERE category='payment_listener' AND resolved_at IS NULL`)
	return err
}
