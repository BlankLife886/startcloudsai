package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/google/uuid"
)

func scanSession(row pgx.Row) (*Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.TokenHash, &s.ExpiresAt, &s.IP, &s.UserAgent, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func InsertSession(ctx context.Context, q Q, userID uuid.UUID, tokenHash string, expiresAt time.Time, ip, userAgent *string) error {
	_, err := q.Exec(ctx,
		`INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
		userID, tokenHash, expiresAt, ip, userAgent)
	return err
}

func GetSessionByTokenHash(ctx context.Context, q Q, tokenHash string) (*Session, error) {
	s, err := scanSession(q.QueryRow(ctx,
		`SELECT id, user_id, token_hash, expires_at, ip, user_agent, created_at FROM sessions WHERE token_hash = $1`,
		tokenHash))
	return nilOnNoRows(s, err)
}

func UpdateSessionExpiry(ctx context.Context, q Q, id uuid.UUID, expiresAt time.Time) error {
	_, err := q.Exec(ctx, `UPDATE sessions SET expires_at = $2 WHERE id = $1`, id, expiresAt)
	return err
}

func DeleteSessionByTokenHash(ctx context.Context, q Q, tokenHash string) error {
	_, err := q.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}

// DeleteSessionsByUser 使该用户所有 session 失效，返回清理条数。
func DeleteSessionsByUser(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// DeleteExpiredSessions 返回清理条数。
func DeleteExpiredSessions(ctx context.Context, q Q, now time.Time) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM sessions WHERE expires_at < $1`, now)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
