package store

import (
	"context"

	"github.com/google/uuid"
)

// UserUsageDay 是用户在某个本地自然日的使用量。
type UserUsageDay struct {
	Date            string `json:"date"`
	Creations       int64  `json:"creations"`
	Images          int64  `json:"images"`
	Points          int64  `json:"points"`
	DurationSeconds int64  `json:"durationSeconds"`
}

// UserUsageStats 汇总个人中心的使用统计：逐日用量（前端再按月、年聚合）和创作时段分布。
type UserUsageStats struct {
	Days []UserUsageDay `json:"days"`
	// WeekdayHour[weekday][hour]：weekday 0=周日（与 PostgreSQL EXTRACT(DOW) 一致）。
	WeekdayHour [7][24]int64 `json:"weekdayHour"`
}

// 单个任务计入创作时长的上限，避免异常长的排队或卡死任务拉高统计。
const usageMaxTaskSeconds = 3600

// usageActivitySQL 合并站内图片任务与 AI 助手运行，作为「创作」记录。
// 助手生图不产生站内任务，图片数取助手回复消息里的 images。
const usageActivitySQL = `
	SELECT created_at,
		CASE WHEN jsonb_typeof(output_keys) = 'array' THEN jsonb_array_length(output_keys) ELSE 0 END
			+ deleted_output_count AS images,
		CASE WHEN started_at IS NOT NULL AND finished_at > started_at
			THEN LEAST(EXTRACT(EPOCH FROM finished_at - started_at), $3)::bigint ELSE 0 END AS seconds
	FROM tasks WHERE user_id = $1
	UNION ALL
	SELECT r.created_at,
		CASE WHEN r.status = 'succeeded' AND jsonb_typeof(m.metadata->'images') = 'array'
			THEN jsonb_array_length(m.metadata->'images') ELSE 0 END,
		CASE WHEN r.started_at IS NOT NULL AND r.finished_at > r.started_at
			THEN LEAST(EXTRACT(EPOCH FROM r.finished_at - r.started_at), $3)::bigint ELSE 0 END
	FROM assistant_runs r
	LEFT JOIN assistant_messages m ON m.id = r.assistant_message_id
	WHERE r.user_id = $1`

// usageSpendSQL 与钱包「已消耗」口径一致：只统计 spend 结算，排除订阅内部划转。
const usageSpendSQL = `
	SELECT created_at,
		CASE
			WHEN source_type IN ('subscription_refund_hold','subscription_upgrade_exchange','subscription_cycle_expiry') THEN 0
			WHEN settled_points IS NOT NULL THEN settled_points
			WHEN ABS(delta_cents) > 0 THEN ABS(delta_cents)
			ELSE COALESCE(NULLIF((regexp_match(COALESCE(reason, ''), '消耗冻结 ([0-9]+)'))[1], '')::bigint, 0)
		END AS points
	FROM wallet_ledger WHERE user_id = $1 AND kind = 'spend'`

// GetUserUsageStats 按 timezone（IANA 名称，调用方需先校验）把记录归到用户本地日期和时段。
func GetUserUsageStats(ctx context.Context, q Q, userID uuid.UUID, timezone string) (*UserUsageStats, error) {
	stats := &UserUsageStats{Days: []UserUsageDay{}}
	rows, err := q.Query(ctx, `
		WITH activity AS (`+usageActivitySQL+`), spend AS (`+usageSpendSQL+`)
		SELECT to_char(day, 'YYYY-MM-DD'), SUM(creations)::bigint, SUM(images)::bigint,
			SUM(points)::bigint, SUM(seconds)::bigint
		FROM (
			SELECT (created_at AT TIME ZONE $2)::date AS day, 1 AS creations, images, 0::bigint AS points, seconds FROM activity
			UNION ALL
			SELECT (created_at AT TIME ZONE $2)::date, 0, 0, points, 0 FROM spend
		) usage
		GROUP BY day ORDER BY day`, userID, timezone, usageMaxTaskSeconds)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var day UserUsageDay
		if err := rows.Scan(&day.Date, &day.Creations, &day.Images, &day.Points, &day.DurationSeconds); err != nil {
			rows.Close()
			return nil, err
		}
		stats.Days = append(stats.Days, day)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = q.Query(ctx, `
		WITH activity AS (`+usageActivitySQL+`)
		SELECT EXTRACT(DOW FROM created_at AT TIME ZONE $2)::int, EXTRACT(HOUR FROM created_at AT TIME ZONE $2)::int, COUNT(*)
		FROM activity GROUP BY 1, 2`, userID, timezone, usageMaxTaskSeconds)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var weekday, hour int
		var count int64
		if err := rows.Scan(&weekday, &hour, &count); err != nil {
			return nil, err
		}
		if weekday >= 0 && weekday < 7 && hour >= 0 && hour < 24 {
			stats.WeekdayHour[weekday][hour] = count
		}
	}
	return stats, rows.Err()
}
