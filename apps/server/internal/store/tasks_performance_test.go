package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestTaskPerformanceQueriesHandleEmptyDatabase(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	since := time.Now().UTC().Add(-24 * time.Hour)

	summary, err := store.GetTaskPerformanceSummary(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Created != 0 || summary.QueuedNow != 0 || summary.P95EndToEndMs != 0 {
		t.Fatalf("unexpected empty summary: %#v", summary)
	}

	providers, err := store.TaskProviderPerformanceSince(ctx, st.Pool, since)
	if err != nil {
		t.Fatal(err)
	}
	if len(providers) != 0 {
		t.Fatalf("expected no provider rows, got %#v", providers)
	}
}
