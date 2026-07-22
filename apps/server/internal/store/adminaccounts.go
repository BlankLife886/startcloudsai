package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const adminAccountCols = `id, email, username, password_hash, status, last_login_at, created_at`

func scanAdminAccount(row pgx.Row) (*AdminAccount, error) {
	var admin AdminAccount
	err := row.Scan(&admin.ID, &admin.Email, &admin.Username, &admin.PasswordHash,
		&admin.Status, &admin.LastLoginAt, &admin.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &admin, nil
}

func GetAdminAccountByID(ctx context.Context, q Q, id uuid.UUID) (*AdminAccount, error) {
	admin, err := scanAdminAccount(q.QueryRow(ctx,
		`SELECT `+adminAccountCols+` FROM admin_accounts WHERE id = $1`, id))
	return nilOnNoRows(admin, err)
}

func GetAdminAccountByEmail(ctx context.Context, q Q, email string) (*AdminAccount, error) {
	admin, err := scanAdminAccount(q.QueryRow(ctx,
		`SELECT `+adminAccountCols+` FROM admin_accounts WHERE email = $1`, email))
	return nilOnNoRows(admin, err)
}

func UpsertAdminAccount(ctx context.Context, q Q, email, username, passwordHash string) (*AdminAccount, error) {
	return scanAdminAccount(q.QueryRow(ctx,
		`INSERT INTO admin_accounts (email, username, password_hash)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (email) DO UPDATE SET
		   username = EXCLUDED.username,
		   password_hash = EXCLUDED.password_hash,
		   status = 'active'
		 RETURNING `+adminAccountCols,
		email, username, passwordHash))
}

func TouchAdminLastLogin(ctx context.Context, q Q, id uuid.UUID, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE admin_accounts SET last_login_at = $2 WHERE id = $1`, id, at)
	return err
}

func UpdateAdminPassword(ctx context.Context, q Q, id uuid.UUID, passwordHash string) error {
	_, err := q.Exec(ctx, `UPDATE admin_accounts SET password_hash = $2 WHERE id = $1`, id, passwordHash)
	return err
}

func scanAdminSession(row pgx.Row) (*AdminSession, error) {
	var session AdminSession
	err := row.Scan(&session.ID, &session.AdminID, &session.TokenHash, &session.ExpiresAt,
		&session.IP, &session.UserAgent, &session.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func InsertAdminSession(ctx context.Context, q Q, adminID uuid.UUID, tokenHash string,
	expiresAt time.Time, ip, userAgent *string) error {
	_, err := q.Exec(ctx,
		`INSERT INTO admin_sessions (admin_id, token_hash, expires_at, ip, user_agent)
		 VALUES ($1, $2, $3, $4, $5)`,
		adminID, tokenHash, expiresAt, ip, userAgent)
	return err
}

func GetAdminSessionByTokenHash(ctx context.Context, q Q, tokenHash string) (*AdminSession, error) {
	session, err := scanAdminSession(q.QueryRow(ctx,
		`SELECT id, admin_id, token_hash, expires_at, ip, user_agent, created_at
		 FROM admin_sessions WHERE token_hash = $1`, tokenHash))
	return nilOnNoRows(session, err)
}

func UpdateAdminSessionExpiry(ctx context.Context, q Q, id uuid.UUID, expiresAt time.Time) error {
	_, err := q.Exec(ctx, `UPDATE admin_sessions SET expires_at = $2 WHERE id = $1`, id, expiresAt)
	return err
}

func DeleteAdminSessionByTokenHash(ctx context.Context, q Q, tokenHash string) error {
	_, err := q.Exec(ctx, `DELETE FROM admin_sessions WHERE token_hash = $1`, tokenHash)
	return err
}

func DeleteAdminSessionsByAdmin(ctx context.Context, q Q, adminID uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM admin_sessions WHERE admin_id = $1`, adminID)
	return err
}

func DeleteExpiredAdminSessions(ctx context.Context, q Q, now time.Time) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM admin_sessions WHERE expires_at < $1`, now)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
