import { looksLikeIllustrationColoringTask } from '@/features/ai-shared/aiJobKinds'
import { getScopedLocalItem } from '@/services/scopedLocalStorage'

export const AI_WALLPAPER_TASKS_KEY = 'walleven_ai_wallpaper_tasks_v2'
export const AI_WALLPAPER_CAPABILITY_KIT_KEY = 'walleven_ai_wallpaper_capability_kit_v1'
export const AI_WALLPAPER_PREVIEW_HISTORY_KEY = 'wallpaper_ai_history'
export const AI_WALLPAPER_PREVIEW_RECIPES_KEY = 'wallpaper_ai_recipes'
export const AI_WALLPAPER_USAGE_LEDGER_KEY = 'wallpaper_ai_usage_ledger'
export const AI_WALLPAPER_STUDIO_DRAFT_KEY = 'walleven_ai_wallpaper_studio_draft_v1'

const AI_WALLPAPER_STATE_VERSION = 1
const MAX_TASKS = 30
const MAX_PREVIEW_HISTORY = 6
const MAX_PREVIEW_RECIPES = 20

function readJson(key, fallback) {
  try {
    const raw = getScopedLocalItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function readArray(value) {
  return Array.isArray(value) ? value : []
}

function compactTask(task = {}) {
  const { sourceFile: _sourceFile, styleReferenceFiles: _styleReferenceFiles, ...rest } =
    plainObject(task)
  return rest
}

function normalizeTasks(value) {
  return readArray(value)
    .map(compactTask)
    .filter((item) => item.id || item.serverJobId)
    .filter((item) => !looksLikeIllustrationColoringTask(item))
    .slice(0, MAX_TASKS)
}

function normalizeUsageLedger(value) {
  const ledger = plainObject(value)
  return {
    byDate: plainObject(ledger.byDate),
    byMonth: plainObject(ledger.byMonth),
    byModel: plainObject(ledger.byModel),
    byFeature: plainObject(ledger.byFeature),
  }
}

export function readLocalAiWallpaperState() {
  return {
    version: AI_WALLPAPER_STATE_VERSION,
    tasks: normalizeTasks(readJson(AI_WALLPAPER_TASKS_KEY, [])),
    capabilityKit: plainObject(readJson(AI_WALLPAPER_CAPABILITY_KIT_KEY, {})),
    previewHistory: readArray(readJson(AI_WALLPAPER_PREVIEW_HISTORY_KEY, [])).slice(0, MAX_PREVIEW_HISTORY),
    previewRecipes: readArray(readJson(AI_WALLPAPER_PREVIEW_RECIPES_KEY, [])).slice(0, MAX_PREVIEW_RECIPES),
    usageLedger: normalizeUsageLedger(readJson(AI_WALLPAPER_USAGE_LEDGER_KEY, {})),
    updatedAt: new Date().toISOString(),
  }
}

/** 云同步已下线：本地状态即最终状态，保留函数签名兼容旧调用。 */
export function syncAiWallpaperState() {
  return null
}
