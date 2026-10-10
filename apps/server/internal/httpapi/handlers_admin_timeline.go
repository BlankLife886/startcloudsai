package httpapi

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// adminTaskTimeline 返回任务执行时间线（worker 各阶段的耗时事件），
// 供后台「耗时详情」弹窗以白话展示任务每一步花了多久。
func (s *Server) adminTaskTimeline(c *gin.Context, _ *store.User) {
	taskID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	events, err := store.ListTaskTimeline(ctx, s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	task, err := store.GetTask(ctx, s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	run, err := store.GetAssistantRun(ctx, s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if len(events) == 0 && task != nil {
		if runID := assistantRunIDFromParams(task.Params); runID != uuid.Nil {
			events, err = store.ListTaskTimeline(ctx, s.St.Pool, runID)
			if err != nil {
				fail(c, err)
				return
			}
		}
	}
	if len(events) == 0 && run != nil {
		events, err = store.ListTaskTimeline(ctx, s.St.Pool, run.ID)
		if err != nil {
			fail(c, err)
			return
		}
	}
	if len(events) == 0 {
		events = synthesizeAdminTimeline(task, run)
	}

	out := gin.H{"items": events}
	if task != nil {
		out["taskCreatedAt"] = task.CreatedAt
		out["taskStatus"] = task.Status
		if task.StartedAt != nil {
			out["taskStartedAt"] = task.StartedAt
		}
		if task.FinishedAt != nil {
			out["taskFinishedAt"] = task.FinishedAt
		}
	} else if run != nil {
		out["taskCreatedAt"] = run.CreatedAt
		out["taskStatus"] = run.Status
		if run.StartedAt != nil {
			out["taskStartedAt"] = run.StartedAt
		}
		if run.FinishedAt != nil {
			out["taskFinishedAt"] = run.FinishedAt
		}
	}
	ok(c, out)
}

func assistantRunIDFromParams(params map[string]any) uuid.UUID {
	if params == nil {
		return uuid.Nil
	}
	for _, key := range []string{"assistantRunId", "assistant_run_id"} {
		raw, _ := params[key].(string)
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err == nil {
			return id
		}
	}
	return uuid.Nil
}

func synthesizeAdminTimeline(task *store.Task, run *store.AssistantRun) []*store.TaskTimelineEvent {
	var created time.Time
	var started, finished *time.Time
	var status string
	if task != nil {
		created = task.CreatedAt
		started = task.StartedAt
		finished = task.FinishedAt
		status = task.Status
	} else if run != nil {
		created = run.CreatedAt
		started = run.StartedAt
		finished = run.FinishedAt
		status = run.Status
	} else {
		return nil
	}
	if created.IsZero() {
		return nil
	}

	events := []*store.TaskTimelineEvent{}
	begin := created
	if started != nil && !started.IsZero() {
		wait := started.Sub(created).Milliseconds()
		if wait < 0 {
			wait = 0
		}
		events = append(events, synthesizedTimelineEvent("queued", "info", "任务排队等待处理", wait, created))
		begin = *started
	}
	if finished == nil || finished.IsZero() {
		if status == "running" || status == "queued" {
			running := time.Since(begin).Milliseconds()
			if running < 0 {
				running = 0
			}
			stage := "upstream_generate"
			if status == "queued" {
				stage = "queued"
			}
			events = append(events, synthesizedTimelineEvent(stage, "info", "生图仍在执行", running, begin))
		}
		return events
	}
	exec := finished.Sub(begin).Milliseconds()
	if exec < 0 {
		exec = 0
	}
	total := finished.Sub(created).Milliseconds()
	if total < 0 {
		total = 0
	}
	switch status {
	case "succeeded":
		events = append(events, synthesizedTimelineEvent("upstream_generate", "info", "生图执行完成", exec, begin))
		events = append(events, synthesizedTimelineEvent("succeeded", "success", "任务完成", total, *finished))
	case "failed":
		events = append(events, synthesizedTimelineEvent("failed", "error", "生图任务失败", total, *finished))
	case "canceled":
		events = append(events, synthesizedTimelineEvent("failed", "warning", "生图任务已停止", total, *finished))
	default:
		events = append(events, synthesizedTimelineEvent("upstream_generate", "info", "生图执行", exec, begin))
	}
	return events
}

func synthesizedTimelineEvent(stage, status, message string, durationMs int64, at time.Time) *store.TaskTimelineEvent {
	ms := durationMs
	return &store.TaskTimelineEvent{
		Stage:      stage,
		Status:     status,
		Message:    message,
		DurationMs: &ms,
		Meta:       map[string]any{"synthesized": true},
		CreatedAt:  at,
	}
}
