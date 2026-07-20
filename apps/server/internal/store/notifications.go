package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const notificationCols = `id, user_id, kind, title, body, read_at, created_at`

func scanNotification(row pgx.Row) (*Notification, error) {
	var n Notification
	err := row.Scan(&n.ID, &n.UserID, &n.Kind, &n.Title, &n.Body, &n.ReadAt, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// InsertNotification userID 为 nil 表示全站公告。
func InsertNotification(ctx context.Context, q Q, userID *uuid.UUID, kind, title string, body *string) error {
	_, err := q.Exec(ctx,
		`INSERT INTO notifications (user_id, kind, title, body) VALUES ($1, $2, $3, $4)`,
		userID, kind, title, body)
	return err
}

// CountUnreadNotifications 个人未读 + 全站未读（notification_reads 缺记录）。
func CountUnreadNotifications(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var personal, global int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, userID).Scan(&personal)
	if err != nil {
		return 0, err
	}
	err = q.QueryRow(ctx,
		`SELECT count(*) FROM notifications n
		 LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
		 WHERE n.user_id IS NULL AND r.notification_id IS NULL`, userID).Scan(&global)
	if err != nil {
		return 0, err
	}
	return personal + global, nil
}

// ListVisibleNotifications 个人 + 全站合并分页（limit+1 行）。
func ListVisibleNotifications(ctx context.Context, q Q, userID uuid.UUID, limit int, cursor *Cursor) ([]*Notification, error) {
	sql := `SELECT ` + notificationCols + ` FROM notifications WHERE (user_id = $1 OR user_id IS NULL)`
	args := []any{userID}
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ListVisibleNotificationsByIDs 取用户可见的指定通知。
func ListVisibleNotificationsByIDs(ctx context.Context, q Q, userID uuid.UUID, ids []uuid.UUID) ([]*Notification, error) {
	rows, err := q.Query(ctx,
		`SELECT `+notificationCols+` FROM notifications WHERE id = ANY($2) AND (user_id = $1 OR user_id IS NULL)`,
		userID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ListAllVisibleNotifications 全部可见通知（全部已读用）。
func ListAllVisibleNotifications(ctx context.Context, q Q, userID uuid.UUID) ([]*Notification, error) {
	rows, err := q.Query(ctx,
		`SELECT `+notificationCols+` FROM notifications WHERE (user_id = $1 OR user_id IS NULL)`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// GetNotificationReadTimes 用户对指定全站公告的已读时间。
func GetNotificationReadTimes(ctx context.Context, q Q, userID uuid.UUID, notificationIDs []uuid.UUID) (map[uuid.UUID]time.Time, error) {
	out := map[uuid.UUID]time.Time{}
	if len(notificationIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx,
		`SELECT notification_id, created_at FROM notification_reads WHERE user_id = $1 AND notification_id = ANY($2)`,
		userID, notificationIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var at time.Time
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		out[id] = at
	}
	return out, rows.Err()
}

func MarkPersonalNotificationsRead(ctx context.Context, q Q, ids []uuid.UUID, at time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := q.Exec(ctx,
		`UPDATE notifications SET read_at = $2 WHERE id = ANY($1) AND read_at IS NULL`, ids, at)
	return err
}

func InsertNotificationRead(ctx context.Context, q Q, userID, notificationID uuid.UUID) error {
	_, err := q.Exec(ctx,
		`INSERT INTO notification_reads (user_id, notification_id) VALUES ($1, $2)
		 ON CONFLICT (user_id, notification_id) DO NOTHING`, userID, notificationID)
	return err
}
