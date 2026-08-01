package httpapi

import (
	"net/http"
	"testing"
	"time"
)

func TestRequestMetricsRollingSnapshot(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	metrics := newRequestMetrics(now.Add(-time.Minute))
	metrics.begin()
	metrics.finish(http.StatusOK, 18*time.Millisecond, now)
	metrics.begin()
	metrics.finish(http.StatusBadRequest, 75*time.Millisecond, now)
	metrics.begin()
	metrics.finish(http.StatusServiceUnavailable, 900*time.Millisecond, now.Add(-61*time.Second))

	snapshot := metrics.snapshot(now)
	if snapshot.InFlight != 0 || snapshot.Total != 3 {
		t.Fatalf("lifetime counters = (%d, %d), want (0, 3)", snapshot.InFlight, snapshot.Total)
	}
	if snapshot.Requests != 2 || snapshot.Status2xx != 1 || snapshot.Status4xx != 1 || snapshot.Status5xx != 0 {
		t.Fatalf("rolling counters = %+v", snapshot)
	}
	if snapshot.AverageMs != 46.5 || snapshot.P95Ms != 100 {
		t.Fatalf("latencies = avg %.2f p95 %.2f, want 46.5 and 100", snapshot.AverageMs, snapshot.P95Ms)
	}
}

func TestRequestMetricsTracksInFlight(t *testing.T) {
	metrics := newRequestMetrics(time.Now())
	metrics.begin()
	if got := metrics.snapshot(time.Now()).InFlight; got != 1 {
		t.Fatalf("in flight = %d, want 1", got)
	}
	metrics.finish(http.StatusNoContent, time.Millisecond, time.Now())
}

func BenchmarkRequestMetricsObserve(b *testing.B) {
	metrics := newRequestMetrics(time.Now())
	now := time.Now()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			metrics.begin()
			metrics.finish(http.StatusOK, 12*time.Millisecond, now)
		}
	})
}
