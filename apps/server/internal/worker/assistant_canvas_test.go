package worker

import (
	"context"
	"encoding/json"
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
	if !strings.Contains(instructions, "create_graph") || !strings.Contains(instructions, "connect_nodes") || !strings.Contains(instructions, "arrange_nodes") || !strings.Contains(instructions, "TB") {
		t.Fatalf("instructions lack graph guidance = %q", instructions)
	}
	if strings.Contains(instructions, "x、y") == false {
		t.Fatalf("instructions must forbid coordinates = %q", instructions)
	}
	if !strings.Contains(instructions, "canvas_run_workflow") || !strings.Contains(instructions, "workflows") || !strings.Contains(instructions, "composerContent") {
		t.Fatalf("instructions lack workflow semantics = %q", instructions)
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

func TestCanvasAgentFallbackRecognizesWorkflowExecution(t *testing.T) {
	capabilities := fallbackCanvasAgentCapabilities("执行工作流2")
	if !capabilities[canvasCapabilityRead] || !capabilities[canvasCapabilityGeneration] || capabilities[canvasCapabilityWrite] {
		t.Fatalf("capabilities = %#v", capabilities)
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
		"canvas_reply", "canvas_apply_ops", "canvas_get_state", "canvas_get_selection", "canvas_export_snapshot",
		"canvas_regenerate_selection", "canvas_run_generation", "canvas_generation_status", "canvas_run_workflow", "canvas_workflow_status", "canvas_create_attachment_nodes",
		"site_navigate", "canvas_list_projects", "prompts_search", "assets_list", "assets_add",
	} {
		if !names[want] {
			t.Fatalf("tool %s missing from %#v", want, names)
		}
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

func TestRunCanvasAgentToolReportsUnknownTool(t *testing.T) {
	worker := &Worker{}
	observation := worker.runCanvasAgentTool(context.Background(), &store.AssistantRun{}, &canvasAgentLoopState{}, &sub2api.ToolCall{Name: "canvas_teleport"})
	if !strings.Contains(observation, "canvas_apply_ops") {
		t.Fatalf("observation should list the real tools: %q", observation)
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
