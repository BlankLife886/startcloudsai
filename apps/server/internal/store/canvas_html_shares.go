package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// CanvasHTMLShare is a published, read-only copy of a canvas HTML node page.
type CanvasHTMLShare struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Slug      string
	Title     string
	HTML      string
	Bytes     int
	CreatedAt time.Time
	UpdatedAt time.Time
}

// CountActiveCanvasHTMLShares counts a user's shares that are still reachable.
func CountActiveCanvasHTMLShares(ctx context.Context, q Q, userID uuid.UUID) (int, error) {
	var count int
	err := q.QueryRow(ctx, `SELECT count(*) FROM canvas_html_shares WHERE user_id = $1 AND revoked_at IS NULL`, userID).Scan(&count)
	return count, err
}

// CreateCanvasHTMLShare stores a new share under the given public slug.
func CreateCanvasHTMLShare(ctx context.Context, q Q, userID uuid.UUID, slug, title, html string, now time.Time) error {
	_, err := q.Exec(ctx, `INSERT INTO canvas_html_shares (user_id, slug, title, html, bytes, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)`, userID, slug, title, html, len(html), now)
	return err
}

// UpdateCanvasHTMLShare replaces the page behind an existing, active share owned by the user.
// It reports false when the share does not exist, belongs to someone else or was revoked.
func UpdateCanvasHTMLShare(ctx context.Context, q Q, userID uuid.UUID, slug, title, html string, now time.Time) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE canvas_html_shares SET title = $3, html = $4, bytes = $5, updated_at = $6
		WHERE slug = $2 AND user_id = $1 AND revoked_at IS NULL`, userID, slug, title, html, len(html), now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// RevokeCanvasHTMLShare makes a share unreachable. It reports false when there was nothing to revoke.
func RevokeCanvasHTMLShare(ctx context.Context, q Q, userID uuid.UUID, slug string, now time.Time) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE canvas_html_shares SET revoked_at = $3 WHERE slug = $2 AND user_id = $1 AND revoked_at IS NULL`, userID, slug, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// GetActiveCanvasHTMLShare returns the page for a public slug, or nil when it is unknown or revoked.
func GetActiveCanvasHTMLShare(ctx context.Context, q Q, slug string) (*CanvasHTMLShare, error) {
	var share CanvasHTMLShare
	err := q.QueryRow(ctx, `SELECT id, user_id, slug, title, html, bytes, created_at, updated_at
		FROM canvas_html_shares WHERE slug = $1 AND revoked_at IS NULL`, slug).
		Scan(&share.ID, &share.UserID, &share.Slug, &share.Title, &share.HTML, &share.Bytes, &share.CreatedAt, &share.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &share, nil
}
