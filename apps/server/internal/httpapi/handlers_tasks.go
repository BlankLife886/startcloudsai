package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

// 用户输入框限制为 2 万字；任务提示词还会附加站内处理指令和 Skills，
// 因此服务端为编译后的完整提示词保留额外空间。
const maxTaskPromptRunes = 40000

// The model-specific capability check may impose a lower limit. This transport
// bound must also cover the ecommerce workspace, which supports six references.
const maxTaskInputImages = 6

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
			urls = append(urls, "/api/v1/files/"+key)
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

type taskImageInspector func(context.Context, string, int64) (int64, error)

func validateTaskImageKeys(ctx context.Context, userID uuid.UUID, field string, keys []string, maxKeys int, maxObjectBytes, maxTotalBytes int64, inspect taskImageInspector, owned func(uuid.UUID, string) bool) error {
	if len(keys) > maxKeys {
		return apperr.E("validation_error", fmt.Sprintf("%s: 最多允许 %d 个图片对象", field, maxKeys), 422)
	}
	seen := make(map[string]struct{}, len(keys))
	for i := range keys {
		keys[i] = strings.TrimSpace(keys[i])
		key := keys[i]
		if len(key) > 512 {
			return apperr.E("validation_error", field+": 文件键过长", 422)
		}
		if _, exists := seen[key]; exists {
			return apperr.E("validation_error", field+": 不允许重复文件", 422)
		}
		seen[key] = struct{}{}
		if owned != nil && !owned(userID, key) {
			return apperr.E("validation_error", field+" 只能引用自己的图片文件", 422)
		}
	}
	if inspect == nil {
		return apperr.E("validation_error", field+": 图片检查器不可用", 422)
	}
	// 对象检查并发执行，但上限由 maxKeys 固定，避免一次请求创建无界 goroutine。
	sizes := make([]int64, len(keys))
	sizeErrs := make([]error, len(keys))
	var wg sync.WaitGroup
	for i := range keys {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sizes[i], sizeErrs[i] = inspect(ctx, keys[i], maxObjectBytes)
		}(i)
	}
	wg.Wait()
	var totalInputBytes int64
	for i := range keys {
		if sizeErrs[i] != nil {
			message := field + ": 图片不存在、格式不支持或内容无法读取"
			switch {
			case errors.Is(sizeErrs[i], errTaskImageTimeout):
				message = field + ": 参考图读取超时，请稍后重试"
			case errors.Is(sizeErrs[i], errTaskImageMissing):
				message = field + ": 图片不存在或尚未写入完成，请重试"
			case errors.Is(sizeErrs[i], errTaskImageFormat):
				message = field + ": 图片格式不支持，请使用 png / jpg / webp"
			case errors.Is(sizeErrs[i], errTaskImageContent):
				message = field + ": 图片内容无法读取或尺寸过大"
			}
			return apperr.E("validation_error", message, 422)
		}
		totalInputBytes += sizes[i]
		if sizes[i] <= 0 || sizes[i] > maxObjectBytes || totalInputBytes > maxTotalBytes {
			return apperr.E("validation_error", field+": 图片累计大小超过限制", 422)
		}
	}
	return nil
}

// validateTaskInputKeys remains a size-only helper for callers that only have
// metadata available. Task creation uses validateTaskInputImages below so the
// stored bytes are checked before any credit is frozen.
func validateTaskInputKeys(ctx context.Context, userID uuid.UUID, keys []string, maxObjectBytes int64, objectSize func(context.Context, string) (int64, error)) error {
	return validateTaskImageKeys(ctx, userID, "inputKeys", keys, maxTaskInputImages, maxObjectBytes, 32<<20,
		func(ctx context.Context, key string, _ int64) (int64, error) {
			return objectSize(ctx, key)
		}, func(userID uuid.UUID, key string) bool {
			return strings.HasPrefix(key, "uploads/"+userID.String()+"/") ||
				strings.HasPrefix(key, "tasks/"+userID.String()+"/")
		})
}

func validateTaskInputImages(ctx context.Context, userID uuid.UUID, keys []string, maxObjectBytes int64, inspect taskImageInspector) error {
	return validateTaskImageKeys(ctx, userID, "inputKeys", keys, maxTaskInputImages, maxObjectBytes, 32<<20, inspect, isAllowedTaskInputImageKey)
}

func taskImageParam(params map[string]any, key string) (string, bool, error) {
	raw, exists := params[key]
	if !exists || raw == nil {
		return "", false, nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", false, apperr.E("validation_error", key+": 必须是字符串", 422)
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false, nil
	}
	return value, true, nil
}

func taskMaskImageKeys(params map[string]any) ([]string, error) {
	maskKey, hasMask, err := taskImageParam(params, "maskKey")
	if err != nil {
		return nil, err
	}
	baseKey, hasBase, err := taskImageParam(params, "maskBaseKey")
	if err != nil {
		return nil, err
	}
	maskRect, hasRect, err := taskImageParam(params, "maskRect")
	if err != nil {
		return nil, err
	}
	if hasMask != hasBase {
		return nil, apperr.E("validation_error", "maskKey 和 maskBaseKey 必须同时提供", 422)
	}
	if hasRect && !hasMask {
		return nil, apperr.E("validation_error", "maskRect 必须与 maskKey 和 maskBaseKey 同时提供", 422)
	}
	if hasRect {
		if _, err := media.ParseMaskRect(maskRect); err != nil {
			return nil, apperr.E("validation_error", "maskRect: 格式无效", 422)
		}
	}
	if !hasMask {
		return nil, nil
	}
	return []string{maskKey, baseKey}, nil
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
	if body.Prompt == "" || len([]rune(body.Prompt)) > maxTaskPromptRunes {
		fail(c, apperr.E("validation_error", "prompt: 完整任务内容过长", 422))
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
	inspectTaskImage := func(ctx context.Context, key string, maxBytes int64) (int64, error) {
		return s.inspectOwnedTaskImage(ctx, user.ID, key, maxBytes)
	}
	if err := validateTaskInputImages(c.Request.Context(), user.ID, body.InputKeys, s.Cfg.UploadMaxBytes, inspectTaskImage); err != nil {
		fail(c, err)
		return
	}
	maskKeys, err := taskMaskImageKeys(body.Params)
	if err != nil {
		fail(c, err)
		return
	}
	if err := validateTaskImageKeys(c.Request.Context(), user.ID, "maskKey/maskBaseKey", maskKeys, 2, s.Cfg.UploadMaxBytes, 32<<20, inspectTaskImage, isOwnedTaskImageKey); err != nil {
		fail(c, err)
		return
	}
	if len(maskKeys) == 2 {
		body.Params["maskKey"] = maskKeys[0]
		body.Params["maskBaseKey"] = maskKeys[1]
	} else if body.Params != nil {
		delete(body.Params, "maskKey")
		delete(body.Params, "maskBaseKey")
		delete(body.Params, "maskRect")
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
			// PostgreSQL queued row is the durable source of truth. A transient Redis
			// outage must not turn accepted work into a terminal failure; the queued
			// recovery scan will enqueue it after Redis becomes available again.
			log.Printf("task %s enqueue deferred; durable queued recovery will retry: %v", task.ID, err)
		}
	} else if task.Status == "queued" {
		// 幂等重试命中已有 queued 任务：补一次入队（Asynq 同 task_id 重复入队无害）
		if err := s.Queue.EnqueueRunTask(c.Request.Context(), task.ID.String()); err != nil {
			log.Printf("task %s idempotent re-enqueue failed (queued reaper will pick up): %v", task.ID, err)
		}
	}
	data := taskDict(task, s.outputURLsFor(c, task), s.originalURLsFor(c, task))
	if created {
		respondCreated(c, data)
		return
	}
	ok(c, data)
}

func (s *Server) listTasks(c *gin.Context) {
	if strings.TrimSpace(c.Query("ids")) != "" {
		s.getTasksBatch(c)
		return
	}
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	taskType := c.Query("type")
	status := c.Query("status")
	excludeSource := strings.TrimSpace(c.Query("excludeSource"))
	source := strings.TrimSpace(c.Query("source"))
	if taskType == store.PromptTaskTypeCanvas || taskType == store.CanvasTaskSource {
		source = store.CanvasTaskSource
		taskType = ""
	}
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
	rows, err := store.ListTasks(c.Request.Context(), s.St.Pool, &user.ID, taskType, status, nil, limit, cursor, excludeSource, source)
	if err != nil {
		fail(c, err)
		return
	}
	shares := s.shareSubmissionsByTasks(c.Request.Context(), rows)
	ok(c, buildPage(rows, limit, func(t *store.Task) gin.H {
		return attachShareSubmission(taskDict(t, s.outputURLsFor(c, t), s.originalURLsFor(c, t)), shares[t.ID])
	}))
}

func (s *Server) shareSubmissionsByTasks(ctx context.Context, tasks []*store.Task) map[uuid.UUID]*store.GallerySubmission {
	ids := make([]uuid.UUID, 0, len(tasks))
	for _, task := range tasks {
		if task != nil {
			ids = append(ids, task.ID)
		}
	}
	out, err := store.GetSubmissionsByTaskIDs(ctx, s.St.Pool, ids)
	if err != nil || out == nil {
		return map[uuid.UUID]*store.GallerySubmission{}
	}
	return out
}

// getTasksBatch returns current snapshots for many active tasks in one request.
// Results follow input order and silently omit missing or foreign task IDs.
func (s *Server) getTasksBatch(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	rawIDs := strings.Split(c.Query("ids"), ",")
	if len(rawIDs) == 0 || (len(rawIDs) == 1 && strings.TrimSpace(rawIDs[0]) == "") {
		fail(c, apperr.E("validation_error", "ids: 不能为空", 422))
		return
	}
	if len(rawIDs) > 100 {
		fail(c, apperr.E("validation_error", "ids: 一次最多查询 100 个任务", 422))
		return
	}
	ids := make([]uuid.UUID, 0, len(rawIDs))
	seen := make(map[uuid.UUID]struct{}, len(rawIDs))
	for _, rawID := range rawIDs {
		id, parseErr := uuid.Parse(strings.TrimSpace(rawID))
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "ids: 包含无效任务 ID", 422))
			return
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	tasksByID, err := store.GetTasksByIDs(c.Request.Context(), s.St.Pool, ids)
	if err != nil {
		fail(c, err)
		return
	}
	owned := make([]*store.Task, 0, len(ids))
	for _, id := range ids {
		task := tasksByID[id]
		if task == nil || task.UserID != user.ID || task.DeletedAt != nil {
			continue
		}
		owned = append(owned, task)
	}
	shares := s.shareSubmissionsByTasks(c.Request.Context(), owned)
	items := make([]gin.H, 0, len(owned))
	for _, task := range owned {
		items = append(items, attachShareSubmission(taskDict(task, s.outputURLsFor(c, task), s.originalURLsFor(c, task)), shares[task.ID]))
	}
	ok(c, gin.H{"items": items})
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
	submission, err := store.GetSubmissionByTaskID(c.Request.Context(), s.St.Pool, task.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, attachShareSubmission(taskDict(task, s.outputURLsFor(c, task), s.originalURLsFor(c, task)), submission))
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
	event := taskstream.Event{
		TaskID: taskID.String(),
		Stage:  "canceled", Status: "canceled", Done: true,
	}
	streamClient := s.assistantStreamRedis()
	taskstream.Publish(c.Request.Context(), streamClient, taskID.String(), event)
	taskstream.PublishUser(c.Request.Context(), streamClient, user.ID.String(), event)
	ok(c, taskDict(task, nil, nil))
}

type taskPatchIn struct {
	Status string `json:"status"`
}

func (s *Server) patchTask(c *gin.Context) {
	var body taskPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Status != "canceled" {
		fail(c, apperr.E("validation_error", "status: 仅支持更新为 canceled", 422))
		return
	}
	s.cancelTask(c)
}

func (s *Server) deleteTask(c *gin.Context) {
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
	ctx := c.Request.Context()
	var keys []string
	var deletedTaskIDs []uuid.UUID
	deletedAt := time.Now().UTC()
	cascade := c.Query("cascade") == "true"
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		root, err := store.GetUserTaskForUpdate(ctx, tx, user.ID, taskID)
		if err != nil {
			return err
		}
		if root == nil {
			return apperr.E("task_not_found", "任务不存在", 404)
		}

		tasks := []*store.Task{root}
		seenIDs := []uuid.UUID{root.ID}
		if cascade {
			for index := 0; index < len(tasks); index++ {
				parentKeys := append([]string(nil), tasks[index].OutputKeys...)
				parentKeys = append(parentKeys, tasks[index].ThumbnailKeys...)
				children, err := store.ListUserTasksReferencingInputKeysForUpdate(ctx, tx, user.ID, seenIDs, parentKeys)
				if err != nil {
					return err
				}
				for _, child := range children {
					tasks = append(tasks, child)
					seenIDs = append(seenIDs, child.ID)
				}
			}
		}

		remaining := make(map[uuid.UUID]*store.Task, len(tasks))
		for _, task := range tasks {
			if task.Status != "succeeded" && task.Status != "failed" && task.Status != "canceled" {
				return apperr.E("task_not_cancelable", "仅已结束的任务可以删除", 400)
			}
			remaining[task.ID] = task
		}

		for len(remaining) > 0 {
			deletedLeaf := false
			for index := len(tasks) - 1; index >= 0; index-- {
				task := tasks[index]
				if _, ok := remaining[task.ID]; !ok {
					continue
				}
				taskKeys := append([]string(nil), task.OutputKeys...)
				taskKeys = append(taskKeys, task.ThumbnailKeys...)
				taskKeys = store.WithDisplayKeys(taskKeys)
				referencingTasks, err := store.CountTasksReferencingInputKeys(ctx, tx, user.ID, task.ID, taskKeys)
				if err != nil {
					return err
				}
				if referencingTasks > 0 {
					continue
				}
				if err := store.DeleteSubmissionByTaskID(ctx, tx, task.ID); err != nil {
					return err
				}
				if err := store.DeleteUserUploadReferences(ctx, tx, store.UploadReferenceTaskInput, task.ID); err != nil {
					return err
				}
				if err := store.EnqueueObjectCleanup(ctx, tx, taskKeys); err != nil {
					return err
				}
				if err := store.MarkTaskDeletedByUser(ctx, tx, task.ID, deletedAt); err != nil {
					return err
				}
				keys = append(keys, taskKeys...)
				deletedTaskIDs = append(deletedTaskIDs, task.ID)
				delete(remaining, task.ID)
				deletedLeaf = true
				break
			}
			if !deletedLeaf {
				return apperr.E("task_in_use", "该任务产物仍被其他内容引用，无法删除", 409)
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	if len(keys) > 0 && s.Storage != nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		cleanupErr := s.Storage.DeleteKeys(cleanupCtx, keys)
		if cleanupErr == nil {
			_, cleanupErr = store.DeleteObjectCleanupJobs(cleanupCtx, s.St.Pool, keys)
		}
		cancel()
		if cleanupErr != nil {
			log.Printf("task %s marked as user-deleted but object cleanup failed: %v", taskID, cleanupErr)
		}
	}
	ids := make([]string, 0, len(deletedTaskIDs))
	for _, id := range deletedTaskIDs {
		ids = append(ids, id.String())
	}
	ok(c, gin.H{"deletedTaskIds": ids})
}
