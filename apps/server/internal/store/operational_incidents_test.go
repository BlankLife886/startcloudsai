package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestOperationalIncidentLifecycle(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	first := time.Now().UTC().Add(-time.Minute).Truncate(time.Microsecond)
	incident := store.OperationalIncident{
		Key: "task_failure_rate", Severity: "critical", Title: "任务失败率过高",
		Summary: "近 10 分钟失败率为 40%", Details: map[string]any{"failed": 4, "total": 10},
	}
	if err := store.UpsertOperationalIncident(ctx, st.Pool, incident, first); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertOperationalIncident(ctx, st.Pool, incident, first.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	open, err := store.ListOpenOperationalIncidents(ctx, st.Pool, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(open) != 1 || open[0].Occurrences != 2 || open[0].Details["failed"] != float64(4) {
		t.Fatalf("open incidents = %#v", open)
	}
	if err := store.ResolveOperationalIncident(ctx, st.Pool, incident.Key, first.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	open, err = store.ListOpenOperationalIncidents(ctx, st.Pool, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(open) != 0 {
		t.Fatalf("resolved incident remained open: %#v", open)
	}
}
