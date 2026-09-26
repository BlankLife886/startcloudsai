package httpapi

import (
	"testing"
	"time"
)

func TestDashboardPeriodStartsUseShanghaiCalendarDays(t *testing.T) {
	now := time.Date(2026, 8, 27, 17, 30, 0, 0, time.UTC)
	today, last7Days, last30Days := dashboardPeriodStarts(now)

	assertTime := func(label string, got, want time.Time) {
		t.Helper()
		if !got.Equal(want) {
			t.Fatalf("%s = %s, want %s", label, got, want)
		}
	}
	assertTime("today", today, time.Date(2026, 8, 27, 16, 0, 0, 0, time.UTC))
	assertTime("last 7 days", last7Days, time.Date(2026, 8, 21, 16, 0, 0, 0, time.UTC))
	assertTime("last 30 days", last30Days, time.Date(2026, 7, 29, 16, 0, 0, 0, time.UTC))
}
