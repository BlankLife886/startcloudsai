import { getRuntimeImageModelPricing } from '@/config/aiModels'
import { AI_WALLPAPER_USAGE_LEDGER_KEY, syncAiWallpaperState } from '@/services/aiWallpaperState'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'

const LEDGER_KEY = AI_WALLPAPER_USAGE_LEDGER_KEY

export function getAiUsageLedger() {
  try {
    const raw = getScopedLocalItem(LEDGER_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') {
      return {
        byDate: parsed.byDate || {},
        byMonth: parsed.byMonth || {},
        byModel: parsed.byModel || {},
        byFeature: parsed.byFeature || {},
      }
    }
  } catch {
    // ignore corrupt local stats
  }
  return { byDate: {}, byMonth: {}, byModel: {}, byFeature: {} }
}

export function saveAiUsageLedger(ledger) {
  try {
    setScopedLocalItem(LEDGER_KEY, JSON.stringify(ledger))
    void syncAiWallpaperState()
  } catch {
    // ignore storage quota errors
  }
}

export function clearAiUsageLedger() {
  saveAiUsageLedger({ byDate: {}, byMonth: {}, byModel: {}, byFeature: {} })
}

function readUsageBucket(ledger, featureKey, billingMode, dayKey, monthKey) {
  const featureBucket = featureKey ? ledger.byFeature?.[featureKey] : null
  const dateBucket = featureKey ? featureBucket?.byDate?.[dayKey] : ledger.byDate?.[dayKey]
  const monthBucket = featureKey ? featureBucket?.byMonth?.[monthKey] : ledger.byMonth?.[monthKey]
  const costField = billingMode === 'credits' ? 'creditCost' : 'cost'
  return {
    dayCost: Number(dateBucket?.[costField] ?? dateBucket?.cost ?? 0),
    monthCost: Number(monthBucket?.[costField] ?? monthBucket?.cost ?? 0),
  }
}

export function getAiUsageCostWindow(featureKey = '', billingMode = 'usd') {
  const ledger = getAiUsageLedger()
  const dayKey = new Date().toISOString().slice(0, 10)
  const monthKey = dayKey.slice(0, 7)
  return readUsageBucket(ledger, featureKey, billingMode, dayKey, monthKey)
}

function ensureUsageBucket(bucket) {
  if (!bucket.success && !bucket.failed) {
    bucket.success = 0
    bucket.failed = 0
    bucket.cost = 0
    bucket.creditCost = 0
  }
  if (bucket.cost === undefined) bucket.cost = 0
  if (bucket.creditCost === undefined) bucket.creditCost = 0
  return bucket
}

export function recordAiUsage({
  settingsStore,
  featureKey = 'preview',
  provider = 'gptsapi',
  model,
  status = 'success',
  runtimeModelCatalog = null,
  unitCost = null,
  billingMode = 'usd',
}) {
  const id = String(model || '').trim()
  if (!id) return

  const pricing = getRuntimeImageModelPricing(id, provider, runtimeModelCatalog)
  const resolvedUnitCost =
    unitCost === null || unitCost === undefined
      ? Number(pricing.usd || 0)
      : Number(unitCost || 0)
  const resolvedBillingMode = billingMode === 'credits' ? 'credits' : 'usd'
  const now = new Date()
  const dayKey = now.toISOString().slice(0, 10)
  const monthKey = dayKey.slice(0, 7)
  const ledger = getAiUsageLedger()

  if (!ledger.byDate[dayKey]) ledger.byDate[dayKey] = { success: 0, failed: 0, cost: 0, creditCost: 0 }
  if (!ledger.byMonth[monthKey]) ledger.byMonth[monthKey] = { success: 0, failed: 0, cost: 0, creditCost: 0 }
  if (!ledger.byModel[id]) ledger.byModel[id] = { success: 0, failed: 0, cost: 0, creditCost: 0 }
  if (!ledger.byFeature[featureKey]) {
    ledger.byFeature[featureKey] = { byDate: {}, byMonth: {}, byModel: {} }
  }
  const feature = ledger.byFeature[featureKey]
  if (!feature.byDate[dayKey]) feature.byDate[dayKey] = { success: 0, failed: 0, cost: 0, creditCost: 0 }
  if (!feature.byMonth[monthKey]) feature.byMonth[monthKey] = { success: 0, failed: 0, cost: 0, creditCost: 0 }
  if (!feature.byModel[id]) feature.byModel[id] = { success: 0, failed: 0, cost: 0, creditCost: 0 }

  const buckets = [
    ledger.byDate[dayKey],
    ledger.byMonth[monthKey],
    ledger.byModel[id],
    feature.byDate[dayKey],
    feature.byMonth[monthKey],
    feature.byModel[id],
  ].map(ensureUsageBucket)

  const costField = resolvedBillingMode === 'credits' ? 'creditCost' : 'cost'
  const isSuccess = status === 'success'
  buckets.forEach((bucket) => {
    if (isSuccess) {
      bucket.success += 1
      bucket[costField] = Number((bucket[costField] + resolvedUnitCost).toFixed(6))
    } else {
      bucket.failed += 1
    }
  })

  if (isSuccess && settingsStore && resolvedBillingMode === 'usd') {
    const currentRequests = Number(settingsStore.getSetting('ai_usage_total_requests', 0)) || 0
    const currentCost = Number(settingsStore.getSetting('ai_usage_estimated_cost_usd', 0)) || 0
    settingsStore.setSetting('ai_usage_total_requests', currentRequests + 1)
    settingsStore.setSetting(
      'ai_usage_estimated_cost_usd',
      Number((currentCost + resolvedUnitCost).toFixed(6)),
    )
  }

  saveAiUsageLedger(ledger)
}
