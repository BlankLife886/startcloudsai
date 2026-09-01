package store

import (
	"context"
	"time"
)

type UserAnalyticsSummary struct {
	TotalUsers       int64 `json:"totalUsers"`
	ProfilesReady    int64 `json:"profilesReady"`
	NewUsers30       int64 `json:"newUsers30"`
	ActiveUsers7     int64 `json:"activeUsers7"`
	ActiveUsers30    int64 `json:"activeUsers30"`
	AtRiskUsers      int64 `json:"atRiskUsers"`
	HighValueUsers   int64 `json:"highValueUsers"`
	ReturnedUsers    int64 `json:"returnedUsers"`
	FrequentFailures int64 `json:"frequentFailures"`
}

type UserAnalyticsDistributionItem struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

type UserAnalyticsDistributions struct {
	Lifecycle []UserAnalyticsDistributionItem `json:"lifecycle"`
	Risk      []UserAnalyticsDistributionItem `json:"risk"`
	Value     []UserAnalyticsDistributionItem `json:"value"`
}

type UserAnalyticsDailyPoint struct {
	Date            string `json:"date"`
	NewUsers        int64  `json:"newUsers"`
	ActiveUsers     int64  `json:"activeUsers"`
	SubmittingUsers int64  `json:"submittingUsers"`
	SuccessfulUsers int64  `json:"successfulUsers"`
}

type UserRetentionCohort struct {
	Week      string `json:"week"`
	Users     int64  `json:"users"`
	Day1Base  int64  `json:"day1Base"`
	Day1      int64  `json:"day1"`
	Day7Base  int64  `json:"day7Base"`
	Day7      int64  `json:"day7"`
	Day30Base int64  `json:"day30Base"`
	Day30     int64  `json:"day30"`
}

type UserAnalyticsFeatureFunnel struct {
	Feature         string `json:"feature"`
	Opens           int64  `json:"opens"`
	Visitors        int64  `json:"visitors"`
	Submissions     int64  `json:"submissions"`
	SubmittingUsers int64  `json:"submittingUsers"`
	Succeeded       int64  `json:"succeeded"`
	SuccessfulUsers int64  `json:"successfulUsers"`
}

type UserAnalyticsFunnel struct {
	TrackingSince *time.Time                   `json:"trackingSince"`
	Features      []UserAnalyticsFeatureFunnel `json:"features"`
}

type UserAnalytics struct {
	Summary       UserAnalyticsSummary       `json:"summary"`
	Distributions UserAnalyticsDistributions `json:"distributions"`
	DailyTrend    []UserAnalyticsDailyPoint  `json:"dailyTrend"`
	Retention     []UserRetentionCohort      `json:"retention"`
	Funnel        UserAnalyticsFunnel        `json:"funnel"`
	CalculatedAt  time.Time                  `json:"calculatedAt"`
}

func GetUserAnalytics(ctx context.Context, q Q, now time.Time) (*UserAnalytics, error) {
	result := &UserAnalytics{
		Distributions: UserAnalyticsDistributions{
			Lifecycle: []UserAnalyticsDistributionItem{},
			Risk:      []UserAnalyticsDistributionItem{},
			Value:     []UserAnalyticsDistributionItem{},
		},
		DailyTrend:   []UserAnalyticsDailyPoint{},
		Retention:    []UserRetentionCohort{},
		Funnel:       UserAnalyticsFunnel{Features: []UserAnalyticsFeatureFunnel{}},
		CalculatedAt: now,
	}
	if err := q.QueryRow(ctx, `SELECT count(*), count(metric.user_id),
		count(*) FILTER (WHERE account.created_at >= $1::timestamptz-interval '30 days'),
		count(*) FILTER (WHERE metric.last_activity_at >= $1::timestamptz-interval '7 days'),
		count(*) FILTER (WHERE metric.last_activity_at >= $1::timestamptz-interval '30 days'),
		count(*) FILTER (WHERE metric.risk_level IN ('medium','high')),
		count(*) FILTER (WHERE metric.tags ? 'high_value'),
		count(*) FILTER (WHERE metric.lifecycle='returned'),
		count(*) FILTER (WHERE metric.tags ? 'frequent_failure')
		FROM users account LEFT JOIN user_profile_metrics metric ON metric.user_id=account.id
		WHERE account.role='user'`, now).Scan(
		&result.Summary.TotalUsers, &result.Summary.ProfilesReady, &result.Summary.NewUsers30,
		&result.Summary.ActiveUsers7, &result.Summary.ActiveUsers30, &result.Summary.AtRiskUsers,
		&result.Summary.HighValueUsers, &result.Summary.ReturnedUsers, &result.Summary.FrequentFailures,
	); err != nil {
		return nil, err
	}

	distributionRows, err := q.Query(ctx, `WITH profile_values AS (
		SELECT COALESCE(metric.lifecycle,'pending') AS lifecycle,
			COALESCE(metric.risk_level,'pending') AS risk,
			COALESCE(metric.value_tier,'pending') AS value
		FROM users account LEFT JOIN user_profile_metrics metric ON metric.user_id=account.id
		WHERE account.role='user'
	), distributions AS (
		SELECT 'lifecycle' AS dimension, lifecycle AS key, count(*) AS amount FROM profile_values GROUP BY lifecycle
		UNION ALL
		SELECT 'risk', risk, count(*) FROM profile_values GROUP BY risk
		UNION ALL
		SELECT 'value', value, count(*) FROM profile_values GROUP BY value
	)
	SELECT dimension, key, amount FROM distributions ORDER BY dimension, amount DESC, key`)
	if err != nil {
		return nil, err
	}
	for distributionRows.Next() {
		var dimension string
		var item UserAnalyticsDistributionItem
		if err := distributionRows.Scan(&dimension, &item.Key, &item.Count); err != nil {
			distributionRows.Close()
			return nil, err
		}
		switch dimension {
		case "lifecycle":
			result.Distributions.Lifecycle = append(result.Distributions.Lifecycle, item)
		case "risk":
			result.Distributions.Risk = append(result.Distributions.Risk, item)
		case "value":
			result.Distributions.Value = append(result.Distributions.Value, item)
		}
	}
	if err := distributionRows.Err(); err != nil {
		distributionRows.Close()
		return nil, err
	}
	distributionRows.Close()

	trendRows, err := q.Query(ctx, `WITH days AS (
		SELECT generate_series(($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date-29,
			($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date, interval '1 day')::date AS day
	), registrations AS (
		SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day, count(*) AS users
		FROM users WHERE role='user' AND created_at >= $1::timestamptz-interval '30 days' GROUP BY day
	), runs AS (
		SELECT user_id, (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day, status
		FROM tasks WHERE created_at >= $1::timestamptz-interval '30 days'
		UNION ALL
		SELECT user_id, (created_at AT TIME ZONE 'Asia/Shanghai')::date, status
		FROM assistant_runs WHERE created_at >= $1::timestamptz-interval '30 days'
	), activity AS (
		SELECT user_id, day FROM runs
		UNION
		SELECT user_id, (created_at AT TIME ZONE 'Asia/Shanghai')::date
		FROM user_behavior_events WHERE created_at >= $1::timestamptz-interval '30 days'
	), activity_daily AS (
		SELECT day, count(DISTINCT user_id) AS users FROM activity GROUP BY day
	), run_daily AS (
		SELECT day, count(DISTINCT user_id) AS submitters,
			count(DISTINCT user_id) FILTER (WHERE status='succeeded') AS successful
		FROM runs GROUP BY day
	)
	SELECT to_char(days.day,'YYYY-MM-DD'), COALESCE(registrations.users,0),
		COALESCE(activity_daily.users,0), COALESCE(run_daily.submitters,0), COALESCE(run_daily.successful,0)
	FROM days LEFT JOIN registrations USING(day) LEFT JOIN activity_daily USING(day)
	LEFT JOIN run_daily USING(day) ORDER BY days.day`, now)
	if err != nil {
		return nil, err
	}
	for trendRows.Next() {
		var item UserAnalyticsDailyPoint
		if err := trendRows.Scan(&item.Date, &item.NewUsers, &item.ActiveUsers, &item.SubmittingUsers, &item.SuccessfulUsers); err != nil {
			trendRows.Close()
			return nil, err
		}
		result.DailyTrend = append(result.DailyTrend, item)
	}
	if err := trendRows.Err(); err != nil {
		trendRows.Close()
		return nil, err
	}
	trendRows.Close()

	retentionRows, err := q.Query(ctx, `WITH accounts AS (
		SELECT id, (created_at AT TIME ZONE 'Asia/Shanghai')::date AS created_day,
			date_trunc('week', created_at AT TIME ZONE 'Asia/Shanghai')::date AS cohort_week
		FROM users WHERE role='user'
			AND created_at >= date_trunc('week', $1::timestamptz AT TIME ZONE 'Asia/Shanghai')-interval '7 weeks'
	), activity AS (
		SELECT user_id, (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day FROM tasks
		WHERE created_at >= $1::timestamptz-interval '10 weeks'
		UNION
		SELECT user_id, (created_at AT TIME ZONE 'Asia/Shanghai')::date FROM assistant_runs
		WHERE created_at >= $1::timestamptz-interval '10 weeks'
		UNION
		SELECT user_id, (created_at AT TIME ZONE 'Asia/Shanghai')::date FROM user_behavior_events
		WHERE created_at >= $1::timestamptz-interval '10 weeks'
	), account_retention AS (
		SELECT account.id, account.created_day, account.cohort_week,
			bool_or(activity.day=account.created_day+1) AS day1,
			bool_or(activity.day=account.created_day+7) AS day7,
			bool_or(activity.day=account.created_day+30) AS day30
		FROM accounts account LEFT JOIN activity ON activity.user_id=account.id
		GROUP BY account.id, account.created_day, account.cohort_week
	), current_day AS (
		SELECT ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AS day
	)
	SELECT to_char(cohort_week,'YYYY-MM-DD'), count(*),
		count(*) FILTER (WHERE current_day.day>=created_day+1),
		count(*) FILTER (WHERE current_day.day>=created_day+1 AND day1),
		count(*) FILTER (WHERE current_day.day>=created_day+7),
		count(*) FILTER (WHERE current_day.day>=created_day+7 AND day7),
		count(*) FILTER (WHERE current_day.day>=created_day+30),
		count(*) FILTER (WHERE current_day.day>=created_day+30 AND day30)
	FROM account_retention CROSS JOIN current_day GROUP BY cohort_week ORDER BY cohort_week DESC`, now)
	if err != nil {
		return nil, err
	}
	for retentionRows.Next() {
		var item UserRetentionCohort
		if err := retentionRows.Scan(&item.Week, &item.Users, &item.Day1Base, &item.Day1,
			&item.Day7Base, &item.Day7, &item.Day30Base, &item.Day30); err != nil {
			retentionRows.Close()
			return nil, err
		}
		result.Retention = append(result.Retention, item)
	}
	if err := retentionRows.Err(); err != nil {
		retentionRows.Close()
		return nil, err
	}
	retentionRows.Close()

	if err := q.QueryRow(ctx, `SELECT min(created_at) FROM user_behavior_events
		WHERE created_at >= $1::timestamptz-interval '30 days'`, now).Scan(&result.Funnel.TrackingSince); err != nil {
		return nil, err
	}
	cutoff := now
	if result.Funnel.TrackingSince != nil {
		cutoff = *result.Funnel.TrackingSince
	}
	funnelRows, err := q.Query(ctx, `WITH behavior AS (
		SELECT feature, count(*) FILTER (WHERE event_name='feature_open') AS opens,
			count(DISTINCT user_id) FILTER (WHERE event_name='feature_open') AS visitors
		FROM user_behavior_events WHERE created_at >= $1 GROUP BY feature
	), runs AS (
		SELECT task.user_id, task.status, CASE
			WHEN task.params->>'_source'='react_canvas' OR task.params->>'source'='react_canvas'
				OR task.params->>'workspace'='infinite_canvas' OR task.params->>'_kind' LIKE 'canvas-%' THEN 'canvas'
			WHEN task.type='ecommerce_design' OR task.params->>'workspace' LIKE 'ecommerce%'
				OR task.params->>'_kind' LIKE '%ecommerce%' THEN 'ecommerce'
			WHEN task.type='t2i' THEN 'text_to_image'
			WHEN task.type='coloring' THEN 'coloring'
			WHEN task.type='ui_design' THEN 'design_workshop'
			WHEN task.type='model_sheet' THEN 'model_sheet'
			WHEN task.type='game_art' THEN 'game_art'
			WHEN task.type='background_remove' THEN 'background_remove'
			WHEN task.type IN ('media_tool','puzzle') THEN 'media_tools'
			ELSE 'other' END AS feature
		FROM tasks task WHERE task.created_at >= $1
		UNION ALL
		SELECT run.user_id, run.status,
			CASE WHEN run.params->>'_source'='react_canvas' OR run.params->>'source'='react_canvas'
				OR run.params->>'workspace'='infinite_canvas' OR run.params->>'_kind' LIKE 'canvas-%'
				THEN 'canvas' ELSE 'assistant' END
		FROM assistant_runs run WHERE run.created_at >= $1
	), run_rollup AS (
		SELECT feature, count(*) AS submissions, count(DISTINCT user_id) AS submitters,
			count(*) FILTER (WHERE status='succeeded') AS succeeded,
			count(DISTINCT user_id) FILTER (WHERE status='succeeded') AS successful_users
		FROM runs GROUP BY feature
	), features AS (
		SELECT feature FROM behavior UNION SELECT feature FROM run_rollup
	)
	SELECT features.feature, COALESCE(behavior.opens,0), COALESCE(behavior.visitors,0),
		COALESCE(run_rollup.submissions,0), COALESCE(run_rollup.submitters,0),
		COALESCE(run_rollup.succeeded,0), COALESCE(run_rollup.successful_users,0)
	FROM features LEFT JOIN behavior USING(feature) LEFT JOIN run_rollup USING(feature)
	ORDER BY COALESCE(run_rollup.submitters,0) DESC, COALESCE(behavior.visitors,0) DESC, features.feature`, cutoff)
	if err != nil {
		return nil, err
	}
	for funnelRows.Next() {
		var item UserAnalyticsFeatureFunnel
		if err := funnelRows.Scan(&item.Feature, &item.Opens, &item.Visitors, &item.Submissions,
			&item.SubmittingUsers, &item.Succeeded, &item.SuccessfulUsers); err != nil {
			funnelRows.Close()
			return nil, err
		}
		result.Funnel.Features = append(result.Funnel.Features, item)
	}
	if err := funnelRows.Err(); err != nil {
		funnelRows.Close()
		return nil, err
	}
	funnelRows.Close()
	return result, nil
}
