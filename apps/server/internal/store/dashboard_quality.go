package store

import (
	"context"
	"time"
)

type DashboardAgentQuality struct {
	TraceCount      int64   `json:"traceCount"`
	Succeeded       int64   `json:"succeeded"`
	Failed          int64   `json:"failed"`
	AverageScore    float64 `json:"averageScore"`
	FailedSteps     int64   `json:"failedSteps"`
	UnfinishedSteps int64   `json:"unfinishedSteps"`
}

type DashboardBillingQuality struct {
	AnomalousEntries    int64 `json:"anomalousEntries"`
	ZeroRevenueEntries  int64 `json:"zeroRevenueEntries"`
	BelowCostEntries    int64 `json:"belowCostEntries"`
	ZeroCostEntries     int64 `json:"zeroCostEntries"`
	MissingRouteEntries int64 `json:"missingRouteEntries"`
}

type DashboardOpenAPIQuality struct {
	Enabled         bool  `json:"enabled"`
	ActiveKeys      int64 `json:"activeKeys"`
	Requests24Hours int64 `json:"requests24Hours"`
	PendingWebhooks int64 `json:"pendingWebhooks"`
	DeadWebhooks    int64 `json:"deadWebhooks"`
}

type DashboardObjectCleanupQuality struct {
	Pending         int64      `json:"pending"`
	Failed          int64      `json:"failed"`
	OldestCreatedAt *time.Time `json:"oldestCreatedAt"`
}

type DashboardQualitySummary struct {
	Agent         DashboardAgentQuality         `json:"agent"`
	Billing       DashboardBillingQuality       `json:"billing"`
	OpenAPI       DashboardOpenAPIQuality       `json:"openApi"`
	ObjectCleanup DashboardObjectCleanupQuality `json:"objectCleanup"`
}

// GetDashboardQualitySummary keeps the dashboard's slower business-quality
// counters in one database round trip. Callers control the reporting windows.
func GetDashboardQualitySummary(ctx context.Context, q Q, agentSince, billingSince, apiSince time.Time) (*DashboardQualitySummary, error) {
	var out DashboardQualitySummary
	err := q.QueryRow(ctx, `WITH
	agent_traces AS (
		SELECT count(*) AS total,
			count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
			count(*) FILTER (WHERE status = 'failed') AS failed,
			COALESCE(avg(score), 0)::float8 AS average_score
		FROM agent_execution_traces WHERE started_at >= $1
	),
	agent_steps AS (
		SELECT count(step.id) FILTER (WHERE step.status = 'failed') AS failed,
			count(step.id) FILTER (WHERE step.status IN ('pending', 'claimed')) AS unfinished
		FROM agent_tool_steps step
		JOIN agent_execution_traces trace ON trace.id = step.trace_id
		WHERE trace.started_at >= $1
	),
	billing AS (
		SELECT
			count(*) FILTER (WHERE event_status = 'succeeded' AND units > 0 AND (
				revenue_cents = 0 OR revenue_cents < upstream_cost_cents OR upstream_cost_cents = 0
				OR (source_type = 'task' AND route_id = '')
			)) AS anomalous,
			count(*) FILTER (WHERE event_status = 'succeeded' AND units > 0 AND revenue_cents = 0) AS zero_revenue,
			count(*) FILTER (WHERE event_status = 'succeeded' AND units > 0 AND revenue_cents < upstream_cost_cents) AS below_cost,
			count(*) FILTER (WHERE event_status = 'succeeded' AND units > 0 AND upstream_cost_cents = 0) AS zero_cost,
			count(*) FILTER (WHERE event_status = 'succeeded' AND units > 0 AND source_type = 'task' AND route_id = '') AS missing_route
		FROM usage_profit_ledger WHERE created_at >= $2
	),
	open_api AS (
		SELECT
			(SELECT count(*) FROM user_api_keys
				WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())) AS active_keys,
			(SELECT count(*) FROM api_key_usage_events WHERE created_at >= $3) AS requests_24h,
			(SELECT count(*) FROM api_webhook_deliveries WHERE status = 'pending') AS pending_webhooks,
			(SELECT count(*) FROM api_webhook_deliveries WHERE status = 'dead') AS dead_webhooks
	),
	cleanup AS (
		SELECT count(*) AS pending,
			count(*) FILTER (WHERE attempts > 0) AS failed,
			min(created_at) AS oldest_created_at
		FROM object_cleanup_jobs
	)
	SELECT agent_traces.total, agent_traces.succeeded, agent_traces.failed, agent_traces.average_score,
		agent_steps.failed, agent_steps.unfinished,
		billing.anomalous, billing.zero_revenue, billing.below_cost, billing.zero_cost, billing.missing_route,
		open_api.active_keys, open_api.requests_24h, open_api.pending_webhooks, open_api.dead_webhooks,
		cleanup.pending, cleanup.failed, cleanup.oldest_created_at
	FROM agent_traces CROSS JOIN agent_steps CROSS JOIN billing CROSS JOIN open_api CROSS JOIN cleanup`,
		agentSince, billingSince, apiSince).Scan(
		&out.Agent.TraceCount, &out.Agent.Succeeded, &out.Agent.Failed, &out.Agent.AverageScore,
		&out.Agent.FailedSteps, &out.Agent.UnfinishedSteps,
		&out.Billing.AnomalousEntries, &out.Billing.ZeroRevenueEntries, &out.Billing.BelowCostEntries,
		&out.Billing.ZeroCostEntries, &out.Billing.MissingRouteEntries,
		&out.OpenAPI.ActiveKeys, &out.OpenAPI.Requests24Hours, &out.OpenAPI.PendingWebhooks, &out.OpenAPI.DeadWebhooks,
		&out.ObjectCleanup.Pending, &out.ObjectCleanup.Failed, &out.ObjectCleanup.OldestCreatedAt,
	)
	return &out, err
}
