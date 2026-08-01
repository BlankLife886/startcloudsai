// Package taskflow 实现任务提交 / 取消 / 重跑 / 结算落库与 Asynq 入队。
package taskflow

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func now() time.Time { return time.Now().UTC() }

func strPtr(s string) *string { return &s }

func stringParam(params map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := params[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.ToLower(strings.TrimSpace(value))
		}
	}
	return ""
}

func boolParam(params map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, ok := params[key].(bool); ok && value {
			return true
		}
	}
	return false
}

func supports(values []string, requested string) bool {
	for _, value := range values {
		if strings.EqualFold(value, requested) {
			return true
		}
	}
	return false
}

func validateModelImageCapabilities(model modelconfig.Model, params map[string]any, referenceCount int) error {
	requestedResolution := stringParam(params, "resolutionScale", "resolution")
	allowedRatios := modelconfig.AspectRatiosForResolution(model, requestedResolution)
	aspectRatio := stringParam(params, "aspectRatio", "ratio")
	if aspectRatio != "" && !supports(allowedRatios, aspectRatio) {
		return apperr.E("validation_error", "所选模型不支持该宽高比，请重新选择", 422)
	}
	quality := stringParam(params, "quality")
	switch quality {
	case "standard":
		quality = "medium"
	case "hd":
		quality = "high"
	}
	if quality != "" && !supports(model.Qualities, quality) {
		return apperr.E("validation_error", "所选模型不支持该输出质量，请重新选择", 422)
	}
	if boolParam(params, "transparentPngEnabled", "transparentPng", "transparentBackground") && !model.TransparentBackground {
		return apperr.E("validation_error", "所选模型不支持透明背景", 422)
	}
	outputFormat := stringParam(params, "outputFormat")
	if outputFormat == "jpg" {
		outputFormat = "jpeg"
	}
	if outputFormat != "" && !supports(model.OutputFormats, outputFormat) {
		return apperr.E("validation_error", "所选模型不支持指定输出格式，请使用模型内置格式", 422)
	}
	moderation := stringParam(params, "moderationLevel", "moderation")
	if moderation != "" && !supports(model.ModerationLevels, moderation) {
		return apperr.E("validation_error", "所选模型不支持该内容审核级别", 422)
	}
	if referenceCount > model.MaxReferenceImages {
		return apperr.E("validation_error", fmt.Sprintf("所选模型最多支持 %d 张参考图", model.MaxReferenceImages), 422)
	}
	return nil
}

type CreateInput struct {
	Type           string
	Prompt         string
	Params         map[string]any
	InputKeys      []string
	Count          int
	IdempotencyKey *string
}

// CreateTask 校验 + 冻结 + 建任务（单事务）。返回 (task, created)。
func CreateTask(ctx context.Context, st *store.Store, userID uuid.UUID, in CreateInput) (*store.Task, bool, error) {
	if !store.Contains(store.TaskTypes, in.Type) {
		return nil, false, apperr.E("validation_error", "不支持的任务类型", 422)
	}
	if in.Count < 1 || in.Count > 4 {
		return nil, false, apperr.E("validation_error", "count 须在 1-4 之间", 422)
	}

	var task *store.Task
	created := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockGlobalTaskCreation(ctx, tx); err != nil {
			return err
		}
		if err := store.LockUserTaskCreation(ctx, tx, userID); err != nil {
			return err
		}
		if in.IdempotencyKey != nil && *in.IdempotencyKey != "" {
			existing, err := store.GetTaskByIdemKey(ctx, tx, userID, *in.IdempotencyKey)
			if err != nil {
				return err
			}
			if existing != nil {
				task = existing
				return nil
			}
		}

		maxRunning, err := settings.GetInt(ctx, tx, "user_max_running_tasks")
		if err != nil {
			return err
		}
		if maxRunning <= 0 {
			maxRunning = 100
		}
		activeCount, err := store.CountActiveTasks(ctx, tx, userID)
		if err != nil {
			return err
		}
		if activeCount >= maxRunning {
			return apperr.E("user_task_limit", fmt.Sprintf("同时进行中的任务不能超过 %d 个", maxRunning), 429)
		}
		globalLimit, err := settings.GetInt(ctx, tx, "global_max_active_tasks")
		if err != nil {
			return err
		}
		if globalLimit <= 0 {
			globalLimit = 2000
		}
		globalActive, err := store.CountTasksInStatuses(ctx, tx, []string{"queued", "running"})
		if err != nil {
			return err
		}
		if globalActive >= globalLimit {
			return apperr.E("system_task_capacity", "当前生成任务较多，请稍后再试；你的提示词不会丢失", 429)
		}

		taskID := uuid.New()
		unitPrice, err := settings.TaskPriceCents(ctx, tx, in.Type)
		if err != nil {
			return err
		}
		provider, err := settings.ImageServiceProvider(ctx, tx, in.Type)
		if err != nil {
			return err
		}
		model := ""
		if provider == "c2a" {
			model, err = settings.TaskModel(ctx, tx, in.Type)
			if err != nil {
				return err
			}
		}
		params := make(map[string]any, len(in.Params)+1)
		for key, value := range in.Params {
			params[key] = value
		}
		params["_serviceProvider"] = provider
		modelCfg, err := modelconfig.Load(ctx, tx)
		if err != nil {
			return err
		}
		requestedModelID := ""
		for _, key := range []string{"publicModelKey", "modelId"} {
			if value, ok := in.Params[key].(string); ok && strings.TrimSpace(value) != "" {
				requestedModelID = strings.TrimSpace(value)
				break
			}
		}
		if requestedModelID == "standard" {
			requestedModelID = ""
		}
		workspace, workspaceMapped := modelconfig.WorkspaceForTaskType(in.Type)
		var selection *modelconfig.Selection
		var configured bool
		if workspaceMapped {
			selection, configured = modelconfig.SelectPublicForWorkspace(
				modelCfg, workspace, modelconfig.ModelKindImage, requestedModelID,
			)
		} else {
			selection, configured = modelconfig.SelectPublic(modelCfg, modelconfig.ModelKindImage, requestedModelID)
		}
		if configured {
			if err := validateModelImageCapabilities(selection.Model, in.Params, len(in.InputKeys)); err != nil {
				return err
			}
			if quality := stringParam(params, "quality"); quality != "" {
				switch quality {
				case "standard":
					quality = "medium"
				case "hd":
					quality = "high"
				}
				params["quality"] = quality
			}
			if format := stringParam(params, "outputFormat"); format != "" {
				if format == "jpg" {
					format = "jpeg"
				}
				params["outputFormat"] = format
			}
			requestedResolution := ""
			for _, key := range []string{"resolutionScale", "resolution"} {
				if value, ok := in.Params[key].(string); ok && strings.TrimSpace(value) != "" {
					requestedResolution = strings.ToUpper(strings.TrimSpace(value))
					break
				}
			}
			if requestedResolution != "" && len(selection.Model.Resolutions) > 0 {
				supported := false
				for _, resolution := range selection.Model.Resolutions {
					if strings.EqualFold(resolution, requestedResolution) {
						supported = true
						break
					}
				}
				if !supported {
					return apperr.E("validation_error", "所选模型不支持该分辨率，请重新选择", 422)
				}
			}
			requestedAspectRatio := stringParam(in.Params, "aspectRatio")
			if requestedAspectRatio == "auto" {
				params["requestedAspectRatio"] = "auto"
				params["aspectRatio"] = "auto"
				params["autoAspectRatioCandidates"] = modelconfig.AutoAspectRatioCandidates(
					selection.Model, requestedResolution,
				)
			}
			provider = selection.Provider.Adapter
			model = selection.Model.UpstreamModel
			unitPrice = modelconfig.EffectivePrice(selection.Model)
			params["_serviceProvider"] = provider
			params["_modelConfigId"] = selection.Model.ID
			params["_providerConfigId"] = selection.Provider.ID
			params["_providerDisplayName"] = selection.Provider.Name
			params["_modelDisplayName"] = selection.Model.Name
			params["_modelFastMode"] = selection.Model.FastMode
			params["_modelResolutions"] = selection.Model.Resolutions
			params["_modelAspectRatios"] = selection.Model.AspectRatios
			params["_modelAspectRatiosByResolution"] = selection.Model.AspectRatiosByResolution
			params["_modelQualities"] = selection.Model.Qualities
			params["_modelTransparentBackground"] = selection.Model.TransparentBackground
			params["_modelOutputFormats"] = selection.Model.OutputFormats
			params["_modelModerationLevels"] = selection.Model.ModerationLevels
			params["_modelMaxReferenceImages"] = selection.Model.MaxReferenceImages
			params["_unitPriceCents"] = unitPrice
		} else if (workspaceMapped && modelconfig.HasWorkspaceBinding(modelCfg, workspace)) ||
			modelconfig.HasPublicKind(modelCfg, modelconfig.ModelKindImage) || requestedModelID != "" {
			return apperr.E("validation_error", "所选图片模型未分配给当前页面，请刷新模型列表后重试", 422)
		}
		costCents := unitPrice * int64(in.Count)

		task, err = store.InsertTask(ctx, tx, store.NewTask{
			ID:             taskID,
			UserID:         userID,
			Type:           in.Type,
			Model:          model,
			Prompt:         in.Prompt,
			Params:         params,
			Count:          in.Count,
			InputKeys:      in.InputKeys,
			CostCents:      costCents,
			IdempotencyKey: in.IdempotencyKey,
		})
		if err != nil {
			return err
		}
		if costCents > 0 {
			_, err = wallet.FreezeForTask(ctx, tx, userID, taskID, costCents,
				strPtr(fmt.Sprintf("任务冻结（%s×%d）", in.Type, in.Count)))
			if err != nil {
				return err
			}
		}
		created = true
		return nil
	})
	if err != nil {
		// 幂等键并发竞态：唯一约束冲突时重放读取已有任务
		if store.IsUniqueViolation(err, "uq_tasks_user_idem") && in.IdempotencyKey != nil {
			existing, gerr := store.GetTaskByIdemKey(ctx, st.Pool, userID, *in.IdempotencyKey)
			if gerr == nil && existing != nil {
				return existing, false, nil
			}
		}
		return nil, false, err
	}
	return task, created, nil
}

// CancelTask 仅 queued 可取消：条件更新 + release，单事务。
func CancelTask(ctx context.Context, st *store.Store, userID, taskID uuid.UUID) (*store.Task, error) {
	return cancelTask(ctx, st, &userID, taskID, false)
}

// AdminCancelTask 管理员取消任意用户的 queued 任务：同用户端语义（放开属主校验），并通知任务属主。
func AdminCancelTask(ctx context.Context, st *store.Store, taskID uuid.UUID) (*store.Task, error) {
	return cancelTask(ctx, st, nil, taskID, true)
}

// cancelTask owner 非 nil 时校验属主；notify 为 true 时给任务属主发通知。
func cancelTask(ctx context.Context, st *store.Store, owner *uuid.UUID, taskID uuid.UUID, notify bool) (*store.Task, error) {
	var task *store.Task
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var t *store.Task
		var err error
		if owner != nil {
			t, err = store.GetUserTask(ctx, tx, *owner, taskID)
		} else {
			t, err = store.GetTask(ctx, tx, taskID)
		}
		if err != nil {
			return err
		}
		if t == nil {
			return apperr.E("task_not_found", "任务不存在", 404)
		}
		ok, err := store.CancelTask(ctx, tx, taskID, now())
		if err != nil {
			return err
		}
		if !ok {
			return apperr.E("task_not_cancelable", "仅排队中的任务可以取消", 400)
		}
		if t.CostCents > 0 {
			if _, err := wallet.ReleaseForTask(ctx, tx, t.UserID, taskID, t.CostCents, strPtr("任务取消解冻")); err != nil {
				return err
			}
		}
		if notify {
			body := fmt.Sprintf("你的「%s」任务已被管理员取消，费用已退回。", t.Type)
			if err := store.InsertNotification(ctx, tx, &t.UserID, "task", "任务已取消", &body); err != nil {
				return err
			}
		}
		task, err = store.GetTask(ctx, tx, taskID)
		return err
	})
	return task, err
}

// ForceFailTask 管理员把卡死的 running 任务强制置为 failed：
// 条件 UPDATE running→failed + release（幂等键沿用 task 代数规则），单事务；
// 通知在事务提交后尽力而为（M4 解耦）。
func ForceFailTask(ctx context.Context, st *store.Store, taskID uuid.UUID) (*store.Task, error) {
	var task *store.Task
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetTask(ctx, tx, taskID)
		if err != nil {
			return err
		}
		if t == nil {
			return apperr.E("task_not_found", "任务不存在", 404)
		}
		won, err := MarkFailed(ctx, tx, t, "admin_force_failed", "管理员强制失败", "running")
		if err != nil {
			return err
		}
		if !won {
			return apperr.E("task_not_cancelable", "仅运行中的任务可以强制失败", 400)
		}
		task, err = store.GetTask(ctx, tx, taskID)
		return err
	})
	if err == nil && task != nil {
		NotifyTaskFailed(ctx, st.Pool, task)
	}
	return task, err
}

// MarkSucceeded running→succeeded + settle，同事务。返回是否抢到状态迁移。
// 通知已解耦：调用方在事务提交后调用 NotifyTaskSucceeded（尽力而为）。
func MarkSucceeded(ctx context.Context, q store.Q, task *store.Task, outputKeys, thumbnailKeys []string, finishedAt time.Time) (bool, error) {
	ok, err := store.MarkTaskSucceeded(ctx, q, task.ID, outputKeys, thumbnailKeys, finishedAt)
	if err != nil || !ok {
		return false, err
	}
	if task.CostCents > 0 {
		// 按实际交付张数结算：上游部分成功（如 4 张只回 3 张）只收对应份额,
		// 未交付部分显式退回（冻结时已扣余额,Settle 只消耗冻结,差额必须 Release）。
		settleCents := task.CostCents
		if task.Count > 1 && len(outputKeys) > 0 && len(outputKeys) < task.Count {
			settleCents = task.CostCents / int64(task.Count) * int64(len(outputKeys))
		}
		if _, err := wallet.SettleForTask(ctx, q, task.UserID, task.ID, settleCents, nil); err != nil {
			return false, err
		}
		if refund := task.CostCents - settleCents; refund > 0 {
			reason := fmt.Sprintf("部分交付退款：%d/%d 张", len(outputKeys), task.Count)
			if _, err := wallet.ReleaseForTask(ctx, q, task.UserID, task.ID, refund, &reason); err != nil {
				return false, err
			}
		}
	}
	return true, nil
}

// MarkFailed fromStatus→failed + release，同事务。返回是否抢到状态迁移。
// 通知已解耦：调用方在事务提交后调用 NotifyTaskFailed（尽力而为）。
func MarkFailed(ctx context.Context, q store.Q, task *store.Task, errorCode, errorMessage, fromStatus string) (bool, error) {
	msg := []rune(errorMessage)
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	ok, err := store.MarkTaskFailed(ctx, q, task.ID, fromStatus, errorCode, string(msg), now())
	if err != nil || !ok {
		return false, err
	}
	if task.CostCents > 0 {
		if _, err := wallet.ReleaseForTask(ctx, q, task.UserID, task.ID, task.CostCents, strPtr("任务失败解冻")); err != nil {
			return false, err
		}
	}
	return true, nil
}

// NotifyTaskSucceeded 主事务提交后尽力而为发通知，失败仅日志（M4 解耦）。
func NotifyTaskSucceeded(ctx context.Context, q store.Q, task *store.Task, imageCount int) {
	body := fmt.Sprintf("你的「%s」任务已生成 %d 张图片。", task.Type, imageCount)
	if err := store.InsertNotification(ctx, q, &task.UserID, "task", "任务已完成", &body); err != nil {
		log.Printf("notify task %s succeeded: %v", task.ID, err)
	}
}

// NotifyTaskFailed 主事务提交后尽力而为发通知，失败仅日志（M4 解耦）。
func NotifyTaskFailed(ctx context.Context, q store.Q, task *store.Task) {
	body := fmt.Sprintf("你的「%s」任务执行失败，费用已退回。", task.Type)
	if err := store.InsertNotification(ctx, q, &task.UserID, "task", "任务失败", &body); err != nil {
		log.Printf("notify task %s failed: %v", task.ID, err)
	}
}

// FailQueuedEnqueue C1 入队失败补偿：条件更新 queued→failed（enqueue_failed）+ release，
// 单事务；事务提交后尽力而为通知属主。返回是否抢到迁移。
func FailQueuedEnqueue(ctx context.Context, st *store.Store, taskID uuid.UUID) (bool, error) {
	var task *store.Task
	won := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetTask(ctx, tx, taskID)
		if err != nil || t == nil {
			return err
		}
		task = t
		won, err = MarkFailed(ctx, tx, t, "enqueue_failed", "任务入队失败，费用已退回，请重试", "queued")
		return err
	})
	if err != nil || !won {
		return false, err
	}
	NotifyTaskFailed(ctx, st.Pool, task)
	return true, nil
}

// RequeueTask 后台重跑失败任务：failed→queued，重新冻结（失败时已解冻），不重复扣费。
func RequeueTask(ctx context.Context, st *store.Store, taskID uuid.UUID) (*store.Task, error) {
	var task *store.Task
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetTask(ctx, tx, taskID)
		if err != nil {
			return err
		}
		if t == nil {
			return apperr.E("task_not_found", "任务不存在", 404)
		}
		ok, err := store.RequeueTask(ctx, tx, taskID)
		if err != nil {
			return err
		}
		if !ok {
			return apperr.E("task_not_cancelable", "仅失败任务可以重新入队", 400)
		}
		if t.CostCents > 0 {
			if _, err := wallet.FreezeForTask(ctx, tx, t.UserID, taskID, t.CostCents, strPtr("任务重跑冻结")); err != nil {
				return err
			}
		}
		task, err = store.GetTask(ctx, tx, taskID)
		return err
	})
	return task, err
}
