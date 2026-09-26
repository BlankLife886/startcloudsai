package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrOrderNotRemovable = errors.New("order is not an unpaid expired order")

// Aliases are code-owned SQL identifiers, never request values. Keep late payment
// evidence visible even if settlement cannot yet change the local expired status.
func orderFinancialEvidenceSQL(alias string) string {
	return strings.ReplaceAll(`(@.paid_at IS NOT NULL OR @.completed_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM payment_callback_events e WHERE e.order_id=@.id AND e.signature_valid AND e.paid_amount_cents>0)
 OR EXISTS(SELECT 1 FROM payment_reconciliations r WHERE r.order_id=@.id AND (r.provider_state=2 OR r.provider_paid_amount_cents>0))
 OR EXISTS(SELECT 1 FROM wallet_ledger l WHERE l.user_id=@.user_id AND l.source_type='order' AND l.source_id=@.id::text AND l.kind='grant')
 OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.order_id=@.id)
 OR EXISTS(SELECT 1 FROM subscription_periods p WHERE p.order_id=@.id)
 OR EXISTS(SELECT 1 FROM subscription_credit_lots l WHERE l.order_id=@.id)
 OR EXISTS(SELECT 1 FROM topup_credit_lots l WHERE l.order_id=@.id)
 OR EXISTS(SELECT 1 FROM referral_rewards c WHERE c.order_id=@.id))`, "@", alias)
}

func orderVisibleSQL(alias string) string {
	return `(CASE WHEN ` + alias + `.admin_deleted_at IS NULL OR ` + alias + `.status<>'expired' THEN true ELSE ` + orderFinancialEvidenceSQL(alias) + ` END)`
}

// Deletion is a list removal. The source row remains addressable by payment
// callbacks and audit queries, and any later receipt/entitlement makes it visible.
func RemoveExpiredOrder(ctx context.Context, tx pgx.Tx, id, adminID uuid.UUID) (bool, error) {
	var removedAt *time.Time
	var activeLease bool
	if err := tx.QueryRow(ctx, `SELECT admin_deleted_at,reconcile_lease_id IS NOT NULL AND (reconcile_lease_until IS NULL OR reconcile_lease_until>now()) FROM orders WHERE id=$1 FOR UPDATE`, id).Scan(&removedAt, &activeLease); err != nil {
		return false, err
	}
	order, err := GetOrder(ctx, tx, id)
	if err != nil {
		return false, err
	}
	if order.Status != "expired" || order.PaidAt != nil || order.CompletedAt != nil || activeLease {
		return false, ErrOrderNotRemovable
	}
	var protected bool
	if err := tx.QueryRow(ctx, `SELECT `+orderFinancialEvidenceSQL("o")+` OR EXISTS(SELECT 1 FROM subscription_changes c WHERE c.id=o.subscription_change_id AND c.status IN ('pending','reviewing','processing','completed')) FROM orders o WHERE o.id=$1`, id).Scan(&protected); err != nil {
		return false, err
	}
	if protected {
		return false, ErrOrderNotRemovable
	}
	if removedAt != nil {
		return false, nil
	}
	_, err = tx.Exec(ctx, `UPDATE orders SET admin_deleted_at=now(),admin_deleted_by=$2 WHERE id=$1`, id, adminID)
	return err == nil, err
}
