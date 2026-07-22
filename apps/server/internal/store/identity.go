package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func UpsertEmailLoginCode(ctx context.Context, q Q, email, purpose, codeHash string, expiresAt time.Time, ip *string) error {
	_, err := q.Exec(ctx, `INSERT INTO email_login_codes (email, purpose, code_hash, expires_at, requested_ip)
		VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO UPDATE SET purpose=EXCLUDED.purpose,
		code_hash=EXCLUDED.code_hash, expires_at=EXCLUDED.expires_at, attempts=0,
		requested_ip=EXCLUDED.requested_ip, created_at=now()`, email, purpose, codeHash, expiresAt, ip)
	return err
}

func GetEmailLoginCodeForUpdate(ctx context.Context, q Q, email string) (string, string, time.Time, int, time.Time, error) {
	var purpose, hash string
	var expires, created time.Time
	var attempts int
	err := q.QueryRow(ctx, `SELECT purpose, code_hash, expires_at, attempts, created_at
		FROM email_login_codes WHERE email=$1 FOR UPDATE`, email).
		Scan(&purpose, &hash, &expires, &attempts, &created)
	return purpose, hash, expires, attempts, created, err
}

func IncrementEmailLoginAttempts(ctx context.Context, q Q, email string) error {
	_, err := q.Exec(ctx, `UPDATE email_login_codes SET attempts=attempts+1 WHERE email=$1`, email)
	return err
}

func DeleteEmailLoginCode(ctx context.Context, q Q, email string) error {
	_, err := q.Exec(ctx, `DELETE FROM email_login_codes WHERE email=$1`, email)
	return err
}

func InsertOAuthState(ctx context.Context, q Q, stateHash, provider string, expiresAt time.Time) error {
	_, err := q.Exec(ctx, `INSERT INTO oauth_login_states (state_hash, provider, expires_at) VALUES ($1,$2,$3)`, stateHash, provider, expiresAt)
	return err
}

func ConsumeOAuthState(ctx context.Context, q Q, stateHash, provider string, now time.Time) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `DELETE FROM oauth_login_states WHERE state_hash=$1 AND provider=$2 AND expires_at>$3 RETURNING true`, stateHash, provider, now).Scan(&ok)
	if err != nil {
		return false, nilOnNoRowsValue(err)
	}
	return ok, nil
}

func nilOnNoRowsValue(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

func UpsertUserIdentity(ctx context.Context, q Q, userID uuid.UUID, provider, subject, email string) error {
	_, err := q.Exec(ctx, `INSERT INTO user_identities (user_id, provider, subject, email) VALUES ($1,$2,$3,$4)
		ON CONFLICT (provider, subject) DO UPDATE SET email=EXCLUDED.email`, userID, provider, subject, email)
	return err
}

func GetUserByIdentity(ctx context.Context, q Q, provider, subject string) (*User, error) {
	u, err := scanUser(q.QueryRow(ctx, `SELECT `+userCols+` FROM users u JOIN user_identities i ON i.user_id=u.id
		WHERE i.provider=$1 AND i.subject=$2`, provider, subject))
	return nilOnNoRows(u, err)
}
