package worker

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestObjectCleanupBatchLimitFavorsGenerationLoad(t *testing.T) {
	tests := []struct {
		name     string
		pressure store.TaskPressure
		want     int
	}{
		{name: "idle", pressure: store.TaskPressure{}, want: objectCleanupIdleLimit},
		{name: "queued work pauses cleanup", pressure: store.TaskPressure{Queued: 1}, want: 0},
		{name: "small running load uses one delete", pressure: store.TaskPressure{Running: 2, ActiveUnits: 4}, want: objectCleanupLowLoadLimit},
		{name: "large task pauses cleanup", pressure: store.TaskPressure{Running: 1, ActiveUnits: 16}, want: 0},
		{name: "several running tasks pause cleanup", pressure: store.TaskPressure{Running: 3, ActiveUnits: 3}, want: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := objectCleanupBatchLimit(test.pressure); got != test.want {
				t.Fatalf("objectCleanupBatchLimit(%+v) = %d, want %d", test.pressure, got, test.want)
			}
		})
	}
}
