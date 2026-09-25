package worker

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/platformlog"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

var assistantStageClock sync.Map

func taskClaimTimeline(attempt int, createdAt, claimedAt time.Time) (stage, message string, durationMs int64) {
	if attempt > 0 {
		// The task creation time includes earlier generation attempts, not just
		// this retry's queue wait. No per-retry enqueue timestamp is available.
		return "retry_started", fmt.Sprintf("开始第 %d 次生成尝试", attempt+1), -1
	}
	return "queued", "任务被处理线程接单，排队结束（第 1 次尝试）", max(claimedAt.Sub(createdAt).Milliseconds(), 0)
}

func markAssistantStageClock(id uuid.UUID, at time.Time) {
	if id == uuid.Nil {
		return
	}
	assistantStageClock.Store(id, at)
}

func takeAssistantStageDuration(id uuid.UUID, fallback time.Time) int64 {
	now := time.Now()
	if prev, ok := assistantStageClock.Load(id); ok {
		assistantStageClock.Store(id, now)
		d := now.Sub(prev.(time.Time)).Milliseconds()
		if d < 0 {
			return 0
		}
		return d
	}
	assistantStageClock.Store(id, now)
	if !fallback.IsZero() {
		d := now.Sub(fallback).Milliseconds()
		if d < 0 {
			return 0
		}
		return d
	}
	return 0
}

func clearAssistantStageClock(id uuid.UUID) {
	assistantStageClock.Delete(id)
}

func assistantImageTimelineStage(stage string) (mapped, status, message string) {
	switch stage {
	case "preparing-image":
		return "input_prepare", "info", "准备生图请求与参考图"
	case "generating-image":
		return "upstream_generate", "info", "上游服务商正在生成图片"
	case "fetching-image":
		return "result_download", "info", "从上游取回生成图片"
	case "saving-image":
		return "image_persist", "info", "保存生成图片"
	default:
		return "", "", ""
	}
}

// recordTimeline 尽力而为地追加一条任务时间线事件（后台「耗时详情」展示用）。
// durationMs < 0 表示事件没有时长。写入失败只记日志，绝不影响任务执行。
func (w *Worker) recordTimeline(ctx context.Context, taskID uuid.UUID, stage, status, message string, durationMs int64, meta map[string]any) {
	if w == nil || w.St == nil {
		return
	}
	// 失败/清理路径常带着已取消的 context，换一个短超时的独立 context 保证能落库。
	if ctx == nil || ctx.Err() != nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
	}
	if err := store.AppendTaskTimelineEvent(ctx, w.St.Pool, taskID, stage, status, message, durationMs, meta); err != nil {
		log.Printf("task %s timeline write failed stage=%s: %v", taskID, stage, err)
	}
	level := "info"
	if status == "error" {
		level = "error"
	} else if status == "warning" {
		level = "warning"
	}
	var duration *int64
	if durationMs >= 0 {
		duration = &durationMs
	}
	if !w.Logs.Enabled(ctx, "operations") {
		return
	}
	logMeta := make(map[string]any, len(meta)+2)
	for key, value := range meta {
		logMeta[key] = value
	}
	logMeta["stage"] = stage
	logMeta["status"] = status
	w.Logs.Record(ctx, platformlog.Event{
		Category: "operations", Level: level, Event: "task." + stage,
		Message: message, TaskID: &taskID, DurationMs: duration, Metadata: logMeta,
	})
}

func (w *Worker) recordAssistantImageStage(ctx context.Context, run *store.AssistantRun, stage string) {
	if run == nil {
		return
	}
	mapped, status, message := assistantImageTimelineStage(stage)
	if mapped == "" {
		return
	}
	if _, exists := assistantStageClock.Load(run.ID); !exists {
		wait := time.Since(run.CreatedAt).Milliseconds()
		if wait < 0 {
			wait = 0
		}
		w.recordTimeline(ctx, run.ID, "queued", "info",
			"生图任务被处理线程接单，排队结束", wait,
			map[string]any{"source": "assistant_image", "attempt": run.Attempt})
		markAssistantStageClock(run.ID, time.Now())
	}
	fallback := run.CreatedAt
	if run.StartedAt != nil {
		fallback = *run.StartedAt
	}
	w.recordTimeline(ctx, run.ID, mapped, status, message,
		takeAssistantStageDuration(run.ID, fallback),
		map[string]any{"source": "assistant_image", "assistantStage": stage, "attempt": run.Attempt})
}

func (w *Worker) recordAssistantImageFinish(ctx context.Context, run *store.AssistantRun, stage, status, message string) {
	if run == nil {
		return
	}
	started := run.CreatedAt
	duration := time.Since(started).Milliseconds()
	if run.FinishedAt != nil {
		duration = run.FinishedAt.Sub(started).Milliseconds()
	}
	if duration < 0 {
		duration = 0
	}
	w.recordTimeline(ctx, run.ID, stage, status, message, duration,
		map[string]any{"source": "assistant_image", "attempt": run.Attempt})
	clearAssistantStageClock(run.ID)
	if stage == "succeeded" || stage == "failed" || stage == "canceled" {
		w.wakeUserTaskQueue(run.UserID)
	}
}

func (w *Worker) copyTaskTimeline(ctx context.Context, from, to uuid.UUID) {
	if w == nil || w.St == nil || from == uuid.Nil || to == uuid.Nil || from == to {
		return
	}
	events, err := store.ListTaskTimeline(ctx, w.St.Pool, from)
	if err != nil || len(events) == 0 {
		return
	}
	existing, err := store.ListTaskTimeline(ctx, w.St.Pool, to)
	if err != nil || len(existing) > 0 {
		return
	}
	for _, event := range events {
		duration := int64(-1)
		if event.DurationMs != nil {
			duration = *event.DurationMs
		}
		if err := store.AppendTaskTimelineEvent(ctx, w.St.Pool, to, event.Stage, event.Status, event.Message, duration, event.Meta); err != nil {
			log.Printf("task %s timeline copy from %s failed: %v", to, from, err)
			return
		}
	}
}

// upstreamSubmitTraces 收集一次上游调用内每次图片提交的连接耗时，写入时间线 meta，
// 后台任务详情据此区分"请求体没发完"与"上游收完请求不响应"。
type upstreamSubmitTraces struct {
	mu     sync.Mutex
	traces []map[string]any
}

func (t *upstreamSubmitTraces) add(trace c2a.SubmitTrace) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.traces = append(t.traces, trace.Map())
}

func (t *upstreamSubmitTraces) withMeta(meta map[string]any) map[string]any {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.traces) > 0 {
		meta["submitTraces"] = append([]map[string]any(nil), t.traces...)
	}
	return meta
}

// recordUpstreamPollObservation 为任务当前的上游尝试累计一次轮询观察（成功/失败、耗时）。
func (w *Worker) recordUpstreamPollObservation(ctx context.Context, task *store.Task, result c2a.ImageTaskPollResult) {
	attemptID := upstreamAttemptID(task)
	if attemptID == uuid.Nil || w.St == nil {
		return
	}
	pollErr := ""
	switch {
	case result.Err != nil:
		pollErr = result.Err.Error()
	case result.Missing:
		pollErr = "上游查询结果中没有该任务"
	}
	if err := store.RecordTaskUpstreamAttemptPollObservation(ctx, w.St.Pool, attemptID, pollErr, result.PollMs, time.Now().UTC()); err != nil {
		log.Printf("task %s attempt %s record poll observation failed: %v", task.ID, attemptID, err)
	}
}

// upstreamPollMeta 把当前上游尝试的轮询统计并入时间线 meta。
func (w *Worker) upstreamPollMeta(ctx context.Context, task *store.Task, meta map[string]any) map[string]any {
	attemptID := upstreamAttemptID(task)
	if attemptID == uuid.Nil || w.St == nil {
		return meta
	}
	stats, err := store.GetTaskUpstreamAttemptPollStats(ctx, w.St.Pool, attemptID)
	if err != nil || stats.PollCount == 0 {
		return meta
	}
	meta["pollCount"] = stats.PollCount
	meta["pollErrorCount"] = stats.PollErrorCount
	if stats.LastPollMs > 0 {
		meta["lastPollMs"] = stats.LastPollMs
	}
	if stats.LastPollError != "" {
		meta["lastPollError"] = sanitizeUpstreamMessage(stats.LastPollError)
	}
	if stats.LastPollErrorAt != nil {
		meta["lastPollErrorAt"] = stats.LastPollErrorAt.UTC().Format(time.RFC3339Nano)
	}
	return meta
}
