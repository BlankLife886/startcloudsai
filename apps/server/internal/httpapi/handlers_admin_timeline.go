package httpapi

import (
	"github.com/gin-gonic/gin"

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
	events, err := store.ListTaskTimeline(c.Request.Context(), s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	task, err := store.GetTask(c.Request.Context(), s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
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
	}
	ok(c, out)
}
