package worker

import (
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

func TestOperationalIncidentSignals(t *testing.T) {
	now := time.Now().UTC()
	oldest := now.Add(-20 * time.Minute)
	cleanupOldest := now.Add(-time.Hour)
	signals := operationalIncidentSignals(
		now,
		store.TaskPressure{Queued: 4, Running: 2, ActiveUnits: 6, OldestQueuedAt: &oldest},
		&store.TaskPerformanceSummary{Succeeded: 6, Failed: 4},
		store.ObjectCleanupHealth{Pending: 87, Failed: 87, OldestCreated: &cleanupOldest},
		taskflow.QueueMetrics{Available: true, Pending: 200, LatencyMs: 180000, WorkerConcurrency: 32},
	)
	for _, key := range []string{incidentTaskQueueDelay, incidentTaskFailureRate, incidentQueueSaturation, incidentObjectCleanup} {
		if _, exists := signals[key]; !exists {
			t.Fatalf("missing signal %s: %#v", key, signals)
		}
	}
	if signals[incidentTaskQueueDelay].Severity != "critical" {
		t.Fatalf("queue delay severity = %q", signals[incidentTaskQueueDelay].Severity)
	}
}

func TestOperationalIncidentSignalsStayQuietWhenHealthy(t *testing.T) {
	signals := operationalIncidentSignals(
		time.Now().UTC(),
		store.TaskPressure{Running: 2, ActiveUnits: 2},
		&store.TaskPerformanceSummary{Succeeded: 20},
		store.ObjectCleanupHealth{},
		taskflow.QueueMetrics{Available: true, OnlineWorkers: 1, WorkerConcurrency: 32},
	)
	if len(signals) != 0 {
		t.Fatalf("healthy system produced incidents: %#v", signals)
	}
}
