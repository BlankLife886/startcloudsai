package assistantproactive

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

// Alert thresholds (agreed defaults).
const (
	LowBalancePoints     = 50
	SpikeFactor          = 3.0
	SpikeMinPoints       = 100
	FailureRateThreshold = 0.30
	FailureMinTasks      = 5
	// Timezone used for "today" until users can choose one.
	DefaultTimezone = "Asia/Shanghai"
	inboxTitle      = "助手提醒"
	maxCandidates   = 2000
)

// Alert kinds.
const (
	AlertLowBalance = "low_balance"
	AlertSpendSpike = "spend_spike"
	AlertFailures   = "failures"
)

// inbox returns the user's “助手提醒” conversation, creating it when it does
// not exist (first use, or the user deleted it).
func inbox(ctx context.Context, tx pgx.Tx, userID uuid.UUID, now time.Time) (uuid.UUID, error) {
	var current *uuid.UUID
	err := tx.QueryRow(ctx, `SELECT inbox_conversation_id FROM assistant_proactive_settings WHERE user_id = $1 FOR UPDATE`, userID).Scan(&current)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	if current != nil {
		return *current, nil
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO assistant_conversations (user_id, title, created_at, updated_at)
		VALUES ($1, $2, $3, $3) RETURNING id`, userID, inboxTitle, now).Scan(&id); err != nil {
		return uuid.Nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO assistant_proactive_settings (user_id, inbox_conversation_id) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET inbox_conversation_id = EXCLUDED.inbox_conversation_id`, userID, id)
	return id, err
}

// postToInbox posts a message to the user's inbox conversation. The source
// is checked first so an already-sent alert never creates the inbox.
func postToInbox(ctx context.Context, st *store.Store, message Message, now time.Time) (bool, error) {
	posted := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM notifications WHERE source_type = $1 AND source_id = $2)`,
			message.SourceType, message.SourceID).Scan(&exists); err != nil || exists {
			return err
		}
		conversation, err := inbox(ctx, tx, message.UserID, now)
		if err != nil {
			return err
		}
		message.ConversationID = &conversation
		posted, err = Post(ctx, tx, message, now)
		return err
	})
	return posted, err
}

// activeUsers are users who spent points or created work in the last day;
// nobody else can have a new alert.
func activeUsers(ctx context.Context, q store.Q, since time.Time) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `SELECT user_id FROM wallet_ledger WHERE created_at > $1 AND delta_cents < 0
		UNION SELECT user_id FROM tasks WHERE created_at > $1 AND user_id IS NOT NULL
		LIMIT $2`, since, maxCandidates)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// Finding is one alert that should be sent.
type Finding struct {
	Kind  string
	Title string
	Text  string
	Body  string
	Link  string
	Views []map[string]any
}

// Evaluate checks one user against the thresholds, with the same numbers the
// wallet and profile pages show.
func Evaluate(ctx context.Context, st *store.Store, userID uuid.UUID, now time.Time) ([]Finding, error) {
	findings := []Finding{}
	wallet, err := store.GetWallet(store.WithBillingTime(ctx, now), st.Pool, userID)
	if err != nil {
		return nil, err
	}
	if wallet != nil && wallet.AvailablePoints() < LowBalancePoints {
		available := wallet.AvailablePoints()
		findings = append(findings, Finding{
			Kind: AlertLowBalance, Title: "积分快用完了",
			Text: fmt.Sprintf("提醒一下：你现在可用 %d 积分，不到 %d。正在进行或计划中的出图可能会因为积分不足失败，可以先去 [钱包](/wallet) 充值或看看 [套餐](/pricing)。", available, LowBalancePoints),
			Body: fmt.Sprintf("当前可用 %d 积分", available), Link: "/wallet",
		})
	}

	local := now.In(mustLocation())
	today := local.Format("2006-01-02")
	weekStart := local.AddDate(0, 0, -7).Format("2006-01-02")
	yesterday := local.AddDate(0, 0, -1).Format("2006-01-02")
	todayStats, err := usermetrics.Query(ctx, st, userID, usermetrics.Request{
		Metrics:    []usermetrics.Metric{usermetrics.MetricSpendPoints, usermetrics.MetricSucceeded, usermetrics.MetricFailed},
		Dimensions: []usermetrics.Dimension{usermetrics.DimWorkspace},
		TimeRange:  usermetrics.TimeRange{Preset: usermetrics.RangeToday}, Timezone: DefaultTimezone,
	}, now)
	if err != nil {
		return nil, err
	}
	previous, err := usermetrics.Query(ctx, st, userID, usermetrics.Request{
		Metrics:   []usermetrics.Metric{usermetrics.MetricSpendPoints},
		TimeRange: usermetrics.TimeRange{From: weekStart, To: yesterday}, Timezone: DefaultTimezone,
	}, now)
	if err != nil {
		return nil, err
	}
	spent := todayStats.Totals[usermetrics.MetricSpendPoints]
	average := previous.Totals[usermetrics.MetricSpendPoints] / 7
	if spent >= SpikeMinPoints && average > 0 && spent > SpikeFactor*average {
		findings = append(findings, Finding{
			Kind: AlertSpendSpike, Title: "今天的积分消耗明显偏高",
			Text: fmt.Sprintf("今天（%s）已经消耗 %s 积分，是最近 7 天日均（%s 积分）的 %.1f 倍。下面是按功能的分布；想看具体是哪几笔，可以问我“今天最贵的几次是什么”。",
				today, formatPoints(spent), formatPoints(average), spent/average),
			Body:  fmt.Sprintf("今天已消耗 %s 积分，约为日均的 %.1f 倍", formatPoints(spent), spent/average),
			Views: []map[string]any{{"tool": "my_stats_query", "view": "stats", "data": todayStats}},
		})
	}
	succeeded, failed := todayStats.Totals[usermetrics.MetricSucceeded], todayStats.Totals[usermetrics.MetricFailed]
	if total := succeeded + failed; total >= FailureMinTasks && failed/total > FailureRateThreshold {
		findings = append(findings, Finding{
			Kind: AlertFailures, Title: "今天失败的任务偏多",
			Text: fmt.Sprintf("今天 %d 次生成里有 %d 次失败（%.0f%%），失败的积分会自动退回。想知道原因，可以问我“今天为什么失败这么多”。",
				int(total), int(failed), 100*failed/total),
			Body: fmt.Sprintf("今天 %d 次生成中 %d 次失败", int(total), int(failed)),
		})
	}
	return findings, nil
}

// SendAlerts evaluates recently active users and sends each alert at most
// once per local day.
func SendAlerts(ctx context.Context, st *store.Store, now time.Time) (int, error) {
	users, err := activeUsers(ctx, st.Pool, now.Add(-24*time.Hour))
	if err != nil {
		return 0, err
	}
	sent := 0
	day := now.In(mustLocation()).Format("2006-01-02")
	for _, userID := range users {
		settings, err := Get(ctx, st.Pool, userID)
		if err != nil {
			return sent, err
		}
		if !settings.Alerts {
			continue
		}
		findings, err := Evaluate(ctx, st, userID, now)
		if err != nil {
			return sent, fmt.Errorf("evaluate %s: %w", userID, err)
		}
		for _, finding := range findings {
			posted, err := postToInbox(ctx, st, Message{
				UserID: userID, Kind: "alert", Title: finding.Title, Text: finding.Text, Body: finding.Body,
				Link: finding.Link, DataViews: finding.Views,
				SourceType: "assistant_alert", SourceID: sourceID(userID.String(), finding.Kind, day),
			}, now)
			if err != nil {
				return sent, err
			}
			if posted {
				sent++
			}
		}
	}
	return sent, nil
}

func mustLocation() *time.Location {
	if loc, err := time.LoadLocation(DefaultTimezone); err == nil {
		return loc
	}
	return time.FixedZone(DefaultTimezone, 8*3600)
}

func formatPoints(value float64) string {
	if value == math.Trunc(value) {
		return fmt.Sprintf("%.0f", value)
	}
	return fmt.Sprintf("%.1f", value)
}
