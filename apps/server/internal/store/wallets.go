package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func InsertWallet(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID)
	return err
}

func GetWallet(ctx context.Context, q Q, userID uuid.UUID) (*Wallet, error) {
	var w Wallet
	err := q.QueryRow(ctx,
		`SELECT user_id, balance_cents, frozen_cents, updated_at FROM wallets WHERE user_id = $1`, userID).
		Scan(&w.UserID, &w.BalanceCents, &w.FrozenCents, &w.UpdatedAt)
	return nilOnNoRows(&w, err)
}

func GetWalletsByUserIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]*Wallet, error) {
	out := map[uuid.UUID]*Wallet{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx,
		`SELECT user_id, balance_cents, frozen_cents, updated_at FROM wallets WHERE user_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var w Wallet
		if err := rows.Scan(&w.UserID, &w.BalanceCents, &w.FrozenCents, &w.UpdatedAt); err != nil {
			return nil, err
		}
		out[w.UserID] = &w
	}
	return out, rows.Err()
}

func SumWalletBalance(ctx context.Context, q Q) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT COALESCE(SUM(balance_cents), 0) FROM wallets`).Scan(&n)
	return n, err
}

const ledgerCols = `id, user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason, created_at`

func scanLedger(row pgx.Row) (*LedgerEntry, error) {
	var e LedgerEntry
	err := row.Scan(&e.ID, &e.UserID, &e.Kind, &e.DeltaCents, &e.BalanceAfterCents, &e.SourceType, &e.SourceID, &e.Reason, &e.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func GetLedgerEntry(ctx context.Context, q Q, kind, sourceType, sourceID string) (*LedgerEntry, error) {
	e, err := scanLedger(q.QueryRow(ctx,
		`SELECT `+ledgerCols+` FROM wallet_ledger WHERE kind = $1 AND source_type = $2 AND source_id = $3`,
		kind, sourceType, sourceID))
	return nilOnNoRows(e, err)
}

func InsertLedgerEntry(ctx context.Context, q Q, userID uuid.UUID, kind string, deltaCents, balanceAfterCents int64, sourceType string, sourceID, reason *string) (*LedgerEntry, error) {
	return scanLedger(q.QueryRow(ctx,
		`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+ledgerCols,
		userID, kind, deltaCents, balanceAfterCents, sourceType, sourceID, reason))
}

// CountTaskLedger 统计任务同 kind 账本条数（source_id = task_id 或 task_id/n）。
func CountTaskLedger(ctx context.Context, q Q, taskID uuid.UUID, kind string) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM wallet_ledger
		 WHERE kind = $1 AND source_type = 'task' AND (source_id = $2 OR source_id LIKE $3)`,
		kind, taskID.String(), taskID.String()+"/%").Scan(&n)
	return n, err
}

// ListLedger 用户账本分页（limit+1 行）。
func ListLedger(ctx context.Context, q Q, userID uuid.UUID, limit int, cursor *Cursor) ([]*LedgerEntry, error) {
	return ListLedgerFiltered(ctx, q, &userID, "", "", nil, limit, cursor)
}

// ListLedgerFiltered 账本分页（limit+1 行），用户端与后台全站复用。
// userID 精确定位单个用户；userIDs 为后台 user 关键字匹配出的候选集（nil = 不过滤）。
func ListLedgerFiltered(ctx context.Context, q Q, userID *uuid.UUID, kind, sourceType string, userIDs []uuid.UUID, limit int, cursor *Cursor) ([]*LedgerEntry, error) {
	sql := `SELECT ` + ledgerCols + ` FROM wallet_ledger WHERE true`
	args := []any{}
	if userID != nil {
		args = append(args, *userID)
		sql += fmt.Sprintf(` AND user_id = $%d`, len(args))
	}
	if kind != "" {
		args = append(args, kind)
		sql += fmt.Sprintf(` AND kind = $%d`, len(args))
	}
	if sourceType != "" {
		args = append(args, sourceType)
		sql += fmt.Sprintf(` AND source_type = $%d`, len(args))
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
	var out []*LedgerEntry
	for rows.Next() {
		e, err := scanLedger(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// SpendDailySince 每日任务结算消耗（UTC 日期 → 分）。
// spend 账本 delta 为 0（结算只消耗冻结额），金额取关联任务的 cost_cents；
// 任务被删除时退化为 ABS(delta_cents)。
func SpendDailySince(ctx context.Context, q Q, since time.Time) (map[string]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT (l.created_at AT TIME ZONE 'UTC')::date::text AS day,
		        COALESCE(SUM(GREATEST(ABS(l.delta_cents), COALESCE(t.cost_cents, 0))), 0)
		 FROM wallet_ledger l
		 LEFT JOIN tasks t ON l.source_type = 'task' AND t.id::text = l.source_id
		 WHERE l.kind = 'spend' AND l.created_at >= $1
		 GROUP BY day`, since)
	if err != nil {
		return nil, err
	}
	return scanDailyCents(rows)
}

// FinanceTotalsSince 汇总区间内 grant（全部入账 + admin_adjust 正数）与 refund（release 解冻退还）。
func FinanceTotalsSince(ctx context.Context, q Q, since time.Time) (grantCents, refundCents int64, err error) {
	err = q.QueryRow(ctx,
		`SELECT COALESCE(SUM(delta_cents) FILTER (WHERE kind = 'grant'), 0)
		      + COALESCE(SUM(delta_cents) FILTER (WHERE kind = 'admin_adjust' AND delta_cents > 0), 0),
		        COALESCE(SUM(delta_cents) FILTER (WHERE kind = 'release'), 0)
		 FROM wallet_ledger WHERE created_at >= $1`, since).Scan(&grantCents, &refundCents)
	return grantCents, refundCents, err
}

func scanDailyCents(rows pgx.Rows) (map[string]int64, error) {
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var day string
		var cents int64
		if err := rows.Scan(&day, &cents); err != nil {
			return nil, err
		}
		out[day] = cents
	}
	return out, rows.Err()
}
