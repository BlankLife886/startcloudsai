/** 创作台工具目录 — 对齐大厂「创作入口」卡片墙 */
export const STUDIO_TOOLS = [
  {
    id: 'assistant',
    to: '/assistant',
    label: 'AI 助手',
    tagline: '连续对话 · 边聊边出图',
    icon: 'bi-chat-square-text-fill',
    cover: '/sucai/home-intro-02.png',
    tone: 'violet',
    badge: '对话',
    taskType: 'assistant',
  },
  {
    id: 't2i',
    to: '/text-to-image',
    label: '文生图',
    tagline: '文字生成高清图像',
    icon: 'bi-stars',
    cover: '/sucai/ai-wallpaper-server-227acd04-c4f2-490f-87ec-999804749927-1.png',
    tone: 'indigo',
    badge: '热门',
    feature: 'ai.wallpaperGeneration',
    taskType: 't2i',
  },
  {
    id: 'coloring',
    to: '/ai-illustration-coloring',
    label: '插画染色',
    tagline: '线稿智能上色',
    icon: 'bi-brush-fill',
    cover: '/sucai/home-intro-03.png',
    tone: 'rose',
    badge: '上色',
    feature: 'ai.illustrationColoring',
    taskType: 'coloring',
  },
  {
    id: 'ui',
    to: '/design-workshop',
    label: 'UI 设计稿',
    tagline: '界面与组件稿',
    icon: 'bi-bezier2',
    cover: '/sucai/ui-design-1785420316960.png',
    tone: 'cyan',
    badge: '设计',
    feature: 'ai.uiDesign',
    taskType: 'ui_design',
  },
  {
    id: 'model',
    to: '/model-sheet',
    label: '超高清模型图',
    tagline: '多视角建模参考',
    icon: 'bi-person-bounding-box',
    cover: '/sucai/ultra-model-sheet-board-1785420340076.png',
    tone: 'emerald',
    badge: '模型',
    feature: 'ai.ultraModelSheet',
    taskType: 'model_sheet',
  },
  {
    id: 'game',
    to: '/game-art',
    label: '游戏设计',
    tagline: '角色 · 道具 · UI · 图标',
    icon: 'bi-controller',
    cover: '/sucai/game-character-1785420168113.png',
    tone: 'amber',
    badge: '游戏',
    feature: 'ai.gameDesign',
    taskType: 'game_art',
  },
  {
    id: 'puzzle',
    to: '/ai-puzzle',
    label: 'AI 拼图',
    tagline: '模板拼贴导出',
    icon: 'bi-puzzle-fill',
    cover: '/sucai/home-intro-sticker-sheet.png',
    tone: 'sky',
    badge: '拼图',
    feature: 'ai.puzzle',
    taskType: 'puzzle',
  },
]

export const PROMPT_TASK_TYPES = [
  { id: 't2i', label: '文生图', to: '/text-to-image' },
  { id: 'coloring', label: '插画染色', to: '/ai-illustration-coloring' },
  { id: 'ui_design', label: 'UI 设计稿', to: '/design-workshop' },
  { id: 'model_sheet', label: '模型图', to: '/model-sheet' },
  { id: 'game_art', label: '游戏设计', to: '/game-art' },
  { id: 'assistant', label: 'AI 助手', to: '/assistant' },
]

export const PROMPT_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今日最新', scope: 'today' },
  { id: 'favorites', label: '我的收藏', scope: 'favorites' },
  { id: 'portrait', label: '人像' },
  { id: 'photography', label: '摄影' },
  { id: 'anime', label: '二次元' },
  { id: 'scifi', label: '科幻' },
  { id: 'nature', label: '自然' },
  { id: 'design', label: '设计' },
  { id: 'other', label: '其他' },
]

export const PENDING_PROMPT_KEY = 'starclouds:pending-prompt'
const PENDING_PROMPT_TTL_MS = 10 * 60 * 1000

function pendingStorage() {
  if (typeof window === 'undefined') return null
  // localStorage：新窗口/新标签也能带到目标工作台；sessionStorage 仅当前页签
  try {
    return window.localStorage
  } catch {
    try {
      return window.sessionStorage
    } catch {
      return null
    }
  }
}

export function studioRouteForTaskType(taskType = '') {
  const hit = PROMPT_TASK_TYPES.find((item) => item.id === taskType)
  return hit?.to || '/text-to-image'
}

export function stashPendingPrompt({ prompt = '', taskType = 't2i' } = {}) {
  const storage = pendingStorage()
  if (!storage) return
  const text = String(prompt || '').trim()
  if (!text) return
  storage.setItem(
    PENDING_PROMPT_KEY,
    JSON.stringify({ prompt: text, taskType: taskType || 't2i', at: Date.now() }),
  )
}

/**
 * @param {string|string[]} [expectedType] 期望的 taskType；空则接受任意类型
 */
export function takePendingPrompt(expectedType = '') {
  const storage = pendingStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_PROMPT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    const prompt = String(data?.prompt || '').trim()
    if (!prompt) return null
    const expected = Array.isArray(expectedType)
      ? expectedType.map(String).filter(Boolean)
      : expectedType
        ? [String(expectedType)]
        : []
    if (expected.length && data?.taskType && !expected.includes(String(data.taskType))) {
      return null
    }
    if (Date.now() - Number(data?.at || 0) > PENDING_PROMPT_TTL_MS) {
      storage.removeItem(PENDING_PROMPT_KEY)
      return null
    }
    storage.removeItem(PENDING_PROMPT_KEY)
    // 兼容旧 sessionStorage 残留
    try {
      window.sessionStorage?.removeItem(PENDING_PROMPT_KEY)
    } catch {
      // ignore
    }
    return { prompt, taskType: data?.taskType || 't2i' }
  } catch {
    storage.removeItem(PENDING_PROMPT_KEY)
    return null
  }
}
