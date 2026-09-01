package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestDashboardQualitySummaryHandlesEmptyDatabase(t *testing.T) {
	st := testdb.Setup(t)
	now := time.Now().UTC()
	summary, err := store.GetDashboardQualitySummary(
		context.Background(), st.Pool, now.AddDate(0, 0, -7), now.AddDate(0, 0, -30), now.Add(-24*time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Agent.TraceCount != 0 || summary.Billing.AnomalousEntries != 0 || summary.OpenAPI.ActiveKeys != 0 || summary.ObjectCleanup.Pending != 0 {
		t.Fatalf("unexpected empty dashboard quality summary: %#v", summary)
	}
}
