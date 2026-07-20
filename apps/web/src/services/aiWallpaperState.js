import {
  fetchClientStateQuietly,
  getCloudSyncConflictStrategy,
  scheduleClientStatePushQuietly,
  shouldApplyRemoteClientState,
} from '@/services/clientState'
import { looksLikeIllustrationColoringTask } from '@/features/ai-shared/aiJobKinds'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'

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

function writeJson(key, value) {
  try {
    setScopedLocalItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function readArray(value) {
  return Array.isArray(value) ? value : []
}

function readTime(value) {
  if (!value) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const time = Date.parse(String(value))
  return Number.isFinite(time) ? time : 0
}

function taskSortTime(task = {}) {
  return Math.max(
    readTime(task.updatedAt || task.updated_at),
    readTime(task.finishedAt || task.finished_at),
    readTime(task.startedAt || task.started_at),
    readTime(task.createdAt || task.created_at),
  )
}

function arrayItemSortTime(item = {}) {
  return Math.max(
    readTime(item.updatedAt || item.updated_at),
    readTime(item.createdAt || item.created_at),
    readTime(item.createdAtText || item.createdAtLabel),
    readTime(item.created_at),
    readTime(item.followed_at),
  )
}

function compactTask(task = {}) {
  const { sourceFile, styleReferenceFiles, ...rest } = plainObject(task)
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

function normalizeAiWallpaperPayload(payload = {}) {
  const source = plainObject(payload)
  return {
    version: Number(source.version || AI_WALLPAPER_STATE_VERSION),
    tasks: normalizeTasks(source.tasks),
    capabilityKit: plainObject(source.capabilityKit),
    previewHistory: readArray(source.previewHistory).slice(0, MAX_PREVIEW_HISTORY),
    previewRecipes: readArray(source.previewRecipes).slice(0, MAX_PREVIEW_RECIPES),
    usageLedger: normalizeUsageLedger(source.usageLedger),
    updatedAt: String(source.updatedAt || source.updated_at || ''),
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

function writeLocalAiWallpaperState(payload = {}) {
  const normalized = normalizeAiWallpaperPayload(payload)
  writeJson(AI_WALLPAPER_TASKS_KEY, normalized.tasks)
  writeJson(AI_WALLPAPER_CAPABILITY_KIT_KEY, normalized.capabilityKit)
  writeJson(AI_WALLPAPER_PREVIEW_HISTORY_KEY, normalized.previewHistory)
  writeJson(AI_WALLPAPER_PREVIEW_RECIPES_KEY, normalized.previewRecipes)
  writeJson(AI_WALLPAPER_USAGE_LEDGER_KEY, normalized.usageLedger)
  return normalized
}

function mergeTasks(remoteTasks = [], localTasks = []) {
  const map = new Map()
  ;[...remoteTasks, ...localTasks].forEach((task) => {
    const key = String(task.serverJobId || task.id || '').trim()
    if (!key) return
    const existing = map.get(key)
    if (!existing) {
      map.set(key, task)
      return
    }
    map.set(
      key,
      taskSortTime(task) >= taskSortTime(existing)
        ? { ...existing, ...task }
        : { ...task, ...existing },
    )
  })
  return Array.from(map.values()).sort((left, right) => taskSortTime(right) - taskSortTime(left)).slice(0, MAX_TASKS)
}

function mergeRecordArrays(remoteItems = [], localItems = [], keyResolver, limit) {
  const map = new Map()
  ;[...remoteItems, ...localItems].forEach((item) => {
    const key = String(keyResolver(item) || '').trim()
    if (!key) return
    const existing = map.get(key)
    if (!existing) {
      map.set(key, item)
      return
    }
    map.set(
      key,
      arrayItemSortTime(item) >= arrayItemSortTime(existing)
        ? { ...existing, ...item }
        : { ...item, ...existing },
    )
  })
  return Array.from(map.values()).sort((left, right) => arrayItemSortTime(right) - arrayItemSortTime(left)).slice(0, limit)
}

function mergeStringList(left = [], right = []) {
  return Array.from(new Set([...readArray(left), ...readArray(right)].map((item) => String(item || '').trim()).filter(Boolean)))
}

function mergeCapabilityKit(remoteKit = {}, localKit = {}) {
  const remote = plainObject(remoteKit)
  const local = plainObject(localKit)
  return {
    ...remote,
    ...local,
    selectedSkillIds: mergeStringList(remote.selectedSkillIds, local.selectedSkillIds),
    selectedMcpIds: mergeStringList(remote.selectedMcpIds, local.selectedMcpIds),
    customSkills: mergeRecordArrays(
      readArray(remote.customSkills),
      readArray(local.customSkills),
      (item) => item.id || item.name,
      20,
    ),
    customMcpOptions: mergeRecordArrays(
      readArray(remote.customMcpOptions),
      readArray(local.customMcpOptions),
      (item) => item.id || item.endpoint || item.name,
      20,
    ),
  }
}

function mergeBucket(remoteBucket = {}, localBucket = {}) {
  const remote = plainObject(remoteBucket)
  const local = plainObject(localBucket)
  return {
    ...remote,
    ...local,
    success: Math.max(Number(remote.success || 0), Number(local.success || 0)),
    failed: Math.max(Number(remote.failed || 0), Number(local.failed || 0)),
    cost: Math.max(Number(remote.cost || 0), Number(local.cost || 0)),
  }
}

function mergeBucketMap(remoteMap = {}, localMap = {}) {
  const result = {}
  const keys = new Set([...Object.keys(plainObject(remoteMap)), ...Object.keys(plainObject(localMap))])
  keys.forEach((key) => {
    result[key] = mergeBucket(plainObject(remoteMap)[key], plainObject(localMap)[key])
  })
  return result
}

function mergeFeatureUsage(remoteFeature = {}, localFeature = {}) {
  const remote = plainObject(remoteFeature)
  const local = plainObject(localFeature)
  return {
    byDate: mergeBucketMap(remote.byDate, local.byDate),
    byMonth: mergeBucketMap(remote.byMonth, local.byMonth),
    byModel: mergeBucketMap(remote.byModel, local.byModel),
  }
}

function mergeUsageLedger(remoteLedger = {}, localLedger = {}) {
  const remote = normalizeUsageLedger(remoteLedger)
  const local = normalizeUsageLedger(localLedger)
  const featureKeys = new Set([...Object.keys(remote.byFeature), ...Object.keys(local.byFeature)])
  const byFeature = {}
  featureKeys.forEach((key) => {
    byFeature[key] = mergeFeatureUsage(remote.byFeature[key], local.byFeature[key])
  })
  return {
    byDate: mergeBucketMap(remote.byDate, local.byDate),
    byMonth: mergeBucketMap(remote.byMonth, local.byMonth),
    byModel: mergeBucketMap(remote.byModel, local.byModel),
    byFeature,
  }
}

function mergeAiWallpaperPayload(remotePayload = {}, localPayload = {}) {
  const remote = normalizeAiWallpaperPayload(remotePayload)
  const local = normalizeAiWallpaperPayload(localPayload)
  return {
    version: AI_WALLPAPER_STATE_VERSION,
    tasks: mergeTasks(remote.tasks, local.tasks),
    capabilityKit: mergeCapabilityKit(remote.capabilityKit, local.capabilityKit),
    previewHistory: mergeRecordArrays(
      remote.previewHistory,
      local.previewHistory,
      (item) => item.id || item.url,
      MAX_PREVIEW_HISTORY,
    ),
    previewRecipes: mergeRecordArrays(
      remote.previewRecipes,
      local.previewRecipes,
      (item) => item.id || item.name,
      MAX_PREVIEW_RECIPES,
    ),
    usageLedger: mergeUsageLedger(remote.usageLedger, local.usageLedger),
    updatedAt: new Date().toISOString(),
  }
}

export function syncAiWallpaperState() {
  return scheduleClientStatePushQuietly('aiWallpaper', () => readLocalAiWallpaperState())
}

export async function mergeCloudAiWallpaperState(options = {}) {
  const remoteState = await fetchClientStateQuietly('aiWallpaper')
  const strategy = options.conflictStrategy || getCloudSyncConflictStrategy()
  const localPayload = readLocalAiWallpaperState()

  if (remoteState?.payload) {
    const shouldApplyRemote =
      strategy === 'merge' ||
      (strategy !== 'local' &&
        (options.forceRemote || shouldApplyRemoteClientState('aiWallpaper', remoteState.updatedAt)))

    if (shouldApplyRemote) {
      const remoteNormalized = normalizeAiWallpaperPayload(remoteState.payload)
      const nextPayload =
        strategy === 'merge'
          ? mergeAiWallpaperPayload(remoteState.payload, localPayload)
          : {
              ...remoteNormalized,
              tasks: mergeTasks(remoteNormalized.tasks, localPayload.tasks),
              usageLedger: mergeUsageLedger(remoteNormalized.usageLedger, localPayload.usageLedger),
              capabilityKit: mergeCapabilityKit(remoteNormalized.capabilityKit, localPayload.capabilityKit),
              previewHistory: mergeRecordArrays(
                remoteNormalized.previewHistory,
                localPayload.previewHistory,
                (item) => item.id || item.url,
                MAX_PREVIEW_HISTORY,
              ),
              previewRecipes: mergeRecordArrays(
                remoteNormalized.previewRecipes,
                localPayload.previewRecipes,
                (item) => item.id || item.name,
                MAX_PREVIEW_RECIPES,
              ),
            }
      writeLocalAiWallpaperState(nextPayload)
      if (strategy === 'merge' || options.pushAfterMerge !== false) {
        return syncAiWallpaperState()
      }
      return nextPayload
    }
  }

  if (strategy === 'local' || options.pushWhenEmpty === true || options.forcePush === true || !remoteState?.payload) {
    return syncAiWallpaperState()
  }

  return null
}
