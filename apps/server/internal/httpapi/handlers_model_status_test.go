package httpapi

import (
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func modelStatusInt(value int) *int { return &value }

func TestModelHealthStatus(t *testing.T) {
	cases := []struct {
		name        string
		maintenance bool
		recent      store.ModelHealthAgg
		day         store.ModelHealthAgg
		status      string
		reason      string
	}{
		{name: "maintenance wins", maintenance: true, recent: store.ModelHealthAgg{Failed: 10}, status: modelStatusMaintenance},
		{name: "no traffic", status: modelStatusNoData},
		{name: "user-caused only is no data", day: store.ModelHealthAgg{Excluded: 4}, status: modelStatusNoData},
		{name: "healthy", recent: store.ModelHealthAgg{Succeeded: 9, Failed: 1}, status: modelStatusOperational},
		{name: "degraded by errors", recent: store.ModelHealthAgg{Succeeded: 8, Failed: 2}, status: modelStatusDegraded, reason: modelStatusReasonErrors},
		{name: "outage", recent: store.ModelHealthAgg{Succeeded: 1, Failed: 3}, status: modelStatusOutage, reason: modelStatusReasonErrors},
		{
			name:   "slow against the day",
			recent: store.ModelHealthAgg{Succeeded: 6, LatencyP50Ms: modelStatusInt(130_000)},
			day:    store.ModelHealthAgg{Succeeded: 100, LatencyP50Ms: modelStatusInt(50_000)},
			status: modelStatusDegraded, reason: modelStatusReasonSlow,
		},
		{
			name:   "too few samples to call slow",
			recent: store.ModelHealthAgg{Succeeded: 3, LatencyP50Ms: modelStatusInt(130_000)},
			day:    store.ModelHealthAgg{Succeeded: 100, LatencyP50Ms: modelStatusInt(50_000)},
			status: modelStatusOperational,
		},
		{
			name:   "one recent failure is not an outage",
			recent: store.ModelHealthAgg{Succeeded: 1, Failed: 1},
			day:    store.ModelHealthAgg{Succeeded: 40, Failed: 1},
			status: modelStatusOperational,
		},
		{
			name:   "few recent calls all failed",
			recent: store.ModelHealthAgg{Failed: 2},
			day:    store.ModelHealthAgg{Succeeded: 40, Failed: 2},
			status: modelStatusDegraded, reason: modelStatusReasonErrors,
		},
		{
			name:   "quiet now but the day was bad",
			day:    store.ModelHealthAgg{Succeeded: 2, Failed: 6},
			status: modelStatusDegraded, reason: modelStatusReasonErrors,
		},
		{name: "quiet now, day fine", day: store.ModelHealthAgg{Succeeded: 20}, status: modelStatusOperational},
		{
			name:   "only failures all day, too few to rate",
			day:    store.ModelHealthAgg{Failed: 2},
			status: modelStatusDegraded, reason: modelStatusReasonErrors,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, reason := modelHealthStatus(tc.maintenance, tc.recent, tc.day)
			if status != tc.status || reason != tc.reason {
				t.Fatalf("status = %q/%q, want %q/%q", status, reason, tc.status, tc.reason)
			}
		})
	}
}

func TestModelStatusOverall(t *testing.T) {
	items := func(statuses ...string) []modelStatusItem {
		out := make([]modelStatusItem, 0, len(statuses))
		for _, status := range statuses {
			out = append(out, modelStatusItem{Status: status})
		}
		return out
	}
	cases := map[string]struct {
		models []modelStatusItem
		want   string
	}{
		"empty":                {items(), modelStatusOperational},
		"all fine":             {items(modelStatusOperational, modelStatusNoData), modelStatusOperational},
		"maintenance is fine":  {items(modelStatusOperational, modelStatusMaintenance), modelStatusOperational},
		"one degraded":         {items(modelStatusOperational, modelStatusDegraded), modelStatusDegraded},
		"one of two down":      {items(modelStatusOperational, modelStatusOutage), modelStatusDegraded},
		"everything with data": {items(modelStatusOutage, modelStatusOutage, modelStatusNoData), modelStatusOutage},
	}
	for name, tc := range cases {
		if got := modelStatusOverall(tc.models); got != tc.want {
			t.Fatalf("%s: overall = %q, want %q", name, got, tc.want)
		}
	}
}

func TestModelStatusDailyUsesChinaDaysAndKeepsGaps(t *testing.T) {
	now := time.Date(2026, 10, 7, 3, 0, 0, 0, time.UTC) // 11:00 in China
	firstDay := modelStatusDayStart(now).AddDate(0, 0, -(modelStatusDailyPoints - 1))
	buckets := []store.ModelHealthAgg{
		// 2026-10-06 17:00 UTC is already 10-07 01:00 in China.
		{Bucket: time.Date(2026, 10, 6, 17, 0, 0, 0, time.UTC), Succeeded: 3, Failed: 1},
		{Bucket: time.Date(2026, 10, 7, 2, 0, 0, 0, time.UTC), Succeeded: 4, Excluded: 5},
		{Bucket: time.Date(2026, 10, 5, 8, 0, 0, 0, time.UTC), Succeeded: 2},
	}
	days, uptime := modelStatusDaily(buckets, firstDay)
	if len(days) != modelStatusDailyPoints {
		t.Fatalf("days = %d", len(days))
	}
	last := days[len(days)-1]
	if last.Date != "2026-10-07" || last.SuccessRate == nil || *last.SuccessRate != 0.875 {
		t.Fatalf("today = %+v", last)
	}
	if gap := days[len(days)-2]; gap.Date != "2026-10-06" || gap.SuccessRate != nil {
		t.Fatalf("empty day should stay null, got %+v", gap)
	}
	if day := days[len(days)-3]; day.Date != "2026-10-05" || day.SuccessRate == nil || *day.SuccessRate != 1 {
		t.Fatalf("10-05 = %+v", day)
	}
	if uptime == nil || *uptime != 0.9 {
		t.Fatalf("uptime = %v", uptime)
	}
}

func TestModelStatusHourlyKeepsEmptyHours(t *testing.T) {
	now := time.Date(2026, 10, 7, 3, 25, 0, 0, time.UTC)
	points := modelStatusHourly([]store.ModelHealthAgg{
		{Bucket: time.Date(2026, 10, 7, 1, 0, 0, 0, time.UTC), Succeeded: 1, LatencyP50Ms: modelStatusInt(1200)},
		{Bucket: time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC), Succeeded: 1},
	}, now)
	if len(points) != modelStatusHourlyPoints+1 {
		t.Fatalf("points = %d", len(points))
	}
	if !points[0].Time.Equal(time.Date(2026, 10, 6, 3, 0, 0, 0, time.UTC)) || points[0].SuccessRate != nil {
		t.Fatalf("first point = %+v", points[0])
	}
	hit := points[len(points)-3]
	if !hit.Time.Equal(time.Date(2026, 10, 7, 1, 0, 0, 0, time.UTC)) || hit.LatencyP50Ms == nil || *hit.LatencyP50Ms != 1200 {
		t.Fatalf("01:00 point = %+v", hit)
	}
}

func TestModelStatusPriceHistoryKeepsChangesAndEndsAtCurrentPrice(t *testing.T) {
	now := time.Date(2026, 10, 7, 3, 25, 0, 0, time.UTC)
	price := func(cents int64) *int64 { return &cents }
	hour := func(h int) time.Time { return time.Date(2026, 10, 6, h, 0, 0, 0, time.UTC) }
	discount := int64(8)
	history := modelStatusPriceHistory([]store.ModelHealthAgg{
		{Bucket: hour(1), PriceCents: price(10)},
		{Bucket: hour(2), PriceCents: price(10)},
		{Bucket: hour(3)},
		{Bucket: hour(5), PriceCents: price(12)},
	}, modelconfig.Model{Kind: modelconfig.ModelKindChat, PriceCents: 12, DiscountPriceCents: &discount}, 8, now)
	if history.Unit != modelStatusPricePerTurn || history.CurrentCents != 8 || history.BaseCents != 8 || history.StandardCents != 12 {
		t.Fatalf("price = %+v", history)
	}
	want := []modelStatusPricePoint{{hour(1), 10}, {hour(5), 12}, {now, 8}}
	if len(history.Points) != len(want) {
		t.Fatalf("points = %+v", history.Points)
	}
	for index := range want {
		if !history.Points[index].Time.Equal(want[index].Time) || history.Points[index].Cents != want[index].Cents {
			t.Fatalf("point %d = %+v, want %+v", index, history.Points[index], want[index])
		}
	}
	// A dynamic-pricing rule in force: the current price is the site price,
	// the base price stays the configured one.
	image := modelStatusPriceHistory(nil, modelconfig.Model{Kind: modelconfig.ModelKindImage, PriceCents: 20}, 15, now)
	if image.Unit != modelStatusPricePerImage || len(image.Points) != 1 || image.Points[0].Cents != 15 || image.BaseCents != 20 {
		t.Fatalf("image price = %+v", image)
	}
}

func TestModelStatusPriceDailyCarriesForwardAndEndsAtCurrentPrice(t *testing.T) {
	now := time.Date(2026, 10, 7, 3, 0, 0, 0, time.UTC) // 11:00 in China
	firstDay := modelStatusDayStart(now).AddDate(0, 0, -(modelStatusPriceDays - 1))
	price := func(cents int64) *int64 { return &cents }
	days := modelStatusPriceDaily([]store.ModelHealthAgg{
		// 2026-09-30 in China: 10 then 12 later the same day.
		{Bucket: time.Date(2026, 9, 30, 2, 0, 0, 0, time.UTC), PriceCents: price(10)},
		{Bucket: time.Date(2026, 9, 30, 9, 0, 0, 0, time.UTC), PriceCents: price(12)},
		{Bucket: time.Date(2026, 10, 3, 2, 0, 0, 0, time.UTC)},
	}, 8, firstDay)
	if len(days) != modelStatusPriceDays || days[0].Date != "2026-09-08" {
		t.Fatalf("days = %d, first = %+v", len(days), days[0])
	}
	byDate := map[string]*int64{}
	for _, day := range days {
		byDate[day.Date] = day.Cents
	}
	if byDate["2026-09-29"] != nil {
		t.Fatalf("days before the first call should be null")
	}
	if byDate["2026-09-30"] == nil || *byDate["2026-09-30"] != 12 || byDate["2026-10-05"] == nil || *byDate["2026-10-05"] != 12 {
		t.Fatalf("price should be the day's last price, carried forward: %v %v", byDate["2026-09-30"], byDate["2026-10-05"])
	}
	if last := days[len(days)-1]; last.Date != "2026-10-07" || last.Cents == nil || *last.Cents != 8 {
		t.Fatalf("today = %+v", last)
	}
}
