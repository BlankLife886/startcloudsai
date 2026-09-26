package worker

import (
	"testing"
	"time"
)

func TestTaskClaimTimelineSeparatesInitialQueueFromRetries(t *testing.T) {
	createdAt := time.Date(2026, time.September, 6, 21, 15, 14, 0, time.UTC)
	for _, test := range []struct {
		name       string
		attempt    int
		elapsed    time.Duration
		stage      string
		message    string
		durationMs int64
	}{
		{"initial", 0, 280 * time.Millisecond, "queued", "任务被处理线程接单，排队结束（第 1 次尝试）", 280},
		{"clock skew", 0, -time.Second, "queued", "任务被处理线程接单，排队结束（第 1 次尝试）", 0},
		{"first retry", 1, 64 * time.Second, "retry_started", "开始第 2 次生成尝试", -1},
		{"second retry", 2, 139 * time.Second, "retry_started", "开始第 3 次生成尝试", -1},
	} {
		t.Run(test.name, func(t *testing.T) {
			stage, message, durationMs := taskClaimTimeline(test.attempt, createdAt, createdAt.Add(test.elapsed))
			if stage != test.stage || message != test.message || durationMs != test.durationMs {
				t.Fatalf("stage=%q message=%q durationMs=%d", stage, message, durationMs)
			}
		})
	}
}
