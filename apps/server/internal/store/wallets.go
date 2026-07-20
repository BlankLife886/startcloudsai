package store

import (
	"context"

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
	sql := `SELECT ` + ledgerCols + ` FROM wallet_ledger WHERE user_id = $1`
	args := []any{userID}
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
