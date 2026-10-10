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

// UserUsageStats 汇总个人中心的使用统计（口径见 metric_facts.go）：逐日用量（前端再按月、年聚合）和创作时段分布。
type UserUsageStats struct {
	Days []UserUsageDay `json:"days"`
	// WeekdayHour[weekday][hour]：weekday 0=周日（与 PostgreSQL EXTRACT(DOW) 一致）。
	WeekdayHour [7][24]int64 `json:"weekdayHour"`
}

// GetUserUsageStats 按 timezone（IANA 名称，调用方需先校验）把记录归到用户本地日期和时段。
func GetUserUsageStats(ctx context.Context, q Q, userID uuid.UUID, timezone string) (*UserUsageStats, error) {
	stats := &UserUsageStats{Days: []UserUsageDay{}}
	rows, err := q.Query(ctx, `
		WITH activity AS (`+UserActivityFactsSQL+`), ledger AS (`+UserLedgerFactsSQL+`)
		SELECT to_char(day, 'YYYY-MM-DD'), SUM(creations)::bigint, SUM(images)::bigint,
			SUM(points)::bigint, SUM(seconds)::bigint
		FROM (
			SELECT (created_at AT TIME ZONE $2)::date AS day, 1 AS creations, images, 0::bigint AS points, seconds FROM activity
			UNION ALL
			SELECT (created_at AT TIME ZONE $2)::date, 0, 0, spend_points, 0 FROM ledger WHERE spend_points > 0
		) usage
		GROUP BY day ORDER BY day`, userID, timezone)
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
		WITH activity AS (`+UserActivityFactsSQL+`)
		SELECT EXTRACT(DOW FROM created_at AT TIME ZONE $2)::int, EXTRACT(HOUR FROM created_at AT TIME ZONE $2)::int, COUNT(*)
		FROM activity GROUP BY 1, 2`, userID, timezone)
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
