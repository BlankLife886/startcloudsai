package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/google/uuid"
)

type canvasReviewTarget struct {
	Kind      string   `json:"kind"`
	RequestID string   `json:"requestId"`
	RunID     string   `json:"runId,omitempty"`
	NodeIDs   []string `json:"nodeIds"`
}
type canvasReviewVerdict struct {
	Status      string   `json:"status"`
	Issues      []string `json:"issues"`
	Suggestions []string `json:"suggestions"`
}

func decodeCanvasReviewVerdict(text string) canvasReviewVerdict {
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(strings.TrimPrefix(text, "```json"), "```")
	text = strings.TrimSuffix(text, "```")
	var result canvasReviewVerdict
	if json.Unmarshal([]byte(strings.TrimSpace(text)), &result) != nil || (result.Status != "pass" && result.Status != "needs_changes" && result.Status != "unverified") {
		return canvasReviewVerdict{Status: "unverified", Issues: []string{"模型没有返回可验证的验收结论"}}
	}
	if len(result.Issues) > 0 && result.Status == "pass" {
		result.Status = "needs_changes"
	}
	return result
}

func requestCanvasReview(ctx context.Context, client *sub2api.Client, messages []sub2api.Message) canvasReviewVerdict {
	answer, err := client.ChatTextWithImages(ctx, messages, nil, nil)
	if err != nil {
		return canvasReviewVerdict{Status: "unverified", Issues: []string{"验收模型暂时不可用"}}
	}
	return decodeCanvasReviewVerdict(answer)
}

// Waiting is read-only. Network loss never resubmits a generation or renews a workflow lease.
func waitCanvasReview(ctx context.Context, read func() (string, error), pause func(context.Context) error) (string, error) {
	failures := 0
	for {
		if err := ctx.Err(); err != nil {
			return "unverified", err
		}
		status, err := read()
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "unverified", err
		}
		if err != nil || status == "unknown" {
			failures++
			if failures >= 3 {
				return "unverified", nil
			}
		} else {
			failures = 0
		}
		if err == nil && (status == "succeeded" || status == "failed" || status == "canceled") {
			return status, nil
		}
		if err = pause(ctx); err != nil {
			return "unverified", err
		}
	}
}

func (w *Worker) reviewCanvasAgentOutputs(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, loop *canvasAgentLoopState) string {
	if len(loop.reviewTargets) == 0 {
		return ""
	}
	_ = store.MergeAssistantMessageMetadata(ctx, w.St.Pool, run.AssistantMessageID, map[string]any{"canvasReviewStarted": true, "canvasReviewTargets": loop.reviewTargets})
	reviewCtx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()
	var canvas struct {
		ProjectID string `json:"projectId"`
	}
	encoded, _ := json.Marshal(run.Params["canvasSnapshot"])
	_ = json.Unmarshal(encoded, &canvas)
	projectID, projectErr := uuid.Parse(canvas.ProjectID)
	lines := []string{}
	allVerified := true
	baselineImages, baselineErr := w.loadAssistantReferences(reviewCtx, run.Params)
	if baselineErr != nil {
		allVerified = false
		lines = append(lines, "原始参考图未能读取，无法确认参考一致性。")
	}
	for _, target := range loop.reviewTargets {
		_ = w.setAssistantRunStage(ctx, run, "agent", "reviewing")
		fingerprints := map[string]string{}
		status, err := waitCanvasReview(reviewCtx, func() (string, error) {
			if stopped, e := w.assistantRunTerminated(reviewCtx, run.ID); e != nil || stopped {
				if e == nil {
					e = context.Canceled
				}
				return "unknown", e
			}
			if target.Kind == "workflow" && target.RunID != "" && projectErr == nil {
				id, e := uuid.Parse(target.RunID)
				if e != nil {
					return "unknown", e
				}
				workflow, e := store.GetUserCanvasWorkflowRun(reviewCtx, w.St.Pool, run.UserID, projectID, id)
				if e != nil || workflow == nil {
					return "unknown", fmt.Errorf("工作流运行记录暂时不可读")
				}
				var metrics []struct {
					NodeID            string `json:"nodeId"`
					OutputFingerprint string `json:"outputFingerprint"`
				}
				_ = json.Unmarshal(workflow.NodeMetrics, &metrics)
				for _, metric := range metrics {
					if metric.OutputFingerprint != "" {
						fingerprints[metric.NodeID] = metric.OutputFingerprint
					}
				}
				return workflow.Status, nil
			}
			name := "canvas_generation_status"
			if target.Kind == "workflow" {
				name = "canvas_workflow_status"
			}
			args, _ := json.Marshal(map[string]any{"requestId": target.RequestID, "waitSeconds": 20})
			raw, ok := w.dispatchCanvasTool(reviewCtx, run, name, string(args), canvasAgentStatusTimeout)
			if !ok || canvasAgentToolResultFailed(raw) {
				return "unknown", fmt.Errorf("画布状态暂时无法读取")
			}
			var result struct {
				Status string `json:"status"`
				Tasks  []struct {
					Status string `json:"status"`
				} `json:"tasks"`
			}
			if json.Unmarshal([]byte(raw), &result) != nil {
				return "unknown", nil
			}
			if target.Kind == "workflow" {
				return result.Status, nil
			}
			if len(result.Tasks) == 0 {
				return "unknown", nil
			}
			final := "succeeded"
			for _, task := range result.Tasks {
				if task.Status == "failed" || task.Status == "canceled" || task.Status == "unknown" {
					return task.Status, nil
				}
				if task.Status != "succeeded" {
					final = "running"
				}
			}
			return final, nil
		}, func(ctx context.Context) error {
			timer := time.NewTimer(2 * time.Second)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		})
		if err != nil || status != "succeeded" {
			allVerified = false
			lines = append(lines, fmt.Sprintf("任务状态：%s。结果尚未通过验收；没有自动重跑，请查看画布任务记录。", status))
			continue
		}
		for offset, pages := 0, 0; pages < 64; pages++ {
			args := map[string]any{"nodeIds": target.NodeIDs, "offset": offset, "fingerprints": fingerprints}
			if target.Kind == "generation" {
				args["requestId"] = target.RequestID
			}
			data, _ := json.Marshal(args)
			raw, ok := w.dispatchCanvasTool(reviewCtx, run, "canvas_review_outputs", string(data), canvasAgentStatusTimeout)
			if !ok || canvasAgentToolResultFailed(raw) {
				allVerified = false
				lines = append(lines, "生成已结束，但结果读取中断，验收未完成；可以重新打开画布后继续检查。")
				break
			}
			var page struct {
				Total            int                          `json:"total"`
				NextOffset       *int                         `json:"nextOffset"`
				Issues           []string                     `json:"issues"`
				ImageNodeIDs     []string                     `json:"imageNodeIds"`
				VisionReferences []canvasAgentVisualReference `json:"visionReferences"`
			}
			if json.Unmarshal([]byte(raw), &page) != nil || page.Total == 0 {
				allVerified = false
				lines = append(lines, "没有读取到可验收的产物。")
				break
			}
			messages := []sub2api.Message{{Role: "system", Content: "你是生成结果验收员。依据原始要求、实际产物文字/像素和确定性校验检查完整性、内容一致性、明显瑕疵。不要执行工具或生成新图片，不要声称检查了未提供的内容。输出纯JSON：{\"status\":\"pass|needs_changes|unverified\",\"issues\":[具体问题],\"suggestions\":[可执行修正建议]}。中文。没有读到像素时视觉质量必须标为unverified。"}, {Role: "user", Content: "原始要求：\n" + run.Prompt + "\n本页产物检查：\n" + raw}}
			if len(baselineImages) > 0 {
				messages = append(messages, sub2api.Message{Role: "user", Content: "这些是用户原始参考图，用于检查主体与品牌一致性。", ReferenceImages: baselineImages})
			}
			if len(lines) > 0 {
				messages = append(messages, sub2api.Message{Role: "user", Content: "此前已检查页面的结论，请同时关注跨页一致性：\n" + strings.Join(lines, "\n")})
			}
			if len(page.ImageNodeIDs) > 0 {
				visualLoop := canvasAgentLoopState{visualReferences: page.VisionReferences, visualInspected: true}
				visual := w.consumeCanvasAgentVisualContext(reviewCtx, run, &visualLoop)
				if visual == nil || !visualLoop.visualInspected {
					allVerified = false
					lines = append(lines, "本页真实图片未能完整读取，视觉验收未完成。")
					break
				}
				messages = append(messages, *visual)
			}
			verdict := requestCanvasReview(reviewCtx, client, messages)
			verdict.Issues = append(page.Issues, verdict.Issues...)
			if len(verdict.Issues) > 0 && verdict.Status == "pass" {
				verdict.Status = "needs_changes"
			}
			if verdict.Status != "pass" {
				allVerified = false
			}
			label := "通过"
			if verdict.Status == "needs_changes" {
				label = "需要修改"
			}
			if verdict.Status == "unverified" {
				label = "未完成"
			}
			line := fmt.Sprintf("第 %d 页验收：%s。", offset/4+1, label)
			if len(verdict.Issues) > 0 {
				line += "问题：" + strings.Join(verdict.Issues, "；") + "。"
			}
			if len(verdict.Suggestions) > 0 {
				line += "建议：" + strings.Join(verdict.Suggestions, "；") + "。"
			}
			lines = append(lines, line)
			if page.NextOffset == nil {
				break
			}
			if pages == 63 {
				allVerified = false
				lines = append(lines, "产物较多，已达到本轮自动验收页数上限，其余结果尚未验收。")
				break
			}
			if *page.NextOffset <= offset {
				allVerified = false
				break
			}
			offset = *page.NextOffset
		}
	}
	status := "needs_review"
	if allVerified {
		status = "passed"
	}
	loop.reviewReport = map[string]any{"status": status, "details": lines}
	_ = store.MergeAssistantMessageMetadata(ctx, w.St.Pool, run.AssistantMessageID, map[string]any{"canvasReviewCompleted": true, "canvasReview": loop.reviewReport})
	return "\n\n结果验收：\n" + strings.Join(lines, "\n")
}
