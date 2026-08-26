package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
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
	canvasAgentMaxOps                 = 24
	canvasAgentMaxGraphNodes          = 128
	canvasAgentMaxGraphEdges          = 256
	canvasAgentMaxRegenerationSources = 80

	canvasAgentMaxIterations       = 10
	canvasAgentMaxDuration         = 8 * time.Minute
	canvasAgentApplyTimeout        = 25 * time.Second
	canvasAgentReadTimeout         = 15 * time.Second
	canvasAgentStatusTimeout       = 75 * time.Second
	canvasAgentObservationMaxBytes = 64_000
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
	"arrange_nodes":          true,
	"move_nodes":             true,
	"resize_node":            true,
}

var canvasAgentNodeTypes = map[string]bool{"text": true, "config": true, "image": true, "group": true}

var canvasAgentAppliedCountPattern = regexp.MustCompile("\"applied\"\\s*:\\s*([0-9]+)")

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
								"enum": []string{"create_graph", "add_node", "update_node", "delete_node", "connect_nodes", "create_generation_flow", "delete_connections", "select_nodes", "set_viewport", "run_generation", "arrange_nodes", "move_nodes", "resize_node"},
							},
							"nodes": map[string]any{
								"type":        "array",
								"description": "create_graph 的节点列表，不要写坐标，排版由系统自动完成",
								"maxItems":    canvasAgentMaxGraphNodes,
								"items": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"key":             map[string]any{"type": "string", "description": "本次响应内的临时标识，供 edges 引用"},
										"type":            map[string]any{"type": "string", "enum": []string{"text", "config", "image", "group"}},
										"title":           map[string]any{"type": "string"},
										"text":            map[string]any{"type": "string", "description": "text 节点的正文，例如提示词"},
										"composerContent": map[string]any{"type": "string", "description": "config 节点真正执行的生成指令；可用 @[node:节点id] 引用已连接输入"},
										"generationMode":  map[string]any{"type": "string", "enum": []string{"text", "image"}, "description": "config 的输出模式；策划、文案、提示词等输出用 text，生图步骤用 image"},
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
							"scope":      map[string]any{"type": "string", "enum": []string{"all", "selection", "workflow"}},
							"workflowId": map[string]any{"type": "string", "description": "scope=workflow 时必填，使用画布快照 workflows 中的精确 id"},
							"direction": map[string]any{
								"type":        "string",
								"enum":        []string{"LR", "TB"},
								"description": "LR 表示从左到右，TB 表示从上到下；按用户明确要求选择",
							},
							"width":    map[string]any{"type": "number"},
							"height":   map[string]any{"type": "number"},
							"position": map[string]any{"type": "object"},
							"viewport": map[string]any{"type": "object"},
							"metadata": map[string]any{"type": "object"},
							"patch": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"title":           map[string]any{"type": "string"},
									"content":         map[string]any{"type": "string", "description": "text 节点正文"},
									"composerContent": map[string]any{"type": "string", "description": "config 节点实际生成指令"},
									"prompt":          map[string]any{"type": "string", "description": "节点提示词"},
									"metadata":        map[string]any{"type": "object"},
								},
							},
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

func canvasReplyTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_reply",
		Description: "用户只是在询问、讨论、要求解释，或需求不清需要追问时使用。content 直接作为给用户的中文回复，不修改画布。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"content": map[string]any{"type": "string", "description": "直接回复用户的简体中文内容"},
			},
			"required":             []string{"content"},
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
		Description: "触发画布上明确指定的配置节点，不等价于运行工作流。nodeIds 传 config 节点 id。返回 requestId 后用 canvas_generation_status 查询本轮结果。费用确认由画布界面统一处理，禁止在聊天里重复询问。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "要触发的节点 id，通常是配置节点"},
				"mode":    map[string]any{"type": "string", "enum": []string{"text", "image", "video", "audio"}},
				"prompt":  map[string]any{"type": "string", "description": "留空则使用节点自身的提示词"},
			},
			"required":             []string{"nodeIds"},
			"additionalProperties": false,
		},
	}
}

func canvasRegenerateSelectionTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_regenerate_selection",
		Description: "将工具执行瞬间画布中选中的全部有效参考图片分别重生成，最多 80 张。节点 ID 由浏览器直接读取实时选区，模型不提供也不能猜测。系统会为每张参考图确定性创建独立的“参考图→配置→新结果”分支并一对一连接，然后由任务队列控制并发；不会覆盖原图，也不会把多张参考图混入同一任务。用户要求对选中图片分别产生新结果时直接调用，不要再口头确认。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"instruction": map[string]any{"type": "string", "description": "对实时选区中每张有效参考图分别执行的完整生成要求"},
			},
			"required":             []string{"instruction"},
			"additionalProperties": false,
		},
	}
}

func canvasGenerationStatusTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_generation_status",
		Description: "按 canvas_run_generation 返回的 requestId 查询本轮生成状态。默认等待一段时间；如果仍为 running/queued，就继续查询。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"requestId":   map[string]any{"type": "string", "description": "canvas_run_generation 返回的本轮 requestId"},
				"nodeIds":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "留空表示查询画布上所有生成任务"},
				"waitSeconds": map[string]any{"type": "number", "description": "最多等待多少秒，0 表示立即返回，默认 20，上限 60"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasRunWorkflowTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_run_workflow",
		Description: "运行画布中的真实工作流调度器，包括依赖顺序、检查点、停止和重跑。workflowId 必须使用画布快照 workflows 中的 id；留空表示运行全部工作流。返回 requestId 后用 canvas_workflow_status 查询。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workflowId": map[string]any{"type": "string", "description": "快照 workflows 中的精确 id，例如 workflow:config-abc；留空运行全部"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasWorkflowStatusTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_workflow_status",
		Description: "按 canvas_run_workflow 返回的 requestId 查询本轮工作流状态，避免把上一轮输出误认为本轮结果。默认等待一段时间。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"requestId":   map[string]any{"type": "string", "description": "canvas_run_workflow 返回的 requestId"},
				"waitSeconds": map[string]any{"type": "number", "description": "最多等待秒数，默认 20，上限 60"},
			},
			"required":             []string{"requestId"},
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
		canvasReplyTool(),
		canvasApplyOpsTool(),
		canvasReadStateTool(),
		canvasReadSelectionTool(),
		canvasExportSnapshotTool(),
		canvasRegenerateSelectionTool(),
		canvasRunGenerationTool(),
		canvasGenerationStatusTool(),
		canvasRunWorkflowTool(),
		canvasWorkflowStatusTool(),
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
	case canvasGenerationStatusTool().Name, canvasWorkflowStatusTool().Name, canvasRegenerateSelectionTool().Name:
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
	case canvasApplyOpsTool().Name, canvasRegenerateSelectionTool().Name, canvasRunGenerationTool().Name, canvasRunWorkflowTool().Name, canvasCreateAttachmentNodesTool().Name, assetsAddTool().Name:
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
	summary         string
	appliedOps      int
	pendingOps      []map[string]any
	touched         bool
	billableAction  bool
	verifiedRead    bool
	verifiedNoop    bool
	userCanceled    bool
	finishAfterTool bool
}

const canvasAgentVerifiedNoopMessage = "已读取并核对当前画布，当前状态已满足要求，无需修改。"

func canvasAgentStateReadTool(name string) bool {
	switch name {
	case canvasReadStateTool().Name, canvasReadSelectionTool().Name, canvasExportSnapshotTool().Name:
		return true
	default:
		return false
	}
}

func canvasAgentExplicitNoopReply(text string) bool {
	compact := strings.ToLower(strings.Join(strings.Fields(text), ""))
	for _, phrase := range []string{
		"无需修改", "不需要修改", "无需改动", "不需要改动", "不用修改", "不用改动",
		"已经满足", "已满足要求", "已经符合", "已符合要求", "无需重新整理", "不需要重新整理",
		"nochangesneeded", "nochangeneeded", "alreadymeetstherequirements", "alreadysatisfiestherequest",
	} {
		if strings.Contains(compact, phrase) {
			return true
		}
	}
	return false
}

func canvasAgentAcceptVerifiedNoop(loop *canvasAgentLoopState, text string) (string, bool) {
	if loop == nil || !loop.verifiedRead || !canvasAgentExplicitNoopReply(text) {
		return "", false
	}
	loop.verifiedNoop = true
	return canvasAgentVerifiedNoopMessage, true
}

func canvasAgentMutationSatisfied(required bool, loop *canvasAgentLoopState) bool {
	if !required {
		return true
	}
	return loop != nil && (loop.appliedOps > 0 || loop.billableAction || loop.verifiedNoop || loop.userCanceled)
}

func canvasAgentToolResultFailed(raw string) bool {
	return strings.HasPrefix(strings.TrimSpace(raw), "执行失败：")
}

func (w *Worker) checkpointCanvasAgentAction(ctx context.Context, run *store.AssistantRun, loop *canvasAgentLoopState) {
	if run == nil || loop == nil || !loop.billableAction {
		return
	}
	fields := map[string]any{"agentBillableAction": true}
	if loop.appliedOps > 0 {
		fields["canvasOpsApplied"] = loop.appliedOps
	}
	_ = store.MergeAssistantMessageMetadata(ctx, w.St.Pool, run.AssistantMessageID, fields)
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
		if !canvasAgentToolResultFailed(raw) {
			loop.billableAction = true
			loop.summary = fmt.Sprintf("已启动 %d 个生成任务，结果会在画布节点中更新。", len(fallback))
			loop.finishAfterTool = true
			w.checkpointCanvasAgentAction(ctx, run, loop)
		}
		return "工具 canvas_run_generation 的返回：\n" + raw +
			"\n生成是异步的，任务已经提交即可结束本轮；不要把任务已启动表述为图片已生成成功。"
	case canvasRegenerateSelectionTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentStatusTimeout)
		if !ok {
			return "画布没有及时响应，分别重生成没有启动。请告诉用户刷新页面后重试，禁止声称已经执行。"
		}
		var response struct {
			Status              string `json:"status"`
			GenerationRequestID string `json:"generationRequestId"`
			Items               []any  `json:"items"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if response.Status == "canceled" {
			loop.userCanceled = true
			loop.summary = "已取消本次生成。"
			loop.finishAfterTool = true
			return "用户在画布费用确认中取消了本次生成。请简短说明已取消，不要再次询问。"
		}
		if canvasAgentToolResultFailed(raw) || response.Status != "started" || len(response.Items) == 0 {
			return "工具 canvas_regenerate_selection 的返回：\n" + raw + "\n本次批量生成没有启动，禁止声称完成。"
		}
		loop.touched = true
		loop.appliedOps += len(response.Items)
		loop.billableAction = true
		loop.summary = fmt.Sprintf("已为 %d 张参考图分别创建一对一生成分支并启动任务，结果会在画布节点中更新。", len(response.Items))
		loop.finishAfterTool = true
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 canvas_regenerate_selection 的返回：\n" + raw +
			"\n批量生成已提交，可以结束本轮；不要继续轮询，也不要把任务已启动表述为图片已全部生成成功。"
	case canvasRunWorkflowTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		loop.touched = true
		if !ok {
			return "画布没有及时响应，工作流没有启动。请告诉用户刷新页面后重试，禁止声称已经执行。"
		}
		if !canvasAgentToolResultFailed(raw) {
			loop.billableAction = true
			loop.summary = "工作流已启动，进度会在画布中更新。"
			loop.finishAfterTool = true
			w.checkpointCanvasAgentAction(ctx, run, loop)
		}
		return "工具 canvas_run_workflow 的返回：\n" + raw +
			"\n工作流是异步的，任务已经提交即可结束本轮；不要把工作流已启动表述为已经执行完成。"
	default:
		if !canvasAgentKnownTool(call.Name) {
			return "不存在名为 " + call.Name + " 的工具。可用工具：" + strings.Join(canvasAgentToolNames(), "、") + "。"
		}
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentBrowserTimeout(call.Name))
		mutates := canvasAgentToolMutates(call.Name)
		if mutates {
			loop.touched = true
		}
		if !ok {
			if call.Name == canvasReadStateTool().Name || call.Name == canvasReadSelectionTool().Name || call.Name == canvasExportSnapshotTool().Name {
				return "画布没有及时响应。下面是本轮开始时的快照，请基于它继续：\n" + renderCanvasSnapshot(run.Params)
			}
			if call.Name == canvasGenerationStatusTool().Name || call.Name == canvasWorkflowStatusTool().Name {
				return "画布没有及时响应，这一轮查不到生成状态。请告诉用户生成仍在进行，稍后可以自己查看。"
			}
			return "画布没有及时响应，工具 " + call.Name + " 没有执行。请告诉用户刷新页面后再试，不要假装已经完成。"
		}
		if canvasAgentStateReadTool(call.Name) && !canvasAgentToolResultFailed(raw) {
			loop.verifiedRead = true
		}
		if mutates && !canvasAgentToolResultFailed(raw) {
			loop.billableAction = true
			w.checkpointCanvasAgentAction(ctx, run, loop)
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
	ops = canvasAgentOpsForPrompt(run.Prompt, ops)
	arguments, err := json.Marshal(map[string]any{"summary": summary, "ops": ops})
	if err != nil {
		return "canvas_apply_ops 调用失败：参数无法序列化，请简化后重试。"
	}
	raw, ok := w.dispatchCanvasTool(ctx, run, canvasApplyOpsTool().Name, string(arguments), canvasAgentApplyTimeout)
	if !ok {
		// Nobody executed them, so hand them to the client for the legacy
		// apply-on-completion path rather than dropping the user's request.
		loop.touched = true
		if strings.TrimSpace(summary) != "" {
			loop.summary = strings.TrimSpace(summary)
		}
		loop.pendingOps = append(loop.pendingOps, ops...)
		return "画布暂时没有响应，这批操作会在本轮结束后统一应用。不要重复提交同一批操作，请直接用中文回复用户。"
	}
	if canvasAgentToolResultFailed(raw) {
		return "工具 canvas_apply_ops 的返回：\n" + raw
	}
	applied := canvasAgentAppliedCount(raw)
	if applied <= 0 {
		return "工具 canvas_apply_ops 的返回：\n" + raw + "\n这批操作没有实际改变画布。" +
			"如果你已通过成功读取确认当前状态本来就满足用户要求，请明确回复“" + canvasAgentVerifiedNoopMessage +
			"”；否则请用最新画布中的准确节点 id 修正，禁止声称已经完成。"
	}
	loop.touched = true
	if strings.TrimSpace(summary) != "" {
		loop.summary = strings.TrimSpace(summary)
	}
	loop.appliedOps += applied
	loop.billableAction = true
	w.checkpointCanvasAgentAction(ctx, run, loop)
	return "工具 canvas_apply_ops 的返回：\n" + raw + "\n如果已经满足用户要求，就直接用中文回答，不要再调用工具。"
}

func canvasAgentOpsForPrompt(prompt string, ops []map[string]any) []map[string]any {
	direction := canvasAgentRequestedLayoutDirection(prompt)
	if direction == "" {
		return ops
	}
	out := make([]map[string]any, len(ops))
	for index, op := range ops {
		if op["type"] != "arrange_nodes" {
			out[index] = op
			continue
		}
		cloned := make(map[string]any, len(op))
		for key, value := range op {
			cloned[key] = value
		}
		cloned["direction"] = direction
		out[index] = cloned
	}
	return out
}

func canvasAgentRequestedLayoutDirection(prompt string) string {
	normalized := strings.ToLower(strings.TrimSpace(prompt))
	for _, marker := range []string{
		"从上到下", "上到下", "纵向布局", "纵向排列", "竖向布局", "竖向排列", "垂直布局", "垂直排列",
		"不要水平", "不再水平", "非水平", "不要横向", "top to bottom", "top-to-bottom", "vertical",
	} {
		if strings.Contains(normalized, marker) {
			return "TB"
		}
	}
	for _, marker := range []string{
		"从左到右", "左到右", "横向布局", "横向排列", "水平布局", "水平排列", "left to right", "left-to-right", "horizontal",
	} {
		if strings.Contains(normalized, marker) {
			return "LR"
		}
	}
	return ""
}

func canvasAgentAppliedCount(raw string) int {
	var body map[string]any
	if json.Unmarshal([]byte(strings.TrimSpace(raw)), &body) == nil {
		if applied, ok := body["applied"].(float64); ok {
			return min(max(int(applied), 0), canvasAgentMaxOps)
		}
	}
	match := canvasAgentAppliedCountPattern.FindStringSubmatch(raw)
	if len(match) == 2 {
		var parsed int
		if _, err := fmt.Sscanf(match[1], "%d", &parsed); err == nil {
			return min(max(parsed, 0), canvasAgentMaxOps)
		}
	}
	return 0
}

// dispatchCanvasTool asks the browser holding the canvas to execute one tool
// and blocks for its observation. A miss is reported as a failure to dispatch
// rather than an error so the caller can degrade instead of failing the run.
func (w *Worker) dispatchCanvasTool(ctx context.Context, run *store.AssistantRun, name, arguments string, timeout time.Duration) (string, bool) {
	if w.Stream == nil {
		return "", false
	}
	requestID := uuid.NewString()
	if w.St == nil || run == nil {
		return "", false
	}
	pendingTool := canvasAgentPendingTool(requestID, name, arguments)
	if err := store.MergeAssistantMessageMetadata(ctx, w.St.Pool, run.AssistantMessageID, map[string]any{
		"pendingTool": pendingTool,
		"statusStage": "tool",
	}); err != nil {
		return "", false
	}
	defer func() {
		_, _ = store.ClearAssistantMessagePendingTool(context.Background(), w.St.Pool, run.AssistantMessageID, requestID)
	}()
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

func canvasAgentPendingTool(requestID, name, arguments string) map[string]any {
	return map[string]any{
		"requestId": requestID,
		"name":      name,
		"arguments": arguments,
		"stage":     "tool",
	}
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

func canvasAgentToolMessages(result sub2api.AgentChatResult, observation string) []sub2api.Message {
	if result.ToolCall == nil {
		return nil
	}
	call := *result.ToolCall
	if strings.TrimSpace(call.ID) == "" {
		call.ID = "call_0"
	}
	return []sub2api.Message{
		{Role: "assistant", Content: result.Text, ToolCalls: []sub2api.ToolCall{call}},
		{Role: "tool", Name: call.Name, ToolCallID: call.ID, Content: observation},
	}
}

func canvasAgentReplyContent(arguments string) string {
	var body struct {
		Content string `json:"content"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(arguments)), &body) != nil {
		return ""
	}
	return strings.TrimSpace(body.Content)
}

func canvasAgentContentIsOpsPayload(content string) bool {
	_, ops, err := parseCanvasAgentOps(content)
	return err == nil && len(ops) > 0
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
每轮先根据用户整段对话的真实意图选择工具，不要用关键词猜意图：
- 纯聊天、分析、解释或需要澄清时调用 canvas_reply，把回答放在 content。
- 用户要求创建、修改、删除、连接、移动节点，或让你把刚才讨论的方案落实到画布时，必须调用 canvas_apply_ops，不要改成口述步骤。
- 读取、生成、跳转、素材等请求调用各自对应的工具。

你可以在一轮里多次调用工具，每次调用后都会看到真实结果：
- canvas_get_state / canvas_export_snapshot：读画布最新结构。下面的快照是本轮开始时的，改过之后想确认就再读一次。
- canvas_get_selection：读用户当前选中的节点。用户说「这个/这些/选中的」时先读它。
- canvas_apply_ops：改画布。返回里会带上应用后的节点和连线，发现不对可以再调一次修正。
- canvas_regenerate_selection：把工具执行瞬间实时选区中的全部有效图片（最多 80 张）分别作为唯一参考图，确定性创建一对一的“参考图→配置→新结果”分支并生成。节点 ID 由浏览器直接读取，禁止在参数中猜测或抄写节点 ID；底层会限制并发并自动排队。用户要求对选中图片分别产生新结果时，读完选区后优先直接调用它，不要自己拼节点，不要再次口头确认。工具成功启动任务后立即结束本轮，生成进度由画布节点展示，不要继续轮询。
- canvas_run_workflow：运行一个完整工作流或全部工作流。用户说「工作流 2」时必须从快照 workflows 找 index=2 的 id，禁止把它猜成第二个配置节点。成功启动后立即结束本轮，进度由画布展示。
- canvas_workflow_status：按本轮工作流 requestId 查状态。只有返回 succeeded 才能说工作流完成。
- canvas_run_generation：只触发明确指定的单个或少量配置节点，不等价于运行工作流。成功启动后立即结束本轮，进度由画布节点展示。
- canvas_generation_status：仅在用户明确要求查询或等待生成结果时调用，并传对应的本轮 requestId；禁止读取节点上一轮的 success 后提前完成。
- canvas_create_attachment_nodes：把本轮聊天里用户上传的图片放到画布上。
- site_navigate：站内跳转，只允许 /、/canvas、/canvas/{id}、/canvas/config、/prompts、/assets。
- canvas_list_projects / prompts_search / assets_list / assets_add：列画布、搜提示词、列或加入我的素材。
确认结果满足用户要求后，用一句中文说明你做了什么，不要再调用工具。
费用确认由画布界面的真实费用确认框处理。用户已经明确要求生成时，禁止通过 canvas_reply 再问“是否确认”“是否继续”；工具返回 canceled 才说明用户取消。
带修改意图的请求只有两种可以完成的结果：canvas_apply_ops 返回 applied 大于 0；或者你先成功读取最新画布，确认现状已经满足要求，并明确回复“` + canvasAgentVerifiedNoopMessage + `” 。没有实际改动时禁止说“已整理”“已修改”或“已完成”。

用户要求「整理、排版、对齐、优化布局」现有画布时，必须读取最新画布后只提交一条 arrange_nodes。默认横向用 LR；用户明确要求纵向、从上到下或不要水平时必须用 TB：
{"summary":"已整理画布布局","ops":[{"type":"arrange_nodes","scope":"all","direction":"LR"}]}
只整理用户选中的节点时 scope 用 selection。整理指定工作流时 scope 用 workflow，并从快照 workflows 取精确 workflowId：
{"summary":"已整理工作流 2","ops":[{"type":"arrange_nodes","scope":"workflow","workflowId":"workflow:config-abc","direction":"LR"}]}
用户说「工作流 N」时按 workflows.index=N 识别；说「这个工作流/选中的工作流」时先读选区，再找 nodeIds 包含这些选中节点的唯一工作流；只有一个工作流时「整理工作流」直接用它。存在多个候选且无法唯一确定时必须先澄清，禁止默认整理全画布。不要为整理任务生成 move_nodes 坐标；系统会根据真实连线、节点尺寸、连通分支、循环和组关系做确定性布局。

新建多个节点或搭工作流时，只输出一条 create_graph，用 nodes 描述节点、edges 描述连线：
{"summary":"已创建电商生图工作流","ops":[{"type":"create_graph",
 "nodes":[{"key":"a","type":"text","title":"商品资料","text":"商品核心卖点"},{"key":"b","type":"config","title":"生图配置","generationMode":"image","composerContent":"根据商品资料生成主图"},{"key":"c","type":"image","title":"主图"}],
 "edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}]}
create_graph 规则：
- 绝对不要写 x、y 坐标，排版由系统按连线方向自动完成。
- key 只是本次响应内的临时名字，edges 必须引用这些 key。
- 节点类型只有 text（文字输入）、config（可执行生成步骤）、image（图片输入或产物）、group。
- 用户说几个节点就建几个节点；不要把多个步骤压缩进一个节点的文字里。
- config 节点才参与工作流调度；text/image 是它的输入或输出资源。基础生图链路是 text → config → image，复杂工作流可以共享上游文字并包含多个 config。
- 每个 config 必须写 generationMode，并连接一个同类型输出：策划、分析、文案、提示词编排等用 text → config(generationMode=text) → text；真正生图才用 text/image → config(generationMode=image) → image。
- 严禁 config → config 直接连线。多步骤必须使用上一步的输出资源连接下一步，例如 config(text) → text → config(image) → image；每个 config 都必须有自己的输出节点。
- text 正文存 content；config 真正用于生成的指令存 composerContent 或 prompt；image 未生成前不得写 content。
- 快照 workflows 与左侧栏「工作流 1/2/…」完全一致，按 index 识别用户提到的编号。

改动画布上已有的节点时，用 add_node / update_node / connect_nodes / delete_node，并使用下面快照里的真实 id。禁止用标题、类型或模糊名称代替 id。用户明确指定移动距离时才用 move_nodes，缩放用 resize_node：
{"type":"move_nodes","items":[{"id":"text-1","dx":80,"dy":0}]}
{"type":"resize_node","id":"image-1","width":420,"height":480}
字段名必须是 ops，一次最多 24 条操作。

` + renderCanvasSnapshot(run.Params)
}

func canvasAgentJSONInstructions(run *store.AssistantRun) string {
	return `只输出一个 JSON 对象，不要 Markdown、代码块或解释。这个 JSON 会被直接应用到无限画布，你不是在口头指导用户。
格式：{"summary":"一句话说明","ops":[...]}
整理现有画布只用 arrange_nodes，不要自己生成移动坐标。默认 direction 用 LR；用户明确要求纵向、从上到下或不要水平时 direction 用 TB。整理指定工作流时 scope=workflow，并使用快照 workflows 中的精确 workflowId。
新建节点或工作流时只用一条 create_graph，不要写坐标：
{"summary":"已创建生图流程","ops":[{"type":"create_graph",
 "nodes":[{"key":"a","type":"text","text":"提示词正文"},{"key":"b","type":"config","generationMode":"image","composerContent":"根据提示词正文生成图片"},{"key":"c","type":"image"}],
 "edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}]}
节点类型只有 text/config/image/group；用户说几个节点就建几个。每个 config 必须写 generationMode=text|image 并连接同类型输出，严禁 config 直接连接 config。
` + renderCanvasSnapshot(run.Params)
}

const (
	canvasCapabilityReply        = "reply"
	canvasCapabilityRead         = "canvas_read"
	canvasCapabilityWrite        = "canvas_write"
	canvasCapabilityGeneration   = "generation"
	canvasCapabilityAttachments  = "attachments"
	canvasCapabilityNavigate     = "navigate"
	canvasCapabilityLibraryRead  = "library_read"
	canvasCapabilityLibraryWrite = "library_write"
)

type canvasAgentCapabilities map[string]bool

const (
	canvasRequiredActionNone       = "none"
	canvasRequiredActionWrite      = canvasCapabilityWrite
	canvasRequiredActionGeneration = canvasCapabilityGeneration
)

type canvasAgentIntent struct {
	Capabilities   canvasAgentCapabilities
	RequiredAction string
}

func canvasAgentCapabilityInstructions() string {
	return `你只负责判断无限画布用户本轮需要哪些能力，不能回答用户，也不能执行任何操作。
结合完整对话理解省略、代词和跟进表达，以最新一条用户消息为最高优先级。
只输出 JSON：{"capabilities":[...],"requiredAction":"..."}
可选能力：reply、canvas_read、canvas_write、generation、attachments、navigate、library_read、library_write。
reply 用于讨论、解释、规划、澄清或普通问答；canvas_read 用于读取画布或选中节点；canvas_write 用于创建、修改、删除、连接、移动或缩放画布；generation 用于触发单节点生成、运行工作流、对选中图片分别重生成或查询本轮结果；attachments 用于把聊天附件放到画布；navigate 用于站内跳转；library_read/library_write 用于读取或写入提示词和素材库。
requiredAction 只能是 none、canvas_write 或 generation：
- 用户只是讨论、询问、读取或查询状态时用 none。
- 用户要求本轮实际改变画布时用 canvas_write。
- 用户要求本轮实际启动生成时用 generation；必须结合上下文识别省略表达和口语跟进，例如“这几张照刚才说的各做一版”“都给我换个干净背景”“可以，开始吧”，不能要求用户包含“生成”等固定关键词。
只返回完成请求所必需的能力，可以返回多个。明确要求只讲方案、不修改或不执行时，requiredAction 必须是 none，且绝不能返回 canvas_write、generation、attachments 或 library_write。拿不准时只返回 reply，requiredAction 用 none。`
}

func canvasAgentIntentFromFallback(prompt string) canvasAgentIntent {
	capabilities := fallbackCanvasAgentCapabilities(prompt)
	requiredAction := canvasRequiredActionNone
	if capabilities[canvasCapabilityGeneration] {
		requiredAction = canvasRequiredActionGeneration
	} else if canvasAgentRequiresMutation(prompt) {
		requiredAction = canvasRequiredActionWrite
	}
	return canvasAgentIntent{Capabilities: capabilities, RequiredAction: requiredAction}
}

func fallbackCanvasAgentCapabilities(prompt string) canvasAgentCapabilities {
	capabilities := canvasAgentCapabilities{canvasCapabilityReply: true}
	if canvasAgentForbidsMutation(prompt) {
		return capabilities
	}
	compact := strings.ToLower(strings.Join(strings.Fields(prompt), ""))
	generationTarget := strings.Contains(compact, "工作流") || strings.Contains(compact, "生图") || strings.Contains(compact, "生成") || strings.Contains(compact, "workflow") || strings.Contains(compact, "generation")
	generationAction := strings.Contains(compact, "执行") || strings.Contains(compact, "运行") || strings.Contains(compact, "重跑") || strings.Contains(compact, "重新运行") || strings.Contains(compact, "重新生成") || strings.Contains(compact, "重生成") || strings.Contains(compact, "再生成") || strings.Contains(compact, "换背景") || strings.Contains(compact, "做变体") || strings.Contains(compact, "run") || strings.Contains(compact, "rerun")
	if generationTarget && generationAction {
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityGeneration] = true
		return capabilities
	}
	canvasObject := strings.Contains(compact, "画布") || strings.Contains(compact, "节点") || strings.Contains(compact, "canvas") || strings.Contains(compact, "nodes")
	writeAction := false
	for _, action := range []string{"整理", "排版", "布局", "排列", "创建", "新增", "添加", "修改", "更新", "删除", "连接", "移动", "缩放", "应用", "执行", "organize", "layout", "rearrange", "create", "add", "update", "delete", "connect", "move", "resize", "apply"} {
		if strings.Contains(compact, action) {
			writeAction = true
			break
		}
	}
	writePhrases := []string{
		"整理画布", "整理一下画布", "把画布整理", "优化画布布局", "重新排版画布", "排列节点", "布局节点",
		"创建节点", "新增节点", "添加节点", "修改节点", "更新节点", "删除节点", "连接节点", "移动节点", "缩放节点",
		"修改画布", "改动画布", "落到画布", "应用到画布", "照刚才的方案做", "按刚才的方案做", "执行刚才的方案",
		"organizecanvas", "layoutnodes", "rearrangecanvas", "applytothecanvas", "updatethecanvas",
	}
	if canvasObject && writeAction {
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityWrite] = true
		return capabilities
	}
	for _, phrase := range writePhrases {
		if strings.Contains(compact, phrase) {
			capabilities[canvasCapabilityRead] = true
			capabilities[canvasCapabilityWrite] = true
			break
		}
	}
	return capabilities
}

func canvasAgentRequiresMutation(prompt string) bool {
	if !fallbackCanvasAgentCapabilities(prompt)[canvasCapabilityWrite] {
		return false
	}
	compact := strings.ToLower(strings.Join(strings.Fields(prompt), ""))
	question := false
	for _, phrase := range []string{
		"如何", "怎么", "怎样", "为什么", "讲讲", "说明一下", "解释一下", "有什么建议", "howto", "howshould", "howwould", "why",
	} {
		if strings.Contains(compact, phrase) {
			question = true
			break
		}
	}
	if !question {
		return true
	}
	// An explicit execution clause wins over an explanatory lead-in, e.g.
	// “怎么整理都行，直接执行”.
	for _, phrase := range []string{
		"直接执行", "直接修改", "立即执行", "马上执行", "照刚才的方案做", "按刚才的方案做", "落到画布",
		"doitnow", "applyit", "makethechange",
	} {
		if strings.Contains(compact, phrase) {
			return true
		}
	}
	return false
}

func canvasAgentRequiresGeneration(prompt string) bool {
	return !canvasAgentForbidsMutation(prompt) && fallbackCanvasAgentCapabilities(prompt)[canvasCapabilityGeneration]
}

func parseCanvasAgentCapabilities(raw string) (canvasAgentCapabilities, error) {
	intent, err := parseCanvasAgentIntent(raw)
	if err != nil {
		return nil, err
	}
	return intent.Capabilities, nil
}

func parseCanvasAgentIntent(raw string) (canvasAgentIntent, error) {
	raw = strings.TrimSpace(raw)
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return canvasAgentIntent{}, fmt.Errorf("capability JSON not found")
	}
	var body struct {
		Capabilities   []string `json:"capabilities"`
		RequiredAction string   `json:"requiredAction"`
	}
	if err := json.Unmarshal([]byte(raw[start:end+1]), &body); err != nil {
		return canvasAgentIntent{}, err
	}
	allowed := map[string]bool{
		canvasCapabilityReply: true, canvasCapabilityRead: true, canvasCapabilityWrite: true,
		canvasCapabilityGeneration: true, canvasCapabilityAttachments: true, canvasCapabilityNavigate: true,
		canvasCapabilityLibraryRead: true, canvasCapabilityLibraryWrite: true,
	}
	capabilities := canvasAgentCapabilities{}
	for _, capability := range body.Capabilities {
		capability = strings.TrimSpace(strings.ToLower(capability))
		if allowed[capability] {
			capabilities[capability] = true
		}
	}
	if len(capabilities) == 0 {
		return canvasAgentIntent{}, fmt.Errorf("capabilities empty")
	}
	requiredAction := strings.TrimSpace(strings.ToLower(body.RequiredAction))
	switch requiredAction {
	case canvasRequiredActionNone:
	case canvasRequiredActionWrite:
		capabilities[canvasCapabilityReply] = true
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityWrite] = true
	case canvasRequiredActionGeneration:
		capabilities[canvasCapabilityReply] = true
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityGeneration] = true
	default:
		return canvasAgentIntent{}, fmt.Errorf("invalid requiredAction %q", body.RequiredAction)
	}
	return canvasAgentIntent{Capabilities: capabilities, RequiredAction: requiredAction}, nil
}

func canvasAgentToolsForCapabilities(capabilities canvasAgentCapabilities) []sub2api.FunctionTool {
	tools := []sub2api.FunctionTool{canvasReplyTool()}
	if capabilities[canvasCapabilityWrite] {
		tools = append(tools, canvasApplyOpsTool())
	}
	if capabilities[canvasCapabilityRead] || capabilities[canvasCapabilityWrite] || capabilities[canvasCapabilityGeneration] || capabilities[canvasCapabilityAttachments] {
		tools = append(tools, canvasReadStateTool(), canvasReadSelectionTool(), canvasExportSnapshotTool())
	}
	if capabilities[canvasCapabilityGeneration] {
		tools = append(tools, canvasRegenerateSelectionTool(), canvasRunGenerationTool(), canvasGenerationStatusTool(), canvasRunWorkflowTool(), canvasWorkflowStatusTool())
	}
	if capabilities[canvasCapabilityAttachments] {
		tools = append(tools, canvasCreateAttachmentNodesTool())
	}
	if capabilities[canvasCapabilityNavigate] {
		tools = append(tools, siteNavigateTool())
	}
	if capabilities[canvasCapabilityRead] || capabilities[canvasCapabilityLibraryRead] {
		tools = append(tools, canvasListProjectsTool())
	}
	if capabilities[canvasCapabilityLibraryRead] || capabilities[canvasCapabilityLibraryWrite] {
		tools = append(tools, promptsSearchTool(), assetsListTool())
	}
	if capabilities[canvasCapabilityLibraryWrite] {
		tools = append(tools, assetsAddTool())
	}
	return tools
}

func canvasAgentToolAllowed(tools []sub2api.FunctionTool, name string) bool {
	for _, tool := range tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func canvasAgentInitialToolChoice(capabilities canvasAgentCapabilities, tools []sub2api.FunctionTool) string {
	if capabilities[canvasCapabilityWrite] {
		// Read the live canvas first. Besides avoiding stale ids, this gives the
		// model a verified no-op path when the requested state is already true.
		if canvasAgentToolAllowed(tools, canvasReadStateTool().Name) {
			return canvasReadStateTool().Name
		}
		return canvasApplyOpsTool().Name
	}
	if len(tools) == 1 {
		return tools[0].Name
	}
	return sub2api.RequiredToolChoice
}

func classifyCanvasAgentIntent(ctx context.Context, client *sub2api.Client, payload []sub2api.Message) (canvasAgentIntent, error) {
	messages := []sub2api.Message{{Role: "system", Content: canvasAgentCapabilityInstructions()}}
	start := 1
	if len(payload)-start > 16 {
		start = len(payload) - 16
	}
	for _, message := range payload[start:] {
		message.ReferenceImages = nil
		messages = append(messages, message)
	}
	raw, err := client.ChatTextWithImages(ctx, messages, nil, nil)
	if err != nil {
		return canvasAgentIntent{}, err
	}
	return parseCanvasAgentIntent(raw)
}

func restrictCanvasAgentIntent(prompt string, intent canvasAgentIntent) canvasAgentIntent {
	intent.Capabilities = restrictCanvasAgentCapabilities(prompt, intent.Capabilities)
	if canvasAgentForbidsMutation(prompt) {
		intent.RequiredAction = canvasRequiredActionNone
	}
	return intent
}

func canvasAgentForbidsMutation(prompt string) bool {
	compact := strings.ToLower(strings.Join(strings.Fields(prompt), ""))
	for _, negatedOptOut := range []string{"不要只讲方案", "别只讲方案", "不要仅讲方案", "不要只解释", "别只解释", "don'texplainonly", "donotexplainonly"} {
		compact = strings.ReplaceAll(compact, negatedOptOut, "")
	}
	// Constraints on existing nodes still permit additive canvas work. Remove
	// those object-scoped phrases before checking for a global mutation opt-out.
	for _, existingNodeConstraint := range []string{
		"不要修改任何已有节点", "不要修改已有节点", "别修改已有节点",
		"不要改动任何现有节点", "不要改动现有节点", "别改动现有节点",
		"donotchangeanyexistingnodes", "donotchangeanyexistingnode",
		"don'tchangeanyexistingnodes", "don'tchangeanyexistingnode",
		"donotchangeexistingnodes", "donotchangeexistingnode",
		"don'tchangeexistingnodes", "don'tchangeexistingnode",
	} {
		compact = strings.ReplaceAll(compact, existingNodeConstraint, "")
	}
	phrases := []string{
		"不要修改画布", "别修改画布", "不要改动画布", "别改动画布", "不要动画布", "别动画布",
		"先不要修改", "先不修改", "暂不修改", "暂时不修改", "不要执行", "别执行", "先不执行",
		"不要应用", "别应用", "只讲方案", "仅讲方案", "只解释", "仅解释",
		"donotmodify", "don'tmodify", "donotchange", "don'tchange", "withoutchanging", "explainonly",
	}
	for _, phrase := range phrases {
		if strings.Contains(compact, phrase) {
			return true
		}
	}
	return false
}

func restrictCanvasAgentCapabilities(prompt string, capabilities canvasAgentCapabilities) canvasAgentCapabilities {
	restricted := canvasAgentCapabilities{}
	for capability, enabled := range capabilities {
		restricted[capability] = enabled
	}
	if !canvasAgentForbidsMutation(prompt) {
		return restricted
	}
	delete(restricted, canvasCapabilityWrite)
	delete(restricted, canvasCapabilityGeneration)
	delete(restricted, canvasCapabilityAttachments)
	delete(restricted, canvasCapabilityLibraryWrite)
	return restricted
}

func canvasAgentLooksLikeRefusal(text string) bool {
	return strings.Contains(text, "没有可用") || strings.Contains(text, "无法执行") ||
		strings.Contains(text, "不能直接") || strings.Contains(text, "没有工具") ||
		strings.Contains(text, "无法创建节点") || strings.Contains(text, "无法在当前") ||
		strings.Contains(text, "不能实际") || strings.Contains(text, "不能声称") ||
		strings.Contains(text, "没有执行接口") || strings.Contains(text, "切换到支持画布") ||
		strings.Contains(text, "无法调用画布")
}

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
	return "", false
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
	payload, _, err := w.prepareAssistantContext(ctx, run, "agent", canvasAgentInstructions(run), history, references, true, "thinking")
	if err != nil {
		return err
	}
	reasoningEffort := assistantParamString(run.Params, "reasoningEffort", "")
	reasoningClient := client.WithReasoningEffort(reasoningEffort)
	loop := canvasAgentLoopState{summary: "", pendingOps: nil}
	intent, intentErr := classifyCanvasAgentIntent(ctx, client, payload)
	if intentErr != nil {
		// Keyword matching is deliberately limited to an availability fallback.
		// Normal routing is based on the model's full-conversation semantic intent.
		intent = canvasAgentIntentFromFallback(run.Prompt)
	}
	intent = restrictCanvasAgentIntent(run.Prompt, intent)
	capabilities := intent.Capabilities
	requiresGeneration := intent.RequiredAction == canvasRequiredActionGeneration
	requiresMutation := requiresGeneration || intent.RequiredAction == canvasRequiredActionWrite

	lastCheckpoint := time.Now()
	lastPublish := time.Time{}
	lastTerminationCheck := time.Time{}
	answering := false
	latestReasoning := ""
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
			if err := w.setAssistantRunStage(ctx, run, "agent", "answering"); err != nil {
				return err
			}
			answering = true
		}
		if strings.TrimSpace(reasoning) != "" {
			latestReasoning = reasoning
		}
		visibleText := fullText
		if requiresMutation && !canvasAgentMutationSatisfied(true, &loop) {
			// A model claim is not user-visible until the write is verified. The UI
			// still receives reasoning and tool-stage events while work is running.
			visibleText = ""
		}
		if (visibleText != "" || latestReasoning != "") && time.Since(lastPublish) >= 50*time.Millisecond {
			lastPublish = time.Now()
			assistantstream.Publish(ctx, w.Stream, run.ID.String(),
				assistantstream.Event{Content: visibleText, Reasoning: latestReasoning, Kind: "agent", Stage: "answering"})
		}
		if (visibleText == "" && latestReasoning == "") || time.Since(lastCheckpoint) < time.Second {
			return nil
		}
		lastCheckpoint = time.Now()
		metadata := assistantMessageMetadata(run, nil, "answering", "")
		if latestReasoning != "" {
			metadata["reasoning"] = latestReasoning
		}
		if loop.billableAction {
			metadata["agentBillableAction"] = true
		}
		if loop.appliedOps > 0 {
			metadata["canvasOpsApplied"] = loop.appliedOps
		}
		return store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, visibleText, "agent", "running", metadata)
	}
	forbidsMutation := canvasAgentForbidsMutation(run.Prompt)
	turnTools := canvasAgentToolsForCapabilities(capabilities)
	allowsCanvasWrite := capabilities[canvasCapabilityWrite]
	var result sub2api.AgentChatResult
	reasoningParts := make([]string, 0, 2)
	var reasoningTokens int64
	// Waiting on generations can burn minutes, so the loop is bounded by wall
	// clock as well as by iteration count.
	loopDeadline := time.Now().Add(canvasAgentMaxDuration)
	for iteration := 0; iteration < canvasAgentMaxIterations; iteration++ {
		if iteration > 0 && time.Now().After(loopDeadline) {
			break
		}
		toolChoice := ""
		if iteration == 0 {
			toolChoice = canvasAgentInitialToolChoice(capabilities, turnTools)
		}
		next, err := reasoningClient.ChatAgentWithTools(ctx, payload, nil, turnTools, toolChoice, onUpdate)
		if err != nil && toolChoice != "" && ctx.Err() == nil && !canvasAgentIsAuthFailure(err) {
			next, err = reasoningClient.ChatAgentWithTools(ctx, payload, nil, turnTools, "", onUpdate)
		}
		if err != nil {
			if ctx.Err() != nil {
				return err
			}
			if allowsCanvasWrite && !loop.touched {
				if text, ok := w.recoverCanvasAgentWithoutTools(ctx, reasoningClient, run, payload, &loop, onUpdate, err); ok {
					result.Text = text
					break
				}
			}
			return fmt.Errorf("%s", canvasAgentPublicError(err))
		}
		result = next
		if nextReasoning := strings.TrimSpace(next.Reasoning); nextReasoning != "" && (len(reasoningParts) == 0 || reasoningParts[len(reasoningParts)-1] != nextReasoning) {
			reasoningParts = append(reasoningParts, nextReasoning)
		}
		reasoningTokens += next.ReasoningTokens
		if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
			if err != nil {
				return err
			}
			return context.Canceled
		}
		if next.ToolCall == nil {
			if requiresMutation && loop.appliedOps == 0 {
				if reply, ok := canvasAgentAcceptVerifiedNoop(&loop, next.Text); ok {
					result.Text = reply
					break
				}
			}
			if requiresGeneration && !canvasAgentMutationSatisfied(true, &loop) {
				payload = append(payload,
					sub2api.Message{Role: "assistant", Content: strings.TrimSpace(next.Text)},
					sub2api.Message{Role: "user", Content: "本轮明确要求对选中图片执行生成，不能只回复或再次询问确认。请先调用 canvas_get_selection，再调用 canvas_regenerate_selection。费用确认由画布界面处理。"},
				)
				if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
					return err
				}
				continue
			}
			if allowsCanvasWrite && !loop.touched {
				if summary, ops, parseErr := parseCanvasAgentOps(next.Text); parseErr == nil && len(ops) > 0 {
					w.dispatchCanvasOps(ctx, run, &loop, summary, ops)
					break
				}
				if text, ok := w.recoverCanvasAgentWithoutTools(ctx, reasoningClient, run, payload, &loop, onUpdate, nil); ok {
					result.Text = text
					break
				}
			}
			break
		}
		if !canvasAgentToolAllowed(turnTools, next.ToolCall.Name) {
			result.Text = "模型请求了本轮未授权的工具，画布没有执行任何改动。"
			break
		}
		if forbidsMutation && canvasAgentToolMutates(next.ToolCall.Name) {
			// Explicit user opt-outs are an execution boundary, not a suggestion to
			// the model. Never dispatch a mutating tool when that boundary is set.
			result.Text = "好的，我先只说明方案，不修改画布。"
			break
		}
		if next.ToolCall.Name == canvasReplyTool().Name {
			reply := canvasAgentReplyContent(next.ToolCall.Arguments)
			if reply == "" {
				reply = strings.TrimSpace(result.Text)
			}
			if requiresMutation && loop.appliedOps == 0 {
				if verifiedReply, ok := canvasAgentAcceptVerifiedNoop(&loop, reply); ok {
					result.Text = verifiedReply
					break
				}
				observation := "回复未被接受：本轮有明确的画布执行意图，但尚无已验证的操作。"
				if requiresGeneration {
					observation += "用户要求对选中图片分别生成时，先调用 canvas_get_selection，再调用 canvas_regenerate_selection；费用确认由画布界面处理，禁止再次口头询问。"
				} else {
					observation += "请调用 canvas_apply_ops；只有成功读取后确认现状已满足要求时，才能明确回复“" + canvasAgentVerifiedNoopMessage + "”。"
				}
				payload = append(payload, canvasAgentToolMessages(next, observation)...)
				if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
					return err
				}
				continue
			}
			if reply != "" {
				result.Text = reply
			} else if strings.TrimSpace(result.Text) == "" {
				result.Text = "请再具体描述一下你希望我在画布上完成什么。"
			}
			break
		}
		observation := w.runCanvasAgentTool(ctx, run, &loop, next.ToolCall)
		payload = append(payload, canvasAgentToolMessages(next, observation)...)
		if loop.finishAfterTool {
			result.Text = loop.summary
			break
		}
		if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
			return err
		}
	}
	if !canvasAgentMutationSatisfied(requiresMutation, &loop) {
		return fmt.Errorf("画布修改未执行：没有检测到已应用的画布变更，也没有经读取确认无需修改")
	}
	if allowsCanvasWrite && !loop.touched && !loop.verifiedNoop && !loop.userCanceled {
		return fmt.Errorf("画布修改未执行：模型没有返回可用的结构化操作")
	}

	content := strings.TrimSpace(result.Text)
	if loop.touched {
		if loop.summary == "" {
			loop.summary = "已更新画布。"
		}
		if content == "" || canvasAgentLooksLikeRefusal(content) || canvasAgentContentIsOpsPayload(content) {
			content = loop.summary
		}
	}
	if content == "" {
		content = "没有收到模型回复，请重试。"
	}
	if len(reasoningParts) > 0 {
		result.Reasoning = strings.Join(reasoningParts, "\n\n")
	} else if strings.TrimSpace(result.Reasoning) == "" {
		result.Reasoning = latestReasoning
	}
	result.ReasoningTokens = reasoningTokens
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	if strings.TrimSpace(result.Reasoning) != "" {
		metadata["reasoning"] = result.Reasoning
	}
	if result.ReasoningTokens > 0 {
		metadata["reasoningTokens"] = result.ReasoningTokens
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
	if loop.billableAction {
		metadata["agentBillableAction"] = true
	}
	kind := "chat"
	if loop.touched {
		kind = "canvas_ops"
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, kind, "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "chat")
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
		copyStringField(item, op, "workflowId")
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
		if opType == "arrange_nodes" {
			scope := firstStringValue(item, "scope")
			if scope != "selection" && scope != "workflow" {
				scope = "all"
			}
			direction := strings.ToUpper(firstStringValue(item, "direction"))
			if direction != "TB" {
				direction = "LR"
			}
			arrangeOp := map[string]any{
				"type":      "arrange_nodes",
				"scope":     scope,
				"direction": direction,
			}
			if scope == "workflow" {
				workflowID := firstStringValue(item, "workflowId")
				if workflowID == "" {
					continue
				}
				arrangeOp["workflowId"] = workflowID
			}
			out = append(out, arrangeOp)
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
	seenKeys := make(map[string]bool, len(items))
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
		key, _ := node["key"].(string)
		if seenKeys[key] {
			return nil
		}
		seenKeys[key] = true
		nodeType := firstStringValue(item, "type", "nodeType", "kind")
		if !canvasAgentNodeTypes[nodeType] {
			nodeType = "text"
		}
		node["type"] = nodeType
		copyFirstString(item, node, "title", "title", "label", "name")
		if nodeType == "text" {
			copyFirstString(item, node, "text", "text", "content", "prompt")
		} else if nodeType == "config" {
			copyFirstString(item, node, "composerContent", "composerContent", "prompt")
			mode := firstStringValue(item, "generationMode", "mode")
			if mode == "text" || mode == "image" {
				node["generationMode"] = mode
			}
		}
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
	store := func(value float64) {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return
		}
		switch key {
		case "width", "height":
			value = math.Min(4096, math.Max(80, value))
		case "x", "y", "dx", "dy":
			value = math.Min(1_000_000, math.Max(-1_000_000, value))
		}
		dst[key] = value
	}
	switch value := src[key].(type) {
	case float64:
		store(value)
	case json.Number:
		if n, err := value.Float64(); err == nil {
			store(n)
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
