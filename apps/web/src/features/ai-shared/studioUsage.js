/** 站内 AI 工坊功能（非 OpenAI 兼容 API 调用）的公开模型标识 */
export const STUDIO_PUBLIC_MODEL_KEYS = new Set([
  'walleven-image-edit',
  'walleven-illustration-coloring',
  'walleven-image-to-3d',
])

export const STUDIO_FEATURE_META = {
  'ai.optimize': { label: 'AI 优化', shortLabel: 'AI 优化' },
  'ai.wallpaperGeneration': { label: '文生图', shortLabel: '文生图' },
  wallpaper: { label: '文生图', shortLabel: '文生图' },
  preview: { label: 'AI 优化', shortLabel: 'AI 优化' },
  'ai.illustrationColoring': { label: '插画染色', shortLabel: '插画染色' },
  'ai.imageToModel': { label: '图转 3D', shortLabel: '图转 3D' },
  'ai.uiDesign': { label: 'UI 设计稿', shortLabel: 'UI 设计' },
  'ai.ultraModelSheet': { label: '超高清模型图', shortLabel: '模型图' },
  'ai.gameDesign': { label: '游戏设计', shortLabel: '游戏设计' },
  'ai.puzzle': { label: 'AI 拼图', shortLabel: 'AI 拼图' },
}

export function isStudioPublicModelKey(value = '') {
  const key = String(value || '').trim()
  if (!key) return false
  return STUDIO_PUBLIC_MODEL_KEYS.has(key)
}

export function isApiGatewayUsageLog(row = {}) {
  const providerKey = String(row.providerKey || row.provider_key || '').trim()
  const clientId = String(row.clientId || row.client_id || '').trim()
  if (providerKey === 'walleven-gateway') return true
  return clientId.startsWith('api-key:')
}

export function isStudioResourceUsageLog(row = {}) {
  if (isApiGatewayUsageLog(row)) return false
  const jobId = String(row.jobId || row.job_id || '').trim()
  if (jobId) return true
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  const source = String(meta.source || meta.reservation?.source || '').trim()
  return source === 'ai_job'
}

export function filterApiGatewayUsageLogs(logs = []) {
  return (Array.isArray(logs) ? logs : []).filter(isApiGatewayUsageLog)
}

export function filterStudioResourceUsageLogs(logs = []) {
  return (Array.isArray(logs) ? logs : []).filter(isStudioResourceUsageLog)
}

export function studioFeatureLabel(featureKey = '') {
  const key = String(featureKey || '').trim()
  return STUDIO_FEATURE_META[key]?.label || key || 'AI 功能'
}

export function inferStudioFeatureFromUsageRow(row = {}) {
  const resourceType = String(row.resourceType || row.resource_type || '').trim().toLowerCase()
  if (resourceType.includes('wallpaper')) return 'ai.wallpaperGeneration'
  if (resourceType.includes('ui-design')) return 'ai.uiDesign'
  if (resourceType.includes('ultra-reference')) return 'ai.ultraModelSheet'
  if (resourceType.includes('game-art')) return 'ai.gameDesign'
  if (resourceType.includes('puzzle') || resourceType.includes('collage')) return 'ai.puzzle'
  if (resourceType.includes('illustration') || resourceType.includes('color')) {
    return 'ai.illustrationColoring'
  }
  if (resourceType.includes('3d') || resourceType.includes('model')) {
    return 'ai.imageToModel'
  }
  if (resourceType.includes('image') || resourceType.includes('edit')) {
    return 'ai.optimize'
  }
  return 'ai.optimize'
}

export function buildLocalStudioUsageRows(ledger = {}) {
  const byFeature = ledger?.byFeature && typeof ledger.byFeature === 'object' ? ledger.byFeature : {}
  return Object.entries(byFeature)
    .map(([featureKey, bucket]) => {
      const month = bucket?.byMonth || {}
      const monthKey = new Date().toISOString().slice(0, 7)
      const monthBucket = month[monthKey] || {}
      const success = Number(monthBucket.success || 0)
      const creditCost = Number(monthBucket.creditCost || 0)
      if (success <= 0 && creditCost <= 0) return null
      return {
        id: `local:${featureKey}`,
        featureKey,
        label: studioFeatureLabel(featureKey),
        success,
        creditCost,
        source: 'local',
      }
    })
    .filter(Boolean)
}

export function summarizeStudioCreditSpendFromLedger(ledgerRows = [], referenceDate = new Date()) {
  const dayKey = referenceDate.toISOString().slice(0, 10)
  const monthKey = dayKey.slice(0, 7)
  let dayCost = 0
  let monthCost = 0
  ;(Array.isArray(ledgerRows) ? ledgerRows : []).forEach((row) => {
    if (String(row.direction || '') !== 'spend') return
    const createdAt = String(row.createdAt || row.created_at || '')
    const dateKey = createdAt.slice(0, 10)
    const amount = Math.abs(Number(row.amount || 0))
    if (!amount || !dateKey) return
    if (dateKey === dayKey) dayCost += amount
    if (dateKey.startsWith(monthKey)) monthCost += amount
  })
  return { dayCost, monthCost }
}

export async function fetchStudioCreditAccountSnapshot() {
  const { getClientResourceSummary } = await import('@/services/aiWallpaper')
  const data = await getClientResourceSummary({ scope: 'studio' })
  const summary = data?.summary || {}
  const account = summary.credits?.account || {}
  const creditAvailable = Number(
    account.availableBalance ??
      Math.max(0, Number(account.balance || 0) - Number(account.frozenBalance || 0)),
  )
  const ledger = Array.isArray(summary.credits?.ledger) ? summary.credits.ledger : []
  const spend = summarizeStudioCreditSpendFromLedger(ledger)
  return {
    creditAvailable,
    dayCost: spend.dayCost,
    monthCost: spend.monthCost,
    usageSource: 'server',
  }
}

/** 打开积分确认弹窗前补齐账户余额与今日/本月消耗（刷新后仍准确） */
export async function enrichStudioCreditCostSnapshot(snapshot = {}) {
  if (snapshot?.billingMode !== 'credits') return snapshot
  try {
    const server = await fetchStudioCreditAccountSnapshot()
    return {
      ...snapshot,
      creditAvailable: server.creditAvailable,
      dayCost: server.dayCost,
      monthCost: server.monthCost,
      usageSource: server.usageSource,
    }
  } catch {
    return snapshot
  }
}
