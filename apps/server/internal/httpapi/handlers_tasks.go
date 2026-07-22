package httpapi

import (
	"context"
	"log"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

// outputURLsFor 返回站内受保护文件地址，避免把客户端是否能直连 R2
// 变成任务结果能否展示的额外前提。
func (s *Server) outputURLsFor(c *gin.Context, t *store.Task) []string {
	keys := t.ThumbnailKeys
	if len(keys) == 0 {
		keys = t.OutputKeys
	}
	return s.urlsForKeys(c, keys)
}

func (s *Server) originalURLsFor(c *gin.Context, t *store.Task) []string {
	return s.urlsForKeys(c, t.OutputKeys)
}

func (s *Server) urlsForKeys(c *gin.Context, keys []string) []string {
	urls := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimLeft(strings.TrimSpace(key), "/")
		if key != "" {
			urls = append(urls, "/api/files/"+key)
		}
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

func validateTaskInputKeys(ctx context.Context, userID uuid.UUID, keys []string, maxObjectBytes int64, objectSize func(context.Context, string) (int64, error)) error {
	if len(keys) > 4 {
		return apperr.E("validation_error", "inputKeys: 最多允许 4 张参考图", 422)
	}
	seen := make(map[string]struct{}, len(keys))
	var totalInputBytes int64
	for _, key := range keys {
		if len(key) > 512 {
			return apperr.E("validation_error", "inputKeys: 文件键过长", 422)
		}
		if _, exists := seen[key]; exists {
			return apperr.E("validation_error", "inputKeys: 不允许重复文件", 422)
		}
		seen[key] = struct{}{}
		if !strings.HasPrefix(key, "uploads/"+userID.String()+"/") &&
			!strings.HasPrefix(key, "tasks/"+userID.String()+"/") {
			return apperr.E("validation_error", "inputKeys 只能引用自己的文件", 422)
		}
		size, err := objectSize(ctx, key)
		if err != nil {
			return apperr.E("validation_error", "inputKeys: 文件不存在", 422)
		}
		totalInputBytes += size
		if size <= 0 || size > maxObjectBytes || totalInputBytes > 32<<20 {
			return apperr.E("validation_error", "inputKeys: 图片累计大小超过限制", 422)
		}
	}
	return nil
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
	if err := validateTaskInputKeys(c.Request.Context(), user.ID, body.InputKeys, s.Cfg.UploadMaxBytes, s.Storage.ObjectSize); err != nil {
		fail(c, err)
		return
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
			// C1 补偿：入队失败立即 queued→failed + 解冻，返回 500 让用户重试
			log.Printf("task %s enqueue failed, compensating: %v", task.ID, err)
			if _, cerr := taskflow.FailQueuedEnqueue(c.Request.Context(), s.St, task.ID); cerr != nil {
				log.Printf("task %s enqueue compensation failed (queued reaper will pick up): %v", task.ID, cerr)
			}
			fail(c, apperr.E("enqueue_failed", "任务入队失败，费用已退回，请重试", 500))
			return
		}
	} else if task.Status == "queued" {
		// 幂等重试命中已有 queued 任务：补一次入队（Asynq 同 task_id 重复入队无害）
		if err := s.Queue.EnqueueRunTask(c.Request.Context(), task.ID.String()); err != nil {
			log.Printf("task %s idempotent re-enqueue failed (queued reaper will pick up): %v", task.ID, err)
		}
	}
	ok(c, taskDict(task, s.outputURLsFor(c, task), s.originalURLsFor(c, task)))
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
		return taskDict(t, s.outputURLsFor(c, t), s.originalURLsFor(c, t))
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
	ok(c, taskDict(task, s.outputURLsFor(c, task), s.originalURLsFor(c, task)))
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
	ok(c, taskDict(task, nil, nil))
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
	keys = append(keys, task.ThumbnailKeys...)
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
