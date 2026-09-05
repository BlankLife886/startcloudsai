export const TOOL_STATUS = {
  available: { label: "可使用", tone: "green" },
  confirm: { label: "确认后执行", tone: "amber" },
  local: { label: "本地处理", tone: "blue" },
  controlled: { label: "后台控制", tone: "gray" },
};

const tool = (id, name, description, options = {}) => ({
  id,
  name,
  description,
  status: "available",
  surface: "页面",
  ...options,
});

const ASSISTANT_TOOLS = [
  tool("assistant-chat", "连续对话", "多轮问答、上下文延续、引用、编辑与重新生成。", { to: "/assistant", surface: "AI 助手" }),
  tool("assistant-image", "图片生成与编辑", "根据文字或参考图准备方案，确认参数后生成。", { to: "/assistant", surface: "AI 助手", status: "confirm" }),
  tool("propose_image_action", "图片创作方案", "识别生成或编辑意图，输出可修改的提示词、模型、比例和数量。", { to: "/assistant", surface: "Agent 模式", status: "confirm" }),
  tool("web_search", "联网搜索", "检索公开网页并在回答下方保留可核验来源。", { to: "/assistant", surface: "Agent 模式" }),
  tool("task_status", "任务状态诊断", "核对本人任务的真实阶段、耗时、重试、失败、扣费与退款。", { to: "/assistant", surface: "Agent 模式" }),
  tool("files_list", "附件清单", "读取本轮已上传文档的名称、页数和解析状态。", { to: "/assistant", surface: "文档分析" }),
  tool("files_search", "附件检索", "按问题检索附件中的相关段落。", { to: "/assistant", surface: "文档分析" }),
  tool("files_read", "附件精读", "按定位连续读取附件内容并提供证据。", { to: "/assistant", surface: "文档分析" }),
  tool("files_create", "文件生成", "创建 TXT、Markdown、CSV、JSON 或 PPTX 下载文件。", { to: "/assistant", surface: "AI 助手", status: "confirm" }),
  tool("editable-ppt", "PPT 制作", "根据需求生成可下载的演示文稿。", { to: "/assistant", surface: "AI 助手", status: "confirm" }),
  tool("editable-psd", "PSD 制作", "把海报或图片转换为可编辑分层 PSD。", { to: "/assistant", surface: "AI 助手", status: "confirm" }),
  tool("conversation-queue", "消息排队", "生成进行中仍可继续提交、编辑顺序或撤回等待任务。", { to: "/assistant", surface: "AI 助手" }),
  tool("voice-input", "语音输入", "用浏览器语音识别填写消息。", { to: "/assistant", surface: "输入区", status: "local" }),
  tool("context-boundary", "清除上文", "从指定位置建立新的上下文边界，保留历史但不再送入模型。", { to: "/assistant", surface: "AI 助手" }),
  tool("media_action", "媒体处理", "为图片准备抠图、压缩、高清放大、裁剪或切图操作。", { to: "/assistant", surface: "Agent 模式", status: "confirm", isNew: true }),
  tool("image_search", "图片搜索", "从公开图库查找真实参考图并显示来源和授权。", { to: "/assistant", surface: "Agent 模式", isNew: true }),
  tool("webpage_capture", "网页截图", "对可公开访问的网页生成视觉截图预览。", { to: "/assistant", surface: "Agent 模式", isNew: true }),
  tool("send_to_workspace", "发送到工作区", "把需求和参考图带到无限画布、电商或其他创作页面。", { to: "/assistant", surface: "Agent 模式", status: "confirm", isNew: true }),
  tool("reference_rebuild", "参考图复刻", "根据参考图创建可编辑的无限画布复刻草稿。", { to: "/assistant", surface: "Agent 模式", status: "confirm", isNew: true }),
  tool("product_import", "商品页导入", "读取公开商品页信息并带入 AI 电商继续编辑。", { to: "/assistant", surface: "Agent 模式", status: "confirm", isNew: true }),
  tool("delivery_export", "交付包导出", "在浏览器本地打包图片、提示词、参数和清单。", { to: "/assistant", surface: "Agent 模式", status: "confirm", isNew: true }),
  tool("site_operator", "站内导航", "安全打开允许的站内业务页面，不接触后台和账户安全操作。", { to: "/assistant", surface: "Agent 模式", isNew: true }),
];

const CANVAS_AGENT_TOOLS = [
  ["canvas_reply", "画布问答", "讨论、解释或规划，不修改画布。"],
  ["canvas_get_state", "读取画布状态", "读取节点、连接、视口和工作流摘要。"],
  ["canvas_get_selection", "读取当前选择", "查看用户选中的节点与连接线。"],
  ["canvas_find_nodes", "查找节点", "按名称、类型或内容定位节点。"],
  ["canvas_inspect_nodes", "检查节点", "读取指定节点的完整配置与关系。"],
  ["canvas_inspect_visuals", "视觉检查", "读取画布图片像素，判断主体、构图、重复和效果问题。"],
  ["canvas_focus_nodes", "定位节点", "移动视口并聚焦指定节点。"],
  ["canvas_apply_ops", "批量修改画布", "新增、修改、删除、移动节点和连接线。", "confirm"],
  ["canvas_duplicate_selection", "复制所选节点", "复制当前选择及内部连接关系。", "confirm"],
  ["canvas_create_image_operation", "创建图片操作节点", "创建切图、放大、裁剪、多角度或反推提示词节点。", "confirm"],
  ["canvas_update_generation_settings", "修改生成参数", "批量修改模型、比例、分辨率、质量、数量和背景。", "confirm"],
  ["canvas_create_attachment_nodes", "附件入画布", "把对话附件真实放入当前画布。", "confirm"],
  ["canvas_replace_workflow_input", "替换工作流输入", "替换上游输入并使受影响的旧输出失效。", "confirm"],
  ["canvas_run_generation", "运行节点生成", "启动一个或多个生成节点。", "confirm"],
  ["canvas_regenerate_selection", "重生成所选图片", "对选中的图片分别重新生成。", "confirm"],
  ["canvas_run_downstream", "运行下游", "从指定节点开始执行受影响的下游节点。", "confirm"],
  ["canvas_generation_status", "查询生成状态", "查看本轮节点任务成功、运行和失败数量。"],
  ["canvas_plan_workflow_run", "工作流预检", "计算将运行的节点、预计费用和阻塞问题。"],
  ["canvas_validate_workflow", "验证工作流", "检查输入、连接、模型能力和可执行性。"],
  ["canvas_run_workflow", "运行工作流", "确认预检后执行完整工作流。", "confirm"],
  ["canvas_workflow_status", "工作流状态", "查看逐节点状态、耗时和失败原因。"],
  ["canvas_stop_workflow", "停止工作流", "停止未完成的工作流节点。", "confirm"],
  ["canvas_resume_workflow", "继续工作流", "继续被停止或中断的工作流。", "confirm"],
  ["canvas_retry_failed_nodes", "重试失败节点", "只重试失败节点，并从新的 0 秒计时。", "confirm"],
  ["canvas_undo_last_action", "撤销 Agent 操作", "逐步撤销最近一次 Agent 画布修改。", "confirm"],
  ["canvas_redo_last_action", "重做 Agent 操作", "恢复刚撤销的 Agent 修改。", "confirm"],
  ["canvas_create_checkpoint", "创建检查点", "保存可命名的画布恢复点。", "confirm"],
  ["canvas_restore_checkpoint", "恢复检查点", "恢复到指定画布检查点。", "confirm"],
  ["canvas_list_agent_history", "Agent 操作历史", "查看 Agent 对画布做过的事务。"],
  ["canvas_restore_agent_transaction", "恢复 Agent 事务", "恢复到某次 Agent 操作之前。", "confirm"],
  ["canvas_export_snapshot", "导出画布快照", "导出当前画布结构快照用于诊断或交付。"],
  ["canvas_list_projects", "画布项目列表", "查看自己的最近无限画布项目。"],
  ["canvas_list_workflow_templates", "工作流模板列表", "搜索开发者提供的工作流模板。"],
  ["canvas_inspect_workflow_template", "检查工作流模板", "读取模板节点、输入和工作流结构。"],
  ["canvas_create_from_workflow_template", "从模板创建画布", "按精确模板创建新画布。", "confirm"],
  ["prompts_search", "提示词库搜索", "搜索当前用户可使用的提示词。"],
  ["assets_list", "素材库读取", "查找自己的图片和视频素材。"],
  ["assets_add", "加入素材库", "把当前图片加入自己的素材库。", "confirm"],
  ["site_navigate", "画布站内导航", "从画布打开允许的站内页面。"],
  ["web_search", "画布联网搜索", "检索公开网页并可把结论写入画布。"],
].map(([id, name, description, status = "available"]) => tool(id, name, description, { to: "/canvas", surface: "画布 Agent", status }));

const CANVAS_INTERFACE_TOOLS = [
  tool("canvas-nodes", "节点编辑", "创建文本、图片、视频、音频、生成和扩展节点。", { to: "/canvas", surface: "无限画布" }),
  tool("canvas-connections", "连线与多选", "连接节点、框选、多选连接线并批量删除。", { to: "/canvas", surface: "无限画布", status: "local" }),
  tool("canvas-clipboard", "复制粘贴", "复制节点，也可粘贴外部文本或截图图片。", { to: "/canvas", surface: "无限画布", status: "local" }),
  tool("canvas-operation-split", "智能切图", "把一张图按内容拆成多个结果。", { to: "/canvas", surface: "操作节点", status: "confirm" }),
  tool("canvas-operation-upscale", "高清放大", "提升清晰度并输出高分辨率图片。", { to: "/canvas", surface: "操作节点", status: "confirm" }),
  tool("canvas-operation-crop", "裁剪", "按选区或比例裁剪图片。", { to: "/canvas", surface: "操作节点", status: "local" }),
  tool("canvas-operation-angles", "多角度", "根据商品或角色生成多角度视图。", { to: "/canvas", surface: "操作节点", status: "confirm" }),
  tool("canvas-operation-prompt", "反推提示词", "分析图片并生成可继续编辑的提示词。", { to: "/canvas", surface: "操作节点", status: "confirm" }),
];

const BUSINESS_TOOLS = [
  tool("text-to-image", "文生图", "文字生成高清图片，支持模型、比例、质量和批量数量。", { to: "/text-to-image", surface: "AI 创作", status: "confirm" }),
  tool("illustration-coloring", "插画染色", "上传线稿并生成保留结构的彩色插画。", { to: "/ai-illustration-coloring", surface: "AI 创作", status: "confirm" }),
  tool("ui-design", "UI 设计稿", "生成界面、组件和多页面设计稿。", { to: "/design-workshop", surface: "AI 创作", status: "confirm" }),
  tool("model-sheet", "模型设计", "生成角色或物体多视角建模参考。", { to: "/model-sheet", surface: "AI 创作", status: "confirm" }),
  tool("game-art", "游戏设计", "生成角色、道具、图标和游戏 UI。", { to: "/game-art", surface: "AI 创作", status: "confirm" }),
  ...[
    ["shoot", "AI 创意商拍", "影棚级商品场景图"], ["listing", "商品套图", "主图、卖点图和场景图成套生成"],
    ["clone", "爆款图复刻", "复用参考图视觉结构并替换商品"], ["detail", "A+ / 详情页", "规划并生成电商详情页模块"],
    ["campaign", "AI 营销图", "促销海报与社媒素材"], ["background", "AI 背景图", "保持商品不变并生成商业背景"],
    ["outpaint", "智能扩图", "扩展边界并适配新画幅"], ["enhance", "真实增强", "修复模糊、噪点和压缩痕迹"],
    ["tryon", "AI 虚拟试衣", "服装与模特合成真实上身图"], ["handheld", "手持商品图", "生成真实手持主图与套图"],
    ["accessory", "AI 饰品穿戴", "生成珠宝、眼镜和腕表真人佩戴图"], ["backdrop", "背景复刻", "迁移参考背景的空间、光线和色彩"],
    ["shadow", "AI 商品阴影", "为商品添加符合光源的自然阴影"],
  ].map(([id, name, description]) => tool(`ecommerce-${id}`, name, description, { to: `/ecommerce-design?tool=${id}`, surface: "AI 电商", status: "confirm" })),
];

const UTILITY_TOOLS = [
  tool("background-remove", "背景移除", "智能抠图并导出透明背景。", { to: "/tools/background-remove", surface: "实用工具", status: "confirm" }),
  tool("image-compress", "图片压缩", "在浏览器本地减小图片体积并保留清晰度。", { to: "/tools/image-compress", surface: "实用工具", status: "local" }),
  tool("puzzle", "拼图", "在浏览器本地拼贴多张图片并导出。", { to: "/tools/puzzle", surface: "实用工具", status: "local" }),
  tool("assets", "我的资产", "搜索、分组、标签、批量管理、回收站和来源追溯。", { to: "/assets", surface: "资产" }),
  tool("prompts", "提示词库", "搜索和复用管理员分配的提示词。", { to: "/prompts", surface: "资产" }),
  tool("history", "生成历史", "查看图片、文本、失败原因和生成耗时。", { to: "/history", surface: "记录" }),
  tool("share", "作品社区", "提交作品、审核并公开展示。", { to: "/share", surface: "作品" }),
  tool("developer-api", "开放 API", "创建 API Key、调用生图和工作流接口并接收 Webhook。", { to: "/developer-api", surface: "开放能力", status: "controlled" }),
  tool("wallet", "钱包与账单", "查看积分余额、变动明细和订单。", { to: "/wallet", surface: "账户" }),
];

export const TOOL_GROUPS = [
  { id: "assistant", label: "AI 助手", description: "对话、研究、文件和跨工作区工具", tools: ASSISTANT_TOOLS },
  { id: "canvas", label: "无限画布", description: "画布界面与全部内置 Agent 工具", tools: [...CANVAS_INTERFACE_TOOLS, ...CANVAS_AGENT_TOOLS] },
  { id: "business", label: "业务创作", description: "生图、设计和全部 AI 电商业务", tools: BUSINESS_TOOLS },
  { id: "utility", label: "平台与实用工具", description: "图片处理、资产、历史和开放能力", tools: UTILITY_TOOLS },
];

export function runtimeMediaTools(config) {
  return (config?.features?.["ai.mediaTools"]?.config?.tools || []).map((item) => tool(
    `runtime-media-${item.id}`,
    String(item.name || item.label || "媒体工具"),
    String(item.description || `${item.modality === "video" ? "视频" : item.modality === "audio" ? "音频" : "图片"}处理模型`),
    { to: `/tools/${encodeURIComponent(item.id)}`, surface: "后台配置媒体工具", status: "confirm", dynamic: true },
  ));
}
