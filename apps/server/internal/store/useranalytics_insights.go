package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// UserAnalyticsComparison 为大屏指标卡提供环比基数；活跃人数按任务、助手运行和行为事件去重统计。
type UserAnalyticsComparison struct {
	NewUsersPrev30     int64 `json:"newUsersPrev30"`
	ActiveUsers7       int64 `json:"activeUsers7"`
	ActiveUsersPrev7   int64 `json:"activeUsersPrev7"`
	SucceededRuns30    int64 `json:"succeededRuns30"`
	FailedRuns30       int64 `json:"failedRuns30"`
	PayingUsers30      int64 `json:"payingUsers30"`
	RevenueCents30     int64 `json:"revenueCents30"`
	GrossProfitCents30 int64 `json:"grossProfitCents30"`
}

// UserAnalyticsValueTier 各价值层近 30 日的收入、上游成本与毛利（来自最新画像）。
type UserAnalyticsValueTier struct {
	Tier              string `json:"tier"`
	Users             int64  `json:"users"`
	RevenueCents      int64  `json:"revenueCents"`
	UpstreamCostCents int64  `json:"upstreamCostCents"`
	GrossProfitCents  int64  `json:"grossProfitCents"`
}

// UserAnalyticsWatchUser 重点用户名单中的一行。
type UserAnalyticsWatchUser struct {
	ID                 uuid.UUID         `json:"id"`
	Email              string            `json:"email"`
	Username           string            `json:"username"`
	Lifecycle          string            `json:"lifecycle"`
	RiskLevel          string            `json:"riskLevel"`
	ValueTier          string            `json:"valueTier"`
	PrimaryWorkspace   string            `json:"primaryWorkspace"`
	Tags               []string          `json:"tags"`
	TagReasons         map[string]string `json:"tagReasons"`
	SuccessfulRuns30   int64             `json:"successfulRuns30"`
	FailedRuns30       int64             `json:"failedRuns30"`
	SuccessRateBps30   int64             `json:"successRateBps30"`
	RevenueCents30     int64             `json:"revenueCents30"`
	GrossProfitCents30 int64             `json:"grossProfitCents30"`
	LastActivityAt     *time.Time        `json:"lastActivityAt"`
}

type UserAnalyticsWatchlist struct {
	Risk      []UserAnalyticsWatchUser `json:"risk"`
	HighValue []UserAnalyticsWatchUser `json:"highValue"`
	Churn     []UserAnalyticsWatchUser `json:"churn"`
}

type UserAnalyticsInsights struct {
	Comparison UserAnalyticsComparison         `json:"comparison"`
	Tags       []UserAnalyticsDistributionItem `json:"tags"`
	ValueTiers []UserAnalyticsValueTier        `json:"valueTiers"`
	Watchlist  UserAnalyticsWatchlist          `json:"watchlist"`
}

const watchlistLimit = 8

func loadUserAnalyticsInsights(ctx context.Context, q Q, now time.Time) (UserAnalyticsInsights, error) {
	out := UserAnalyticsInsights{
		Tags:       []UserAnalyticsDistributionItem{},
		ValueTiers: []UserAnalyticsValueTier{},
		Watchlist: UserAnalyticsWatchlist{
			Risk: []UserAnalyticsWatchUser{}, HighValue: []UserAnalyticsWatchUser{}, Churn: []UserAnalyticsWatchUser{},
		},
	}
	c := &out.Comparison
	if err := q.QueryRow(ctx, `WITH activity AS (
		SELECT user_id, created_at FROM tasks WHERE created_at >= $1::timestamptz-interval '14 days'
		UNION ALL
		SELECT user_id, created_at FROM assistant_runs WHERE created_at >= $1::timestamptz-interval '14 days'
		UNION ALL
		SELECT user_id, created_at FROM user_behavior_events WHERE created_at >= $1::timestamptz-interval '14 days'
	)
	SELECT
		(SELECT count(*) FROM users WHERE role='user'
			AND created_at >= $1::timestamptz-interval '60 days' AND created_at < $1::timestamptz-interval '30 days'),
		count(DISTINCT user_id) FILTER (WHERE created_at >= $1::timestamptz-interval '7 days'),
		count(DISTINCT user_id) FILTER (WHERE created_at < $1::timestamptz-interval '7 days'),
		(SELECT COALESCE(sum(metric.successful_runs_30),0)::bigint FROM user_profile_metrics metric),
		(SELECT COALESCE(sum(metric.failed_runs_30),0)::bigint FROM user_profile_metrics metric),
		(SELECT count(*) FROM user_profile_metrics metric WHERE metric.revenue_cents_30 > 0),
		(SELECT COALESCE(sum(metric.revenue_cents_30),0)::bigint FROM user_profile_metrics metric),
		(SELECT COALESCE(sum(metric.gross_profit_cents_30),0)::bigint FROM user_profile_metrics metric)
	FROM activity`, now).Scan(&c.NewUsersPrev30, &c.ActiveUsers7, &c.ActiveUsersPrev7,
		&c.SucceededRuns30, &c.FailedRuns30, &c.PayingUsers30, &c.RevenueCents30, &c.GrossProfitCents30); err != nil {
		return out, err
	}

	tagRows, err := q.Query(ctx, `SELECT tag, count(*) FROM user_profile_metrics metric
		JOIN users account ON account.id=metric.user_id AND account.role='user',
		jsonb_array_elements_text(metric.tags) AS tag
		GROUP BY tag ORDER BY count(*) DESC, tag`)
	if err != nil {
		return out, err
	}
	for tagRows.Next() {
		var item UserAnalyticsDistributionItem
		if err := tagRows.Scan(&item.Key, &item.Count); err != nil {
			tagRows.Close()
			return out, err
		}
		out.Tags = append(out.Tags, item)
	}
	tagRows.Close()
	if err := tagRows.Err(); err != nil {
		return out, err
	}

	tierRows, err := q.Query(ctx, `SELECT metric.value_tier, count(*),
		COALESCE(sum(metric.revenue_cents_30),0)::bigint, COALESCE(sum(metric.upstream_cost_cents_30),0)::bigint,
		COALESCE(sum(metric.gross_profit_cents_30),0)::bigint
		FROM user_profile_metrics metric JOIN users account ON account.id=metric.user_id AND account.role='user'
		GROUP BY metric.value_tier
		ORDER BY array_position(ARRAY['high','standard','loss_making','none'], metric.value_tier)`)
	if err != nil {
		return out, err
	}
	for tierRows.Next() {
		var item UserAnalyticsValueTier
		if err := tierRows.Scan(&item.Tier, &item.Users, &item.RevenueCents, &item.UpstreamCostCents, &item.GrossProfitCents); err != nil {
			tierRows.Close()
			return out, err
		}
		out.ValueTiers = append(out.ValueTiers, item)
	}
	tierRows.Close()
	if err := tierRows.Err(); err != nil {
		return out, err
	}

	lists := []struct {
		target *[]UserAnalyticsWatchUser
		where  string
		order  string
	}{
		{&out.Watchlist.Risk, `metric.risk_level IN ('medium','high')`,
			`CASE metric.risk_level WHEN 'high' THEN 0 ELSE 1 END, metric.failed_runs_30 DESC, metric.last_activity_at DESC NULLS LAST`},
		{&out.Watchlist.HighValue, `metric.value_tier='high' OR metric.revenue_cents_30 > 0`,
			`metric.revenue_cents_30 DESC, metric.gross_profit_cents_30 DESC`},
		{&out.Watchlist.Churn, `metric.lifecycle IN ('churn_risk','dormant') AND metric.lifetime_successful_runs > 0`,
			`CASE metric.lifecycle WHEN 'churn_risk' THEN 0 ELSE 1 END, metric.revenue_cents_30 DESC, metric.lifetime_successful_runs DESC`},
	}
	for _, list := range lists {
		rows, err := q.Query(ctx, `SELECT account.id, account.email, account.username, metric.lifecycle, metric.risk_level,
			metric.value_tier, metric.primary_workspace, metric.tags, metric.tag_reasons, metric.successful_runs_30,
			metric.failed_runs_30, metric.success_rate_bps_30, metric.revenue_cents_30, metric.gross_profit_cents_30,
			metric.last_activity_at
			FROM user_profile_metrics metric JOIN users account ON account.id=metric.user_id
			WHERE account.role='user' AND account.deleted_at IS NULL AND (`+list.where+`)
			ORDER BY `+list.order+` LIMIT $1`, watchlistLimit)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var item UserAnalyticsWatchUser
			if err := rows.Scan(&item.ID, &item.Email, &item.Username, &item.Lifecycle, &item.RiskLevel,
				&item.ValueTier, &item.PrimaryWorkspace, &item.Tags, &item.TagReasons, &item.SuccessfulRuns30,
				&item.FailedRuns30, &item.SuccessRateBps30, &item.RevenueCents30, &item.GrossProfitCents30,
				&item.LastActivityAt); err != nil {
				rows.Close()
				return out, err
			}
			if item.Tags == nil {
				item.Tags = []string{}
			}
			*list.target = append(*list.target, item)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return out, err
		}
	}
	return out, nil
}
