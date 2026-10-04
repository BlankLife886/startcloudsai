package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// 内容违规记录的状态：扣费、按规则免扣（照常退回）、扣费后由管理员退回。
const (
	ContentPolicyCharged  = "charged"
	ContentPolicyWaived   = "waived"
	ContentPolicyRefunded = "refunded"
)

// ContentPolicyViolation 是一次被上游以内容违规驳回的生图请求。
type ContentPolicyViolation struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	SourceType      string
	SourceID        string
	Feature         string
	ModelID         string
	Prompt          string
	UpstreamMessage string
	MatchedRule     string
	AmountCents     int64
	ChargedCents    int64
	Status          string
	WaiveReason     string
	RefundedAt      *time.Time
	RefundedBy      *uuid.UUID
	RefundNote      string
	CreatedAt       time.Time
	// 列表查询时连带读出的用户信息。
	UserEmail *string
	Username  *string
}

const contentPolicyColumns = `v.id, v.user_id, v.source_type, v.source_id, v.feature, v.model_id, v.prompt,
	v.upstream_message, v.matched_rule, v.amount_cents, v.charged_cents, v.status, v.waive_reason,
	v.refunded_at, v.refunded_by, v.refund_note, v.created_at`

func scanContentPolicyViolation(row pgx.Row, withUser bool) (*ContentPolicyViolation, error) {
	v := &ContentPolicyViolation{}
	dest := []any{&v.ID, &v.UserID, &v.SourceType, &v.SourceID, &v.Feature, &v.ModelID, &v.Prompt,
		&v.UpstreamMessage, &v.MatchedRule, &v.AmountCents, &v.ChargedCents, &v.Status, &v.WaiveReason,
		&v.RefundedAt, &v.RefundedBy, &v.RefundNote, &v.CreatedAt}
	if withUser {
		dest = append(dest, &v.UserEmail, &v.Username)
	}
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	return v, nil
}

// LockUserContentPolicy 在当前事务内串行化同一用户的违规判定，保证每日免扣次数不会被并发失败重复使用。
func LockUserContentPolicy(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('content_policy:' || $1::text, 0))`, userID)
	return err
}

// CountUserContentPolicyViolationsSince 统计用户从 since 起的违规次数（含免扣与已退回的）。
func CountUserContentPolicyViolationsSince(ctx context.Context, q Q, userID uuid.UUID, since time.Time) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM content_policy_violations WHERE user_id=$1 AND created_at >= $2`, userID, since).Scan(&n)
	return n, err
}

// InsertContentPolicyViolation 写入一条违规记录。同一来源只记一次：重复写入时返回已有记录和 false。
func InsertContentPolicyViolation(ctx context.Context, q Q, v ContentPolicyViolation) (*ContentPolicyViolation, bool, error) {
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	if v.CreatedAt.IsZero() {
		v.CreatedAt = time.Now().UTC()
	}
	row := q.QueryRow(ctx, `INSERT INTO content_policy_violations AS v
		(id, user_id, source_type, source_id, feature, model_id, prompt, upstream_message, matched_rule,
		 amount_cents, charged_cents, status, waive_reason, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (source_type, source_id) DO NOTHING
		RETURNING `+contentPolicyColumns,
		v.ID, v.UserID, v.SourceType, v.SourceID, v.Feature, v.ModelID, v.Prompt, v.UpstreamMessage, v.MatchedRule,
		v.AmountCents, v.ChargedCents, v.Status, v.WaiveReason, v.CreatedAt)
	inserted, err := scanContentPolicyViolation(row, false)
	if err == nil {
		return inserted, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	existing, err := scanContentPolicyViolation(q.QueryRow(ctx, `SELECT `+contentPolicyColumns+`
		FROM content_policy_violations v WHERE v.source_type=$1 AND v.source_id=$2`, v.SourceType, v.SourceID), false)
	return existing, false, err
}

// GetContentPolicyViolationForUpdate 锁定一条违规记录，供管理员退回时使用。
func GetContentPolicyViolationForUpdate(ctx context.Context, q Q, id uuid.UUID) (*ContentPolicyViolation, error) {
	v, err := scanContentPolicyViolation(q.QueryRow(ctx, `SELECT `+contentPolicyColumns+`
		FROM content_policy_violations v WHERE v.id=$1 FOR UPDATE`, id), false)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

// MarkContentPolicyViolationRefunded 把已扣费的违规记录标记为管理员已退回。
func MarkContentPolicyViolationRefunded(ctx context.Context, q Q, id, adminID uuid.UUID, note string, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE content_policy_violations SET status=$2, refunded_at=$3, refunded_by=$4, refund_note=$5
		WHERE id=$1 AND status=$6`, id, ContentPolicyRefunded, at, adminID, note, ContentPolicyCharged)
	return err
}

// AdminContentPolicyFilter 是后台违规记录页的筛选条件，列表与汇总共用。
type AdminContentPolicyFilter struct {
	From, To   *time.Time
	UserSearch string
	Search     string // 在提示词和上游原话里搜索
	Status     string
	SourceType string
}

func adminContentPolicyWhere(f AdminContentPolicyFilter) (string, []any) {
	sql, args := "", []any{}
	add := func(clause string, value any) {
		args = append(args, value)
		sql += fmt.Sprintf(clause, len(args))
	}
	if f.From != nil {
		add(" AND v.created_at >= $%d", *f.From)
	}
	if f.To != nil {
		add(" AND v.created_at < $%d", *f.To)
	}
	if f.Status != "" {
		add(" AND v.status = $%d", f.Status)
	}
	if f.SourceType != "" {
		add(" AND v.source_type = $%d", f.SourceType)
	}
	if f.Search != "" {
		args = append(args, literalSearch(f.Search))
		sql += fmt.Sprintf(" AND (v.prompt ILIKE $%[1]d OR v.upstream_message ILIKE $%[1]d)", len(args))
	}
	if f.UserSearch != "" {
		if id, err := uuid.Parse(f.UserSearch); err == nil {
			add(" AND v.user_id = $%d", id)
		} else {
			args = append(args, literalSearch(f.UserSearch))
			sql += fmt.Sprintf(" AND (u.email::text ILIKE $%[1]d OR u.username ILIKE $%[1]d)", len(args))
		}
	}
	return sql, args
}

const adminContentPolicyFrom = ` FROM content_policy_violations v LEFT JOIN users u ON u.id = v.user_id WHERE true`

// CountAdminContentPolicyViolationsCapped 统计 ListAdminContentPolicyViolations 分页的总行数。
func CountAdminContentPolicyViolationsCapped(ctx context.Context, q Q, f AdminContentPolicyFilter) (CappedCount, error) {
	where, args := adminContentPolicyWhere(f)
	return countCapped(ctx, q, adminContentPolicyFrom+where, args)
}

// ListAdminContentPolicyViolations 按时间倒序列出违规记录。
func ListAdminContentPolicyViolations(ctx context.Context, q Q, f AdminContentPolicyFilter, limit, offset int) ([]*ContentPolicyViolation, error) {
	where, args := adminContentPolicyWhere(f)
	args = append(args, limit, offset)
	rows, err := q.Query(ctx, fmt.Sprintf(`SELECT %s, u.email::text, u.username%s%s
		ORDER BY v.created_at DESC, v.id DESC LIMIT $%d OFFSET $%d`,
		contentPolicyColumns, adminContentPolicyFrom, where, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []*ContentPolicyViolation{}
	for rows.Next() {
		v, err := scanContentPolicyViolation(rows, true)
		if err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}

// ContentPolicyUserTotal 是一个用户在筛选范围内的违规合计。
type ContentPolicyUserTotal struct {
	UserID       uuid.UUID
	UserEmail    *string
	Username     *string
	Violations   int64
	ChargedCents int64
	LastAt       time.Time
}

// AdminContentPolicySummary 汇总筛选范围内的违规记录。
type AdminContentPolicySummary struct {
	Violations    int64
	Charged       int64
	Waived        int64
	Refunded      int64
	ChargedCents  int64
	RefundedCents int64
	Users         int64
	TopUsers      []ContentPolicyUserTotal
}

// SummarizeAdminContentPolicyViolations 汇总违规次数、扣费与违规最多的用户。
func SummarizeAdminContentPolicyViolations(ctx context.Context, q Q, f AdminContentPolicyFilter) (*AdminContentPolicySummary, error) {
	where, args := adminContentPolicyWhere(f)
	s := &AdminContentPolicySummary{TopUsers: []ContentPolicyUserTotal{}}
	err := q.QueryRow(ctx, `SELECT count(*),
		count(*) FILTER (WHERE v.status = 'charged'),
		count(*) FILTER (WHERE v.status = 'waived'),
		count(*) FILTER (WHERE v.status = 'refunded'),
		COALESCE(sum(v.charged_cents) FILTER (WHERE v.status = 'charged'), 0),
		COALESCE(sum(v.charged_cents) FILTER (WHERE v.status = 'refunded'), 0),
		count(DISTINCT v.user_id)`+adminContentPolicyFrom+where, args...).
		Scan(&s.Violations, &s.Charged, &s.Waived, &s.Refunded, &s.ChargedCents, &s.RefundedCents, &s.Users)
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `SELECT v.user_id, max(u.email::text), max(u.username), count(*),
		COALESCE(sum(v.charged_cents) FILTER (WHERE v.status = 'charged'), 0), max(v.created_at)`+
		adminContentPolicyFrom+where+` GROUP BY v.user_id ORDER BY count(*) DESC, max(v.created_at) DESC LIMIT 10`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t ContentPolicyUserTotal
		if err := rows.Scan(&t.UserID, &t.UserEmail, &t.Username, &t.Violations, &t.ChargedCents, &t.LastAt); err != nil {
			return nil, err
		}
		s.TopUsers = append(s.TopUsers, t)
	}
	return s, rows.Err()
}
