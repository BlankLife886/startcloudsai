import { ECOMMERCE_MODES } from '@/features/ecommerce/ecommerceTools'
import {
  isSmartCanvasTask,
  studioRouteForTask,
  studioRouteForTaskType,
} from './taskRoutes'

export { isSmartCanvasTask, studioRouteForTask, studioRouteForTaskType }

export const ecomToolCover = (id) => `/sucai/ecom-thumb-${id}.webp`

export const COMMERCE_ENTRY_GROUPS = [
  {
    id: 'model',
    label: '服饰模特',
    description: '服装、商品与饰品的真人展示',
    cover: '/sucai/studio-cover-ecom-model.webp',
    to: '/ecommerce-design?tool=tryon',
    ids: ['tryon', 'handheld', 'accessory'],
  },
  {
    id: 'create',
    label: '商品设计',
    description: '商拍、套图与详情页视觉',
    cover: '/sucai/studio-cover-ecom-create.webp',
    to: '/ecommerce-design?tool=shoot',
    ids: ['shoot', 'listing', 'detail'],
  },
  {
    id: 'image',
    label: '图片处理',
    description: '营销图、背景、阴影与画质处理',
    cover: '/sucai/studio-cover-ecom-image.webp',
    to: '/ecommerce-design?tool=campaign',
    ids: ['campaign', 'background', 'backdrop', 'shadow', 'outpaint', 'enhance'],
  },
]

const ECOMMERCE_STUDIO_HIGHLIGHTS = ['shoot', 'listing', 'tryon']
  .map((modeId) => ECOMMERCE_MODES.find((mode) => mode.id === modeId)?.shortLabel)
  .filter(Boolean)

/** 创作台工具目录 — 对齐大厂「创作入口」卡片墙 */
export const STUDIO_TOOLS = [
  {
    id: 'assistant',
    to: '/assistant',
    label: 'AI 助手',
    tagline: '连续对话 · 边聊边出图',
    icon: 'bi-chat-square-text-fill',
    cover: '/sucai/studio-cover-assistant.webp',
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
    cover: '/sucai/studio-cover-t2i.webp',
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
    cover: '/sucai/studio-cover-coloring.webp',
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
    cover: '/sucai/studio-cover-ui.webp',
    tone: 'cyan',
    badge: '设计',
    feature: 'ai.uiDesign',
    taskType: 'ui_design',
  },
  {
    id: 'ecommerce',
    to: '/ecommerce-design',
    label: 'AI 电商',
    tagline: '商拍 · 套图 · 详情页 · 人像穿戴',
    icon: 'bi-bag-check-fill',
    cover: '/sucai/studio-cover-ecom-create.webp',
    tone: 'lime',
    badge: `${ECOMMERCE_MODES.length} 项工具`,
    highlights: ECOMMERCE_STUDIO_HIGHLIGHTS,
    feature: 'ai.ecommerceDesign',
    taskType: 'ecommerce_design',
  },
  {
    id: 'model',
    to: '/model-sheet',
    label: '模型设计',
    tagline: '多视角建模参考',
    icon: 'bi-person-bounding-box',
    cover: '/sucai/studio-cover-model.webp',
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
    cover: '/sucai/studio-cover-game.webp',
    tone: 'amber',
    badge: '游戏',
    feature: 'ai.gameDesign',
    taskType: 'game_art',
  },
]

/** 本地拼图工具（挂在「工具」下，不占用创作台 AI 入口） */
export const PUZZLE_TOOL = {
  id: 'puzzle',
  to: '/tools/puzzle',
  label: '拼图',
  tagline: '模板拼贴导出',
  icon: 'bi-puzzle-fill',
  cover: '/sucai/home-intro-sticker-sheet.png',
}

export const PROMPT_TASK_TYPES = [
  { id: 't2i', label: '文生图', to: '/text-to-image' },
  { id: 'infinite_canvas', label: '无限画布', to: '/canvas?mode=new' },
  { id: 'coloring', label: '插画染色', to: '/ai-illustration-coloring' },
  { id: 'ui_design', label: 'UI 设计稿', to: '/design-workshop' },
  { id: 'ecommerce_design', label: 'AI 电商', to: '/ecommerce-design' },
  { id: 'model_sheet', label: '模型设计', to: '/model-sheet' },
  { id: 'game_art', label: '游戏设计', to: '/game-art' },
  { id: 'assistant', label: 'AI 助手', to: '/assistant' },
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

export function stashPendingPrompt({ prompt = '', taskType = 't2i', config: launchConfig = {} } = {}) {
  const storage = pendingStorage()
  if (!storage) return
  const text = String(prompt || '').trim()
  const config = normalizePendingLaunchConfig(launchConfig)
  if (!text && !Object.keys(config).length) return
  storage.setItem(
    PENDING_PROMPT_KEY,
    JSON.stringify({ version: 2, prompt: text, taskType: taskType || 't2i', config, at: Date.now() }),
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
    const config = normalizePendingLaunchConfig(data?.config)
    if (!prompt && !Object.keys(config).length) return null
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
    return { prompt, taskType: data?.taskType || 't2i', config }
  } catch {
    storage.removeItem(PENDING_PROMPT_KEY)
    return null
  }
}

function normalizePendingLaunchConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const allowedKeys = [
    'skill',
    'skillPrompt',
    'materialPrompt',
    'mode',
    'ratio',
    'resolution',
    'quality',
    'count',
    'model',
    'material',
    'device',
    'skills',
    'reasoningEffort',
    'referenceImages',
    'autoStart',
    'costConfirmed',
  ]
  const normalized = {}
  for (const key of allowedKeys) {
    const raw = value[key]
    if (raw === null || raw === undefined || raw === '') continue
    if (key === 'skills') {
      normalized.skills = [
        ...new Set(
          (Array.isArray(raw) ? raw : [raw])
            .map((item) => String(item || '').trim().slice(0, 160))
            .filter(Boolean),
        ),
      ].slice(0, 12)
      continue
    }
    if (key === 'referenceImages') {
      normalized.referenceImages = (Array.isArray(raw) ? raw : [])
        .map((item, index) => {
          if (!item || typeof item !== 'object') return null
          const dataUrl = String(item.dataUrl || item.url || '').trim()
          const fileKey = String(item.fileKey || item.key || '').trim()
          if (!dataUrl && !fileKey) return null
          return {
            id: String(item.id || `studio-reference-${index + 1}`).slice(0, 160),
            name: String(item.name || item.label || `参考图 ${index + 1}`).slice(0, 160),
            dataUrl: dataUrl.slice(0, 2000),
            thumbnailUrl: String(item.thumbnailUrl || '').trim().slice(0, 2000),
            fileKey: fileKey.slice(0, 500),
          }
        })
        .filter(Boolean)
        .slice(0, 4)
      continue
    }
    if (key === 'autoStart' || key === 'costConfirmed') {
      normalized[key] = raw === true
      continue
    }
    if (key === 'count' || key === 'resolution') {
      const numeric = Number(raw)
      normalized[key] = Number.isFinite(numeric) && String(raw).trim() !== '' ? numeric : String(raw)
      continue
    }
    normalized[key] = String(raw).slice(
      0,
      key === 'skillPrompt' || key === 'materialPrompt' ? 4000 : 160,
    )
  }
  return normalized
}

export function composePendingLaunchPrompt(pending, maxLength = 0) {
  if (!pending || typeof pending !== 'object') return ''
  const parts = [pending.prompt, pending.config?.skillPrompt, pending.config?.materialPrompt]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const unique = parts.filter((value, index) => {
    if (parts.indexOf(value) !== index) return false
    return !parts.some((other, otherIndex) => otherIndex < index && other.includes(value))
  })
  const text = unique.join('\n')
  return maxLength > 0 ? text.slice(0, maxLength) : text
}
