package taskflow

import "testing"

func TestNilQueueMetricsAreUnavailable(t *testing.T) {
	var queue *Queue
	metrics := queue.Metrics()
	if metrics.Available || metrics.Error != "queue_unavailable" || metrics.Workers == nil {
		t.Fatalf("unexpected nil queue metrics: %+v", metrics)
	}
}
