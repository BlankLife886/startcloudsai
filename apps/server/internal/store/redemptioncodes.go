package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const redemptionCols = `id, code, grant_cents, batch_id, note, status, expires_at, redeemed_by, redeemed_at, created_by, created_at`

func scanRedemptionCode(row pgx.Row) (*RedemptionCode, error) {
	var r RedemptionCode
	err := row.Scan(&r.ID, &r.Code, &r.GrantCents, &r.BatchID, &r.Note, &r.Status,
		&r.ExpiresAt, &r.RedeemedBy, &r.RedeemedAt, &r.CreatedBy, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// InsertRedemptionCode 单条插入（批量生成时在调用方事务内循环）。
func InsertRedemptionCode(ctx context.Context, q Q, code string, grantCents int64, batchID string, note *string, expiresAt *time.Time, createdBy uuid.UUID) (*RedemptionCode, error) {
	return scanRedemptionCode(q.QueryRow(ctx,
		`INSERT INTO redemption_codes (code, grant_cents, batch_id, note, expires_at, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+redemptionCols,
		code, grantCents, batchID, note, expiresAt, createdBy))
}

func GetRedemptionCode(ctx context.Context, q Q, id uuid.UUID) (*RedemptionCode, error) {
	r, err := scanRedemptionCode(q.QueryRow(ctx,
		`SELECT `+redemptionCols+` FROM redemption_codes WHERE id = $1`, id))
	return nilOnNoRows(r, err)
}

func GetRedemptionCodeByCode(ctx context.Context, q Q, code string) (*RedemptionCode, error) {
	r, err := scanRedemptionCode(q.QueryRow(ctx,
		`SELECT `+redemptionCols+` FROM redemption_codes WHERE code = $1`, code))
	return nilOnNoRows(r, err)
}

// RedeemCodeUpdate 条件更新兑换：仅 active 且未过期可兑换，返回抢到的行（nil = 未抢到）。
func RedeemCodeUpdate(ctx context.Context, q Q, code string, userID uuid.UUID, now time.Time) (*RedemptionCode, error) {
	r, err := scanRedemptionCode(q.QueryRow(ctx,
		`UPDATE redemption_codes SET status = 'redeemed', redeemed_by = $2, redeemed_at = $3
		 WHERE code = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > $3)
		 RETURNING `+redemptionCols, code, userID, now))
	return nilOnNoRows(r, err)
}

// DisableRedemptionCode 条件更新 active→disabled，返回是否抢到。
func DisableRedemptionCode(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE redemption_codes SET status = 'disabled' WHERE id = $1 AND status = 'active'`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListRedemptionCodes 后台分页（limit+1 行），LEFT JOIN users 带出 redeemedByEmail。
// search 匹配完整 code。
func ListRedemptionCodes(ctx context.Context, q Q, status, batchID, search string, limit int, cursor *Cursor) ([]*RedemptionCode, error) {
	sql := `SELECT r.id, r.code, r.grant_cents, r.batch_id, r.note, r.status, r.expires_at,
	               r.redeemed_by, r.redeemed_at, r.created_by, r.created_at, u.email
	        FROM redemption_codes r LEFT JOIN users u ON u.id = r.redeemed_by WHERE true`
	args := []any{}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND r.status = $%d`, len(args))
	}
	if batchID != "" {
		args = append(args, batchID)
		sql += fmt.Sprintf(` AND r.batch_id = $%d`, len(args))
	}
	if search != "" {
		args = append(args, search)
		sql += fmt.Sprintf(` AND r.code = $%d`, len(args))
	}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		sql += fmt.Sprintf(` AND (r.created_at < $%d OR (r.created_at = $%d AND r.id < $%d))`, len(args)-1, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY r.created_at DESC, r.id DESC LIMIT $%d`, len(args))

	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*RedemptionCode
	for rows.Next() {
		var r RedemptionCode
		if err := rows.Scan(&r.ID, &r.Code, &r.GrantCents, &r.BatchID, &r.Note, &r.Status,
			&r.ExpiresAt, &r.RedeemedBy, &r.RedeemedAt, &r.CreatedBy, &r.CreatedAt, &r.RedeemedByEmail); err != nil {
			return nil, err
		}
		out = append(out, &r)
	}
	return out, rows.Err()
}

// RedemptionBatch 批次汇总行。
type RedemptionBatch struct {
	BatchID    string
	Note       *string
	GrantCents int64
	Total      int64
	Redeemed   int64
	Disabled   int64
	CreatedAt  time.Time
}

// ListRedemptionBatches 按批次聚合，近 n 批（按批次创建时间倒序）。
func ListRedemptionBatches(ctx context.Context, q Q, n int) ([]*RedemptionBatch, error) {
	rows, err := q.Query(ctx,
		`SELECT batch_id, MAX(note), MAX(grant_cents),
		        count(*),
		        count(*) FILTER (WHERE status = 'redeemed'),
		        count(*) FILTER (WHERE status = 'disabled'),
		        MIN(created_at)
		 FROM redemption_codes GROUP BY batch_id
		 ORDER BY MIN(created_at) DESC LIMIT $1`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*RedemptionBatch
	for rows.Next() {
		var b RedemptionBatch
		if err := rows.Scan(&b.BatchID, &b.Note, &b.GrantCents, &b.Total, &b.Redeemed, &b.Disabled, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &b)
	}
	return out, rows.Err()
}
