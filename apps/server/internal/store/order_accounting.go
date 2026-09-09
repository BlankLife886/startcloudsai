package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type OrderFilter struct {
	SubscriptionID                                             *uuid.UUID
	PlanID                                                     *uuid.UUID
	PlanRevision                                               *int
	ID                                                         *uuid.UUID
	PendingOnly                                                bool
	Status, Kind, PaymentMethod, RefundState, Delivery, Search string
	UserID                                                     *uuid.UUID
	From, To                                                   *time.Time
	MinAmount, MaxAmount                                       *int64
}

type OrderFinance struct {
	Kind                  string     `json:"kind"`
	SubscriptionID        *uuid.UUID `json:"subscriptionId"`
	ReceivedCents         int64      `json:"receivedCents"`
	ReceiptConfirmed      bool       `json:"receiptConfirmed"`
	RefundedCents         *int64     `json:"refundedCents"`
	NetCents              *int64     `json:"netCents"`
	RelatedRefundCents    int64      `json:"relatedRefundCents"`
	RefundPendingCents    int64      `json:"refundPendingCents"`
	RefundNeedsAllocation bool       `json:"refundNeedsAllocation"`
	Delivery              string     `json:"delivery"`
}

type AccountingOrder struct {
	*Order
	Finance         OrderFinance
	Email, Username string
}

type OrderAccountingSummary struct {
	Total                  int64  `json:"total"`
	ConfirmedOrders        int64  `json:"confirmedOrders"`
	PendingOrders          int64  `json:"pendingOrders"`
	ReceivedCents          int64  `json:"receivedCents"`
	RefundedCents          int64  `json:"refundedCents"`
	NetCents               *int64 `json:"netCents"`
	UnallocatedRefundCents int64  `json:"unallocatedRefundCents"`
	PartialRefundCents     int64  `json:"partialRefundCents"`
}

// Refunds without per-payment attribution are never copied into every upgrade order.
const orderAccountingCTE = `WITH linked AS (
 SELECT o.*,COALESCE(u.email,'') AS account_email,COALESCE(u.username,'') AS account_username,
 COALESCE(ch.subscription_id,(SELECT p.subscription_id FROM subscription_periods p WHERE p.order_id=o.id LIMIT 1),
 (SELECT s.id FROM subscriptions s WHERE s.order_id=o.id LIMIT 1)) AS account_subscription_id,
 CASE WHEN o.subscription_change_id IS NOT NULL THEN 'upgrade' WHEN o.recharge_policy_snapshot IS NOT NULL THEN 'recharge'
 WHEN o.plan_kind_snapshot='subscription' THEN 'subscription' WHEN o.plan_kind_snapshot='topup' THEN 'topup' ELSE 'legacy' END AS account_kind,
 o.status IN ('paid','completed') AS receipt_confirmed,
 CASE WHEN o.status IN ('paid','completed') THEN COALESCE(o.provider_pay_amount_cents,o.amount_cents) ELSE 0 END AS received_cents,
 CASE WHEN o.status='completed' THEN CASE WHEN
 EXISTS(SELECT 1 FROM wallet_ledger l WHERE l.user_id=o.user_id AND l.source_type='order' AND l.source_id=o.id::text AND l.kind='grant')
 OR EXISTS(SELECT 1 FROM subscription_periods p WHERE p.order_id=o.id)
 OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.order_id=o.id)
 OR (ch.kind='upgrade' AND ch.status='completed') THEN 'delivered' ELSE 'missing' END
 WHEN o.status='paid' THEN 'pending' ELSE 'not_due' END AS delivery
 FROM orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN subscription_changes ch ON ch.id=o.subscription_change_id
), payment_groups AS (
 SELECT account_subscription_id,count(*) AS paid_count FROM linked WHERE receipt_confirmed AND received_cents>0 AND account_subscription_id IS NOT NULL GROUP BY account_subscription_id
), refunds AS (
 SELECT subscription_id,COALESCE(sum(amount_cents) FILTER(WHERE status='completed'),0) AS refund_total,
 COALESCE(sum(amount_cents) FILTER(WHERE status IN ('reviewing','processing')),0) AS refund_pending
 FROM subscription_changes WHERE kind='refund' GROUP BY subscription_id
), book AS (
 SELECT linked.*,COALESCE(g.paid_count,0) AS paid_count,COALESCE(r.refund_total,0) AS refund_total,COALESCE(r.refund_pending,0) AS refund_pending,
 (receipt_confirmed AND received_cents>0 AND COALESCE(r.refund_total,0)>0 AND g.paid_count>1) AS refund_unallocated,
 CASE WHEN NOT receipt_confirmed OR received_cents<=0 THEN 0 WHEN COALESCE(r.refund_total,0)=0 THEN 0 WHEN g.paid_count=1 THEN r.refund_total ELSE NULL END AS refunded_cents
 FROM linked LEFT JOIN payment_groups g USING(account_subscription_id) LEFT JOIN refunds r ON r.subscription_id=linked.account_subscription_id
) `

func (f OrderFilter) where() (string, []any) {
	clauses := []string{"true"}
	if f.ID == nil {
		clauses = append(clauses, orderVisibleSQL("book"))
	}
	args := []any{}
	add := func(sql string, value any) {
		args = append(args, value)
		clauses = append(clauses, fmt.Sprintf(sql, len(args)))
	}
	if f.Status != "" {
		add("status=$%d", f.Status)
	}
	if f.Kind != "" {
		add("account_kind=$%d", f.Kind)
	}
	if f.PaymentMethod != "" {
		add("payment_method=$%d", f.PaymentMethod)
	}
	if f.Delivery != "" {
		add("delivery=$%d", f.Delivery)
	}
	if f.UserID != nil {
		add("user_id=$%d", *f.UserID)
	}
	if f.SubscriptionID != nil {
		add("account_subscription_id=$%d", *f.SubscriptionID)
	}
	if f.PlanID != nil {
		add("plan_id=$%d", *f.PlanID)
	}
	if f.PlanRevision != nil {
		add("plan_revision_snapshot=$%d", *f.PlanRevision)
	}
	if f.ID != nil {
		add("id=$%d", *f.ID)
	}
	if f.PendingOnly {
		clauses = append(clauses, "status IN ('pending','uncertain','paid')")
	}
	if f.From != nil {
		add("created_at >= $%d", *f.From)
	}
	if f.To != nil {
		add("created_at < $%d", *f.To)
	}
	if f.MinAmount != nil {
		add("amount_cents >= $%d", *f.MinAmount)
	}
	if f.MaxAmount != nil {
		add("amount_cents <= $%d", *f.MaxAmount)
	}
	if f.Search != "" {
		args = append(args, f.Search)
		n := len(args)
		clauses = append(clauses, fmt.Sprintf(`strpos(lower(concat_ws(' ',id::text,user_id::text,provider_order_id,plan_name_snapshot,account_email,account_username)),lower($%d))>0`, n))
	}
	switch f.RefundState {
	case "none":
		clauses = append(clauses, "NOT EXISTS(SELECT 1 FROM subscription_changes c WHERE c.subscription_id=account_subscription_id AND c.kind='refund' AND c.status IN ('reviewing','processing','completed'))")
	case "pending":
		clauses = append(clauses, "refund_pending>0 OR EXISTS(SELECT 1 FROM subscription_changes c WHERE c.subscription_id=account_subscription_id AND c.kind='refund' AND c.status IN ('reviewing','processing'))")
	case "completed":
		clauses = append(clauses, "EXISTS(SELECT 1 FROM subscription_changes c WHERE c.subscription_id=account_subscription_id AND c.kind='refund' AND c.status='completed')")
	case "unallocated":
		clauses = append(clauses, "refund_unallocated")
	}
	for i := range clauses {
		clauses[i] = "(" + clauses[i] + ")"
	}
	return strings.Join(clauses, " AND "), args
}

type accountingRow struct {
	pgx.Row
	extra []any
}

func (r accountingRow) Scan(dest ...any) error { return r.Row.Scan(append(dest, r.extra...)...) }

func ListOrderAccounting(ctx context.Context, q Q, f OrderFilter, limit int, cursor *Cursor) ([]*AccountingOrder, error) {
	where, args := f.where()
	sql := orderAccountingCTE + `SELECT ` + orderCols + `,account_kind,account_subscription_id,received_cents,receipt_confirmed,refunded_cents,
 received_cents-refunded_cents,refund_total,refund_pending,refund_unallocated,delivery,account_email,account_username FROM book WHERE ` + where
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AccountingOrder{}
	for rows.Next() {
		a := &AccountingOrder{}
		v := &a.Finance
		a.Order, err = scanOrder(accountingRow{rows, []any{&v.Kind, &v.SubscriptionID, &v.ReceivedCents, &v.ReceiptConfirmed, &v.RefundedCents, &v.NetCents, &v.RelatedRefundCents, &v.RefundPendingCents, &v.RefundNeedsAllocation, &v.Delivery, &a.Email, &a.Username}})
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func SummarizeOrderAccounting(ctx context.Context, q Q, f OrderFilter) (OrderAccountingSummary, error) {
	where, args := f.where()
	s := OrderAccountingSummary{}
	sql := orderAccountingCTE + `, selected AS(SELECT * FROM book WHERE ` + where + `), refund_scope AS(
 SELECT account_subscription_id,max(paid_count) AS all_paid,count(*) FILTER(WHERE receipt_confirmed AND received_cents>0) AS selected_paid,max(refund_total) AS amount
 FROM selected WHERE account_subscription_id IS NOT NULL GROUP BY account_subscription_id)
 SELECT count(*),count(*) FILTER(WHERE receipt_confirmed),count(*) FILTER(WHERE status IN ('pending','uncertain','paid')),
 COALESCE(sum(received_cents),0),
 COALESCE((SELECT sum(amount) FROM refund_scope WHERE selected_paid>0 AND selected_paid=all_paid),0),
 COALESCE((SELECT sum(amount) FROM refund_scope WHERE selected_paid>0 AND all_paid>1),0),
 COALESCE((SELECT sum(amount) FROM refund_scope WHERE selected_paid>0 AND selected_paid<all_paid),0)
 FROM selected`
	err := q.QueryRow(ctx, sql, args...).Scan(&s.Total, &s.ConfirmedOrders, &s.PendingOrders, &s.ReceivedCents, &s.RefundedCents, &s.UnallocatedRefundCents, &s.PartialRefundCents)
	if err == nil && s.PartialRefundCents == 0 {
		net := s.ReceivedCents - s.RefundedCents
		s.NetCents = &net
	}
	return s, err
}
