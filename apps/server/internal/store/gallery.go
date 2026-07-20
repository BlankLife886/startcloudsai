package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const submissionCols = `id, user_id, task_id, title, status, cover_key, media_keys, reject_reason,
	reviewed_by, reviewed_at, created_at`

func scanSubmission(row pgx.Row) (*GallerySubmission, error) {
	var s GallerySubmission
	err := row.Scan(&s.ID, &s.UserID, &s.TaskID, &s.Title, &s.Status, &s.CoverKey, &s.MediaKeys,
		&s.RejectReason, &s.ReviewedBy, &s.ReviewedAt, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func InsertSubmission(ctx context.Context, q Q, userID, taskID uuid.UUID, title *string, coverKey *string, mediaKeys []string) (*GallerySubmission, error) {
	if mediaKeys == nil {
		mediaKeys = []string{}
	}
	return scanSubmission(q.QueryRow(ctx,
		`INSERT INTO gallery_submissions (user_id, task_id, title, cover_key, media_keys)
		 VALUES ($1, $2, $3, $4, $5) RETURNING `+submissionCols,
		userID, taskID, title, coverKey, mediaKeys))
}

func GetSubmission(ctx context.Context, q Q, id uuid.UUID) (*GallerySubmission, error) {
	s, err := scanSubmission(q.QueryRow(ctx, `SELECT `+submissionCols+` FROM gallery_submissions WHERE id = $1`, id))
	return nilOnNoRows(s, err)
}

func GetUserSubmission(ctx context.Context, q Q, userID, id uuid.UUID) (*GallerySubmission, error) {
	s, err := scanSubmission(q.QueryRow(ctx,
		`SELECT `+submissionCols+` FROM gallery_submissions WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(s, err)
}

func GetSubmissionByTaskID(ctx context.Context, q Q, taskID uuid.UUID) (*GallerySubmission, error) {
	s, err := scanSubmission(q.QueryRow(ctx,
		`SELECT `+submissionCols+` FROM gallery_submissions WHERE task_id = $1`, taskID))
	return nilOnNoRows(s, err)
}

func DeleteSubmission(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM gallery_submissions WHERE id = $1`, id)
	return err
}

func DeleteSubmissionByTaskID(ctx context.Context, q Q, taskID uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM gallery_submissions WHERE task_id = $1`, taskID)
	return err
}

// ReviewSubmission 更新审核结果。
func ReviewSubmission(ctx context.Context, q Q, id uuid.UUID, status string, rejectReason *string, reviewedBy uuid.UUID, reviewedAt time.Time) error {
	_, err := q.Exec(ctx,
		`UPDATE gallery_submissions SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = $5 WHERE id = $1`,
		id, status, rejectReason, reviewedBy, reviewedAt)
	return err
}

// ListSubmissions 投稿分页（limit+1 行）。userID 非 nil 查个人投稿。
func ListSubmissions(ctx context.Context, q Q, userID *uuid.UUID, status string, limit int, cursor *Cursor) ([]*GallerySubmission, error) {
	sql := `SELECT ` + submissionCols + ` FROM gallery_submissions WHERE true`
	args := []any{}
	if userID != nil {
		args = append(args, *userID)
		sql += fmt.Sprintf(` AND user_id = $%d`, len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*GallerySubmission
	for rows.Next() {
		s, err := scanSubmission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// IsPublicGalleryKey key 是否属于已过审投稿的 cover_key/media_keys。
func IsPublicGalleryKey(ctx context.Context, q Q, key string) (bool, error) {
	var one int
	err := q.QueryRow(ctx,
		`SELECT 1 FROM gallery_submissions
		 WHERE status = 'approved' AND (cover_key = $1 OR media_keys @> to_jsonb($1::text)) LIMIT 1`, key).Scan(&one)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
