/**
 * 任务单价服务：GET /api/meta/pricing 的 5 分钟缓存层。
 *
 * 单价一律以「分」为单位（与契约 *Cents 约定一致）。
 * 接口失败时返回 null，调用方展示「以服务端结算为准」且不阻断提交。
 */
import { getTaskPricing } from '@/services/metaApi'

const PRICING_CACHE_TTL_MS = 5 * 60 * 1000

/** 工作台 featureKey → 任务类型 type 的映射（用于查单价） */
export const FEATURE_TASK_TYPE_MAP = {
  wallpaper: 't2i',
  'ai.wallpaperGeneration': 't2i',
  'ai.optimize': 't2i',
  'ai.illustrationColoring': 'coloring',
  'ai.uiDesign': 'ui_design',
  'ai.ultraModelSheet': 'model_sheet',
  'ai.gameDesign': 'game_art',
  'ai.puzzle': 'puzzle',
}

let cached = null
let cachedAt = 0
let inFlight = null

/** 拉取任务单价（5 分钟内复用缓存；失败抛错，由调用方决定降级）。 */
export async function fetchTaskPricing({ force = false } = {}) {
  const now = Date.now()
  if (!force && cached && now - cachedAt < PRICING_CACHE_TTL_MS) return cached
  if (inFlight) return inFlight
  inFlight = getTaskPricing()
    .then((data) => {
      cached = data && typeof data === 'object' ? data : null
      cachedAt = Date.now()
      return cached
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/**
 * 某任务类型的单价（分/张）。
 * @returns {Promise<number|null>} null 表示单价不可用（接口失败或未配置）
 */
export async function getTaskUnitPriceCents(taskType) {
  const type = String(taskType || '').trim()
  if (!type) return null
  try {
    const pricing = await fetchTaskPricing()
    const value = Number(pricing?.taskPrices?.[type])
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

/** featureKey → 单价（分/张）。 */
export async function getFeatureUnitPriceCents(featureKey) {
  const type = FEATURE_TASK_TYPE_MAP[String(featureKey || '').trim()] || ''
  return getTaskUnitPriceCents(type)
}

/** 分 → '¥X.XX' */
export function formatPriceCents(cents) {
  const value = Number(cents || 0) / 100
  return `¥${value.toFixed(2)}`
}
