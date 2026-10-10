package store

import (
	"fmt"
	"github.com/google/uuid"
	"strings"
	"time"
)

// AdminListFilter is shared by list/count operations so their scopes stay equal.
type AdminListFilter struct {
	From, To   *time.Time
	Search     string
	UserSearch string
	Method     string
}

func appendAdminDates(sql string, args []any, column string, filters []AdminListFilter) (string, []any) {
	if len(filters) == 0 {
		return sql, args
	}
	f := filters[0]
	if f.From != nil {
		args = append(args, *f.From)
		sql += fmt.Sprintf(" AND %s >= $%d", column, len(args))
	}
	if f.To != nil {
		args = append(args, *f.To)
		sql += fmt.Sprintf(" AND %s < $%d", column, len(args))
	}
	return sql, args
}

// LikePattern 返回转义了 %、_ 的 ILIKE 包含匹配模式，供 store 外手写查询使用。
func LikePattern(value string) string { return literalSearch(value) }

func literalSearch(value string) string {
	return "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.TrimSpace(value)) + "%"
}

func appendAdminTaskFilter(sql string, args []any, filters []AdminListFilter) (string, []any) {
	sql, args = appendAdminDates(sql, args, "created_at", filters)
	if len(filters) == 0 {
		return sql, args
	}
	f := filters[0]
	if f.Search != "" {
		if id, err := uuid.Parse(f.Search); err == nil {
			args = append(args, id)
			sql += fmt.Sprintf(" AND id=$%d", len(args))
		} else {
			args = append(args, literalSearch(f.Search))
			sql += fmt.Sprintf(" AND prompt ILIKE $%d", len(args))
		}
	}
	if f.UserSearch != "" {
		if id, err := uuid.Parse(f.UserSearch); err == nil {
			args = append(args, id)
			sql += fmt.Sprintf(" AND user_id=$%d", len(args))
		} else {
			args = append(args, literalSearch(f.UserSearch))
			sql += fmt.Sprintf(" AND EXISTS (SELECT 1 FROM users matched_user WHERE matched_user.id=admin_tasks.user_id AND matched_user.role='user' AND (matched_user.email::text ILIKE $%d OR matched_user.username ILIKE $%d))", len(args), len(args))
		}
	}
	return sql, args
}
