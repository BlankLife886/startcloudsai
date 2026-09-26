package worker

import (
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	forecastWindow                = 10 * time.Second
	defaultPredictedGeneration    = 45 * time.Second
	minPredictedGeneration        = 10 * time.Second
	maxPredictedGeneration        = 20 * time.Minute
	defaultImagesPerFetchSlot     = 4
	forecastFetchWavesPerWindow   = 2
	imageFetchSlowThreshold       = 12 * time.Second
	imageFetchHealthyThreshold    = 5 * time.Second
	imageFetchHealthySamplesToAdd = 3
)

type adaptiveDispatchDecision struct {
	EffectiveUserLimit int64
	ForecastCapacity   int64
	DeferForForecast   bool
}

func predictedGenerationDuration(model modelconfig.Model) time.Duration {
	minSeconds := model.MinSeconds
	maxSeconds := model.MaxSeconds
	if maxSeconds <= 0 {
		return defaultPredictedGeneration
	}
	if minSeconds <= 0 || minSeconds > maxSeconds {
		minSeconds = maxSeconds / 2
	}
	// Use an upper-weighted estimate. It keeps the future completion bucket
	// useful without reserving capacity for the provider's absolute worst case.
	predictedSeconds := minSeconds + (maxSeconds-minSeconds)*3/4
	predicted := time.Duration(predictedSeconds) * time.Second
	if predicted < minPredictedGeneration {
		return minPredictedGeneration
	}
	if predicted > maxPredictedGeneration {
		return maxPredictedGeneration
	}
	return predicted
}

func predictedExecutionDuration(candidates []modelconfig.Selection) time.Duration {
	predicted := defaultPredictedGeneration
	found := false
	for _, candidate := range candidates {
		candidateDuration := predictedGenerationDuration(candidate.Model)
		if !found || candidateDuration < predicted {
			predicted = candidateDuration
			found = true
		}
	}
	return predicted
}

func adaptiveDispatchLimits(
	pressure store.TaskExecutionPressure,
	hardUserLimit, hardGlobalLimit, providerCapacity, imageFetchCeiling int64,
	queuedUnits int,
) adaptiveDispatchDecision {
	if hardUserLimit < 1 {
		hardUserLimit = 1
	}
	if hardGlobalLimit < 1 {
		hardGlobalLimit = 1
	}
	capacity := hardGlobalLimit
	if providerCapacity > 0 && providerCapacity < capacity {
		capacity = providerCapacity
	}
	activeUsers := pressure.ActiveUsers
	if activeUsers < 1 {
		activeUsers = 1
	}
	effectiveUserLimit := hardUserLimit
	// Fair sharing is activated only when another user is really queued. With
	// no contention the current user borrows every available slot.
	if pressure.WaitingOtherUsers > 0 {
		fairShare := (capacity + activeUsers - 1) / activeUsers
		if fairShare < 1 {
			fairShare = 1
		}
		if fairShare < effectiveUserLimit {
			effectiveUserLimit = fairShare
		}
	}

	if imageFetchCeiling < 1 {
		imageFetchCeiling = 1
	}
	forecastCapacity := imageFetchCeiling * defaultImagesPerFetchSlot * forecastFetchWavesPerWindow
	if forecastCapacity < defaultImagesPerFetchSlot {
		forecastCapacity = defaultImagesPerFetchSlot
	}
	// Completion shaping is active only during real multi-user contention. At
	// low load every request borrows idle capacity; during a burst even normal
	// 1-4 image requests must be staggered or they all finish upstream together
	// and merely move the queue to result download/storage.
	deferForForecast := pressure.WaitingOtherUsers > 0 &&
		pressure.ForecastUnitsNear+int64(queuedUnits) > forecastCapacity
	return adaptiveDispatchDecision{
		EffectiveUserLimit: effectiveUserLimit,
		ForecastCapacity:   forecastCapacity,
		DeferForForecast:   deferForForecast,
	}
}

func nextAdaptiveFetchLimit(current, ceiling int64, duration time.Duration, failed bool, healthySamples int) (int64, int) {
	if ceiling < 1 {
		ceiling = 1
	}
	if current < 1 || current > ceiling {
		current = ceiling
	}
	if failed || duration >= imageFetchSlowThreshold {
		current = max(1, current/2)
		return current, 0
	}
	if duration <= imageFetchHealthyThreshold {
		healthySamples++
		if healthySamples >= imageFetchHealthySamplesToAdd && current < ceiling {
			current++
			healthySamples = 0
		}
		return current, healthySamples
	}
	return current, 0
}
