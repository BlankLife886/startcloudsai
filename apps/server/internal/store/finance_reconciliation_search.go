package store

import (
	"context"
	"fmt"
)

// SearchPaymentReconciliations reports the latest check per order, then filters
// by check date. Counts use exactly the same scope as the requested page.
func SearchPaymentReconciliations(ctx context.Context, q Q, issues bool, limit, page int, f AdminListFilter) ([]*PaymentReconciliation, int64, error) {
	from := ` FROM (SELECT DISTINCT ON (order_id) * FROM payment_reconciliations ORDER BY order_id,id DESC) latest WHERE ($1=false OR outcome NOT IN ('matched','repaired','manual_not_created'))`
	args := []any{issues}
	from, args = appendAdminDates(from, args, "checked_at", []AdminListFilter{f})
	if f.Search != "" {
		args = append(args, literalSearch(f.Search))
		from += fmt.Sprintf(" AND (order_id::text ILIKE $%d OR COALESCE(detail,'') ILIKE $%d)", len(args), len(args))
	}
	var total int64
	if err := q.QueryRow(ctx, "SELECT count(*)"+from, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, (page-1)*limit)
	rows, err := q.Query(ctx, `SELECT id,order_id,provider,local_status,provider_state,expected_amount_cents,provider_amount_cents,provider_paid_amount_cents,outcome,detail,checked_at`+from+fmt.Sprintf(" ORDER BY checked_at DESC,id DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []*PaymentReconciliation{}
	for rows.Next() {
		item := &PaymentReconciliation{}
		if err := rows.Scan(&item.ID, &item.OrderID, &item.Provider, &item.LocalStatus, &item.ProviderState, &item.ExpectedAmountCents, &item.ProviderAmountCents, &item.ProviderPaidAmountCents, &item.Outcome, &item.Detail, &item.CheckedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}
