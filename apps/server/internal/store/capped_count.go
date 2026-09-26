package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// ListCountCap 是列表计数与页码翻页的上限。超过上限只报告"至少这么多"，
// 计数成本因此与总数据量无关；页码分页也只允许浏览这个范围内的记录。
const ListCountCap = 10000

// CappedCount 为带上限的计数；Capped 表示实际数量超过 ListCountCap。
type CappedCount struct {
	Value  int64
	Capped bool
}

func clipCount(n int64) CappedCount {
	if n > ListCountCap {
		return CappedCount{Value: ListCountCap, Capped: true}
	}
	return CappedCount{Value: n}
}

// countCapped 统计 fromWhere（以 " FROM" 开头）最多 ListCountCap+1 行。
func countCapped(ctx context.Context, q Q, fromWhere string, args []any) (CappedCount, error) {
	var n int64
	err := q.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM (SELECT 1%s LIMIT %d) capped`, fromWhere, ListCountCap+1), args...).Scan(&n)
	return clipCount(n), err
}

// unionCountSQL 返回对 UNION ALL 源做带上限计数的标量子查询，每个分支各自截断，
// 避免把含 JOIN 的分支整体展开。结果可能超过上限（各分支之和），需经 clipCount。
func unionCountSQL(branches []string, alias, where string) string {
	parts := make([]string, len(branches))
	for i, branch := range branches {
		parts[i] = fmt.Sprintf(`(SELECT 1 FROM (%s) %s WHERE true%s LIMIT %d)`, branch, alias, where, ListCountCap+1)
	}
	return `(SELECT count(*) FROM (` + strings.Join(parts, ` UNION ALL `) + `) capped)`
}

// CountUsersCapped 与 ListUsers/ListUsersOffset 使用同一套筛选，结果带上限。
func CountUsersCapped(ctx context.Context, q Q, search, status, lifecycle, risk, profileTag string, extra ...AdminListFilter) (CappedCount, error) {
	where, args := userListWhere(search, status, lifecycle, risk, profileTag)
	where, args = appendAdminDates(where, args, "users.created_at", extra)
	return countCapped(ctx, q, where, args)
}

// CountUserLedgerCapped 为用户账本页码分页提供带上限的总数。
func CountUserLedgerCapped(ctx context.Context, q Q, userID uuid.UUID) (CappedCount, error) {
	return countCapped(ctx, q, ` FROM wallet_ledger WHERE user_id = $1`, []any{userID})
}

// EnqueueUserProfileRefresh 把缺少画像快照的用户交给 Worker 异步刷新。
func EnqueueUserProfileRefresh(ctx context.Context, q Q, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `INSERT INTO user_profile_refresh_queue (user_id, requested_at)
		SELECT id, now() FROM unnest($1::uuid[]) AS id
		ON CONFLICT (user_id) DO UPDATE SET requested_at = EXCLUDED.requested_at`, ids)
	return err
}

// CountSecurityRiskEventsCapped 与 ListSecurityRiskEventsPage 同范围。
func CountSecurityRiskEventsCapped(ctx context.Context, q Q, unresolvedOnly bool) (CappedCount, error) {
	return countCapped(ctx, q, ` FROM security_risk_events WHERE ($1=false OR resolved_at IS NULL)`, []any{unresolvedOnly})
}

// CountActiveSecurityBlocksCapped 统计仍生效的临时限制。
func CountActiveSecurityBlocksCapped(ctx context.Context, q Q) (CappedCount, error) {
	return countCapped(ctx, q, ` FROM security_blocks WHERE revoked_at IS NULL AND expires_at > now()`, nil)
}

// CountUploadHashBlocksCapped 统计上传哈希规则；activeOnly 只统计生效中的规则。
func CountUploadHashBlocksCapped(ctx context.Context, q Q, activeOnly bool) (CappedCount, error) {
	return countCapped(ctx, q, ` FROM upload_hash_blocklist WHERE ($1=false OR active)`, []any{activeOnly})
}

// likeOrEmpty 把关键词转成转义后的 ILIKE 模式；空关键词保持为空字符串。
func likeOrEmpty(search string) string {
	if strings.TrimSpace(search) == "" {
		return ""
	}
	return literalSearch(search)
}
