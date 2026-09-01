// Package taskflow 实现任务提交 / 取消 / 重跑 / 结算落库与 Asynq 入队。
package taskflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/growth"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/trialfeature"
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

func mediaToolInput(params map[string]any) (map[string]any, error) {
	raw, exists := params["toolInput"]
	if !exists || raw == nil {
		return map[string]any{}, nil
	}
	value, ok := raw.(map[string]any)
	if !ok {
		return nil, apperr.E("validation_error", "toolInput: 必须是参数对象", 422)
	}
	return value, nil
}

func mediaToolFiles(params map[string]any) (map[string][]string, error) {
	result := map[string][]string{}
	raw, exists := params["toolFiles"]
	if !exists || raw == nil {
		return result, nil
	}
	value, ok := raw.(map[string]any)
	if !ok {
		return nil, apperr.E("validation_error", "toolFiles: 必须是文件参数对象", 422)
	}
	for field, encoded := range value {
		items, ok := encoded.([]any)
		if !ok {
			if stringsValue, stringsOK := encoded.([]string); stringsOK {
				result[field] = append([]string(nil), stringsValue...)
				continue
			}
			return nil, apperr.E("validation_error", "toolFiles."+field+": 必须是文件数组", 422)
		}
		keys := make([]string, 0, len(items))
		for _, item := range items {
			key, ok := item.(string)
			if !ok || strings.TrimSpace(key) == "" {
				return nil, apperr.E("validation_error", "toolFiles."+field+": 文件键无效", 422)
			}
			keys = append(keys, strings.TrimSpace(key))
		}
		result[field] = keys
	}
	return result, nil
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
	if requestedResolution != "" && !supports(model.Resolutions, requestedResolution) {
		return apperr.E("validation_error", "所选模型不支持该分辨率，请重新选择", 422)
	}
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

func normalizeCanvasImageOutputFormat(model modelconfig.Model, params map[string]any) {
	if stringParam(params, "_source") != "react_canvas" {
		return
	}
	outputFormat := strings.ToLower(stringParam(params, "outputFormat"))
	if outputFormat == "jpg" {
		outputFormat = "jpeg"
	}
	if outputFormat != "" && !supports(model.OutputFormats, outputFormat) {
		// Infinite canvas has no output-format selector. Old clients could still
		// send a persisted implicit format, so fall back to the model-native format
		// instead of rejecting an otherwise valid generation.
		delete(params, "outputFormat")
	}
}

func ValidateModelImageCapabilities(model modelconfig.Model, params map[string]any, referenceCount int) error {
	return validateModelImageCapabilities(model, params, referenceCount)
}

type CreateInput struct {
	Type                   string
	Prompt                 string
	Params                 map[string]any
	InputKeys              []string
	Count                  int
	IdempotencyKey         *string
	ExpectedUnitPriceCents *int64
}

type PriceQuote struct {
	Workspace              string
	ModelID                string
	StandardUnitPriceCents int64
	DiscountUnitPriceCents *int64
	UnitPriceCents         int64
	Count                  int
	TotalPriceCents        int64
	ConfigVersion          int
	Overridden             bool
}

func requestedModelID(params map[string]any) string {
	for _, key := range []string{"publicModelKey", "modelId"} {
		if value, ok := params[key].(string); ok && strings.TrimSpace(value) != "" {
			value = strings.TrimSpace(value)
			if value == "standard" {
				return ""
			}
			return value
		}
	}
	return ""
}

func numericParam(params map[string]any, key string) float64 {
	if params == nil {
		return 0
	}
	switch value := params[key].(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case int32:
		return float64(value)
	case json.Number:
		parsed, _ := value.Float64()
		return parsed
	default:
		return 0
	}
}

func resolveSelectionPrice(cfg modelconfig.Config, workspace string, model modelconfig.Model, params map[string]any) modelconfig.ResolvedWorkspacePrice {
	if model.Kind == modelconfig.ModelKindImageTool && model.Tool == modelconfig.ImageToolUpscale {
		toolInput, _ := params["toolInput"].(map[string]any)
		return modelconfig.ResolveImageUpscalePrice(
			model,
			int(numericParam(params, "_inputImageLongEdge")),
			numericParam(toolInput, "scale_factor"),
		)
	}
	return modelconfig.ResolveWorkspacePrice(cfg, workspace, model)
}

func QuoteTaskPrice(ctx context.Context, q store.Q, in CreateInput) (*PriceQuote, error) {
	if !store.Contains(store.TaskTypes, in.Type) || in.Type == "puzzle" {
		return nil, apperr.E("validation_error", "不支持的任务类型", 422)
	}
	if in.Count < 1 || in.Count > modelconfig.MaxImagesLimit {
		return nil, apperr.E("validation_error", fmt.Sprintf("count 须在 1-%d 之间", modelconfig.MaxImagesLimit), 422)
	}
	unitPrice, err := settings.TaskPriceCents(ctx, q, in.Type)
	if err != nil {
		return nil, err
	}
	quote := &PriceQuote{
		StandardUnitPriceCents: unitPrice, UnitPriceCents: unitPrice,
		Count: in.Count, TotalPriceCents: unitPrice * int64(in.Count),
	}
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return nil, err
	}
	quote.ConfigVersion = cfg.Version
	workspace, workspaceMapped := modelconfig.WorkspaceForTaskType(in.Type)
	if stringParam(in.Params, "_source") == "react_canvas" {
		workspace = modelconfig.WorkspaceCanvas
		workspaceMapped = true
	}
	quote.Workspace = workspace
	modelID := requestedModelID(in.Params)
	var selection *modelconfig.Selection
	var configured bool
	switch in.Type {
	case "media_tool":
		if modelID == "" {
			return nil, apperr.E("validation_error", "媒体工具必须指定后台已开放的工具模型", 422)
		}
		selection, configured = modelconfig.SelectPublic(cfg, modelconfig.ModelKindImageTool, modelID)
	case "background_remove":
		selection, configured = modelconfig.SelectPublicImageTool(cfg, modelconfig.ImageToolBackgroundRemove, modelID)
	default:
		if workspaceMapped {
			selection, configured = modelconfig.SelectPublicForWorkspace(cfg, workspace, modelconfig.ModelKindImage, modelID)
		} else {
			selection, configured = modelconfig.SelectPublic(cfg, modelconfig.ModelKindImage, modelID)
		}
	}
	if configured {
		if selection.Model.Kind == modelconfig.ModelKindImage {
			if err := validateModelImageCapabilities(selection.Model, in.Params, len(in.InputKeys)); err != nil {
				return nil, err
			}
			if in.Count > selection.Model.GenerationMaxImages() {
				return nil, apperr.E("validation_error", fmt.Sprintf("所选模型单次最多生成 %d 张", selection.Model.GenerationMaxImages()), 422)
			}
		}
		resolved := resolveSelectionPrice(cfg, workspace, selection.Model, in.Params)
		quote.ModelID = selection.Model.ID
		quote.StandardUnitPriceCents = resolved.PriceCents
		quote.DiscountUnitPriceCents = resolved.DiscountPriceCents
		quote.UnitPriceCents = resolved.EffectiveCents
		quote.TotalPriceCents = resolved.EffectiveCents * int64(in.Count)
		quote.Overridden = resolved.Overridden
		return quote, nil
	}
	if in.Type == "media_tool" || in.Type == "background_remove" ||
		(workspaceMapped && modelconfig.HasWorkspaceBinding(cfg, workspace)) || modelID != "" {
		return nil, apperr.E("validation_error", "所选模型未分配给当前页面或已下线", 422)
	}
	return quote, nil
}

// CreateTaskCommitHook runs inside the task creation transaction after the
// task and its wallet freeze have been persisted. Returning an error rolls the
// entire task creation back.
type CreateTaskCommitHook func(context.Context, pgx.Tx, *store.Task, bool) error

func taskUploadReferenceKeys(inputKeys []string, params map[string]any) []string {
	keys := append([]string(nil), inputKeys...)
	for _, paramKey := range []string{"maskKey", "maskBaseKey"} {
		if key, ok := params[paramKey].(string); ok {
			keys = append(keys, key)
		}
	}
	return keys
}

func taskOutputParentID(userID uuid.UUID, key string) (uuid.UUID, bool) {
	prefix := "tasks/" + userID.String() + "/"
	if !strings.HasPrefix(key, prefix) {
		return uuid.Nil, false
	}
	rest := strings.TrimPrefix(key, prefix)
	if slash := strings.IndexByte(rest, '/'); slash >= 0 {
		rest = rest[:slash]
	}
	id, err := uuid.Parse(rest)
	return id, err == nil
}

func isAssistantOutputKey(userID uuid.UUID, key string) bool {
	prefix := "tasks/" + userID.String() + "/"
	if !strings.HasPrefix(key, prefix) {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(key, prefix), "/")
	if len(parts) != 3 || parts[0] != "assistant" || parts[2] == "" {
		return false
	}
	_, err := uuid.Parse(parts[1])
	return err == nil
}

// validateAndLockTaskInputReferences serializes task version chains with
// deletion. Current task outputs carry their task UUID in the object key;
// assistant output keys are checked against their message rows, while legacy
// task-shaped keys remain compatible for older stored data.
func validateAndLockTaskInputReferences(ctx context.Context, q store.Q, userID uuid.UUID, keys []string) error {
	if err := store.LockObjectReferenceKeys(ctx, q, keys); err != nil {
		return err
	}
	parentPrefix := "tasks/" + userID.String() + "/"
	taskKeys := make([]string, 0, len(keys))
	strictKeys := make(map[string]struct{})
	assistantKeys := make([]string, 0)
	for _, key := range keys {
		if !strings.HasPrefix(key, parentPrefix) {
			continue
		}
		if isAssistantOutputKey(userID, key) {
			assistantKeys = append(assistantKeys, key)
			continue
		}
		taskKeys = append(taskKeys, key)
		if _, ok := taskOutputParentID(userID, key); ok {
			strictKeys[key] = struct{}{}
		}
	}
	if len(taskKeys) > 0 {
		referenced, err := store.LockTasksReferencingOutputKeys(ctx, q, userID, taskKeys)
		if err != nil {
			return err
		}
		for key := range strictKeys {
			if _, ok := referenced[key]; !ok {
				return apperr.E("validation_error", "inputKeys 引用的任务不存在或已删除", 422)
			}
		}
	}
	if len(assistantKeys) > 0 {
		referenced, err := store.LockAssistantOutputKeys(ctx, q, userID, assistantKeys)
		if err != nil {
			return err
		}
		for _, key := range assistantKeys {
			if _, ok := referenced[key]; !ok {
				return apperr.E("validation_error", "inputKeys 引用的助手图片不存在或已删除", 422)
			}
		}
	}
	return nil
}

// CreateTask 校验 + 冻结 + 建任务（单事务）。返回 (task, created)。
func CreateTask(ctx context.Context, st *store.Store, userID uuid.UUID, in CreateInput) (*store.Task, bool, error) {
	return createTask(ctx, st, userID, in, nil)
}

// CreateTaskWithCommitHook lets a domain record be attached atomically to a
// newly created task. Callers should use a unique idempotency key per attempt.
func CreateTaskWithCommitHook(ctx context.Context, st *store.Store, userID uuid.UUID, in CreateInput, hook CreateTaskCommitHook) (*store.Task, bool, error) {
	return createTask(ctx, st, userID, in, hook)
}

func createTask(ctx context.Context, st *store.Store, userID uuid.UUID, in CreateInput, hook CreateTaskCommitHook) (*store.Task, bool, error) {
	if !store.Contains(store.TaskTypes, in.Type) {
		return nil, false, apperr.E("validation_error", "不支持的任务类型", 422)
	}
	if in.Type == "puzzle" {
		return nil, false, apperr.E("puzzle_local_only", "AI 拼图是免费本地工具，不创建云端生成任务", 422)
	}
	if in.Count < 1 || in.Count > modelconfig.MaxImagesLimit {
		return nil, false, apperr.E("validation_error", fmt.Sprintf("count 须在 1-%d 之间", modelconfig.MaxImagesLimit), 422)
	}
	isBackgroundRemove := in.Type == "background_remove"
	isMediaTool := in.Type == "media_tool"
	taskFeature, _ := trialfeature.ForTask(in.Type, in.Params)
	if isBackgroundRemove && (in.Count != 1 || len(in.InputKeys) != 1) {
		return nil, false, apperr.E("validation_error", "背景移除任务必须且只能包含 1 张输入图片", 422)
	}
	if isMediaTool && in.Count != 1 {
		return nil, false, apperr.E("validation_error", "媒体工具任务每次只能提交 1 个处理任务", 422)
	}

	var task *store.Task
	created := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
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
				if err := store.AddUserUploadReferences(ctx, tx, userID, store.UploadReferenceTaskInput,
					existing.ID, taskUploadReferenceKeys(existing.InputKeys, existing.Params)); err != nil {
					return err
				}
				if hook != nil {
					return hook(ctx, tx, task, false)
				}
				return nil
			}
		}
		if err := validateAndLockTaskInputReferences(ctx, tx, userID, taskUploadReferenceKeys(in.InputKeys, in.Params)); err != nil {
			return err
		}
		if err := trialfeature.Authorize(ctx, tx, userID, taskFeature); err != nil {
			return err
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
		maxImages, err := settings.GetInt(ctx, tx, "user_max_running_images")
		if err != nil {
			return err
		}
		if maxImages <= 0 {
			maxImages = maxRunning * 4
		}
		activeImages, err := store.CountActiveTaskUnits(ctx, tx, userID)
		if err != nil {
			return err
		}
		if activeImages+int64(in.Count) > int64(maxImages) {
			return apperr.E("user_image_capacity", fmt.Sprintf("同时处理的图片不能超过 %d 张", maxImages), 429)
		}
		taskID := uuid.New()
		unitPrice, err := settings.TaskPriceCents(ctx, tx, in.Type)
		if err != nil {
			return err
		}
		provider := ""
		model := ""
		if !isBackgroundRemove && !isMediaTool {
			provider, err = settings.ImageServiceProvider(ctx, tx, in.Type)
			if err != nil {
				return err
			}
			if provider == "c2a" {
				model, err = settings.TaskModel(ctx, tx, in.Type)
				if err != nil {
					return err
				}
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
		if stringParam(in.Params, "_source") == "react_canvas" {
			workspace = modelconfig.WorkspaceCanvas
			workspaceMapped = true
		}
		var selection *modelconfig.Selection
		var configured bool
		if isMediaTool {
			if requestedModelID == "" {
				return apperr.E("validation_error", "媒体工具必须指定后台已开放的工具模型", 422)
			}
			selection, configured = modelconfig.SelectPublic(modelCfg, modelconfig.ModelKindImageTool, requestedModelID)
		} else if isBackgroundRemove {
			selection, configured = modelconfig.SelectPublicImageTool(
				modelCfg, modelconfig.ImageToolBackgroundRemove, requestedModelID,
			)
		} else if workspaceMapped {
			selection, configured = modelconfig.SelectPublicForWorkspace(
				modelCfg, workspace, modelconfig.ModelKindImage, requestedModelID,
			)
		} else {
			selection, configured = modelconfig.SelectPublic(modelCfg, modelconfig.ModelKindImage, requestedModelID)
		}
		if configured {
			if isMediaTool {
				toolInput, inputErr := mediaToolInput(params)
				if inputErr != nil {
					return inputErr
				}
				toolFiles, filesErr := mediaToolFiles(params)
				if filesErr != nil {
					return filesErr
				}
				if err := modelconfig.ValidateMediaToolInput(selection.Model, toolInput, toolFiles, in.InputKeys); err != nil {
					return apperr.E("validation_error", err.Error(), 422)
				}
			} else if !isBackgroundRemove {
				normalizeCanvasImageOutputFormat(selection.Model, params)
				if err := validateModelImageCapabilities(selection.Model, params, len(in.InputKeys)); err != nil {
					return err
				}
				if in.Count > selection.Model.GenerationMaxImages() {
					return apperr.E("validation_error", fmt.Sprintf("所选模型单次最多生成 %d 张", selection.Model.GenerationMaxImages()), 422)
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
				if requestedResolution != "" {
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
			}
			provider = selection.Provider.Adapter
			model = selection.Model.UpstreamModel
			modelEffectivePrice := modelconfig.EffectivePrice(selection.Model)
			resolvedPrice := resolveSelectionPrice(modelCfg, workspace, selection.Model, params)
			unitPrice = resolvedPrice.EffectiveCents
			upstreamUnitCost := modelconfig.ResolveUpstreamCost(
				selection.Model,
				int(numericParam(params, "_inputImageLongEdge")),
				numericParam(func() map[string]any { value, _ := params["toolInput"].(map[string]any); return value }(), "scale_factor"),
			)
			if unitPrice == 0 && !selection.Model.AllowZeroPrice {
				return apperr.E("model_zero_price_blocked", "模型价格尚未配置，已阻止零积分调用", 503)
			}
			if unitPrice < upstreamUnitCost && !selection.Model.AllowLossLeader {
				return apperr.E("model_price_inverted", "模型价格低于上游成本，已暂停调用，请联系管理员", 503)
			}
			params["_serviceProvider"] = provider
			params["_modelConfigId"] = selection.Model.ID
			params["_providerConfigId"] = selection.Provider.ID
			params["_providerRouteId"] = selection.Provider.RouteID
			params["_providerRouteKey"] = modelconfig.ExecutionRouteKey(selection.Provider)
			params["_providerDisplayName"] = selection.Provider.Name
			params["_modelDisplayName"] = selection.Model.Name
			params["_modelTool"] = selection.Model.Tool
			params["_modelFastMode"] = selection.Model.FastMode
			params["_modelResolutions"] = selection.Model.Resolutions
			params["_modelAspectRatios"] = selection.Model.AspectRatios
			params["_modelAspectRatiosByResolution"] = selection.Model.AspectRatiosByResolution
			params["_modelQualities"] = selection.Model.Qualities
			params["_modelTransparentBackground"] = selection.Model.TransparentBackground
			params["_modelOutputFormats"] = selection.Model.OutputFormats
			params["_modelModerationLevels"] = selection.Model.ModerationLevels
			params["_modelMaxReferenceImages"] = selection.Model.MaxReferenceImages
			params["_modelMaxImages"] = selection.Model.GenerationMaxImages()
			params["_unitPriceCents"] = unitPrice
			params["_billingUnitPriceCents"] = unitPrice
			params["_modelEffectivePriceCents"] = modelEffectivePrice
			params["_upstreamUnitCostCents"] = upstreamUnitCost
			params["_pricingWorkspace"] = workspace
		} else if isMediaTool {
			return apperr.E("validation_error", "所选媒体工具尚未配置、未开放或已下线", 422)
		} else if isBackgroundRemove {
			return apperr.E("validation_error", "背景移除工具尚未配置或未开放", 422)
		} else if (workspaceMapped && modelconfig.HasWorkspaceBinding(modelCfg, workspace)) ||
			modelconfig.HasPublicKind(modelCfg, modelconfig.ModelKindImage) || requestedModelID != "" {
			return apperr.E("validation_error", "所选图片模型未分配给当前页面，请刷新模型列表后重试", 422)
		}
		costCents := unitPrice * int64(in.Count)
		if in.ExpectedUnitPriceCents != nil && *in.ExpectedUnitPriceCents != unitPrice {
			return apperr.E("price_changed", "任务价格已更新，请确认最新费用后重试", 409)
		}

		// Model validation and route resolution above are independent per user and
		// intentionally happen before the short global admission section. Only the
		// count-and-insert boundary is serialized across API replicas. Settings
		// reads run before the lock so the serialized section is just the two
		// index-only counts plus insert/freeze.
		globalLimit, err := settings.GetInt(ctx, tx, "global_max_active_tasks")
		if err != nil {
			return err
		}
		if globalLimit <= 0 {
			globalLimit = 12000
		}
		globalImageLimit, err := settings.GetInt(ctx, tx, "global_max_active_images")
		if err != nil {
			return err
		}
		if globalImageLimit <= 0 {
			globalImageLimit = 12000
		}
		if err := store.LockGlobalTaskCreation(ctx, tx); err != nil {
			return err
		}
		globalActive, err := store.CountActiveTasksGlobal(ctx, tx)
		if err != nil {
			return err
		}
		if globalActive >= globalLimit {
			return apperr.E("system_task_capacity", "当前生成任务较多，请稍后再试；你的提示词不会丢失", 429)
		}
		globalImages, err := store.CountActiveTaskUnitsGlobal(ctx, tx)
		if err != nil {
			return err
		}
		if globalImages+int64(in.Count) > int64(globalImageLimit) {
			return apperr.E("system_image_capacity", "系统排队容量已满，请稍后重试；已接收的任务不会丢失", 429)
		}

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
			WorkUnits:      in.Count,
			IdempotencyKey: in.IdempotencyKey,
		})
		if err != nil {
			return err
		}
		if rawAPIKeyID, ok := params["_apiKeyId"].(string); ok && strings.TrimSpace(rawAPIKeyID) != "" {
			apiKeyID, parseErr := uuid.Parse(strings.TrimSpace(rawAPIKeyID))
			if parseErr != nil {
				return apperr.E("api_key_invalid", "API Key 上下文无效", 401)
			}
			if usageErr := store.RecordAPIKeyTaskCreation(ctx, tx, apiKeyID, userID, task.ID,
				stringParam(params, "_modelConfigId"), costCents, now()); usageErr != nil {
				switch {
				case errors.Is(usageErr, store.ErrAPIKeyInactive):
					return apperr.E("api_key_invalid", "API Key 已失效", 401)
				case errors.Is(usageErr, store.ErrAPIKeyDailyLimit):
					return apperr.E("api_key_daily_limit", "API Key 今日调用或积分额度已用完", 429)
				case errors.Is(usageErr, store.ErrAPIKeyMonthlyLimit):
					return apperr.E("api_key_monthly_limit", "API Key 本月调用或积分额度已用完", 429)
				case errors.Is(usageErr, store.ErrAPIKeyModelDenied):
					return apperr.E("api_key_model_denied", "此 API Key 无权调用所选模型", 403)
				default:
					return usageErr
				}
			}
		}
		if err := store.AddUserUploadReferences(ctx, tx, userID, store.UploadReferenceTaskInput,
			task.ID, taskUploadReferenceKeys(in.InputKeys, params)); err != nil {
			return err
		}
		if costCents > 0 {
			if err := store.LockTrialCampaignLifecycleShared(ctx, tx); err != nil {
				return err
			}
			reason := "任务冻结"
			if in.Count > 1 {
				reason = fmt.Sprintf("任务冻结（%d 张）", in.Count)
			}
			if store.IsCanvasOrigin(params) {
				reason = "无限画布冻结"
				if in.Count > 1 {
					reason = fmt.Sprintf("无限画布冻结（%d 张）", in.Count)
				}
			}
			_, err = wallet.FreezeForTask(ctx, tx, userID, taskID, costCents, taskFeature.Key, strPtr(reason))
			if err != nil {
				return err
			}
		}
		created = true
		if hook != nil {
			return hook(ctx, tx, task, true)
		}
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

// CancelTask is kept for trusted internal callers that already made the
// cancellation consequence explicit to the user.
func CancelTask(ctx context.Context, st *store.Store, userID, taskID uuid.UUID) (*store.Task, error) {
	return cancelTask(ctx, st, &userID, taskID, cancelActorUser, true)
}

// CancelTaskConfirmed requires an explicit acknowledgement once an image task
// may already be running upstream. The check happens under the task row lock,
// so a queued-to-running race cannot silently bypass the warning.
func CancelTaskConfirmed(ctx context.Context, st *store.Store, userID, taskID uuid.UUID, acknowledgeUpstream bool) (*store.Task, error) {
	return cancelTask(ctx, st, &userID, taskID, cancelActorUser, acknowledgeUpstream)
}

// AdminCancelTask 管理员取消任意用户的 queued 任务并退回冻结费用。
func AdminCancelTask(ctx context.Context, st *store.Store, taskID uuid.UUID) (*store.Task, error) {
	return cancelTask(ctx, st, nil, taskID, cancelActorAdmin, true)
}

// CancelQueuedTaskSilently is reserved for internal rollback before a queued
// task is exposed to the user. It must not be presented as a user action.
func CancelQueuedTaskSilently(ctx context.Context, st *store.Store, userID, taskID uuid.UUID) (*store.Task, error) {
	return cancelTask(ctx, st, &userID, taskID, cancelActorSystem, true)
}

type cancelActor string

const (
	cancelActorUser   cancelActor = "user"
	cancelActorAdmin  cancelActor = "admin"
	cancelActorSystem cancelActor = "system"
)

func imageTaskRequiresCancelConfirmation(taskType string) bool {
	return store.Contains(modelconfig.ImageTaskTypes, taskType) ||
		taskType == "background_remove" || taskType == "media_tool"
}

// cancelTask only lets an explicit user action stop running work. Admin and
// internal rollback remain limited to queued tasks.
func cancelTask(ctx context.Context, st *store.Store, owner *uuid.UUID, taskID uuid.UUID, actor cancelActor, acknowledgeUpstream bool) (*store.Task, error) {
	var task *store.Task
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var t *store.Task
		var err error
		if owner != nil {
			t, err = store.GetUserTaskForUpdate(ctx, tx, *owner, taskID)
		} else {
			t, err = store.GetTaskForUpdate(ctx, tx, taskID)
		}
		if err != nil {
			return err
		}
		if t == nil {
			return apperr.E("task_not_found", "任务不存在", 404)
		}
		if actor == cancelActorUser && t.Status == "canceled" && t.ErrorCode != nil && *t.ErrorCode == "user_canceled" {
			task = t
			return nil
		}
		fromStatus := t.Status
		if fromStatus != "queued" && (actor != cancelActorUser || fromStatus != "running") {
			if actor != cancelActorUser {
				return apperr.E("task_not_cancelable", "仅排队中的任务可以取消", 400)
			}
			return apperr.E("task_not_cancelable", "仅排队中或运行中的任务可以停止", 400)
		}
		generationStage := stringParam(t.Params, "_generationStage")
		upstreamSubmitted := fromStatus == "running" && generationStage != "preparing"
		if actor == cancelActorUser && imageTaskRequiresCancelConfirmation(t.Type) && upstreamSubmitted && !acknowledgeUpstream {
			return apperr.E("task_cancel_confirmation_required", "生成请求已经提交给上游，取消只会停止等待和接收结果，上游可能仍会继续生成，本次积分不会退回。请确认后再停止", 409)
		}
		errorCode, errorMessage := "user_canceled", "任务已在提交上游前取消"
		if upstreamSubmitted {
			errorMessage = "已停止接收本次生成结果；请求已提交上游，可能仍会继续生成"
		}
		if actor == cancelActorAdmin {
			errorCode, errorMessage = "admin_canceled", "管理员取消任务"
		} else if actor == cancelActorSystem {
			errorCode, errorMessage = "system_canceled", "系统回滚未提交任务"
		}
		ok, err := store.CancelTaskFromStatus(ctx, tx, taskID, fromStatus, errorCode, errorMessage, now())
		if err != nil {
			return err
		}
		if !ok {
			return apperr.E("task_not_cancelable", "任务状态已变化，无法停止", 409)
		}
		if err := store.ClearTaskOutputsAndEnqueueCleanup(ctx, tx, taskID, t.OutputKeys, t.ThumbnailKeys); err != nil {
			return err
		}
		if err := store.SupersedePendingTaskUpstreamAttempts(ctx, tx, taskID, now()); err != nil {
			return err
		}
		if t.CostCents > 0 {
			if upstreamSubmitted {
				if _, err := wallet.SettleForTask(ctx, tx, t.UserID, taskID, t.CostCents, strPtr("用户主动停止：任务已提交，按预留积分结算")); err != nil {
					return err
				}
			} else {
				reason := "用户主动停止：任务未提交，冻结积分退回"
				if actor == cancelActorAdmin {
					reason = "管理员取消：任务未提交，冻结积分退回"
				} else if actor == cancelActorSystem {
					reason = "系统回滚：任务未提交，冻结积分退回"
				}
				if _, err := wallet.ReleaseForTask(ctx, tx, t.UserID, taskID, t.CostCents, strPtr(reason)); err != nil {
					return err
				}
			}
		}
		if upstreamSubmitted {
			if err := recordTaskProfit(ctx, tx, t, t.CostCents, t.Count, "canceled", now()); err != nil {
				return err
			}
		}
		if actor == cancelActorAdmin {
			body := taskNotifyName(t) + "已被管理员取消，费用已退回。"
			if err := store.InsertNotification(ctx, tx, &t.UserID, "task", taskNotifyName(t)+"已取消", &body); err != nil {
				return err
			}
		} else if actor == cancelActorUser {
			name := taskNotifyName(t)
			body := "你已主动停止" + name + "任务。任务尚未提交，冻结积分已退回。"
			if upstreamSubmitted {
				body = "你已主动停止" + name + "任务。任务已提交，按本次预留积分结算，不按失败退款，也不会发放失败补偿。"
			}
			if err := store.InsertNotification(ctx, tx, &t.UserID, "task", name+"已主动停止", &body); err != nil {
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
		t, err := store.GetTaskForUpdate(ctx, tx, taskID)
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
		if err := store.ClearTaskOutputsAndEnqueueCleanup(ctx, tx, taskID, t.OutputKeys, t.ThumbnailKeys); err != nil {
			return err
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
	return markSucceeded(ctx, q, task, outputKeys, thumbnailKeys, finishedAt, "", "")
}

func MarkSucceededClaimed(ctx context.Context, q store.Q, task *store.Task, outputKeys, thumbnailKeys []string, finishedAt time.Time, claimID string) (bool, error) {
	return markSucceeded(ctx, q, task, outputKeys, thumbnailKeys, finishedAt, claimID, "")
}

func MarkSucceededOwned(ctx context.Context, q store.Q, task *store.Task, outputKeys, thumbnailKeys []string, finishedAt time.Time, owner string) (bool, error) {
	return markSucceeded(ctx, q, task, outputKeys, thumbnailKeys, finishedAt, "", owner)
}

func markSucceeded(ctx context.Context, q store.Q, task *store.Task, outputKeys, thumbnailKeys []string, finishedAt time.Time, claimID, owner string) (bool, error) {
	var ok bool
	var err error
	if claimID == "" {
		if owner == "" {
			ok, err = store.MarkTaskSucceeded(ctx, q, task.ID, outputKeys, thumbnailKeys, finishedAt)
		} else {
			ok, err = store.MarkTaskSucceededOwned(ctx, q, task.ID, outputKeys, thumbnailKeys, finishedAt, owner)
		}
	} else {
		ok, err = store.MarkTaskSucceededClaimed(ctx, q, task.ID, outputKeys, thumbnailKeys, finishedAt, claimID)
	}
	if err != nil || !ok {
		return false, err
	}
	settleCents := task.CostCents
	if task.Count > 1 && len(outputKeys) > 0 && len(outputKeys) < task.Count {
		settleCents = task.CostCents / int64(task.Count) * int64(len(outputKeys))
	}
	if task.CostCents > 0 {
		// 按实际交付张数结算：上游部分成功（如 4 张只回 3 张）只收对应份额,
		// 未交付部分显式退回（冻结时已扣余额,Settle 只消耗冻结,差额必须 Release）。
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
	if err := recordTaskProfit(ctx, q, task, settleCents, len(outputKeys), "succeeded", finishedAt); err != nil {
		return false, err
	}
	if err := growth.ApplyTaskSuccessMilestones(ctx, q, task, len(outputKeys), finishedAt); err != nil {
		return false, err
	}
	return true, nil
}

// MarkFailed fromStatus→failed + release，同事务。返回是否抢到状态迁移。
// 通知已解耦：调用方在事务提交后调用 NotifyTaskFailed（尽力而为）。
func MarkFailed(ctx context.Context, q store.Q, task *store.Task, errorCode, errorMessage, fromStatus string) (bool, error) {
	return markFailed(ctx, q, task, errorCode, errorMessage, fromStatus, "", "")
}

func MarkFailedClaimed(ctx context.Context, q store.Q, task *store.Task, errorCode, errorMessage, fromStatus, claimID string) (bool, error) {
	return markFailed(ctx, q, task, errorCode, errorMessage, fromStatus, claimID, "")
}

func MarkFailedOwned(ctx context.Context, q store.Q, task *store.Task, errorCode, errorMessage, fromStatus, owner string) (bool, error) {
	return markFailed(ctx, q, task, errorCode, errorMessage, fromStatus, "", owner)
}

func markFailed(ctx context.Context, q store.Q, task *store.Task, errorCode, errorMessage, fromStatus, claimID, owner string) (bool, error) {
	msg := []rune(errorMessage)
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	var ok bool
	var err error
	if claimID == "" {
		if owner == "" {
			ok, err = store.MarkTaskFailed(ctx, q, task.ID, fromStatus, errorCode, string(msg), now())
		} else {
			ok, err = store.MarkTaskFailedOwned(ctx, q, task.ID, fromStatus, errorCode, string(msg), now(), owner)
		}
	} else {
		ok, err = store.MarkTaskFailedClaimed(ctx, q, task.ID, fromStatus, errorCode, string(msg), now(), claimID)
	}
	if err != nil || !ok {
		return false, err
	}
	if task.CostCents > 0 {
		if _, err := wallet.ReleaseForTask(ctx, q, task.UserID, task.ID, task.CostCents, strPtr("任务失败解冻")); err != nil {
			return false, err
		}
	}
	if fromStatus == "running" {
		failedTask := *task
		failedTask.ErrorCode = strPtr(errorCode)
		failedTask.ErrorMessage = strPtr(string(msg))
		if err := recordTaskProfit(ctx, q, &failedTask, 0, task.Count, "failed", now()); err != nil {
			return false, err
		}
	}
	if err := growth.ApplyTaskFailureCompensation(ctx, q, task, errorCode, now()); err != nil {
		return false, err
	}
	return true, nil
}

func recordTaskProfit(ctx context.Context, q store.Q, task *store.Task, revenue int64, units int, status string, at time.Time) error {
	if task == nil {
		return nil
	}
	unitCost := int64(numericParam(task.Params, "_upstreamUnitCostCents"))
	metadata := map[string]any{"taskType": task.Type, "requestedUnits": task.Count}
	var apiKeyID *uuid.UUID
	if rawAPIKeyID := stringParam(task.Params, "_apiKeyId"); rawAPIKeyID != "" {
		metadata["apiKeyId"] = rawAPIKeyID
		metadata["source"] = "open_api"
		if parsed, err := uuid.Parse(rawAPIKeyID); err == nil {
			apiKeyID = &parsed
		}
	}
	if err := store.InsertUsageProfitEntry(ctx, q, store.UsageProfitEntry{
		SourceType: "task", SourceID: task.ID.String(), BillingGeneration: max(task.Attempt, 0),
		UserID: task.UserID, APIKeyID: apiKeyID,
		EventStatus: status, Workspace: stringParam(task.Params, "_pricingWorkspace"),
		ProviderID: stringParam(task.Params, "_providerConfigId"), RouteID: stringParam(task.Params, "_providerRouteId"),
		ModelID: stringParam(task.Params, "_modelConfigId"), Units: units,
		RevenueCents: revenue, UpstreamCostCents: unitCost * int64(max(units, 0)), Metadata: metadata, CreatedAt: at,
	}); err != nil {
		return err
	}
	return store.EnqueueTaskWebhookDeliveries(ctx, q, task, status, at)
}

// TaskDisplayName 用户可读的任务名称，画布来源显示为无限画布而不是文生图。
func TaskDisplayName(task *store.Task) string {
	return taskNotifyName(task)
}

func taskNotifyName(task *store.Task) string {
	if task == nil {
		return "图片生成"
	}
	source := stringParam(task.Params, "_source")
	kind := stringParam(task.Params, "_kind")
	if source == "react_canvas" || strings.HasPrefix(kind, "canvas-") || store.IsCanvasOrigin(task.Params) {
		if kind == "canvas-background-remove" {
			return "画布去背"
		}
		return "无限画布"
	}
	switch task.Type {
	case "t2i":
		return "文生图"
	case "coloring":
		return "插画染色"
	case "ui_design":
		return "UI 设计稿"
	case "ecommerce_design":
		return "AI 电商"
	case "model_sheet":
		return "模型设计"
	case "game_art":
		return "游戏设计"
	case "puzzle":
		return "拼图"
	case "background_remove":
		return "背景移除"
	case "media_tool":
		if name := stringParam(task.Params, "_modelDisplayName"); name != "" {
			return name
		}
		return "媒体工具"
	case "assistant":
		return "AI 助手"
	default:
		return "图片生成"
	}
}

// NotifyTaskSucceeded 主事务提交后尽力而为发通知，失败仅日志（M4 解耦）。
func NotifyTaskSucceeded(ctx context.Context, q store.Q, task *store.Task, imageCount int) {
	name := taskNotifyName(task)
	unit := "张图片"
	if task != nil && task.Type == "media_tool" {
		unit = "个结果"
	}
	body := fmt.Sprintf("%s已生成 %d %s。", name, imageCount, unit)
	if err := store.InsertNotification(ctx, q, &task.UserID, "task", name+"已完成", &body); err != nil {
		log.Printf("notify task %s succeeded: %v", task.ID, err)
	}
}

// NotifyTaskFailed 主事务提交后尽力而为发通知，失败仅日志（M4 解耦）。
func NotifyTaskFailed(ctx context.Context, q store.Q, task *store.Task) {
	name := taskNotifyName(task)
	body := name + "执行失败，费用已退回。"
	if err := store.InsertNotification(ctx, q, &task.UserID, "task", name+"失败", &body); err != nil {
		log.Printf("notify task %s failed: %v", task.ID, err)
	}
}

var generatedCountPattern = regexp.MustCompile(`已生成\s*(\d+)\s*张`)

// ApplyTaskNotificationDisplay 把历史「t2i」通知改成可读任务名（无限画布 / 文生图）。
func ApplyTaskNotificationDisplay(n *store.Notification, task *store.Task) {
	if n == nil || task == nil {
		return
	}
	name := taskNotifyName(task)
	title := strings.TrimSpace(n.Title)
	body := ""
	if n.Body != nil {
		body = *n.Body
	}
	switch {
	case (task.ErrorCode != nil && *task.ErrorCode == "user_canceled") || strings.Contains(title, "主动停止") || strings.Contains(body, "主动停止"):
		n.Title = name + "已主动停止"
		text := "你已主动停止" + name + "任务。任务尚未提交，冻结积分已退回。"
		if task.StartedAt != nil {
			text = "你已主动停止" + name + "任务。任务已提交，按本次预留积分结算，不按失败退款，也不会发放失败补偿。"
		}
		n.Body = &text
	case strings.Contains(title, "取消") || strings.Contains(body, "取消"):
		n.Title = name + "已取消"
		text := name + "已被管理员取消，费用已退回。"
		n.Body = &text
	case strings.Contains(title, "失败") || strings.Contains(body, "失败"):
		n.Title = name + "失败"
		text := name + "执行失败，费用已退回。"
		n.Body = &text
	default:
		n.Title = name + "已完成"
		if match := generatedCountPattern.FindStringSubmatch(body); len(match) == 2 {
			text := fmt.Sprintf("%s已生成 %s 张图片。", name, match[1])
			n.Body = &text
		} else {
			text := name + "已生成图片。"
			n.Body = &text
		}
	}
}

// FailQueuedEnqueue C1 入队失败补偿：条件更新 queued→failed（enqueue_failed）+ release，
// 单事务；事务提交后尽力而为通知属主。返回是否抢到迁移。
func FailQueuedEnqueue(ctx context.Context, st *store.Store, taskID uuid.UUID) (bool, error) {
	return FailQueuedTask(ctx, st, taskID, "enqueue_failed", "任务入队失败，费用已退回，请重试")
}

// FailQueuedTask atomically terminates a queued task and releases its frozen
// balance. It is used for permanent pre-execution errors so MaxRetry(0) queue
// records can never leave paid work frozen indefinitely.
func FailQueuedTask(ctx context.Context, st *store.Store, taskID uuid.UUID, errorCode, errorMessage string) (bool, error) {
	var task *store.Task
	won := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetTask(ctx, tx, taskID)
		if err != nil || t == nil {
			return err
		}
		task = t
		won, err = MarkFailed(ctx, tx, t, errorCode, errorMessage, "queued")
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
		cleanupKeys := append([]string(nil), t.OutputKeys...)
		cleanupKeys = append(cleanupKeys, t.ThumbnailKeys...)
		cleanupKeys = store.WithDisplayKeys(cleanupKeys)
		if err := store.EnqueueObjectCleanup(ctx, tx, cleanupKeys); err != nil {
			return err
		}
		ok, err := store.RequeueTask(ctx, tx, taskID)
		if err != nil {
			return err
		}
		if !ok {
			return apperr.E("task_not_cancelable", "仅失败任务可以重新入队", 400)
		}
		if t.CostCents > 0 {
			feature, _ := trialfeature.ForTask(t.Type, t.Params)
			if _, err := wallet.FreezeForTask(ctx, tx, t.UserID, taskID, t.CostCents, feature.Key, strPtr("任务重跑冻结")); err != nil {
				return err
			}
		}
		task, err = store.GetTask(ctx, tx, taskID)
		return err
	})
	return task, err
}
