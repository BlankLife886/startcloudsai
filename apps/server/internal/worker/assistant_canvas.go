package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

const (
	canvasAgentMaxOps        = 24
	canvasAgentMaxGraphNodes = 32
	canvasAgentMaxGraphEdges = 64

	canvasAgentMaxIterations       = 10
	canvasAgentMaxDuration         = 8 * time.Minute
	canvasAgentApplyTimeout        = 25 * time.Second
	canvasAgentReadTimeout         = 15 * time.Second
	canvasAgentStatusTimeout       = 75 * time.Second
	canvasAgentObservationMaxBytes = 8000
)

var canvasAgentOpTypes = map[string]bool{
	"add_node":               true,
	"update_node":            true,
	"delete_node":            true,
	"connect_nodes":          true,
	"delete_connections":     true,
	"select_nodes":           true,
	"set_viewport":           true,
	"run_generation":         true,
	"create_generation_flow": true,
	"create_graph":           true,
	"move_nodes":             true,
	"resize_node":            true,
}

var canvasAgentNodeTypes = map[string]bool{"text": true, "config": true, "image": true, "group": true}

var canvasAgentOpAliases = map[string]string{
	"connect":                  "connect_nodes",
	"link":                     "connect_nodes",
	"connect_node":             "connect_nodes",
	"add_connection":           "connect_nodes",
	"add_edge":                 "connect_nodes",
	"create_image_flow":        "create_generation_flow",
	"generation_flow":          "create_generation_flow",
	"create_image_prompt_flow": "create_generation_flow",
	"graph":                    "create_graph",
	"create_workflow":          "create_graph",
	"build_graph":              "create_graph",
	"workflow":                 "create_graph",
}

func isCanvasWorkspaceRun(run *store.AssistantRun) bool {
	return assistantParamString(run.Params, "workspace", "") == modelconfig.WorkspaceCanvas
}

func canvasApplyOpsTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_apply_ops",
		Description: "对当前无限画布执行一批结构化操作。纯问答、解释或需求不清时不要调用。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"summary": map[string]any{"type": "string", "description": "面向用户的一句中文说明，总结将要改动的内容"},
				"ops": map[string]any{
					"type":        "array",
					"description": "画布操作列表，按执行顺序排列",
					"maxItems":    canvasAgentMaxOps,
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"type": map[string]any{
								"type": "string",
								"enum": []string{"create_graph", "add_node", "update_node", "delete_node", "connect_nodes", "create_generation_flow", "delete_connections", "select_nodes", "set_viewport", "run_generation", "move_nodes", "resize_node"},
							},
							"nodes": map[string]any{
								"type":        "array",
								"description": "create_graph 的节点列表，不要写坐标，排版由系统自动完成",
								"maxItems":    canvasAgentMaxGraphNodes,
								"items": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"key":   map[string]any{"type": "string", "description": "本次响应内的临时标识，供 edges 引用"},
										"type":  map[string]any{"type": "string", "enum": []string{"text", "config", "image", "group"}},
										"title": map[string]any{"type": "string"},
										"text":  map[string]any{"type": "string", "description": "text 节点的正文，例如提示词"},
									},
									"required": []string{"key", "type"},
								},
							},
							"edges": map[string]any{
								"type":        "array",
								"description": "create_graph 的连线，使用 nodes 里的 key",
								"maxItems":    canvasAgentMaxGraphEdges,
								"items": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"from": map[string]any{"type": "string"},
										"to":   map[string]any{"type": "string"},
									},
									"required": []string{"from", "to"},
								},
							},
							"id":         map[string]any{"type": "string"},
							"ids":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
							"nodeType":   map[string]any{"type": "string", "enum": []string{"text", "image", "config", "group"}},
							"title":      map[string]any{"type": "string"},
							"x":          map[string]any{"type": "number"},
							"y":          map[string]any{"type": "number"},
							"fromNodeId": map[string]any{"type": "string"},
							"toNodeId":   map[string]any{"type": "string"},
							"nodeId":     map[string]any{"type": "string"},
							"prompt":     map[string]any{"type": "string"},
							"mode":       map[string]any{"type": "string", "enum": []string{"text", "image"}},
							"width":      map[string]any{"type": "number"},
							"height":     map[string]any{"type": "number"},
							"position":   map[string]any{"type": "object"},
							"viewport":   map[string]any{"type": "object"},
							"metadata":   map[string]any{"type": "object"},
							"patch":      map[string]any{"type": "object"},
							"items": map[string]any{
								"type": "array",
								"items": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"id": map[string]any{"type": "string"},
										"x":  map[string]any{"type": "number"},
										"y":  map[string]any{"type": "number"},
										"dx": map[string]any{"type": "number"},
										"dy": map[string]any{"type": "number"},
									},
								},
							},
							"freeResize": map[string]any{"type": "boolean"},
						},
						"required": []string{"type"},
					},
				},
			},
			"required":             []string{"ops", "summary"},
			"additionalProperties": false,
		},
	}
}

func canvasReadStateTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_get_state",
		Description: "读取画布当前的真实结构（节点、连线、选中、视口）。改完之后想确认结果，或者系统提示里的快照可能已经过时时调用。",
		Parameters: map[string]any{
			"type": "object", "properties": map[string]any{}, "additionalProperties": false,
		},
	}
}

func canvasReadSelectionTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_get_selection",
		Description: "只读取用户当前选中的节点。用户说「这个/这些/选中的」时先调用它。",
		Parameters: map[string]any{
			"type": "object", "properties": map[string]any{}, "additionalProperties": false,
		},
	}
}

func canvasRunGenerationTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_run_generation",
		Description: "触发画布上已有节点的生成，nodeIds 传生图配置节点的 id。生成是异步的，触发后用 canvas_generation_status 查看结果。用户可能需要先确认消耗。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "要触发的节点 id，通常是配置节点"},
				"mode":    map[string]any{"type": "string", "enum": []string{"text", "image"}},
				"prompt":  map[string]any{"type": "string", "description": "留空则使用节点自身的提示词"},
			},
			"required":             []string{"nodeIds"},
			"additionalProperties": false,
		},
	}
}

func canvasGenerationStatusTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_generation_status",
		Description: "查询生成任务的状态。默认会等待一段时间直到出结果；如果返回里还有 running，就再调用一次继续等。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeIds":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "留空表示查询画布上所有生成任务"},
				"waitSeconds": map[string]any{"type": "number", "description": "最多等待多少秒，0 表示立即返回，默认 20，上限 60"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasExportSnapshotTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_export_snapshot",
		Description: "导出当前画布的结构化快照，效果等同 canvas_get_state。需要完整布局时调用。",
		Parameters:  map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
	}
}

func canvasCreateAttachmentNodesTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_create_attachment_nodes",
		Description: "把本轮用户上传的聊天图片放到画布上，变成图片节点。attachmentIds 必须使用系统提示里列出的附件 id。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"attachmentIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "本轮聊天附件 id"},
				"x":             map[string]any{"type": "number"},
				"y":             map[string]any{"type": "number"},
				"gap":           map[string]any{"type": "number"},
				"direction":     map[string]any{"type": "string", "enum": []string{"row", "column"}},
			},
			"required":             []string{"attachmentIds"},
			"additionalProperties": false,
		},
	}
}

func siteNavigateTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "site_navigate",
		Description: "在本站内跳转页面。只允许站内路径：/、/canvas、/canvas/{id}、/canvas/config、/prompts、/assets。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path": map[string]any{"type": "string", "description": "站内路径，例如 /assets 或 /canvas/项目id"},
			},
			"required":             []string{"path"},
			"additionalProperties": false,
		},
	}
}

func canvasListProjectsTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_list_projects",
		Description: "列出用户的无限画布项目（标题、节点数、时间），不包含完整图结构。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"keyword":  map[string]any{"type": "string"},
				"page":     map[string]any{"type": "number"},
				"pageSize": map[string]any{"type": "number"},
			},
			"additionalProperties": false,
		},
	}
}

func promptsSearchTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "prompts_search",
		Description: "搜索提示词库。找到合适的提示词后，用 canvas_apply_ops 写到 text 节点，不要只把正文念给用户。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"keyword":  map[string]any{"type": "string"},
				"category": map[string]any{"type": "string"},
				"tags":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"page":     map[string]any{"type": "number"},
				"pageSize": map[string]any{"type": "number"},
			},
			"additionalProperties": false,
		},
	}
}

func assetsListTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "assets_list",
		Description: "列出「我的素材」。只返回元数据，不含原图。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"kind":     map[string]any{"type": "string", "enum": []string{"text", "image", "all"}},
				"keyword":  map[string]any{"type": "string"},
				"page":     map[string]any{"type": "number"},
				"pageSize": map[string]any{"type": "number"},
			},
			"additionalProperties": false,
		},
	}
}

func assetsAddTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "assets_add",
		Description: "把一段文本或一张图片加入「我的素材」。kind=image 时 imageUrl 用画布节点已有的图片地址。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"kind":     map[string]any{"type": "string", "enum": []string{"text", "image"}},
				"title":    map[string]any{"type": "string"},
				"content":  map[string]any{"type": "string", "description": "kind=text 时的正文"},
				"imageUrl": map[string]any{"type": "string", "description": "kind=image 时的图片地址"},
				"tags":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"note":     map[string]any{"type": "string"},
			},
			"required":             []string{"kind", "title"},
			"additionalProperties": false,
		},
	}
}

func canvasAgentTools() []sub2api.FunctionTool {
	return []sub2api.FunctionTool{
		canvasApplyOpsTool(),
		canvasReadStateTool(),
		canvasReadSelectionTool(),
		canvasExportSnapshotTool(),
		canvasRunGenerationTool(),
		canvasGenerationStatusTool(),
		canvasCreateAttachmentNodesTool(),
		siteNavigateTool(),
		canvasListProjectsTool(),
		promptsSearchTool(),
		assetsListTool(),
		assetsAddTool(),
	}
}

func canvasAgentToolNames() []string {
	tools := canvasAgentTools()
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	return names
}

func canvasAgentBrowserTimeout(name string) time.Duration {
	switch name {
	case canvasGenerationStatusTool().Name:
		return canvasAgentStatusTimeout
	case canvasReadStateTool().Name, canvasReadSelectionTool().Name, canvasExportSnapshotTool().Name,
		canvasListProjectsTool().Name, promptsSearchTool().Name, assetsListTool().Name, assetsAddTool().Name,
		siteNavigateTool().Name:
		return canvasAgentReadTimeout
	default:
		return canvasAgentApplyTimeout
	}
}

func canvasAgentToolMutates(name string) bool {
	switch name {
	case canvasApplyOpsTool().Name, canvasRunGenerationTool().Name, canvasCreateAttachmentNodesTool().Name:
		return true
	default:
		return false
	}
}

func canvasRunGenerationFallbackOps(arguments string) []map[string]any {
	var body struct {
		NodeIds []string `json:"nodeIds"`
		Mode    string   `json:"mode"`
		Prompt  string   `json:"prompt"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(arguments)), &body); err != nil {
		return nil
	}
	ops := make([]map[string]any, 0, len(body.NodeIds))
	for _, nodeID := range body.NodeIds {
		nodeID = strings.TrimSpace(nodeID)
		if nodeID == "" {
			continue
		}
		op := map[string]any{"type": "run_generation", "nodeId": nodeID}
		if body.Mode == "text" || body.Mode == "image" {
			op["mode"] = body.Mode
		}
		if prompt := strings.TrimSpace(body.Prompt); prompt != "" {
			op["prompt"] = prompt
		}
		ops = append(ops, op)
	}
	return ops
}

// canvasAgentLoopState accumulates what the tool loop actually did, so the
// closing message can describe real changes instead of intentions.
type canvasAgentLoopState struct {
	summary    string
	appliedOps int
	pendingOps []map[string]any
	touched    bool
}

func (w *Worker) runCanvasAgentTool(ctx context.Context, run *store.AssistantRun, loop *canvasAgentLoopState, call *sub2api.ToolCall) string {
	switch call.Name {
	case canvasApplyOpsTool().Name:
		summary, ops, err := parseCanvasAgentOps(call.Arguments)
		if err != nil || len(ops) == 0 {
			return "canvas_apply_ops 调用失败：没有解析出有效的 ops。请按 {\"summary\":\"…\",\"ops\":[…]} 重新调用，字段名必须是 ops。"
		}
		return w.dispatchCanvasOps(ctx, run, loop, summary, ops)
	case canvasRunGenerationTool().Name:
		fallback := canvasRunGenerationFallbackOps(call.Arguments)
		if len(fallback) == 0 {
			return "canvas_run_generation 调用失败：nodeIds 为空。请先用 canvas_get_state 找到配置节点的 id 再调用。"
		}
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		loop.touched = true
		if !ok {
			loop.pendingOps = append(loop.pendingOps, fallback...)
			return "画布暂时没有响应，生成会在本轮结束后触发。不要重复调用，请直接用中文回复用户。"
		}
		return "工具 canvas_run_generation 的返回：\n" + raw +
			"\n生成是异步的，而且可能需要用户确认消耗。用 canvas_generation_status 查看结果，不要假设已经生成成功。"
	default:
		if !canvasAgentKnownTool(call.Name) {
			return "不存在名为 " + call.Name + " 的工具。可用工具：" + strings.Join(canvasAgentToolNames(), "、") + "。"
		}
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentBrowserTimeout(call.Name))
		if canvasAgentToolMutates(call.Name) {
			loop.touched = true
		}
		if !ok {
			if call.Name == canvasReadStateTool().Name || call.Name == canvasReadSelectionTool().Name || call.Name == canvasExportSnapshotTool().Name {
				return "画布没有及时响应。下面是本轮开始时的快照，请基于它继续：\n" + renderCanvasSnapshot(run.Params)
			}
			if call.Name == canvasGenerationStatusTool().Name {
				return "画布没有及时响应，这一轮查不到生成状态。请告诉用户生成仍在进行，稍后可以自己查看。"
			}
			return "画布没有及时响应，工具 " + call.Name + " 没有执行。请告诉用户刷新页面后再试，不要假装已经完成。"
		}
		return "工具 " + call.Name + " 的返回：\n" + raw
	}
}

func canvasAgentKnownTool(name string) bool {
	for _, tool := range canvasAgentTools() {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func (w *Worker) dispatchCanvasOps(ctx context.Context, run *store.AssistantRun, loop *canvasAgentLoopState, summary string, ops []map[string]any) string {
	arguments, err := json.Marshal(map[string]any{"summary": summary, "ops": ops})
	if err != nil {
		return "canvas_apply_ops 调用失败：参数无法序列化，请简化后重试。"
	}
	raw, ok := w.dispatchCanvasTool(ctx, run, canvasApplyOpsTool().Name, string(arguments), canvasAgentApplyTimeout)
	loop.touched = true
	if strings.TrimSpace(summary) != "" {
		loop.summary = strings.TrimSpace(summary)
	}
	if !ok {
		// Nobody executed them, so hand them to the client for the legacy
		// apply-on-completion path rather than dropping the user's request.
		loop.pendingOps = append(loop.pendingOps, ops...)
		return "画布暂时没有响应，这批操作会在本轮结束后统一应用。不要重复提交同一批操作，请直接用中文回复用户。"
	}
	loop.appliedOps += len(ops)
	return "工具 canvas_apply_ops 的返回：\n" + raw + "\n如果已经满足用户要求，就直接用中文回答，不要再调用工具。"
}

// dispatchCanvasTool asks the browser holding the canvas to execute one tool
// and blocks for its observation. A miss is reported as a failure to dispatch
// rather than an error so the caller can degrade instead of failing the run.
func (w *Worker) dispatchCanvasTool(ctx context.Context, run *store.AssistantRun, name, arguments string, timeout time.Duration) (string, bool) {
	if w.Stream == nil {
		return "", false
	}
	requestID := uuid.NewString()
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind:  "agent",
		Stage: "tool",
		Tool:  &assistantstream.ToolCallEvent{RequestID: requestID, Name: name, Arguments: arguments},
	})
	payload, err := assistantstream.WaitToolResult(ctx, w.Stream, run.ID.String(), requestID, timeout)
	if err != nil || len(payload) == 0 {
		return "", false
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return "", false
	}
	if message := strings.TrimSpace(envelope.Error); message != "" {
		return "执行失败：" + message, true
	}
	return truncateForModel(string(envelope.Result), canvasAgentObservationMaxBytes), true
}

func (w *Worker) retryCanvasAgentAsJSON(
	ctx context.Context,
	client *sub2api.Client,
	run *store.AssistantRun,
	payload []sub2api.Message,
	onUpdate func(text, reasoning string) error,
) (string, error) {
	jsonPayload := []sub2api.Message{{Role: "system", Content: canvasAgentJSONInstructions(run)}}
	jsonPayload = append(jsonPayload, payload[1:]...)
	return client.ChatTextWithImages(ctx, jsonPayload, nil, func(text string) error {
		return onUpdate(text, "")
	})
}

func canvasAgentToolCallTranscript(result sub2api.AgentChatResult) string {
	parts := make([]string, 0, 2)
	if text := strings.TrimSpace(result.Text); text != "" {
		parts = append(parts, text)
	}
	if result.ToolCall != nil {
		parts = append(parts, "调用工具 "+result.ToolCall.Name+"，参数："+truncateForModel(result.ToolCall.Arguments, 2000))
	}
	return strings.Join(parts, "\n")
}

func truncateForModel(text string, limit int) string {
	text = strings.TrimSpace(text)
	if limit <= 0 || len(text) <= limit {
		return text
	}
	return text[:limit] + "…（已截断）"
}

func canvasAgentInstructions(run *store.AssistantRun) string {
	return `你是无限画布助手，全程使用简体中文。
你已经具备画布执行通道 canvas_apply_ops，调用后会直接改用户画布。禁止说「没有工具」「无法执行画布修改」「当前环境不能创建节点」。
纯聊天、分析、解释时正常回答，不调用工具；用户要求创建、修改、删除、连接节点时必须调用 canvas_apply_ops，不要改成口述步骤。

你可以在一轮里多次调用工具，每次调用后都会看到真实结果：
- canvas_get_state / canvas_export_snapshot：读画布最新结构。下面的快照是本轮开始时的，改过之后想确认就再读一次。
- canvas_get_selection：读用户当前选中的节点。用户说「这个/这些/选中的」时先读它。
- canvas_apply_ops：改画布。返回里会带上应用后的节点和连线，发现不对可以再调一次修正。
- canvas_run_generation：触发生成。只有用户明确要求出图/生成时才调用，nodeIds 用配置节点的 id。
- canvas_generation_status：查生成结果。触发后必须查一次再回复，不要凭空说「已生成」。失败了要把失败原因告诉用户。
- canvas_create_attachment_nodes：把本轮聊天里用户上传的图片放到画布上。
- site_navigate：站内跳转，只允许 /、/canvas、/canvas/{id}、/canvas/config、/prompts、/assets。
- canvas_list_projects / prompts_search / assets_list / assets_add：列画布、搜提示词、列或加入我的素材。
确认结果满足用户要求后，用一句中文说明你做了什么，不要再调用工具。

新建多个节点或搭工作流时，只输出一条 create_graph，用 nodes 描述节点、edges 描述连线：
{"summary":"已创建电商生图工作流","ops":[{"type":"create_graph",
 "nodes":[{"key":"a","type":"text","title":"卖点提取","text":"提取商品核心卖点"},{"key":"b","type":"config","title":"生图配置"},{"key":"c","type":"image","title":"主图"}],
 "edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}]}
create_graph 规则：
- 绝对不要写 x、y 坐标，排版由系统按连线方向自动完成。
- key 只是本次响应内的临时名字，edges 必须引用这些 key。
- 节点类型只有 text（文字/提示词）、config（生图配置）、image（图片产物）、group。
- 用户说几个节点就建几个节点；不要把多个步骤压缩进一个节点的文字里。
- 每条生图链路是 text → config → image，多条链路就重复这个结构。

改动画布上已有的节点时，用 add_node / update_node / connect_nodes / delete_node，并使用下面快照里的真实 id。移动用 move_nodes，缩放用 resize_node：
{"type":"move_nodes","items":[{"id":"text-1","dx":80,"dy":0}]}
{"type":"resize_node","id":"image-1","width":420,"height":480}
字段名必须是 ops，一次最多 24 条操作。

` + renderCanvasSnapshot(run.Params)
}

func canvasAgentJSONInstructions(run *store.AssistantRun) string {
	return `只输出一个 JSON 对象，不要 Markdown、代码块或解释。这个 JSON 会被直接应用到无限画布，你不是在口头指导用户。
格式：{"summary":"一句话说明","ops":[...]}
新建节点或工作流时只用一条 create_graph，不要写坐标：
{"summary":"已创建生图流程","ops":[{"type":"create_graph",
 "nodes":[{"key":"a","type":"text","text":"提示词正文"},{"key":"b","type":"config"},{"key":"c","type":"image"}],
 "edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}]}
节点类型只有 text/config/image/group；用户说几个节点就建几个。
` + renderCanvasSnapshot(run.Params)
}

func canvasAgentWantsMutation(prompt string) bool {
	keys := []string{"创建", "新建", "加上", "加一个", "添加", "连接", "连起来", "接到", "删", "改成", "流程", "工作流", "搭建", "从零", "放到", "移动", "补", "出图", "跑一下"}
	for _, key := range keys {
		if strings.Contains(prompt, key) {
			return true
		}
	}
	return false
}

func canvasAgentWantsNewWorkflow(prompt string) bool {
	keys := []string{"搭建", "工作流", "从零", "搭一条", "创建一条", "新建一条", "生图流程", "生成流程"}
	for _, key := range keys {
		if strings.Contains(prompt, key) {
			return true
		}
	}
	return false
}

func canvasAgentLooksLikeRefusal(text string) bool {
	return strings.Contains(text, "没有可用") || strings.Contains(text, "无法执行") ||
		strings.Contains(text, "不能直接") || strings.Contains(text, "没有工具") ||
		strings.Contains(text, "无法创建节点") || strings.Contains(text, "无法在当前") ||
		strings.Contains(text, "不能实际") || strings.Contains(text, "不能声称") ||
		strings.Contains(text, "没有执行接口") || strings.Contains(text, "切换到支持画布") ||
		strings.Contains(text, "无法调用画布")
}

const canvasAgentSteerMutation = "你已经有工具 canvas_apply_ops，立刻调用它，用 create_graph 创建节点。禁止说无法执行、没有接口，也不要让用户切换会话。"

func (w *Worker) recoverCanvasAgentWithoutTools(
	ctx context.Context,
	client *sub2api.Client,
	run *store.AssistantRun,
	payload []sub2api.Message,
	loop *canvasAgentLoopState,
	onUpdate func(text, reasoning string) error,
	upstreamErr error,
) (string, bool) {
	if !canvasAgentIsAuthFailure(upstreamErr) {
		raw, err := w.retryCanvasAgentAsJSON(ctx, client, run, payload, onUpdate)
		if err == nil && strings.TrimSpace(raw) != "" {
			if summary, ops, parseErr := parseCanvasAgentOps(raw); parseErr == nil && len(ops) > 0 {
				w.dispatchCanvasOps(ctx, run, loop, summary, ops)
				return raw, true
			}
		}
	}
	if canvasAgentWantsNewWorkflow(run.Prompt) {
		summary := "已创建生图工作流"
		w.dispatchCanvasOps(ctx, run, loop, summary, canvasAgentFallbackGraphOps(run.Prompt))
		return summary, true
	}
	return "", false
}

func canvasAgentFallbackGraphOps(prompt string) []map[string]any {
	body := canvasAgentQuotedPrompt(prompt)
	if body == "" {
		body = strings.TrimSpace(prompt)
	}
	return []map[string]any{
		{
			"type": "create_graph",
			"nodes": []map[string]any{
				{"key": "a", "type": "text", "title": "提示词", "text": body},
				{"key": "b", "type": "config", "title": "生图配置"},
				{"key": "c", "type": "image", "title": "出图"},
			},
			"edges": []map[string]any{
				{"from": "a", "to": "b"},
				{"from": "b", "to": "c"},
			},
		},
	}
}

func canvasAgentQuotedPrompt(prompt string) string {
	pairs := [][2]string{{"「", "」"}, {"『", "』"}, {"“", "”"}, {"\"", "\""}}
	for _, pair := range pairs {
		start := strings.Index(prompt, pair[0])
		end := strings.LastIndex(prompt, pair[1])
		if start < 0 || end <= start {
			continue
		}
		body := strings.TrimSpace(prompt[start+len(pair[0]) : end])
		if body != "" {
			return body
		}
	}
	return ""
}

func canvasAgentLooksLikeAuthFailure(text string) bool {
	lower := strings.ToLower(text)
	return strings.Contains(lower, "token_invalidated") ||
		strings.Contains(lower, "chat_requirements_prepare") ||
		strings.Contains(lower, "authentication token has been invalidated") ||
		(strings.Contains(lower, "401") && (strings.Contains(lower, "authentication") || strings.Contains(lower, "unauthorized")))
}

func canvasAgentIsAuthFailure(err error) bool {
	return err != nil && canvasAgentLooksLikeAuthFailure(err.Error())
}

func canvasAgentPublicError(err error) string {
	if err == nil {
		return "画布助手处理失败，请重试。"
	}
	if canvasAgentIsAuthFailure(err) {
		return "对话模型认证失效，画布助手暂时连不上模型。请在后台检查对话模型服务商的 API Key。"
	}
	return sanitizeUpstreamMessage(err.Error())
}

func renderCanvasSnapshot(params map[string]any) string {
	raw, ok := params["canvasSnapshot"]
	if !ok || raw == nil {
		return "当前画布快照：空"
	}
	payload, err := json.Marshal(raw)
	if err != nil || len(payload) == 0 || string(payload) == "null" {
		return "当前画布快照：空"
	}
	if len(payload) > 12_000 {
		payload = payload[:12_000]
	}
	return "当前画布快照（结构，不是像素）：\n" + string(payload)
}

func (w *Worker) executeCanvasAgent(
	ctx context.Context,
	client *sub2api.Client,
	run *store.AssistantRun,
	references []string,
	history []*store.AssistantMessage,
) error {
	run.ResolvedMode = "agent"
	if err := store.SetAssistantRunStage(ctx, w.St.Pool, run.ID, "agent", "thinking"); err != nil {
		return err
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "agent", "running",
		assistantMessageMetadata(run, nil, "thinking", "")); err != nil {
		return err
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: "agent", Stage: "thinking"})

	payload := make([]sub2api.Message, 0, len(history)+1)
	payload = append(payload, sub2api.Message{Role: "system", Content: canvasAgentInstructions(run)})
	for _, message := range history {
		if message == nil || message.ID == run.AssistantMessageID || strings.TrimSpace(message.Content) == "" || message.Status == "failed" {
			continue
		}
		if message.Role == "assistant" && canvasAgentLooksLikeRefusal(message.Content) {
			continue
		}
		item := sub2api.Message{Role: message.Role, Content: message.Content}
		if message.ID == run.UserMessageID {
			item.ReferenceImages = references
		}
		payload = append(payload, item)
	}

	lastCheckpoint := time.Now()
	lastPublish := time.Time{}
	lastTerminationCheck := time.Time{}
	answering := false
	onUpdate := func(fullText, reasoning string) error {
		if time.Since(lastTerminationCheck) >= 400*time.Millisecond {
			lastTerminationCheck = time.Now()
			if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
				if err != nil {
					return err
				}
				return context.Canceled
			}
		}
		if !answering {
			if err := store.SetAssistantRunStage(ctx, w.St.Pool, run.ID, "agent", "answering"); err != nil {
				return err
			}
			answering = true
		}
		if fullText != "" && time.Since(lastPublish) >= 50*time.Millisecond {
			lastPublish = time.Now()
			assistantstream.Publish(ctx, w.Stream, run.ID.String(),
				assistantstream.Event{Content: fullText, Kind: "agent", Stage: "answering"})
		}
		if fullText == "" || time.Since(lastCheckpoint) < time.Second {
			return nil
		}
		lastCheckpoint = time.Now()
		return store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, fullText, "agent", "running", assistantMessageMetadata(run, nil, "answering", ""))
	}
	wantsMutation := canvasAgentWantsMutation(run.Prompt)
	loop := canvasAgentLoopState{summary: "", pendingOps: nil}
	var result sub2api.AgentChatResult
	// Waiting on generations can burn minutes, so the loop is bounded by wall
	// clock as well as by iteration count.
	loopDeadline := time.Now().Add(canvasAgentMaxDuration)
	for iteration := 0; iteration < canvasAgentMaxIterations; iteration++ {
		if iteration > 0 && time.Now().After(loopDeadline) {
			break
		}
		forced := ""
		if (iteration == 0 || iteration == 1) && wantsMutation && !loop.touched {
			forced = canvasApplyOpsTool().Name
		}
		next, err := client.ChatAgentWithTools(ctx, payload, nil, canvasAgentTools(), forced, onUpdate)
		if err != nil && forced != "" && ctx.Err() == nil && !canvasAgentIsAuthFailure(err) {
			next, err = client.ChatAgentWithTools(ctx, payload, nil, canvasAgentTools(), "", onUpdate)
		}
		if err != nil {
			if ctx.Err() != nil {
				return err
			}
			if wantsMutation && !loop.touched {
				if text, ok := w.recoverCanvasAgentWithoutTools(ctx, client, run, payload, &loop, onUpdate, err); ok {
					result.Text = text
					break
				}
			}
			return fmt.Errorf("%s", canvasAgentPublicError(err))
		}
		result = next
		if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
			if err != nil {
				return err
			}
			return context.Canceled
		}
		if next.ToolCall == nil {
			if wantsMutation && !loop.touched {
				if summary, ops, parseErr := parseCanvasAgentOps(next.Text); parseErr == nil && len(ops) > 0 {
					w.dispatchCanvasOps(ctx, run, &loop, summary, ops)
					break
				}
				if text, ok := w.recoverCanvasAgentWithoutTools(ctx, client, run, payload, &loop, onUpdate, nil); ok {
					result.Text = text
					break
				}
				if iteration == 0 {
					payload = append(payload,
						sub2api.Message{Role: "assistant", Content: canvasAgentToolCallTranscript(next)},
						sub2api.Message{Role: "user", Content: canvasAgentSteerMutation},
					)
					continue
				}
			}
			break
		}
		observation := w.runCanvasAgentTool(ctx, run, &loop, next.ToolCall)
		payload = append(payload,
			sub2api.Message{Role: "assistant", Content: canvasAgentToolCallTranscript(next)},
			sub2api.Message{Role: "user", Content: observation},
		)
		if err := store.SetAssistantRunStage(ctx, w.St.Pool, run.ID, "agent", "thinking"); err != nil {
			return err
		}
	}

	content := strings.TrimSpace(result.Text)
	if loop.touched {
		if loop.summary == "" {
			loop.summary = "已更新画布。"
		}
		if content == "" || canvasAgentLooksLikeRefusal(content) {
			content = loop.summary
		}
	}
	if content == "" {
		content = "没有收到模型回复，请重试。"
	}
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	if strings.TrimSpace(result.Reasoning) != "" {
		metadata["reasoning"] = result.Reasoning
	}
	// Ops the browser already executed must not be replayed on completion;
	// only the ones nobody applied are handed back for the legacy apply path.
	if len(loop.pendingOps) > 0 {
		metadata["canvasOps"] = loop.pendingOps
	}
	if loop.summary != "" {
		metadata["canvasOpsSummary"] = loop.summary
	}
	if loop.appliedOps > 0 {
		metadata["canvasOpsApplied"] = loop.appliedOps
	}
	kind := "chat"
	if loop.touched {
		kind = "canvas_ops"
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, kind, "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.Complete(ctx, w.St, run.ID, "chat")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Content: content, Kind: kind, Stage: "complete", Done: true, Status: "succeeded",
	})
	return nil
}

func parseCanvasAgentToolResult(result sub2api.AgentChatResult) (string, []map[string]any, bool) {
	tool := canvasApplyOpsTool()
	if result.ToolCall != nil && result.ToolCall.Name == tool.Name {
		summary, ops, err := parseCanvasAgentOps(result.ToolCall.Arguments)
		if err == nil {
			return summary, ops, true
		}
	}
	if summary, ops, err := parseCanvasAgentOps(result.Text); err == nil {
		return summary, ops, true
	}
	return "", nil, false
}

func parseCanvasAgentOps(raw string) (string, []map[string]any, error) {
	raw = strings.TrimSpace(raw)
	objectStart, objectEnd := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	arrayStart, arrayEnd := strings.Index(raw, "["), strings.LastIndex(raw, "]")
	var payload any
	switch {
	case objectStart >= 0 && objectEnd > objectStart && (arrayStart < 0 || objectStart < arrayStart):
		if err := json.Unmarshal([]byte(raw[objectStart:objectEnd+1]), &payload); err != nil {
			return "", nil, err
		}
	case arrayStart >= 0 && arrayEnd > arrayStart:
		if err := json.Unmarshal([]byte(raw[arrayStart:arrayEnd+1]), &payload); err != nil {
			return "", nil, err
		}
	default:
		return "", nil, fmt.Errorf("canvas ops JSON not found")
	}
	summary, ops := canvasOpsFromPayload(payload)
	ops = sanitizeCanvasAgentOps(ops)
	if len(ops) == 0 {
		return summary, nil, fmt.Errorf("canvas ops empty")
	}
	return summary, ops, nil
}

func canvasOpsFromPayload(payload any) (string, []map[string]any) {
	switch typed := payload.(type) {
	case []any:
		return "", mapsFromAny(typed)
	case map[string]any:
		summary, _ := typed["summary"].(string)
		if summary == "" {
			summary, _ = typed["reason"].(string)
		}
		for _, key := range []string{"ops", "operations", "actions", "changes"} {
			if ops := mapsFromAny(typed[key]); len(ops) > 0 {
				return strings.TrimSpace(summary), ops
			}
		}
		if _, hasType := typed["type"]; hasType {
			return strings.TrimSpace(summary), []map[string]any{typed}
		}
		return strings.TrimSpace(summary), nil
	default:
		return "", nil
	}
}

func mapsFromAny(raw any) []map[string]any {
	switch typed := raw.(type) {
	case []map[string]any:
		return typed
	case []any:
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if mapped, ok := item.(map[string]any); ok {
				out = append(out, mapped)
			}
		}
		return out
	case map[string]any:
		return []map[string]any{typed}
	default:
		return nil
	}
}

func flattenCanvasAgentOp(item map[string]any) map[string]any {
	out := map[string]any{}
	for _, key := range []string{"node", "data"} {
		nested, _ := item[key].(map[string]any)
		for field, value := range nested {
			out[field] = value
		}
	}
	for field, value := range item {
		if field == "node" || field == "data" {
			continue
		}
		out[field] = value
	}
	return out
}

func sanitizeCanvasAgentOps(raw []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if len(out) >= canvasAgentMaxOps {
			break
		}
		item = flattenCanvasAgentOp(item)
		opType, _ := item["type"].(string)
		opType = strings.TrimSpace(opType)
		if alias := canvasAgentOpAliases[opType]; alias != "" {
			opType = alias
			item["type"] = opType
		}
		if !canvasAgentOpTypes[opType] {
			if opType == "text" || opType == "image" || opType == "config" || opType == "group" {
				item["nodeType"] = opType
				opType = "add_node"
				item["type"] = opType
			} else {
				continue
			}
		}
		op := map[string]any{"type": opType}
		copyStringField(item, op, "id")
		copyStringField(item, op, "title")
		copyStringField(item, op, "nodeType")
		copyFirstString(item, op, "fromNodeId", "fromNodeId", "fromId", "from", "source", "sourceId", "sourceNodeId")
		copyFirstString(item, op, "toNodeId", "toNodeId", "toId", "to", "target", "targetId", "targetNodeId")
		copyStringField(item, op, "nodeId")
		copyStringField(item, op, "prompt")
		copyStringField(item, op, "mode")
		if ids := stringSliceField(item["ids"]); len(ids) > 0 {
			op["ids"] = ids
		}
		copyNumberField(item, op, "x")
		copyNumberField(item, op, "y")
		copyNumberField(item, op, "width")
		copyNumberField(item, op, "height")
		if position, ok := item["position"].(map[string]any); ok {
			op["position"] = position
		}
		if viewport, ok := item["viewport"].(map[string]any); ok {
			op["viewport"] = viewport
		}
		if metadata, ok := item["metadata"].(map[string]any); ok {
			op["metadata"] = metadata
		}
		if patch, ok := item["patch"].(map[string]any); ok {
			op["patch"] = patch
		}
		if opType == "create_graph" {
			graphNodes := sanitizeCanvasGraphNodes(item["nodes"])
			if len(graphNodes) == 0 {
				continue
			}
			op["nodes"] = graphNodes
			if edges := sanitizeCanvasGraphEdges(item["edges"], item["connections"], item["links"]); len(edges) > 0 {
				op["edges"] = edges
			}
			out = append(out, op)
			continue
		}
		if opType == "move_nodes" {
			items := sanitizeMoveItems(item["items"])
			if len(items) == 0 {
				continue
			}
			op["items"] = items
			out = append(out, op)
			continue
		}
		if opType == "resize_node" {
			if op["id"] == nil || (op["width"] == nil && op["height"] == nil) {
				continue
			}
			if value, ok := item["freeResize"].(bool); ok {
				op["freeResize"] = value
			}
			out = append(out, op)
			continue
		}
		if opType == "add_node" || opType == "update_node" {
			metadata, _ := op["metadata"].(map[string]any)
			if metadata == nil {
				metadata = map[string]any{}
			}
			if _, exists := metadata["content"]; !exists {
				if content, _ := item["content"].(string); strings.TrimSpace(content) != "" {
					metadata["content"] = strings.TrimSpace(content)
				} else if prompt, _ := item["prompt"].(string); strings.TrimSpace(prompt) != "" {
					metadata["content"] = strings.TrimSpace(prompt)
				}
			}
			if len(metadata) > 0 {
				op["metadata"] = metadata
			}
		}
		out = append(out, op)
	}
	return out
}

// sanitizeCanvasGraphNodes keeps only the declarative fields of a create_graph
// node. Coordinates are deliberately dropped: layout is computed from the edge
// direction so the model never has to reason about pixels.
func sanitizeCanvasGraphNodes(raw any) []map[string]any {
	items := mapsFromAny(raw)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if len(out) >= canvasAgentMaxGraphNodes {
			break
		}
		item = flattenCanvasAgentOp(item)
		node := map[string]any{}
		copyFirstString(item, node, "key", "key", "id", "ref", "name")
		if node["key"] == nil {
			node["key"] = fmt.Sprintf("n%d", len(out)+1)
		}
		nodeType := firstStringValue(item, "type", "nodeType", "kind")
		if !canvasAgentNodeTypes[nodeType] {
			nodeType = "text"
		}
		node["type"] = nodeType
		copyFirstString(item, node, "title", "title", "label", "name")
		copyFirstString(item, node, "text", "text", "content", "prompt")
		out = append(out, node)
	}
	return out
}

func sanitizeCanvasGraphEdges(sources ...any) []map[string]any {
	out := make([]map[string]any, 0, canvasAgentMaxGraphEdges)
	for _, source := range sources {
		items, ok := source.([]any)
		if !ok {
			continue
		}
		for _, item := range items {
			if len(out) >= canvasAgentMaxGraphEdges {
				return out
			}
			edge := map[string]any{}
			switch typed := item.(type) {
			case []any:
				if len(typed) < 2 {
					continue
				}
				from, _ := typed[0].(string)
				to, _ := typed[1].(string)
				if strings.TrimSpace(from) == "" || strings.TrimSpace(to) == "" {
					continue
				}
				edge["from"], edge["to"] = strings.TrimSpace(from), strings.TrimSpace(to)
			case map[string]any:
				copyFirstString(typed, edge, "from", "from", "fromKey", "fromNodeId", "source", "sourceId")
				copyFirstString(typed, edge, "to", "to", "toKey", "toNodeId", "target", "targetId")
				if edge["from"] == nil || edge["to"] == nil {
					continue
				}
			default:
				continue
			}
			out = append(out, edge)
		}
	}
	return out
}

func sanitizeMoveItems(raw any) []map[string]any {
	items := mapsFromAny(raw)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		row := map[string]any{}
		copyStringField(item, row, "id")
		if row["id"] == nil {
			continue
		}
		copyNumberField(item, row, "x")
		copyNumberField(item, row, "y")
		copyNumberField(item, row, "dx")
		copyNumberField(item, row, "dy")
		out = append(out, row)
	}
	return out
}

func firstStringValue(src map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, _ := src[key].(string); strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func copyStringField(src, dst map[string]any, key string) {
	value, _ := src[key].(string)
	value = strings.TrimSpace(value)
	if value != "" {
		dst[key] = value
	}
}

func copyFirstString(src, dst map[string]any, destKey string, keys ...string) {
	for _, key := range keys {
		value, _ := src[key].(string)
		value = strings.TrimSpace(value)
		if value != "" {
			dst[destKey] = value
			return
		}
	}
}

func copyNumberField(src, dst map[string]any, key string) {
	switch value := src[key].(type) {
	case float64:
		dst[key] = value
	case json.Number:
		if n, err := value.Float64(); err == nil {
			dst[key] = n
		}
	}
}

func stringSliceField(raw any) []string {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text, _ := item.(string)
		text = strings.TrimSpace(text)
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}
