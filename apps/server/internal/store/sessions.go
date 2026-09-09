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

func ListActiveUserSessions(ctx context.Context, q Q, userID uuid.UUID, now time.Time) ([]*Session, error) {
	rows, err := q.Query(ctx, `SELECT id, user_id, token_hash, expires_at, ip, user_agent, created_at
		FROM sessions WHERE user_id = $1 AND expires_at > $2
		ORDER BY created_at DESC, id DESC`, userID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*Session, 0)
	for rows.Next() {
		item, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func DeleteUserSession(ctx context.Context, q Q, userID, sessionID uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM sessions WHERE id = $1 AND user_id = $2`, sessionID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func DeleteOtherUserSessions(ctx context.Context, q Q, userID, currentSessionID uuid.UUID) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, userID, currentSessionID)
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

// LastSessionIPsByUserIDs 批量取每个用户最近一次会话 IP。
func LastSessionIPsByUserIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := make(map[uuid.UUID]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
		SELECT DISTINCT ON (user_id) user_id, ip
		FROM sessions
		WHERE user_id = ANY($1)
		ORDER BY user_id, created_at DESC`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var ip *string
		if err := rows.Scan(&id, &ip); err != nil {
			return nil, err
		}
		if ip != nil && *ip != "" {
			out[id] = *ip
		}
	}
	return out, rows.Err()
}

// GetUserSessionSummary 返回用户当前有效会话数与最近一次会话元数据。
func GetUserSessionSummary(ctx context.Context, q Q, userID uuid.UUID, now time.Time) (*UserSessionSummary, error) {
	var summary UserSessionSummary
	err := q.QueryRow(ctx,
		`SELECT
			(SELECT count(*) FROM sessions WHERE user_id = $1 AND expires_at > $2),
			(SELECT ip FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1),
			(SELECT user_agent FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1),
			(SELECT created_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1),
			(SELECT expires_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`,
		userID, now).Scan(&summary.ActiveCount, &summary.LastIP, &summary.LastUserAgent,
		&summary.LastCreatedAt, &summary.LastExpiresAt)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}
