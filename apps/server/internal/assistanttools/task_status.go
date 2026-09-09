package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const ToolTaskStatus = "task_status"

var (
	taskStatusUUIDPattern   = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`)
	taskStatusURLPattern    = regexp.MustCompile(`(?i)https?://[^\s]+`)
	taskStatusSecretPattern = regexp.MustCompile(`(?i)\b(?:sk|key|token|bearer)[-_a-z0-9]{12,}\b`)
	taskStatusHeaderPattern = regexp.MustCompile(`(?i)\b(?:api[_ -]?key|authorization|bearer|token)\s*[:=]?\s+[A-Za-z0-9._-]{8,}`)
	taskStatusRoutePattern  = regexp.MustCompile(`(?i)\b(?:provider|route|endpoint|base[_ -]?url)\s*[:=]\s*[^\s,;]+`)
	taskStatusOpaquePattern = regexp.MustCompile(`\b[A-Za-z0-9_-]{32,}\b`)
)

type taskStatusInput struct {
	Scope  string `json:"scope"`
	Limit  int    `json:"limit"`
	TaskID string `json:"task_id"`
}

type taskStatusCandidate struct {
	createdAt time.Time
	task      *store.Task
	run       *store.AssistantRun
}

func NewTaskStatusManifest(q store.Q) Manifest {
	return Manifest{
		ID: "task-status", Version: "1.0.0", Description: "Read the current user's generation status",
		Tools: []Definition{{
			Name:        ToolTaskStatus,
			Description: "查看当前用户自己的站内任务和 AI 助手任务状态，包括真实阶段、耗时、重试、失败原因、扣费或退款状态。用户询问任务为什么还在运行、是否重试、为什么失败、是否退款时使用。不要向用户显示内部任务 ID、线路、端点或密钥。",
			InputSchema: map[string]any{
				"type": "object", "additionalProperties": false,
				"properties": map[string]any{
					"scope":   map[string]any{"type": "string", "enum": []string{"active", "latest", "failed"}, "description": "active=进行中，latest=最近任务，failed=最近失败或取消"},
					"limit":   map[string]any{"type": "integer", "minimum": 1, "maximum": 5},
					"task_id": map[string]any{"type": "string", "maxLength": 80, "description": "仅当用户自己提供了任务 ID 时填写；否则留空"},
				},
				"required": []string{"scope", "limit", "task_id"},
			},
			Permissions: []Permission{PermissionTasksRead}, Risk: RiskRead,
			Timeout: 8 * time.Second, MaxResultBytes: 48 << 10, Strict: true,
			Execute: taskStatusExecutor(q),
		}},
	}
}

// TaskStatusRequested identifies explicit user requests about their own live or
// recent generation work. It intentionally avoids generic product questions.
func TaskStatusRequested(prompt string) bool {
	text := strings.ToLower(strings.TrimSpace(prompt))
	if text == "" {
		return false
	}
	statusTerms := []string{"进度", "状态", "失败", "报错", "错误", "重试", "退款", "扣费", "积分", "排队", "运行中", "卡住", "还在跑", "还在转", "多久", "取消", "完成了吗", "为什么慢"}
	hasStatus := false
	for _, term := range statusTerms {
		if strings.Contains(text, term) {
			hasStatus = true
			break
		}
	}
	if !hasStatus {
		return false
	}
	if strings.Contains(text, "任务") {
		return true
	}
	for _, subject := range []string{"我的任务", "这条任务", "刚才的任务", "最近任务", "任务id", "任务 id", "任务编号", "生成任务", "生图", "图片", "那张图", "这张图", "生成"} {
		if strings.Contains(text, subject) {
			return true
		}
	}
	return false
}

func taskStatusExecutor(q store.Q) Executor {
	return func(ctx context.Context, invocation Invocation) (Result, error) {
		var in taskStatusInput
		if err := decodeArguments(invocation.Arguments, &in); err != nil {
			return Result{}, err
		}
		in.Scope = strings.ToLower(strings.TrimSpace(in.Scope))
		if in.Scope != "active" && in.Scope != "latest" && in.Scope != "failed" {
			return Result{}, errors.New("scope must be active, latest, or failed")
		}
		in.Limit = min(max(in.Limit, 1), 5)

		candidates, err := taskStatusCandidates(ctx, q, invocation, in)
		if err != nil {
			return Result{}, err
		}
		items := make([]map[string]any, 0, len(candidates))
		for index, candidate := range candidates {
			var item map[string]any
			if candidate.task != nil {
				item, err = renderTaskStatus(ctx, q, invocation.UserID, candidate.task)
			} else {
				item, err = renderAssistantRunStatus(ctx, q, invocation.UserID, candidate.run)
			}
			if err != nil {
				return Result{}, err
			}
			item["task_number"] = index + 1
			items = append(items, item)
		}

		message := "已找到任务状态。"
		if len(items) == 0 {
			switch in.Scope {
			case "active":
				message = "当前没有正在排队或运行的任务。"
			case "failed":
				message = "最近没有失败或取消的任务。"
			default:
				message = "暂时没有可查询的最近任务。"
			}
		}
		return jsonResult(map[string]any{
			"scope": in.Scope, "message": message, "tasks": items,
			"privacy":      "内部任务编号、上游线路、端点和密钥已隐藏",
			"generated_at": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func taskStatusCandidates(ctx context.Context, q store.Q, invocation Invocation, in taskStatusInput) ([]taskStatusCandidate, error) {
	if rawID := strings.TrimSpace(in.TaskID); rawID != "" {
		id, err := uuid.Parse(rawID)
		if err != nil {
			return nil, errors.New("task_id is invalid")
		}
		if task, err := store.GetUserTask(ctx, q, invocation.UserID, id); err != nil {
			return nil, err
		} else if task != nil {
			return []taskStatusCandidate{{createdAt: task.CreatedAt, task: task}}, nil
		}
		if run, err := store.GetUserAssistantRun(ctx, q, invocation.UserID, id); err != nil {
			return nil, err
		} else if run != nil && run.ID != invocation.RunID {
			return []taskStatusCandidate{{createdAt: run.CreatedAt, run: run}}, nil
		}
		return nil, errors.New("没有找到属于当前用户的这条任务")
	}

	fetchLimit := max(20, in.Limit*6)
	tasks, err := store.ListRecentTasks(ctx, q, invocation.UserID, fetchLimit)
	if err != nil {
		return nil, err
	}
	runs, err := store.ListRecentUserAssistantRuns(ctx, q, invocation.UserID, fetchLimit)
	if err != nil {
		return nil, err
	}
	candidates := make([]taskStatusCandidate, 0, len(tasks)+len(runs))
	seen := make(map[uuid.UUID]bool, len(tasks)+len(runs))
	for _, task := range tasks {
		if task != nil && taskStatusMatchesScope(task.Status, in.Scope) {
			candidates = append(candidates, taskStatusCandidate{createdAt: task.CreatedAt, task: task})
			seen[task.ID] = true
		}
	}
	for _, run := range runs {
		if run != nil && run.ID != invocation.RunID && !seen[run.ID] && taskStatusMatchesScope(run.Status, in.Scope) {
			candidates = append(candidates, taskStatusCandidate{createdAt: run.CreatedAt, run: run})
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].createdAt.After(candidates[j].createdAt) })
	if len(candidates) > in.Limit {
		candidates = candidates[:in.Limit]
	}
	return candidates, nil
}

func taskStatusMatchesScope(status, scope string) bool {
	status = strings.ToLower(strings.TrimSpace(status))
	switch scope {
	case "active":
		return status == "queued" || status == "running"
	case "failed":
		return status == "failed" || status == "canceled" || status == "cancelled"
	default:
		return true
	}
}

func renderTaskStatus(ctx context.Context, q store.Q, userID uuid.UUID, task *store.Task) (map[string]any, error) {
	stage := generationTaskStage(task)
	billing, err := taskStatusBilling(ctx, q, userID, "task", task.ID, task.Status, task.CostCents)
	if err != nil {
		return nil, err
	}
	item := baseTaskStatus(task.Status, stage, task.Type, task.Model, task.Params, task.Prompt,
		task.Count, len(task.OutputKeys), task.Attempt, task.CreatedAt, task.StartedAt, task.FinishedAt)
	item["billing"] = billing
	if task.ErrorMessage != nil && strings.TrimSpace(*task.ErrorMessage) != "" {
		item["failure_reason"] = safeTaskStatusText(*task.ErrorMessage, 600)
	}
	events, err := store.ListTaskTimeline(ctx, q, task.ID)
	if err != nil {
		return nil, err
	}
	if timeline := safeTaskTimeline(events); len(timeline) > 0 {
		item["timeline"] = timeline
	}
	return item, nil
}

func renderAssistantRunStatus(ctx context.Context, q store.Q, userID uuid.UUID, run *store.AssistantRun) (map[string]any, error) {
	cost := run.CostCents
	if cost <= 0 && (run.Status == "queued" || run.Status == "running") {
		cost = run.ReservedCents
	}
	billing, err := taskStatusBilling(ctx, q, userID, "assistant_run", run.ID, run.Status, cost)
	if err != nil {
		return nil, err
	}
	kind := run.ResolvedMode
	if kind == "" {
		kind = run.Mode
	}
	count := taskStatusParamInt(run.Params, "count", 1)
	completed := 0
	if run.Status == "succeeded" && kind == "image" {
		completed = count
	}
	item := baseTaskStatus(run.Status, run.Stage, kind, "", run.Params, run.Prompt,
		count, completed, max(run.Attempt-1, 0), run.CreatedAt, run.StartedAt, run.FinishedAt)
	item["billing"] = billing
	if run.QueuePosition > 0 && run.Status == "queued" {
		item["queue_position"] = run.QueuePosition
	}
	if run.ErrorMessage != nil && strings.TrimSpace(*run.ErrorMessage) != "" {
		item["failure_reason"] = safeTaskStatusText(*run.ErrorMessage, 600)
	}
	return item, nil
}

func baseTaskStatus(status, stage, kind, model string, params map[string]any, prompt string, requested, completed, retryCount int, createdAt time.Time, startedAt, finishedAt *time.Time) map[string]any {
	now := time.Now().UTC()
	end := now
	if finishedAt != nil {
		end = *finishedAt
	}
	item := map[string]any{
		"kind": taskStatusKindLabel(kind), "status": taskStatusStatusLabel(status),
		"stage": taskStatusStageLabel(stage, status), "created_at": createdAt.UTC().Format(time.RFC3339),
		"total_elapsed_seconds": max(int(end.Sub(createdAt).Seconds()), 0),
		"retry_count":           max(retryCount, 0), "requested_outputs": max(requested, 1),
		"completed_outputs": max(completed, 0),
	}
	if text := safeTaskStatusText(prompt, 180); text != "" {
		item["request_summary"] = text
	}
	if display := taskStatusModelDisplay(model, params); display != "" {
		item["model"] = display
	}
	if startedAt != nil {
		item["queue_wait_seconds"] = max(int(startedAt.Sub(createdAt).Seconds()), 0)
		item["processing_seconds"] = max(int(end.Sub(*startedAt).Seconds()), 0)
	} else {
		item["queue_wait_seconds"] = max(int(end.Sub(createdAt).Seconds()), 0)
	}
	return item
}

func taskStatusBilling(ctx context.Context, q store.Q, userID uuid.UUID, sourceType string, id uuid.UUID, status string, points int64) (string, error) {
	var spendCount, releaseCount int
	err := q.QueryRow(ctx, `SELECT
		count(*) FILTER (WHERE kind = 'spend'),
		count(*) FILTER (WHERE kind = 'release')
		FROM wallet_ledger
		WHERE user_id = $1 AND source_type = $2
		AND (source_id = $3 OR source_id LIKE $4)`,
		userID, sourceType, id.String(), id.String()+"/%").Scan(&spendCount, &releaseCount)
	if err != nil {
		return "", err
	}
	status = strings.ToLower(strings.TrimSpace(status))
	if spendCount > 0 {
		return fmt.Sprintf("已结算 %d 积分", max(points, 0)), nil
	}
	if releaseCount > 0 {
		return fmt.Sprintf("已退款或解冻 %d 积分", max(points, 0)), nil
	}
	if status == "queued" || status == "running" {
		return fmt.Sprintf("已预留 %d 积分，最终按结果结算", max(points, 0)), nil
	}
	return "未扣费", nil
}

func generationTaskStage(task *store.Task) string {
	if task == nil {
		return ""
	}
	switch task.Status {
	case "queued":
		return "queued"
	case "succeeded":
		return "completed"
	case "failed", "canceled", "cancelled":
		return task.Status
	}
	if stage, _ := task.Params["_generationStage"].(string); stage != "" {
		return stage
	}
	if len(task.OutputKeys) > 0 {
		return "saving_result"
	}
	if stage, _ := task.Params["_upstreamStage"].(string); stage == "async_pending" {
		return "upstream_generating"
	}
	return "upstream_generating"
}

func taskStatusStatusLabel(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "queued":
		return "排队中"
	case "running":
		return "进行中"
	case "succeeded":
		return "已完成"
	case "failed":
		return "失败"
	case "canceled", "cancelled":
		return "已取消"
	default:
		return "状态未知"
	}
}

func taskStatusStageLabel(stage, status string) string {
	if status == "failed" {
		return "任务失败"
	}
	if status == "canceled" || status == "cancelled" {
		return "任务已取消"
	}
	switch strings.ToLower(strings.TrimSpace(stage)) {
	case "queued":
		return "等待执行资源"
	case "preparing", "input_prepare", "routing", "dispatching":
		return "准备参数和参考图"
	case "thinking", "agent":
		return "分析需求"
	case "web_search":
		return "联网搜索"
	case "answering":
		return "生成回答"
	case "submitted", "generating-image", "upstream_generate", "upstream_generating", "async_pending":
		return "上游正在生成"
	case "fetching_result", "result_download":
		return "上游已完成，正在拉取结果"
	case "saving_result", "persisting":
		return "正在处理并保存结果"
	case "complete", "completed", "succeeded":
		return "处理完成"
	case "failed", "upstream_error":
		return "任务失败"
	case "stopped":
		return "任务已取消"
	default:
		if status == "queued" {
			return "等待执行资源"
		}
		if status == "running" {
			return "正在处理"
		}
		return taskStatusStatusLabel(status)
	}
}

func taskStatusKindLabel(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "t2i", "image", "text_to_image":
		return "图片生成"
	case "i2i", "image_edit", "ui_design":
		return "图片编辑"
	case "upscale":
		return "图片放大"
	case "crop":
		return "图片裁剪"
	case "ppt", "pptx":
		return "PPT 生成"
	case "psd":
		return "PSD 生成"
	case "chat", "agent":
		return "AI 助手"
	default:
		return "生成任务"
	}
}

func taskStatusModelDisplay(model string, params map[string]any) string {
	for _, key := range []string{"_modelDisplayName", "_imageModelDisplayName", "modelDisplayName"} {
		if value, _ := params[key].(string); strings.TrimSpace(value) != "" {
			return safeTaskStatusText(value, 80)
		}
	}
	model = strings.TrimSpace(model)
	if model == "" || taskStatusUUIDPattern.MatchString(model) || strings.Contains(model, "://") || len(model) > 80 {
		return ""
	}
	return safeTaskStatusText(model, 80)
}

func safeTaskTimeline(events []*store.TaskTimelineEvent) []map[string]any {
	if len(events) > 6 {
		events = events[len(events)-6:]
	}
	out := make([]map[string]any, 0, len(events))
	for _, event := range events {
		if event == nil {
			continue
		}
		item := map[string]any{
			"stage":  taskStatusStageLabel(event.Stage, event.Status),
			"status": event.Status, "at": event.CreatedAt.UTC().Format(time.RFC3339),
		}
		if message := safeTaskStatusText(event.Message, 300); message != "" {
			item["detail"] = message
		}
		if event.DurationMs != nil && *event.DurationMs >= 0 {
			item["duration_seconds"] = float64(*event.DurationMs) / 1000
		}
		out = append(out, item)
	}
	return out
}

func safeTaskStatusText(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	value = taskStatusURLPattern.ReplaceAllString(value, "[地址已隐藏]")
	value = taskStatusUUIDPattern.ReplaceAllString(value, "[编号已隐藏]")
	value = taskStatusSecretPattern.ReplaceAllString(value, "[密钥已隐藏]")
	value = taskStatusHeaderPattern.ReplaceAllString(value, "[认证信息已隐藏]")
	value = taskStatusRoutePattern.ReplaceAllString(value, "[线路信息已隐藏]")
	value = taskStatusOpaquePattern.ReplaceAllString(value, "[内部标识已隐藏]")
	if maxRunes > 0 && utf8.RuneCountInString(value) > maxRunes {
		runes := []rune(value)
		value = strings.TrimSpace(string(runes[:maxRunes])) + "…"
	}
	return value
}

func taskStatusParamInt(params map[string]any, key string, fallback int) int {
	switch value := params[key].(type) {
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		if parsed, err := value.Int64(); err == nil {
			return int(parsed)
		}
	}
	return fallback
}
