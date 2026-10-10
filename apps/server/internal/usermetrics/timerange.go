package usermetrics

import (
	"fmt"
	"strings"
	"time"
)

// RangePreset names a time window in the user's local time zone.
type RangePreset string

const (
	RangeToday      RangePreset = "today"
	RangeYesterday  RangePreset = "yesterday"
	RangeLast7Days  RangePreset = "last_7_days"
	RangeLast30Days RangePreset = "last_30_days"
	RangeThisWeek   RangePreset = "this_week"
	RangeLastWeek   RangePreset = "last_week"
	RangeThisMonth  RangePreset = "this_month"
	RangeLastMonth  RangePreset = "last_month"
	RangeThisYear   RangePreset = "this_year"
	RangeLastYear   RangePreset = "last_year"
	RangeAllTime    RangePreset = "all_time"
)

// RangePresets lists the presets with their labels in a stable order.
func RangePresets() []struct {
	ID    RangePreset `json:"id"`
	Label string      `json:"label"`
} {
	out := []struct {
		ID    RangePreset `json:"id"`
		Label string      `json:"label"`
	}{}
	for _, id := range []RangePreset{RangeToday, RangeYesterday, RangeLast7Days, RangeLast30Days, RangeThisWeek,
		RangeLastWeek, RangeThisMonth, RangeLastMonth, RangeThisYear, RangeLastYear, RangeAllTime} {
		out = append(out, struct {
			ID    RangePreset `json:"id"`
			Label string      `json:"label"`
		}{id, presetLabels[id]})
	}
	return out
}

var presetLabels = map[RangePreset]string{
	RangeToday: "今天", RangeYesterday: "昨天", RangeLast7Days: "最近 7 天", RangeLast30Days: "最近 30 天",
	RangeThisWeek: "本周", RangeLastWeek: "上周", RangeThisMonth: "本月", RangeLastMonth: "上月",
	RangeThisYear: "今年", RangeLastYear: "去年", RangeAllTime: "全部时间",
}

// maxCustomRange bounds custom ranges so a single question cannot scan years
// of rows at day granularity.
const maxCustomRange = 2*366*24*time.Hour + time.Hour

// allTimeStart predates the platform; "all time" is bounded by the user's data.
var allTimeStart = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

// TimeRange selects either a preset or a custom inclusive date span
// (YYYY-MM-DD, user local time).
type TimeRange struct {
	Preset RangePreset `json:"preset,omitempty"`
	From   string      `json:"from,omitempty"`
	To     string      `json:"to,omitempty"`
}

// ResolvedRange is a half-open [Start, End) window plus a display label.
type ResolvedRange struct {
	Start time.Time `json:"-"`
	End   time.Time `json:"-"`
	From  string    `json:"from"`
	To    string    `json:"to"`
	Label string    `json:"label"`
	// kind controls how the comparison period is derived.
	kind string
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func startOfWeek(t time.Time) time.Time {
	day := startOfDay(t)
	offset := (int(day.Weekday()) + 6) % 7 // Monday = 0
	return day.AddDate(0, 0, -offset)
}

func newRange(start, end time.Time, label, kind string) ResolvedRange {
	return ResolvedRange{
		Start: start, End: end, Label: label, kind: kind,
		From: start.Format("2006-01-02"), To: end.Add(-time.Nanosecond).Format("2006-01-02"),
	}
}

// Resolve turns the request into a concrete window in loc as of now.
func (r TimeRange) Resolve(now time.Time, loc *time.Location) (ResolvedRange, error) {
	now = now.In(loc)
	today := startOfDay(now)
	if strings.TrimSpace(r.From) != "" || strings.TrimSpace(r.To) != "" {
		from, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(r.From), loc)
		if err != nil {
			return ResolvedRange{}, fmt.Errorf("开始日期格式应为 YYYY-MM-DD")
		}
		to, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(r.To), loc)
		if err != nil {
			return ResolvedRange{}, fmt.Errorf("结束日期格式应为 YYYY-MM-DD")
		}
		end := to.AddDate(0, 0, 1)
		if !end.After(from) {
			return ResolvedRange{}, fmt.Errorf("结束日期不能早于开始日期")
		}
		if end.Sub(from) > maxCustomRange {
			return ResolvedRange{}, fmt.Errorf("自定义时间范围最长两年")
		}
		label := from.Format("2006-01-02") + " 至 " + to.Format("2006-01-02")
		return newRange(from, end, label, "rolling"), nil
	}
	preset := r.Preset
	if preset == "" {
		preset = RangeLast30Days
	}
	label := presetLabels[preset]
	switch preset {
	case RangeToday:
		return newRange(today, today.AddDate(0, 0, 1), label, "rolling"), nil
	case RangeYesterday:
		return newRange(today.AddDate(0, 0, -1), today, label, "rolling"), nil
	case RangeLast7Days:
		return newRange(today.AddDate(0, 0, -6), today.AddDate(0, 0, 1), label, "rolling"), nil
	case RangeLast30Days:
		return newRange(today.AddDate(0, 0, -29), today.AddDate(0, 0, 1), label, "rolling"), nil
	case RangeThisWeek:
		start := startOfWeek(now)
		return newRange(start, start.AddDate(0, 0, 7), label, "week"), nil
	case RangeLastWeek:
		start := startOfWeek(now).AddDate(0, 0, -7)
		return newRange(start, start.AddDate(0, 0, 7), label, "week"), nil
	case RangeThisMonth:
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		return newRange(start, start.AddDate(0, 1, 0), label, "month"), nil
	case RangeLastMonth:
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc).AddDate(0, -1, 0)
		return newRange(start, start.AddDate(0, 1, 0), label, "month"), nil
	case RangeThisYear:
		start := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, loc)
		return newRange(start, start.AddDate(1, 0, 0), label, "year"), nil
	case RangeLastYear:
		start := time.Date(now.Year()-1, 1, 1, 0, 0, 0, 0, loc)
		return newRange(start, start.AddDate(1, 0, 0), label, "year"), nil
	case RangeAllTime:
		return newRange(allTimeStart.In(loc), today.AddDate(0, 0, 1), label, "all"), nil
	default:
		return ResolvedRange{}, fmt.Errorf("不支持的时间范围：%s", preset)
	}
}

// Previous returns the comparable period immediately before r. Calendar
// windows compare with the previous calendar unit even when the current one
// is still in progress ("本月" vs "上月").
func (r ResolvedRange) Previous() (ResolvedRange, bool) {
	switch r.kind {
	case "week":
		return newRange(r.Start.AddDate(0, 0, -7), r.Start, "上一周", "week"), true
	case "month":
		return newRange(r.Start.AddDate(0, -1, 0), r.Start, "上一个月", "month"), true
	case "year":
		return newRange(r.Start.AddDate(-1, 0, 0), r.Start, "上一年", "year"), true
	case "rolling":
		days := int(r.End.Sub(r.Start).Hours()/24 + 0.5)
		if days < 1 {
			days = 1
		}
		return newRange(r.Start.AddDate(0, 0, -days), r.Start, fmt.Sprintf("之前 %d 天", days), "rolling"), true
	default:
		return ResolvedRange{}, false
	}
}
