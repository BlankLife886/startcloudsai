package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const feedbackCols = `id, user_id, category, title, content, page_url, user_agent,
	status, admin_reply, handled_by, handled_at, adopted, reward_cents, rewarded_at,
	created_at, updated_at`

const feedbackJoinedCols = `f.id, f.user_id, f.category, f.title, f.content, f.page_url,
	f.user_agent, f.status, f.admin_reply, f.handled_by, f.handled_at,
	f.adopted, f.reward_cents, f.rewarded_at, f.created_at, f.updated_at, u.email, u.username`

func scanFeedback(row pgx.Row) (*UserFeedback, error) {
	var item UserFeedback
	err := row.Scan(
		&item.ID, &item.UserID, &item.Category, &item.Title, &item.Content,
		&item.PageURL, &item.UserAgent, &item.Status, &item.AdminReply,
		&item.HandledBy, &item.HandledAt, &item.Adopted, &item.RewardCents,
		&item.RewardedAt, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func scanFeedbackJoined(row pgx.Row) (*UserFeedback, error) {
	var item UserFeedback
	err := row.Scan(
		&item.ID, &item.UserID, &item.Category, &item.Title, &item.Content,
		&item.PageURL, &item.UserAgent, &item.Status, &item.AdminReply,
		&item.HandledBy, &item.HandledAt, &item.Adopted, &item.RewardCents,
		&item.RewardedAt, &item.CreatedAt, &item.UpdatedAt,
		&item.UserEmail, &item.Username,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func InsertUserFeedback(ctx context.Context, q Q, userID uuid.UUID, category, title, content string, pageURL, userAgent *string) (*UserFeedback, error) {
	return scanFeedback(q.QueryRow(ctx,
		`INSERT INTO user_feedback (user_id, category, title, content, page_url, user_agent)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+feedbackCols,
		userID, category, title, content, pageURL, userAgent))
}

func CountRecentUserFeedback(ctx context.Context, q Q, userID uuid.UUID, since time.Time) (int64, error) {
	var count int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM user_feedback WHERE user_id = $1 AND created_at >= $2`,
		userID, since).Scan(&count)
	return count, err
}

func ListUserFeedback(ctx context.Context, q Q, userID uuid.UUID, limit int, cursor *Cursor) ([]*UserFeedback, error) {
	sql := `SELECT ` + feedbackCols + ` FROM user_feedback WHERE user_id = $1`
	args := []any{userID}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		sql += fmt.Sprintf(` AND (created_at < $%d OR (created_at = $%d AND id < $%d))`, len(args)-1, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*UserFeedback, 0)
	for rows.Next() {
		item, scanErr := scanFeedback(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ListAdminFeedback(ctx context.Context, q Q, status, category, search string, limit int, cursor *Cursor) ([]*UserFeedback, error) {
	sql := `SELECT ` + feedbackJoinedCols + ` FROM user_feedback f JOIN users u ON u.id = f.user_id WHERE true`
	args := []any{}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND f.status = $%d`, len(args))
	}
	if category != "" {
		args = append(args, category)
		sql += fmt.Sprintf(` AND f.category = $%d`, len(args))
	}
	if search = strings.TrimSpace(search); search != "" {
		args = append(args, "%"+search+"%")
		n := len(args)
		sql += fmt.Sprintf(` AND (u.email ILIKE $%d OR u.username ILIKE $%d OR f.title ILIKE $%d OR f.content ILIKE $%d)`, n, n, n, n)
	}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		sql += fmt.Sprintf(` AND (f.created_at < $%d OR (f.created_at = $%d AND f.id < $%d))`, len(args)-1, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY f.created_at DESC, f.id DESC LIMIT $%d`, len(args))

	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*UserFeedback, 0)
	for rows.Next() {
		item, scanErr := scanFeedbackJoined(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CountAdminFeedback(ctx context.Context, q Q, status, category, search string) (int64, error) {
	sql := `SELECT count(*) FROM user_feedback f JOIN users u ON u.id = f.user_id WHERE true`
	args := []any{}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND f.status = $%d`, len(args))
	}
	if category != "" {
		args = append(args, category)
		sql += fmt.Sprintf(` AND f.category = $%d`, len(args))
	}
	if search = strings.TrimSpace(search); search != "" {
		args = append(args, "%"+search+"%")
		n := len(args)
		sql += fmt.Sprintf(` AND (u.email ILIKE $%d OR u.username ILIKE $%d OR f.title ILIKE $%d OR f.content ILIKE $%d)`, n, n, n, n)
	}
	var count int64
	err := q.QueryRow(ctx, sql, args...).Scan(&count)
	return count, err
}

func GetFeedbackForUpdate(ctx context.Context, q Q, id uuid.UUID) (*UserFeedback, error) {
	item, err := scanFeedback(q.QueryRow(ctx,
		`SELECT `+feedbackCols+` FROM user_feedback WHERE id = $1 FOR UPDATE`, id))
	return nilOnNoRows(item, err)
}

func GetFeedbackByID(ctx context.Context, q Q, id uuid.UUID) (*UserFeedback, error) {
	item, err := scanFeedbackJoined(q.QueryRow(ctx,
		`SELECT `+feedbackJoinedCols+` FROM user_feedback f JOIN users u ON u.id = f.user_id WHERE f.id = $1`, id))
	return nilOnNoRows(item, err)
}

func UpdateFeedbackReview(ctx context.Context, q Q, id uuid.UUID, status string, reply *string, handledBy uuid.UUID, at time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE user_feedback
		 SET status = $2, admin_reply = $3, handled_by = $4, handled_at = $5, updated_at = $5
		 WHERE id = $1`, id, status, reply, handledBy, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func MarkFeedbackAdopted(ctx context.Context, q Q, id uuid.UUID, rewardCents int64, at time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE user_feedback
		 SET adopted = true, reward_cents = $2, rewarded_at = $3, updated_at = $3
		 WHERE id = $1 AND adopted = false`, id, rewardCents, at)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
