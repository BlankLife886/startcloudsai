package store

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
)

type UserProfileRules struct {
	Version                     int `json:"version"`
	NewUserDays                 int `json:"newUserDays"`
	ActivationDays              int `json:"activationDays"`
	ActiveDays                  int `json:"activeDays"`
	ChurnRiskDays               int `json:"churnRiskDays"`
	DormantDays                 int `json:"dormantDays"`
	FrequentFailureMinRuns      int `json:"frequentFailureMinRuns"`
	FrequentFailureRatePercent  int `json:"frequentFailureRatePercent"`
	PowerUserActiveDays30       int `json:"powerUserActiveDays30"`
	PowerUserSuccessfulRuns30   int `json:"powerUserSuccessfulRuns30"`
	PowerUserFeatureDiversity30 int `json:"powerUserFeatureDiversity30"`
	HighValuePercentile         int `json:"highValuePercentile"`
}

func DefaultUserProfileRules() UserProfileRules {
	return UserProfileRules{
		Version: 1, NewUserDays: 3, ActivationDays: 7, ActiveDays: 7,
		ChurnRiskDays: 14, DormantDays: 30,
		FrequentFailureMinRuns: 5, FrequentFailureRatePercent: 40,
		PowerUserActiveDays30: 7, PowerUserSuccessfulRuns30: 20,
		PowerUserFeatureDiversity30: 2, HighValuePercentile: 90,
	}
}

type UserProfileMetric struct {
	UserID                 uuid.UUID         `json:"-"`
	Lifecycle              string            `json:"lifecycle"`
	RiskLevel              string            `json:"riskLevel"`
	ValueTier              string            `json:"valueTier"`
	PrimaryWorkspace       string            `json:"primaryWorkspace"`
	LastActivityAt         *time.Time        `json:"lastActivityAt"`
	LastSuccessAt          *time.Time        `json:"lastSuccessAt"`
	ActiveDays7            int               `json:"activeDays7"`
	ActiveDays30           int               `json:"activeDays30"`
	LifetimeSuccessfulRuns int64             `json:"lifetimeSuccessfulRuns"`
	SuccessfulRuns30       int64             `json:"successfulRuns30"`
	FailedRuns30           int64             `json:"failedRuns30"`
	CanceledRuns30         int64             `json:"canceledRuns30"`
	SuccessfulUnits30      int64             `json:"successfulUnits30"`
	SuccessRateBPS30       int               `json:"successRateBps30"`
	AverageDurationMs30    int64             `json:"averageDurationMs30"`
	P95DurationMs30        int64             `json:"p95DurationMs30"`
	FeatureDiversity30     int               `json:"featureDiversity30"`
	RevenueCents30         int64             `json:"revenueCents30"`
	UpstreamCostCents30    int64             `json:"upstreamCostCents30"`
	GrossProfitCents30     int64             `json:"grossProfitCents30"`
	AssetCount             int64             `json:"assetCount"`
	CanvasProjectCount     int64             `json:"canvasProjectCount"`
	SubmissionCount        int64             `json:"submissionCount"`
	ActiveAPIKeyCount      int64             `json:"activeApiKeyCount"`
	Tags                   []string          `json:"tags"`
	TagReasons             map[string]string `json:"tagReasons"`
	RuleVersion            int               `json:"ruleVersion"`
	CalculatedAt           time.Time         `json:"calculatedAt"`
}

type UserProfileHistoryItem struct {
	Lifecycle          string    `json:"lifecycle"`
	RiskLevel          string    `json:"riskLevel"`
	ValueTier          string    `json:"valueTier"`
	PrimaryWorkspace   string    `json:"primaryWorkspace"`
	ActiveDays30       int       `json:"activeDays30"`
	SuccessfulRuns30   int64     `json:"successfulRuns30"`
	FailedRuns30       int64     `json:"failedRuns30"`
	SuccessRateBPS30   int       `json:"successRateBps30"`
	RevenueCents30     int64     `json:"revenueCents30"`
	GrossProfitCents30 int64     `json:"grossProfitCents30"`
	Tags               []string  `json:"tags"`
	CalculatedAt       time.Time `json:"calculatedAt"`
}

type profileBaseMetrics struct {
	UserID                 uuid.UUID
	CreatedAt              time.Time
	LastActivityAt         *time.Time
	LastSuccessAt          *time.Time
	ActiveDays7            int
	ActiveDays30           int
	LifetimeSuccessfulRuns int64
	SuccessfulRuns30       int64
	FailedRuns30           int64
	CanceledRuns30         int64
	SuccessfulUnits30      int64
	AverageDurationMs30    int64
	P95DurationMs30        int64
	FeatureDiversity30     int
	PrimaryWorkspace       string
	ReturnedRecently       bool
	RevenueCents30         int64
	UpstreamCostCents30    int64
	GrossProfitCents30     int64
	AssetCount             int64
	CanvasProjectCount     int64
	SubmissionCount        int64
	ActiveAPIKeyCount      int64
}

const profileMetricsSelect = `user_id, lifecycle, risk_level, value_tier, primary_workspace,
	last_activity_at, last_success_at, active_days_7, active_days_30, lifetime_successful_runs,
	successful_runs_30, failed_runs_30, canceled_runs_30, successful_units_30, success_rate_bps_30,
	average_duration_ms_30, p95_duration_ms_30, feature_diversity_30, revenue_cents_30,
	upstream_cost_cents_30, gross_profit_cents_30, asset_count, canvas_project_count,
	submission_count, active_api_key_count, tags, tag_reasons, rule_version, calculated_at`

func scanUserProfile(scanner interface{ Scan(...any) error }) (*UserProfileMetric, error) {
	var item UserProfileMetric
	var tagsJSON, reasonsJSON []byte
	err := scanner.Scan(
		&item.UserID, &item.Lifecycle, &item.RiskLevel, &item.ValueTier, &item.PrimaryWorkspace,
		&item.LastActivityAt, &item.LastSuccessAt, &item.ActiveDays7, &item.ActiveDays30,
		&item.LifetimeSuccessfulRuns, &item.SuccessfulRuns30, &item.FailedRuns30,
		&item.CanceledRuns30, &item.SuccessfulUnits30, &item.SuccessRateBPS30,
		&item.AverageDurationMs30, &item.P95DurationMs30, &item.FeatureDiversity30,
		&item.RevenueCents30, &item.UpstreamCostCents30, &item.GrossProfitCents30,
		&item.AssetCount, &item.CanvasProjectCount, &item.SubmissionCount, &item.ActiveAPIKeyCount,
		&tagsJSON, &reasonsJSON, &item.RuleVersion, &item.CalculatedAt,
	)
	if err != nil {
		return nil, err
	}
	item.Tags = []string{}
	item.TagReasons = map[string]string{}
	_ = json.Unmarshal(tagsJSON, &item.Tags)
	_ = json.Unmarshal(reasonsJSON, &item.TagReasons)
	return &item, nil
}

func GetUserProfileMetric(ctx context.Context, q Q, userID uuid.UUID) (*UserProfileMetric, error) {
	item, err := scanUserProfile(q.QueryRow(ctx, `SELECT `+profileMetricsSelect+` FROM user_profile_metrics WHERE user_id=$1`, userID))
	return nilOnNoRows(item, err)
}

func UserProfileMetricsByUserIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]*UserProfileMetric, error) {
	out := make(map[uuid.UUID]*UserProfileMetric, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT `+profileMetricsSelect+` FROM user_profile_metrics WHERE user_id=ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanUserProfile(rows)
		if err != nil {
			return nil, err
		}
		out[item.UserID] = item
	}
	return out, rows.Err()
}

func LockQueuedUserProfileIDs(ctx context.Context, q Q, limit int) ([]uuid.UUID, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	rows, err := q.Query(ctx, `SELECT user_id FROM user_profile_refresh_queue
		ORDER BY requested_at, user_id FOR UPDATE SKIP LOCKED LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]uuid.UUID, 0, limit)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func DeleteUserProfileRefreshQueue(ctx context.Context, q Q, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `DELETE FROM user_profile_refresh_queue WHERE user_id=ANY($1)`, ids)
	return err
}

func EnqueueAllUserProfiles(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `INSERT INTO user_profile_refresh_queue (user_id, requested_at)
		SELECT id, now() FROM users WHERE role='user'
		ON CONFLICT (user_id) DO UPDATE SET requested_at=EXCLUDED.requested_at`)
	return err
}

func RefreshUserProfileDailyRollups(ctx context.Context, q Q, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	if _, err := q.Exec(ctx, `DELETE FROM user_profile_daily_rollups rollup
		USING user_profile_rollup_dirty dirty
		WHERE dirty.user_id=ANY($1) AND rollup.user_id=dirty.user_id
			AND rollup.activity_date=dirty.activity_date`, ids); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `WITH dirty AS MATERIALIZED (
		SELECT user_id, activity_date FROM user_profile_rollup_dirty
		WHERE user_id=ANY($1) FOR UPDATE
	), raw AS (
		SELECT task.user_id, dirty.activity_date,
			user_profile_event_workspace('task',task.type,task.params) AS workspace,
			task.created_at AS activity_at,
			CASE WHEN task.status='succeeded' THEN task.created_at END AS success_at,
			(task.status='succeeded')::int AS successful_runs,
			(task.status='failed')::int AS failed_runs,
			(task.status='canceled')::int AS canceled_runs,
			CASE WHEN task.status='succeeded' THEN GREATEST(task.count,1)::bigint ELSE 0 END AS successful_units,
			CASE WHEN task.status='succeeded' AND task.finished_at IS NOT NULL THEN
				GREATEST(0,(EXTRACT(EPOCH FROM (task.finished_at-COALESCE(task.started_at,task.created_at)))*1000)::bigint)
			END AS duration_ms,
			0::bigint AS revenue_cents,0::bigint AS upstream_cost_cents,0::bigint AS gross_profit_cents
		FROM dirty JOIN tasks task ON task.user_id=dirty.user_id
			AND (task.created_at AT TIME ZONE 'Asia/Shanghai')::date=dirty.activity_date
		UNION ALL
		SELECT run.user_id,dirty.activity_date,
			user_profile_event_workspace('assistant',run.mode,run.params),run.created_at,
			CASE WHEN run.status='succeeded' THEN run.created_at END,
			(run.status='succeeded')::int,(run.status='failed')::int,(run.status='canceled')::int,
			CASE WHEN run.status='succeeded' THEN 1::bigint ELSE 0 END,
			CASE WHEN run.status='succeeded' AND run.finished_at IS NOT NULL THEN
				GREATEST(0,(EXTRACT(EPOCH FROM (run.finished_at-COALESCE(run.started_at,run.created_at)))*1000)::bigint)
			END,
			0::bigint,0::bigint,0::bigint
		FROM dirty JOIN assistant_runs run ON run.user_id=dirty.user_id
			AND (run.created_at AT TIME ZONE 'Asia/Shanghai')::date=dirty.activity_date
		UNION ALL
		SELECT behavior.user_id,dirty.activity_date,behavior.feature,behavior.created_at,NULL::timestamptz,
			0,0,0,0::bigint,NULL::bigint,0::bigint,0::bigint,0::bigint
		FROM dirty JOIN user_behavior_events behavior ON behavior.user_id=dirty.user_id
			AND (behavior.created_at AT TIME ZONE 'Asia/Shanghai')::date=dirty.activity_date
		UNION ALL
		SELECT ledger.user_id,dirty.activity_date,COALESCE(NULLIF(ledger.workspace,''),'other'),
			NULL::timestamptz,NULL::timestamptz,0,0,0,0::bigint,NULL::bigint,
			ledger.revenue_cents,ledger.upstream_cost_cents,ledger.gross_profit_cents
		FROM dirty JOIN usage_profit_ledger ledger ON ledger.user_id=dirty.user_id
			AND (ledger.created_at AT TIME ZONE 'Asia/Shanghai')::date=dirty.activity_date
	), aggregated AS (
		SELECT user_id,activity_date,workspace,max(activity_at) AS last_activity_at,max(success_at) AS last_success_at,
			sum(successful_runs) AS successful_runs,sum(failed_runs) AS failed_runs,
			sum(canceled_runs) AS canceled_runs,sum(successful_units) AS successful_units,
			COALESCE(array_agg(duration_ms ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL),ARRAY[]::bigint[]) AS durations_ms,
			sum(revenue_cents) AS revenue_cents,sum(upstream_cost_cents) AS upstream_cost_cents,
			sum(gross_profit_cents) AS gross_profit_cents
		FROM raw GROUP BY user_id,activity_date,workspace
	), cleaned AS (
		DELETE FROM user_profile_rollup_dirty queued USING dirty
		WHERE queued.user_id=dirty.user_id AND queued.activity_date=dirty.activity_date
	)
	INSERT INTO user_profile_daily_rollups (
		user_id,activity_date,workspace,last_activity_at,last_success_at,successful_runs,failed_runs,
		canceled_runs,successful_units,durations_ms,revenue_cents,upstream_cost_cents,gross_profit_cents,calculated_at)
	SELECT user_id,activity_date,workspace,last_activity_at,last_success_at,successful_runs,failed_runs,
		canceled_runs,successful_units,durations_ms,revenue_cents,upstream_cost_cents,gross_profit_cents,now()
	FROM aggregated
	ON CONFLICT (user_id,activity_date,workspace) DO UPDATE SET
		last_activity_at=EXCLUDED.last_activity_at,last_success_at=EXCLUDED.last_success_at,
		successful_runs=EXCLUDED.successful_runs,failed_runs=EXCLUDED.failed_runs,
		canceled_runs=EXCLUDED.canceled_runs,successful_units=EXCLUDED.successful_units,
		durations_ms=EXCLUDED.durations_ms,revenue_cents=EXCLUDED.revenue_cents,
		upstream_cost_cents=EXCLUDED.upstream_cost_cents,gross_profit_cents=EXCLUDED.gross_profit_cents,
		calculated_at=EXCLUDED.calculated_at`, ids)
	return err
}

func RefreshUserProfiles(ctx context.Context, q Q, ids []uuid.UUID, rules UserProfileRules, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	if err := RefreshUserProfileDailyRollups(ctx, q, ids); err != nil {
		return err
	}
	rows, err := q.Query(ctx, `WITH selected_users AS (
		SELECT id, created_at, last_login_at FROM users WHERE role='user' AND id=ANY($1)
	), cutoffs AS (
		SELECT (($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date-6) AS day_7,
			(($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date-29) AS day_30
	), event_rollup AS (
		SELECT rollup.user_id,max(rollup.last_activity_at) AS last_activity_at,
			max(rollup.last_success_at) AS last_success_at,
			count(DISTINCT rollup.activity_date) FILTER (
				WHERE rollup.activity_date>=cutoffs.day_7 AND rollup.last_activity_at IS NOT NULL)::int AS active_days_7,
			count(DISTINCT rollup.activity_date) FILTER (
				WHERE rollup.activity_date>=cutoffs.day_30 AND rollup.last_activity_at IS NOT NULL)::int AS active_days_30,
			sum(rollup.successful_runs) AS lifetime_successful_runs,
			COALESCE(sum(rollup.successful_runs) FILTER (WHERE rollup.activity_date>=cutoffs.day_30),0) AS successful_runs_30,
			COALESCE(sum(rollup.failed_runs) FILTER (WHERE rollup.activity_date>=cutoffs.day_30),0) AS failed_runs_30,
			COALESCE(sum(rollup.canceled_runs) FILTER (WHERE rollup.activity_date>=cutoffs.day_30),0) AS canceled_runs_30,
			COALESCE(sum(rollup.successful_units) FILTER (WHERE rollup.activity_date>=cutoffs.day_30),0) AS successful_units_30,
			count(DISTINCT rollup.workspace) FILTER (
				WHERE rollup.activity_date>=cutoffs.day_30 AND rollup.successful_runs>0)::int AS feature_diversity_30
		FROM user_profile_daily_rollups rollup
		JOIN selected_users account ON account.id=rollup.user_id CROSS JOIN cutoffs
		GROUP BY rollup.user_id
	), duration_values AS (
		SELECT rollup.user_id,unnest(rollup.durations_ms) AS duration_ms
		FROM user_profile_daily_rollups rollup
		JOIN selected_users account ON account.id=rollup.user_id CROSS JOIN cutoffs
		WHERE rollup.activity_date>=cutoffs.day_30 AND cardinality(rollup.durations_ms)>0
	), duration_rollup AS (
		SELECT user_id,COALESCE(avg(duration_ms),0)::bigint AS average_duration_ms_30,
			COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms),0)::bigint AS p95_duration_ms_30
		FROM duration_values GROUP BY user_id
	), workspace_counts AS (
		SELECT rollup.user_id,rollup.workspace,sum(rollup.successful_runs) AS uses
		FROM user_profile_daily_rollups rollup
		JOIN selected_users account ON account.id=rollup.user_id CROSS JOIN cutoffs
		WHERE rollup.activity_date>=cutoffs.day_30 AND rollup.successful_runs>0
		GROUP BY rollup.user_id,rollup.workspace
	), primary_workspace AS (
		SELECT DISTINCT ON (user_id) user_id, workspace FROM workspace_counts
		ORDER BY user_id, uses DESC, workspace
	), success_days AS (
		SELECT rollup.user_id,rollup.activity_date,max(rollup.last_success_at) AS success_at
		FROM user_profile_daily_rollups rollup JOIN selected_users account ON account.id=rollup.user_id
		WHERE rollup.successful_runs>0 GROUP BY rollup.user_id,rollup.activity_date
	), success_gaps AS (
		SELECT user_id,success_at,lag(success_at) OVER (PARTITION BY user_id ORDER BY activity_date) AS previous_at
		FROM success_days
	), return_flags AS (
		SELECT user_id,bool_or(success_at >= $2::timestamptz-interval '7 days'
			AND previous_at <= success_at-interval '14 days') AS returned_recently
		FROM success_gaps GROUP BY user_id
	), profit_rollup AS (
		SELECT rollup.user_id,COALESCE(sum(rollup.revenue_cents),0) AS revenue_cents_30,
			COALESCE(sum(rollup.upstream_cost_cents),0) AS upstream_cost_cents_30,
			COALESCE(sum(rollup.gross_profit_cents),0) AS gross_profit_cents_30
		FROM user_profile_daily_rollups rollup
		JOIN selected_users account ON account.id=rollup.user_id CROSS JOIN cutoffs
		WHERE rollup.activity_date>=cutoffs.day_30 GROUP BY rollup.user_id
	), asset_rollup AS (
		SELECT asset.user_id, count(*) AS asset_count FROM user_assets asset
		JOIN selected_users account ON account.id=asset.user_id WHERE asset.deleted_at IS NULL GROUP BY asset.user_id
	), canvas_rollup AS (
		SELECT project.user_id, count(*) AS project_count FROM canvas_projects project
		JOIN selected_users account ON account.id=project.user_id GROUP BY project.user_id
	), submission_rollup AS (
		SELECT submission.user_id, count(*) AS submission_count FROM gallery_submissions submission
		JOIN selected_users account ON account.id=submission.user_id GROUP BY submission.user_id
	), api_rollup AS (
		SELECT api_key.user_id, count(*) AS api_key_count FROM user_api_keys api_key
		JOIN selected_users account ON account.id=api_key.user_id
		WHERE api_key.status='active' AND (api_key.expires_at IS NULL OR api_key.expires_at>$2::timestamptz) GROUP BY api_key.user_id
	)
	SELECT account.id, account.created_at, GREATEST(account.last_login_at, event_rollup.last_activity_at),
		event_rollup.last_success_at, COALESCE(event_rollup.active_days_7,0), COALESCE(event_rollup.active_days_30,0),
		COALESCE(event_rollup.lifetime_successful_runs,0), COALESCE(event_rollup.successful_runs_30,0),
		COALESCE(event_rollup.failed_runs_30,0), COALESCE(event_rollup.canceled_runs_30,0),
		COALESCE(event_rollup.successful_units_30,0), COALESCE(duration_rollup.average_duration_ms_30,0),
		COALESCE(duration_rollup.p95_duration_ms_30,0), COALESCE(event_rollup.feature_diversity_30,0),
		COALESCE(primary_workspace.workspace,''), COALESCE(return_flags.returned_recently,false),
		COALESCE(profit_rollup.revenue_cents_30,0), COALESCE(profit_rollup.upstream_cost_cents_30,0),
		COALESCE(profit_rollup.gross_profit_cents_30,0), COALESCE(asset_rollup.asset_count,0),
		COALESCE(canvas_rollup.project_count,0), COALESCE(submission_rollup.submission_count,0),
		COALESCE(api_rollup.api_key_count,0)
	FROM selected_users account
	LEFT JOIN event_rollup ON event_rollup.user_id=account.id
	LEFT JOIN duration_rollup ON duration_rollup.user_id=account.id
	LEFT JOIN primary_workspace ON primary_workspace.user_id=account.id
	LEFT JOIN return_flags ON return_flags.user_id=account.id
	LEFT JOIN profit_rollup ON profit_rollup.user_id=account.id
	LEFT JOIN asset_rollup ON asset_rollup.user_id=account.id
	LEFT JOIN canvas_rollup ON canvas_rollup.user_id=account.id
	LEFT JOIN submission_rollup ON submission_rollup.user_id=account.id
	LEFT JOIN api_rollup ON api_rollup.user_id=account.id`, ids, now)
	if err != nil {
		return err
	}
	defer rows.Close()
	metrics := make([]UserProfileMetric, 0, len(ids))
	for rows.Next() {
		var base profileBaseMetrics
		if err := rows.Scan(
			&base.UserID, &base.CreatedAt, &base.LastActivityAt, &base.LastSuccessAt,
			&base.ActiveDays7, &base.ActiveDays30, &base.LifetimeSuccessfulRuns,
			&base.SuccessfulRuns30, &base.FailedRuns30, &base.CanceledRuns30,
			&base.SuccessfulUnits30, &base.AverageDurationMs30, &base.P95DurationMs30,
			&base.FeatureDiversity30, &base.PrimaryWorkspace, &base.ReturnedRecently,
			&base.RevenueCents30, &base.UpstreamCostCents30, &base.GrossProfitCents30,
			&base.AssetCount, &base.CanvasProjectCount, &base.SubmissionCount, &base.ActiveAPIKeyCount,
		); err != nil {
			return err
		}
		metrics = append(metrics, buildUserProfileMetric(base, rules, now))
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()
	currentMetrics, err := UserProfileMetricsByUserIDs(ctx, q, ids)
	if err != nil {
		return err
	}
	for i := range metrics {
		previous := currentMetrics[metrics[i].UserID]
		if previous == nil || previous.ValueTier != "high" || metrics[i].RevenueCents30 <= 0 || metrics[i].GrossProfitCents30 < 0 {
			continue
		}
		metrics[i].ValueTier = "high"
		if !containsProfileTag(metrics[i].Tags, "high_value") {
			metrics[i].Tags = append(metrics[i].Tags, "high_value")
		}
		if reason := previous.TagReasons["high_value"]; reason != "" {
			metrics[i].TagReasons["high_value"] = reason
		}
	}
	for _, metric := range metrics {
		tagsJSON, _ := json.Marshal(metric.Tags)
		reasonsJSON, _ := json.Marshal(metric.TagReasons)
		_, err := q.Exec(ctx, `INSERT INTO user_profile_metrics (
			user_id,lifecycle,risk_level,value_tier,primary_workspace,last_activity_at,last_success_at,
			active_days_7,active_days_30,lifetime_successful_runs,successful_runs_30,failed_runs_30,
			canceled_runs_30,successful_units_30,success_rate_bps_30,average_duration_ms_30,p95_duration_ms_30,
			feature_diversity_30,revenue_cents_30,upstream_cost_cents_30,gross_profit_cents_30,asset_count,
			canvas_project_count,submission_count,active_api_key_count,tags,tag_reasons,rule_version,calculated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
			ON CONFLICT (user_id) DO UPDATE SET
			lifecycle=EXCLUDED.lifecycle,risk_level=EXCLUDED.risk_level,value_tier=EXCLUDED.value_tier,
			primary_workspace=EXCLUDED.primary_workspace,last_activity_at=EXCLUDED.last_activity_at,
			last_success_at=EXCLUDED.last_success_at,active_days_7=EXCLUDED.active_days_7,
			active_days_30=EXCLUDED.active_days_30,lifetime_successful_runs=EXCLUDED.lifetime_successful_runs,
			successful_runs_30=EXCLUDED.successful_runs_30,failed_runs_30=EXCLUDED.failed_runs_30,
			canceled_runs_30=EXCLUDED.canceled_runs_30,successful_units_30=EXCLUDED.successful_units_30,
			success_rate_bps_30=EXCLUDED.success_rate_bps_30,average_duration_ms_30=EXCLUDED.average_duration_ms_30,
			p95_duration_ms_30=EXCLUDED.p95_duration_ms_30,feature_diversity_30=EXCLUDED.feature_diversity_30,
			revenue_cents_30=EXCLUDED.revenue_cents_30,upstream_cost_cents_30=EXCLUDED.upstream_cost_cents_30,
			gross_profit_cents_30=EXCLUDED.gross_profit_cents_30,asset_count=EXCLUDED.asset_count,
			canvas_project_count=EXCLUDED.canvas_project_count,submission_count=EXCLUDED.submission_count,
			active_api_key_count=EXCLUDED.active_api_key_count,tags=EXCLUDED.tags,tag_reasons=EXCLUDED.tag_reasons,
			rule_version=EXCLUDED.rule_version,calculated_at=EXCLUDED.calculated_at`,
			metric.UserID, metric.Lifecycle, metric.RiskLevel, metric.ValueTier, metric.PrimaryWorkspace,
			metric.LastActivityAt, metric.LastSuccessAt, metric.ActiveDays7, metric.ActiveDays30,
			metric.LifetimeSuccessfulRuns, metric.SuccessfulRuns30, metric.FailedRuns30, metric.CanceledRuns30,
			metric.SuccessfulUnits30, metric.SuccessRateBPS30, metric.AverageDurationMs30, metric.P95DurationMs30,
			metric.FeatureDiversity30, metric.RevenueCents30, metric.UpstreamCostCents30, metric.GrossProfitCents30,
			metric.AssetCount, metric.CanvasProjectCount, metric.SubmissionCount, metric.ActiveAPIKeyCount,
			tagsJSON, reasonsJSON, metric.RuleVersion, metric.CalculatedAt)
		if err != nil {
			return err
		}
	}
	return captureUserProfileHistory(ctx, q, ids, now)
}

func containsProfileTag(tags []string, expected string) bool {
	for _, tag := range tags {
		if tag == expected {
			return true
		}
	}
	return false
}

func buildUserProfileMetric(base profileBaseMetrics, rules UserProfileRules, now time.Time) UserProfileMetric {
	terminal := base.SuccessfulRuns30 + base.FailedRuns30
	rateBPS := 0
	if terminal > 0 {
		rateBPS = int(math.Round(float64(base.SuccessfulRuns30) * 10000 / float64(terminal)))
	}
	lifecycle := "dormant"
	ageDays := int(now.Sub(base.CreatedAt).Hours() / 24)
	if base.ReturnedRecently {
		lifecycle = "returned"
	} else if base.LifetimeSuccessfulRuns == 0 && ageDays <= rules.NewUserDays {
		lifecycle = "new"
	} else if base.LifetimeSuccessfulRuns > 0 && ageDays <= rules.ActivationDays {
		lifecycle = "activated"
	} else if base.LastSuccessAt != nil && now.Sub(*base.LastSuccessAt) <= time.Duration(rules.ActiveDays)*24*time.Hour {
		lifecycle = "active"
	} else if base.LifetimeSuccessfulRuns >= 3 && base.LastSuccessAt != nil &&
		now.Sub(*base.LastSuccessAt) >= time.Duration(rules.ChurnRiskDays)*24*time.Hour &&
		now.Sub(*base.LastSuccessAt) < time.Duration(rules.DormantDays)*24*time.Hour {
		lifecycle = "churn_risk"
	}
	tags := make([]string, 0, 6)
	reasons := map[string]string{}
	failurePercent := 0
	if terminal > 0 {
		failurePercent = int(math.Round(float64(base.FailedRuns30) * 100 / float64(terminal)))
	}
	frequentFailure := terminal >= int64(rules.FrequentFailureMinRuns) && failurePercent >= rules.FrequentFailureRatePercent
	if frequentFailure {
		tags = append(tags, "frequent_failure")
		reasons["frequent_failure"] = fmt.Sprintf("近30日共%d次终态任务，失败率%d%%", terminal, failurePercent)
	}
	powerUser := base.ActiveDays30 >= rules.PowerUserActiveDays30 &&
		base.SuccessfulRuns30 >= int64(rules.PowerUserSuccessfulRuns30) &&
		base.FeatureDiversity30 >= rules.PowerUserFeatureDiversity30
	if powerUser {
		tags = append(tags, "power_user")
		reasons["power_user"] = fmt.Sprintf("近30日活跃%d天，成功%d次，使用%d类功能", base.ActiveDays30, base.SuccessfulRuns30, base.FeatureDiversity30)
		if base.PrimaryWorkspace == "canvas" {
			tags = append(tags, "canvas_power_user")
			reasons["canvas_power_user"] = "主要使用无限画布，并达到深度用户标准"
		}
	}
	if base.ActiveAPIKeyCount > 0 {
		tags = append(tags, "api_user")
		reasons["api_user"] = fmt.Sprintf("当前有%d个有效API密钥", base.ActiveAPIKeyCount)
	}
	valueTier := "none"
	if base.RevenueCents30 > 0 {
		valueTier = "standard"
	}
	if base.RevenueCents30 > 0 && base.GrossProfitCents30 < 0 {
		valueTier = "loss_making"
		tags = append(tags, "loss_making")
		reasons["loss_making"] = fmt.Sprintf("近30日实收%d积分，上游成本%d积分", base.RevenueCents30, base.UpstreamCostCents30)
	}
	if lifecycle == "churn_risk" {
		tags = append(tags, "churn_risk")
		reasons["churn_risk"] = fmt.Sprintf("曾经稳定使用，但已经至少%d天没有成功生成", rules.ChurnRiskDays)
	}
	riskLevel := "low"
	if lifecycle == "churn_risk" {
		riskLevel = "medium"
	}
	if frequentFailure {
		riskLevel = "high"
	}
	return UserProfileMetric{
		UserID: base.UserID, Lifecycle: lifecycle, RiskLevel: riskLevel, ValueTier: valueTier,
		PrimaryWorkspace: base.PrimaryWorkspace, LastActivityAt: base.LastActivityAt, LastSuccessAt: base.LastSuccessAt,
		ActiveDays7: base.ActiveDays7, ActiveDays30: base.ActiveDays30,
		LifetimeSuccessfulRuns: base.LifetimeSuccessfulRuns, SuccessfulRuns30: base.SuccessfulRuns30,
		FailedRuns30: base.FailedRuns30, CanceledRuns30: base.CanceledRuns30,
		SuccessfulUnits30: base.SuccessfulUnits30, SuccessRateBPS30: rateBPS,
		AverageDurationMs30: base.AverageDurationMs30, P95DurationMs30: base.P95DurationMs30,
		FeatureDiversity30: base.FeatureDiversity30, RevenueCents30: base.RevenueCents30,
		UpstreamCostCents30: base.UpstreamCostCents30, GrossProfitCents30: base.GrossProfitCents30,
		AssetCount: base.AssetCount, CanvasProjectCount: base.CanvasProjectCount,
		SubmissionCount: base.SubmissionCount, ActiveAPIKeyCount: base.ActiveAPIKeyCount,
		Tags: tags, TagReasons: reasons, RuleVersion: rules.Version, CalculatedAt: now,
	}
}

func RefreshHighValueProfileTags(ctx context.Context, q Q, percentile int, now time.Time) (int, error) {
	if percentile < 50 || percentile > 99 {
		percentile = 90
	}
	rows, err := q.Query(ctx, `WITH cutoff AS (
		SELECT percentile_cont($1::double precision) WITHIN GROUP (ORDER BY gross_profit_cents_30) AS amount
		FROM user_profile_metrics WHERE revenue_cents_30>0 AND gross_profit_cents_30>=0
	), desired AS (
		SELECT metric.user_id,
			CASE WHEN cutoff.amount IS NOT NULL AND metric.revenue_cents_30>0
				AND metric.gross_profit_cents_30>=cutoff.amount THEN 'high'
				WHEN metric.revenue_cents_30>0 AND metric.gross_profit_cents_30<0 THEN 'loss_making'
				WHEN metric.revenue_cents_30>0 THEN 'standard' ELSE 'none' END AS target_value_tier,
			CASE WHEN cutoff.amount IS NOT NULL AND metric.revenue_cents_30>0
				AND metric.gross_profit_cents_30>=cutoff.amount
				THEN (metric.tags-'high_value')||'["high_value"]'::jsonb
				ELSE metric.tags-'high_value' END AS target_tags,
			CASE WHEN cutoff.amount IS NOT NULL AND metric.revenue_cents_30>0
				AND metric.gross_profit_cents_30>=cutoff.amount
				THEN (metric.tag_reasons-'high_value')||jsonb_build_object(
					'high_value','近30日毛利位于有收入用户的前'||(100-$2::int)||'%')
				ELSE metric.tag_reasons-'high_value' END AS target_tag_reasons
		FROM user_profile_metrics metric CROSS JOIN cutoff
	)
	UPDATE user_profile_metrics metric SET
		value_tier=desired.target_value_tier,tags=desired.target_tags,tag_reasons=desired.target_tag_reasons
	FROM desired WHERE desired.user_id=metric.user_id
		AND (metric.value_tier IS DISTINCT FROM desired.target_value_tier
			OR metric.tags IS DISTINCT FROM desired.target_tags
			OR metric.tag_reasons IS DISTINCT FROM desired.target_tag_reasons)
	RETURNING metric.user_id`, float64(percentile)/100, percentile)
	if err != nil {
		return 0, err
	}
	ids := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if err := captureUserProfileHistory(ctx, q, ids, now); err != nil {
		return 0, err
	}
	return len(ids), nil
}

func captureUserProfileHistory(ctx context.Context, q Q, ids []uuid.UUID, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `INSERT INTO user_profile_history (
		user_id,lifecycle,risk_level,value_tier,primary_workspace,active_days_30,
		successful_runs_30,failed_runs_30,success_rate_bps_30,revenue_cents_30,
		gross_profit_cents_30,tags,calculated_at)
	SELECT metric.user_id,metric.lifecycle,metric.risk_level,metric.value_tier,
		metric.primary_workspace,metric.active_days_30,metric.successful_runs_30,
		metric.failed_runs_30,metric.success_rate_bps_30,metric.revenue_cents_30,
		metric.gross_profit_cents_30,metric.tags,$2::timestamptz
	FROM user_profile_metrics metric
	LEFT JOIN LATERAL (
		SELECT history.id,history.lifecycle,history.risk_level,history.value_tier,history.tags,
			history.calculated_at
		FROM user_profile_history history
		WHERE history.user_id=metric.user_id
		ORDER BY history.calculated_at DESC, history.id DESC LIMIT 1
	) latest ON true
	WHERE metric.user_id=ANY($1)
		AND (latest.id IS NULL
			OR (latest.calculated_at AT TIME ZONE 'Asia/Shanghai')::date
				< ($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
			OR latest.lifecycle IS DISTINCT FROM metric.lifecycle
			OR latest.risk_level IS DISTINCT FROM metric.risk_level
			OR latest.value_tier IS DISTINCT FROM metric.value_tier
			OR latest.tags IS DISTINCT FROM metric.tags)`, ids, now)
	return err
}

func UserProfileHistory(ctx context.Context, q Q, userID uuid.UUID, limit int) ([]UserProfileHistoryItem, error) {
	if limit < 1 || limit > 180 {
		limit = 30
	}
	rows, err := q.Query(ctx, `SELECT lifecycle,risk_level,value_tier,primary_workspace,
		active_days_30,successful_runs_30,failed_runs_30,success_rate_bps_30,
		revenue_cents_30,gross_profit_cents_30,tags,calculated_at
		FROM user_profile_history WHERE user_id=$1
		ORDER BY calculated_at DESC, id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]UserProfileHistoryItem, 0, limit)
	for rows.Next() {
		var item UserProfileHistoryItem
		var tagsJSON []byte
		if err := rows.Scan(
			&item.Lifecycle, &item.RiskLevel, &item.ValueTier, &item.PrimaryWorkspace,
			&item.ActiveDays30, &item.SuccessfulRuns30, &item.FailedRuns30,
			&item.SuccessRateBPS30, &item.RevenueCents30, &item.GrossProfitCents30,
			&tagsJSON, &item.CalculatedAt,
		); err != nil {
			return nil, err
		}
		item.Tags = []string{}
		_ = json.Unmarshal(tagsJSON, &item.Tags)
		items = append(items, item)
	}
	return items, rows.Err()
}

func DeleteUserProfileHistoryBefore(ctx context.Context, q Q, cutoff time.Time) (int64, error) {
	result, err := q.Exec(ctx, `DELETE FROM user_profile_history WHERE calculated_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

type UserProfileBreakdown struct {
	Key             string `json:"key"`
	Label           string `json:"label"`
	Runs            int64  `json:"runs"`
	Succeeded       int64  `json:"succeeded"`
	Failed          int64  `json:"failed"`
	SuccessfulUnits int64  `json:"successfulUnits"`
}

type UserProfileFailure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Count   int64  `json:"count"`
}

type UserProfileDailyPoint struct {
	Date              string `json:"date"`
	Succeeded         int64  `json:"succeeded"`
	Failed            int64  `json:"failed"`
	RevenueCents      int64  `json:"revenueCents"`
	UpstreamCostCents int64  `json:"upstreamCostCents"`
	GrossProfitCents  int64  `json:"grossProfitCents"`
}

func UserProfileWorkspaceBreakdown(ctx context.Context, q Q, userID uuid.UUID) ([]UserProfileBreakdown, error) {
	return userProfileBreakdown(ctx, q, userID, true)
}

func UserProfileModelBreakdown(ctx context.Context, q Q, userID uuid.UUID) ([]UserProfileBreakdown, error) {
	return userProfileBreakdown(ctx, q, userID, false)
}

func userProfileBreakdown(ctx context.Context, q Q, userID uuid.UUID, byWorkspace bool) ([]UserProfileBreakdown, error) {
	keyExpr := "model"
	if byWorkspace {
		keyExpr = "workspace"
	}
	rows, err := q.Query(ctx, `WITH events AS (
		SELECT task.created_at, task.status, GREATEST(task.count,1)::bigint AS units,
			COALESCE(NULLIF(task.model,''),'未记录') AS model,
			CASE WHEN task.params->>'_source'='react_canvas' OR task.params->>'workspace'='infinite_canvas'
				OR task.params->>'_kind' LIKE 'canvas-%' THEN 'canvas'
				WHEN task.type='ecommerce_design' OR task.params->>'workspace' LIKE 'ecommerce%'
					OR task.params->>'_kind' LIKE '%ecommerce%' THEN 'ecommerce'
				ELSE COALESCE(NULLIF(task.type,''),'other') END AS workspace
		FROM tasks task WHERE task.user_id=$1 AND task.created_at>=now()-interval '30 days'
		UNION ALL
		SELECT run.created_at, run.status, 1::bigint, COALESCE(NULLIF(run.params->>'model',''),'未记录'),
			CASE WHEN run.params->>'_source'='react_canvas' OR run.params->>'workspace'='infinite_canvas'
				OR run.params->>'_kind' LIKE 'canvas-%' THEN 'canvas' ELSE 'assistant' END
		FROM assistant_runs run WHERE run.user_id=$1 AND run.created_at>=now()-interval '30 days'
	)
	SELECT `+keyExpr+`, `+keyExpr+`, count(*), count(*) FILTER (WHERE status='succeeded'),
		count(*) FILTER (WHERE status='failed'), COALESCE(sum(units) FILTER (WHERE status='succeeded'),0)
	FROM events GROUP BY `+keyExpr+` ORDER BY count(*) DESC, `+keyExpr+` LIMIT 10`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []UserProfileBreakdown{}
	for rows.Next() {
		var item UserProfileBreakdown
		if err := rows.Scan(&item.Key, &item.Label, &item.Runs, &item.Succeeded, &item.Failed, &item.SuccessfulUnits); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func UserProfileFailureBreakdown(ctx context.Context, q Q, userID uuid.UUID) ([]UserProfileFailure, error) {
	rows, err := q.Query(ctx, `WITH failures AS (
		SELECT COALESCE(NULLIF(error_code,''),'unknown') AS code, COALESCE(NULLIF(error_message,''),'未记录失败原因') AS message
		FROM tasks WHERE user_id=$1 AND status='failed' AND created_at>=now()-interval '30 days'
		UNION ALL
		SELECT COALESCE(NULLIF(error_code,''),'unknown'), COALESCE(NULLIF(error_message,''),'未记录失败原因')
		FROM assistant_runs WHERE user_id=$1 AND status='failed' AND created_at>=now()-interval '30 days'
	)
	SELECT code, left(max(message),200), count(*) FROM failures GROUP BY code ORDER BY count(*) DESC, code LIMIT 8`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []UserProfileFailure{}
	for rows.Next() {
		var item UserProfileFailure
		if err := rows.Scan(&item.Code, &item.Message, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func UserProfileDailyTrend(ctx context.Context, q Q, userID uuid.UUID) ([]UserProfileDailyPoint, error) {
	rows, err := q.Query(ctx, `WITH days AS (
		SELECT generate_series((now() AT TIME ZONE 'Asia/Shanghai')::date-29,
			(now() AT TIME ZONE 'Asia/Shanghai')::date, interval '1 day')::date AS day
	), events AS (
		SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day, status FROM tasks
		WHERE user_id=$1 AND created_at>=now()-interval '30 days'
		UNION ALL
		SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date, status FROM assistant_runs
		WHERE user_id=$1 AND created_at>=now()-interval '30 days'
	), event_daily AS (
		SELECT day, count(*) FILTER (WHERE status='succeeded') AS succeeded,
			count(*) FILTER (WHERE status='failed') AS failed FROM events GROUP BY day
	), profit_daily AS (
		SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
			sum(revenue_cents) AS revenue, sum(upstream_cost_cents) AS cost, sum(gross_profit_cents) AS profit
		FROM usage_profit_ledger WHERE user_id=$1 AND created_at>=now()-interval '30 days' GROUP BY day
	)
	SELECT to_char(days.day,'YYYY-MM-DD'), COALESCE(event_daily.succeeded,0), COALESCE(event_daily.failed,0),
		COALESCE(profit_daily.revenue,0), COALESCE(profit_daily.cost,0), COALESCE(profit_daily.profit,0)
	FROM days LEFT JOIN event_daily USING(day) LEFT JOIN profit_daily USING(day) ORDER BY days.day`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]UserProfileDailyPoint, 0, 30)
	for rows.Next() {
		var item UserProfileDailyPoint
		if err := rows.Scan(&item.Date, &item.Succeeded, &item.Failed, &item.RevenueCents, &item.UpstreamCostCents, &item.GrossProfitCents); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
