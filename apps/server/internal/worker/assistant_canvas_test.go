package worker

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestParseCanvasAgentOpsAcceptsWrappedJSON(t *testing.T) {
	summary, ops, err := parseCanvasAgentOps("```json\n{\"summary\":\"加一个提示词节点\",\"ops\":[{\"type\":\"add_node\",\"id\":\"text-1\",\"nodeType\":\"text\",\"x\":120,\"y\":80,\"title\":\"提示词\"}]}\n```")
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	if summary != "加一个提示词节点" || len(ops) != 1 || ops[0]["type"] != "add_node" || ops[0]["id"] != "text-1" {
		t.Fatalf("ops = %#v summary=%q", ops, summary)
	}
}

func TestParseCanvasAgentOpsAcceptsOperationsAliasAndNestedNode(t *testing.T) {
	summary, ops, err := parseCanvasAgentOps(`{"operations":[{"type":"add_node","node":{"id":"text-3","nodeType":"text","title":"提示词 | 电商主图生成模板"},"x":-900,"y":-1000}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	if len(ops) != 1 || ops[0]["type"] != "add_node" || ops[0]["id"] != "text-3" || ops[0]["nodeType"] != "text" {
		t.Fatalf("ops = %#v summary=%q", ops, summary)
	}
	if ops[0]["x"] != float64(-900) || ops[0]["y"] != float64(-1000) {
		t.Fatalf("position = %#v", ops[0])
	}
}

func TestParseCanvasAgentOpsRejectsUnknownType(t *testing.T) {
	_, ops, err := parseCanvasAgentOps(`{"summary":"x","ops":[{"type":"explode"},{"type":"select_nodes","ids":["n1"]}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	if len(ops) != 1 || ops[0]["type"] != "select_nodes" {
		t.Fatalf("ops = %#v", ops)
	}
}

func TestParseCanvasAgentToolResultUsesToolCallThenText(t *testing.T) {
	summary, ops, ok := parseCanvasAgentToolResult(sub2api.AgentChatResult{
		Text: "先加节点",
		ToolCall: &sub2api.ToolCall{
			Name:      "canvas_apply_ops",
			Arguments: `{"summary":"连接配置","ops":[{"type":"connect_nodes","fromNodeId":"a","toNodeId":"b"}]}`,
		},
	})
	if !ok || summary != "连接配置" || len(ops) != 1 || ops[0]["fromNodeId"] != "a" {
		t.Fatalf("tool call result = %q %#v %v", summary, ops, ok)
	}

	summary, ops, ok = parseCanvasAgentToolResult(sub2api.AgentChatResult{
		Text: `{"summary":"选中节点","ops":[{"type":"select_nodes","ids":["n1","n2"]}]}`,
	})
	if !ok || summary != "选中节点" || len(ops) != 1 {
		t.Fatalf("text fallback = %q %#v %v", summary, ops, ok)
	}
}

func TestCanvasAgentInstructionsIncludeSnapshot(t *testing.T) {
	run := &store.AssistantRun{Params: map[string]any{
		"workspace":      modelconfig.WorkspaceCanvas,
		"canvasSnapshot": map[string]any{"title": "测试画布", "nodes": []any{map[string]any{"id": "text-1"}}},
	}}
	instructions := canvasAgentInstructions(run)
	if !strings.Contains(instructions, "测试画布") || !strings.Contains(instructions, "text-1") {
		t.Fatalf("instructions = %q", instructions)
	}
	if !strings.Contains(instructions, "create_graph") || !strings.Contains(instructions, "connect_nodes") {
		t.Fatalf("instructions lack graph guidance = %q", instructions)
	}
	if strings.Contains(instructions, "x、y") == false {
		t.Fatalf("instructions must forbid coordinates = %q", instructions)
	}
}

func TestParseCanvasAgentOpsAcceptsGraphWithoutCoordinates(t *testing.T) {
	_, ops, err := parseCanvasAgentOps(`{"summary":"已创建工作流","ops":[{"type":"create_graph",
		"nodes":[{"key":"a","type":"text","text":"卖点提取","x":10},{"key":"b","type":"config"},{"key":"c","type":"image"}],
		"edges":[{"from":"a","to":"b"},["b","c"]]}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	if len(ops) != 1 || ops[0]["type"] != "create_graph" {
		t.Fatalf("ops = %#v", ops)
	}
	nodes, _ := ops[0]["nodes"].([]map[string]any)
	if len(nodes) != 3 || nodes[0]["key"] != "a" || nodes[0]["text"] != "卖点提取" || nodes[2]["type"] != "image" {
		t.Fatalf("nodes = %#v", nodes)
	}
	if _, hasX := nodes[0]["x"]; hasX {
		t.Fatalf("coordinates must be dropped: %#v", nodes[0])
	}
	edges, _ := ops[0]["edges"].([]map[string]any)
	if len(edges) != 2 || edges[0]["from"] != "a" || edges[1]["to"] != "c" {
		t.Fatalf("edges = %#v", edges)
	}
}

func TestParseCanvasAgentOpsDropsGraphWithoutNodes(t *testing.T) {
	_, _, err := parseCanvasAgentOps(`{"ops":[{"type":"create_graph","nodes":[]}]}`)
	if err == nil {
		t.Fatal("expected empty graph to be rejected")
	}
}

func TestParseCanvasAgentOpsAcceptsConnectAliases(t *testing.T) {
	_, ops, err := parseCanvasAgentOps(`{"ops":[{"type":"connect","from":"text-1","to":"config-1"}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	if len(ops) != 1 || ops[0]["type"] != "connect_nodes" || ops[0]["fromNodeId"] != "text-1" || ops[0]["toNodeId"] != "config-1" {
		t.Fatalf("ops = %#v", ops)
	}
}

func TestParseCanvasAgentOpsAcceptsGenerationFlow(t *testing.T) {
	_, ops, err := parseCanvasAgentOps(`{"ops":[{"type":"create_image_flow","prompt":"运动鞋主图","x":80,"y":40}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	if len(ops) != 1 || ops[0]["type"] != "create_generation_flow" || ops[0]["prompt"] != "运动鞋主图" {
		t.Fatalf("ops = %#v", ops)
	}
}

func TestParseCanvasAgentOpsAcceptsMoveAndResize(t *testing.T) {
	_, ops, err := parseCanvasAgentOps(`{"ops":[{"type":"move_nodes","items":[{"id":"text-1","dx":80,"dy":-20}]},{"type":"resize_node","id":"image-1","width":420,"height":480,"freeResize":true}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	if len(ops) != 2 {
		t.Fatalf("ops = %#v", ops)
	}
	if ops[0]["type"] != "move_nodes" {
		t.Fatalf("move type = %#v", ops[0]["type"])
	}
	items, _ := ops[0]["items"].([]map[string]any)
	if len(items) != 1 || items[0]["id"] != "text-1" || items[0]["dx"] != float64(80) || items[0]["dy"] != float64(-20) {
		t.Fatalf("move items = %#v", ops[0]["items"])
	}
	if ops[1]["type"] != "resize_node" || ops[1]["id"] != "image-1" || ops[1]["width"] != float64(420) || ops[1]["freeResize"] != true {
		t.Fatalf("resize = %#v", ops[1])
	}
}

func TestCanvasAgentWantsMutationAndRefusal(t *testing.T) {
	if !canvasAgentWantsMutation("创建一条生图流程并把它们连起来") {
		t.Fatal("expected mutation")
	}
	if !canvasAgentWantsMutation("从零搭一条电商主图工作流，搭好后跑一下出图") {
		t.Fatal("expected workflow wording to count as mutation")
	}
	if canvasAgentWantsMutation("这个节点是做什么的") {
		t.Fatal("question should not force mutation")
	}
	if !canvasAgentLooksLikeRefusal("当前环境无法执行画布修改操作（没有可用的画布工具）") {
		t.Fatal("expected refusal")
	}
	if !canvasAgentLooksLikeRefusal("我无法在当前对话中实际调用画布执行接口，所以没法直接搭建节点") {
		t.Fatal("expected live refusal phrasing")
	}
}

func TestCanvasAgentFallbackGraphUsesQuotedPrompt(t *testing.T) {
	prompt := "从零搭一条电商主图工作流：卖点提取 → 生图配置 → 主图，提示词写「白色运动鞋，棚拍，干净背景」，搭好后跑一下出图。"
	if !canvasAgentWantsNewWorkflow(prompt) {
		t.Fatal("expected new workflow")
	}
	ops := canvasAgentFallbackGraphOps(prompt)
	if len(ops) != 1 || ops[0]["type"] != "create_graph" {
		t.Fatalf("ops = %#v", ops)
	}
	nodes, _ := ops[0]["nodes"].([]map[string]any)
	if len(nodes) != 3 || nodes[0]["text"] != "白色运动鞋，棚拍，干净背景" || nodes[1]["type"] != "config" || nodes[2]["type"] != "image" {
		t.Fatalf("nodes = %#v", nodes)
	}
}

func TestCanvasAgentPublicErrorHidesInvalidatedToken(t *testing.T) {
	err := fmt.Errorf(`chat_requirements_prepare failed: status=401, body={"error":{"message":"Your authentication token has been invalidated.","code":"token_invalidated"}}`)
	got := canvasAgentPublicError(err)
	if strings.Contains(got, "chat_requirements_prepare") || strings.Contains(got, "token_invalidated") {
		t.Fatalf("raw upstream leaked: %q", got)
	}
	if !strings.Contains(got, "认证失效") {
		t.Fatalf("got %q", got)
	}
}

func TestCanvasAgentExposesReadAndWriteTools(t *testing.T) {
	names := map[string]bool{}
	for _, tool := range canvasAgentTools() {
		names[tool.Name] = true
	}
	for _, want := range []string{
		"canvas_apply_ops", "canvas_get_state", "canvas_get_selection", "canvas_export_snapshot",
		"canvas_run_generation", "canvas_generation_status", "canvas_create_attachment_nodes",
		"site_navigate", "canvas_list_projects", "prompts_search", "assets_list", "assets_add",
	} {
		if !names[want] {
			t.Fatalf("tool %s missing from %#v", want, names)
		}
	}
}

func TestRunCanvasAgentToolGuidesTheModelBackOnBadArguments(t *testing.T) {
	worker := &Worker{}
	loop := &canvasAgentLoopState{}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop, &sub2api.ToolCall{Name: "canvas_apply_ops", Arguments: "抱歉，我做不到"})
	if !strings.Contains(observation, "ops") {
		t.Fatalf("observation should tell the model how to retry: %q", observation)
	}
	if loop.touched {
		t.Fatal("a rejected call must not count as a canvas change")
	}
}

func TestRunCanvasAgentToolReportsUnknownTool(t *testing.T) {
	worker := &Worker{}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, &canvasAgentLoopState{}, &sub2api.ToolCall{Name: "canvas_teleport"})
	if !strings.Contains(observation, "canvas_apply_ops") {
		t.Fatalf("observation should list the real tools: %q", observation)
	}
}

// Without a stream backend the browser cannot execute anything, so the ops must
// survive as pending work instead of silently vanishing.
func TestDispatchCanvasOpsKeepsOpsPendingWhenBrowserIsUnreachable(t *testing.T) {
	worker := &Worker{}
	loop := &canvasAgentLoopState{}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop,
		&sub2api.ToolCall{Name: "canvas_apply_ops", Arguments: `{"summary":"已加节点","ops":[{"type":"add_node","nodeType":"text"}]}`})
	if !loop.touched || len(loop.pendingOps) != 1 || loop.appliedOps != 0 {
		t.Fatalf("loop = %#v", loop)
	}
	if loop.summary != "已加节点" {
		t.Fatalf("summary = %q", loop.summary)
	}
	if !strings.Contains(observation, "不要重复提交") {
		t.Fatalf("observation should stop a retry loop: %q", observation)
	}
}

func TestRunCanvasAgentToolFallsBackToTheTurnSnapshotWhenReadFails(t *testing.T) {
	worker := &Worker{}
	run := &store.AssistantRun{Params: map[string]any{"canvasSnapshot": map[string]any{"title": "测试画布"}}}
	observation := worker.runCanvasAgentTool(context.Background(), run, &canvasAgentLoopState{}, &sub2api.ToolCall{Name: "canvas_get_state"})
	if !strings.Contains(observation, "测试画布") {
		t.Fatalf("read fallback should still hand over a snapshot: %q", observation)
	}
}

func TestCanvasRunGenerationFallbackOpsCarryModeAndPrompt(t *testing.T) {
	ops := canvasRunGenerationFallbackOps(`{"nodeIds":["config-1"," ","config-2"],"mode":"image","prompt":" 运动鞋 "}`)
	if len(ops) != 2 || ops[0]["nodeId"] != "config-1" || ops[1]["nodeId"] != "config-2" {
		t.Fatalf("ops = %#v", ops)
	}
	if ops[0]["mode"] != "image" || ops[0]["prompt"] != "运动鞋" {
		t.Fatalf("op = %#v", ops[0])
	}
	if got := canvasRunGenerationFallbackOps("不是 JSON"); got != nil {
		t.Fatalf("got %#v", got)
	}
}

func TestRunCanvasAgentToolRefusesGenerationWithoutNodes(t *testing.T) {
	worker := &Worker{}
	loop := &canvasAgentLoopState{}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop,
		&sub2api.ToolCall{Name: "canvas_run_generation", Arguments: `{"nodeIds":[]}`})
	if !strings.Contains(observation, "canvas_get_state") {
		t.Fatalf("observation should point at the way to find ids: %q", observation)
	}
	if loop.touched {
		t.Fatal("nothing ran, so the turn must not be marked as a canvas change")
	}
}

func TestRunCanvasAgentToolQueuesGenerationWhenBrowserIsUnreachable(t *testing.T) {
	worker := &Worker{}
	loop := &canvasAgentLoopState{}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop,
		&sub2api.ToolCall{Name: "canvas_run_generation", Arguments: `{"nodeIds":["config-1"]}`})
	if len(loop.pendingOps) != 1 || loop.pendingOps[0]["type"] != "run_generation" {
		t.Fatalf("pending = %#v", loop.pendingOps)
	}
	if !strings.Contains(observation, "不要重复调用") {
		t.Fatalf("observation should stop a retry loop: %q", observation)
	}
}

func TestRunCanvasAgentToolDegradesGenerationStatusHonestly(t *testing.T) {
	worker := &Worker{}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, &canvasAgentLoopState{},
		&sub2api.ToolCall{Name: "canvas_generation_status", Arguments: "{}"})
	if !strings.Contains(observation, "仍在进行") {
		t.Fatalf("must not let the model claim success: %q", observation)
	}
}

func TestCanvasAgentToolCallTranscriptKeepsCallVisible(t *testing.T) {
	transcript := canvasAgentToolCallTranscript(sub2api.AgentChatResult{
		Text:     "先看看画布",
		ToolCall: &sub2api.ToolCall{Name: "canvas_get_state", Arguments: "{}"},
	})
	if !strings.Contains(transcript, "先看看画布") || !strings.Contains(transcript, "canvas_get_state") {
		t.Fatalf("transcript = %q", transcript)
	}
}

func TestTruncateForModelMarksClippedObservations(t *testing.T) {
	if got := truncateForModel("abcdef", 3); got != "abc…（已截断）" {
		t.Fatalf("got %q", got)
	}
	if got := truncateForModel(" abc ", 10); got != "abc" {
		t.Fatalf("got %q", got)
	}
}

func TestIsCanvasWorkspaceRun(t *testing.T) {
	if !isCanvasWorkspaceRun(&store.AssistantRun{Params: map[string]any{"workspace": modelconfig.WorkspaceCanvas}}) {
		t.Fatal("expected canvas workspace")
	}
	if isCanvasWorkspaceRun(&store.AssistantRun{Params: map[string]any{"workspace": modelconfig.WorkspaceAssistant}}) {
		t.Fatal("assistant workspace must not use canvas agent")
	}
}
