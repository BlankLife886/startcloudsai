package store

import (
	"context"
	"time"
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
