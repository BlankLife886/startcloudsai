package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Cursor 为 (created_at, id) 倒序分页游标。
type Cursor struct {
	CreatedAt time.Time
	ID        uuid.UUID
}

const userCols = `id, email, username, password_hash, avatar_url, role, status, last_login_at, created_at`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Username, &u.PasswordHash, &u.AvatarURL, &u.Role, &u.Status, &u.LastLoginAt, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func nilOnNoRows[T any](v *T, err error) (*T, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

func GetUserByID(ctx context.Context, q Q, id uuid.UUID) (*User, error) {
	u, err := scanUser(q.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id))
	return nilOnNoRows(u, err)
}

func GetUserByEmail(ctx context.Context, q Q, email string) (*User, error) {
	u, err := scanUser(q.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE email = $1`, email))
	return nilOnNoRows(u, err)
}

func InsertUser(ctx context.Context, q Q, email, username, passwordHash, role string, lastLoginAt *time.Time) (*User, error) {
	return scanUser(q.QueryRow(ctx,
		`INSERT INTO users (email, username, password_hash, role, last_login_at) VALUES ($1, $2, $3, $4, $5) RETURNING `+userCols,
		email, username, passwordHash, role, lastLoginAt))
}

func UpdateUserProfile(ctx context.Context, q Q, id uuid.UUID, username *string, avatarURL **string, passwordHash *string) error {
	_, err := q.Exec(ctx,
		`UPDATE users SET
			username = COALESCE($2, username),
			avatar_url = CASE WHEN $3 THEN $4 ELSE avatar_url END,
			password_hash = COALESCE($5, password_hash)
		 WHERE id = $1`,
		id, username, avatarURL != nil, avatarDeref(avatarURL), passwordHash)
	return err
}

func avatarDeref(p **string) *string {
	if p == nil {
		return nil
	}
	return *p
}

func UpdateUserAdmin(ctx context.Context, q Q, id uuid.UUID, status, role *string) error {
	_, err := q.Exec(ctx,
		`UPDATE users SET status = COALESCE($2, status), role = COALESCE($3, role) WHERE id = $1`,
		id, status, role)
	return err
}

func UpdateUserPassword(ctx context.Context, q Q, id uuid.UUID, passwordHash string) error {
	_, err := q.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, id, passwordHash)
	return err
}

func TouchLastLogin(ctx context.Context, q Q, id uuid.UUID, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE users SET last_login_at = $2 WHERE id = $1`, id, at)
	return err
}

func PromoteAdmin(ctx context.Context, q Q, id uuid.UUID, passwordHash string) error {
	_, err := q.Exec(ctx, `UPDATE users SET role = 'admin', password_hash = $2 WHERE id = $1`, id, passwordHash)
	return err
}

func CountUsers(ctx context.Context, q Q) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n, err
}

func CountUsersSince(ctx context.Context, q Q, since time.Time) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM users WHERE created_at >= $1`, since).Scan(&n)
	return n, err
}

// ListUsers 后台用户搜索分页（limit+1 行）。
func ListUsers(ctx context.Context, q Q, search, status string, limit int, cursor *Cursor) ([]*User, error) {
	sql := `SELECT ` + userCols + ` FROM users WHERE true`
	args := []any{}
	if search != "" {
		args = append(args, "%"+search+"%")
		sql += fmt.Sprintf(` AND (email ILIKE $%d OR username ILIKE $%d)`, len(args), len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// MatchUserIDs 按 id/邮箱/用户名模糊匹配用户 id（最多 200 个）。
func MatchUserIDs(ctx context.Context, q Q, keyword string) ([]uuid.UUID, error) {
	if id, err := uuid.Parse(keyword); err == nil {
		return []uuid.UUID{id}, nil
	}
	rows, err := q.Query(ctx,
		`SELECT id FROM users WHERE email ILIKE $1 OR username ILIKE $1 LIMIT 200`, "%"+keyword+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// GetUsersByIDs 批量取用户，返回 id → user。
func GetUsersByIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]*User, error) {
	out := map[uuid.UUID]*User{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT `+userCols+` FROM users WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out[u.ID] = u
	}
	return out, rows.Err()
}

// appendCursor 追加 (created_at, id) 倒序 cursor 条件与 limit+1。
func appendCursor(sql string, args []any, cursor *Cursor, limit int) (string, []any) {
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		sql += fmt.Sprintf(` AND (created_at < $%d OR (created_at = $%d AND id < $%d))`, len(args)-1, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, len(args))
	return sql, args
}
