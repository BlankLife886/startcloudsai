package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const DeveloperAPIProfitSourceType = "developer_api"

type UsageProfitEntry struct {
	SourceType        string
	SourceID          string
	BillingGeneration int
	UserID            uuid.UUID
	APIKeyID          *uuid.UUID
	EventStatus       string
	Workspace         string
	ProviderID        string
	RouteID           string
	ModelID           string
	Units             int
	RevenueCents      int64
	UpstreamCostCents int64
	Metadata          map[string]any
	CreatedAt         time.Time
}

func InsertUsageProfitEntry(ctx context.Context, q Q, entry UsageProfitEntry) error {
	entry = normalizeUsageProfitEntry(entry)
	metadata, err := usageProfitMetadata(entry)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO usage_profit_ledger (
		source_type, source_id, billing_generation, user_id, event_status, workspace,
		provider_id, route_id, model_id, units, revenue_cents, upstream_cost_cents, metadata, created_at, api_key_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (source_type, source_id, billing_generation) DO NOTHING`,
		entry.SourceType, entry.SourceID, entry.BillingGeneration, entry.UserID, entry.EventStatus,
		entry.Workspace, entry.ProviderID, entry.RouteID, entry.ModelID, max(entry.Units, 0),
		max(entry.RevenueCents, 0), max(entry.UpstreamCostCents, 0), metadata, entry.CreatedAt, entry.APIKeyID)
	return err
}

// UpsertUsageProfitEntry finalizes an idempotent direct API accounting event.
// A timeout can leave a canceled event behind; a later retry with the same
// idempotency key changes that event to succeeded instead of adding another
// profitability row.
func UpsertUsageProfitEntry(ctx context.Context, q Q, entry UsageProfitEntry) error {
	entry = normalizeUsageProfitEntry(entry)
	metadata, err := usageProfitMetadata(entry)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO usage_profit_ledger (
		source_type, source_id, billing_generation, user_id, event_status, workspace,
		provider_id, route_id, model_id, units, revenue_cents, upstream_cost_cents, metadata, created_at, api_key_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (source_type, source_id, billing_generation) DO UPDATE SET
			user_id=EXCLUDED.user_id, event_status=EXCLUDED.event_status, workspace=EXCLUDED.workspace,
			provider_id=EXCLUDED.provider_id, route_id=EXCLUDED.route_id, model_id=EXCLUDED.model_id,
			units=EXCLUDED.units, revenue_cents=EXCLUDED.revenue_cents,
			upstream_cost_cents=EXCLUDED.upstream_cost_cents, metadata=EXCLUDED.metadata,
			api_key_id=EXCLUDED.api_key_id`,
		entry.SourceType, entry.SourceID, entry.BillingGeneration, entry.UserID, entry.EventStatus,
		entry.Workspace, entry.ProviderID, entry.RouteID, entry.ModelID, max(entry.Units, 0),
		max(entry.RevenueCents, 0), max(entry.UpstreamCostCents, 0), metadata, entry.CreatedAt, entry.APIKeyID)
	return err
}

func normalizeUsageProfitEntry(entry UsageProfitEntry) UsageProfitEntry {
	if entry.Metadata == nil {
		entry.Metadata = map[string]any{}
	}
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now().UTC()
	}
	return entry
}

func usageProfitMetadata(entry UsageProfitEntry) ([]byte, error) {
	metadata, err := json.Marshal(entry.Metadata)
	if err != nil {
		return nil, err
	}
	return metadata, nil
}

type ProfitPeriodMetrics struct {
	RevenueCents      int64 `json:"revenueCents"`
	UpstreamCostCents int64 `json:"upstreamCostCents"`
	GrossProfitCents  int64 `json:"grossProfitCents"`
	SucceededUnits    int64 `json:"succeededUnits"`
	FailedUnits       int64 `json:"failedUnits"`
	CanceledUnits     int64 `json:"canceledUnits"`
}

type ProfitabilitySummary struct {
	Today      ProfitPeriodMetrics `json:"today"`
	Last7Days  ProfitPeriodMetrics `json:"last7Days"`
	Last30Days ProfitPeriodMetrics `json:"last30Days"`
}

func GetProfitabilitySummary(ctx context.Context, q Q, todayStart, last7DaysStart, last30DaysStart time.Time) (*ProfitabilitySummary, error) {
	return GetProfitabilitySummaryBySource(ctx, q, todayStart, last7DaysStart, last30DaysStart, "")
}

func GetProfitabilitySummaryBySource(ctx context.Context, q Q, todayStart, last7DaysStart, last30DaysStart time.Time, sourceType string) (*ProfitabilitySummary, error) {
	var summary ProfitabilitySummary
	err := q.QueryRow(ctx, `SELECT
		COALESCE(SUM(revenue_cents) FILTER (WHERE created_at >= $1), 0),
		COALESCE(SUM(upstream_cost_cents) FILTER (WHERE created_at >= $1), 0),
		COALESCE(SUM(gross_profit_cents) FILTER (WHERE created_at >= $1), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $1 AND event_status = 'succeeded'), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $1 AND event_status = 'failed'), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $1 AND event_status = 'canceled'), 0),
		COALESCE(SUM(revenue_cents) FILTER (WHERE created_at >= $2), 0),
		COALESCE(SUM(upstream_cost_cents) FILTER (WHERE created_at >= $2), 0),
		COALESCE(SUM(gross_profit_cents) FILTER (WHERE created_at >= $2), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $2 AND event_status = 'succeeded'), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $2 AND event_status = 'failed'), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $2 AND event_status = 'canceled'), 0),
		COALESCE(SUM(revenue_cents) FILTER (WHERE created_at >= $3), 0),
		COALESCE(SUM(upstream_cost_cents) FILTER (WHERE created_at >= $3), 0),
		COALESCE(SUM(gross_profit_cents) FILTER (WHERE created_at >= $3), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $3 AND event_status = 'succeeded'), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $3 AND event_status = 'failed'), 0),
		COALESCE(SUM(units) FILTER (WHERE created_at >= $3 AND event_status = 'canceled'), 0)
		FROM usage_profit_ledger WHERE created_at >= $3 AND ($4 = '' OR source_type = $4)`, todayStart, last7DaysStart, last30DaysStart, sourceType).Scan(
		&summary.Today.RevenueCents, &summary.Today.UpstreamCostCents, &summary.Today.GrossProfitCents,
		&summary.Today.SucceededUnits, &summary.Today.FailedUnits, &summary.Today.CanceledUnits,
		&summary.Last7Days.RevenueCents, &summary.Last7Days.UpstreamCostCents, &summary.Last7Days.GrossProfitCents,
		&summary.Last7Days.SucceededUnits, &summary.Last7Days.FailedUnits, &summary.Last7Days.CanceledUnits,
		&summary.Last30Days.RevenueCents, &summary.Last30Days.UpstreamCostCents, &summary.Last30Days.GrossProfitCents,
		&summary.Last30Days.SucceededUnits, &summary.Last30Days.FailedUnits, &summary.Last30Days.CanceledUnits,
	)
	return &summary, err
}

type ProfitabilityBreakdown struct {
	Key               string `json:"key"`
	Label             string `json:"label"`
	RevenueCents      int64  `json:"revenueCents"`
	UpstreamCostCents int64  `json:"upstreamCostCents"`
	GrossProfitCents  int64  `json:"grossProfitCents"`
	Units             int64  `json:"units"`
}

func ListProfitabilityBreakdown(ctx context.Context, q Q, dimension string, since time.Time, limit int) ([]ProfitabilityBreakdown, error) {
	return ListProfitabilityBreakdownBySource(ctx, q, dimension, since, limit, "")
}

func ListProfitabilityBreakdownBySource(ctx context.Context, q Q, dimension string, since time.Time, limit int, sourceType string) ([]ProfitabilityBreakdown, error) {
	column := "model_id"
	from := "usage_profit_ledger ledger"
	label := "model_id"
	switch dimension {
	case "provider":
		column = "provider_id"
		label = "provider_id"
	case "route":
		column = "route_id"
		label = "route_id"
	case "workspace":
		column = "workspace"
		label = "workspace"
	case "user":
		column = "COALESCE(ledger.user_id::text, '')"
		label = "COALESCE(MAX(account.email), '已删除用户')"
		from += " LEFT JOIN users account ON account.id=ledger.user_id"
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	rows, err := q.Query(ctx, `SELECT `+column+` AS key, `+label+` AS label,
		COALESCE(SUM(revenue_cents), 0), COALESCE(SUM(upstream_cost_cents), 0),
		COALESCE(SUM(gross_profit_cents), 0), COALESCE(SUM(units), 0)
		FROM `+from+` WHERE ledger.created_at >= $1 AND ($3 = '' OR ledger.source_type = $3)
		GROUP BY key ORDER BY SUM(gross_profit_cents) ASC, SUM(revenue_cents) DESC LIMIT $2`, since, limit, sourceType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ProfitabilityBreakdown, 0, limit)
	for rows.Next() {
		var item ProfitabilityBreakdown
		if err := rows.Scan(&item.Key, &item.Label, &item.RevenueCents, &item.UpstreamCostCents, &item.GrossProfitCents, &item.Units); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
