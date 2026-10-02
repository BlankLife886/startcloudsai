package assistantproactive

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

// ReportHour is the local hour from which a due report is sent.
const ReportHour = 9

// reportPeriod is the closed period a report covers and its start, which
// identifies the report (one per period).
func reportPeriod(schedule string, local time.Time) (usermetrics.RangePreset, time.Time, bool) {
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
	switch schedule {
	case ReportDaily:
		return usermetrics.RangeYesterday, today.AddDate(0, 0, -1), true
	case ReportWeekly:
		// Monday starts the week; the report covers the week before.
		offset := (int(today.Weekday()) + 6) % 7
		return usermetrics.RangeLastWeek, today.AddDate(0, 0, -offset-7), true
	}
	return "", time.Time{}, false
}

// SendReports sends the daily and weekly reports that are due: after 09:00
// local time, once per period.
func SendReports(ctx context.Context, st *store.Store, now time.Time) (int, error) {
	local := now.In(mustLocation())
	if local.Hour() < ReportHour {
		return 0, nil
	}
	rows, err := st.Pool.Query(ctx, `SELECT user_id, report_schedule FROM assistant_proactive_settings
		WHERE report_schedule <> '' LIMIT $1`, maxCandidates)
	if err != nil {
		return 0, err
	}
	type due struct {
		user     uuid.UUID
		schedule string
	}
	candidates := []due{}
	for rows.Next() {
		var item due
		if err := rows.Scan(&item.user, &item.schedule); err != nil {
			rows.Close()
			return 0, err
		}
		candidates = append(candidates, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	sent := 0
	for _, item := range candidates {
		posted, err := SendReport(ctx, st, item.user, item.schedule, now)
		if err != nil {
			return sent, fmt.Errorf("report for %s: %w", item.user, err)
		}
		if posted {
			sent++
		}
	}
	return sent, nil
}

// SendReport builds and posts one user's report for the current period; it
// does nothing when that period was already reported.
func SendReport(ctx context.Context, st *store.Store, userID uuid.UUID, schedule string, now time.Time) (bool, error) {
	local := now.In(mustLocation())
	preset, periodStart, ok := reportPeriod(schedule, local)
	if !ok {
		return false, nil
	}
	source := sourceID(userID.String(), "report", schedule, periodStart.Format("2006-01-02"))
	var exists bool
	if err := st.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM notifications WHERE source_type = 'assistant_report' AND source_id = $1)`,
		source).Scan(&exists); err != nil || exists {
		return false, err
	}
	stats, err := usermetrics.Query(ctx, st, userID, usermetrics.Request{
		Metrics: []usermetrics.Metric{usermetrics.MetricSpendPoints, usermetrics.MetricImages, usermetrics.MetricCreations,
			usermetrics.MetricSuccessRate},
		Dimensions: []usermetrics.Dimension{usermetrics.DimWorkspace},
		TimeRange:  usermetrics.TimeRange{Preset: preset}, Timezone: DefaultTimezone, CompareToPrevious: true,
	}, now)
	if err != nil {
		return false, err
	}
	name := map[string]string{ReportDaily: "日报", ReportWeekly: "周报"}[schedule]
	text, body := reportText(stats, name)
	posted, err := postToInbox(ctx, st, Message{
		UserID: userID, Kind: "report", Title: "助手" + name + "：" + stats.Range.Label + "用量", Text: text, Body: body,
		DataViews:  []map[string]any{{"tool": "my_stats_query", "view": "stats", "data": stats}},
		SourceType: "assistant_report", SourceID: source,
	}, now)
	if err != nil || !posted {
		return posted, err
	}
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE assistant_proactive_settings SET report_last_sent_at = $2 WHERE user_id = $1`, userID, now)
		return err
	})
	return true, err
}

// reportText writes the summary from the numbers only: every figure comes
// from the stats, so the report never needs a model call.
func reportText(stats *usermetrics.Result, name string) (string, string) {
	spent := stats.Totals[usermetrics.MetricSpendPoints]
	images := stats.Totals[usermetrics.MetricImages]
	creations := stats.Totals[usermetrics.MetricCreations]
	label := stats.Range.Label
	if creations == 0 && spent == 0 {
		text := fmt.Sprintf("这是你的%s（%s，%s 至 %s）：这段时间没有创作，也没有消耗积分。", name, label, stats.Range.From, stats.Range.To)
		return text, label + "没有创作"
	}
	parts := []string{fmt.Sprintf("共消耗 %s 积分%s", formatPoints(spent), change(stats, usermetrics.MetricSpendPoints)),
		fmt.Sprintf("创作 %s 次、出图 %s 张", formatPoints(creations), formatPoints(images))}
	if rate, ok := stats.Totals[usermetrics.MetricSuccessRate]; ok && creations > 0 {
		parts = append(parts, fmt.Sprintf("成功率 %s%%", formatPoints(rate)))
	}
	type share struct {
		label string
		value float64
	}
	shares := []share{}
	for _, row := range stats.Rows {
		if value := row.Values[usermetrics.MetricSpendPoints]; value > 0 {
			shares = append(shares, share{row.Labels[usermetrics.DimWorkspace], value})
		}
	}
	sort.Slice(shares, func(i, j int) bool { return shares[i].value > shares[j].value })
	text := fmt.Sprintf("这是你的%s（%s，%s 至 %s）：%s。", name, label, stats.Range.From, stats.Range.To, strings.Join(parts, "，"))
	if len(shares) > 0 && spent > 0 {
		text += fmt.Sprintf("消耗最多的是%s（%s 积分，占 %.0f%%）。", shares[0].label, formatPoints(shares[0].value), 100*shares[0].value/spent)
	}
	text += "想看明细或换个时间段，直接问我。"
	return text, fmt.Sprintf("%s消耗 %s 积分，出图 %s 张", label, formatPoints(spent), formatPoints(images))
}

// change describes the move against the previous period, when there is one.
func change(stats *usermetrics.Result, metric usermetrics.Metric) string {
	if stats.PreviousTotals == nil {
		return ""
	}
	previous := stats.PreviousTotals[metric]
	current := stats.Totals[metric]
	if previous <= 0 {
		return ""
	}
	delta := (current - previous) / previous * 100
	switch {
	case delta >= 0.5:
		return fmt.Sprintf("（比上一期多 %.0f%%）", delta)
	case delta <= -0.5:
		return fmt.Sprintf("（比上一期少 %.0f%%）", -delta)
	}
	return "（和上一期持平）"
}
