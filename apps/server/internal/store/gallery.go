package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const submissionCols = `id, user_id, task_id, title, status, cover_key, media_keys, reject_reason,
	reviewed_by, reviewed_at, featured, category_id, sort, created_at`

func scanSubmission(row pgx.Row) (*GallerySubmission, error) {
	var s GallerySubmission
	err := row.Scan(&s.ID, &s.UserID, &s.TaskID, &s.Title, &s.Status, &s.CoverKey, &s.MediaKeys,
		&s.RejectReason, &s.ReviewedBy, &s.ReviewedAt, &s.Featured, &s.CategoryID, &s.Sort, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func InsertSubmission(ctx context.Context, q Q, userID, taskID uuid.UUID, title *string, coverKey *string, mediaKeys []string, categoryID *uuid.UUID, status string) (*GallerySubmission, error) {
	if mediaKeys == nil {
		mediaKeys = []string{}
	}
	if status == "" {
		status = "pending"
	}
	return scanSubmission(q.QueryRow(ctx,
		`INSERT INTO gallery_submissions (user_id, task_id, title, cover_key, media_keys, category_id, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+submissionCols,
		userID, taskID, title, coverKey, mediaKeys, categoryID, status))
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

// CountSubmissionsByUser 用户投稿总数。
func CountSubmissionsByUser(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM gallery_submissions WHERE user_id = $1`, userID).Scan(&n)
	return n, err
}

// CountSubmissionsByUserSince 用户自 since 起创建的投稿数（每日限额用）。
func CountSubmissionsByUserSince(ctx context.Context, q Q, userID uuid.UUID, since time.Time) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM gallery_submissions WHERE user_id = $1 AND created_at >= $2`, userID, since).Scan(&n)
	return n, err
}

// CurateSubmission 策展：featured/categoryId/sort 按需更新（幂等）。
// setCategory=true 时把 category_id 更新为 categoryID（可为 nil 表示清除归类）。
func CurateSubmission(ctx context.Context, q Q, id uuid.UUID, featured *bool, setCategory bool, categoryID *uuid.UUID, sort *int) error {
	_, err := q.Exec(ctx,
		`UPDATE gallery_submissions SET
			featured = COALESCE($2, featured),
			category_id = CASE WHEN $3 THEN $4 ELSE category_id END,
			sort = COALESCE($5, sort)
		 WHERE id = $1`,
		id, featured, setCategory, categoryID, sort)
	return err
}

// MarkSubmissionRemoved 违规下架：status 条件更新为 removed。
// 返回是否本次真正发生了状态变更（已 removed 时为 false）。
func MarkSubmissionRemoved(ctx context.Context, q Q, id uuid.UUID, rejectReason *string, reviewedBy uuid.UUID, reviewedAt time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE gallery_submissions SET status = 'removed', reject_reason = $2, reviewed_by = $3, reviewed_at = $4
		 WHERE id = $1 AND status <> 'removed'`,
		id, rejectReason, reviewedBy, reviewedAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListGalleryAuthors 创作者聚合（limit+1 行，游标按用户 created_at/id 倒序）。
func ListGalleryAuthors(ctx context.Context, q Q, search string, limit int, cursor *Cursor) ([]*GalleryAuthor, error) {
	sql := `SELECT u.id, u.email, u.username, u.submission_banned_until, u.created_at,
			count(*) AS submissions,
			count(*) FILTER (WHERE s.status = 'approved') AS approved,
			count(*) FILTER (WHERE s.status = 'removed') AS removed
		FROM gallery_submissions s
		JOIN users u ON u.id = s.user_id
		WHERE true`
	args := []any{}
	if search != "" {
		args = append(args, "%"+search+"%")
		sql += fmt.Sprintf(` AND (u.email ILIKE $%d OR u.username ILIKE $%d)`, len(args), len(args))
	}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		sql += fmt.Sprintf(` AND (u.created_at < $%d OR (u.created_at = $%d AND u.id < $%d))`, len(args)-1, len(args)-1, len(args))
	}
	sql += ` GROUP BY u.id, u.email, u.username, u.submission_banned_until, u.created_at`
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY u.created_at DESC, u.id DESC LIMIT $%d`, len(args))

	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*GalleryAuthor
	for rows.Next() {
		var a GalleryAuthor
		if err := rows.Scan(&a.UserID, &a.Email, &a.Username, &a.BannedUntil, &a.CreatedAt,
			&a.Submissions, &a.Approved, &a.Removed); err != nil {
			return nil, err
		}
		out = append(out, &a)
	}
	return out, rows.Err()
}

// ReviewSubmission 更新审核结果。
func ReviewSubmission(ctx context.Context, q Q, id uuid.UUID, status string, rejectReason *string, reviewedBy uuid.UUID, reviewedAt time.Time) error {
	_, err := q.Exec(ctx,
		`UPDATE gallery_submissions SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = $5 WHERE id = $1`,
		id, status, rejectReason, reviewedBy, reviewedAt)
	return err
}

// SubmissionFilter 投稿列表可选筛选。
type SubmissionFilter struct {
	UserID     *uuid.UUID
	Status     string
	Featured   *bool
	CategoryID *uuid.UUID
}

// ListSubmissions 投稿分页（limit+1 行）。
func ListSubmissions(ctx context.Context, q Q, f SubmissionFilter, limit int, cursor *Cursor) ([]*GallerySubmission, error) {
	sql := `SELECT ` + submissionCols + ` FROM gallery_submissions WHERE true`
	args := []any{}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		sql += fmt.Sprintf(` AND user_id = $%d`, len(args))
	}
	if f.Status != "" {
		args = append(args, f.Status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	if f.Featured != nil {
		args = append(args, *f.Featured)
		sql += fmt.Sprintf(` AND featured = $%d`, len(args))
	}
	if f.CategoryID != nil {
		args = append(args, *f.CategoryID)
		sql += fmt.Sprintf(` AND category_id = $%d`, len(args))
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
