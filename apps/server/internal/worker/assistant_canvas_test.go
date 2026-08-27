package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/google/uuid"
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
	if !strings.Contains(instructions, "create_graph") || !strings.Contains(instructions, "connect_nodes") || !strings.Contains(instructions, "arrange_nodes") || !strings.Contains(instructions, "TB") {
		t.Fatalf("instructions lack graph guidance = %q", instructions)
	}
	if strings.Contains(instructions, "x、y") == false {
		t.Fatalf("instructions must forbid coordinates = %q", instructions)
	}
	if !strings.Contains(instructions, "canvas_run_workflow") || !strings.Contains(instructions, "workflows") || !strings.Contains(instructions, "composerContent") {
		t.Fatalf("instructions lack workflow semantics = %q", instructions)
	}
	if !strings.Contains(instructions, "canvas_update_generation_settings") || !strings.Contains(instructions, "禁止改用 create_graph、add_node、connect_nodes") || !strings.Contains(instructions, "禁止自动启动生成") {
		t.Fatalf("instructions lack generation-settings boundary = %q", instructions)
	}
	if !strings.Contains(instructions, "canvas_undo_last_action") || !strings.Contains(instructions, "canvas_redo_last_action") || !strings.Contains(instructions, "禁止用 canvas_apply_ops 猜测反向操作") {
		t.Fatalf("instructions lack deterministic history tools = %q", instructions)
	}
	if !strings.Contains(instructions, "canvas_create_image_operation") || !strings.Contains(instructions, "canvas_validate_workflow") || !strings.Contains(instructions, "canvas_retry_failed_nodes") || !strings.Contains(instructions, "canvas_replace_workflow_input") || !strings.Contains(instructions, "canvas_create_checkpoint") || !strings.Contains(instructions, "canvas_inspect_visuals") || !strings.Contains(instructions, "真实图片像素") {
		t.Fatalf("instructions lack image operation or workflow control tools = %q", instructions)
	}
}

func TestRenderCanvasSnapshotKeepsLargeJSONValid(t *testing.T) {
	snapshot := map[string]any{"title": "大画布", "note": strings.Repeat("结构信息", 4_000)}
	rendered := renderCanvasSnapshot(map[string]any{"canvasSnapshot": snapshot})
	jsonStart := strings.Index(rendered, "{")
	if jsonStart < 0 {
		t.Fatalf("rendered = %q", rendered)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(rendered[jsonStart:]), &decoded); err != nil {
		t.Fatalf("snapshot JSON was truncated: %v", err)
	}
	if decoded["note"] != snapshot["note"] {
		t.Fatal("large snapshot content was lost")
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

func TestParseCanvasAgentOpsKeepsGraphTextOnlyForTextNodes(t *testing.T) {
	_, ops, err := parseCanvasAgentOps(`{"ops":[{"type":"create_graph","nodes":[{"key":"copy","type":"text","content":"商品卖点"},{"key":"result","type":"image","content":"输出图片"},{"key":"config","type":"config","prompt":"绘图说明","mode":"text"}]}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	nodes, _ := ops[0]["nodes"].([]map[string]any)
	if nodes[0]["text"] != "商品卖点" {
		t.Fatalf("text node = %#v", nodes[0])
	}
	if nodes[1]["text"] != nil || nodes[2]["text"] != nil {
		t.Fatalf("non-text graph nodes retained text: %#v", nodes)
	}
	if nodes[2]["composerContent"] != "绘图说明" {
		t.Fatalf("config node lost composer content: %#v", nodes[2])
	}
	if nodes[2]["generationMode"] != "text" {
		t.Fatalf("config node lost generation mode: %#v", nodes[2])
	}
}

func TestParseCanvasAgentOpsPreservesUpdatePatchContent(t *testing.T) {
	_, ops, err := parseCanvasAgentOps(`{"ops":[{"type":"update_node","nodeId":"text-1","patch":{"title":"新标题","content":"新正文","prompt":"新提示词","metadata":{"model":"gpt-image"}}}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	patch, _ := ops[0]["patch"].(map[string]any)
	metadata, _ := patch["metadata"].(map[string]any)
	if ops[0]["nodeId"] != "text-1" || patch["content"] != "新正文" || patch["prompt"] != "新提示词" || metadata["model"] != "gpt-image" {
		t.Fatalf("update op = %#v", ops[0])
	}
}

func TestParseCanvasAgentOpsKeepsFiftyNodeWorkflow(t *testing.T) {
	nodes := make([]map[string]any, 0, 50)
	edges := make([]map[string]any, 0, 49)
	for index := 1; index <= 50; index++ {
		key := fmt.Sprintf("n%d", index)
		nodes = append(nodes, map[string]any{"key": key, "type": "text", "text": fmt.Sprintf("步骤 %d", index)})
		if index > 1 {
			edges = append(edges, map[string]any{"from": fmt.Sprintf("n%d", index-1), "to": key})
		}
	}
	raw, err := json.Marshal(map[string]any{"summary": "已创建 50 节点工作流", "ops": []any{map[string]any{"type": "create_graph", "nodes": nodes, "edges": edges}}})
	if err != nil {
		t.Fatal(err)
	}
	_, ops, err := parseCanvasAgentOps(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	graphNodes, _ := ops[0]["nodes"].([]map[string]any)
	graphEdges, _ := ops[0]["edges"].([]map[string]any)
	if len(graphNodes) != 50 || len(graphEdges) != 49 {
		t.Fatalf("nodes=%d edges=%d", len(graphNodes), len(graphEdges))
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

func TestParseCanvasAgentOpsNormalizesDeterministicArrange(t *testing.T) {
	_, ops, err := parseCanvasAgentOps(`{"ops":[{"type":"arrange_nodes","scope":"selection","direction":"TB","x":999,"y":999}]}`)
	if err != nil {
		t.Fatalf("parse ops: %v", err)
	}
	if len(ops) != 1 || ops[0]["type"] != "arrange_nodes" || ops[0]["scope"] != "selection" || ops[0]["direction"] != "TB" {
		t.Fatalf("arrange = %#v", ops)
	}
	if ops[0]["x"] != nil || ops[0]["y"] != nil {
		t.Fatalf("arrange accepted model coordinates: %#v", ops[0])
	}
	_, ops, err = parseCanvasAgentOps(`{"ops":[{"type":"arrange_nodes","direction":"diagonal"}]}`)
	if err != nil || len(ops) != 1 || ops[0]["direction"] != "LR" {
		t.Fatalf("invalid direction fallback: ops=%#v err=%v", ops, err)
	}
	_, ops, err = parseCanvasAgentOps(`{"ops":[{"type":"arrange_nodes","scope":"workflow","workflowId":"workflow:config-a","direction":"LR"}]}`)
	if err != nil || len(ops) != 1 || ops[0]["scope"] != "workflow" || ops[0]["workflowId"] != "workflow:config-a" {
		t.Fatalf("workflow arrange: ops=%#v err=%v", ops, err)
	}
	_, ops, err = parseCanvasAgentOps(`{"ops":[{"type":"arrange_nodes","scope":"workflow"}]}`)
	if err == nil || len(ops) != 0 {
		t.Fatalf("workflow arrange without id must be rejected: ops=%#v err=%v", ops, err)
	}
}

func TestCanvasAgentOpsForPromptEnforcesExplicitLayoutDirection(t *testing.T) {
	input := []map[string]any{
		{"type": "arrange_nodes", "scope": "all", "direction": "LR"},
		{"type": "select_nodes", "ids": []string{"text-1"}},
	}
	vertical := canvasAgentOpsForPrompt("不要水平，改成从上到下的纵向布局", input)
	if vertical[0]["direction"] != "TB" || vertical[1]["type"] != "select_nodes" {
		t.Fatalf("vertical ops = %#v", vertical)
	}
	if input[0]["direction"] != "LR" {
		t.Fatalf("input mutated = %#v", input)
	}
	horizontal := canvasAgentOpsForPrompt("按连线从左到右横向排列", []map[string]any{{"type": "arrange_nodes", "direction": "TB"}})
	if horizontal[0]["direction"] != "LR" {
		t.Fatalf("horizontal ops = %#v", horizontal)
	}
	unspecified := canvasAgentOpsForPrompt("整理一下节点", input)
	if unspecified[0]["direction"] != "LR" {
		t.Fatalf("unspecified ops = %#v", unspecified)
	}
}

func TestParseCanvasAgentOpsRejectsDuplicateGraphKeys(t *testing.T) {
	_, _, err := parseCanvasAgentOps(`{"ops":[{"type":"create_graph","nodes":[{"key":"a","type":"text"},{"key":"a","type":"image"}]}]}`)
	if err == nil {
		t.Fatal("expected duplicate graph keys to be rejected")
	}
}

func TestCanvasAgentAppliedCountUsesActualBrowserObservation(t *testing.T) {
	if got := canvasAgentAppliedCount(`{"requested":2,"applied":1,"snapshot":{}}`); got != 1 {
		t.Fatalf("applied = %d", got)
	}
	if got := canvasAgentAppliedCount(`{"requested":2,"applied":0,"snapshot":"truncated"`); got != 0 {
		t.Fatalf("truncated applied = %d", got)
	}
	if got := canvasAgentAppliedCount("legacy observation without an applied count"); got != 0 {
		t.Fatalf("unverified observation counted as applied = %d", got)
	}
}

func TestCanvasAgentRecognizesRefusal(t *testing.T) {
	if !canvasAgentLooksLikeRefusal("当前环境无法执行画布修改操作（没有可用的画布工具）") {
		t.Fatal("expected refusal")
	}
	if !canvasAgentLooksLikeRefusal("我无法在当前对话中实际调用画布执行接口，所以没法直接搭建节点") {
		t.Fatal("expected live refusal phrasing")
	}
}

func TestCanvasAgentParsesCapabilities(t *testing.T) {
	capabilities, err := parseCanvasAgentCapabilities("```json\n{\"capabilities\":[\"reply\",\"canvas_write\",\"unknown\"],\"requiredAction\":\"canvas_write\"}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if !capabilities[canvasCapabilityReply] || !capabilities[canvasCapabilityWrite] || capabilities["unknown"] {
		t.Fatalf("capabilities = %#v", capabilities)
	}
}

func TestCanvasAgentIntentRoutingPreservesImagePresenceWithoutSendingPixels(t *testing.T) {
	message := canvasAgentIntentRoutingMessage(sub2api.Message{
		Role: "user", Content: "照这些参考图搭一个工作流", ReferenceImages: []string{"data:image/png;base64,a", "data:image/png;base64,b"},
	})
	if len(message.ReferenceImages) != 0 || !strings.Contains(message.Content, "2 张真实参考图") || !strings.Contains(message.Content, "执行模型会收到图片像素") {
		t.Fatalf("routing message = %#v", message)
	}
	empty := canvasAgentIntentRoutingMessage(sub2api.Message{Role: "user", ReferenceImages: []string{"data:image/png;base64,a"}})
	if empty.Content == "" || len(empty.ReferenceImages) != 0 {
		t.Fatalf("empty routing message = %#v", empty)
	}
}

func TestCanvasAgentFallbackKeepsAttachmentWorkflowCapabilities(t *testing.T) {
	prompt := "照这些参考图搭一个完整工作流\n\n本轮聊天附件，可用 canvas_create_attachment_nodes 放到画布：\n- id=attachment-1 name=\"参考图.png\""
	intent := canvasAgentIntentFromFallback(prompt)
	if intent.RequiredAction != canvasRequiredActionWrite || !intent.Capabilities[canvasCapabilityAttachments] || !intent.Capabilities[canvasCapabilityWrite] || !intent.Capabilities[canvasCapabilityWorkflowValidation] {
		t.Fatalf("attachment workflow fallback = %#v", intent)
	}
	if len(intent.Actions) != 3 || intent.Actions[0].Capability != canvasCapabilityAttachments || intent.Actions[1].Capability != canvasCapabilityWrite || intent.Actions[2].Capability != canvasCapabilityWorkflowValidation {
		t.Fatalf("attachment workflow plan = %#v", intent.Actions)
	}
}

func TestCanvasAgentSemanticWorkflowValidationKeepsWriteCapability(t *testing.T) {
	intent, err := parseCanvasAgentIntent(`{"capabilities":["reply","attachments","canvas_write","workflow_validation"],"requiredAction":"canvas_write","actions":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	for _, capability := range []string{canvasCapabilityAttachments, canvasCapabilityWrite, canvasCapabilityWorkflowValidation} {
		if !intent.Capabilities[capability] {
			t.Fatalf("missing capability %q in %#v", capability, intent)
		}
	}
	if len(intent.Actions) != 3 || intent.Actions[2].Capability != canvasCapabilityWorkflowValidation {
		t.Fatalf("workflow validation plan = %#v", intent.Actions)
	}
}

func TestCanvasAgentWorkflowValidationCannotCompleteBeforeWrites(t *testing.T) {
	loop := &canvasAgentLoopState{
		plannedActions: []canvasAgentPlannedAction{
			{ID: "attachments", Capability: canvasCapabilityAttachments, RequiredAction: canvasRequiredActionWrite},
			{ID: "write", Capability: canvasCapabilityWrite, RequiredAction: canvasRequiredActionWrite},
			{ID: "validate", Capability: canvasCapabilityWorkflowValidation, RequiredAction: canvasRequiredActionNone},
		},
		lastToolSucceeded: true,
	}
	loop.completeNextPlannedAction(canvasValidateWorkflowTool().Name)
	if len(loop.pendingPlannedActions()) != 3 {
		t.Fatalf("validation skipped earlier actions: %#v", loop.plannedActions)
	}
	loop.completeNextPlannedAction(canvasCreateAttachmentNodesTool().Name)
	loop.completeNextPlannedAction(canvasApplyOpsTool().Name)
	loop.completeNextPlannedAction(canvasValidateWorkflowTool().Name)
	if pending := loop.pendingPlannedActions(); len(pending) != 0 {
		t.Fatalf("completed workflow plan remained pending: %#v", pending)
	}
}

func TestCanvasAgentWorkflowValidationAlwaysIncludesCreatedAttachmentNodes(t *testing.T) {
	raw := canvasAgentWorkflowValidationArguments(`{"workflowId":"workflow:config-1","requiredInputNodeIds":["image-b"]}`, []string{"image-a", "image-b"})
	var input struct {
		WorkflowID           string   `json:"workflowId"`
		RequiredInputNodeIDs []string `json:"requiredInputNodeIds"`
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	if input.WorkflowID != "workflow:config-1" || len(input.RequiredInputNodeIDs) != 2 || input.RequiredInputNodeIDs[0] != "image-a" || input.RequiredInputNodeIDs[1] != "image-b" {
		t.Fatalf("validation arguments = %#v", input)
	}
}

func TestCanvasAgentWebSearchCapabilityIsReadOnlyAndForcedFirst(t *testing.T) {
	intent, err := parseCanvasAgentIntent(`{"capabilities":["reply","web_search"],"requiredAction":"none","actions":[{"id":"search","capability":"web_search","requiredAction":"none","description":"查最新资料"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if !intent.Capabilities[canvasCapabilityWeb] || intent.RequiredAction != canvasRequiredActionNone {
		t.Fatalf("intent = %#v", intent)
	}
	tools := canvasAgentToolsForCapabilities(intent.Capabilities)
	if !canvasAgentToolAllowed(tools, webSearchTool().Name) || canvasAgentToolMutates(webSearchTool().Name) {
		t.Fatalf("tools = %#v", tools)
	}
	if got := canvasAgentInitialToolChoice(intent.Capabilities, tools); got != webSearchTool().Name {
		t.Fatalf("initial tool = %q", got)
	}
	if capabilities := fallbackCanvasAgentCapabilities("帮我联网查一下今天的 AI 新闻"); !capabilities[canvasCapabilityWeb] {
		t.Fatalf("fallback capabilities = %#v", capabilities)
	}
}

func TestCanvasAgentVisualInspectionIsForcedBeforeVisualRepair(t *testing.T) {
	inspection, err := parseCanvasAgentIntent(`{"capabilities":["reply","visual_inspection"],"requiredAction":"none","actions":[{"id":"inspect","capability":"visual_inspection","requiredAction":"none","description":"比较真实图片"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	inspectionTools := canvasAgentToolsForCapabilities(inspection.Capabilities)
	if !canvasAgentToolAllowed(inspectionTools, canvasInspectVisualsTool().Name) || canvasAgentToolAllowed(inspectionTools, canvasRunGenerationTool().Name) {
		t.Fatalf("inspection tools = %#v", inspectionTools)
	}
	if got := canvasAgentInitialToolChoice(inspection.Capabilities, inspectionTools); got != canvasInspectVisualsTool().Name {
		t.Fatalf("initial inspection tool = %q", got)
	}

	repair, err := parseCanvasAgentIntent(`{"capabilities":["reply","visual_inspection","canvas_write","generation"],"requiredAction":"generation","actions":[{"id":"inspect","capability":"visual_inspection","requiredAction":"none","description":"检查重复图片"},{"id":"repair","capability":"canvas_write","requiredAction":"canvas_write","description":"调整重复节点"},{"id":"generate","capability":"generation","requiredAction":"generation","description":"重新生成"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	repairTools := canvasAgentToolsForCapabilities(repair.Capabilities)
	for _, want := range []string{canvasInspectVisualsTool().Name, canvasApplyOpsTool().Name, canvasRunGenerationTool().Name} {
		if !canvasAgentToolAllowed(repairTools, want) {
			t.Fatalf("visual repair tool %s missing from %#v", want, repairTools)
		}
	}
	if got := canvasAgentInitialToolChoice(repair.Capabilities, repairTools); got != canvasInspectVisualsTool().Name {
		t.Fatalf("visual repair must inspect first, got %q", got)
	}
}

func TestCanvasAgentVisualPlanWaitsForEveryInspectionPage(t *testing.T) {
	loop := &canvasAgentLoopState{
		lastToolSucceeded: true,
		plannedActions:    []canvasAgentPlannedAction{{ID: "inspect", Capability: canvasCapabilityVisualInspection, RequiredAction: canvasRequiredActionNone}},
	}
	loop.completeNextPlannedAction(canvasInspectVisualsTool().Name)
	if len(loop.pendingPlannedActions()) != 1 {
		t.Fatalf("partial visual inspection completed the plan: %#v", loop.plannedActions)
	}
	loop.visualInspected = true
	loop.completeNextPlannedAction(canvasInspectVisualsTool().Name)
	if len(loop.pendingPlannedActions()) != 0 {
		t.Fatalf("complete visual inspection remained pending: %#v", loop.plannedActions)
	}
	properties, _ := canvasInspectVisualsTool().Parameters["properties"].(map[string]any)
	if _, ok := properties["offset"]; !ok {
		t.Fatalf("visual inspection pagination is missing: %#v", properties)
	}
}

func TestCanvasAgentVisualFallbackRecognizesDuplicateRepair(t *testing.T) {
	prompt := "出的图有问题，有两张一模一样的，希望更新一下"
	capabilities := fallbackCanvasAgentCapabilities(prompt)
	for _, want := range []string{canvasCapabilityRead, canvasCapabilityVisualInspection, canvasCapabilityWrite, canvasCapabilityGeneration} {
		if !capabilities[want] {
			t.Fatalf("capability %s missing from %#v", want, capabilities)
		}
	}
	repair := canvasAgentIntentFromFallback(prompt)
	if len(repair.Actions) != 3 || repair.Actions[0].Capability != canvasCapabilityVisualInspection || repair.Actions[0].RequiredAction != canvasRequiredActionNone {
		t.Fatalf("fallback visual repair plan = %#v", repair.Actions)
	}
	inspection := canvasAgentIntentFromFallback("帮我比较这两张生成图片是否一模一样")
	if inspection.RequiredAction != canvasRequiredActionNone || len(inspection.Actions) != 1 || inspection.Actions[0].Capability != canvasCapabilityVisualInspection || inspection.Actions[0].RequiredAction != canvasRequiredActionNone {
		t.Fatalf("fallback inspection plan = %#v", inspection)
	}
}

func TestCanvasAgentFallbackRecognizesWorkflowExecution(t *testing.T) {
	capabilities := fallbackCanvasAgentCapabilities("执行工作流2")
	if !capabilities[canvasCapabilityRead] || !capabilities[canvasCapabilityGeneration] || capabilities[canvasCapabilityWrite] {
		t.Fatalf("capabilities = %#v", capabilities)
	}
}

func TestCanvasAgentFallbackRecognizesGenerationSettingsMutation(t *testing.T) {
	for _, prompt := range []string{
		"比例改为9:16的比例，高质量",
		"统一用竖版高画质",
		"这批节点改成 9:16 和 high quality",
		"所有生图步骤都用高质量",
		"尺寸统一调整为 9:16",
	} {
		capabilities := fallbackCanvasAgentCapabilities(prompt)
		if !capabilities[canvasCapabilityRead] || !capabilities[canvasCapabilityGenerationSettings] {
			t.Fatalf("generation settings intent lost for %q: %#v", prompt, capabilities)
		}
		if capabilities[canvasCapabilityWrite] || capabilities[canvasCapabilityGeneration] {
			t.Fatalf("structural or generation capability leaked for %q: %#v", prompt, capabilities)
		}
		if intent := canvasAgentIntentFromFallback(prompt); intent.RequiredAction != canvasRequiredActionWrite {
			t.Fatalf("required action for %q = %#v", prompt, intent)
		}
	}
}

func TestCanvasAgentSemanticGenerationSettingsUsesDedicatedTool(t *testing.T) {
	intent, err := parseCanvasAgentIntent(`{"capabilities":["reply","generation_settings"],"requiredAction":"canvas_write"}`)
	if err != nil {
		t.Fatal(err)
	}
	if !intent.Capabilities[canvasCapabilityGenerationSettings] || intent.Capabilities[canvasCapabilityWrite] {
		t.Fatalf("settings capability was not isolated: %#v", intent)
	}
	tools := canvasAgentToolsForCapabilities(intent.Capabilities)
	if !canvasAgentToolAllowed(tools, canvasUpdateGenerationSettingsTool().Name) {
		t.Fatalf("dedicated settings tool missing: %#v", tools)
	}
	if canvasAgentToolAllowed(tools, canvasApplyOpsTool().Name) || canvasAgentToolAllowed(tools, canvasRunGenerationTool().Name) {
		t.Fatalf("structural or generation tool leaked: %#v", tools)
	}
	if got := canvasAgentInitialToolChoice(intent.Capabilities, tools); got != canvasUpdateGenerationSettingsTool().Name {
		t.Fatalf("initial tool = %q", got)
	}
}

func TestCanvasAgentSemanticImageOperationUsesDedicatedTool(t *testing.T) {
	intent, err := parseCanvasAgentIntent(`{"capabilities":["reply","image_operation"],"requiredAction":"canvas_write"}`)
	if err != nil {
		t.Fatal(err)
	}
	if !intent.Capabilities[canvasCapabilityImageOperation] || intent.Capabilities[canvasCapabilityWrite] {
		t.Fatalf("image operation capability was not isolated: %#v", intent)
	}
	tools := canvasAgentToolsForCapabilities(intent.Capabilities)
	if !canvasAgentToolAllowed(tools, canvasCreateImageOperationTool().Name) {
		t.Fatalf("dedicated image operation tool missing: %#v", tools)
	}
	if canvasAgentToolAllowed(tools, canvasApplyOpsTool().Name) {
		t.Fatalf("generic structural tool leaked: %#v", tools)
	}
	if got := canvasAgentInitialToolChoice(intent.Capabilities, tools); got != canvasCreateImageOperationTool().Name {
		t.Fatalf("initial tool = %q", got)
	}
}

func TestCanvasAgentCompoundIntentKeepsEveryRequiredToolFamily(t *testing.T) {
	intent, err := parseCanvasAgentIntent(`{
		"capabilities":["reply","image_operation","canvas_write"],
		"requiredAction":"canvas_write",
		"actions":[
			{"id":"cut","capability":"image_operation","requiredAction":"canvas_write","description":"把选中图片切成四张"},
			{"id":"note","capability":"canvas_write","requiredAction":"canvas_write","description":"新增说明节点并整理布局"}
		]
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if !intent.Capabilities[canvasCapabilityImageOperation] || !intent.Capabilities[canvasCapabilityWrite] || len(intent.Actions) != 2 {
		t.Fatalf("compound intent was collapsed: %#v", intent)
	}
	tools := canvasAgentToolsForCapabilities(intent.Capabilities)
	if !canvasAgentToolAllowed(tools, canvasCreateImageOperationTool().Name) || !canvasAgentToolAllowed(tools, canvasApplyOpsTool().Name) {
		t.Fatalf("compound tools missing: %#v", tools)
	}
	loop := &canvasAgentLoopState{plannedActions: append([]canvasAgentPlannedAction(nil), intent.Actions...), lastToolSucceeded: true}
	loop.completeNextPlannedAction(canvasCreateImageOperationTool().Name)
	pending := loop.pendingPlannedActions()
	if len(pending) != 1 || pending[0].ID != "note" {
		t.Fatalf("pending after first goal = %#v", pending)
	}
	loop.completeNextPlannedAction(canvasApplyOpsTool().Name)
	if pending := loop.pendingPlannedActions(); len(pending) != 0 {
		t.Fatalf("all goals should be complete: %#v", pending)
	}
}

func TestCanvasAgentAttachmentIntentOnlyExposesGenericWritesForARealSecondGoal(t *testing.T) {
	single, err := parseCanvasAgentIntent(`{"capabilities":["reply","attachments"],"requiredAction":"canvas_write","actions":[{"id":"upload","capability":"attachments","requiredAction":"canvas_write","description":"把附件放到画布"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if single.Capabilities[canvasCapabilityWrite] || !canvasAgentToolAllowed(canvasAgentToolsForCapabilities(single.Capabilities), canvasCreateAttachmentNodesTool().Name) {
		t.Fatalf("single attachment intent leaked generic writes: %#v", single)
	}
	compound, err := parseCanvasAgentIntent(`{"capabilities":["reply","attachments","canvas_write"],"requiredAction":"canvas_write","actions":[{"id":"upload","capability":"attachments","requiredAction":"canvas_write","description":"把附件放到画布"},{"id":"note","capability":"canvas_write","requiredAction":"canvas_write","description":"新增说明节点"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	tools := canvasAgentToolsForCapabilities(compound.Capabilities)
	if !canvasAgentToolAllowed(tools, canvasCreateAttachmentNodesTool().Name) || !canvasAgentToolAllowed(tools, canvasApplyOpsTool().Name) {
		t.Fatalf("compound attachment tools missing: %#v", tools)
	}
}

func TestCanvasAgentSemanticWorkflowReuseUsesDedicatedTools(t *testing.T) {
	intent, err := parseCanvasAgentIntent(`{"capabilities":["reply","workflow_reuse"],"requiredAction":"generation"}`)
	if err != nil {
		t.Fatal(err)
	}
	if !intent.Capabilities[canvasCapabilityWorkflowReuse] || !intent.Capabilities[canvasCapabilityGeneration] || intent.Capabilities[canvasCapabilityWrite] {
		t.Fatalf("workflow reuse capability was not isolated: %#v", intent)
	}
	tools := canvasAgentToolsForCapabilities(intent.Capabilities)
	for _, want := range []string{canvasReplaceWorkflowInputTool().Name, canvasRunDownstreamTool().Name, canvasRunWorkflowTool().Name} {
		if !canvasAgentToolAllowed(tools, want) {
			t.Fatalf("workflow reuse tool %s missing: %#v", want, tools)
		}
	}
	if canvasAgentToolAllowed(tools, canvasApplyOpsTool().Name) {
		t.Fatalf("generic structural tool leaked: %#v", tools)
	}
}

func TestCanvasAgentHistoryCapabilitySupportsReadAndRestore(t *testing.T) {
	readIntent, err := parseCanvasAgentIntent(`{"capabilities":["reply","canvas_history"],"requiredAction":"none"}`)
	if err != nil {
		t.Fatal(err)
	}
	readTools := canvasAgentToolsForCapabilities(readIntent.Capabilities)
	if !canvasAgentToolAllowed(readTools, canvasListAgentHistoryTool().Name) {
		t.Fatalf("history list tool missing: %#v", readTools)
	}
	writeIntent, err := parseCanvasAgentIntent(`{"capabilities":["reply","canvas_history_write"],"requiredAction":"canvas_write"}`)
	if err != nil {
		t.Fatal(err)
	}
	writeTools := canvasAgentToolsForCapabilities(writeIntent.Capabilities)
	for _, want := range []string{canvasCreateCheckpointTool().Name, canvasRestoreCheckpointTool().Name, canvasRestoreAgentTransactionTool().Name} {
		if !canvasAgentToolAllowed(writeTools, want) {
			t.Fatalf("history mutation tool %s missing: %#v", want, writeTools)
		}
	}
	if canvasAgentToolAllowed(writeTools, canvasApplyOpsTool().Name) {
		t.Fatalf("generic write tool leaked into history capability: %#v", writeTools)
	}
}

func TestCanvasAgentImageOperationFallbackIsIsolated(t *testing.T) {
	for _, prompt := range []string{"把选中的图片切图", "给这张图做高清放大", "添加一个反推提示词节点"} {
		capabilities := fallbackCanvasAgentCapabilities(prompt)
		if !capabilities[canvasCapabilityImageOperation] || !capabilities[canvasCapabilityRead] {
			t.Fatalf("image operation fallback for %q = %#v", prompt, capabilities)
		}
		if capabilities[canvasCapabilityWrite] {
			t.Fatalf("generic write capability leaked for %q: %#v", prompt, capabilities)
		}
	}
}

func TestCanvasAgentHistoryFallbackDistinguishesListAndRestore(t *testing.T) {
	if intent := canvasAgentIntentFromFallback("查看 Agent 历史"); intent.RequiredAction != canvasRequiredActionNone || !intent.Capabilities[canvasCapabilityHistory] {
		t.Fatalf("history list fallback = %#v", intent)
	}
	if intent := canvasAgentIntentFromFallback("恢复检查点"); intent.RequiredAction != canvasRequiredActionWrite || !intent.Capabilities[canvasCapabilityHistoryWrite] {
		t.Fatalf("history restore fallback = %#v", intent)
	}
}

func TestCanvasAgentSemanticHistoryUsesDedicatedTools(t *testing.T) {
	tests := []struct {
		capability string
		tool       string
	}{
		{canvasCapabilityUndo, canvasUndoLastActionTool().Name},
		{canvasCapabilityRedo, canvasRedoLastActionTool().Name},
	}
	for _, test := range tests {
		intent, err := parseCanvasAgentIntent(fmt.Sprintf(`{"capabilities":["reply",%q],"requiredAction":"canvas_write"}`, test.capability))
		if err != nil {
			t.Fatal(err)
		}
		if intent.Capabilities[canvasCapabilityWrite] || !intent.Capabilities[test.capability] {
			t.Fatalf("history capability was not isolated: %#v", intent)
		}
		tools := canvasAgentToolsForCapabilities(intent.Capabilities)
		if !canvasAgentToolAllowed(tools, test.tool) || canvasAgentToolAllowed(tools, canvasApplyOpsTool().Name) {
			t.Fatalf("history tools = %#v", tools)
		}
		if got := canvasAgentInitialToolChoice(intent.Capabilities, tools); got != test.tool {
			t.Fatalf("initial tool = %q, want %q", got, test.tool)
		}
	}
}

func TestCanvasAgentSemanticWorkflowTemplatesSeparateReadAndCreate(t *testing.T) {
	readIntent, err := parseCanvasAgentIntent(`{"capabilities":["reply","workflow_template_read"],"requiredAction":"none"}`)
	if err != nil {
		t.Fatal(err)
	}
	readTools := canvasAgentToolsForCapabilities(readIntent.Capabilities)
	for _, want := range []string{canvasListWorkflowTemplatesTool().Name, canvasInspectWorkflowTemplateTool().Name} {
		if !canvasAgentToolAllowed(readTools, want) {
			t.Fatalf("template read tool %s missing: %#v", want, readTools)
		}
	}
	if canvasAgentToolAllowed(readTools, canvasCreateFromWorkflowTemplateTool().Name) || canvasAgentToolAllowed(readTools, canvasApplyOpsTool().Name) {
		t.Fatalf("template read leaked mutation tools: %#v", readTools)
	}

	writeIntent, err := parseCanvasAgentIntent(`{"capabilities":["reply","workflow_template_write","navigate"],"requiredAction":"canvas_write"}`)
	if err != nil {
		t.Fatal(err)
	}
	writeTools := canvasAgentToolsForCapabilities(writeIntent.Capabilities)
	for _, want := range []string{canvasListWorkflowTemplatesTool().Name, canvasInspectWorkflowTemplateTool().Name, canvasCreateFromWorkflowTemplateTool().Name, siteNavigateTool().Name} {
		if !canvasAgentToolAllowed(writeTools, want) {
			t.Fatalf("template create tool %s missing: %#v", want, writeTools)
		}
	}
	if canvasAgentToolAllowed(writeTools, canvasApplyOpsTool().Name) || canvasAgentToolAllowed(writeTools, assetsAddTool().Name) {
		t.Fatalf("unrelated write tool leaked into template creation: %#v", writeTools)
	}
	if !canvasAgentToolMutates(canvasCreateFromWorkflowTemplateTool().Name) || canvasAgentToolMutates(canvasListWorkflowTemplatesTool().Name) || canvasAgentToolMutates(canvasInspectWorkflowTemplateTool().Name) {
		t.Fatal("workflow template tool mutation classification is incorrect")
	}
}

func TestCanvasAgentWorkflowTemplateFallbackDistinguishesReadAndCreate(t *testing.T) {
	read := fallbackCanvasAgentCapabilities("帮我找一个电商工作流模板")
	if !read[canvasCapabilityTemplateRead] || read[canvasCapabilityTemplateWrite] || read[canvasCapabilityWrite] {
		t.Fatalf("template search fallback = %#v", read)
	}
	write := fallbackCanvasAgentCapabilities("使用这个工作流模板创建新画布")
	if !write[canvasCapabilityTemplateWrite] || write[canvasCapabilityTemplateRead] || write[canvasCapabilityWrite] {
		t.Fatalf("template create fallback = %#v", write)
	}
	if intent := canvasAgentIntentFromFallback("使用这个工作流模板创建新画布"); intent.RequiredAction != canvasRequiredActionWrite {
		t.Fatalf("template create required action = %#v", intent)
	}
}

func TestCanvasAgentWorkflowPreflightIsReadOnly(t *testing.T) {
	intent, err := parseCanvasAgentIntent(`{"capabilities":["reply","canvas_read"],"requiredAction":"none"}`)
	if err != nil {
		t.Fatal(err)
	}
	tools := canvasAgentToolsForCapabilities(intent.Capabilities)
	if !canvasAgentToolAllowed(tools, canvasPlanWorkflowRunTool().Name) {
		t.Fatalf("workflow preflight tool missing: %#v", tools)
	}
	if canvasAgentToolMutates(canvasPlanWorkflowRunTool().Name) {
		t.Fatal("workflow preflight must remain read-only")
	}
	for _, prompt := range []string{"这个工作流需要多少积分", "运行前检查一下工作流会执行哪些节点", "can this workflow run and what will it cost"} {
		capabilities := fallbackCanvasAgentCapabilities(prompt)
		if !capabilities[canvasCapabilityRead] || capabilities[canvasCapabilityWrite] || capabilities[canvasCapabilityGeneration] {
			t.Fatalf("workflow preflight fallback for %q = %#v", prompt, capabilities)
		}
	}
}

func TestCanvasAgentHistoryFallbackDistinguishesCommandsFromQuestions(t *testing.T) {
	for _, prompt := range []string{"撤销刚才对节点的修改", "回退上一步", "帮我恢复到修改前", "undo the last canvas change"} {
		capabilities := fallbackCanvasAgentCapabilities(prompt)
		if !capabilities[canvasCapabilityUndo] || capabilities[canvasCapabilityWrite] {
			t.Fatalf("undo fallback for %q = %#v", prompt, capabilities)
		}
	}
	for _, prompt := range []string{"重做刚才撤销的操作", "恢复刚才撤销", "redo"} {
		capabilities := fallbackCanvasAgentCapabilities(prompt)
		if !capabilities[canvasCapabilityRedo] || capabilities[canvasCapabilityUndo] {
			t.Fatalf("redo fallback for %q = %#v", prompt, capabilities)
		}
	}
	for _, prompt := range []string{"我这个 Agent 能做节点回退吗？", "怎么撤销节点修改？", "是否可以 redo？"} {
		capabilities := fallbackCanvasAgentCapabilities(prompt)
		if capabilities[canvasCapabilityUndo] || capabilities[canvasCapabilityRedo] {
			t.Fatalf("history question became mutation for %q: %#v", prompt, capabilities)
		}
	}
}

func TestCanvasAgentHistoryToolsAreMutatingAndArgumentFree(t *testing.T) {
	for _, tool := range []sub2api.FunctionTool{canvasUndoLastActionTool(), canvasRedoLastActionTool()} {
		if !canvasAgentToolMutates(tool.Name) {
			t.Fatalf("history tool %s must be tracked as mutation", tool.Name)
		}
		properties, _ := tool.Parameters["properties"].(map[string]any)
		if len(properties) != 0 {
			t.Fatalf("history tool must not accept model-guessed state: %#v", properties)
		}
	}
}

func TestCanvasAgentHistoryUnavailableIsAConfirmedSafeNoop(t *testing.T) {
	if !canvasAgentHistoryUnavailable("执行失败：没有可撤销的 Agent 画布操作，或画布已在之后被修改", true) {
		t.Fatal("missing undo history must be recognized")
	}
	if !canvasAgentHistoryUnavailable("执行失败：没有可重做的 Agent 画布操作", false) {
		t.Fatal("missing redo history must be recognized")
	}
	if canvasAgentHistoryUnavailable("执行失败：网络错误", true) {
		t.Fatal("an unrelated failure must not be accepted as a safe no-op")
	}
}

func TestCanvasAgentGenerationSettingsToolIsMutatingAndParameterOnly(t *testing.T) {
	tool := canvasUpdateGenerationSettingsTool()
	if !canvasAgentToolMutates(tool.Name) {
		t.Fatal("generation settings tool must be tracked as a mutation")
	}
	properties, _ := tool.Parameters["properties"].(map[string]any)
	for _, want := range []string{"scope", "workflowId", "nodeIds", "size", "resolution", "quality", "model", "count", "background"} {
		if _, ok := properties[want]; !ok {
			t.Fatalf("parameter %s missing from %#v", want, properties)
		}
	}
	for _, forbidden := range []string{"nodes", "edges", "ops", "run"} {
		if _, ok := properties[forbidden]; ok {
			t.Fatalf("structural parameter %s leaked into settings tool", forbidden)
		}
	}
}

func TestCanvasAgentFallbackRecognizesSelectedImageRegeneration(t *testing.T) {
	prompt := "参考选中节点的人物分别重新生成人物，背景改为米白色"
	if !canvasAgentRequiresGeneration(prompt) {
		t.Fatalf("expected deterministic generation intent for %q", prompt)
	}
	capabilities := fallbackCanvasAgentCapabilities(prompt)
	if !capabilities[canvasCapabilityRead] || !capabilities[canvasCapabilityGeneration] {
		t.Fatalf("capabilities = %#v", capabilities)
	}
	intent := canvasAgentIntentFromFallback(prompt)
	if intent.RequiredAction != canvasRequiredActionGeneration {
		t.Fatalf("fallback intent = %#v", intent)
	}
	tools := canvasAgentToolsForCapabilities(intent.Capabilities)
	if !canvasAgentToolAllowed(tools, canvasRegenerateSelectionTool().Name) {
		t.Fatalf("selected-image batch tool missing: %#v", tools)
	}
}

func TestCanvasAgentSemanticIntentForcesGenerationWithoutKeywordMatch(t *testing.T) {
	prompt := "这些按之前商量的都来一版"
	if fallbackCanvasAgentCapabilities(prompt)[canvasCapabilityGeneration] {
		t.Fatalf("test prompt unexpectedly matched keyword fallback: %q", prompt)
	}
	intent, err := parseCanvasAgentIntent(`{"capabilities":["reply"],"requiredAction":"generation"}`)
	if err != nil {
		t.Fatal(err)
	}
	intent = restrictCanvasAgentIntent(prompt, intent)
	if intent.RequiredAction != canvasRequiredActionGeneration || !intent.Capabilities[canvasCapabilityGeneration] || !intent.Capabilities[canvasCapabilityRead] {
		t.Fatalf("semantic intent was not preserved: %#v", intent)
	}
	tools := canvasAgentToolsForCapabilities(intent.Capabilities)
	if !canvasAgentToolAllowed(tools, canvasRegenerateSelectionTool().Name) {
		t.Fatalf("semantic generation intent did not expose regeneration tool: %#v", tools)
	}
}

func TestCanvasAgentIntentRequiresExplicitActionContract(t *testing.T) {
	if _, err := parseCanvasAgentIntent(`{"capabilities":["generation"]}`); err == nil {
		t.Fatal("missing requiredAction must fall back instead of silently losing the execution boundary")
	}
}

func TestCanvasAgentRequiredActionAcceptsStartedOrCanceledBatch(t *testing.T) {
	if !canvasAgentMutationSatisfied(true, &canvasAgentLoopState{billableAction: true}) {
		t.Fatal("a started generation batch must satisfy the action boundary")
	}
	if !canvasAgentMutationSatisfied(true, &canvasAgentLoopState{userCanceled: true}) {
		t.Fatal("a real cost-dialog cancellation must satisfy the action boundary")
	}
	if canvasAgentMutationSatisfied(true, &canvasAgentLoopState{}) {
		t.Fatal("an unexecuted reply must not satisfy the action boundary")
	}
}

func TestCanvasAgentCapabilityToolsEnforceLeastPrivilege(t *testing.T) {
	replyTools := canvasAgentToolsForCapabilities(canvasAgentCapabilities{canvasCapabilityReply: true})
	if len(replyTools) != 1 || replyTools[0].Name != canvasReplyTool().Name {
		t.Fatalf("reply tools = %#v", replyTools)
	}
	if got := canvasAgentInitialToolChoice(canvasAgentCapabilities{canvasCapabilityReply: true}, replyTools); got != canvasReplyTool().Name {
		t.Fatalf("reply choice = %q", got)
	}

	writeCapabilities := canvasAgentCapabilities{canvasCapabilityWrite: true}
	writeTools := canvasAgentToolsForCapabilities(writeCapabilities)
	if !canvasAgentToolAllowed(writeTools, canvasApplyOpsTool().Name) || !canvasAgentToolAllowed(writeTools, canvasReadStateTool().Name) {
		t.Fatalf("write tools = %#v", writeTools)
	}
	if canvasAgentToolAllowed(writeTools, canvasRunGenerationTool().Name) {
		t.Fatalf("generation tool leaked into write turn: %#v", writeTools)
	}
	if got := canvasAgentInitialToolChoice(writeCapabilities, writeTools); got != canvasReadStateTool().Name {
		t.Fatalf("write choice = %q", got)
	}

	readTools := canvasAgentToolsForCapabilities(canvasAgentCapabilities{canvasCapabilityRead: true})
	if canvasAgentToolAllowed(readTools, canvasApplyOpsTool().Name) {
		t.Fatalf("write tool leaked into read turn: %#v", readTools)
	}
	if got := canvasAgentInitialToolChoice(canvasAgentCapabilities{canvasCapabilityRead: true}, readTools); got != sub2api.RequiredToolChoice {
		t.Fatalf("read choice = %q", got)
	}
}

func TestCanvasAgentSemanticMutationIntentDoesNotDependOnPromptKeywords(t *testing.T) {
	prompt := "这些照之前说的处理一下"
	if fallbackCanvasAgentCapabilities(prompt)[canvasCapabilityWrite] {
		t.Fatalf("test prompt unexpectedly matched keyword fallback: %q", prompt)
	}
	intent, err := parseCanvasAgentIntent(`{"capabilities":["reply"],"requiredAction":"canvas_write"}`)
	if err != nil {
		t.Fatal(err)
	}
	intent = restrictCanvasAgentIntent(prompt, intent)
	if intent.RequiredAction != canvasRequiredActionWrite || !intent.Capabilities[canvasCapabilityRead] || !intent.Capabilities[canvasCapabilityWrite] {
		t.Fatalf("semantic mutation intent was not preserved: %#v", intent)
	}
}

func TestCanvasAgentMutationFallbackAndOptOutRemainSafe(t *testing.T) {
	if canvasAgentRequiresMutation("如何整理当前画布的节点布局？") {
		t.Fatal("an explanatory question must not be forced into a mutation turn")
	}
	if canvasAgentRequiresMutation("帮我分析一下如何整理当前画布，不要急着动手") {
		t.Fatal("an analysis request must not be forced into a mutation turn")
	}
	if !canvasAgentRequiresMutation("怎么整理当前画布都行，直接执行") {
		t.Fatal("an explicit execution clause must win over an explanatory phrase")
	}

	noMutation := restrictCanvasAgentIntent("只说明怎么整理，不要修改画布", canvasAgentIntent{
		Capabilities:   canvasAgentCapabilities{canvasCapabilityReply: true, canvasCapabilityWrite: true},
		RequiredAction: canvasRequiredActionWrite,
	})
	if noMutation.Capabilities[canvasCapabilityWrite] || noMutation.RequiredAction != canvasRequiredActionNone {
		t.Fatalf("explicit mutation opt-out was overridden: %#v", noMutation)
	}
}

func TestCanvasAgentVerifiedNoopRequiresReadAndExplicitWording(t *testing.T) {
	loop := &canvasAgentLoopState{}
	if _, ok := canvasAgentAcceptVerifiedNoop(loop, "当前状态已满足要求，无需修改"); ok {
		t.Fatal("a model assertion without a successful read must not close a mutation turn")
	}
	loop.verifiedRead = true
	if _, ok := canvasAgentAcceptVerifiedNoop(loop, "已按连线方向重新排布全部节点"); ok {
		t.Fatal("an unverified completion claim must not be accepted as a no-op")
	}
	message, ok := canvasAgentAcceptVerifiedNoop(loop, "读取后确认当前状态已满足要求，无需修改")
	if !ok || message != canvasAgentVerifiedNoopMessage || !loop.verifiedNoop {
		t.Fatalf("verified no-op = %q, %#v", message, loop)
	}
}

func TestCanvasAgentMutationCompletionRequiresAppliedChangeOrVerifiedNoop(t *testing.T) {
	if canvasAgentMutationSatisfied(true, &canvasAgentLoopState{
		touched:    true,
		pendingOps: []map[string]any{{"type": "arrange_nodes"}},
	}) {
		t.Fatal("queued or attempted ops are not proof that the canvas changed")
	}
	if !canvasAgentMutationSatisfied(true, &canvasAgentLoopState{appliedOps: 1}) {
		t.Fatal("a browser-verified applied operation must satisfy the mutation turn")
	}
	if !canvasAgentMutationSatisfied(true, &canvasAgentLoopState{verifiedRead: true, verifiedNoop: true}) {
		t.Fatal("a verified explicit no-op must satisfy the mutation turn")
	}
	if !canvasAgentMutationSatisfied(false, &canvasAgentLoopState{}) {
		t.Fatal("non-mutation turns must not be gated by canvas writes")
	}
}

func TestCanvasAgentExplicitNoMutationRemovesWriteCapabilities(t *testing.T) {
	for _, prompt := range []string{
		"帮我设计一个图标生成工作流，先讲方案，不要修改画布",
		"先不执行，只解释一下会怎么连接",
		"Explain only, do not modify the canvas",
	} {
		if !canvasAgentForbidsMutation(prompt) {
			t.Fatalf("expected no-mutation boundary for %q", prompt)
		}
		capabilities := restrictCanvasAgentCapabilities(prompt, canvasAgentCapabilities{
			canvasCapabilityReply: true, canvasCapabilityWrite: true, canvasCapabilityGeneration: true,
		})
		tools := canvasAgentToolsForCapabilities(capabilities)
		if canvasAgentToolAllowed(tools, canvasApplyOpsTool().Name) || canvasAgentToolAllowed(tools, canvasRunGenerationTool().Name) {
			t.Fatalf("mutating tools remained for %q: %#v", prompt, tools)
		}
	}
	if canvasAgentForbidsMutation("不要只讲方案，直接修改画布") {
		t.Fatal("negated explanation request must still allow a mutation")
	}
	for _, prompt := range []string{
		"新增一个文本节点，不要改动现有节点",
		"Add one text node. Do not change any existing node.",
		"Create a group, but don't change existing nodes.",
	} {
		if canvasAgentForbidsMutation(prompt) {
			t.Fatalf("existing-node constraint must still allow additive work: %q", prompt)
		}
	}
}

func TestCanvasAgentCapabilityFailureKeepsExplicitWriteIntent(t *testing.T) {
	for _, prompt := range []string{
		"帮我整理当前画布",
		"把这些节点重新排版画布",
		"照刚才的方案做，落到画布上",
		"新增节点并连接节点",
	} {
		capabilities := fallbackCanvasAgentCapabilities(prompt)
		if !capabilities[canvasCapabilityWrite] || !capabilities[canvasCapabilityRead] {
			t.Fatalf("explicit write intent lost for %q: %#v", prompt, capabilities)
		}
	}
	capabilities := fallbackCanvasAgentCapabilities("先讲方案，不要修改画布")
	if capabilities[canvasCapabilityWrite] {
		t.Fatalf("no-mutation boundary lost: %#v", capabilities)
	}
}

func TestCanvasAgentPendingToolMetadataIsReplayable(t *testing.T) {
	pending := canvasAgentPendingTool("request-1", "canvas_apply_ops", `{"ops":[]}`)
	if pending["requestId"] != "request-1" || pending["name"] != "canvas_apply_ops" || pending["stage"] != "tool" {
		t.Fatalf("pending = %#v", pending)
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
		"canvas_reply", "canvas_apply_ops", "canvas_get_state", "canvas_get_selection", "canvas_find_nodes", "canvas_inspect_nodes", "canvas_inspect_visuals", "canvas_focus_nodes", "canvas_duplicate_selection", "canvas_create_image_operation", "canvas_replace_workflow_input", "canvas_run_downstream", "canvas_update_generation_settings", "canvas_undo_last_action", "canvas_redo_last_action", "canvas_export_snapshot",
		"canvas_regenerate_selection", "canvas_run_generation", "canvas_generation_status", "canvas_run_workflow", "canvas_workflow_status", "canvas_validate_workflow", "canvas_plan_workflow_run", "canvas_stop_workflow", "canvas_resume_workflow", "canvas_retry_failed_nodes", "canvas_list_agent_history", "canvas_create_checkpoint", "canvas_restore_checkpoint", "canvas_restore_agent_transaction", "canvas_create_attachment_nodes",
		"site_navigate", "canvas_list_projects", "canvas_list_workflow_templates", "canvas_inspect_workflow_template", "canvas_create_from_workflow_template", "prompts_search", "assets_list", "assets_add",
	} {
		if !names[want] {
			t.Fatalf("tool %s missing from %#v", want, names)
		}
	}
	if len(names) != len(canvasAgentTools()) {
		t.Fatalf("canvas agent tool list contains duplicate names")
	}
}

func TestCanvasRegenerateSelectionReadsNodeIDsFromLiveBrowserSelection(t *testing.T) {
	tool := canvasRegenerateSelectionTool()
	properties, _ := tool.Parameters["properties"].(map[string]any)
	if _, exists := properties["sourceNodeIds"]; exists {
		t.Fatalf("sourceNodeIds must not be model-provided: %#v", properties)
	}
	required, _ := tool.Parameters["required"].([]string)
	if len(required) != 1 || required[0] != "instruction" {
		t.Fatalf("required = %#v, want instruction only", required)
	}
	if !strings.Contains(tool.Description, "实时选区") || !strings.Contains(tool.Description, "模型不提供也不能猜测") {
		t.Fatalf("tool must use the complete live selection: %q", tool.Description)
	}
}

func TestCanvasAgentReplyContent(t *testing.T) {
	if got := canvasAgentReplyContent(`{"content":" 这是说明，不修改画布。 "}`); got != "这是说明，不修改画布。" {
		t.Fatalf("reply = %q", got)
	}
	if got := canvasAgentReplyContent("not json"); got != "" {
		t.Fatalf("invalid reply = %q", got)
	}
}

func TestCanvasAgentRecognizesOperationsPayloadAsNonUserFacingContent(t *testing.T) {
	if !canvasAgentContentIsOpsPayload(`{"summary":"已创建工作流","ops":[{"type":"add_node","nodeType":"text"}]}`) {
		t.Fatal("expected operations payload")
	}
	if canvasAgentContentIsOpsPayload("已创建工作流") {
		t.Fatal("plain summary must stay user-facing")
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

func TestRunCanvasAgentToolBlocksGenerationUntilVisualInspection(t *testing.T) {
	worker := &Worker{}
	loop := &canvasAgentLoopState{requiresVisualInspection: true}
	writeObservation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop, &sub2api.ToolCall{Name: canvasApplyOpsTool().Name, Arguments: `{"ops":[{"type":"add_node","nodeType":"text"}]}`})
	if !strings.Contains(writeObservation, canvasInspectVisualsTool().Name) || loop.touched {
		t.Fatalf("canvas write was not blocked: loop=%#v observation=%q", loop, writeObservation)
	}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop, &sub2api.ToolCall{Name: canvasRunGenerationTool().Name, Arguments: `{"nodeIds":["config-1"]}`})
	if !strings.Contains(observation, canvasInspectVisualsTool().Name) || len(loop.pendingOps) != 0 {
		t.Fatalf("generation was not blocked: loop=%#v observation=%q", loop, observation)
	}
	loop.visualInspected = true
	observation = worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop, &sub2api.ToolCall{Name: canvasRunGenerationTool().Name, Arguments: `{"nodeIds":["config-1"]}`})
	if strings.Contains(observation, "必须先调用") || len(loop.pendingOps) != 1 {
		t.Fatalf("generation remained blocked after inspection: loop=%#v observation=%q", loop, observation)
	}
}

func TestCanvasAgentVisualReferencesAreRestrictedToTheCurrentUser(t *testing.T) {
	userID := uuid.MustParse("f25376d5-9001-4286-b65f-6037b5995845")
	for _, allowed := range []string{
		"uploads/f25376d5-9001-4286-b65f-6037b5995845/original/a.png",
		"tasks/f25376d5-9001-4286-b65f-6037b5995845/task-1/original/a.png",
		"canvas-template-assets/template-1/a.png",
	} {
		if !canvasAgentVisualReferenceAllowed(userID, allowed) {
			t.Fatalf("expected allowed visual key %q", allowed)
		}
	}
	for _, denied := range []string{
		"uploads/41a38963-b12b-464c-b687-b130de8fd1b5/original/a.png",
		"tasks/41a38963-b12b-464c-b687-b130de8fd1b5/task-1/original/a.png",
		"https://example.com/a.png",
		"../uploads/f25376d5-9001-4286-b65f-6037b5995845/original/a.png",
	} {
		if canvasAgentVisualReferenceAllowed(userID, denied) {
			t.Fatalf("visual key escaped user boundary: %q", denied)
		}
	}
	if !canvasAgentTemporaryVisualKeyAllowed(userID, "uploads/f25376d5-9001-4286-b65f-6037b5995845/thumb/a") {
		t.Fatal("current user temporary upload should be removable")
	}
	for _, denied := range []string{
		"tasks/f25376d5-9001-4286-b65f-6037b5995845/task-1/original/a.png",
		"uploads/41a38963-b12b-464c-b687-b130de8fd1b5/original/a.png",
		"canvas-template-assets/template-1/a.png",
	} {
		if canvasAgentTemporaryVisualKeyAllowed(userID, denied) {
			t.Fatalf("temporary cleanup escaped upload ownership: %q", denied)
		}
	}
	if got := uniqueCanvasAgentStrings([]string{"a", "a", "", "b"}); len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("unique temporary keys = %#v", got)
	}
}

func TestCanvasAgentVisualContextWarnsWhenPixelsAreUnavailable(t *testing.T) {
	message := (&Worker{}).consumeCanvasAgentVisualContext(context.Background(), &store.AssistantRun{}, &canvasAgentLoopState{visualInspected: true})
	if message == nil || message.Role != "user" || !strings.Contains(message.Content, "没有可供模型读取") || !strings.Contains(message.Content, "禁止声称") || len(message.ReferenceImages) != 0 {
		t.Fatalf("visual fallback message = %#v", message)
	}
}

func TestRunCanvasAgentToolReportsUnknownTool(t *testing.T) {
	worker := &Worker{}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, &canvasAgentLoopState{}, &sub2api.ToolCall{Name: "canvas_teleport"})
	if !strings.Contains(observation, "canvas_apply_ops") {
		t.Fatalf("observation should list the real tools: %q", observation)
	}
}

func TestRunCanvasAgentToolExecutesWebSearchOnServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"output":[{"type":"message","content":[{"type":"output_text","text":"实时资料","annotations":[{"type":"url_citation","url":"https://example.com/live","title":"Live"}]}]}]}`)
	}))
	defer server.Close()
	client, err := sub2api.New(server.URL, "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	loop := &canvasAgentLoopState{webSearchClient: client}
	observation := (&Worker{}).runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop, &sub2api.ToolCall{
		Name: webSearchTool().Name, Arguments: `{"query":"查实时资料"}`,
	})
	if !loop.lastToolSucceeded || !strings.Contains(observation, "实时资料") || !strings.Contains(observation, "https://example.com/live") {
		t.Fatalf("loop=%#v observation=%q", loop, observation)
	}
}

func TestRunCanvasAgentToolMarksWebSearchFailureAsBlocking(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":{"message":"search is disabled"}}`, http.StatusUnauthorized)
	}))
	defer server.Close()
	client, err := sub2api.New(server.URL, "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	loop := &canvasAgentLoopState{webSearchClient: client}
	observation := (&Worker{}).runCanvasAgentTool(context.Background(), &store.AssistantRun{}, loop, &sub2api.ToolCall{
		Name: webSearchTool().Name, Arguments: `{"query":"查实时资料"}`,
	})
	if !loop.webSearchFailed || loop.webSearchError == "" || loop.lastToolSucceeded {
		t.Fatalf("loop = %#v", loop)
	}
	if !strings.Contains(observation, "search is disabled") || !strings.Contains(loop.webSearchError, "search is disabled") {
		t.Fatalf("observation=%q error=%q", observation, loop.webSearchError)
	}
}

func TestCanvasAgentToolResultFailureIsNotBillable(t *testing.T) {
	if !canvasAgentToolResultFailed("执行失败：附件不存在") {
		t.Fatal("browser tool errors must not be treated as billable actions")
	}
	if canvasAgentToolResultFailed(`{"ok":true}`) {
		t.Fatal("successful tool observations must remain billable")
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

func TestCanvasAgentToolMessagesPreserveStructuredCallAndObservation(t *testing.T) {
	messages := canvasAgentToolMessages(sub2api.AgentChatResult{
		Text: "先看看画布",
		ToolCall: &sub2api.ToolCall{
			ID: "call-canvas-1", Name: "canvas_get_state", Arguments: `{"scope":"all"}`,
		},
	}, `{"nodes":3}`)
	if len(messages) != 2 {
		t.Fatalf("messages = %#v", messages)
	}
	assistant := messages[0]
	if assistant.Role != "assistant" || assistant.Content != "先看看画布" || len(assistant.ToolCalls) != 1 {
		t.Fatalf("assistant message = %#v", assistant)
	}
	call := assistant.ToolCalls[0]
	if call.ID != "call-canvas-1" || call.Name != "canvas_get_state" || call.Arguments != `{"scope":"all"}` {
		t.Fatalf("tool call = %#v", call)
	}
	observation := messages[1]
	if observation.Role != "tool" || observation.Name != call.Name || observation.ToolCallID != call.ID || observation.Content != `{"nodes":3}` {
		t.Fatalf("observation = %#v", observation)
	}
}

func TestCanvasAgentToolMessagesProvideStableFallbackCallID(t *testing.T) {
	messages := canvasAgentToolMessages(sub2api.AgentChatResult{
		ToolCall: &sub2api.ToolCall{Name: "canvas_get_state", Arguments: "{}"},
	}, "snapshot")
	if len(messages) != 2 || messages[0].ToolCalls[0].ID != "call_0" || messages[1].ToolCallID != "call_0" {
		t.Fatalf("messages = %#v", messages)
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
