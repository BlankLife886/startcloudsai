package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const orderCols = `id, user_id, plan_id, amount_cents, grant_cents, bonus_cents, status, provider,
	provider_order_id, provider_pay_amount_cents, payment_method, provider_pay_url, requires_manual_amount,
	provider_expires_at, paid_at, completed_at, created_at`

func scanOrder(row pgx.Row) (*Order, error) {
	var o Order
	err := row.Scan(&o.ID, &o.UserID, &o.PlanID, &o.AmountCents, &o.GrantCents, &o.BonusCents, &o.Status,
		&o.Provider, &o.ProviderOrderID, &o.ProviderPayAmountCents, &o.PaymentMethod,
		&o.ProviderPayURL, &o.RequiresManualAmount, &o.ProviderExpiresAt,
		&o.PaidAt, &o.CompletedAt, &o.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func GetOrInsertPendingOrder(ctx context.Context, st *Store, userID, planID uuid.UUID, amountCents, grantCents, bonusCents int64, provider string) (*Order, bool, error) {
	var order *Order
	created := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		lockKey := userID.String() + ":" + planID.String()
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
			return err
		}
		existing, err := scanOrder(tx.QueryRow(ctx, `SELECT `+orderCols+` FROM orders
			WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
			ORDER BY created_at DESC LIMIT 1`, userID, planID))
		if err == nil {
			order = existing
			return nil
		}
		if err != pgx.ErrNoRows {
			return err
		}
		order, err = InsertOrder(ctx, tx, userID, planID, amountCents, grantCents, bonusCents, provider)
		if err == nil {
			created = true
		}
		return err
	})
	return order, created, err
}

func InsertOrder(ctx context.Context, q Q, userID, planID uuid.UUID, amountCents, grantCents, bonusCents int64, provider string) (*Order, error) {
	return scanOrder(q.QueryRow(ctx,
		`INSERT INTO orders (user_id, plan_id, amount_cents, grant_cents, bonus_cents, provider)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+orderCols,
		userID, planID, amountCents, grantCents, bonusCents, provider))
}

func GetOrder(ctx context.Context, q Q, id uuid.UUID) (*Order, error) {
	o, err := scanOrder(q.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id = $1`, id))
	return nilOnNoRows(o, err)
}

func GetUserOrder(ctx context.Context, q Q, userID, id uuid.UUID) (*Order, error) {
	o, err := scanOrder(q.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(o, err)
}

func ListPendingOrdersForPlan(ctx context.Context, q Q, userID, planID uuid.UUID) ([]*Order, error) {
	rows, err := q.Query(ctx, `SELECT `+orderCols+` FROM orders
		WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
		ORDER BY created_at DESC`, userID, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	orders := make([]*Order, 0)
	for rows.Next() {
		order, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}
	return orders, rows.Err()
}

func SetOrderProviderDetails(ctx context.Context, q Q, id uuid.UUID, providerOrderID string, payAmountCents int64,
	paymentMethod, payURL string, requiresManualAmount bool, expiresAt *time.Time,
) (*Order, error) {
	return scanOrder(q.QueryRow(ctx,
		`UPDATE orders SET provider_order_id = $2, provider_pay_amount_cents = $3, payment_method = $4,
			provider_pay_url = $5, requires_manual_amount = $6, provider_expires_at = $7
		 WHERE id = $1 AND status = 'pending' RETURNING `+orderCols,
		id, providerOrderID, payAmountCents, paymentMethod, payURL, requiresManualAmount, expiresAt))
}

func UpdateOrderPaymentDisplay(ctx context.Context, q Q, id uuid.UUID, payURL string, requiresManualAmount bool, expiresAt *time.Time) (*Order, error) {
	return scanOrder(q.QueryRow(ctx,
		`UPDATE orders SET
			provider_pay_url = CASE WHEN btrim($2) <> '' THEN $2 ELSE provider_pay_url END,
			requires_manual_amount = $3,
			provider_expires_at = COALESCE($4, provider_expires_at)
		 WHERE id = $1 RETURNING `+orderCols,
		id, payURL, requiresManualAmount, expiresAt))
}

func TransitionPendingOrderStatus(ctx context.Context, q Q, id uuid.UUID, status string) (bool, error) {
	if status != "failed" && status != "expired" {
		return false, fmt.Errorf("unsupported pending order transition: %s", status)
	}
	tag, err := q.Exec(ctx, `UPDATE orders SET status = $2 WHERE id = $1 AND status = 'pending'`, id, status)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// CompleteOrderUpdate 条件更新 pending/paid/expired → completed，返回是否抢到。
// expired 也允许由签名回调或主动对账恢复，避免关闭与支付回调竞态导致漏发权益。
func CompleteOrderUpdate(ctx context.Context, q Q, id uuid.UUID, now time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE orders SET status = 'completed', completed_at = $2, paid_at = COALESCE(paid_at, $2)
		 WHERE id = $1 AND status IN ('pending', 'paid', 'expired')`, id, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListOrders 订单分页（limit+1 行）。userID 为 nil 时查全站（后台）。
func ListOrders(ctx context.Context, q Q, userID *uuid.UUID, status string, userIDs []uuid.UUID, limit int, cursor *Cursor) ([]*Order, error) {
	sql := `SELECT ` + orderCols + ` FROM orders WHERE true`
	args := []any{}
	if userID != nil {
		args = append(args, *userID)
		sql += fmt.Sprintf(` AND user_id = $%d`, len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	if userIDs != nil {
		args = append(args, userIDs)
		sql += fmt.Sprintf(` AND user_id = ANY($%d)`, len(args))
	}
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// RevenueSince 近 N 日已完成订单收入合计（按下单时间）。
func RevenueSince(ctx context.Context, q Q, since time.Time) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT COALESCE(SUM(COALESCE(provider_pay_amount_cents, amount_cents)), 0)
		 FROM orders WHERE status = 'completed' AND created_at >= $1`, since).Scan(&n)
	return n, err
}

// RevenueDailySince 已完成订单按天收入（UTC 日期 → 分，按下单时间）。
func RevenueDailySince(ctx context.Context, q Q, since time.Time) (map[string]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
		 COALESCE(SUM(COALESCE(provider_pay_amount_cents, amount_cents)), 0)
		 FROM orders WHERE status = 'completed' AND created_at >= $1 GROUP BY day`, since)
	if err != nil {
		return nil, err
	}
	return scanDailyCents(rows)
}

// CountOrdersByUser 用户订单总数。
func CountOrdersByUser(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM orders WHERE user_id = $1`, userID).Scan(&n)
	return n, err
}

// ListOrdersForReconciliation returns recent Lanjing orders that can carry
// money. Failed create-order attempts without a provider ID are excluded.
func ListOrdersForReconciliation(ctx context.Context, q Q, since time.Time, limit int) ([]*Order, error) {
	rows, err := q.Query(ctx, `SELECT `+orderCols+` FROM orders
		WHERE provider='lanjing' AND provider_order_id IS NOT NULL AND created_at >= $1
		ORDER BY created_at DESC LIMIT $2`, since, min(max(limit, 1), 500))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []*Order{}
	for rows.Next() {
		item, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
