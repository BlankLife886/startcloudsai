package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// AdminDeveloperAPICallFilter narrows the admin view of /v1 requests.
// Status is charged, refunded or pending; Kind is image or chat.
type AdminDeveloperAPICallFilter struct {
	From, To   *time.Time
	Status     string
	Kind       string
	ModelID    string
	UserSearch string
	KeySearch  string
}

// AdminDeveloperAPICall is one /v1 request with its accounting, for operators.
type AdminDeveloperAPICall struct {
	BillingID         string
	SourceType        string
	Status            string
	PriceCents        int64
	CreatedAt         time.Time
	SettledAt         *time.Time
	UserID            *uuid.UUID
	UserEmail         *string
	Username          *string
	KeyLabel          *string
	KeyPrefix         *string
	ModelID           string
	ProviderID        string
	RouteID           string
	Units             int
	UpstreamCostCents int64
	Metadata          json.RawMessage
}

// AdminDeveloperAPIModelTotal sums one model's requests in the filtered range.
type AdminDeveloperAPIModelTotal struct {
	ModelID           string
	Calls             int64
	Charged           int64
	RevenueCents      int64
	UpstreamCostCents int64
}

// AdminDeveloperAPISummary totals the requests matching a filter.
type AdminDeveloperAPISummary struct {
	Calls             int64
	Charged           int64
	Refunded          int64
	Pending           int64
	RevenueCents      int64
	UpstreamCostCents int64
	Users             int64
	Keys              int64
	Models            []AdminDeveloperAPIModelTotal
}

const adminDeveloperAPICallFrom = ` FROM developer_api_billing_requests r
	LEFT JOIN usage_profit_ledger p ON p.source_type = '` + DeveloperAPIProfitSourceType + `'
		AND p.source_id = r.billing_id AND p.billing_generation = 0
	WHERE true`

func adminDeveloperAPICallWhere(f AdminDeveloperAPICallFilter) (string, []any) {
	sql, args := "", []any{}
	add := func(clause string, value any) {
		args = append(args, value)
		sql += fmt.Sprintf(clause, len(args))
	}
	if f.From != nil {
		add(" AND r.created_at >= $%d", *f.From)
	}
	if f.To != nil {
		add(" AND r.created_at < $%d", *f.To)
	}
	switch f.Status {
	case "charged":
		sql += " AND r.status = 'succeeded'"
	case "refunded":
		sql += " AND r.status IN ('failed','expired')"
	case "pending":
		sql += " AND r.status = 'pending'"
	}
	switch f.Kind {
	case "image":
		add(" AND r.source_type = $%d", DeveloperAPIImageLedgerSource)
	case "chat":
		add(" AND r.source_type <> $%d", DeveloperAPIImageLedgerSource)
	}
	if f.ModelID != "" {
		add(" AND p.model_id = $%d", f.ModelID)
	}
	if f.UserSearch != "" {
		if id, err := uuid.Parse(f.UserSearch); err == nil {
			add(" AND r.user_id = $%d", id)
		} else {
			args = append(args, literalSearch(f.UserSearch))
			sql += fmt.Sprintf(" AND EXISTS (SELECT 1 FROM users matched_user WHERE matched_user.id = r.user_id AND (matched_user.email::text ILIKE $%[1]d OR matched_user.username ILIKE $%[1]d))", len(args))
		}
	}
	if f.KeySearch != "" {
		args = append(args, literalSearch(f.KeySearch))
		sql += fmt.Sprintf(" AND EXISTS (SELECT 1 FROM user_api_keys matched_key WHERE matched_key.id = r.api_key_id AND (matched_key.label ILIKE $%[1]d OR matched_key.key_prefix ILIKE $%[1]d))", len(args))
	}
	return sql, args
}

// CountAdminDeveloperAPICallsCapped counts the rows ListAdminDeveloperAPICalls pages over.
func CountAdminDeveloperAPICallsCapped(ctx context.Context, q Q, f AdminDeveloperAPICallFilter) (CappedCount, error) {
	where, args := adminDeveloperAPICallWhere(f)
	return countCapped(ctx, q, adminDeveloperAPICallFrom+where, args)
}

// ListAdminDeveloperAPICalls returns /v1 requests across users, newest first.
func ListAdminDeveloperAPICalls(ctx context.Context, q Q, f AdminDeveloperAPICallFilter, limit, offset int) ([]*AdminDeveloperAPICall, error) {
	where, args := adminDeveloperAPICallWhere(f)
	args = append(args, max(limit, 1), max(offset, 0))
	rows, err := q.Query(ctx, fmt.Sprintf(`SELECT r.billing_id, r.source_type, r.status, r.price_cents, r.created_at, r.settled_at,
			r.user_id, u.email::text, u.username, k.label, k.key_prefix,
			COALESCE(p.model_id, ''), COALESCE(p.provider_id, ''), COALESCE(p.route_id, ''), COALESCE(p.units, 0),
			COALESCE(p.upstream_cost_cents, 0), COALESCE(p.metadata, '{}'::jsonb)
		%s%s
		ORDER BY r.created_at DESC, r.billing_id DESC LIMIT $%d OFFSET $%d`,
		`FROM developer_api_billing_requests r
		LEFT JOIN usage_profit_ledger p ON p.source_type = '`+DeveloperAPIProfitSourceType+`'
			AND p.source_id = r.billing_id AND p.billing_generation = 0
		LEFT JOIN users u ON u.id = r.user_id
		LEFT JOIN user_api_keys k ON k.id = r.api_key_id
		WHERE true`, where, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*AdminDeveloperAPICall, 0)
	for rows.Next() {
		var item AdminDeveloperAPICall
		if err := rows.Scan(&item.BillingID, &item.SourceType, &item.Status, &item.PriceCents, &item.CreatedAt, &item.SettledAt,
			&item.UserID, &item.UserEmail, &item.Username, &item.KeyLabel, &item.KeyPrefix,
			&item.ModelID, &item.ProviderID, &item.RouteID, &item.Units, &item.UpstreamCostCents, &item.Metadata); err != nil {
			return nil, err
		}
		items = append(items, &item)
	}
	return items, rows.Err()
}

// SummarizeAdminDeveloperAPICalls totals the requests matching f, with the
// busiest models first.
func SummarizeAdminDeveloperAPICalls(ctx context.Context, q Q, f AdminDeveloperAPICallFilter) (*AdminDeveloperAPISummary, error) {
	where, args := adminDeveloperAPICallWhere(f)
	summary := &AdminDeveloperAPISummary{Models: []AdminDeveloperAPIModelTotal{}}
	if err := q.QueryRow(ctx, `SELECT count(*),
			count(*) FILTER (WHERE r.status = 'succeeded'),
			count(*) FILTER (WHERE r.status IN ('failed','expired')),
			count(*) FILTER (WHERE r.status = 'pending'),
			COALESCE(sum(r.price_cents) FILTER (WHERE r.status = 'succeeded'), 0),
			COALESCE(sum(p.upstream_cost_cents) FILTER (WHERE r.status = 'succeeded'), 0),
			count(DISTINCT r.user_id), count(DISTINCT r.api_key_id)`+adminDeveloperAPICallFrom+where, args...).Scan(
		&summary.Calls, &summary.Charged, &summary.Refunded, &summary.Pending,
		&summary.RevenueCents, &summary.UpstreamCostCents, &summary.Users, &summary.Keys); err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `SELECT COALESCE(p.model_id, ''), count(*),
			count(*) FILTER (WHERE r.status = 'succeeded'),
			COALESCE(sum(r.price_cents) FILTER (WHERE r.status = 'succeeded'), 0),
			COALESCE(sum(p.upstream_cost_cents) FILTER (WHERE r.status = 'succeeded'), 0)`+adminDeveloperAPICallFrom+where+`
		GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 20`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item AdminDeveloperAPIModelTotal
		if err := rows.Scan(&item.ModelID, &item.Calls, &item.Charged, &item.RevenueCents, &item.UpstreamCostCents); err != nil {
			return nil, err
		}
		summary.Models = append(summary.Models, item)
	}
	return summary, rows.Err()
}
