package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const announcementCols = `id, title, body, active, starts_at, ends_at, created_at`

func scanAnnouncement(row pgx.Row) (*Announcement, error) {
	var a Announcement
	err := row.Scan(&a.ID, &a.Title, &a.Body, &a.Active, &a.StartsAt, &a.EndsAt, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func InsertAnnouncement(ctx context.Context, q Q, title string, body *string, active bool, startsAt, endsAt *time.Time) (*Announcement, error) {
	return scanAnnouncement(q.QueryRow(ctx,
		`INSERT INTO announcements (title, body, active, starts_at, ends_at)
		 VALUES ($1, $2, $3, $4, $5) RETURNING `+announcementCols,
		title, body, active, startsAt, endsAt))
}

func GetAnnouncement(ctx context.Context, q Q, id uuid.UUID) (*Announcement, error) {
	a, err := scanAnnouncement(q.QueryRow(ctx, `SELECT `+announcementCols+` FROM announcements WHERE id = $1`, id))
	return nilOnNoRows(a, err)
}

func UpdateAnnouncement(ctx context.Context, q Q, a *Announcement) error {
	_, err := q.Exec(ctx,
		`UPDATE announcements SET title = $2, body = $3, active = $4, starts_at = $5, ends_at = $6 WHERE id = $1`,
		a.ID, a.Title, a.Body, a.Active, a.StartsAt, a.EndsAt)
	return err
}

func DeleteAnnouncement(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM announcements WHERE id = $1`, id)
	return err
}

// ListAnnouncements activeAt 非 nil 时只取生效中的公告。
func ListAnnouncements(ctx context.Context, q Q, activeAt *time.Time) ([]*Announcement, error) {
	sql := `SELECT ` + announcementCols + ` FROM announcements`
	args := []any{}
	if activeAt != nil {
		args = append(args, *activeAt)
		sql += ` WHERE active = true AND (starts_at IS NULL OR starts_at <= $1) AND (ends_at IS NULL OR ends_at >= $1)`
	}
	sql += ` ORDER BY created_at DESC`
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
