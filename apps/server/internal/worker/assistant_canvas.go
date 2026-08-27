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
	canvasAgentMaxPlannedActions      = 12

	canvasAgentMaxIterations       = 24
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
								"description": "create_graph 的连线。新节点使用 nodes.key；也可直接引用画布快照或上一工具返回的现有节点 id，把参考图原子接入新工作流",
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

func canvasFindNodesTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_find_nodes",
		Description: "按标题、ID、类型、状态或工作流查找画布节点。只读取，不修改选区或视口；需要详细依赖时继续调用 canvas_inspect_nodes。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query":      map[string]any{"type": "string", "description": "标题、ID、提示词或节点类型中的搜索内容；留空配合筛选条件列出节点"},
				"types":      map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"statuses":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"workflowId": map[string]any{"type": "string", "description": "限定到快照 workflows 中的精确工作流 id"},
				"offset":     map[string]any{"type": "integer", "minimum": 0, "description": "分页起点，首次为 0，后续使用返回的 nextOffset"},
				"limit":      map[string]any{"type": "integer", "minimum": 1, "maximum": 80},
			},
			"additionalProperties": false,
		},
	}
}

func canvasInspectNodesTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_inspect_nodes",
		Description: "读取指定节点或实时选区的完整可用配置、状态以及上下游节点，不返回图片二进制内容。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "精确节点 id；留空读取实时选区"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasInspectVisualsTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_inspect_visuals",
		Description: "读取真实画布图片并检查重复或高度相似内容。scope=auto 会从实时选区沿连线查找下游图片；没有选区时检查最近输出。用户反馈图片重复、效果不对、主体变化、颜色或构图问题时，必须先调用此工具，禁止未检查就直接重新生成。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"scope":      map[string]any{"type": "string", "enum": []string{"auto", "selection", "workflow", "recent"}, "description": "默认 auto；selection 只看选中图片，workflow 检查指定工作流，recent 检查最近输出"},
				"workflowId": map[string]any{"type": "string", "description": "scope=workflow 时使用快照 workflows 中的精确 id"},
				"nodeIds":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "可选精确起点；留空使用实时选区，模型不确定时不要猜"},
				"maxImages":  map[string]any{"type": "integer", "minimum": 1, "maximum": 12, "description": "单页本地比较上限，默认 12；每页最多 4 张真实图片会送回视觉模型"},
				"offset":     map[string]any{"type": "integer", "minimum": 0, "description": "分页起点，首次为 0；truncated=true 时必须使用返回的 nextOffset 继续检查"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasFocusNodesTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_focus_nodes",
		Description: "选中并把视口平滑定位到指定节点。只改变选区和视口，不修改节点内容。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "精确节点 id；留空聚焦实时选区"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasDuplicateSelectionTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_duplicate_selection",
		Description: "确定性复制指定节点或实时选区，自动生成新 ID、清除运行任务归属、重映射节点引用、组关系和选区内部连线。禁止用 canvas_apply_ops 手工重建副本。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeIds":            map[string]any{"type": "array", "maxItems": 50, "items": map[string]any{"type": "string"}, "description": "精确节点 id；留空复制实时选区"},
				"includeConnections": map[string]any{"type": "boolean", "description": "是否复制选区内部连线，默认 true"},
				"offsetX":            map[string]any{"type": "number", "description": "副本水平偏移，默认 48"},
				"offsetY":            map[string]any{"type": "number", "description": "副本垂直偏移，默认 48"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasReplaceWorkflowInputTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_replace_workflow_input",
		Description: "用另一个现有资源节点或文字替换工作流原始输入，保留目标节点 ID 和连线，清除所有受影响的旧下游输出。runDownstream=true 时仅重跑受影响步骤；工作流运行中会安全拒绝。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"targetNodeId":  map[string]any{"type": "string", "description": "要被替换的原始输入节点精确 id"},
				"sourceNodeId":  map[string]any{"type": "string", "description": "提供新内容的同类型资源节点精确 id"},
				"text":          map[string]any{"type": "string", "description": "替换文字输入时可直接提供正文，与 sourceNodeId 二选一"},
				"runDownstream": map[string]any{"type": "boolean", "description": "替换后是否立即重跑受影响下游；默认 false"},
			},
			"required":             []string{"targetNodeId"},
			"additionalProperties": false,
		},
	}
}

func canvasRunDownstreamTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_run_downstream",
		Description: "从指定节点或实时选区计算真实下游闭包，只重置并运行受影响的可执行步骤。多个工作流或运行中状态会安全拒绝，费用确认由画布界面处理。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"sourceNodeIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "下游重跑起点精确 id；留空使用实时选区"},
				"resetOutputs":  map[string]any{"type": "boolean", "description": "运行前清理受影响旧输出，默认 true"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasListAgentHistoryTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{Name: "canvas_list_agent_history", Description: "列出当前浏览器会话中的 Agent 画布事务、可重做事务和命名检查点，不修改画布。", Parameters: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}}
}

func canvasCreateCheckpointTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{Name: "canvas_create_checkpoint", Description: "为当前画布创建命名 Agent 检查点。检查点只保存在当前浏览器会话，最多保留 10 个。", Parameters: map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": "string"}}, "required": []string{"name"}, "additionalProperties": false}}
}

func canvasRestoreCheckpointTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{Name: "canvas_restore_checkpoint", Description: "按 canvas_list_agent_history 返回的 checkpointId 恢复命名检查点，并把本次恢复记录成可撤销事务。", Parameters: map[string]any{"type": "object", "properties": map[string]any{"checkpointId": map[string]any{"type": "string"}}, "required": []string{"checkpointId"}, "additionalProperties": false}}
}

func canvasRestoreAgentTransactionTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{Name: "canvas_restore_agent_transaction", Description: "恢复到指定 Agent 事务执行前的画布，transactionId 必须来自 canvas_list_agent_history。", Parameters: map[string]any{"type": "object", "properties": map[string]any{"transactionId": map[string]any{"type": "string"}}, "required": []string{"transactionId"}, "additionalProperties": false}}
}

func canvasCreateImageOperationTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_create_image_operation",
		Description: "为明确指定或实时选中的每张图片分别创建可复用的内置图片操作节点，并一对一连接。支持裁剪、切图、本地高清放大、多角度和反推提示词；节点与连线由浏览器生成，禁止自行猜 ID。execute 默认 false，只配置工作流；用户明确要求立即处理时传 true。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"operation":     map[string]any{"type": "string", "enum": []string{"crop", "split", "upscale", "angle", "reverse_prompt"}},
				"sourceNodeIds": map[string]any{"type": "array", "maxItems": canvasAgentMaxRegenerationSources, "items": map[string]any{"type": "string"}, "description": "精确来源图片 id；通常留空让浏览器读取实时选区"},
				"params":        map[string]any{"type": "object", "description": "操作参数。crop: x/y/width/height(0~1)；split: rows/columns；upscale: targetLongEdge/algorithm；angle: horizontalAngle/pitchAngle/cameraDistance/wideAngle"},
				"execute":       map[string]any{"type": "boolean", "description": "是否创建后立即执行。只有用户明确要求立即处理时才为 true"},
			},
			"required":             []string{"operation"},
			"additionalProperties": false,
		},
	}
}

func canvasValidateWorkflowTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_validate_workflow",
		Description: "只读校验一个或全部工作流的可执行节点、依赖层级、循环、无效连接、失败节点和空输入，不启动任务。依据聊天附件搭建工作流时，requiredInputNodeIds 必须传 canvas_create_attachment_nodes 返回的全部图片节点 id，确保每张参考图真实接入可执行节点。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workflowId":           map[string]any{"type": "string", "description": "快照 workflows 中的精确 id；留空校验全部"},
				"requiredInputNodeIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "必须接入目标可执行工作流的输入节点 id；使用工具真实返回值，禁止猜测"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasPlanWorkflowRunTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_plan_workflow_run",
		Description: "只读预检目标工作流下一次真实运行：返回实际待执行节点、已完成检查点、每个节点模型与张数、免费本地步骤、折扣前后预计积分和阻塞原因。不启动任务。多个工作流时必须使用精确 workflowId。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workflowId": map[string]any{"type": "string", "description": "快照 workflows 中的精确 id；只有一个工作流时可留空"},
				"nodeIds":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "可选，只预检目标工作流中的这些精确可执行节点"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasStopWorkflowTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{Name: "canvas_stop_workflow", Description: "停止当前正在执行或排队的工作流，取消属于该工作流的已提交任务并保留检查点。", Parameters: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}}
}

func canvasResumeWorkflowTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{Name: "canvas_resume_workflow", Description: "从画布保存的真实检查点恢复工作流；费用确认仍由画布界面处理。", Parameters: map[string]any{"type": "object", "properties": map[string]any{"workflowId": map[string]any{"type": "string", "description": "快照 workflows 中的精确 id；只有一个工作流时可留空"}}, "additionalProperties": false}}
}

func canvasRetryFailedNodesTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{Name: "canvas_retry_failed_nodes", Description: "通过工作流调度器重试目标工作流中的真实失败节点，并继续其后续依赖；没有失败节点时安全拒绝。", Parameters: map[string]any{"type": "object", "properties": map[string]any{"workflowId": map[string]any{"type": "string", "description": "快照 workflows 中的精确 id；只有一个工作流时可留空"}}, "additionalProperties": false}}
}

func canvasUpdateGenerationSettingsTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_update_generation_settings",
		Description: "只修改现有生图配置节点的参数，不创建节点、不连线、也不启动生成。适用于修改比例、尺寸、质量、分辨率、模型、张数或背景。浏览器会根据实时选区、输出图片的生产节点和工作流确定目标；无法唯一确定时会明确报错。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"scope":      map[string]any{"type": "string", "enum": []string{"auto", "selection", "workflow", "all"}, "description": "默认 auto：优先实时选区；无有效选区且只有一个生图工作流时更新该工作流。all 必须是用户明确要求全部时才用"},
				"workflowId": map[string]any{"type": "string", "description": "目标工作流的精确 id，仅在用户明确指定工作流时传入"},
				"nodeIds":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "明确指定的配置节点或输出图片 id；通常留空，让浏览器读取实时选区"},
				"size":       map[string]any{"type": "string", "description": "图片比例或尺寸，例如 9:16、1024x1792"},
				"resolution": map[string]any{"type": "string", "description": "分辨率档位"},
				"quality":    map[string]any{"type": "string", "description": "质量档位，例如 high"},
				"model":      map[string]any{"type": "string", "description": "生成模型标识"},
				"count":      map[string]any{"type": "integer", "minimum": 1, "description": "每个节点的生成张数"},
				"background": map[string]any{"type": "string", "description": "背景选项"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasUndoLastActionTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_undo_last_action",
		Description: "撤销最近一次仍然有效的 Agent 画布修改事务，恢复该操作前的节点、连线、选区和视口。不猜测节点差异，不撤销生成费用或已经提交的生成任务；如果之后又编辑过节点会安全拒绝。",
		Parameters:  map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
	}
}

func canvasRedoLastActionTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_redo_last_action",
		Description: "重做刚刚由 canvas_undo_last_action 撤销的 Agent 画布修改事务。如果撤销后又编辑过节点会安全拒绝。",
		Parameters:  map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
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

func canvasListWorkflowTemplatesTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_list_workflow_templates",
		Description: "搜索系统工作流模板库，返回精确 templateId、分类和摘要，不创建画布。用户没有给出精确 templateId 时必须先调用此工具。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"keyword":  map[string]any{"type": "string", "description": "标题、行业、平台、交付物或摘要关键词"},
				"category": map[string]any{"type": "string", "description": "模板分类 id 或分类名称"},
				"page":     map[string]any{"type": "number"},
				"pageSize": map[string]any{"type": "number"},
			},
			"additionalProperties": false,
		},
	}
}

func canvasInspectWorkflowTemplateTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_inspect_workflow_template",
		Description: "按 canvas_list_workflow_templates 返回的精确 templateId 查看模板节点、连线、工作流和受限提示词摘要，不创建画布且不返回图片载荷。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"templateId": map[string]any{"type": "string"},
			},
			"required":             []string{"templateId"},
			"additionalProperties": false,
		},
	}
}

func canvasCreateFromWorkflowTemplateTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "canvas_create_from_workflow_template",
		Description: "按模板库返回的精确 templateId 创建新的无限画布项目。不会运行模板或触发生成；成功后返回新项目 id 和 path，需要打开时再调用 site_navigate。禁止猜 templateId。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"templateId": map[string]any{"type": "string"},
				"title":      map[string]any{"type": "string", "description": "可选的新画布标题"},
			},
			"required":             []string{"templateId"},
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

func webSearchTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "web_search",
		Description: "联网检索最新或需要外部核验的公开信息，返回摘要和可点击来源。只有真实调用成功后才能声称已联网；失败时必须向用户说明当前模型线路的真实错误。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query":          map[string]any{"type": "string", "description": "完整、独立、适合搜索引擎理解的检索问题"},
				"recencyDays":    map[string]any{"type": "integer", "minimum": 1, "maximum": 3650, "description": "可选，优先最近多少天的资料"},
				"allowedDomains": map[string]any{"type": "array", "maxItems": 10, "items": map[string]any{"type": "string"}, "description": "可选，只使用这些域名，例如 openai.com"},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
	}
}

func canvasAgentTools() []sub2api.FunctionTool {
	return []sub2api.FunctionTool{
		canvasReplyTool(),
		webSearchTool(),
		canvasApplyOpsTool(),
		canvasReadStateTool(),
		canvasReadSelectionTool(),
		canvasFindNodesTool(),
		canvasInspectNodesTool(),
		canvasInspectVisualsTool(),
		canvasFocusNodesTool(),
		canvasDuplicateSelectionTool(),
		canvasReplaceWorkflowInputTool(),
		canvasRunDownstreamTool(),
		canvasCreateImageOperationTool(),
		canvasUpdateGenerationSettingsTool(),
		canvasUndoLastActionTool(),
		canvasRedoLastActionTool(),
		canvasExportSnapshotTool(),
		canvasRegenerateSelectionTool(),
		canvasRunGenerationTool(),
		canvasGenerationStatusTool(),
		canvasRunWorkflowTool(),
		canvasWorkflowStatusTool(),
		canvasValidateWorkflowTool(),
		canvasPlanWorkflowRunTool(),
		canvasStopWorkflowTool(),
		canvasResumeWorkflowTool(),
		canvasRetryFailedNodesTool(),
		canvasListAgentHistoryTool(),
		canvasCreateCheckpointTool(),
		canvasRestoreCheckpointTool(),
		canvasRestoreAgentTransactionTool(),
		canvasCreateAttachmentNodesTool(),
		siteNavigateTool(),
		canvasListProjectsTool(),
		canvasListWorkflowTemplatesTool(),
		canvasInspectWorkflowTemplateTool(),
		canvasCreateFromWorkflowTemplateTool(),
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
		canvasFindNodesTool().Name, canvasInspectNodesTool().Name, canvasInspectVisualsTool().Name, canvasValidateWorkflowTool().Name, canvasPlanWorkflowRunTool().Name, canvasListAgentHistoryTool().Name,
		canvasListProjectsTool().Name, canvasListWorkflowTemplatesTool().Name, canvasInspectWorkflowTemplateTool().Name, promptsSearchTool().Name, assetsListTool().Name, assetsAddTool().Name,
		siteNavigateTool().Name:
		return canvasAgentReadTimeout
	default:
		return canvasAgentApplyTimeout
	}
}

func canvasAgentToolMutates(name string) bool {
	switch name {
	case canvasApplyOpsTool().Name, canvasFocusNodesTool().Name, canvasDuplicateSelectionTool().Name, canvasReplaceWorkflowInputTool().Name, canvasRunDownstreamTool().Name, canvasCreateImageOperationTool().Name, canvasUpdateGenerationSettingsTool().Name, canvasUndoLastActionTool().Name, canvasRedoLastActionTool().Name, canvasRegenerateSelectionTool().Name, canvasRunGenerationTool().Name, canvasRunWorkflowTool().Name, canvasStopWorkflowTool().Name, canvasResumeWorkflowTool().Name, canvasRetryFailedNodesTool().Name, canvasCreateCheckpointTool().Name, canvasRestoreCheckpointTool().Name, canvasRestoreAgentTransactionTool().Name, canvasCreateAttachmentNodesTool().Name, canvasCreateFromWorkflowTemplateTool().Name, assetsAddTool().Name:
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
	summary                  string
	appliedOps               int
	pendingOps               []map[string]any
	touched                  bool
	billableAction           bool
	verifiedRead             bool
	verifiedNoop             bool
	userCanceled             bool
	finishAfterTool          bool
	lastToolSucceeded        bool
	plannedActions           []canvasAgentPlannedAction
	webSearchClient          *sub2api.Client
	webSearchFailed          bool
	webSearchError           string
	visualReferences         []canvasAgentVisualReference
	attachmentNodeIDs        []string
	requiresVisualInspection bool
	visualInspected          bool
}

type canvasAgentVisualReference struct {
	NodeID        string   `json:"nodeId"`
	ImageID       string   `json:"imageId"`
	ResourceID    string   `json:"resourceId"`
	Title         string   `json:"title"`
	FileKey       string   `json:"fileKey"`
	TemporaryKeys []string `json:"temporaryKeys"`
}

const canvasAgentVerifiedNoopMessage = "已读取并核对当前画布，当前状态已满足要求，无需修改。"

func canvasAgentStateReadTool(name string) bool {
	switch name {
	case canvasReadStateTool().Name, canvasReadSelectionTool().Name, canvasExportSnapshotTool().Name, canvasFindNodesTool().Name, canvasInspectNodesTool().Name, canvasInspectVisualsTool().Name, canvasValidateWorkflowTool().Name, canvasListAgentHistoryTool().Name:
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
	for index := range loop.plannedActions {
		if !loop.plannedActions[index].Completed && loop.plannedActions[index].Capability == canvasCapabilityWrite {
			loop.plannedActions[index].Completed = true
			break
		}
	}
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

func (w *Worker) runCanvasAgentWebSearch(ctx context.Context, run *store.AssistantRun, loop *canvasAgentLoopState, call *sub2api.ToolCall) string {
	var arguments struct {
		Query          string   `json:"query"`
		RecencyDays    int      `json:"recencyDays"`
		AllowedDomains []string `json:"allowedDomains"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(call.Arguments)), &arguments); err != nil || strings.TrimSpace(arguments.Query) == "" {
		return "执行失败：web_search 需要有效的 query。请按 {\"query\":\"完整检索问题\"} 重新调用。"
	}
	if loop == nil || loop.webSearchClient == nil {
		return "执行失败：当前模型线路没有可用的联网搜索客户端，禁止凭记忆冒充联网结果。"
	}

	requestID := uuid.NewString()
	serverToolAvailable := w != nil && w.Stream != nil && w.St != nil && run != nil
	if serverToolAvailable {
		pendingTool := canvasAgentPendingTool(requestID, call.Name, call.Arguments)
		pendingTool["execution"] = "server"
		pendingTool["status"] = "running"
		pendingTool["stage"] = "web_search"
		if err := store.MergeAssistantMessageMetadata(ctx, w.St.Pool, run.AssistantMessageID, map[string]any{
			"pendingTool": pendingTool,
			"statusStage": "web_search",
		}); err == nil {
			assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
				Kind: "agent", Stage: "web_search",
				Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: call.Name, Arguments: call.Arguments, Execution: "server", Status: "running"},
			})
			defer func() {
				_, _ = store.ClearAssistantMessagePendingTool(context.Background(), w.St.Pool, run.AssistantMessageID, requestID)
			}()
		}
	}

	searchCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	result, err := loop.webSearchClient.WebSearch(searchCtx, strings.TrimSpace(arguments.Query), sub2api.WebSearchOptions{
		RecencyDays: arguments.RecencyDays, AllowedDomains: arguments.AllowedDomains,
	})
	if err != nil {
		message := truncateForModel(err.Error(), 1000)
		loop.webSearchFailed = true
		loop.webSearchError = "联网搜索失败：" + message
		if serverToolAvailable {
			assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
				Kind: "agent", Stage: "web_search",
				Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: call.Name, Arguments: call.Arguments, Execution: "server", Status: "failed", Error: message},
			})
		}
		return "执行失败：联网搜索失败：" + message + "。请把这个真实上游错误告诉用户，禁止用模型记忆伪装搜索结果。"
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return "执行失败：联网搜索结果序列化失败：" + err.Error()
	}
	if serverToolAvailable {
		assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
			Kind: "agent", Stage: "web_search",
			Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: call.Name, Arguments: call.Arguments, Execution: "server", Status: "completed", Result: raw},
		})
	}
	loop.lastToolSucceeded = true
	return "工具 web_search 的真实联网结果：\n" + string(raw) + "\n回答时必须保留与结论对应的来源链接；不要添加搜索结果中不存在的事实。"
}

func (w *Worker) runCanvasAgentTool(ctx context.Context, run *store.AssistantRun, loop *canvasAgentLoopState, call *sub2api.ToolCall) string {
	loop.lastToolSucceeded = false
	loop.finishAfterTool = false
	if loop.requiresVisualInspection && !loop.visualInspected && canvasAgentToolMutates(call.Name) {
		return "画布写入或生成调用已拒绝：本轮涉及图片重复或效果问题，必须先调用 canvas_inspect_visuals 读取真实图片，不能未经检查直接修改或重新生成。"
	}
	switch call.Name {
	case webSearchTool().Name:
		return w.runCanvasAgentWebSearch(ctx, run, loop, call)
	case canvasInspectVisualsTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentReadTimeout)
		if !ok {
			return "画布没有及时响应，无法读取真实图片。禁止根据节点标题或提示词猜测图片内容，也不要直接重新生成。"
		}
		var response struct {
			Inspected        int                          `json:"inspected"`
			Truncated        bool                         `json:"truncated"`
			NextOffset       int                          `json:"nextOffset"`
			VisionReferences []canvasAgentVisualReference `json:"visionReferences"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if canvasAgentToolResultFailed(raw) || response.Inspected <= 0 {
			return "工具 canvas_inspect_visuals 的返回：\n" + raw + "\n没有读取到可检查的图片，禁止声称已经看过图片或直接重新生成。"
		}
		loop.verifiedRead = true
		loop.lastToolSucceeded = true
		loop.visualInspected = !response.Truncated
		loop.visualReferences = response.VisionReferences
		if response.Truncated {
			return fmt.Sprintf("工具 canvas_inspect_visuals 的返回：\n%s\n当前只完成一页检查，必须继续调用 canvas_inspect_visuals，并传入 offset=%d；检查完全部图片前禁止修改或生成。", raw, response.NextOffset)
		}
		return "工具 canvas_inspect_visuals 的返回：\n" + raw + "\n重复检测由浏览器基于真实图片完成；随后附加的图片与 visionReferences 顺序一致，请结合像素内容、节点和生产配置继续处理。"
	case canvasValidateWorkflowTool().Name:
		arguments := canvasAgentWorkflowValidationArguments(call.Arguments, loop.attachmentNodeIDs)
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, arguments, canvasAgentReadTimeout)
		if !ok {
			return "画布没有及时响应，无法验证工作流完整性。禁止声称工作流已经完成。"
		}
		var response struct {
			Valid                            bool     `json:"valid"`
			MissingRequiredInputNodeIDs      []string `json:"missingRequiredInputNodeIds"`
			DisconnectedRequiredInputNodeIDs []string `json:"disconnectedRequiredInputNodeIds"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		loop.verifiedRead = true
		if canvasAgentToolResultFailed(raw) || !response.Valid {
			return "工具 canvas_validate_workflow 的返回：\n" + raw + "\n工作流尚未通过完整性校验。必须使用返回的精确节点 id 修复缺失输入、参考图连线或依赖结构，然后重新校验；禁止提前宣布完成。"
		}
		loop.lastToolSucceeded = true
		return "工具 canvas_validate_workflow 的返回：\n" + raw + "\n工作流结构和必需参考输入均已验证，可以总结本轮结果。"
	case canvasCreateAttachmentNodesTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		var response struct {
			Added []string `json:"added"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if !ok || canvasAgentToolResultFailed(raw) || len(response.Added) == 0 {
			return "聊天参考图没有完整放入画布。工具返回：\n" + raw + "\n禁止继续搭建或声称工作流已经完成。"
		}
		loop.touched = true
		loop.appliedOps += len(response.Added)
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.attachmentNodeIDs = uniqueCanvasAgentStrings(append(loop.attachmentNodeIDs, response.Added...))
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 canvas_create_attachment_nodes 的返回：\n" + raw + "\n已记录真实参考图节点 id；搭建工作流后必须校验这些节点全部接入可执行步骤。"
	case canvasApplyOpsTool().Name:
		summary, ops, err := parseCanvasAgentOps(call.Arguments)
		if err != nil || len(ops) == 0 {
			return "canvas_apply_ops 调用失败：没有解析出有效的 ops。请按 {\"summary\":\"…\",\"ops\":[…]} 重新调用，字段名必须是 ops。"
		}
		return w.dispatchCanvasOps(ctx, run, loop, summary, ops)
	case canvasCreateImageOperationTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		if !ok {
			return "画布没有及时响应，图片操作节点没有创建。请告诉用户刷新页面后重试，禁止声称已经执行。"
		}
		var response struct {
			Operation  string `json:"operation"`
			Created    int    `json:"created"`
			Generation any    `json:"generation"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if canvasAgentToolResultFailed(raw) || response.Created <= 0 {
			return "工具 canvas_create_image_operation 的返回：\n" + raw + "\n没有完整创建图片操作节点，禁止声称已经完成。"
		}
		loop.touched = true
		loop.appliedOps += response.Created
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.finishAfterTool = true
		if response.Generation != nil {
			loop.summary = fmt.Sprintf("已为 %d 张图片创建并启动 %s 操作，进度会在画布中更新。", response.Created, response.Operation)
		} else {
			loop.summary = fmt.Sprintf("已为 %d 张图片创建可复用的 %s 操作节点。", response.Created, response.Operation)
		}
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 canvas_create_image_operation 的返回：\n" + raw + "\n节点和一对一连线已由浏览器验证，可以结束本轮。"
	case canvasDuplicateSelectionTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		if !ok {
			return "画布没有及时响应，选中节点没有复制。请告诉用户刷新页面后重试。"
		}
		var response struct {
			Duplicated int `json:"duplicated"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if canvasAgentToolResultFailed(raw) || response.Duplicated <= 0 {
			return "工具 canvas_duplicate_selection 的返回：\n" + raw + "\n没有完整复制选区，禁止声称完成。"
		}
		loop.touched = true
		loop.appliedOps += response.Duplicated
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.finishAfterTool = true
		loop.summary = fmt.Sprintf("已复制 %d 个节点并重映射内部连线和引用。", response.Duplicated)
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 canvas_duplicate_selection 的返回：\n" + raw + "\n复制结果已由浏览器验证，可以结束本轮。"
	case canvasReplaceWorkflowInputTool().Name, canvasRunDownstreamTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		if !ok {
			return "画布没有及时响应，工作流复用操作没有执行。请告诉用户刷新页面后重试。"
		}
		if canvasAgentToolResultFailed(raw) {
			return "工具 " + call.Name + " 的返回：\n" + raw + "\n输入或下游状态没有按要求改变，禁止声称完成。"
		}
		loop.touched = true
		loop.appliedOps++
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.finishAfterTool = true
		if call.Name == canvasReplaceWorkflowInputTool().Name {
			loop.summary = "已替换工作流输入并使受影响的旧下游输出失效。"
		} else {
			loop.summary = "已仅重置并启动受影响的下游工作流节点。"
		}
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 " + call.Name + " 的返回：\n" + raw + "\n操作已由实时依赖图验证，可以结束本轮。"
	case canvasUpdateGenerationSettingsTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		if !ok {
			return "画布没有及时响应，生成参数没有更新。请告诉用户刷新页面后重试，禁止声称已经执行。"
		}
		var response struct {
			Matched   int `json:"matched"`
			Updated   int `json:"updated"`
			Unchanged int `json:"unchanged"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if canvasAgentToolResultFailed(raw) || response.Matched <= 0 {
			return "工具 canvas_update_generation_settings 的返回：\n" + raw + "\n没有找到可更新的目标节点，禁止声称已经完成。"
		}
		loop.finishAfterTool = true
		if response.Updated <= 0 {
			loop.verifiedRead = true
			loop.verifiedNoop = true
			loop.lastToolSucceeded = true
			loop.summary = canvasAgentVerifiedNoopMessage
			return "工具 canvas_update_generation_settings 的返回：\n" + raw + "\n实时节点参数已经满足要求，可以结束本轮。"
		}
		loop.touched = true
		loop.appliedOps += response.Updated
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.summary = fmt.Sprintf("已更新 %d 个生图节点的生成参数。", response.Updated)
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 canvas_update_generation_settings 的返回：\n" + raw + "\n参数已更新；没有新增节点、连线或启动生成，可以结束本轮。"
	case canvasUndoLastActionTool().Name, canvasRedoLastActionTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		if !ok {
			return "画布没有及时响应，节点回退没有执行。请告诉用户刷新页面后重试，禁止声称已经完成。"
		}
		var response struct {
			Restored bool `json:"restored"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if canvasAgentHistoryUnavailable(raw, call.Name == canvasUndoLastActionTool().Name) {
			loop.verifiedRead = true
			loop.verifiedNoop = true
			loop.lastToolSucceeded = true
			loop.finishAfterTool = true
			if call.Name == canvasUndoLastActionTool().Name {
				loop.summary = "当前没有可撤销的 Agent 画布操作，或节点已在之后被修改。"
			} else {
				loop.summary = "当前没有可重做的 Agent 画布操作，或节点已在之后被修改。"
			}
			return "工具 " + call.Name + " 的返回：\n" + raw + "\n浏览器已确认没有可安全回退的事务，请直接说明原因，不要重复调用。"
		}
		if canvasAgentToolResultFailed(raw) || !response.Restored {
			return "工具 " + call.Name + " 的返回：\n" + raw + "\n没有执行有效回退，禁止声称已经完成。"
		}
		undo := call.Name == canvasUndoLastActionTool().Name
		loop.touched = true
		loop.appliedOps++
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.finishAfterTool = true
		if undo {
			loop.summary = "已撤销上一次 Agent 画布操作。"
		} else {
			loop.summary = "已重做上一次 Agent 画布操作。"
		}
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 " + call.Name + " 的返回：\n" + raw + "\n回退事务已由浏览器验证并应用，可以结束本轮。"
	case canvasCreateCheckpointTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		if !ok || canvasAgentToolResultFailed(raw) {
			return "命名检查点没有创建成功。工具返回：\n" + raw
		}
		loop.touched = true
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.finishAfterTool = true
		loop.summary = "已为当前画布创建命名 Agent 检查点。"
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 canvas_create_checkpoint 的返回：\n" + raw + "\n检查点已保存到当前浏览器会话。"
	case canvasRestoreCheckpointTool().Name, canvasRestoreAgentTransactionTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		var response struct {
			Restored bool `json:"restored"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if !ok || canvasAgentToolResultFailed(raw) || !response.Restored {
			return "历史恢复没有执行。工具返回：\n" + raw
		}
		loop.touched = true
		loop.appliedOps++
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.finishAfterTool = true
		loop.summary = "已恢复指定的 Agent 画布历史状态。"
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 " + call.Name + " 的返回：\n" + raw + "\n历史状态已恢复并记录为新的可撤销事务。"
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
			loop.lastToolSucceeded = true
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
			loop.lastToolSucceeded = true
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
		loop.lastToolSucceeded = true
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
			loop.lastToolSucceeded = true
			loop.summary = "工作流已启动，进度会在画布中更新。"
			loop.finishAfterTool = true
			w.checkpointCanvasAgentAction(ctx, run, loop)
		}
		return "工具 canvas_run_workflow 的返回：\n" + raw +
			"\n工作流是异步的，任务已经提交即可结束本轮；不要把工作流已启动表述为已经执行完成。"
	case canvasStopWorkflowTool().Name, canvasResumeWorkflowTool().Name, canvasRetryFailedNodesTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		if !ok {
			return "画布没有及时响应，工作流控制没有执行。请告诉用户刷新页面后重试，禁止声称已经完成。"
		}
		if canvasAgentToolResultFailed(raw) {
			return "工具 " + call.Name + " 的返回：\n" + raw + "\n工作流状态没有改变，禁止声称已经完成。"
		}
		loop.touched = true
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.finishAfterTool = true
		switch call.Name {
		case canvasStopWorkflowTool().Name:
			loop.summary = "已请求停止当前工作流，正在取消已提交任务。"
		case canvasResumeWorkflowTool().Name:
			loop.summary = "已从检查点恢复工作流，进度会在画布中更新。"
		default:
			loop.summary = "已通过工作流调度器重试失败节点。"
		}
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 " + call.Name + " 的返回：\n" + raw + "\n工作流控制请求已经提交，可以结束本轮。"
	case canvasCreateFromWorkflowTemplateTool().Name:
		raw, ok := w.dispatchCanvasTool(ctx, run, call.Name, call.Arguments, canvasAgentApplyTimeout)
		var response struct {
			Created bool   `json:"created"`
			ID      string `json:"id"`
			Path    string `json:"path"`
			Title   string `json:"title"`
		}
		_ = json.Unmarshal([]byte(raw), &response)
		if !ok || canvasAgentToolResultFailed(raw) || !response.Created || strings.TrimSpace(response.ID) == "" || strings.TrimSpace(response.Path) == "" {
			return "工作流模板没有创建成功。工具返回：\n" + raw + "\n禁止声称已经创建画布。"
		}
		loop.touched = true
		loop.appliedOps++
		loop.billableAction = true
		loop.lastToolSucceeded = true
		loop.summary = "已从工作流模板创建新画布「" + strings.TrimSpace(response.Title) + "」。"
		w.checkpointCanvasAgentAction(ctx, run, loop)
		return "工具 canvas_create_from_workflow_template 的返回：\n" + raw + "\n新画布已创建但没有运行任何生成任务；需要打开时下一步调用 site_navigate，并使用返回的精确 path。"
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
			loop.lastToolSucceeded = true
		}
		if mutates && !canvasAgentToolResultFailed(raw) {
			loop.billableAction = true
			loop.lastToolSucceeded = true
			w.checkpointCanvasAgentAction(ctx, run, loop)
		}
		return "工具 " + call.Name + " 的返回：\n" + raw
	}
}

func canvasAgentHistoryUnavailable(raw string, undo bool) bool {
	phrases := []string{"画布已在之后被修改"}
	if undo {
		phrases = append(phrases, "没有可撤销", "撤销失败")
	} else {
		phrases = append(phrases, "没有可重做", "重做失败")
	}
	for _, phrase := range phrases {
		if strings.Contains(raw, phrase) {
			return true
		}
	}
	return false
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
			"”；否则必须使用返回 snapshot 中的准确节点 id 修正，禁止重放原参数。新建多个节点或工作流时使用单个 create_graph，通过 nodes.key 和 edges 原子创建。"
	}
	var response struct {
		Rejected int `json:"rejected"`
	}
	_ = json.Unmarshal([]byte(raw), &response)
	loop.touched = true
	if strings.TrimSpace(summary) != "" {
		loop.summary = strings.TrimSpace(summary)
	}
	loop.appliedOps += applied
	loop.billableAction = true
	loop.lastToolSucceeded = true
	w.checkpointCanvasAgentAction(ctx, run, loop)
	if response.Rejected > 0 {
		return "工具 canvas_apply_ops 的返回：\n" + raw + "\n本批只有部分操作生效。使用返回 snapshot 修正被拒绝的引用，禁止重放整批参数或猜节点 id；新建图必须改用单个 create_graph。"
	}
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

func (w *Worker) consumeCanvasAgentVisualContext(ctx context.Context, run *store.AssistantRun, loop *canvasAgentLoopState) *sub2api.Message {
	if run == nil || loop == nil {
		return nil
	}
	references := loop.visualReferences
	loop.visualReferences = nil
	if len(references) == 0 {
		if !loop.visualInspected {
			return &sub2api.Message{Role: "user", Content: "真实图片检查没有成功，禁止声称已经比较或看过图片，也不能据此修改或重新生成。"}
		}
		return &sub2api.Message{Role: "user", Content: "视觉检查完成了浏览器端重复检测，但这些图片没有可供模型读取的云端文件。只能依据工具返回的确定性重复结果继续，禁止声称已经看过图片像素；涉及主体、颜色或构图判断时应明确告诉用户图片尚未同步。"}
	}
	allowed := make([]canvasAgentVisualReference, 0, min(len(references), 4))
	raw := make([]any, 0, min(len(references), 4))
	temporaryKeys := make([]string, 0, 8)
	for _, reference := range references {
		key := strings.TrimSpace(reference.FileKey)
		if !canvasAgentVisualReferenceAllowed(run.UserID, key) {
			continue
		}
		allowed = append(allowed, reference)
		raw = append(raw, map[string]any{"fileKey": key})
		for _, temporaryKey := range reference.TemporaryKeys {
			temporaryKey = strings.TrimSpace(temporaryKey)
			if canvasAgentTemporaryVisualKeyAllowed(run.UserID, temporaryKey) {
				temporaryKeys = append(temporaryKeys, temporaryKey)
			}
		}
		if len(allowed) >= 4 {
			break
		}
	}
	if len(allowed) == 0 {
		return &sub2api.Message{Role: "user", Content: "视觉检查完成了本地重复检测，但没有取得可供模型查看的云端图片。只能依据工具返回的确定性重复结果继续，禁止声称已经看过图片像素。"}
	}
	images, err := w.loadAssistantReferences(ctx, map[string]any{"referenceImages": raw})
	if len(temporaryKeys) > 0 && w.Storage != nil {
		_ = w.Storage.DeleteKeys(ctx, uniqueCanvasAgentStrings(temporaryKeys))
	}
	if err != nil || len(images) != len(allowed) {
		return &sub2api.Message{Role: "user", Content: "视觉检查已定位图片节点，但真实图片读取失败。禁止根据标题、提示词或旧输出猜测画面，也不要未经检查直接重新生成。"}
	}
	lines := make([]string, 0, len(allowed)+1)
	lines = append(lines, "以下是真实画布图片，不是节点文字摘要。图片顺序与映射如下：")
	for index, reference := range allowed {
		lines = append(lines, fmt.Sprintf("图%d：nodeId=%q，imageId=%q，resourceId=%q，title=%q", index+1, reference.NodeID, reference.ImageID, reference.ResourceID, reference.Title))
	}
	lines = append(lines, "请结合像素内容和工具返回的重复检测结果判断问题；修改时使用映射中的真实节点或其 producerNodeId，禁止猜节点 ID。")
	return &sub2api.Message{Role: "user", Content: strings.Join(lines, "\n"), ReferenceImages: images}
}

func canvasAgentVisualReferenceAllowed(userID uuid.UUID, key string) bool {
	user := userID.String()
	return strings.HasPrefix(key, "uploads/"+user+"/") || strings.HasPrefix(key, "tasks/"+user+"/") || strings.HasPrefix(key, "canvas-template-assets/")
}

func canvasAgentTemporaryVisualKeyAllowed(userID uuid.UUID, key string) bool {
	return strings.HasPrefix(key, "uploads/"+userID.String()+"/")
}

func uniqueCanvasAgentStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; value == "" || exists {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

func canvasAgentWorkflowValidationArguments(arguments string, requiredInputNodeIDs []string) string {
	if len(requiredInputNodeIDs) == 0 {
		return arguments
	}
	input := map[string]any{}
	_ = json.Unmarshal([]byte(strings.TrimSpace(arguments)), &input)
	merged := append([]string(nil), requiredInputNodeIDs...)
	if existing, ok := input["requiredInputNodeIds"].([]any); ok {
		for _, value := range existing {
			if nodeID := strings.TrimSpace(fmt.Sprint(value)); nodeID != "" {
				merged = append(merged, nodeID)
			}
		}
	}
	input["requiredInputNodeIds"] = uniqueCanvasAgentStrings(merged)
	raw, err := json.Marshal(input)
	if err != nil {
		return arguments
	}
	return string(raw)
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
你已经具备画布执行工具，调用后会直接改用户画布。禁止说「没有工具」「无法执行画布修改」「当前环境不能创建节点」。
每轮先根据用户整段对话的真实意图选择工具，不要用关键词猜意图：
- 纯聊天、分析、解释或需要澄清时调用 canvas_reply，把回答放在 content。
- 用户只要求修改现有生图节点的比例、尺寸、质量、分辨率、模型、张数或背景时，必须调用 canvas_update_generation_settings。
- 用户要求裁剪、切图、高清放大、多角度或反推提示词时，必须调用 canvas_create_image_operation，由浏览器读取实时选区并创建内置操作节点，禁止用 canvas_apply_ops 创建普通 config 冒充。
- 用户要求复制节点或工作流分支时调用 canvas_duplicate_selection；要求换输入后复用工作流或只重跑受影响下游时调用 canvas_replace_workflow_input / canvas_run_downstream。禁止由模型生成副本 ID 或猜下游范围。
- 用户要求撤销、回退、还原上一次 Agent 画布操作时调用 canvas_undo_last_action；要求恢复刚刚撤销的操作时调用 canvas_redo_last_action。禁止用 canvas_apply_ops 猜测反向操作。
- 其他创建、修改、删除、连接、移动节点，或把刚才讨论的方案落实到画布时，调用 canvas_apply_ops，不要改成口述步骤。
- 用户要求联网、查网页、核验外部信息，或问题依赖最新事实时必须调用 web_search；没有成功返回就不能声称已联网。稳定常识和纯画布任务不要无意义联网。
- 读取、生成、跳转、素材等请求调用各自对应的工具。

你可以在一轮里多次调用工具，每次调用后都会看到真实结果：
- canvas_get_state / canvas_export_snapshot：读画布最新结构。下面的快照是本轮开始时的，改过之后想确认就再读一次。
- canvas_get_selection：读用户当前选中的节点。用户说「这个/这些/选中的」时先读它。
- canvas_find_nodes / canvas_inspect_nodes：在大画布中按语义查找节点，并读取准确配置和上下游依赖。找到后需要定位时调用 canvas_focus_nodes。
- canvas_inspect_visuals：读取真实图片像素并做确定性重复检测。scope=auto 会从实时选区追踪下游输出；选中文字或配置节点时也能找到其生成图片。用户反馈图片重复、相似、效果不对、主体变化、颜色或构图问题时必须先调用；工具返回后会附上最多 4 张真实图片及 nodeId/imageId 映射。truncated=true 时必须用 nextOffset 继续分页，全部检查完成前禁止修改或生成。禁止只凭 hasContent、标题或提示词声称看过图片，也禁止未检查就直接重新生成。
- canvas_duplicate_selection：复制指定节点或实时选区，浏览器负责 ID、组关系、节点引用、任务归属和内部连线重映射。
- canvas_replace_workflow_input：保留目标输入节点 ID 和连线，用现有资源或文字替换内容，并使所有受影响旧输出失效；runDownstream=true 时只重跑真实下游。canvas_run_downstream 可从任意选中起点定向重跑。运行中的工作流必须先停止。
- canvas_create_image_operation：为每张来源图片创建独立的内置操作节点和准确连线。只搭工作流时 execute=false；用户明确要求立即处理时 execute=true。裁剪、切图、本地放大不应改造成付费生图 config，多角度和反推提示词仍走现有生成费用确认。
- canvas_update_generation_settings：只更新已有生图配置。它会读取实时选区并把选中的输出图片映射回其生产配置；没有有效选区且只有一个生图工作流时更新该工作流。参数修改请求禁止改用 create_graph、add_node、connect_nodes、生成工具，也禁止自动启动生成。用户明确说“全部/所有”时才传 scope=all。
- canvas_undo_last_action / canvas_redo_last_action：按浏览器保存的完整 Agent 事务撤销或重做。工具拒绝时说明没有可用历史或后续编辑导致历史失效，不要自行删除、重建节点来模拟回退。
- canvas_list_agent_history / canvas_create_checkpoint / canvas_restore_checkpoint / canvas_restore_agent_transaction：管理当前浏览器会话内最多 30 步 Agent 事务和 10 个命名检查点。恢复时必须使用列表返回的精确 id。
- canvas_list_workflow_templates / canvas_inspect_workflow_template：搜索并检查系统工作流模板，只返回受限结构摘要。canvas_create_from_workflow_template 必须使用列表返回的精确 templateId 创建新画布，不会启动生成；返回 path 后，用户要求打开时再调用 site_navigate。
- canvas_apply_ops：改画布。返回里会带上应用后的节点和连线，发现不对可以再调一次修正。
- canvas_regenerate_selection：把工具执行瞬间实时选区中的全部有效图片（最多 80 张）分别作为唯一参考图，确定性创建一对一的“参考图→配置→新结果”分支并生成。节点 ID 由浏览器直接读取，禁止在参数中猜测或抄写节点 ID；底层会限制并发并自动排队。用户要求对选中图片分别产生新结果时，读完选区后优先直接调用它，不要自己拼节点，不要再次口头确认。工具成功启动任务后立即结束本轮，生成进度由画布节点展示，不要继续轮询。
- canvas_run_workflow：运行一个完整工作流或全部工作流。用户说「工作流 2」时必须从快照 workflows 找 index=2 的 id，禁止把它猜成第二个配置节点。成功启动后立即结束本轮，进度由画布展示。
- canvas_validate_workflow：只检查依赖、空输入、失败节点和结构问题，不执行。依据聊天参考图新建完整工作流时，必须把 canvas_create_attachment_nodes 返回的全部图片节点 id 作为 requiredInputNodeIds 校验；valid=true 后才能宣布完成。canvas_stop_workflow 停止当前工作流；canvas_resume_workflow 从真实检查点恢复；canvas_retry_failed_nodes 只重试实际失败节点。禁止用修改节点状态模拟停止或恢复。
- canvas_plan_workflow_run：只读预检下一次真实运行，费用和就绪状态与画布运行器共用同一套逻辑。用户问会运行哪些节点、是否可运行或需要多少积分时调用它；禁止根据模型名称自行计算价格。
- canvas_workflow_status：按本轮工作流 requestId 查状态。只有返回 succeeded 才能说工作流完成。
- canvas_run_generation：只触发明确指定的单个或少量配置节点，不等价于运行工作流。成功启动后立即结束本轮，进度由画布节点展示。
- canvas_generation_status：仅在用户明确要求查询或等待生成结果时调用，并传对应的本轮 requestId；禁止读取节点上一轮的 success 后提前完成。
- canvas_create_attachment_nodes：把本轮聊天里用户上传的图片放到画布上。依据附件搭工作流时保存返回的全部 added 节点 id；下一次 create_graph 的 edges 可直接引用这些现有 id，把每张参考图连接到对应的新配置节点，最后用 canvas_validate_workflow.requiredInputNodeIds 校验全部引用。
- site_navigate：站内跳转，只允许 /、/canvas、/canvas/{id}、/canvas/config、/prompts、/assets。
- canvas_list_projects / prompts_search / assets_list / assets_add：列画布、搜提示词、列或加入我的素材。
- web_search：由服务端直接联网检索，返回 text、实际 query 和 sources。最终答复必须让来源链接清晰可点击；搜索失败时原样说明真实上游错误，禁止用记忆补成“搜索结果”。用户要求把资料写入画布时，必须先搜索，再根据搜索结果调用画布写入工具。
确认结果满足用户要求后，用一句中文说明你做了什么，不要再调用工具。
费用确认由画布界面的真实费用确认框处理。用户已经明确要求生成时，禁止通过 canvas_reply 再问“是否确认”“是否继续”；工具返回 canceled 才说明用户取消。
带修改意图的请求只有两种可以完成的结果：对应修改工具返回实际更新数量大于 0；或者成功读取最新画布并确认现状已经满足要求。没有实际改动时禁止说“已整理”“已修改”或“已完成”。

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
- key 是本次响应内的新节点临时名字；edges 可引用这些 key，也可引用刚从画布读取或 canvas_create_attachment_nodes 返回的现有节点 id。依据参考图搭工作流时必须在同一条 create_graph 中把全部参考图 id 连到对应配置节点，禁止先创建空工作流、结束前再口头声称已接入。
- 节点类型只有 text（文字输入）、config（可执行生成步骤）、image（图片输入或产物）、group。
- 用户说几个节点就建几个节点；不要把多个步骤压缩进一个节点的文字里。
- config 节点才参与工作流调度；text/image 是它的输入或输出资源。基础生图链路是 text → config → image，复杂工作流可以共享上游文字并包含多个 config。
- 每个 config 必须写 generationMode，并连接一个同类型输出：策划、分析、文案、提示词编排等用 text → config(generationMode=text) → text；真正生图才用 text/image → config(generationMode=image) → image。
- 严禁 config → config 直接连线。多步骤必须使用上一步的输出资源连接下一步，例如 config(text) → text → config(image) → image；每个 config 都必须有自己的输出节点。
- text 正文存 content；config 真正用于生成的指令存 composerContent 或 prompt；image 未生成前不得写 content。
- 快照 workflows 与左侧栏「工作流 1/2/…」完全一致，按 index 识别用户提到的编号。

除生图参数外，改动画布上已有的节点时，用 add_node / update_node / connect_nodes / delete_node，并使用下面快照里的真实 id。禁止用标题、类型或模糊名称代替 id。用户明确指定移动距离时才用 move_nodes，缩放用 resize_node：
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
	canvasCapabilityReply              = "reply"
	canvasCapabilityRead               = "canvas_read"
	canvasCapabilityVisualInspection   = "visual_inspection"
	canvasCapabilityWorkflowValidation = "workflow_validation"
	canvasCapabilityWrite              = "canvas_write"
	canvasCapabilityImageOperation     = "image_operation"
	canvasCapabilityWorkflowReuse      = "workflow_reuse"
	canvasCapabilityHistory            = "canvas_history"
	canvasCapabilityHistoryWrite       = "canvas_history_write"
	canvasCapabilityTemplateRead       = "workflow_template_read"
	canvasCapabilityTemplateWrite      = "workflow_template_write"
	canvasCapabilityGenerationSettings = "generation_settings"
	canvasCapabilityUndo               = "canvas_undo"
	canvasCapabilityRedo               = "canvas_redo"
	canvasCapabilityGeneration         = "generation"
	canvasCapabilityAttachments        = "attachments"
	canvasCapabilityNavigate           = "navigate"
	canvasCapabilityLibraryRead        = "library_read"
	canvasCapabilityLibraryWrite       = "library_write"
	canvasCapabilityWeb                = "web_search"
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
	Actions        []canvasAgentPlannedAction
}

type canvasAgentPlannedAction struct {
	ID             string `json:"id"`
	Capability     string `json:"capability"`
	RequiredAction string `json:"requiredAction"`
	Description    string `json:"description"`
	Completed      bool   `json:"-"`
}

func canvasAgentCapabilityInstructions() string {
	return `你只负责判断无限画布用户本轮需要哪些能力并拆分执行目标，不能回答用户，也不能执行任何操作。
结合完整对话理解省略、代词和跟进表达，以最新一条用户消息为最高优先级。
只输出 JSON：{"capabilities":[...],"requiredAction":"...","actions":[{"id":"action-1","capability":"...","requiredAction":"...","description":"一句话目标"}]}
	可选能力：reply、canvas_read、visual_inspection、workflow_validation、canvas_write、image_operation、workflow_reuse、canvas_history、canvas_history_write、workflow_template_read、workflow_template_write、generation_settings、canvas_undo、canvas_redo、generation、attachments、navigate、library_read、library_write、web_search。
	reply 用于讨论、解释、规划、澄清或普通问答；canvas_read 用于读取节点结构；visual_inspection 用于查看真实画布图片并判断重复、相似、主体、颜色、构图或效果问题；workflow_validation 用于用户要求创建或修复一个完整、可执行、正确接入全部参考输入的工作流，必须放在写入动作之后并通过 canvas_validate_workflow 验证；canvas_write 用于普通结构性创建、修改、删除、连接、复制、移动或缩放画布；image_operation 专门用于裁剪、切图、高清放大、多角度或反推提示词的内置操作节点；workflow_reuse 用于替换工作流输入、使旧下游输出失效或只重跑受影响步骤；canvas_history 只用于列出 Agent 历史；canvas_history_write 用于创建命名检查点、恢复检查点或指定事务；workflow_template_read 专门用于搜索或检查系统工作流模板，workflow_template_write 专门用于按精确模板 ID 创建新画布；generation_settings 专门用于修改已有生图节点的比例、尺寸、质量、分辨率、模型、张数或背景；canvas_undo 用于逐步撤销 Agent 画布操作；canvas_redo 用于恢复刚刚被撤销的 Agent 操作；generation 用于触发单节点生成、运行、停止、恢复、重试工作流、对选中图片分别重生成或查询本轮结果；attachments 用于把聊天附件放到画布；navigate 用于站内跳转；library_read/library_write 用于读取或写入提示词和素材库；web_search 用于用户明确要求联网、搜索网页、核验外部事实，或问题依赖最新时效信息。普通画布操作和稳定常识不要返回 web_search。
requiredAction 只能是 none、canvas_write 或 generation：
- 用户只是讨论、询问、读取或查询状态时用 none。
	- 用户要求本轮实际改变普通画布结构时用 canvas_write。裁剪、切图、高清放大、多角度或反推提示词必须返回 image_operation，不要返回 canvas_write；如果只是创建或配置操作节点用 requiredAction=canvas_write，如果明确要求立即执行用 requiredAction=generation。若只是修改已有生图参数，capabilities 必须返回 generation_settings，不要返回 canvas_write 或 generation。例如“比例改成 9:16，质量高一点”“统一用竖版高画质”“这批节点改成 9:16 和 high”“所有生图步骤都用高质量”“尺寸统一调整为 9:16”都属于 generation_settings。
	- 换图/换文字后复用原工作流、从某节点继续、只重跑后半段返回 workflow_reuse；只替换或清理用 requiredAction=canvas_write，明确要求立即重跑用 requiredAction=generation。查看历史返回 canvas_history 和 none；创建或恢复命名检查点返回 canvas_history_write 和 canvas_write，不能同时返回 canvas_history。
	- 搜索、推荐、查看系统工作流模板返回 workflow_template_read 和 none；明确要求使用、套用某个模板创建新画布返回 workflow_template_write 和 canvas_write，需要创建后打开时再加 navigate。不能用 library_read/library_write 代替模板能力，不能把“查看模板”识别成创建。
	- 用户明确要求联网、网上搜索、打开外部资料核验，或问题涉及会随时间变化的新闻、价格、版本、政策、人物职位、产品信息时返回 web_search 和 none；如果还要求把检索结果写入画布，同时返回对应写入能力并拆成“先检索、后写入”两个 actions。不能把站内提示词/素材/工作流模板搜索误判为联网搜索。
- “撤销刚才对节点的修改”“回到 Agent 操作前”“把上一步还原”“undo the last canvas change”返回 canvas_undo；“重做刚才撤销的操作”“恢复被撤销的节点修改”“redo”返回 canvas_redo。这两类都使用 requiredAction=canvas_write，不要同时返回 canvas_write，也不要根据当前节点推测反向操作。询问是否支持回退、讨论回退方案时仍然只返回 reply 和 none。
- 用户要求本轮实际启动生成时用 generation；必须结合上下文识别省略表达和口语跟进，例如“这几张照刚才说的各做一版”“都给我换个干净背景”“可以，开始吧”，不能要求用户包含“生成”等固定关键词。
	- 用户反馈生成图片重复、过于相似、效果不对、主体变化、颜色不准、构图异常或要求比较图片时必须返回 visual_inspection。只检查时 requiredAction=none；还要求修改或重新生成时，同时拆出后续 canvas_write 或 generation action，并把 visual_inspection 放在第一项。禁止把视觉问题直接路由成单独 generation。
	- 路由消息中的“本消息包含 N 张真实参考图”表示执行模型会直接收到用户附件像素。用户要求把附件放进画布时返回 attachments；要求依据附件搭建或修改完整工作流时返回 attachments + canvas_write + workflow_validation，并拆成先放置附件、后搭建并连接结构、最后校验全部参考输入。visual_inspection 只用于检查画布节点里的图片，不要用它代替聊天附件。
		只返回完成请求所必需的能力，可以返回多个。actions 必须把用户要求的每个独立目标分别列出并保持执行顺序；复合请求不能把多个目标压成一项。例如“切图后新增说明节点并整理布局”至少拆成 image_operation 和 canvas_write 两项，capabilities 同时保留这两种能力。全局 requiredAction 取 actions 中最高级别：generation 高于 canvas_write，高于 none。明确要求只讲方案、不修改或不执行时，requiredAction 必须是 none，actions 为空，且绝不能返回 canvas_write、image_operation、workflow_reuse、canvas_history_write、workflow_template_write、generation_settings、canvas_undo、canvas_redo、generation、attachments 或 library_write。拿不准时只返回 reply，requiredAction 用 none。`
}

func canvasAgentIntentFromFallback(prompt string) canvasAgentIntent {
	capabilities := fallbackCanvasAgentCapabilities(prompt)
	requiredAction := canvasRequiredActionNone
	if capabilities[canvasCapabilityGeneration] {
		requiredAction = canvasRequiredActionGeneration
	} else if capabilities[canvasCapabilityImageOperation] || capabilities[canvasCapabilityWorkflowReuse] || capabilities[canvasCapabilityHistoryWrite] || capabilities[canvasCapabilityTemplateWrite] || capabilities[canvasCapabilityGenerationSettings] || capabilities[canvasCapabilityUndo] || capabilities[canvasCapabilityRedo] || capabilities[canvasCapabilityAttachments] || canvasAgentRequiresMutation(prompt) {
		requiredAction = canvasRequiredActionWrite
	}
	return canvasAgentIntent{Capabilities: capabilities, RequiredAction: requiredAction, Actions: synthesizeCanvasAgentPlannedActions(capabilities, requiredAction)}
}

func fallbackCanvasAgentHistoryMutation(prompt string) bool {
	compact := strings.ToLower(strings.Join(strings.Fields(prompt), ""))
	for _, action := range []string{"创建", "保存", "恢复", "回到", "还原", "create", "save", "restore"} {
		if strings.Contains(compact, action) {
			return true
		}
	}
	return false
}

func fallbackCanvasAgentWebSearchIntent(compact string) bool {
	for _, phrase := range []string{
		"联网", "上网", "网上搜索", "网页搜索", "搜索网络", "查一下网站", "外部资料", "最新消息", "今天的", "现在的价格",
		"searchtheweb", "websearch", "lookuponline", "latestnews", "currentprice",
	} {
		if strings.Contains(compact, phrase) {
			return true
		}
	}
	return false
}

// This is only an availability fallback when semantic intent classification
// fails. Normal visual routing is decided by the configured model.
func fallbackCanvasAgentVisualInspectionIntent(compact string) (inspect bool, repair bool) {
	imageContext := false
	for _, phrase := range []string{"图片", "图像", "生成图", "输出图", "出的图", "画面", "image", "images", "outputimage"} {
		if strings.Contains(compact, phrase) {
			imageContext = true
			break
		}
	}
	if !imageContext {
		return false, false
	}
	for _, phrase := range []string{"一模一样", "重复", "太像", "相似", "效果不对", "有问题", "不对", "主体变", "颜色不准", "构图", "对比", "比较", "duplicate", "similar", "wrong", "compare"} {
		if strings.Contains(compact, phrase) {
			inspect = true
			break
		}
	}
	if !inspect {
		return false, false
	}
	for _, phrase := range []string{"更新", "修改", "修复", "调整", "重新", "重做", "再生成", "处理", "fix", "update", "regenerate", "redo"} {
		if strings.Contains(compact, phrase) {
			return true, true
		}
	}
	return true, false
}

func fallbackCanvasAgentCapabilities(prompt string) canvasAgentCapabilities {
	capabilities := canvasAgentCapabilities{canvasCapabilityReply: true}
	if canvasAgentForbidsMutation(prompt) {
		return capabilities
	}
	compact := strings.ToLower(strings.Join(strings.Fields(prompt), ""))
	hasAttachmentCatalog := strings.Contains(compact, "本轮聊天附件") && strings.Contains(compact, "canvas_create_attachment_nodes")
	if hasAttachmentCatalog {
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityAttachments] = true
		if strings.Contains(compact, "工作流") || strings.Contains(compact, "workflow") {
			capabilities[canvasCapabilityWrite] = true
			capabilities[canvasCapabilityWorkflowValidation] = true
		}
	}
	if inspect, repair := fallbackCanvasAgentVisualInspectionIntent(compact); inspect && !hasAttachmentCatalog {
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityVisualInspection] = true
		if repair {
			capabilities[canvasCapabilityWrite] = true
			capabilities[canvasCapabilityGeneration] = true
		}
		return capabilities
	}
	templateIntent := strings.Contains(compact, "工作流模板") || strings.Contains(compact, "画布模板") || strings.Contains(compact, "workflowtemplate") || strings.Contains(compact, "canvastemplate")
	if templateIntent {
		for _, action := range []string{"使用", "套用", "创建", "新建", "生成画布", "use", "create", "instantiate"} {
			if strings.Contains(compact, action) {
				capabilities[canvasCapabilityTemplateWrite] = true
				return capabilities
			}
		}
		capabilities[canvasCapabilityTemplateRead] = true
		return capabilities
	}
	if fallbackCanvasAgentWebSearchIntent(compact) {
		capabilities[canvasCapabilityWeb] = true
	}
	workflowPreflightIntent := strings.Contains(compact, "工作流") || strings.Contains(compact, "workflow")
	if workflowPreflightIntent {
		for _, query := range []string{"多少积分", "费用", "价格", "会跑哪些", "执行哪些", "能不能运行", "是否可运行", "运行前检查", "预检", "cost", "price", "preflight", "canrun"} {
			if strings.Contains(compact, query) {
				capabilities[canvasCapabilityRead] = true
				return capabilities
			}
		}
	}
	if historyCapability := fallbackCanvasAgentHistoryCapability(compact); historyCapability != "" {
		capabilities[canvasCapabilityRead] = true
		capabilities[historyCapability] = true
		return capabilities
	}
	for _, operation := range []string{"裁剪", "切图", "分割图片", "高清放大", "图片放大", "多角度", "反推提示词", "reverseprompt", "upscale", "cropimage", "splitimage"} {
		if strings.Contains(compact, operation) {
			capabilities[canvasCapabilityRead] = true
			capabilities[canvasCapabilityImageOperation] = true
			return capabilities
		}
	}
	for _, reuse := range []string{"替换工作流输入", "换一张图片继续", "换图继续", "只重跑下游", "重跑后半段", "从这个节点继续", "rundownstream", "replaceworkflowinput"} {
		if strings.Contains(compact, reuse) {
			capabilities[canvasCapabilityRead] = true
			capabilities[canvasCapabilityWorkflowReuse] = true
			return capabilities
		}
	}
	for _, history := range []string{"创建检查点", "保存检查点", "查看agent历史", "列出agent历史", "恢复检查点", "恢复事务", "createcheckpoint", "restorecheckpoint"} {
		if strings.Contains(compact, history) {
			capabilities[canvasCapabilityRead] = true
			if fallbackCanvasAgentHistoryMutation(prompt) {
				capabilities[canvasCapabilityHistoryWrite] = true
			} else {
				capabilities[canvasCapabilityHistory] = true
			}
			return capabilities
		}
	}
	generationTarget := strings.Contains(compact, "工作流") || strings.Contains(compact, "生图") || strings.Contains(compact, "生成") || strings.Contains(compact, "workflow") || strings.Contains(compact, "generation")
	generationAction := strings.Contains(compact, "执行") || strings.Contains(compact, "运行") || strings.Contains(compact, "重跑") || strings.Contains(compact, "重新运行") || strings.Contains(compact, "重新生成") || strings.Contains(compact, "重生成") || strings.Contains(compact, "再生成") || strings.Contains(compact, "换背景") || strings.Contains(compact, "做变体") || strings.Contains(compact, "run") || strings.Contains(compact, "rerun")
	if generationTarget && generationAction {
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityGeneration] = true
		return capabilities
	}
	if canvasAgentLooksLikeGenerationSettingsMutation(compact) {
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityGenerationSettings] = true
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

func fallbackCanvasAgentHistoryCapability(compact string) string {
	question := false
	for _, phrase := range []string{"可以吗", "能吗", "能不能", "能否", "是否", "怎么", "如何", "为什么", "how", "canit", "isitpossible", "?", "？"} {
		if strings.Contains(compact, phrase) {
			question = true
			break
		}
	}
	explicit := false
	for _, phrase := range []string{"请", "帮我", "给我", "直接", "立即", "马上", "现在"} {
		if strings.Contains(compact, phrase) {
			explicit = true
			break
		}
	}
	if question && !explicit {
		return ""
	}
	for _, phrase := range []string{"重做", "恢复刚才撤销", "恢复已撤销", "redo"} {
		if strings.Contains(compact, phrase) {
			return canvasCapabilityRedo
		}
	}
	for _, phrase := range []string{"撤销", "回退", "退回上一步", "恢复到修改前", "还原刚才", "回到操作前", "undo", "revert", "rollback"} {
		if strings.Contains(compact, phrase) {
			return canvasCapabilityUndo
		}
	}
	return ""
}

func canvasAgentLooksLikeGenerationSettingsMutation(compact string) bool {
	settingConcept := false
	for _, concept := range []string{
		"比例", "尺寸", "分辨率", "画质", "质量", "模型", "张数", "背景", "宽高比", "竖版", "横版",
		"aspectratio", "size", "resolution", "quality", "model", "count", "background", "portrait", "landscape",
	} {
		if strings.Contains(compact, concept) {
			settingConcept = true
			break
		}
	}
	if !settingConcept {
		return false
	}
	for _, action := range []string{
		"改为", "改成", "修改", "调整", "更新", "统一", "设为", "设置为", "换成", "使用", "都用",
		"change", "update", "set", "switch", "use",
	} {
		if strings.Contains(compact, action) {
			return true
		}
	}
	return false
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
		Capabilities   []string                   `json:"capabilities"`
		RequiredAction string                     `json:"requiredAction"`
		Actions        []canvasAgentPlannedAction `json:"actions"`
	}
	if err := json.Unmarshal([]byte(raw[start:end+1]), &body); err != nil {
		return canvasAgentIntent{}, err
	}
	allowed := map[string]bool{
		canvasCapabilityReply: true, canvasCapabilityRead: true, canvasCapabilityWrite: true,
		canvasCapabilityVisualInspection:   true,
		canvasCapabilityWorkflowValidation: true,
		canvasCapabilityImageOperation:     true,
		canvasCapabilityWorkflowReuse:      true,
		canvasCapabilityHistory:            true,
		canvasCapabilityHistoryWrite:       true,
		canvasCapabilityTemplateRead:       true,
		canvasCapabilityTemplateWrite:      true,
		canvasCapabilityGenerationSettings: true,
		canvasCapabilityUndo:               true,
		canvasCapabilityRedo:               true,
		canvasCapabilityGeneration:         true, canvasCapabilityAttachments: true, canvasCapabilityNavigate: true,
		canvasCapabilityLibraryRead: true, canvasCapabilityLibraryWrite: true, canvasCapabilityWeb: true,
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
	if capabilities[canvasCapabilityWorkflowValidation] {
		capabilities[canvasCapabilityRead] = true
	}
	requiredAction := strings.TrimSpace(strings.ToLower(body.RequiredAction))
	switch requiredAction {
	case canvasRequiredActionNone:
	case canvasRequiredActionWrite:
		capabilities[canvasCapabilityReply] = true
		capabilities[canvasCapabilityRead] = true
		if !capabilities[canvasCapabilityImageOperation] && !capabilities[canvasCapabilityWorkflowReuse] && !capabilities[canvasCapabilityHistoryWrite] && !capabilities[canvasCapabilityTemplateWrite] && !capabilities[canvasCapabilityGenerationSettings] && !capabilities[canvasCapabilityUndo] && !capabilities[canvasCapabilityRedo] && !capabilities[canvasCapabilityAttachments] && !capabilities[canvasCapabilityLibraryWrite] {
			capabilities[canvasCapabilityWrite] = true
		}
	case canvasRequiredActionGeneration:
		capabilities[canvasCapabilityReply] = true
		capabilities[canvasCapabilityRead] = true
		capabilities[canvasCapabilityGeneration] = true
	default:
		return canvasAgentIntent{}, fmt.Errorf("invalid requiredAction %q", body.RequiredAction)
	}
	actions := make([]canvasAgentPlannedAction, 0, min(len(body.Actions), canvasAgentMaxPlannedActions))
	actionIDs := map[string]bool{}
	explicitCanvasWriteAction := false
	for index, action := range body.Actions {
		if len(actions) >= canvasAgentMaxPlannedActions {
			break
		}
		capability := strings.TrimSpace(strings.ToLower(action.Capability))
		if !allowed[capability] || capability == canvasCapabilityReply {
			continue
		}
		actionRequired := strings.TrimSpace(strings.ToLower(action.RequiredAction))
		if actionRequired == "" {
			actionRequired = requiredAction
		}
		if actionRequired != canvasRequiredActionNone && actionRequired != canvasRequiredActionWrite && actionRequired != canvasRequiredActionGeneration {
			continue
		}
		id := strings.TrimSpace(action.ID)
		if id == "" || actionIDs[id] {
			id = fmt.Sprintf("action-%d", index+1)
		}
		for actionIDs[id] {
			id += "-next"
		}
		actionIDs[id] = true
		description := strings.TrimSpace(action.Description)
		if description == "" {
			description = capability
		}
		actions = append(actions, canvasAgentPlannedAction{ID: id, Capability: capability, RequiredAction: actionRequired, Description: description})
		capabilities[capability] = true
		if capability == canvasCapabilityWrite {
			explicitCanvasWriteAction = true
		}
		if actionRequired == canvasRequiredActionGeneration {
			requiredAction = canvasRequiredActionGeneration
		} else if actionRequired == canvasRequiredActionWrite && requiredAction == canvasRequiredActionNone {
			requiredAction = canvasRequiredActionWrite
		}
	}
	if requiredAction == canvasRequiredActionWrite || requiredAction == canvasRequiredActionGeneration {
		capabilities[canvasCapabilityReply] = true
		capabilities[canvasCapabilityRead] = true
	}
	if requiredAction == canvasRequiredActionGeneration {
		capabilities[canvasCapabilityGeneration] = true
	}
	if (capabilities[canvasCapabilityImageOperation] || capabilities[canvasCapabilityWorkflowReuse] || capabilities[canvasCapabilityHistoryWrite] || capabilities[canvasCapabilityTemplateWrite] || capabilities[canvasCapabilityGenerationSettings] || capabilities[canvasCapabilityUndo] || capabilities[canvasCapabilityRedo] || capabilities[canvasCapabilityAttachments] || capabilities[canvasCapabilityLibraryWrite]) && !explicitCanvasWriteAction && !capabilities[canvasCapabilityWorkflowValidation] {
		delete(capabilities, canvasCapabilityWrite)
	}
	if len(actions) == 0 {
		actions = synthesizeCanvasAgentPlannedActions(capabilities, requiredAction)
	}
	return canvasAgentIntent{Capabilities: capabilities, RequiredAction: requiredAction, Actions: actions}, nil
}

func synthesizeCanvasAgentPlannedActions(capabilities canvasAgentCapabilities, requiredAction string) []canvasAgentPlannedAction {
	if requiredAction == canvasRequiredActionNone && !capabilities[canvasCapabilityVisualInspection] && !capabilities[canvasCapabilityWorkflowValidation] {
		return nil
	}
	ordered := []string{
		canvasCapabilityVisualInspection,
		canvasCapabilityImageOperation,
		canvasCapabilityWorkflowReuse,
		canvasCapabilityHistoryWrite,
		canvasCapabilityTemplateWrite,
		canvasCapabilityGenerationSettings,
		canvasCapabilityUndo,
		canvasCapabilityRedo,
		canvasCapabilityAttachments,
		canvasCapabilityLibraryWrite,
		canvasCapabilityWrite,
		canvasCapabilityWorkflowValidation,
	}
	actions := make([]canvasAgentPlannedAction, 0, 2)
	for _, capability := range ordered {
		if !capabilities[capability] {
			continue
		}
		actionRequired := canvasRequiredActionWrite
		if capability == canvasCapabilityVisualInspection {
			actionRequired = canvasRequiredActionNone
		} else if capability == canvasCapabilityWorkflowValidation {
			actionRequired = canvasRequiredActionNone
		} else if requiredAction == canvasRequiredActionGeneration && (capability == canvasCapabilityImageOperation || capability == canvasCapabilityWorkflowReuse) {
			actionRequired = canvasRequiredActionGeneration
		}
		actions = append(actions, canvasAgentPlannedAction{
			ID:             fmt.Sprintf("action-%d", len(actions)+1),
			Capability:     capability,
			RequiredAction: actionRequired,
			Description:    capability,
		})
	}
	hasSelfStartingGenerationAction := capabilities[canvasCapabilityImageOperation] || capabilities[canvasCapabilityWorkflowReuse]
	if requiredAction == canvasRequiredActionGeneration && !hasSelfStartingGenerationAction {
		actions = append(actions, canvasAgentPlannedAction{ID: fmt.Sprintf("action-%d", len(actions)+1), Capability: canvasCapabilityGeneration, RequiredAction: canvasRequiredActionGeneration, Description: canvasCapabilityGeneration})
	}
	return actions
}

func canvasAgentPlanInstructions(actions []canvasAgentPlannedAction) string {
	pending := make([]map[string]string, 0, len(actions))
	for _, action := range actions {
		if action.RequiredAction == canvasRequiredActionNone && action.Capability != canvasCapabilityVisualInspection && action.Capability != canvasCapabilityWorkflowValidation {
			continue
		}
		pending = append(pending, map[string]string{
			"id": action.ID, "capability": action.Capability, "requiredAction": action.RequiredAction, "description": action.Description,
		})
	}
	if len(pending) == 0 {
		return ""
	}
	raw, _ := json.Marshal(pending)
	return "本轮内部执行目标如下，必须按顺序逐项完成并通过真实工具结果验证，不能完成第一项后提前结束：\n" + string(raw)
}

func canvasAgentToolCapability(name string) string {
	switch name {
	case canvasApplyOpsTool().Name, canvasFocusNodesTool().Name, canvasDuplicateSelectionTool().Name:
		return canvasCapabilityWrite
	case canvasInspectVisualsTool().Name:
		return canvasCapabilityVisualInspection
	case canvasValidateWorkflowTool().Name:
		return canvasCapabilityWorkflowValidation
	case canvasCreateImageOperationTool().Name:
		return canvasCapabilityImageOperation
	case canvasReplaceWorkflowInputTool().Name, canvasRunDownstreamTool().Name:
		return canvasCapabilityWorkflowReuse
	case canvasCreateCheckpointTool().Name, canvasRestoreCheckpointTool().Name, canvasRestoreAgentTransactionTool().Name:
		return canvasCapabilityHistoryWrite
	case canvasCreateFromWorkflowTemplateTool().Name:
		return canvasCapabilityTemplateWrite
	case canvasUpdateGenerationSettingsTool().Name:
		return canvasCapabilityGenerationSettings
	case canvasUndoLastActionTool().Name:
		return canvasCapabilityUndo
	case canvasRedoLastActionTool().Name:
		return canvasCapabilityRedo
	case canvasRegenerateSelectionTool().Name, canvasRunGenerationTool().Name, canvasRunWorkflowTool().Name, canvasStopWorkflowTool().Name, canvasResumeWorkflowTool().Name, canvasRetryFailedNodesTool().Name:
		return canvasCapabilityGeneration
	case canvasCreateAttachmentNodesTool().Name:
		return canvasCapabilityAttachments
	case assetsAddTool().Name:
		return canvasCapabilityLibraryWrite
	default:
		return ""
	}
}

func (loop *canvasAgentLoopState) completeNextPlannedAction(toolName string) {
	if loop == nil || !loop.lastToolSucceeded {
		return
	}
	capability := canvasAgentToolCapability(toolName)
	if capability == "" {
		return
	}
	if capability == canvasCapabilityVisualInspection && !loop.visualInspected {
		return
	}
	if capability == canvasCapabilityWorkflowValidation {
		for _, action := range loop.plannedActions {
			if action.Capability == canvasCapabilityWorkflowValidation {
				break
			}
			if !action.Completed && (action.RequiredAction != canvasRequiredActionNone || action.Capability == canvasCapabilityVisualInspection) {
				return
			}
		}
	}
	for index := range loop.plannedActions {
		if !loop.plannedActions[index].Completed && (loop.plannedActions[index].RequiredAction != canvasRequiredActionNone || capability == canvasCapabilityVisualInspection || capability == canvasCapabilityWorkflowValidation) && loop.plannedActions[index].Capability == capability {
			loop.plannedActions[index].Completed = true
			return
		}
	}
}

func (loop *canvasAgentLoopState) pendingPlannedActions() []canvasAgentPlannedAction {
	if loop == nil {
		return nil
	}
	pending := make([]canvasAgentPlannedAction, 0, len(loop.plannedActions))
	for _, action := range loop.plannedActions {
		if !action.Completed && (action.RequiredAction != canvasRequiredActionNone || action.Capability == canvasCapabilityVisualInspection || action.Capability == canvasCapabilityWorkflowValidation) {
			pending = append(pending, action)
		}
	}
	return pending
}

func canvasAgentPendingActionMessage(actions []canvasAgentPlannedAction) string {
	parts := make([]string, 0, len(actions))
	for _, action := range actions {
		parts = append(parts, action.ID+"（"+action.Description+"）")
	}
	return strings.Join(parts, "、")
}

func canvasAgentToolsForCapabilities(capabilities canvasAgentCapabilities) []sub2api.FunctionTool {
	tools := []sub2api.FunctionTool{canvasReplyTool()}
	if capabilities[canvasCapabilityWeb] {
		tools = append(tools, webSearchTool())
	}
	if capabilities[canvasCapabilityWrite] {
		tools = append(tools, canvasApplyOpsTool())
	}
	if capabilities[canvasCapabilityVisualInspection] {
		tools = append(tools, canvasInspectVisualsTool())
	}
	if capabilities[canvasCapabilityImageOperation] {
		tools = append(tools, canvasCreateImageOperationTool())
	}
	if capabilities[canvasCapabilityWorkflowReuse] {
		tools = append(tools, canvasReplaceWorkflowInputTool(), canvasRunDownstreamTool())
	}
	if capabilities[canvasCapabilityHistoryWrite] {
		tools = append(tools, canvasCreateCheckpointTool(), canvasRestoreCheckpointTool(), canvasRestoreAgentTransactionTool())
	}
	if capabilities[canvasCapabilityTemplateRead] || capabilities[canvasCapabilityTemplateWrite] {
		tools = append(tools, canvasListWorkflowTemplatesTool(), canvasInspectWorkflowTemplateTool())
	}
	if capabilities[canvasCapabilityTemplateWrite] {
		tools = append(tools, canvasCreateFromWorkflowTemplateTool())
	}
	if capabilities[canvasCapabilityGenerationSettings] {
		tools = append(tools, canvasUpdateGenerationSettingsTool())
	}
	if capabilities[canvasCapabilityUndo] {
		tools = append(tools, canvasUndoLastActionTool())
	}
	if capabilities[canvasCapabilityRedo] {
		tools = append(tools, canvasRedoLastActionTool())
	}
	if capabilities[canvasCapabilityRead] || capabilities[canvasCapabilityVisualInspection] || capabilities[canvasCapabilityWorkflowValidation] || capabilities[canvasCapabilityWrite] || capabilities[canvasCapabilityImageOperation] || capabilities[canvasCapabilityWorkflowReuse] || capabilities[canvasCapabilityHistory] || capabilities[canvasCapabilityHistoryWrite] || capabilities[canvasCapabilityGenerationSettings] || capabilities[canvasCapabilityUndo] || capabilities[canvasCapabilityRedo] || capabilities[canvasCapabilityGeneration] || capabilities[canvasCapabilityAttachments] {
		tools = append(tools, canvasReadStateTool(), canvasReadSelectionTool(), canvasFindNodesTool(), canvasInspectNodesTool(), canvasExportSnapshotTool(), canvasValidateWorkflowTool(), canvasPlanWorkflowRunTool(), canvasListAgentHistoryTool())
	}
	if capabilities[canvasCapabilityWrite] {
		tools = append(tools, canvasFocusNodesTool(), canvasDuplicateSelectionTool())
	}
	if capabilities[canvasCapabilityGeneration] {
		tools = append(tools, canvasRegenerateSelectionTool(), canvasRunGenerationTool(), canvasGenerationStatusTool(), canvasRunWorkflowTool(), canvasWorkflowStatusTool(), canvasStopWorkflowTool(), canvasResumeWorkflowTool(), canvasRetryFailedNodesTool())
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
	if capabilities[canvasCapabilityWeb] && canvasAgentToolAllowed(tools, webSearchTool().Name) {
		return webSearchTool().Name
	}
	if capabilities[canvasCapabilityVisualInspection] && canvasAgentToolAllowed(tools, canvasInspectVisualsTool().Name) {
		return canvasInspectVisualsTool().Name
	}
	if capabilities[canvasCapabilityWorkflowValidation] && !capabilities[canvasCapabilityWrite] && canvasAgentToolAllowed(tools, canvasValidateWorkflowTool().Name) {
		return canvasValidateWorkflowTool().Name
	}
	if capabilities[canvasCapabilityImageOperation] && canvasAgentToolAllowed(tools, canvasCreateImageOperationTool().Name) {
		return canvasCreateImageOperationTool().Name
	}
	if capabilities[canvasCapabilityGenerationSettings] && canvasAgentToolAllowed(tools, canvasUpdateGenerationSettingsTool().Name) {
		return canvasUpdateGenerationSettingsTool().Name
	}
	if capabilities[canvasCapabilityUndo] && canvasAgentToolAllowed(tools, canvasUndoLastActionTool().Name) {
		return canvasUndoLastActionTool().Name
	}
	if capabilities[canvasCapabilityRedo] && canvasAgentToolAllowed(tools, canvasRedoLastActionTool().Name) {
		return canvasRedoLastActionTool().Name
	}
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
		messages = append(messages, canvasAgentIntentRoutingMessage(message))
	}
	raw, err := client.ChatTextWithImages(ctx, messages, nil, nil)
	if err != nil {
		return canvasAgentIntent{}, err
	}
	return parseCanvasAgentIntent(raw)
}

func canvasAgentIntentRoutingMessage(message sub2api.Message) sub2api.Message {
	imageCount := len(message.ReferenceImages)
	message.ReferenceImages = nil
	if imageCount <= 0 {
		return message
	}
	marker := fmt.Sprintf("[本消息包含 %d 张真实参考图；执行模型会收到图片像素]", imageCount)
	if strings.TrimSpace(message.Content) == "" {
		message.Content = marker
	} else {
		message.Content = strings.TrimSpace(message.Content) + "\n" + marker
	}
	return message
}

func restrictCanvasAgentIntent(prompt string, intent canvasAgentIntent) canvasAgentIntent {
	intent.Capabilities = restrictCanvasAgentCapabilities(prompt, intent.Capabilities)
	if canvasAgentForbidsMutation(prompt) {
		intent.RequiredAction = canvasRequiredActionNone
		intent.Actions = nil
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
	delete(restricted, canvasCapabilityImageOperation)
	delete(restricted, canvasCapabilityWorkflowReuse)
	delete(restricted, canvasCapabilityHistory)
	delete(restricted, canvasCapabilityHistoryWrite)
	delete(restricted, canvasCapabilityTemplateWrite)
	delete(restricted, canvasCapabilityGenerationSettings)
	delete(restricted, canvasCapabilityUndo)
	delete(restricted, canvasCapabilityRedo)
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
				loop.completeNextPlannedAction(canvasApplyOpsTool().Name)
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
	loop := canvasAgentLoopState{summary: "", pendingOps: nil, webSearchClient: reasoningClient}
	intent, intentErr := classifyCanvasAgentIntent(ctx, client, payload)
	if intentErr != nil {
		// Keyword matching is deliberately limited to an availability fallback.
		// Normal routing is based on the model's full-conversation semantic intent.
		intent = canvasAgentIntentFromFallback(run.Prompt)
	}
	intent = restrictCanvasAgentIntent(run.Prompt, intent)
	capabilities := intent.Capabilities
	loop.requiresVisualInspection = capabilities[canvasCapabilityVisualInspection]
	loop.plannedActions = append([]canvasAgentPlannedAction(nil), intent.Actions...)
	if planInstructions := canvasAgentPlanInstructions(loop.plannedActions); planInstructions != "" {
		payload = append(payload, sub2api.Message{Role: "system", Content: planInstructions})
	}
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
	allowsCanvasWrite := capabilities[canvasCapabilityWrite] || capabilities[canvasCapabilityTemplateWrite] || capabilities[canvasCapabilityLibraryWrite] || capabilities[canvasCapabilityGenerationSettings] || capabilities[canvasCapabilityUndo] || capabilities[canvasCapabilityRedo]
	allowsGenericCanvasWrite := capabilities[canvasCapabilityWrite]
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
			if allowsGenericCanvasWrite && !loop.touched {
				if text, ok := w.recoverCanvasAgentWithoutTools(ctx, reasoningClient, run, payload, &loop, onUpdate, err); ok {
					result.Text = text
					if len(loop.pendingPlannedActions()) == 0 {
						break
					}
					continue
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
					if len(loop.pendingPlannedActions()) == 0 {
						break
					}
				}
			}
			if pending := loop.pendingPlannedActions(); len(pending) > 0 {
				payload = append(payload,
					sub2api.Message{Role: "assistant", Content: strings.TrimSpace(next.Text)},
					sub2api.Message{Role: "user", Content: "本轮还有未完成的执行目标：" + canvasAgentPendingActionMessage(pending) + "。继续调用对应工具并验证结果，不能提前回复完成。"},
				)
				if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
					return err
				}
				continue
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
			if allowsGenericCanvasWrite && !loop.touched {
				if summary, ops, parseErr := parseCanvasAgentOps(next.Text); parseErr == nil && len(ops) > 0 {
					w.dispatchCanvasOps(ctx, run, &loop, summary, ops)
					loop.completeNextPlannedAction(canvasApplyOpsTool().Name)
					if len(loop.pendingPlannedActions()) == 0 {
						break
					}
					continue
				}
				if text, ok := w.recoverCanvasAgentWithoutTools(ctx, reasoningClient, run, payload, &loop, onUpdate, nil); ok {
					result.Text = text
					if len(loop.pendingPlannedActions()) == 0 {
						break
					}
					continue
				}
			}
			if capabilities[canvasCapabilityTemplateWrite] && !loop.touched {
				payload = append(payload,
					sub2api.Message{Role: "assistant", Content: strings.TrimSpace(next.Text)},
					sub2api.Message{Role: "user", Content: "本轮要求从系统工作流模板创建新画布，不能只回复。没有精确 templateId 时先调用 canvas_list_workflow_templates；需要确认结构时调用 canvas_inspect_workflow_template；最后调用 canvas_create_from_workflow_template。禁止猜 templateId。"},
				)
				if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
					return err
				}
				continue
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
					if len(loop.pendingPlannedActions()) == 0 {
						break
					}
				}
				if pending := loop.pendingPlannedActions(); len(pending) > 0 && loop.verifiedNoop {
					observation := "回复未被接受：本轮还有未完成的执行目标：" + canvasAgentPendingActionMessage(pending) + "。请继续调用对应工具。"
					payload = append(payload, canvasAgentToolMessages(next, observation)...)
					if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
						return err
					}
					continue
				}
				observation := "回复未被接受：本轮有明确的画布执行意图，但尚无已验证的操作。"
				if requiresGeneration {
					observation += "用户要求对选中图片分别生成时，先调用 canvas_get_selection，再调用 canvas_regenerate_selection；费用确认由画布界面处理，禁止再次口头询问。"
				} else if capabilities[canvasCapabilityGenerationSettings] {
					observation += "请调用 canvas_update_generation_settings；参数修改禁止创建节点、连线或启动生成。"
				} else if capabilities[canvasCapabilityTemplateWrite] {
					observation += "请使用 canvas_list_workflow_templates 返回的精确 templateId 调用 canvas_create_from_workflow_template；禁止猜 templateId，也不要改用 canvas_apply_ops。"
				} else if capabilities[canvasCapabilityUndo] {
					observation += "请调用 canvas_undo_last_action；禁止用 canvas_apply_ops 猜测反向修改。"
				} else if capabilities[canvasCapabilityRedo] {
					observation += "请调用 canvas_redo_last_action；禁止用 canvas_apply_ops 猜测恢复内容。"
				} else {
					observation += "请调用 canvas_apply_ops；只有成功读取后确认现状已满足要求时，才能明确回复“" + canvasAgentVerifiedNoopMessage + "”。"
				}
				payload = append(payload, canvasAgentToolMessages(next, observation)...)
				if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
					return err
				}
				continue
			}
			if pending := loop.pendingPlannedActions(); len(pending) > 0 {
				observation := "回复未被接受：本轮还有未完成的执行目标：" + canvasAgentPendingActionMessage(pending) + "。请继续调用对应工具，不能只总结已完成部分。"
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
		toolMessages := canvasAgentToolMessages(next, observation)
		if next.ToolCall.Name == canvasInspectVisualsTool().Name {
			if visualContext := w.consumeCanvasAgentVisualContext(ctx, run, &loop); visualContext != nil {
				toolMessages = append(toolMessages, *visualContext)
			}
		}
		payload = append(payload, toolMessages...)
		if loop.webSearchFailed {
			return fmt.Errorf("%s", loop.webSearchError)
		}
		loop.completeNextPlannedAction(next.ToolCall.Name)
		if loop.finishAfterTool && len(loop.pendingPlannedActions()) > 0 {
			loop.finishAfterTool = false
		}
		if loop.finishAfterTool {
			result.Text = loop.summary
			break
		}
		if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
			return err
		}
	}
	if pending := loop.pendingPlannedActions(); len(pending) > 0 {
		return fmt.Errorf("画布修改未完整执行，仍有未完成目标：%s", canvasAgentPendingActionMessage(pending))
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
