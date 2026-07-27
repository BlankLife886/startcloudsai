// AI 助手消息领域函数：纯函数与常量，供视图/组合式复用。

export function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const IMAGE_COUNTS = [1, 2, 3, 4]

/** 从提示词中提取“N 张/幅…”的数量要求，无匹配返回 0。 */
export function imageCountFromPrompt(prompt) {
  const text = String(prompt || '').trim()
  if (!text) return 0
  const chineseNumbers = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 }
  const patterns = [
    /([1-4一二两三四])\s*(?:张|幅)\s*(?:图片|图像|图|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)?/i,
    /([1-4一二两三四])\s*(?:个|份)\s*(?:图片|图像|图|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)/i,
    /(?:图片|图像|海报|插画|头像|壁纸|封面|logo|标志|视觉稿|效果图)\s*([1-4一二两三四])\s*(?:张|幅|个|份)?/i,
    /\b([1-4])\s*(?:images?|pictures?|variations?)\b/i,
  ]
  for (const pattern of patterns) {
    const matched = text.match(pattern)?.[1]
    if (!matched) continue
    const count = Number(matched) || chineseNumbers[matched] || 0
    if (IMAGE_COUNTS.includes(count)) return count
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
    prompt,
    model: previous?.model || defaults.model,
    ratio: previous?.ratio || defaults.ratio,
    resolution: previous?.resolution || defaults.resolution,
    count: responseMode === 'chat' ? 0 : defaults.count || previous?.count || 2,
    requestSize: previous?.requestSize || defaults.requestSize,
    width: previous?.width || defaults.width,
    height: previous?.height || defaults.height,
    quality: previous?.quality || defaults.quality,
    progress: 0,
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
  thinking: {
    label: '正在梳理上下文',
    detail: '正在读取前文并组织回答思路。',
    tone: 'working',
    progress: 32,
  },
  'analyzing-image': {
    label: '正在理解图片',
    detail: '正在读取画面、文字和细节，并结合你的问题组织回答。',
    tone: 'working',
    progress: 38,
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
  'generating-image': {
    label: '正在生成图片',
    detail: '图片任务已进入生成阶段，完成后会自动显示结果。',
    tone: 'working',
    progress: 8,
  },
  stopping: {
    label: '正在停止',
    detail: '正在结束当前生成任务并保留已生成的内容。',
    tone: 'working',
    progress: 0,
  },
  stopped: {
    label: '已停止',
    detail: '本次生成已由你手动停止。',
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
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
