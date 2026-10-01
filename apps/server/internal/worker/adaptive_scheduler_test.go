package worker

import (
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAdaptiveDispatchUsesAllCapacityWithoutRealContention(t *testing.T) {
	decision := adaptiveDispatchLimits(
		store.TaskExecutionPressure{ActiveUsers: 20, ForecastUnitsNear: 500},
		20, 500, 500, 8, 16,
	)
	if decision.EffectiveUserLimit != 20 {
		t.Fatalf("effective user limit = %d, want hard limit 20", decision.EffectiveUserLimit)
	}
	if decision.DeferForForecast {
		t.Fatal("single active owner must borrow idle capacity")
	}
}

func TestAdaptiveDispatchSharesOnlyWhenOtherUsersWait(t *testing.T) {
	decision := adaptiveDispatchLimits(
		store.TaskExecutionPressure{ActiveUsers: 100, WaitingOtherUsers: 99},
		20, 2000, 500, 8, 4,
	)
	if decision.EffectiveUserLimit != 5 {
		t.Fatalf("effective user limit = %d, want fair share 5", decision.EffectiveUserLimit)
	}
	if decision.DeferForForecast {
		t.Fatal("empty forecast bucket must stay on the fast path")
	}
}

func TestAdaptiveDispatchShapesRealCompletionPressure(t *testing.T) {
	pressure := store.TaskExecutionPressure{
		ActiveUsers: 5, WaitingOtherUsers: 4, ForecastUnitsNear: 64,
	}
	bulk := adaptiveDispatchLimits(pressure, 20, 2000, 500, 8, 16)
	if !bulk.DeferForForecast {
		t.Fatal("bulk work should wait when its predicted completion bucket is full")
	}
	small := adaptiveDispatchLimits(pressure, 20, 2000, 500, 8, 4)
	if !small.DeferForForecast {
		t.Fatal("small requests must also be staggered once a real completion bucket is full")
	}
	pressure.WaitingOtherUsers = 0
	borrowed := adaptiveDispatchLimits(pressure, 20, 2000, 500, 8, 16)
	if borrowed.DeferForForecast {
		t.Fatal("bulk work should borrow idle capacity when nobody else is waiting")
	}
}

func TestPredictedExecutionDurationUsesEarliestCandidate(t *testing.T) {
	candidates := []modelconfig.Selection{
		{Model: modelconfig.Model{MinSeconds: 30, MaxSeconds: 70}},
		{Model: modelconfig.Model{MinSeconds: 10, MaxSeconds: 30}},
	}
	if got := predictedExecutionDuration(candidates); got != 25*time.Second {
		t.Fatalf("predicted execution duration = %s, want 25s", got)
	}
	if got := predictedExecutionDuration(nil); got != defaultPredictedGeneration {
		t.Fatalf("default execution duration = %s", got)
	}
}

func TestPredictedGenerationDurationUsesUpperWeightedModelRange(t *testing.T) {
	model := modelconfig.Model{MinSeconds: 20, MaxSeconds: 60}
	if got := predictedGenerationDuration(model); got != 50*time.Second {
		t.Fatalf("predicted duration = %s, want 50s", got)
	}
	if got := predictedGenerationDuration(modelconfig.Model{}); got != 45*time.Second {
		t.Fatalf("default predicted duration = %s, want 45s", got)
	}
}

func TestAdaptiveImageFetchLimitBacksOffAndRecovers(t *testing.T) {
	limit, samples := nextAdaptiveFetchLimit(8, 8, 13*time.Second, false, 0)
	if limit != 4 || samples != 0 {
		t.Fatalf("slow fetch result = (%d,%d), want (4,0)", limit, samples)
	}
	for index := 0; index < imageFetchHealthySamplesToAdd; index++ {
		limit, samples = nextAdaptiveFetchLimit(limit, 8, time.Second, false, samples)
	}
	if limit != 5 || samples != 0 {
		t.Fatalf("healthy recovery result = (%d,%d), want (5,0)", limit, samples)
	}
	limit, samples = nextAdaptiveFetchLimit(limit, 8, time.Second, true, samples)
	if limit != 2 || samples != 0 {
		t.Fatalf("failed fetch result = (%d,%d), want (2,0)", limit, samples)
	}
}
