package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func (w *Worker) assistantWorkspaceToolRegistry() (*assistanttools.Registry, []sub2api.FunctionTool, error) {
	registry, err := assistanttools.NewRegistry(assistanttools.NewWorkspaceActionManifest())
	if err != nil {
		return nil, nil, err
	}
	definitions, err := registry.Definitions(assistanttools.WorkspaceToolNames())
	if err != nil {
		return nil, nil, err
	}
	return registry, definitions, nil
}

func (w *Worker) runAssistantAgentWorkspaceTool(
	ctx context.Context,
	run *store.AssistantRun,
	registry *assistanttools.Registry,
	call *sub2api.ToolCall,
) (string, []map[string]any, error) {
	if run == nil || registry == nil || call == nil || !registry.Has(call.Name) || strings.TrimSpace(call.Arguments) == "" {
		return "", nil, errors.New("工具参数无效")
	}
	requestID := strings.TrimSpace(call.ID)
	if requestID == "" {
		requestID = newAssistantToolRequestID()
	}
	arguments := assistantToolArguments(call.Arguments)
	_ = store.UpsertAgentToolStepClaim(ctx, w.St.Pool, run.ID, requestID, call.Name, arguments, "server", false)
	var tracedResult json.RawMessage
	var tracedError string
	defer func() {
		traceCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = store.CompleteAgentToolStep(traceCtx, w.St.Pool, run.ID, requestID, tracedResult, tracedError, time.Now().UTC())
	}()

	if err := w.setAssistantRunStage(ctx, run, "agent", "tool_action"); err != nil {
		tracedError = err.Error()
		return "", nil, err
	}
	pendingTool := map[string]any{
		"requestId": requestID, "name": call.Name, "arguments": call.Arguments,
		"execution": "server", "status": "running", "stage": "tool_action",
	}
	if err := store.MergeAssistantMessageMetadata(ctx, w.St.Pool, run.AssistantMessageID, map[string]any{
		"pendingTool": pendingTool, "statusStage": "tool_action",
	}); err != nil {
		tracedError = err.Error()
		return "", nil, err
	}
	defer func() {
		_, _ = store.ClearAssistantMessagePendingTool(context.Background(), w.St.Pool, run.AssistantMessageID, requestID)
	}()
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind: "agent", Stage: "tool_action",
		Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: call.Name, Arguments: call.Arguments, Execution: "server", Status: "running"},
	})

	result, err := registry.Execute(ctx, call.Name, assistanttools.Invocation{
		UserID: run.UserID, RunID: run.ID, AssistantMessageID: run.AssistantMessageID,
		Arguments: json.RawMessage(call.Arguments),
		Permissions: map[assistanttools.Permission]bool{
			assistanttools.PermissionWebRead:       true,
			assistanttools.PermissionActionsCreate: true,
		},
	})
	if err != nil {
		message := truncateForModel(err.Error(), 1000)
		tracedError = message
		assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
			Kind: "agent", Stage: "tool_action",
			Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: call.Name, Arguments: call.Arguments, Execution: "server", Status: "failed", Error: message},
		})
		return "", nil, fmt.Errorf("执行 %s 失败：%s", call.Name, message)
	}
	tracedResult = json.RawMessage(result.Content)
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind: "agent", Stage: "tool_action",
		Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: call.Name, Arguments: call.Arguments, Execution: "server", Status: "completed", Result: json.RawMessage(result.Content)},
	})
	actions := assistantToolActionMaps(result.Meta["toolActions"])
	return "工具 " + call.Name + " 的真实执行结果：\n" + result.Content + "\n请用自然语言简短说明结果。若结果包含 action，只能告诉用户可以在下方操作卡确认，不能声称已跳转、已导入、已处理或已扣费。", actions, nil
}

func assistantToolActionMaps(value any) []map[string]any {
	if typed, ok := value.([]map[string]any); ok {
		return typed
	}
	items, _ := value.([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func assistantForcedWorkspaceTool(prompt string) string {
	text := strings.ToLower(strings.TrimSpace(prompt))
	containsAny := func(values ...string) bool {
		for _, value := range values {
			if strings.Contains(text, value) {
				return true
			}
		}
		return false
	}
	switch {
	case containsAny("网页截图", "网站截图", "截取网页", "capture webpage", "website screenshot"):
		return assistanttools.ToolWebpageCapture
	case containsAny("搜索图片", "找参考图", "找些参考图", "找一些参考图", "图片素材", "image search") || (strings.Contains(text, "参考图") && containsAny("找", "搜索", "寻找", "缺少")):
		return assistanttools.ToolImageSearch
	case containsAny("导入商品链接", "导入商品页", "商品链接导入", "product import"):
		return assistanttools.ToolProductImport
	case containsAny("导出交付包", "打包交付", "打包所有图片", "delivery export"):
		return assistanttools.ToolDeliveryExport
	case containsAny("参考图复刻", "复刻参考图", "照这个图做工作流", "reference rebuild"):
		return assistanttools.ToolReferenceRebuild
	case containsAny("发送到无限画布", "发到无限画布", "发送到ai电商", "发送到 ai 电商", "send to workspace"):
		return assistanttools.ToolSendToWorkspace
	case containsAny("抠图", "移除背景", "压缩图片", "高清放大", "图片裁剪", "切图"):
		return assistanttools.ToolMediaAction
	}
	return ""
}
