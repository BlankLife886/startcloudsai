package store

import (
	"context"
	"time"
)

type DashboardPeriodMetrics struct {
	SettledCents int64 `json:"settledCents"`
	ImageCount   int64 `json:"imageCount"`
}

type DashboardTokenMetrics struct {
	InputTokens     int64 `json:"inputTokens"`
	OutputTokens    int64 `json:"outputTokens"`
	ReasoningTokens int64 `json:"reasoningTokens"`
	TotalTokens     int64 `json:"totalTokens"`
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
	err := q.QueryRow(ctx, `
		WITH settled AS (
			SELECT ledger.created_at,
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
		), task_images AS (
			SELECT task.finished_at AS delivered_at,
				CASE WHEN jsonb_typeof(task.output_keys) = 'array'
					THEN jsonb_array_length(task.output_keys) ELSE 0 END
				+ task.deleted_output_count AS image_count
			FROM tasks task
			WHERE task.status = 'succeeded'
				AND task.finished_at >= $3
				AND lower(COALESCE(task.params->>'_historyMirror', '')) <> 'true'
		), assistant_images AS (
			SELECT run.finished_at AS delivered_at, COUNT(DISTINCT image.item->>'fileKey') AS image_count
			FROM assistant_runs run
			JOIN assistant_messages message ON message.id = run.assistant_message_id
			LEFT JOIN LATERAL jsonb_array_elements(
				(CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
					THEN message.metadata->'images' ELSE '[]'::jsonb END)
				|| (CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
					THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END)
			) image(item) ON COALESCE(image.item->>'fileKey', '') <> ''
			WHERE run.status = 'succeeded'
				AND run.finished_at >= $3
				AND (run.mode = 'image' OR run.resolved_mode = 'image')
			GROUP BY run.id, run.finished_at
		), delivered_images AS (
			SELECT delivered_at, image_count FROM task_images
			UNION ALL
			SELECT delivered_at, image_count FROM assistant_images
		), today_tokens AS (
			SELECT
				COALESCE(SUM(CASE WHEN COALESCE(message.metadata->'usage'->>'inputTokens', '') ~ '^[0-9]+$'
					THEN (message.metadata->'usage'->>'inputTokens')::bigint ELSE 0 END), 0) AS input_tokens,
				COALESCE(SUM(CASE WHEN COALESCE(message.metadata->'usage'->>'outputTokens', '') ~ '^[0-9]+$'
					THEN (message.metadata->'usage'->>'outputTokens')::bigint ELSE 0 END), 0) AS output_tokens,
				COALESCE(SUM(CASE
					WHEN COALESCE(message.metadata->'usage'->>'reasoningTokens', '') ~ '^[0-9]+$'
						THEN (message.metadata->'usage'->>'reasoningTokens')::bigint
					WHEN COALESCE(message.metadata->>'reasoningTokens', '') ~ '^[0-9]+$'
						THEN (message.metadata->>'reasoningTokens')::bigint
					ELSE 0 END), 0) AS reasoning_tokens,
				COALESCE(SUM(CASE
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
					ELSE 0 END), 0) AS total_tokens
			FROM assistant_runs run
			JOIN assistant_messages message ON message.id = run.assistant_message_id
			WHERE run.finished_at >= $1
		)
		SELECT
			COALESCE((SELECT SUM(cents) FROM settled WHERE created_at >= $1), 0),
			COALESCE((SELECT SUM(image_count) FROM delivered_images WHERE delivered_at >= $1), 0),
			COALESCE((SELECT SUM(cents) FROM settled WHERE created_at >= $2), 0),
			COALESCE((SELECT SUM(image_count) FROM delivered_images WHERE delivered_at >= $2), 0),
			COALESCE((SELECT SUM(cents) FROM settled), 0),
			COALESCE((SELECT SUM(image_count) FROM delivered_images), 0),
			input_tokens, output_tokens, reasoning_tokens, total_tokens
		FROM today_tokens`, todayStart, last7DaysStart, last30DaysStart).Scan(
		&metrics.Today.SettledCents,
		&metrics.Today.ImageCount,
		&metrics.Last7Days.SettledCents,
		&metrics.Last7Days.ImageCount,
		&metrics.Last30Days.SettledCents,
		&metrics.Last30Days.ImageCount,
		&metrics.TodayToken.InputTokens,
		&metrics.TodayToken.OutputTokens,
		&metrics.TodayToken.ReasoningTokens,
		&metrics.TodayToken.TotalTokens,
	)
	return &metrics, err
}
