import { buildKeyKindBreakdown, filterBillableUsageLogs } from './pricingUsage.js'
import {
  addUsd,
  clampUsd,
  formatUsd,
  getUsageLogEstimatedCostUsd,
} from './pricingMoney.js'
import {
  buildPublicModelLabelLookup,
  resolveUsageModelLabel,
} from './pricingModelLabels.js'

export const OVERVIEW_RANGE_OPTIONS = [
  { id: 'today', label: '今天' },
  { id: '7d', label: '7天' },
  { id: '30d', label: '一个月' },
  { id: 'year', label: '今年' },
]

export function overviewRangeSubtitle(rangeId = '7d') {
  if (rangeId === 'today') return '今日 API 调用趋势'
  if (rangeId === '30d') return '近 30 天 API 调用趋势'
  if (rangeId === 'year') return '今年 API 调用趋势'
  return '近 7 天 API 调用趋势'
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10)
}

function startOfDay(date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function daysForRange(rangeId = '7d') {
  if (rangeId === 'today') return 1
  if (rangeId === '30d') return 30
  if (rangeId === 'year') return 365
  return 7
}

function countUsageLogsInDays(logs = [], days = 7) {
  const start = startOfDay(new Date())
  start.setDate(start.getDate() - (days - 1))
  return filterBillableUsageLogs(logs).filter((row) => {
    const time = new Date(row.createdAt || 0)
    return !Number.isNaN(time.getTime()) && time >= start
  }).length
}

function buildDailyCallCounts(logs = []) {
  const byDay = new Map()
  logs.forEach((row) => {
    const key = String(row.createdAt || '').slice(0, 10)
    if (!key) return
    byDay.set(key, (byDay.get(key) || 0) + 1)
  })
  return byDay
}

function filterUsageLogsByRange(logs = [], rangeId = '7d') {
  const days = daysForRange(rangeId)
  const start = startOfDay(new Date())
  start.setDate(start.getDate() - (days - 1))
  return filterBillableUsageLogs(logs).filter((row) => {
    const time = new Date(row.createdAt || 0)
    return !Number.isNaN(time.getTime()) && time >= start
  })
}

function heatmapLevelForCount(count = 0) {
  const value = Number(count || 0)
  if (value <= 0) return 0
  if (value === 1) return 1
  if (value <= 3) return 2
  if (value <= 8) return 3
  return 4
}

export function buildTrendSeries(rangeId = '7d', usageLogs = []) {
  const days = daysForRange(rangeId)
  const today = startOfDay(new Date())
  const scopedLogs = filterUsageLogsByRange(usageLogs, rangeId)
  const byDay = buildDailyCallCounts(scopedLogs)
  const series = []

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(date.getDate() - offset)
    const key = formatIsoDate(date)
    series.push({
      label: key.slice(5),
      date: key,
      value: byDay.get(key) || 0,
    })
  }
  return series
}

function buildSmoothLinePath(points = []) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const controlX = (current.x + next.x) / 2
    path += ` C ${controlX.toFixed(1)} ${current.y.toFixed(1)}, ${controlX.toFixed(1)} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`
  }
  return path
}

function buildSmoothAreaPath(points = [], height = 0, padBottom = 0) {
  if (!points.length) return ''
  const base = height - padBottom
  let path = `M ${points[0].x.toFixed(1)} ${base.toFixed(1)} L ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const controlX = (current.x + next.x) / 2
    path += ` C ${controlX.toFixed(1)} ${current.y.toFixed(1)}, ${controlX.toFixed(1)} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`
  }
  path += ` L ${points[points.length - 1].x.toFixed(1)} ${base.toFixed(1)} Z`
  return path
}

export function formatTrendPointValue(value = 0) {
  const num = Number(value || 0)
  if (num >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (num >= 10) return num.toFixed(1)
  if (num >= 1) return num.toFixed(2)
  return num.toFixed(0)
}

export function formatTrendPointDate(dateKey = '') {
  const text = String(dateKey || '').trim()
  if (!text) return '—'
  const [year, month, day] = text.split('-').map(Number)
  if (!year || !month || !day) return text.slice(5)
  return `${month}月${day}日`
}

export function buildTrendChartGeometry(series, options = {}) {
  const width = Number(options.width || 640)
  const height = Number(options.height || 228)
  const padLeft = 0
  const padRight = 0
  const padTop = 16
  const padBottom = 30
  const values = series.map((item) => Number(item.value || 0))
  const max = Math.max(...values, 1)
  const innerW = width - padLeft - padRight
  const innerH = height - padTop - padBottom
  const points = series.map((item, index) => {
    const x = padLeft + (index / Math.max(series.length - 1, 1)) * innerW
    const y = padTop + (1 - Number(item.value || 0) / max) * innerH
    return { ...item, x, y }
  })
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const area = [
    `${padLeft},${height - padBottom}`,
    ...points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`),
    `${width - padRight},${height - padBottom}`,
  ].join(' ')
  const linePath = buildSmoothLinePath(points)
  const areaPath = buildSmoothAreaPath(points, height, padBottom)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: Math.round(max * ratio * 10) / 10,
    y: padTop + (1 - ratio) * innerH,
  }))
  return {
    width,
    height,
    padLeft,
    padRight,
    padTop,
    padBottom,
    points,
    line,
    area,
    linePath,
    areaPath,
    max,
    yTicks,
  }
}

export function buildModelConsumption(rangeId = '7d', usageLogs = [], options = {}) {
  const scopedLogs = filterUsageLogsByRange(usageLogs, rangeId)
  const lookup =
    options.modelLabelLookup instanceof Map
      ? options.modelLabelLookup
      : buildPublicModelLabelLookup(options.publicModels || [])
  const totals = new Map()
  const labels = new Map()

  scopedLogs.forEach((row) => {
    const key = String(row.resourceKey || row.providerKey || row.resourceType || '').trim()
    if (!key) return
    totals.set(key, addUsd(totals.get(key) || 0, getUsageLogEstimatedCostUsd(row)))
    if (!labels.has(key)) {
      labels.set(key, resolveUsageModelLabel(row, lookup))
    }
  })

  return [...totals.entries()]
    .map(([key, value]) => ({
      key,
      label: labels.get(key) || resolveUsageModelLabel({ resourceKey: key }, lookup),
      value: clampUsd(value),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
}

export function buildCacheRate(rangeId = '7d', usageLogs = []) {
  const scopedLogs = filterUsageLogsByRange(usageLogs, rangeId)
  let input = 0
  let cached = 0
  scopedLogs.forEach((row) => {
    input += Number(row.inputTokens || row.promptTokens || 0)
    cached += Number(row.cachedInputTokens || row.cacheReadTokens || row.cacheTokens || 0)
  })
  if (input <= 0) return 0
  return Math.round((cached / input) * 1000) / 10
}

export function buildUsageHeatmap(days = 371, usageLogs = []) {
  const countsByDay = buildDailyCallCounts(usageLogs)

  const today = startOfDay(new Date())
  const cells = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(date.getDate() - offset)
    const key = formatIsoDate(date)
    cells.push({
      date: key,
      level: heatmapLevelForCount(countsByDay.get(key) || 0),
      count: countsByDay.get(key) || 0,
    })
  }
  return cells
}

export const HEATMAP_WEEKDAY_LABELS = ['', '一', '', '三', '', '五', '']

export function formatHeatmapDate(dateKey = '') {
  const text = String(dateKey || '').trim()
  if (!text) return '—'
  const date = new Date(`${text}T12:00:00`)
  if (Number.isNaN(date.getTime())) return text
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function heatmapActivityLabel(level = 0) {
  const value = Number(level || 0)
  if (value <= 0) return '无调用'
  if (value === 1) return '较低活跃'
  if (value === 2) return '中等活跃'
  if (value === 3) return '较高活跃'
  return '非常活跃'
}

export function buildHeatmapLayout(cells = []) {
  const weeks = []
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7))
  }

  const monthMarkers = []
  let lastMonth = -1
  weeks.forEach((week, weekIndex) => {
    const first = week.find((cell) => cell?.date)
    if (!first?.date) return
    const month = new Date(`${first.date}T12:00:00`).getMonth()
    if (month !== lastMonth) {
      monthMarkers.push({ weekIndex, label: `${month + 1}月` })
      lastMonth = month
    }
  })

  return {
    cells,
    weeks,
    weekCount: weeks.length,
    monthMarkers,
  }
}

export function summarizeUsageStreak(cells = []) {
  let current = 0
  let longest = 0
  let activeDays = 0
  let running = 0

  cells.forEach((cell) => {
    if (cell.level > 0) {
      activeDays += 1
      running += 1
      longest = Math.max(longest, running)
    } else {
      running = 0
    }
  })

  for (let index = cells.length - 1; index >= 0; index -= 1) {
    if (cells[index].level > 0) current += 1
    else break
  }

  return { current, longest, activeDays }
}

function formatUsdAmount(value = 0) {
  return formatUsd(value)
}

export function buildOverviewStats(input = {}) {
  const usage = input.usage || {}
  const usageLogs = Array.isArray(input.usageLogs) ? input.usageLogs : []
  const weekFromSummary = Number(usage.week?.count || 0)
  const weekCallCount =
    weekFromSummary > 0 ? weekFromSummary : countUsageLogsInDays(usageLogs, 7)
  const monthCost = Number(usage.month?.estimatedCostUsd || 0)
  const todayCost = Number(usage.today?.estimatedCostUsd || 0)
  const monthCallCount = Number(usage.month?.count || 0)
  const activeKeys = Number(input.activeApiKeyCount || 0)
  const activeSubscriptionKeys = Number(input.activeSubscriptionKeyCount || 0)
  const activeWalletKeys = Number(input.activeWalletKeyCount || 0)
  const planLabel = String(input.currentPlanLabel || '未订阅')
  const planUnsubscribed = input.planUnsubscribed === true || planLabel === '未订阅'
  const wallpaperCredits = Number(input.wallpaperCredits || 0)
  const showSubscriptionPanel = input.showSubscriptionPanel === true
  const keyKindHasData = input.keyKindHasData === true
  const showSubscriptionCtaPanel = input.showSubscriptionCtaPanel === true

  const keysHint =
    activeKeys > 0
      ? showSubscriptionPanel
        ? activeWalletKeys > 0
          ? `另有充值密钥 ${activeWalletKeys} 个`
          : '订阅密钥已自动创建'
        : `订阅 ${activeSubscriptionKeys} · 充值 ${activeWalletKeys}`
      : planUnsubscribed && showSubscriptionCtaPanel
        ? '充值密钥需手动创建'
        : '订阅自动创建 · 充值手动创建'

  const monthHint = (() => {
    if (keyKindHasData) return ''
    if (showSubscriptionPanel) {
      return monthCallCount > 0
        ? `本月 ${monthCallCount} 次账单调用`
        : '超额部分从钱包余额扣费'
    }
    if (monthCallCount > 0) {
      return (
        input.keyKindMonthHint ||
        `本月 ${monthCallCount} 次 · 今日 ${formatUsdAmount(todayCost)}`
      )
    }
    return `今日: ${formatUsdAmount(todayCost)}`
  })()

  const stats = [
    {
      id: 'calls',
      label: '总调用量（7 天）',
      value: String(weekCallCount),
      hint: weekCallCount > 0 ? 'API Gateway 调用' : '暂无调用',
      hintAccent: false,
      icon: 'bi-activity',
      tone: 'blue',
      animateValue: weekCallCount,
      animateFormat: 'integer',
      animateDelay: 0,
    },
    {
      id: 'credits',
      label: '壁纸积分',
      value: wallpaperCredits > 0 ? String(wallpaperCredits) : '0',
      hint: wallpaperCredits > 0 ? '用于壁纸 AI 功能' : '可在钱包页兑换',
      hintAccent: false,
      icon: 'bi-stars',
      tone: 'violet',
      animateValue: wallpaperCredits,
      animateFormat: 'integer',
      animateDelay: 140,
    },
    {
      id: 'keys',
      label: '活跃 Key',
      value: String(activeKeys),
      hint: keysHint,
      hintAccent: false,
      icon: 'bi-key',
      tone: 'amber',
    },
    {
      id: 'month',
      label: '本月预估消费',
      value: formatUsdAmount(monthCost),
      hint: monthHint,
      hintAccent: !showSubscriptionPanel && todayCost > 0,
      icon: 'bi-credit-card-2-front',
      tone: 'cyan',
      animateValue: monthCost,
      animateFormat: 'usd',
      animateDelay: 210,
    },
  ]

  return stats.filter((item) => !(keyKindHasData && item.id === 'month'))
}

export function buildKeyKindOverviewPanel(input = {}) {
  const breakdown = buildKeyKindBreakdown({
    usageSummary: input.usage || {},
    period: String(input.keyKindPeriod || 'month'),
    logs: input.usageLogs || [],
    apiKeys: input.apiKeys || [],
    lookup: input.keyKindLookup,
  })
  const totalCost = addUsd(breakdown.subscription.cost, breakdown.wallet.cost)
  const items = [
    {
      id: 'subscription',
      label: '订阅密钥',
      count: breakdown.subscription.count,
      cost: breakdown.subscription.cost,
      tone: 'violet',
      icon: 'bi-box-seam',
    },
    {
      id: 'wallet',
      label: '充值密钥',
      count: breakdown.wallet.count,
      cost: breakdown.wallet.cost,
      tone: 'cyan',
      icon: 'bi-wallet2',
    },
  ].map((item) => ({
    ...item,
    costLabel: formatUsdAmount(item.cost),
    share: totalCost > 0 ? Math.round((item.cost / totalCost) * 100) : 0,
  }))
  return {
    breakdown,
    items,
    hasData: breakdown.hasData,
    totalCost,
    totalCostLabel: formatUsdAmount(totalCost),
  }
}

export function buildOverviewDashboard(input = {}) {
  const usageLogs = Array.isArray(input.usageLogs) ? input.usageLogs : []
  const trendRange = String(input.trendRange || '7d')
  const insightsRange = String(input.insightsRange || '7d')
  const trendSeries = buildTrendSeries(trendRange, usageLogs)
  const trendChart = buildTrendChartGeometry(trendSeries)
  const modelConsumption = buildModelConsumption(insightsRange, usageLogs, {
    publicModels: input.publicModels || [],
    modelLabelLookup: input.modelLabelLookup,
  })
  const cacheRate = buildCacheRate(insightsRange, usageLogs)
  const heatmapCells = buildUsageHeatmap(371, usageLogs)
  const heatmapLayout = buildHeatmapLayout(heatmapCells)
  const streak = summarizeUsageStreak(heatmapCells)
  const consumptionMax = Math.max(...modelConsumption.map((item) => item.value), 0.001)
  const consumptionTotal = modelConsumption.reduce(
    (sum, item) => addUsd(sum, item.value),
    0,
  )
  const axisStep = Math.max(1, Math.ceil(trendSeries.length / 7))
  const trendAxisLabels = trendSeries.filter(
    (_, index) => index % axisStep === 0 || index === trendSeries.length - 1,
  )
  const hasTrendData = trendSeries.some((item) => Number(item.value || 0) > 0)
  const keyKindPanel = buildKeyKindOverviewPanel(input)
  const keyKindMonthHint = keyKindPanel.hasData
    ? `订阅 ${keyKindPanel.breakdown.subscription.count} 次 · 充值 ${keyKindPanel.breakdown.wallet.count} 次`
    : ''
  const showSubscriptionPanel = input.showSubscriptionPanel === true

  return {
    stats: buildOverviewStats({
      ...input,
      keyKindMonthHint,
      keyKindHasData: keyKindPanel.hasData,
      showSubscriptionPanel,
      showSubscriptionCtaPanel: input.showSubscriptionCtaPanel === true,
    }),
    keyKindPanel,
    trendRange,
    insightsRange,
    trendSeries,
    trendAxisLabels,
    trendChart,
    modelConsumption,
    consumptionMax,
    consumptionTotal,
    cacheRate,
    heatmapCells,
    heatmapLayout,
    streak,
    hasTrendData,
    hasInsightsData: modelConsumption.some((item) => item.value > 0),
  }
}
