package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const announcementCols = `id, title, body, active, starts_at, ends_at, config, created_at, push_id, pushed_at`

func scanAnnouncement(row pgx.Row) (*Announcement, error) {
	var a Announcement
	err := row.Scan(&a.ID, &a.Title, &a.Body, &a.Active, &a.StartsAt, &a.EndsAt, &a.Config, &a.CreatedAt, &a.PushID, &a.PushedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func InsertAnnouncement(ctx context.Context, q Q, title string, body *string, active bool, startsAt, endsAt *time.Time, config json.RawMessage) (*Announcement, error) {
	return scanAnnouncement(q.QueryRow(ctx,
		`INSERT INTO announcements (title, body, active, starts_at, ends_at, config)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+announcementCols,
		title, body, active, startsAt, endsAt, config))
}

func GetAnnouncement(ctx context.Context, q Q, id uuid.UUID) (*Announcement, error) {
	a, err := scanAnnouncement(q.QueryRow(ctx, `SELECT `+announcementCols+` FROM announcements WHERE id = $1`, id))
	return nilOnNoRows(a, err)
}

func UpdateAnnouncement(ctx context.Context, q Q, a *Announcement) error {
	_, err := q.Exec(ctx,
		`UPDATE announcements SET title = $2, body = $3, active = $4, starts_at = $5, ends_at = $6, config = $7 WHERE id = $1`,
		a.ID, a.Title, a.Body, a.Active, a.StartsAt, a.EndsAt, a.Config)
	return err
}

func DeleteAnnouncement(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM announcements WHERE id = $1`, id)
	return err
}

func PushActiveAnnouncement(ctx context.Context, q Q, id, pushID uuid.UUID, pushedAt time.Time) (*Announcement, error) {
	return scanAnnouncement(q.QueryRow(ctx, `UPDATE announcements SET push_id=$2, pushed_at=$3
		WHERE id=$1 AND active=true AND (starts_at IS NULL OR starts_at <= $3)
		AND (ends_at IS NULL OR ends_at >= $3) RETURNING `+announcementCols,
		id, pushID, pushedAt))
}

// ListAnnouncements activeAt 非 nil 时只取生效中的公告。
func ListAnnouncements(ctx context.Context, q Q, activeAt *time.Time) ([]*Announcement, error) {
	sql := `SELECT ` + announcementCols + ` FROM announcements`
	args := []any{}
	if activeAt != nil {
		args = append(args, *activeAt)
		sql += ` WHERE active = true AND (starts_at IS NULL OR starts_at <= $1) AND (ends_at IS NULL OR ends_at >= $1)`
	}
	if activeAt != nil {
		sql += ` ORDER BY GREATEST(created_at, COALESCE(pushed_at, created_at)) DESC, created_at DESC, id DESC`
	} else {
		sql += ` ORDER BY created_at DESC, id DESC`
	}
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Announcement
	for rows.Next() {
		a, err := scanAnnouncement(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
