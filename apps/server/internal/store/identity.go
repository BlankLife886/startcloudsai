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

// UpsertEmailLoginCodeIfStale 原子地完成「距上次发码不足 minInterval 则拒绝，
// 否则写入新码」。检查与写入在同一条语句内，并发同邮箱请求只有一个会成功，
// 避免先 SELECT 再 UPSERT 的竞态导致发出多条互相覆盖的验证码。
// 返回 false 表示仍在重发间隔内，未写入。
func UpsertEmailLoginCodeIfStale(ctx context.Context, q Q, email, purpose, codeHash string, expiresAt time.Time, ip *string, minInterval time.Duration) (bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO email_login_codes (email, purpose, code_hash, expires_at, requested_ip)
		VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO UPDATE SET purpose=EXCLUDED.purpose,
		code_hash=EXCLUDED.code_hash, expires_at=EXCLUDED.expires_at, attempts=0,
		requested_ip=EXCLUDED.requested_ip, created_at=now()
		WHERE email_login_codes.created_at < now() - ($6 * interval '1 second')`,
		email, purpose, codeHash, expiresAt, ip, int64(minInterval.Seconds()))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// RecentEmailLoginCodeExists 只读判断该邮箱是否已有仍处于重发间隔内的验证码。
// 它让重复点击在扣减发码额度、覆盖已发验证码之前就被拦下；写入时的权威判断
// 仍由 UpsertEmailLoginCodeIfStale 在同一条语句里原子完成。
func RecentEmailLoginCodeExists(ctx context.Context, q Q, email string, minInterval time.Duration) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM email_login_codes
		WHERE email=$1 AND created_at >= now() - ($2 * interval '1 second'))`,
		email, int64(minInterval.Seconds())).Scan(&exists)
	return exists, err
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
