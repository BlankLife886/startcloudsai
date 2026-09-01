package store

import (
	"context"
	"time"
)

type DashboardPeriodMetrics struct {
	SettledCents int64                 `json:"settledCents"`
	ImageCount   int64                 `json:"imageCount"`
	Text         DashboardTextMetrics  `json:"text"`
	Image        DashboardImageMetrics `json:"image"`
}

type DashboardTokenMetrics struct {
	InputTokens     int64 `json:"inputTokens"`
	OutputTokens    int64 `json:"outputTokens"`
	ReasoningTokens int64 `json:"reasoningTokens"`
	TotalTokens     int64 `json:"totalTokens"`
}

type DashboardTextMetrics struct {
	RequestCount int64 `json:"requestCount"`
	SettledCents int64 `json:"settledCents"`
	DashboardTokenMetrics
}

type DashboardImageMetrics struct {
	RequestCount int64 `json:"requestCount"`
	ImageCount   int64 `json:"imageCount"`
	SettledCents int64 `json:"settledCents"`
}

type DashboardUsageMetrics struct {
	Today      DashboardPeriodMetrics `json:"today"`
	Last7Days  DashboardPeriodMetrics `json:"last7Days"`
	Last30Days DashboardPeriodMetrics `json:"last30Days"`
	TodayToken DashboardTokenMetrics  `json:"todayToken"`
}

// GetDashboardUsageMetrics aggregates settled AI usage, delivered image
// outputs, and recorded assistant token usage using caller-provided business
// day boundaries. Image history mirrors are excluded because their source
// assistant run is counted separately.
func GetDashboardUsageMetrics(
	ctx context.Context,
	q Q,
	todayStart, last7DaysStart, last30DaysStart time.Time,
) (*DashboardUsageMetrics, error) {
	var metrics DashboardUsageMetrics
	rows, err := q.Query(ctx, `
		WITH settled AS (
			SELECT ledger.created_at,
				CASE
					WHEN ledger.source_type = 'task' THEN 'image'
					WHEN ledger.source_type = 'assistant_run'
						AND (COALESCE(run.resolved_mode, '') = 'image' OR (COALESCE(run.resolved_mode, '') = '' AND run.mode = 'image'))
						THEN 'image'
					WHEN ledger.source_type = 'assistant_run' THEN 'text'
					ELSE 'other'
				END AS modality,
				GREATEST(
					ABS(ledger.delta_cents),
					COALESCE(task.cost_cents, 0),
					COALESCE(run.cost_cents, 0),
					COALESCE(
						NULLIF((regexp_match(COALESCE(ledger.reason, ''), '消耗冻结 ([0-9]+)'))[1], '')::bigint,
						0
					)
				) AS cents
			FROM wallet_ledger ledger
			LEFT JOIN tasks task
				ON ledger.source_type = 'task'
				AND task.id::text = split_part(COALESCE(ledger.source_id, ''), '/', 1)
			LEFT JOIN assistant_runs run
				ON ledger.source_type = 'assistant_run'
				AND run.id::text = split_part(COALESCE(ledger.source_id, ''), '/', 1)
			WHERE ledger.kind = 'spend' AND ledger.created_at >= $3
		), task_usage AS (
			SELECT task.finished_at AS delivered_at,
				'image'::text AS modality,
				1::bigint AS request_count,
				CASE WHEN jsonb_typeof(task.output_keys) = 'array'
					THEN jsonb_array_length(task.output_keys) ELSE 0 END
				+ task.deleted_output_count AS image_count,
				0::bigint AS input_tokens,
				0::bigint AS output_tokens,
				0::bigint AS reasoning_tokens,
				0::bigint AS total_tokens
			FROM tasks task
			WHERE task.status = 'succeeded'
				AND task.finished_at >= $3
				AND lower(COALESCE(task.params->>'_historyMirror', '')) <> 'true'
		), assistant_usage AS (
			SELECT run.finished_at AS delivered_at,
				CASE WHEN COALESCE(run.resolved_mode, '') = 'image' OR (COALESCE(run.resolved_mode, '') = '' AND run.mode = 'image')
					THEN 'image' ELSE 'text' END AS modality,
				1::bigint AS request_count,
				CASE WHEN COALESCE(run.resolved_mode, '') = 'image' OR (COALESCE(run.resolved_mode, '') = '' AND run.mode = 'image') THEN
					(SELECT COUNT(DISTINCT image.item->>'fileKey')
					 FROM jsonb_array_elements(
						(CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
							THEN message.metadata->'images' ELSE '[]'::jsonb END)
						|| (CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
							THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END)
					 ) image(item)
					 WHERE COALESCE(image.item->>'fileKey', '') <> '')
				ELSE 0 END AS image_count,
				CASE WHEN COALESCE(message.metadata->'usage'->>'inputTokens', '') ~ '^[0-9]+$'
					THEN (message.metadata->'usage'->>'inputTokens')::bigint ELSE 0 END AS input_tokens,
				CASE WHEN COALESCE(message.metadata->'usage'->>'outputTokens', '') ~ '^[0-9]+$'
					THEN (message.metadata->'usage'->>'outputTokens')::bigint ELSE 0 END AS output_tokens,
				CASE
					WHEN COALESCE(message.metadata->'usage'->>'reasoningTokens', '') ~ '^[0-9]+$'
						THEN (message.metadata->'usage'->>'reasoningTokens')::bigint
					WHEN COALESCE(message.metadata->>'reasoningTokens', '') ~ '^[0-9]+$'
						THEN (message.metadata->>'reasoningTokens')::bigint
					ELSE 0 END AS reasoning_tokens,
				CASE
					WHEN COALESCE(message.metadata->'usage'->>'totalTokens', '') ~ '^[0-9]+$'
						THEN (message.metadata->'usage'->>'totalTokens')::bigint
					WHEN COALESCE(message.metadata->'usage'->>'inputTokens', '') ~ '^[0-9]+$'
						OR COALESCE(message.metadata->'usage'->>'outputTokens', '') ~ '^[0-9]+$'
						THEN (CASE WHEN COALESCE(message.metadata->'usage'->>'inputTokens', '') ~ '^[0-9]+$'
							THEN (message.metadata->'usage'->>'inputTokens')::bigint ELSE 0 END)
							+ (CASE WHEN COALESCE(message.metadata->'usage'->>'outputTokens', '') ~ '^[0-9]+$'
							THEN (message.metadata->'usage'->>'outputTokens')::bigint ELSE 0 END)
					WHEN COALESCE(message.metadata->>'reasoningTokens', '') ~ '^[0-9]+$'
						THEN (message.metadata->>'reasoningTokens')::bigint
					ELSE 0 END AS total_tokens
			FROM assistant_runs run
			JOIN assistant_messages message ON message.id = run.assistant_message_id
			WHERE run.status = 'succeeded'
				AND run.finished_at >= $3
		), usage_events AS (
			SELECT delivered_at, modality, request_count, image_count,
				input_tokens, output_tokens, reasoning_tokens, total_tokens FROM task_usage
			UNION ALL
			SELECT delivered_at, modality, request_count, image_count,
				input_tokens, output_tokens, reasoning_tokens, total_tokens FROM assistant_usage
		), periods AS (
			SELECT * FROM (VALUES
				('today'::text, $1::timestamptz),
				('last7Days'::text, $2::timestamptz),
				('last30Days'::text, $3::timestamptz)
			) value(period, since)
		)
		SELECT
			periods.period,
			COALESCE(ledger.total_cents, 0),
			COALESCE(ledger.text_cents, 0),
			COALESCE(ledger.image_cents, 0),
			COALESCE(usage.text_requests, 0),
			COALESCE(usage.input_tokens, 0),
			COALESCE(usage.output_tokens, 0),
			COALESCE(usage.reasoning_tokens, 0),
			COALESCE(usage.total_tokens, 0),
			COALESCE(usage.image_requests, 0),
			COALESCE(usage.image_count, 0)
		FROM periods
		LEFT JOIN LATERAL (
			SELECT SUM(cents) AS total_cents,
				SUM(cents) FILTER (WHERE modality = 'text') AS text_cents,
				SUM(cents) FILTER (WHERE modality = 'image') AS image_cents
			FROM settled WHERE created_at >= periods.since
		) ledger ON true
		LEFT JOIN LATERAL (
			SELECT
				SUM(request_count) FILTER (WHERE modality = 'text') AS text_requests,
				SUM(input_tokens) FILTER (WHERE modality = 'text') AS input_tokens,
				SUM(output_tokens) FILTER (WHERE modality = 'text') AS output_tokens,
				SUM(reasoning_tokens) FILTER (WHERE modality = 'text') AS reasoning_tokens,
				SUM(total_tokens) FILTER (WHERE modality = 'text') AS total_tokens,
				SUM(request_count) FILTER (WHERE modality = 'image') AS image_requests,
				SUM(image_count) FILTER (WHERE modality = 'image') AS image_count
			FROM usage_events WHERE delivered_at >= periods.since
		) usage ON true
		ORDER BY periods.since DESC`, todayStart, last7DaysStart, last30DaysStart)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	periods := map[string]*DashboardPeriodMetrics{
		"today": &metrics.Today, "last7Days": &metrics.Last7Days, "last30Days": &metrics.Last30Days,
	}
	for rows.Next() {
		var period string
		var item DashboardPeriodMetrics
		if err := rows.Scan(
			&period,
			&item.SettledCents,
			&item.Text.SettledCents,
			&item.Image.SettledCents,
			&item.Text.RequestCount,
			&item.Text.InputTokens,
			&item.Text.OutputTokens,
			&item.Text.ReasoningTokens,
			&item.Text.TotalTokens,
			&item.Image.RequestCount,
			&item.Image.ImageCount,
		); err != nil {
			return nil, err
		}
		item.ImageCount = item.Image.ImageCount
		if target := periods[period]; target != nil {
			*target = item
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	metrics.TodayToken = metrics.Today.Text.DashboardTokenMetrics
	return &metrics, nil
}
