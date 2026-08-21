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
		`SELECT user_id, balance_cents, frozen_cents, trial_balance_cents, trial_frozen_cents, trial_feature_key, updated_at
		 FROM wallets WHERE user_id = $1`, userID).
		Scan(&w.UserID, &w.BalanceCents, &w.FrozenCents, &w.TrialBalanceCents, &w.TrialFrozenCents, &w.TrialFeatureKey, &w.UpdatedAt)
	return nilOnNoRows(&w, err)
}

func GetWalletsByUserIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]*Wallet, error) {
	out := map[uuid.UUID]*Wallet{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx,
		`SELECT user_id, balance_cents, frozen_cents, trial_balance_cents, trial_frozen_cents, trial_feature_key, updated_at
			 FROM wallets WHERE user_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var w Wallet
		if err := rows.Scan(&w.UserID, &w.BalanceCents, &w.FrozenCents, &w.TrialBalanceCents, &w.TrialFrozenCents, &w.TrialFeatureKey, &w.UpdatedAt); err != nil {
			return nil, err
		}
		out[w.UserID] = &w
	}
	return out, rows.Err()
}

func SumWalletBalance(ctx context.Context, q Q) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT COALESCE(SUM(balance_cents + trial_balance_cents), 0) FROM wallets`).Scan(&n)
	return n, err
}

const ledgerCols = `id, user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason, credit_bucket, created_at`

func scanLedger(row pgx.Row) (*LedgerEntry, error) {
	var e LedgerEntry
	err := row.Scan(&e.ID, &e.UserID, &e.Kind, &e.DeltaCents, &e.BalanceAfterCents, &e.SourceType, &e.SourceID, &e.Reason, &e.CreditBucket, &e.CreatedAt)
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

func InsertLedgerEntry(ctx context.Context, q Q, userID uuid.UUID, kind string, deltaCents, balanceAfterCents int64, sourceType string, sourceID, reason *string, creditBucket string) (*LedgerEntry, error) {
	return scanLedger(q.QueryRow(ctx,
		`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason, credit_bucket)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+ledgerCols,
		userID, kind, deltaCents, balanceAfterCents, sourceType, sourceID, reason, creditBucket))
}

// #nosec G101 -- this constant contains SQL column names, not credentials.
const taskCreditReservationCols = `task_id, generation, normal_cents, trial_cents,
	normal_remaining_cents, trial_remaining_cents, trial_feature_key, created_at, updated_at`

func scanTaskCreditReservation(row pgx.Row) (*TaskCreditReservation, error) {
	var reservation TaskCreditReservation
	err := row.Scan(
		&reservation.TaskID, &reservation.Generation,
		&reservation.NormalCents, &reservation.TrialCents,
		&reservation.NormalRemainingCents, &reservation.TrialRemainingCents,
		&reservation.TrialFeatureKey,
		&reservation.CreatedAt, &reservation.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &reservation, nil
}

func InsertTaskCreditReservation(ctx context.Context, q Q, taskID uuid.UUID, generation int, normalCents, trialCents int64, trialFeatureKey string) (*TaskCreditReservation, error) {
	return scanTaskCreditReservation(q.QueryRow(ctx,
		`INSERT INTO task_credit_reservations (
			task_id, generation, normal_cents, trial_cents,
			normal_remaining_cents, trial_remaining_cents, trial_feature_key
		 ) VALUES ($1, $2, $3, $4, $3, $4, NULLIF($5, '')) RETURNING `+taskCreditReservationCols,
		taskID, generation, normalCents, trialCents, trialFeatureKey))
}

func GetTaskCreditReservationForUpdate(ctx context.Context, q Q, taskID uuid.UUID, generation int) (*TaskCreditReservation, error) {
	item, err := scanTaskCreditReservation(q.QueryRow(ctx,
		`SELECT `+taskCreditReservationCols+`
		 FROM task_credit_reservations
		 WHERE task_id = $1 AND generation = $2
		 FOR UPDATE`, taskID, generation))
	return nilOnNoRows(item, err)
}

func GetActiveTaskCreditReservationForUpdate(ctx context.Context, q Q, taskID uuid.UUID) (*TaskCreditReservation, error) {
	item, err := scanTaskCreditReservation(q.QueryRow(ctx,
		`SELECT `+taskCreditReservationCols+`
		 FROM task_credit_reservations
		 WHERE task_id = $1 AND normal_remaining_cents + trial_remaining_cents > 0
		 ORDER BY generation DESC LIMIT 1
		 FOR UPDATE`, taskID))
	return nilOnNoRows(item, err)
}

func UpdateTaskCreditReservationRemaining(ctx context.Context, q Q, taskID uuid.UUID, generation int, normalRemainingCents, trialRemainingCents int64, at time.Time) error {
	_, err := q.Exec(ctx,
		`UPDATE task_credit_reservations
		 SET normal_remaining_cents = $3, trial_remaining_cents = $4, updated_at = $5
		 WHERE task_id = $1 AND generation = $2`,
		taskID, generation, normalRemainingCents, trialRemainingCents, at)
	return err
}

// CountTaskLedger 统计任务同 kind 账本条数（source_id = task_id 或 task_id/n）。
// 前缀匹配依赖 ix_wallet_ledger_task_source(text_pattern_ops) 走索引扫描。
func CountTaskLedger(ctx context.Context, q Q, taskID uuid.UUID, kind string) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM wallet_ledger
		 WHERE kind = $1 AND source_type = 'task' AND (source_id = $2 OR source_id LIKE $3)`,
		kind, taskID.String(), taskID.String()+"/%").Scan(&n)
	return n, err
}

// CountTaskCreditReservations 返回任务的冻结代数（等于 freeze 账本条数）。
// 每次 FreezeForTask 恰好插入一条 reservation，所以其行数即代数；走
// task_credit_reservations 主键前缀，避免 wallet_ledger 上的前缀扫描。
func CountTaskCreditReservations(ctx context.Context, q Q, taskID uuid.UUID) (int, error) {
	var n int
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM task_credit_reservations WHERE task_id = $1`, taskID).Scan(&n)
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

func CountUserLedger(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM wallet_ledger WHERE user_id = $1`, userID).Scan(&n)
	return n, err
}

func ListLedgerPage(ctx context.Context, q Q, userID uuid.UUID, limit, offset int) ([]*LedgerEntry, error) {
	if limit < 1 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := q.Query(ctx,
		`SELECT `+ledgerCols+` FROM wallet_ledger
		 WHERE user_id = $1
		 ORDER BY created_at DESC, id DESC
		 LIMIT $2 OFFSET $3`, userID, limit, offset)
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
// spend 账本 delta 为 0（结算只消耗冻结额），金额取关联图片任务或助手运行的
// cost_cents；记录被删除时退化为 ABS(delta_cents)。
func SpendDailySince(ctx context.Context, q Q, since time.Time) (map[string]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT (l.created_at AT TIME ZONE 'UTC')::date::text AS day,
		        COALESCE(SUM(GREATEST(
		            ABS(l.delta_cents), COALESCE(t.cost_cents, 0), COALESCE(a.cost_cents, 0)
		        )), 0)
		 FROM wallet_ledger l
		 LEFT JOIN tasks t ON l.source_type = 'task' AND t.id::text = l.source_id
		 LEFT JOIN assistant_runs a ON l.source_type = 'assistant_run'
		      AND a.id::text = split_part(l.source_id, '/', 1)
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

const walletLedgerExportBatch = 200
const walletLedgerExportMax = 8000

type WalletSourceTotal struct {
	SourceType string
	Cents      int64
	Count      int64
}

type WalletLedgerStats struct {
	ConsumedCents int64
	ConsumedCount int64
	RefundCents   int64
	RefundCount   int64
	IncomeCents   int64
	IncomeCount   int64
	EntryCount    int64
	Income        []WalletSourceTotal
}

// UserWalletLedgerStats 按来源汇总当前用户的入账、结算消耗与失败退回。
func UserWalletLedgerStats(ctx context.Context, q Q, userID uuid.UUID) (*WalletLedgerStats, error) {
	stats := &WalletLedgerStats{Income: []WalletSourceTotal{}}
	err := q.QueryRow(ctx,
		`SELECT
			COUNT(*),
			COUNT(*) FILTER (
				WHERE kind = 'spend' OR (kind = 'admin_adjust' AND delta_cents < 0)
			),
			COALESCE(SUM(
				CASE
					WHEN kind = 'spend' AND ABS(delta_cents) > 0 THEN ABS(delta_cents)
					WHEN kind = 'spend' THEN COALESCE(
						NULLIF((regexp_match(COALESCE(reason, ''), '消耗冻结 ([0-9]+)'))[1], '')::bigint,
						0
					)
					WHEN kind = 'admin_adjust' AND delta_cents < 0 THEN ABS(delta_cents)
					ELSE 0
				END
			), 0),
			COUNT(*) FILTER (WHERE kind = 'release'),
			COALESCE(SUM(delta_cents) FILTER (WHERE kind = 'release'), 0),
			COUNT(*) FILTER (
				WHERE kind = 'grant' OR kind = 'refund' OR (kind = 'admin_adjust' AND delta_cents > 0)
			),
			COALESCE(SUM(delta_cents) FILTER (
				WHERE kind = 'grant' OR kind = 'refund' OR (kind = 'admin_adjust' AND delta_cents > 0)
			), 0)
		 FROM wallet_ledger WHERE user_id = $1`, userID).Scan(
		&stats.EntryCount,
		&stats.ConsumedCount,
		&stats.ConsumedCents,
		&stats.RefundCount,
		&stats.RefundCents,
		&stats.IncomeCount,
		&stats.IncomeCents,
	)
	if err != nil {
		return nil, err
	}

	rows, err := q.Query(ctx,
		`SELECT source_type, COUNT(*), COALESCE(SUM(delta_cents), 0)
		 FROM wallet_ledger
		 WHERE user_id = $1
		   AND (kind = 'grant' OR kind = 'refund' OR (kind = 'admin_adjust' AND delta_cents > 0))
		 GROUP BY source_type
		 ORDER BY SUM(delta_cents) DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item WalletSourceTotal
		if err := rows.Scan(&item.SourceType, &item.Count, &item.Cents); err != nil {
			return nil, err
		}
		stats.Income = append(stats.Income, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// spend 账本 delta 常为 0，补上关联任务 / 助手运行的实扣。
	var joinedSpend int64
	err = q.QueryRow(ctx,
		`SELECT COALESCE(SUM(GREATEST(COALESCE(t.cost_cents, 0), COALESCE(a.cost_cents, 0))), 0)
		 FROM wallet_ledger l
		 LEFT JOIN tasks t ON l.source_type = 'task' AND t.id::text = l.source_id
		 LEFT JOIN assistant_runs a ON l.source_type = 'assistant_run'
		      AND a.id::text = split_part(COALESCE(l.source_id, ''), '/', 1)
		 WHERE l.user_id = $1 AND l.kind = 'spend' AND l.delta_cents = 0
		   AND COALESCE((regexp_match(COALESCE(l.reason, ''), '消耗冻结 ([0-9]+)'))[1], '') = ''`,
		userID).Scan(&joinedSpend)
	if err != nil {
		return nil, err
	}
	stats.ConsumedCents += joinedSpend
	return stats, nil
}

// ListAllUserLedger 导出用：按时间倒序拉齐当前用户账本，最多 walletLedgerExportMax 条。
func ListAllUserLedger(ctx context.Context, q Q, userID uuid.UUID) ([]*LedgerEntry, error) {
	out := make([]*LedgerEntry, 0, 64)
	var cursor *Cursor
	for len(out) < walletLedgerExportMax {
		limit := walletLedgerExportBatch
		if remain := walletLedgerExportMax - len(out); remain < limit {
			limit = remain
		}
		batch, err := ListLedger(ctx, q, userID, limit, cursor)
		if err != nil {
			return nil, err
		}
		hasMore := len(batch) > limit
		if hasMore {
			batch = batch[:limit]
		}
		out = append(out, batch...)
		if !hasMore || len(batch) == 0 {
			break
		}
		createdAt, id := batch[len(batch)-1].CursorKey()
		cursor = &Cursor{CreatedAt: createdAt, ID: id}
	}
	return out, nil
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
