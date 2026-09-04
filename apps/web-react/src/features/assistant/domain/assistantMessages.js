// AI 助手消息领域函数：纯函数与常量，供视图/组合式复用。

export function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const IMAGE_COUNTS = [1, 2, 3, 4]

export function assistantMessageMatchesRun(message, localAssistantId, run = {}, persisted = {}) {
  const messageId = String(message?.id || '')
  if (!messageId) return false
  const candidateIds = [localAssistantId, run?.assistantMessageId, persisted?.id]
    .map((value) => String(value || ''))
    .filter(Boolean)
  if (candidateIds.includes(messageId)) return true
  return Boolean(run?.id && String(message?.runId || '') === String(run.id))
}

const ASSISTANT_SMALL_TALK =
  /^(你好|您好|嗨+|哈喽|在吗|在么|hello|hi+|hey|thanks?|thank you|谢谢(你|您)?(了)?|早上好|早安|晚上好|你是谁|你能做什么|在不在)[呀啊呢吧嘛]*[\s!！。.?？]*$/i

/** 寒暄/短问候不应触发生图。 */
export function isAssistantSmallTalk(prompt) {
  const text = String(prompt || '').trim()
  if (!text || [...text].length > 16) return false
  return ASSISTANT_SMALL_TALK.test(text)
}

const ASSISTANT_IMAGE_ACTION =
  /(?:生成|创建|绘制|画|制作|做|设计|重绘|重做|修改|编辑|调整|优化|美化|替换|换成|改成|变成|去背景|抠图|擦除|移除|删除|添加|扩图|裁剪|切图|上色|修复|高清放大|放大|generate|create|draw|design|make|render|illustrate|redraw|edit|modify|adjust|replace|remove|crop|upscale)/i

const ASSISTANT_IMAGE_TARGET =
  /(?:图片|图像|照片|海报|插画|人像|头像|壁纸|封面|品牌图标|图标|logo|标志|主视觉|产品图|商品图|视觉稿|效果图|参考图|画面|背景|人物|主体|构图|配色|界面|弹窗|\bui\b|images?|pictures?|photos?|portraits?|posters?|illustrations?|avatars?|wallpapers?|covers?|logos?|icons?|visuals?|backgrounds?)/i

const ASSISTANT_DIRECT_MEDIA_ACTION =
  /(?:去背景|换背景|抠图|扩图|切图|高清放大|图片压缩|压缩图片|裁剪(?:这|该|上|前|第)?(?:张|幅)?(?:图|图片|照片)|remove\s+(?:the\s+)?background|crop\s+(?:this\s+)?(?:image|photo)|upscale\s+(?:this\s+)?(?:image|photo))/i

const ASSISTANT_DIRECT_DRAW_ACTION =
  /(?:(?:^|请|帮我|给我|替我|再)\s*(?:画(?!面|布|质|法|风)|绘制)\s*(?:一|两|二|三|四|五|六|七|八|九|十|个|只|张|幅|出|一下)|\b(?:draw|illustrate)\s+(?:a|an|the|this|that|one|two|three|\d+)\b)/i

const ASSISTANT_COUNTED_IMAGE_ACTION =
  /(?:生成|创建|制作|设计|做|来).{0,12}(?:[1-9]|1[0-6]|[一二两三四五六七八九十])\s*(?:张|幅)/i

const ASSISTANT_NEGATED_IMAGE_ACTION =
  /(?:(?:不要|无需|不用|别|不需要|禁止|停止|取消).{0,12}(?:生成|生图|创建|绘制|画|制作|设计|重绘|修改|编辑|调整|替换|去背景|抠图|扩图|裁剪|切图)|(?:do\s+not|don't|dont|no\s+need\s+to|without)\s+(?:generate|create|draw|design|render|edit|modify|replace|crop|upscale))/i

const ASSISTANT_IMAGE_TECHNICAL_TOPIC =
  /(?:(?:图片|图像|照片).{0,8}(?:数据库|数据表|数据结构|字段|索引|存储|接口|api|算法|模型|格式|编码|加载|性能|组件|代码|schema)|(?:数据库|数据表|数据结构|字段|索引|存储|接口|api|算法|模型|加载|性能|组件|代码|schema).{0,8}(?:图片|图像|照片)|(?:images?|pictures?|photos?).{0,12}(?:database|schema|storage|index|field|api|algorithm|model|format|encoding|loading|performance|component|code)|(?:database|schema|storage|index|field|api|algorithm|model|loading|performance|component|code).{0,12}(?:images?|pictures?|photos?))/i

const ASSISTANT_IMAGE_KNOWLEDGE_QUESTION =
  /^(?:(?:请)?(?:解释|介绍|说明|讲讲|分析|讨论|比较)|什么是|为什么|为何|如何|怎么|怎样|你(?:会|能|可以|支持)|(?:please\s+)?(?:explain|describe|discuss|compare)|how\s+(?:do|to)|what\s+is).{0,48}(?:生成|创建|绘制|画|制作|设计|编辑|修改|图片|图像|照片|海报|插画|人像|头像|壁纸|logo|图标|generate|create|draw|design|edit|image|picture|photo|poster|logo|icon)/i

const ASSISTANT_PERSONAL_IMAGE_COMMAND =
  /(?:帮我|给我|替我)\s*(?:直接)?\s*(?:生成|创建|绘制|画|制作|设计|重绘|修改|编辑|调整|优化|替换|去背景|抠图|扩图|裁剪|切图)/i

const ASSISTANT_SEQUENCED_IMAGE_COMMAND =
  /(?:然后|接着|随后|再|并且|同时).{0,12}(?:直接)?\s*(?:帮我|给我|替我)?\s*(?:生成|创建|绘制|画|制作|设计|重绘).{0,24}(?:图片|图像|照片|海报|插画|人像|头像|壁纸|封面|logo|图标|主视觉|产品图|商品图|image|picture|photo|poster|logo|icon)/i

function assistantPromptClauses(prompt) {
  return String(prompt || '')
    .trim()
    .toLowerCase()
    .split(/[，。；;!?！？\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function assistantClauseRequestsImageAction(clause) {
  if (!clause || ASSISTANT_NEGATED_IMAGE_ACTION.test(clause)) return false
  if (ASSISTANT_IMAGE_TECHNICAL_TOPIC.test(clause)) return false
  if (ASSISTANT_IMAGE_KNOWLEDGE_QUESTION.test(clause) &&
    !ASSISTANT_PERSONAL_IMAGE_COMMAND.test(clause) &&
    !ASSISTANT_SEQUENCED_IMAGE_COMMAND.test(clause)) return false
  if (ASSISTANT_DIRECT_MEDIA_ACTION.test(clause) || ASSISTANT_DIRECT_DRAW_ACTION.test(clause) || ASSISTANT_COUNTED_IMAGE_ACTION.test(clause)) return true
  if (!ASSISTANT_IMAGE_ACTION.test(clause) || !ASSISTANT_IMAGE_TARGET.test(clause)) return false

  const action = clause.match(ASSISTANT_IMAGE_ACTION)
  const target = clause.match(ASSISTANT_IMAGE_TARGET)
  const actionIndex = action?.index ?? -1
  const targetIndex = target?.index ?? -1
  if (actionIndex < 0 || targetIndex < 0) return false
  if (actionIndex < targetIndex + target[0].length && targetIndex < actionIndex + action[0].length) return false
  return Math.abs(actionIndex - targetIndex) <= 32
}

function assistantPromptRequestsWorkspaceTool(prompt) {
  const text = String(prompt || '').trim().toLowerCase()
  if (!text) return false

  const explicitWebSearch =
    /(?:联网|上网|网上搜索|搜索网页|搜索网络|联网搜索|联网查找|联网查证|web search|search the web|browse the web|look up online)/i
  if (explicitWebSearch.test(text)) return true

  const taskStatus = /(?:进度|状态|失败|报错|错误|重试|退款|扣费|积分|排队|运行中|卡住|还在跑|还在转|多久|取消|完成了吗|为什么慢)/i
  const taskSubject = /(?:我的任务|这条任务|刚才的任务|最近任务|任务\s*(?:id|编号)|生成任务|生图|那张图|这张图)/i
  if (taskStatus.test(text) && taskSubject.test(text)) return true

  const workspaceNavigation =
    /(?:打开|进入|前往|跳转到|带我去|发送到|导入到|放到|移到).{0,18}(?:无限画布|ai\s*电商|文生图|图片创作|ui\s*设计|模型设计|游戏设计|素材库|历史记录|钱包|工具中心)/i
  if (workspaceNavigation.test(text)) return true

  const imageSearch = /(?:请|帮我|给我|替我)?\s*(?:搜索|查找|找)(?:一下|一些|几张|[1-9一二两三四五六七八九十]+张)?\s*.{0,16}(?:图片|照片|素材图|参考图)/i
  if (!ASSISTANT_IMAGE_TECHNICAL_TOPIC.test(text) && imageSearch.test(text)) return true

  const productImport = /(?:导入|抓取).{0,18}(?:商品链接|商品页|产品链接|产品页).{0,18}(?:ai\s*电商|电商工作区)?/i
  if (productImport.test(text)) return true

  const referenceRebuild = /(?:复刻|重建|还原).{0,18}(?:这张|该|参考)?(?:图|图片|照片).{0,18}(?:无限画布|可编辑|工作流)/i
  if (referenceRebuild.test(text)) return true

  const webpageCapture = /(?:(?:截取|捕获|生成).{0,12}(?:网页|网站|页面)(?:截图|快照)|(?:给|把).{0,12}(?:网页|网站|网址|页面).{0,12}截图)/i
  if (webpageCapture.test(text)) return true

  const deliveryExport = /(?:导出|打包|下载).{0,12}(?:交付包|zip|全部图片|本次图片|对话图片)/i
  return deliveryExport.test(text)
}

function assistantPromptRequestsAgent(prompt) {
  return assistantPromptClauses(prompt).some(assistantClauseRequestsImageAction) ||
    assistantPromptRequestsWorkspaceTool(prompt)
}

/** 实际发给服务端的模式：文档可参与 Agent 复合任务，但不能直接进入图片生成。 */
export function assistantSendMode(creationType, documentCount = 0, prompt = '') {
  if (Number(documentCount) > 0) {
    if (isAssistantSmallTalk(prompt)) return 'chat'
    if (creationType === 'agent' || creationType === 'image' || assistantPromptRequestsAgent(prompt)) return 'agent'
    return 'chat'
  }
  if (isAssistantSmallTalk(prompt)) return creationType === 'agent' ? 'agent' : 'chat'
  if (creationType === 'chat' && assistantPromptRequestsAgent(prompt)) return 'agent'
  if (creationType === 'image' || creationType === 'agent') return creationType
  return 'chat'
}

/** 从提示词中提取“N 张/幅…”的数量要求，无匹配返回 0。 */
export function imageCountFromPrompt(prompt, maxCount = IMAGE_COUNTS[IMAGE_COUNTS.length - 1]) {
  const text = String(prompt || '').trim()
  if (!text) return 0
  const limit = Math.min(16, Math.max(1, Math.floor(Number(maxCount) || IMAGE_COUNTS[IMAGE_COUNTS.length - 1])))
  const chineseNumbers = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const patterns = [
    /([1-9]|1[0-6]|[一二两三四五六七八九十])\s*(?:张|幅)\s*(?:图片|图像|图|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)?/i,
    /([1-9]|1[0-6]|[一二两三四五六七八九十])\s*(?:个|份)\s*(?:图片|图像|图|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)/i,
    /(?:图片|图像|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)\s*([1-9]|1[0-6]|[一二两三四五六七八九十])\s*(?:张|幅|个|份)?/i,
    /\b([1-9]|1[0-6])\s*(?:images?|pictures?|variations?)\b/i,
  ]
  for (const pattern of patterns) {
    const matched = text.match(pattern)?.[1]
    if (!matched) continue
    const count = Number(matched) || chineseNumbers[matched] || 0
    if (count >= 1 && count <= limit) return count
  }
  return 0
}

/**
 * 组装 assistant 占位消息。sendMessage 与编辑重发共用同一工厂，
 * `previous` 传上一条回复时优先继承其生成参数。
 */
export function createAssistantPlaceholder({
  prompt,
  responseMode,
  defaults,
  previous = null,
  userMessageId = '',
  queued = false,
}) {
  const waiting = Boolean(queued)
  return {
    id: uid(),
    role: 'assistant',
    content: '',
    images: [],
    kind: responseMode,
    pending: true,
    error: '',
    feedback: '',
    createdAt: new Date().toISOString(),
    usageStartedAt: waiting ? 0 : Date.now(),
    prompt,
    model: previous?.model || defaults.model,
    reasoningEffort: previous?.reasoningEffort || defaults.reasoningEffort || '',
    ratio: previous?.ratio || defaults.ratio,
    requestRatio: previous?.requestRatio || defaults.requestRatio || defaults.ratio,
    resolution: previous?.resolution || defaults.resolution,
    count: responseMode === 'image' || responseMode === 'agent' ? defaults.count || previous?.count || 2 : 0,
    requestSize: previous?.requestSize || defaults.requestSize,
    width: previous?.width || defaults.width,
    height: previous?.height || defaults.height,
    quality: previous?.quality || defaults.quality,
    progress: 0,
    routing: responseMode === 'agent' && !waiting,
    ...(waiting ? { status: 'queued' } : {}),
    statusStage: waiting
      ? 'queued'
      : responseMode === 'agent'
        ? 'routing'
        : responseMode === 'image'
          ? 'preparing-image'
          : 'preparing-context',
    ...(userMessageId ? { userMessageId } : {}),
  }
}

const MESSAGE_STATUS = {
  queued: {
    label: '排队中',
    detail: '当前对话已有任务在执行，完成后会自动开始这一条。',
    tone: 'waiting',
    progress: 0,
  },
  routing: {
    label: '正在理解你的问题',
    detail: '正在结合当前对话判断你的真实意图。',
    tone: 'working',
    progress: 14,
  },
  'preparing-context': {
    label: '正在准备上下文',
    detail: '正在读取近期对话、附件状态和模型窗口。',
    tone: 'working',
    progress: 22,
  },
  'compacting-context': {
    label: '正在压缩较早对话',
    detail: '正在保留关键目标与约束，并为当前回答释放上下文空间。',
    tone: 'working',
    progress: 30,
  },
  thinking: {
    label: '正在组织回答',
    detail: '上下文已准备，正在形成直接、完整的回答。',
    tone: 'working',
    progress: 42,
  },
  web_search: {
    label: '正在联网搜索',
    detail: '正在检索公开网页并核对来源，完成后会在回答下方显示引用。',
    tone: 'working',
    progress: 48,
  },
  task_status: {
    label: '正在查询任务状态',
    detail: '正在核对真实阶段、重试记录和积分结算情况。',
    tone: 'working',
    progress: 48,
  },
  tool_action: {
    label: '正在执行工具',
    detail: '正在校验参数并准备可确认的操作结果。',
    tone: 'working',
    progress: 48,
  },
  'analyzing-document': {
    label: '正在分析文档',
    detail: '正在检索附件中的相关内容并核对引用依据。',
    tone: 'working',
    progress: 46,
  },
  'analyzing-image': {
    label: '正在理解图片',
    detail: '正在读取画面、文字和细节，并结合你的问题组织回答。',
    tone: 'working',
    progress: 38,
  },
  'converting-file': {
    label: '正在转换 PSD',
    detail: '正在识别主体、背景和文字区域，并生成可下载的自动拆层 PSD。',
    tone: 'working',
    progress: 58,
  },
  'submitting-file': {
    label: '正在提交文件任务',
    detail: '正在整理需求和参考图，并提交可编辑文件制作任务。',
    tone: 'working',
    progress: 24,
  },
  'generating-file': {
    label: '正在制作可编辑文件',
    detail: '上游正在生成版式、可编辑内容和配套素材。',
    tone: 'working',
    progress: 52,
  },
  'saving-file': {
    label: '正在保存文件',
    detail: '制作已完成，正在校验文件并保存到你的资产空间。',
    tone: 'working',
    progress: 86,
  },
  answering: {
    label: '正在输入回答',
    detail: '回答正在实时生成并逐步呈现，你可以随时停止。',
    tone: 'working',
    progress: 62,
  },
  'preparing-image': {
    label: '正在准备图片任务',
    detail: '正在整理提示词、参考图与画面尺寸。',
    tone: 'working',
    progress: 22,
  },
  'submitting-image': {
    label: '正在提交图片任务',
    detail: '参考图与生成参数已准备完成，正在提交给图片服务。',
    tone: 'working',
    progress: 34,
  },
  'planning-image': {
    label: '正在整理创作方案',
    detail: 'Agent 正在结合对话和参考图，准备可编辑的生成参数。',
    tone: 'working',
    progress: 48,
  },
  'generating-image': {
    label: '正在生成图片',
    detail: '图片任务已进入生成阶段，完成后会自动显示结果。',
    tone: 'working',
    progress: 56,
  },
  'fetching-image': {
    label: '正在获取生成结果',
    detail: '上游已经完成部分或全部图片，正在安全拉取结果。',
    tone: 'working',
    progress: 78,
  },
  'saving-image': {
    label: '正在保存图片',
    detail: '正在写入对象存储并生成预览图，完成后会自动显示。',
    tone: 'working',
    progress: 90,
  },
  preparing: {
    label: '正在准备参考图',
    detail: '正在读取并整理本次生成需要的参考图片。',
    tone: 'working',
    progress: 22,
  },
  upstream_generating: {
    label: '上游正在生成',
    detail: '图片任务已经提交，正在等待上游完成生成。',
    tone: 'working',
    progress: 56,
  },
  fetching_result: {
    label: '正在获取生成结果',
    detail: '上游已经出图，正在拉取原始结果。',
    tone: 'working',
    progress: 78,
  },
  saving_result: {
    label: '正在保存图片',
    detail: '正在写入对象存储并生成展示图片。',
    tone: 'working',
    progress: 90,
  },
  stopping: {
    label: '正在停止',
    detail: '正在结束当前生成任务并保留已生成的内容。',
    tone: 'working',
    progress: 0,
  },
  stopped: {
    label: '已停止',
    detail: '本次任务已由你手动停止，费用以停止时的实际阶段为准。',
    tone: 'muted',
    progress: 0,
  },
}

export function messageIsQueued(message) {
  return Boolean(message?.pending && message.status !== 'running' && message.statusStage === 'queued')
}

export function messageStatus(message) {
  if (message?.error || message?.statusStage === 'failed') {
    return {
      key: 'failed',
      label: '生成失败',
      detail: message.error || '本次任务没有完成，请稍后重试。',
      tone: 'error',
      progress: 0,
    }
  }
  if (messageIsQueued(message)) {
    return { key: 'queued', ...MESSAGE_STATUS.queued }
  }
  let stage =
    message?.statusStage ||
    (message?.pending ? (message?.kind === 'image' ? 'generating-image' : 'answering') : 'complete')
  if (message?.pending) {
    const pendingStage = MESSAGE_STATUS[stage]
    if (!pendingStage || pendingStage.tone !== 'working') {
      stage = message?.routing
        ? 'routing'
        : message?.kind === 'image'
          ? 'generating-image'
          : message?.content
            ? 'answering'
            : 'thinking'
    }
  } else if (!['failed', 'stopped'].includes(stage)) {
    stage = 'complete'
  }
  const base = MESSAGE_STATUS[stage]
  if (base) {
    if (stage === 'analyzing-image' && message?.visualContextCount > 1) {
      return {
        key: stage,
        ...base,
        label: `正在理解图片（${message.visualContextCount} 张）`,
      }
    }
    if (stage === 'generating-image') {
      return { key: stage, ...base }
    }
    return { key: stage, ...base }
  }
  const isImage = message?.kind === 'image' || Boolean(message?.images?.length)
  if (message?.kind === 'proposal' && message?.proposal) {
    return {
      key: 'proposal',
      label: '创作方案已准备',
      detail: '确认提示词和参数后再开始图片生成。',
      tone: 'complete',
      progress: 100,
    }
  }
  return {
    key: 'complete',
    label: isImage ? '图片已生成' : '回答已完成',
    detail: isImage
      ? `已完成 ${message?.images?.length || 0} 张图片，可以预览或下载原图。`
      : '回答已经生成完成，可以复制、引用或继续追问。',
    tone: 'complete',
    progress: 100,
  }
}

export function messagePreview(content) {
  const preview = String(content || '')
    .replace(/```[\s\S]*?```/g, '代码片段')
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return preview.slice(0, 58) || '新的对话'
}

export function conversationTitle(prompt) {
  const compact = String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim()
  return compact.length > 22 ? `${compact.slice(0, 22)}…` : compact
}

export function messageDateKey(message) {
  const date = new Date(message?.createdAt)
  return Number.isNaN(date.getTime()) ? '' : date.toDateString()
}

export function formatMessageDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}
