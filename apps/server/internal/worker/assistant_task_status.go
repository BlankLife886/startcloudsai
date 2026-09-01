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

func (w *Worker) assistantTaskStatusRegistry() (*assistanttools.Registry, sub2api.FunctionTool, error) {
	registry, err := assistanttools.NewRegistry(assistanttools.NewTaskStatusManifest(w.St.Pool))
	if err != nil {
		return nil, sub2api.FunctionTool{}, err
	}
	definitions, err := registry.Definitions([]string{assistanttools.ToolTaskStatus})
	if err != nil || len(definitions) != 1 {
		if err == nil {
			err = errors.New("task status tool definition is unavailable")
		}
		return nil, sub2api.FunctionTool{}, err
	}
	return registry, definitions[0], nil
}

func (w *Worker) runAssistantAgentTaskStatus(
	ctx context.Context,
	run *store.AssistantRun,
	registry *assistanttools.Registry,
	call *sub2api.ToolCall,
) (string, error) {
	if run == nil || registry == nil || call == nil || strings.TrimSpace(call.Arguments) == "" {
		return "", errors.New("查询任务状态的参数无效")
	}
	requestID := strings.TrimSpace(call.ID)
	if requestID == "" {
		requestID = newAssistantToolRequestID()
	}
	arguments := assistantToolArguments(call.Arguments)
	_ = store.UpsertAgentToolStepClaim(ctx, w.St.Pool, run.ID, requestID, assistanttools.ToolTaskStatus, arguments, "server", false)
	var tracedResult json.RawMessage
	var tracedError string
	defer func() {
		traceCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = store.CompleteAgentToolStep(traceCtx, w.St.Pool, run.ID, requestID, tracedResult, tracedError, time.Now().UTC())
	}()

	if err := w.setAssistantRunStage(ctx, run, "agent", "task_status"); err != nil {
		tracedError = err.Error()
		return "", err
	}
	pendingTool := map[string]any{
		"requestId": requestID, "name": assistanttools.ToolTaskStatus, "arguments": call.Arguments,
		"execution": "server", "status": "running", "stage": "task_status",
	}
	if err := store.MergeAssistantMessageMetadata(ctx, w.St.Pool, run.AssistantMessageID, map[string]any{
		"pendingTool": pendingTool, "statusStage": "task_status",
	}); err != nil {
		tracedError = err.Error()
		return "", err
	}
	defer func() {
		_, _ = store.ClearAssistantMessagePendingTool(context.Background(), w.St.Pool, run.AssistantMessageID, requestID)
	}()
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind: "agent", Stage: "task_status",
		Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: assistanttools.ToolTaskStatus, Arguments: call.Arguments, Execution: "server", Status: "running"},
	})

	result, err := registry.Execute(ctx, assistanttools.ToolTaskStatus, assistanttools.Invocation{
		UserID: run.UserID, RunID: run.ID, AssistantMessageID: run.AssistantMessageID,
		Arguments:   json.RawMessage(call.Arguments),
		Permissions: map[assistanttools.Permission]bool{assistanttools.PermissionTasksRead: true},
	})
	if err != nil {
		message := truncateForModel(err.Error(), 800)
		tracedError = message
		assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
			Kind: "agent", Stage: "task_status",
			Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: assistanttools.ToolTaskStatus, Arguments: call.Arguments, Execution: "server", Status: "failed", Error: message},
		})
		return "", fmt.Errorf("查询任务状态失败：%s", message)
	}
	tracedResult = json.RawMessage(result.Content)
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind: "agent", Stage: "task_status",
		Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: assistanttools.ToolTaskStatus, Arguments: call.Arguments, Execution: "server", Status: "completed", Result: json.RawMessage(result.Content)},
	})
	return "工具 task_status 返回的当前用户真实任务状态：\n" + result.Content + "\n请用自然语言解释，不要显示或猜测任何内部任务 ID、线路、端点或密钥。", nil
}

func newAssistantToolRequestID() string {
	return fmt.Sprintf("tool-%d", time.Now().UTC().UnixNano())
}
