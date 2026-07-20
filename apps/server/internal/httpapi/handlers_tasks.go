package httpapi

import (
	"log"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

// outputURLsFor 生成任务产物的短期可读 URL（presign 失败跳过）。
func (s *Server) outputURLsFor(c *gin.Context, t *store.Task) []string {
	urls := make([]string, 0, len(t.OutputKeys))
	for _, key := range t.OutputKeys {
		u, err := s.Storage.PresignGet(c.Request.Context(), key)
		if err != nil {
			log.Printf("presign failed for key %s: %v", key, err)
			continue
		}
		urls = append(urls, u)
	}
	return urls
}

func parseUUIDParam(c *gin.Context, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		return uuid.Nil, apperr.E("validation_error", name+": 无效的 UUID", 422)
	}
	return id, nil
}

type taskCreateIn struct {
	Type           string         `json:"type"`
	Prompt         string         `json:"prompt"`
	Params         map[string]any `json:"params"`
	InputKeys      []string       `json:"inputKeys"`
	Count          *int           `json:"count"`
	IdempotencyKey *string        `json:"idempotencyKey"`
}

func (s *Server) createTask(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body taskCreateIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if !store.Contains(store.TaskTypes, body.Type) {
		fail(c, apperr.E("validation_error", "type: 无效的任务类型", 422))
		return
	}
	if body.Prompt == "" || len([]rune(body.Prompt)) > 8000 {
		fail(c, apperr.E("validation_error", "prompt: 长度须在 1-8000 之间", 422))
		return
	}
	count := 1
	if body.Count != nil {
		count = *body.Count
	}
	if count < 1 || count > 4 {
		fail(c, apperr.E("validation_error", "count: 须在 1-4 之间", 422))
		return
	}
	if body.IdempotencyKey != nil && len([]rune(*body.IdempotencyKey)) > 128 {
		fail(c, apperr.E("validation_error", "idempotencyKey: 长度不能超过 128", 422))
		return
	}
	for _, key := range body.InputKeys {
		if !strings.HasPrefix(key, "uploads/"+user.ID.String()+"/") &&
			!strings.HasPrefix(key, "tasks/"+user.ID.String()+"/") {
			fail(c, apperr.E("validation_error", "inputKeys 只能引用自己的文件", 422))
			return
		}
	}

	task, created, err := taskflow.CreateTask(c.Request.Context(), s.St, user.ID, taskflow.CreateInput{
		Type:           body.Type,
		Prompt:         body.Prompt,
		Params:         body.Params,
		InputKeys:      body.InputKeys,
		Count:          count,
		IdempotencyKey: body.IdempotencyKey,
	})
	if err != nil {
		fail(c, err)
		return
	}
	if created {
		if err := s.Queue.EnqueueRunTask(c.Request.Context(), task.ID.String()); err != nil {
			fail(c, err)
			return
		}
	}
	ok(c, taskDict(task, s.outputURLsFor(c, task)))
}

func (s *Server) listTasks(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	taskType := c.Query("type")
	status := c.Query("status")
	if taskType != "" && !store.Contains(store.TaskTypes, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	if status != "" && !store.Contains(store.TaskStatuses, status) {
		fail(c, apperr.E("validation_error", "无效的任务状态", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListTasks(c.Request.Context(), s.St.Pool, &user.ID, taskType, status, nil, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(t *store.Task) gin.H {
		return taskDict(t, s.outputURLsFor(c, t))
	}))
}

func (s *Server) getOwnTask(c *gin.Context, user *store.User) (*store.Task, error) {
	taskID, err := parseUUIDParam(c, "id")
	if err != nil {
		return nil, err
	}
	task, err := store.GetUserTask(c.Request.Context(), s.St.Pool, user.ID, taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, apperr.E("task_not_found", "任务不存在", 404)
	}
	return task, nil
}

func (s *Server) getTask(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	task, err := s.getOwnTask(c, user)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, taskDict(task, s.outputURLsFor(c, task)))
}

func (s *Server) cancelTask(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	taskID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	task, err := taskflow.CancelTask(c.Request.Context(), s.St, user.ID, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, taskDict(task, nil))
}

func (s *Server) deleteTask(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	task, err := s.getOwnTask(c, user)
	if err != nil {
		fail(c, err)
		return
	}
	if task.Status != "succeeded" && task.Status != "failed" && task.Status != "canceled" {
		fail(c, apperr.E("task_not_cancelable", "仅已结束的任务可以删除", 400))
		return
	}
	ctx := c.Request.Context()
	keys := append([]string(nil), task.OutputKeys...)
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if terr := store.DeleteSubmissionByTaskID(ctx, tx, task.ID); terr != nil {
			return terr
		}
		return store.DeleteTask(ctx, tx, task.ID)
	})
	if err != nil {
		fail(c, err)
		return
	}
	if len(keys) > 0 {
		if err := s.Storage.DeleteKeys(ctx, keys); err != nil {
			log.Printf("failed to delete R2 keys for task %s: %v", task.ID, err)
		}
	}
	ok(c, gin.H{})
}
