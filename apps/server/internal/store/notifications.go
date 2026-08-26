package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const notificationCols = `id, user_id, kind, title, body, read_at, created_at, source_type, source_id`

func scanNotification(row pgx.Row) (*Notification, error) {
	var n Notification
	err := row.Scan(&n.ID, &n.UserID, &n.Kind, &n.Title, &n.Body, &n.ReadAt, &n.CreatedAt, &n.SourceType, &n.SourceID)
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

func InsertNotificationWithSource(ctx context.Context, q Q, userID *uuid.UUID, kind, title string, body *string, sourceType string, sourceID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		INSERT INTO notifications (user_id, kind, title, body, source_type, source_id)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, kind, title, body, sourceType, sourceID)
	return err
}

const AnnouncementNotificationSource = "announcement"

func UpsertAnnouncementNotification(ctx context.Context, q Q, announcementID uuid.UUID, title string, body *string) error {
	_, err := q.Exec(ctx, `
		INSERT INTO notifications (user_id, kind, title, body, source_type, source_id)
		VALUES (NULL, 'announcement', $1, $2, $3, $4)
		ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
		DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body`,
		title, body, AnnouncementNotificationSource, announcementID)
	return err
}

func DeleteNotificationsBySource(ctx context.Context, q Q, sourceType string, sourceID uuid.UUID) error {
	_, err := q.Exec(ctx,
		`DELETE FROM notifications WHERE source_type = $1 AND source_id = $2`,
		sourceType, sourceID)
	return err
}

// CountUnreadNotificationBreakdown 个人未读与全站未读分开统计。
func CountUnreadNotificationBreakdown(ctx context.Context, q Q, userID uuid.UUID) (personal, broadcast int64, err error) {
	err = q.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL AND kind <> 'announcement'`, userID).Scan(&personal)
	if err != nil {
		return 0, 0, err
	}
	err = q.QueryRow(ctx,
		`SELECT count(*) FROM notifications n
		 LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
		 WHERE n.user_id IS NULL AND n.kind <> 'announcement' AND r.notification_id IS NULL
		   AND NOT EXISTS (
		     SELECT 1 FROM notification_dismissals d
		     WHERE d.user_id = $1 AND d.notification_id = n.id
		   )`, userID).Scan(&broadcast)
	if err != nil {
		return 0, 0, err
	}
	return personal, broadcast, nil
}

// CountUnreadNotifications 个人未读 + 全站未读（notification_reads 缺记录）。
func CountUnreadNotifications(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	personal, broadcast, err := CountUnreadNotificationBreakdown(ctx, q, userID)
	if err != nil {
		return 0, err
	}
	return personal + broadcast, nil
}

// ListVisibleNotifications 个人 + 全站合并分页（limit+1 行）。
func ListVisibleNotifications(ctx context.Context, q Q, userID uuid.UUID, limit int, cursor *Cursor) ([]*Notification, error) {
	sql := `SELECT ` + notificationCols + ` FROM notifications
		WHERE (user_id = $1 OR user_id IS NULL)
		  AND kind <> 'announcement'
		  AND NOT EXISTS (
		    SELECT 1 FROM notification_dismissals d
		    WHERE d.user_id = $1 AND d.notification_id = notifications.id
		  )`
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
		`SELECT `+notificationCols+` FROM notifications
		 WHERE id = ANY($2) AND (user_id = $1 OR user_id IS NULL)
		   AND kind <> 'announcement'
		   AND NOT EXISTS (
		     SELECT 1 FROM notification_dismissals d
		     WHERE d.user_id = $1 AND d.notification_id = notifications.id
		   )`,
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
		`SELECT `+notificationCols+` FROM notifications
		 WHERE (user_id = $1 OR user_id IS NULL)
		   AND kind <> 'announcement'
		   AND NOT EXISTS (
		     SELECT 1 FROM notification_dismissals d
		     WHERE d.user_id = $1 AND d.notification_id = notifications.id
		   )`, userID)
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

func ClearUserNotifications(ctx context.Context, q Q, userID uuid.UUID) error {
	if _, err := q.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, userID); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `
		INSERT INTO notification_dismissals (user_id, notification_id)
		SELECT $1, id FROM notifications WHERE user_id IS NULL AND kind <> 'announcement'
		ON CONFLICT (user_id, notification_id) DO NOTHING`, userID)
	return err
}
