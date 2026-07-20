import { isApiGatewayUsageLog } from '@/features/ai-shared/studioUsage'
import {
  addUsd,
  clampUsd,
  formatUsageCostUsd,
  getUsageLogEstimatedCostUsd,
  isBillableUsageLog,
} from './pricingMoney.js'

export { formatUsageCostUsd } from './pricingMoney.js'

export function formatUsageDateTime(value = '') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const m = date.getMonth() + 1
  const d = date.getDate()
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${m}/${d} ${h}:${min}:${s}`
}

export function formatUsageDuration(ms = 0) {
  const value = Number(ms || 0)
  if (!value || value <= 0) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${Math.round(value)} ms`
}

export function formatUsagePhaseTooltip(row = {}) {
  const summary = String(row.phaseSummary || '').trim()
  if (summary) return summary
  const phases = row.phaseMs && typeof row.phaseMs === 'object' ? row.phaseMs : {}
  const rows = [
    ['鉴权', Number(phases.auth || 0)],
    ['模型/套餐', Number(phases.modelPlan || 0)],
    ['路由解析', Number(phases.routeResolve || 0)],
    ['协议匹配', Number(phases.routeDispatch || 0)],
    ['计费预占', Number(phases.billing || 0)],
    ['上游连接', Number(phases.upstreamConnect || 0)],
    ['首字到达', Number(phases.streamTtft || 0)],
  ].filter(([, value]) => value > 0)
  if (!rows.length) return ''
  const gatewayTotal = Number(phases.gatewayTotal || 0)
  const lines = rows.map(([label, value]) => `${label} ${formatUsageDuration(value)}`)
  if (gatewayTotal > 0) {
    lines.unshift(`网关开销 ${formatUsageDuration(gatewayTotal)}`)
  }
  return lines.join(' · ')
}

export function formatUsageTps(value = 0) {
  const tps = Number(value || 0)
  if (!tps || tps <= 0) return '—'
  return tps.toFixed(1)
}

export function formatTokenCountShort(value = 0) {
  const num = Math.max(0, Number(value || 0))
  if (!num) return '0'
  if (num >= 1000) {
    const k = num / 1000
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`
  }
  return String(num)
}

export function formatUsageTokenLine(row = {}) {
  const input = formatTokenCountShort(row.inputTokens || 0)
  const cache = formatTokenCountShort(row.cacheTokens || 0)
  const output = formatTokenCountShort(row.outputTokens || 0)
  return `${input} / ${cache} / ${output}`
}

export function filterUsageLogsLast24h(logs = []) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  return filterBillableUsageLogs(logs).filter((row) => {
    const time = new Date(row.createdAt || 0).getTime()
    return Number.isFinite(time) && time >= cutoff
  })
}

export function buildUsageTokenTotals24h(logs = []) {
  const scoped = filterUsageLogsLast24h(logs)
  let inputTokens = 0
  let cacheTokens = 0
  let outputTokens = 0
  scoped.forEach((row) => {
    inputTokens += Number(row.inputTokens || 0)
    cacheTokens += Number(row.cacheTokens || 0)
    outputTokens += Number(row.outputTokens || 0)
  })
  return {
    callCount: scoped.length,
    inputTokens,
    cacheTokens,
    outputTokens,
    totalTokens: inputTokens + cacheTokens + outputTokens,
  }
}

export function formatUsageTokenTotalsSummary(totals = {}) {
  const input = formatTokenCountShort(totals.inputTokens)
  const cache = formatTokenCountShort(totals.cacheTokens)
  const output = formatTokenCountShort(totals.outputTokens)
  return `${input} / ${cache} / ${output}`
}

export function httpStatusTone(status = 0) {
  const code = Number(status || 0)
  if (code >= 200 && code < 300) return 'ok'
  if (code === 404) return 'not-found'
  if (code === 503 || code === 502 || code === 504) return 'unavailable'
  if (code >= 400) return 'error'
  return 'muted'
}

export function ttftTone(ms = 0) {
  const value = Number(ms || 0)
  if (!value || value <= 0) return 'muted'
  if (value >= 10000) return 'slow'
  if (value >= 5000) return 'warn'
  return 'fast'
}

function guessHttpStatus(status = '') {
  const value = String(status || '').toLowerCase()
  if (value === 'success' || value === 'completed') return 200
  if (value === 'failed' || value === 'error') return 500
  if (value === 'charged_failed') return 502
  if (value === 'reserved') return 102
  return 0
}

function guessEndpoint(resourceType = '') {
  const type = String(resourceType || '').toLowerCase()
  if (type.includes('images') && type.includes('edit')) return '/v1/images/edits'
  if (type.includes('images')) return '/v1/images/generations'
  if (type.includes('embeddings')) return '/v1/embeddings'
  if (type.includes('audio')) return '/v1/audio/speech'
  if (type.includes('responses')) return '/v1/responses'
  return '/v1/chat/completions'
}

export function enrichUsageLog(row = {}) {
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  const relay = meta.relay && typeof meta.relay === 'object' ? meta.relay : {}
  const billing = meta.billing && typeof meta.billing === 'object' ? meta.billing : {}
  const breakdown =
    billing.usageBreakdown && typeof billing.usageBreakdown === 'object'
      ? billing.usageBreakdown
      : {}
  const attempts = Array.isArray(meta.attempts) ? meta.attempts : []
  const attempt = attempts.length ? attempts[attempts.length - 1] : {}
  const outputTokens = Number(row.outputTokens ?? breakdown.outputTokens ?? 0)
  const imageUnits = Number(row.imageUnits ?? breakdown.imageUnits ?? breakdown.imageTokens ?? 0)
  const totalMs = Number(
    row.totalMs || relay.totalMs || attempt.latencyMs || meta.latencyMs || 0,
  )
  const ttftMs = Number(row.ttftMs || relay.ttftMs || meta.ttftMs || 0)
  const phaseMs = relay.phaseMs && typeof relay.phaseMs === 'object' ? relay.phaseMs : {}
  const phaseSummary = String(relay.phaseSummary || '')
  const computedTps =
    Number(relay.tps || meta.tps || 0)
    || (totalMs > 0 && outputTokens > 0 ? outputTokens / (totalMs / 1000) : 0)
    || (totalMs > 0 && imageUnits > 0 ? imageUnits / (totalMs / 1000) : 0)

  return {
    ...row,
    keyKind: resolveUsageLogKeyKind(row, row.keyKindLookup || {}),
    httpStatus:
      Number(row.httpStatus || meta.upstreamStatus || attempt.status || 0)
      || guessHttpStatus(row.status),
    inputTokens: Number(row.inputTokens ?? breakdown.inputTokens ?? 0),
    cacheTokens: Number(
      row.cacheTokens
        ?? breakdown.cachedInputTokens
        ?? breakdown.cacheCreationInputTokens
        ?? 0,
    ),
    outputTokens,
    imageUnits,
    totalMs,
    ttftMs,
    phaseMs,
    phaseSummary,
    tps: computedTps,
    sourceIp: String(row.sourceIp || relay.clientIp || meta.clientIp || meta.sourceIp || ''),
    endpoint: String(
      row.endpoint || relay.endpoint || relay.clientEndpoint || guessEndpoint(row.resourceType),
    ),
    stream: row.stream === true || relay.stream === true,
  }
}

export function truncateRequestId(value = '', head = 28) {
  const text = String(value || '').trim()
  if (!text) return '—'
  if (text.length <= head) return text
  return `${text.slice(0, head)}…`
}

export const USAGE_KEY_KIND_LABELS = {
  subscription: '订阅密钥',
  wallet: '充值密钥',
}

export function buildKeyKindLookup(apiKeys = []) {
  const byClientId = new Map()
  const byKeyId = new Map()
  apiKeys.forEach((key) => {
    const id = String(key?.id || '').trim()
    if (!id) return
    const kind = String(key?.keyKind || 'wallet') === 'subscription' ? 'subscription' : 'wallet'
    byKeyId.set(id, kind)
    byClientId.set(`api-key:${id}`, kind)
  })
  return { byClientId, byKeyId }
}

export function resolveUsageLogKeyKind(row = {}, lookup = {}) {
  const billing =
    row.metadata?.billing && typeof row.metadata.billing === 'object' ? row.metadata.billing : {}
  const fromMeta = String(billing.keyKind || '').trim()
  if (fromMeta === 'subscription' || fromMeta === 'wallet') return fromMeta
  const clientId = String(row.clientId || '')
  if (lookup.byClientId?.has(clientId)) return lookup.byClientId.get(clientId)
  if (clientId.startsWith('api-key:')) {
    const keyId = clientId.slice('api-key:'.length)
    if (lookup.byKeyId?.has(keyId)) return lookup.byKeyId.get(keyId)
  }
  return 'wallet'
}

function startOfDay(date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function logsInRange(logs = [], rangeId = 'month') {
  const start = startOfDay(new Date())
  if (rangeId === 'today') {
    // same day only
  } else if (rangeId === '7d') {
    start.setDate(start.getDate() - 6)
  } else if (rangeId === 'year') {
    start.setMonth(0, 1)
  } else if (rangeId === '30d') {
    start.setDate(start.getDate() - 29)
  } else {
    start.setDate(1)
  }
  return logs.filter((row) => {
    const time = new Date(row.createdAt || 0)
    return !Number.isNaN(time.getTime()) && time >= start
  })
}

export function filterBillableUsageLogs(logs = []) {
  return (Array.isArray(logs) ? logs : []).filter(
    (row) => isBillableUsageLog(row) && isApiGatewayUsageLog(row),
  )
}

export function filterBillableUsageLogsInRange(logs = [], rangeId = 'month') {
  return filterBillableUsageLogs(logsInRange(logs, rangeId))
}

function buildKeyKindBreakdownFromLogs(scopedLogs = [], lookup = {}, period = 'month') {
  const breakdown = {
    period,
    subscription: { count: 0, cost: 0 },
    wallet: { count: 0, cost: 0 },
    hasData: false,
  }
  scopedLogs.forEach((row) => {
    const kind = resolveUsageLogKeyKind(row, lookup)
    breakdown[kind].count += 1
    breakdown[kind].cost = addUsd(breakdown[kind].cost, getUsageLogEstimatedCostUsd(row))
  })
  breakdown.hasData = breakdown.subscription.count + breakdown.wallet.count > 0
  return breakdown
}

function normalizeKeyKindBreakdown(fromSummary = {}, period = 'month') {
  const subscription = fromSummary.subscription || {}
  const wallet = fromSummary.wallet || {}
  const subCount = Number(subscription.count || 0)
  const walletCount = Number(wallet.count || 0)
  return {
    period,
    subscription: {
      count: subCount,
      cost: clampUsd(subscription.estimatedCostUsd || 0),
    },
    wallet: {
      count: walletCount,
      cost: clampUsd(wallet.estimatedCostUsd || 0),
    },
    hasData: subCount + walletCount > 0,
  }
}

function hasKeyKindSummaryData(fromSummary = {}) {
  const subscription = fromSummary.subscription || {}
  const wallet = fromSummary.wallet || {}
  return (
    Number(subscription.count || 0) + Number(wallet.count || 0) > 0
    || clampUsd(subscription.estimatedCostUsd || 0) + clampUsd(wallet.estimatedCostUsd || 0) > 0
  )
}

export function buildKeyKindBreakdown(input = {}) {
  const period = String(input.period || 'month')
  const lookup = input.lookup || buildKeyKindLookup(input.apiKeys || [])
  const logs = Array.isArray(input.logs) ? input.logs : []
  const billableScoped = filterBillableUsageLogsInRange(logs, period)

  if (billableScoped.length > 0) {
    return buildKeyKindBreakdownFromLogs(billableScoped, lookup, period)
  }

  const fromSummary = input.usageSummary?.byKeyKind?.[period]
  if (fromSummary && hasKeyKindSummaryData(fromSummary)) {
    return normalizeKeyKindBreakdown(fromSummary, period)
  }

  return {
    period,
    subscription: { count: 0, cost: 0 },
    wallet: { count: 0, cost: 0 },
    hasData: false,
  }
}

export function buildKeyKindUsageCards(breakdown = {}) {
  const items = [
    {
      id: 'subscription',
      label: USAGE_KEY_KIND_LABELS.subscription,
      tone: 'violet',
      icon: 'bi-box-seam',
    },
    {
      id: 'wallet',
      label: USAGE_KEY_KIND_LABELS.wallet,
      tone: 'cyan',
      icon: 'bi-wallet2',
    },
  ]
  return items.map((item) => {
    const stats = breakdown[item.id] || {}
    const count = Number(stats.count || 0)
    const cost = Number(stats.cost || 0)
    return {
      ...item,
      value: String(count),
      hint: count > 0 ? formatUsageCostUsd(cost) : '暂无调用',
      animateValue: count,
      animateFormat: 'integer',
      animateDelay: item.id === 'subscription' ? 280 : 350,
      animateCost: cost,
    }
  })
}

export function buildUsageStatsCards(usageSummary = {}, logs = [], options = {}) {
  const today = usageSummary?.today || {}
  const month = usageSummary?.month || {}

  const hasSummary =
    Number(today.count || 0) > 0 ||
    Number(month.count || 0) > 0 ||
    Number(usageSummary?.total?.count || 0) > 0

  let monthCount = Number(month.count || 0)
  let monthCost = Number(month.estimatedCostUsd || 0)
  let todayCount = Number(today.count || 0)
  let todayCost = Number(today.estimatedCostUsd || 0)

  if (!hasSummary && logs.length) {
    const billableLogs = filterBillableUsageLogs(logs)
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1)

    billableLogs.forEach((row) => {
      const time = new Date(row.createdAt || 0).getTime()
      if (Number.isNaN(time)) return
      if (time >= startOfDay.getTime()) {
        todayCount += 1
        todayCost = addUsd(todayCost, getUsageLogEstimatedCostUsd(row))
      }
      if (time >= startOfMonth.getTime()) {
        monthCount += 1
        monthCost = addUsd(monthCost, getUsageLogEstimatedCostUsd(row))
      }
    })
  }

  const monthBillableLogs = filterBillableUsageLogsInRange(logs, 'month')
  const listed = monthCount || monthBillableLogs.length
  const successes = monthBillableLogs.filter(
    (row) => String(row.status || '').toLowerCase() === 'success',
  ).length
  const successRate = listed > 0 ? Math.round((successes / listed) * 100) : 0

  return [
    {
      id: 'today-calls',
      label: '今日调用',
      value: String(todayCount || 0),
      hint: todayCost > 0 ? formatUsageCostUsd(todayCost) : '暂无预估费用',
      tone: 'blue',
      icon: 'bi-lightning-charge',
      animateValue: todayCount || 0,
      animateFormat: 'integer',
      animateDelay: 0,
    },
    {
      id: 'month-calls',
      label: '本月调用',
      value: String(monthCount || monthBillableLogs.length || 0),
      hint: '仅计成功/已扣费',
      tone: 'green',
      icon: 'bi-bar-chart-line',
      animateValue: monthCount || monthBillableLogs.length || 0,
      animateFormat: 'integer',
      animateDelay: 70,
    },
    {
      id: 'month-cost',
      label: '本月预估费用',
      value: monthCost > 0 ? formatUsageCostUsd(monthCost) : '$0.0000',
      hint: '与 API 汇总口径一致',
      tone: 'amber',
      icon: 'bi-currency-dollar',
      animateValue: monthCost,
      animateFormat: 'usd',
      animateDelay: 140,
    },
    {
      id: 'success-rate',
      label: '成功率',
      value: `${successRate}%`,
      hint: listed ? '成功调用 / 本月可计费' : '暂无样本',
      tone: 'cyan',
      icon: 'bi-check2-circle',
      animateValue: successRate,
      animateFormat: 'percent',
      animateDelay: 210,
    },
  ]
}
