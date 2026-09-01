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

/** 实际发给服务端的模式：有文档或寒暄时不能走图片生成。 */
export function assistantSendMode(creationType, documentCount = 0, prompt = '') {
  if (Number(documentCount) > 0) return 'chat'
  if (isAssistantSmallTalk(prompt)) return creationType === 'agent' ? 'agent' : 'chat'
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
}) {
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
    usageStartedAt: Date.now(),
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
    routing: responseMode === 'agent',
    statusStage:
      responseMode === 'agent'
        ? 'routing'
        : responseMode === 'image'
          ? 'preparing-image'
          : 'preparing-context',
    ...(userMessageId ? { userMessageId } : {}),
  }
}

const MESSAGE_STATUS = {
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
