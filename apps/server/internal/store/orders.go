package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const orderCols = `id, user_id, plan_id, amount_cents, grant_cents, bonus_cents, status, provider,
	provider_order_id, paid_at, completed_at, created_at`

func scanOrder(row pgx.Row) (*Order, error) {
	var o Order
	err := row.Scan(&o.ID, &o.UserID, &o.PlanID, &o.AmountCents, &o.GrantCents, &o.BonusCents, &o.Status,
		&o.Provider, &o.ProviderOrderID, &o.PaidAt, &o.CompletedAt, &o.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &o, nil
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

// CompleteOrderUpdate 条件更新 pending/paid → completed，返回是否抢到。
func CompleteOrderUpdate(ctx context.Context, q Q, id uuid.UUID, now time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE orders SET status = 'completed', completed_at = $2, paid_at = COALESCE(paid_at, $2)
		 WHERE id = $1 AND status IN ('pending', 'paid')`, id, now)
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
		`SELECT COALESCE(SUM(amount_cents), 0) FROM orders WHERE status = 'completed' AND created_at >= $1`, since).Scan(&n)
	return n, err
}
