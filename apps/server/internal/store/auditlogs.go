package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const auditLogCols = `id, admin_id, admin_email, method, path, action, target_id, status, ip, detail, created_at`

func scanAuditLog(row pgx.Row) (*AdminAuditLog, error) {
	var l AdminAuditLog
	err := row.Scan(&l.ID, &l.AdminID, &l.AdminEmail, &l.Method, &l.Path, &l.Action, &l.TargetID, &l.Status, &l.IP, &l.Detail, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func DeleteAuditLogsBefore(ctx context.Context, q Q, before time.Time) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM admin_audit_logs WHERE created_at < $1`, before)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func InsertAuditLog(ctx context.Context, q Q, l *AdminAuditLog) error {
	_, err := q.Exec(ctx,
		`INSERT INTO admin_audit_logs (admin_id, admin_email, method, path, action, target_id, status, ip, detail)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		l.AdminID, l.AdminEmail, l.Method, l.Path, l.Action, l.TargetID, l.Status, l.IP, l.Detail)
	return err
}

// ListAuditLogs 审计日志分页（limit+1 行）。admin 模糊匹配 admin_email，path 模糊匹配请求路径。
func ListAuditLogs(ctx context.Context, q Q, admin, path string, limit int, cursor *Cursor) ([]*AdminAuditLog, error) {
	sql := `SELECT ` + auditLogCols + ` FROM admin_audit_logs WHERE true`
	args := []any{}
	if admin != "" {
		args = append(args, "%"+admin+"%")
		sql += fmt.Sprintf(` AND admin_email ILIKE $%d`, len(args))
	}
	if path != "" {
		args = append(args, "%"+path+"%")
		sql += fmt.Sprintf(` AND path ILIKE $%d`, len(args))
	}
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AdminAuditLog
	for rows.Next() {
		l, err := scanAuditLog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
