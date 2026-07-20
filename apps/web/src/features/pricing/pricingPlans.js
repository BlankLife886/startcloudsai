import { formatUsd } from './pricingMoney.js'

export const PLAN_BILLING_TABS = [
  { id: 'month', label: '连续包月' },
  { id: 'year', label: '连续包年', badge: '立省2月' },
]

function normalizeTierKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-_.\s]+(month|monthly|year|yearly|annual|y|m)$/i, '')
    .replace(/(月付|年付|包月|包年)$/u, '')
}

export function resolveDefaultPlanBillingTab(plans = []) {
  if (shouldUsePlanCatalogMode(plans)) return 'catalog'
  const hasYear = plans.some((plan) => String(plan.billingCycle || '') === 'year')
  return hasYear ? 'year' : 'month'
}

export function shouldUsePlanCatalogMode(plans = []) {
  return plans.some((plan) => {
    const metadata = plan.metadata || {}
    return (
      Number(metadata.durationDays || 0) > 0 ||
      Number(metadata.dailyUsdAllowance || 0) > 0
    )
  })
}

export function filterPlansByBillingTab(plans = [], tab = 'month') {
  return plans.filter((plan) => {
    const cycle = String(plan.billingCycle || 'month')
    if (tab === 'year') return cycle === 'year'
    return cycle === 'month' || cycle === 'week'
  })
}

export function filterPlansForDisplay(plans = [], tab = 'month') {
  if (shouldUsePlanCatalogMode(plans)) {
    return [...plans].sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
    )
  }
  return filterPlansByBillingTab(plans, tab)
}

export function planBillingAvailability(plans = []) {
  if (shouldUsePlanCatalogMode(plans)) {
    return { month: false, year: false, catalog: true }
  }
  return {
    month: filterPlansByBillingTab(plans, 'month').length > 0,
    year: filterPlansByBillingTab(plans, 'year').length > 0,
    catalog: false,
  }
}

function findMonthlySibling(plan, plans = []) {
  const tier = normalizeTierKey(plan.planKey) || normalizeTierKey(plan.name)
  if (!tier) return null
  return (
    plans.find((item) => {
      if (String(item.billingCycle || '') !== 'month') return false
      const itemTier = normalizeTierKey(item.planKey) || normalizeTierKey(item.name)
      return itemTier === tier
    }) || null
  )
}

export function formatPlanCurrencyParts(cents = 0, currency = 'USD') {
  const value = Math.max(0, Number(cents || 0)) / 100
  const code = String(currency || 'USD').toUpperCase()
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (code === 'CNY' || code === 'RMB') return { symbol: '¥', value: formatted }
  if (code === 'USD') return { symbol: '$', value: formatted }
  return { symbol: code, value: formatted, spaced: true }
}

export function formatPlanCurrencyLabel(cents = 0, currency = 'USD') {
  const parts = formatPlanCurrencyParts(cents, currency)
  if (parts.spaced) return `${parts.symbol} ${parts.value}`
  return `${parts.symbol}${parts.value}`
}

function resolvePlanDurationDays(plan = {}) {
  const metadata = plan.metadata || {}
  const configured = Math.max(0, Math.round(Number(metadata.durationDays || 0)))
  if (configured > 0) return configured
  const cycle = String(plan.billingCycle || 'month')
  if (cycle === 'day') return 1
  if (cycle === 'week') return 7
  if (cycle === 'year') return 365
  if (cycle === 'month') return 30
  return 0
}

function resolveDurationLabel(plan = {}) {
  const days = resolvePlanDurationDays(plan)
  if (days === 3) return '3 天'
  if (days === 7) return '7 天'
  if (days === 30) return '30 天'
  if (days > 0) return `${days} 天`
  const cycle = String(plan.billingCycle || 'month')
  if (cycle === 'year') return '12 个月'
  if (cycle === 'week') return '7 天'
  if (cycle === 'day') return '1 天'
  return '1 个月'
}

function buildPlanUsageHeadline(plan = {}) {
  const metadata = plan.metadata || {}
  if (String(metadata.usageHeadline || '').trim()) return String(metadata.usageHeadline).trim()
  const dailyUsd = Number(metadata.dailyUsdAllowance || 0)
  if (dailyUsd > 0) return `每日 ${formatMoneyLabel(dailyUsd)} API 额度，订阅密钥专用`
  const description = String(plan.description || '').trim()
  if (description) return description.split('\n')[0].trim()
  return '订阅身份与模型权限；API 按美元余额扣费'
}

function buildPlanFeatureBullets(plan = {}, summarizeEntitlements) {
  const metadata = plan.metadata || {}
  const configured = Array.isArray(metadata.featureBullets)
    ? metadata.featureBullets.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (configured.length) return configured.slice(0, 8)

  const rows = []
  ;(plan.entitlements || []).forEach((item) => {
    const name = String(item?.name || '').trim()
    if (name) rows.push(name)
  })
  if (typeof summarizeEntitlements === 'function') {
    summarizeEntitlements(plan).forEach((item) => {
      const text = String(item || '').trim()
      if (text && !rows.includes(text)) rows.push(text)
    })
  }
  if (!rows.length && plan.description) {
    plan.description
      .split('\n')
      .slice(1)
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean)
      .forEach((line) => rows.push(line))
  }
  const dailyUsd = Number(metadata.dailyUsdAllowance || 0)
  if (!rows.length && dailyUsd > 0) {
    rows.push(`每日 ${formatMoneyLabel(dailyUsd)} API 调用额度`)
    rows.push('订阅密钥自动创建，限 1 个')
    rows.push('超出额度请使用充值密钥或续订')
    return rows
  }
  if (!rows.length) rows.push('支持平台全部已开放模型', 'API 按美元余额扣费', '套餐用户限 1 个 API Key')
  return rows.slice(0, 8)
}


function formatMoneyLabel(value = 0) {
  return formatUsd(value)
}

function formatCompactNumber(value = 0) {
  const num = Number(value || 0)
  if (!Number.isFinite(num) || num <= 0) return '0'
  if (num >= 100000000) return `${(num / 100000000).toFixed(num >= 1000000000 ? 0 : 1)} 亿+`
  if (num >= 10000) return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1)} 万+`
  return String(Math.round(num))
}

function normalizeStackMode(value = '') {
  const mode = String(value || 'additive')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
  return ['additive', 'extend_duration', 'replace', 'deny_if_active'].includes(mode) ? mode : 'additive'
}

export function buildClientSubscriptionPeriodView(subscription = null) {
  if (
    subscription &&
    typeof subscription.isActive === 'boolean' &&
    typeof subscription.label === 'string' &&
    subscription.status === undefined
  ) {
    return subscription
  }
  if (!subscription) {
    return {
      isActive: false,
      label: '未订阅',
      startsAt: '',
      endsAt: '',
      remainingDays: 0,
      remainingLabel: '—',
    }
  }
  const startsAt = String(subscription.startsAt || '').trim()
  const endsAt = String(subscription.endsAt || '').trim()
  const now = Date.now()
  const startMs = Date.parse(startsAt)
  const endMs = endsAt ? Date.parse(endsAt) : NaN
  const started = !Number.isFinite(startMs) || startMs <= now
  const statusActive = String(subscription.status || '') === 'active'
  const formatLocal = (value) => {
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) return value || '—'
    return new Date(ms).toLocaleString('zh-CN', { hour12: false })
  }
  if (!endsAt || !Number.isFinite(endMs)) {
    const isActive = statusActive && started
    return {
      isActive,
      label: isActive ? '长期有效' : started ? '已结束' : `将于 ${formatLocal(startsAt)} 生效`,
      startsAt,
      endsAt: '',
      remainingDays: isActive ? null : 0,
      remainingLabel: isActive ? '长期' : '—',
    }
  }
  const remainingMs = endMs - now
  const remainingDays = Math.max(0, Math.ceil(remainingMs / 86400000))
  const isActive = statusActive && started && remainingMs > 0
  const endLabel = formatLocal(endsAt)
  const startLabel = formatLocal(startsAt)
  return {
    isActive,
    label: isActive
      ? `还剩 ${remainingDays} 天`
      : remainingMs <= 0
        ? `已于 ${endLabel} 到期`
        : `将于 ${startLabel} 生效`,
    startsAt,
    endsAt,
    remainingDays: isActive ? remainingDays : 0,
    remainingLabel: isActive ? `还剩 ${remainingDays} 天` : '已到期',
  }
}

export function buildSubscriptionSidebarHint(period = {}) {
  if (!period?.isActive) return ''
  if (period.remainingDays != null && Number.isFinite(period.remainingDays)) {
    return `还剩 ${period.remainingDays} 天`
  }
  const endsAt = String(period.endsAt || '').trim()
  if (!endsAt) return period.remainingLabel || period.label || ''
  const ms = Date.parse(endsAt)
  if (!Number.isFinite(ms)) return period.label || ''
  return `${new Date(ms).toLocaleDateString('zh-CN')} 到期`
}

export function evaluatePlanPurchaseEligibility(plan = {}, current = null) {
  const metadata = plan.metadata || {}
  const stackMode = normalizeStackMode(metadata.stackMode)
  const activeSubscriptions = Array.isArray(current?.activeSubscriptions)
    ? current.activeSubscriptions
    : current?.activeSubscription
      ? [current.activeSubscription]
      : []
  const activeItems = activeSubscriptions.filter((item) => buildClientSubscriptionPeriodView(item).isActive)
  if (!activeItems.length) {
    return { allowed: true, reason: '' }
  }
  if (stackMode === 'extend_duration') {
    return {
      allowed: true,
      reason: '续期模式：购买后将延长当前套餐有效期',
    }
  }
  if (stackMode === 'deny_if_active') {
    return {
      allowed: false,
      reason: '当前已有生效套餐，到期前不能重复购买',
    }
  }
  return { allowed: true, reason: '' }
}

function resolveComparePricing(plan, plans = []) {
  const metadata = plan.metadata || {}
  const configured = Number(metadata.compareAtCents || metadata.originalPriceCents || 0)
  if (configured > Number(plan.priceCents || 0)) {
    return {
      compareAtCents: configured,
      savingsCents: configured - Number(plan.priceCents || 0),
    }
  }
  if (String(plan.billingCycle || '') === 'year') {
    const monthly = findMonthlySibling(plan, plans)
    if (monthly) {
      const compareAtCents = Number(monthly.priceCents || 0) * 12
      const savingsCents = compareAtCents - Number(plan.priceCents || 0)
      if (savingsCents > 0) return { compareAtCents, savingsCents }
    }
  }
  return { compareAtCents: 0, savingsCents: 0 }
}

function resolveCycleLabel(plan = {}, tab = 'month') {
  const durationLabel = resolveDurationLabel(plan)
  if (Number(plan.metadata?.durationDays || 0) > 0) {
    return `${durationLabel}，到期自动失效`
  }
  const cycle = String(plan.billingCycle || 'month')
  if (cycle === 'year' || tab === 'year') return '每年，按年订阅'
  if (cycle === 'week') return '每周，按周订阅'
  return '每月，按月订阅'
}

function resolveDailyPriceLabel(priceCents = 0, plan = {}, currency = 'USD') {
  const days = resolvePlanDurationDays(plan)
  if (!days || priceCents <= 0) return ''
  const dailyCents = priceCents / days
  return `日均 ${formatPlanCurrencyLabel(dailyCents, currency)}`
}

export function buildSubscriptionPlanCards({
  plans = [],
  tab = 'month',
  currentPlanKey = '',
  featuredPlanKey = '',
  summarizeEntitlements,
  current = null,
} = {}) {
  const catalogMode = shouldUsePlanCatalogMode(plans)
  const visible = filterPlansForDisplay(plans, tab)
  return visible.map((plan, index) => {
    const priceCents = Number(plan.priceCents || 0)
    const currency = String(plan.currency || 'USD')
    const metadata = plan.metadata || {}
    const dailyUsdAllowance = Math.max(0, Number(metadata.dailyUsdAllowance || 0))
    const durationDays = resolvePlanDurationDays(plan)
    const durationLabel = resolveDurationLabel(plan)
    const { compareAtCents, savingsCents } = resolveComparePricing(plan, plans)
    const isCurrent =
      currentPlanKey &&
      currentPlanKey === plan.planKey &&
      buildClientSubscriptionPeriodView(current?.activeSubscription).isActive
    const purchase = evaluatePlanPurchaseEligibility(plan, current)
    const isFeatured =
      Boolean(metadata.featured) ||
      (featuredPlanKey
        ? featuredPlanKey === plan.planKey
        : visible.length === 3 && index === 1 && !isCurrent)

    return {
      plan,
      key: plan.planKey,
      name: plan.name || plan.planKey,
      planTag: String(metadata.planTag || '').trim(),
      priceParts: formatPlanCurrencyParts(priceCents, currency),
      comparePrice:
        compareAtCents > priceCents ? formatPlanCurrencyLabel(compareAtCents, currency) : '',
      savingsLabel:
        !isFeatured && savingsCents > 0
          ? `立省 ${formatPlanCurrencyLabel(savingsCents, currency)}`
          : '',
      cycleLabel: resolveCycleLabel(plan, tab),
      durationLabel,
      durationDays,
      dailyPriceLabel: resolveDailyPriceLabel(priceCents, plan, currency),
      dailyUsdAllowance,
      limitBarLabel: dailyUsdAllowance > 0 ? `${formatMoneyLabel(dailyUsdAllowance)} / 天` : '',
      headline: buildPlanUsageHeadline(plan),
      features: buildPlanFeatureBullets(plan, summarizeEntitlements),
      isCurrent,
      purchaseBlocked: !purchase.allowed,
      purchaseHint: purchase.reason,
      isFeatured,
      isFree: priceCents <= 0,
      catalogMode,
    }
  })
}

export function resolveCommercePlanByKey(plans = [], planKey = '') {
  const key = String(planKey || '').trim()
  if (!key) return null
  return plans.find((item) => String(item.planKey || '') === key) || null
}

export function resolveCommercePlanNameFromCatalog(plans = [], planKey = '') {
  const plan = resolveCommercePlanByKey(plans, planKey)
  if (plan?.name) return String(plan.name)
  const key = String(planKey || '').trim()
  return key || '—'
}

export function formatCommerceOrderId(orderId = '') {
  const raw = String(orderId || '').trim()
  if (!raw) return '—'
  return raw.replace(/^order:/i, '')
}

export function formatCommerceOrderProvider(provider = '') {
  const map = {
    wallet: '余额支付',
    stripe: 'Stripe',
    paypal: 'PayPal',
    alipay: '支付宝',
    manual: '测试开通',
  }
  const key = String(provider || '').trim().toLowerCase()
  return map[key] || key || '—'
}

export function formatCommerceOrderAmount(order = {}, plan = null) {
  const cents = Number(order?.amountCents ?? order?.priceCents ?? 0)
  const currency = String(order?.currency || plan?.currency || 'USD').toUpperCase()
  if (cents <= 0) return '免费'
  const decimals = cents % 100 === 0 ? 0 : 2
  return currency === 'USD'
    ? `$${(cents / 100).toFixed(decimals)}`
    : `${currency} ${(cents / 100).toFixed(decimals)}`
}

export function resolveCommerceOrderCycleLabel(order = {}, plan = null) {
  const matchedPlan = plan || null
  if (matchedPlan) {
    if (resolvePlanDurationDays(matchedPlan) > 0) {
      return resolveDurationLabel(matchedPlan)
    }
  }
  const cycle = String(matchedPlan?.billingCycle || order?.billingCycle || 'month')
  return (
    {
      once: '单次',
      day: '日付',
      week: '周付',
      month: '月付',
      year: '年付',
    }[cycle] || cycle
  )
}

export function formatCommerceOrderPrice(order = {}, plan = null) {
  const amount = formatCommerceOrderAmount(order, plan)
  if (amount === '免费') return amount
  const cycleLabel = resolveCommerceOrderCycleLabel(order, plan)
  return cycleLabel ? `${amount} / ${cycleLabel}` : amount
}

export function resolveCommerceOrderPlanName(order = {}, plans = []) {
  const fromOrder = String(order?.planName || order?.metadata?.planName || '').trim()
  if (fromOrder) return fromOrder
  return resolveCommercePlanNameFromCatalog(plans, order?.planKey)
}

export function resolveCommerceOrderPlanSubtitle(order = {}, plans = []) {
  const plan = resolveCommercePlanByKey(plans, order?.planKey)
  return resolveCommerceOrderCycleLabel(order, plan)
}

export function resolveCommerceOrderTimeLabel(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return '—'
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return raw
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

export function resolveCommerceOrderStatusLabel(status = '') {
  const map = {
    pending: '待支付',
    paid: '已支付',
    activating: '开通中',
    activated: '已开通',
    cancelled: '已取消',
    expired: '已过期',
    failed: '失败',
  }
  return map[String(status || '').trim().toLowerCase()] || String(status || '—')
}

export function resolveWalletRechargeStatusLabel(status = '') {
  const map = {
    pending: '待支付',
    paid: '已支付',
    activating: '入账中',
    activated: '已到账',
    cancelled: '已取消',
    expired: '已过期',
    failed: '失败',
  }
  return map[String(status || '').trim().toLowerCase()] || resolveCommerceOrderStatusLabel(status)
}

export function isCommerceOrderSettled(status = '') {
  return String(status || '').trim().toLowerCase() === 'activated'
}

export function isCommerceOrderPayable(status = '') {
  return String(status || '').trim().toLowerCase() === 'pending'
}

export function isCommerceOrderInProgress(status = '') {
  return ['pending', 'paid', 'activating'].includes(String(status || '').trim().toLowerCase())
}

export function resolveCommerceOrderPaidAtLabel(order = {}) {
  const status = String(order?.status || '').trim().toLowerCase()
  if (['paid', 'activating', 'activated'].includes(status) && order?.paidAt) {
    return resolveCommerceOrderTimeLabel(order.paidAt)
  }
  return '—'
}

export function resolveCommerceOrderCreatedAtLabel(order = {}) {
  return resolveCommerceOrderTimeLabel(order?.createdAt)
}

export function resolveWalletRechargeOrderTitle(order = {}, amountLabel = '') {
  const status = String(order?.status || '').trim().toLowerCase()
  const amount = amountLabel || formatCommerceOrderAmount(order)
  const map = {
    pending: `充值 ${amount}（待支付）`,
    paid: `充值 ${amount}（已支付，入账中）`,
    activating: `充值 ${amount}（入账中）`,
    activated: `充值到账 ${amount}`,
    cancelled: `充值 ${amount}（已取消）`,
    expired: `充值 ${amount}（已过期）`,
    failed: `充值 ${amount}（失败）`,
  }
  return map[status] || `充值 ${amount}`
}

export function resolveAlipayPayAmountLabel(order = {}) {
  const metadata =
    order?.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
      ? order.metadata
      : {}
  const cny = String(metadata.alipayPayCny || '').trim()
  return cny ? `¥${cny}` : ''
}

export function buildWalletRechargeOrderDisplay(order = {}) {
  const amountLabel = formatCommerceOrderAmount(order)
  const payAmountLabel = resolveAlipayPayAmountLabel(order)
  const status = String(order?.status || '').trim().toLowerCase()
  return {
    id: formatCommerceOrderId(order.id),
    amountLabel,
    payAmountLabel,
    title: resolveWalletRechargeOrderTitle(order, amountLabel),
    providerLabel: formatCommerceOrderProvider(order.checkoutProvider),
    statusLabel: resolveWalletRechargeStatusLabel(order.status),
    createdAtLabel: resolveCommerceOrderCreatedAtLabel(order),
    paidAtLabel: resolveCommerceOrderPaidAtLabel(order),
    isSettled: isCommerceOrderSettled(status),
    isPayable: isCommerceOrderPayable(status),
    isInProgress: isCommerceOrderInProgress(status),
  }
}

export function buildSubscriptionOrderDisplay(order = {}, plans = []) {
  const plan = resolveCommercePlanByKey(plans, order.planKey)
  const status = String(order?.status || '').trim().toLowerCase()
  return {
    id: formatCommerceOrderId(order.id),
    planName: resolveCommerceOrderPlanName(order, plans),
    planSubtitle: resolveCommerceOrderPlanSubtitle(order, plans),
    amountLabel: formatCommerceOrderAmount(order, plan),
    payAmountLabel: resolveAlipayPayAmountLabel(order),
    providerLabel: formatCommerceOrderProvider(order.checkoutProvider),
    statusLabel: resolveCommerceOrderStatusLabel(order.status),
    createdAtLabel: resolveCommerceOrderCreatedAtLabel(order),
    paidAtLabel: resolveCommerceOrderPaidAtLabel(order),
    startsAtLabel:
      status === 'activated'
        ? resolveCommerceOrderTimeLabel(order.subscriptionStartsAt || order.metadata?.subscriptionStartsAt)
        : '—',
    endsAtLabel:
      status === 'activated'
        ? resolveCommerceOrderTimeLabel(order.subscriptionEndsAt || order.metadata?.subscriptionEndsAt)
        : '—',
    isSettled: isCommerceOrderSettled(status),
    isPayable: isCommerceOrderPayable(status),
    isInProgress: isCommerceOrderInProgress(status),
  }
}

function resolveRecordSortTimestamp(value = '') {
  const ms = Date.parse(String(value || '').trim())
  return Number.isFinite(ms) ? ms : 0
}

export function sortCommerceOrdersByCreatedAt(orders = [], direction = 'desc') {
  const factor = direction === 'asc' ? 1 : -1
  return [...orders].sort(
    (left, right) =>
      factor *
      (resolveRecordSortTimestamp(left?.createdAt || left?.updatedAt) -
        resolveRecordSortTimestamp(right?.createdAt || right?.updatedAt)),
  )
}

/** 用量/API 扣费流水 — 仅在「用量」页展示，不出现在钱包交易记录 */
const WALLET_USAGE_LEDGER_SOURCE_TYPES = new Set([
  'openai_gateway',
  'ai_job',
  'api_usage',
])

export function isWalletFinancialLedgerRow(row = {}) {
  const sourceType = String(row.sourceType || '').trim().toLowerCase()
  if (WALLET_USAGE_LEDGER_SOURCE_TYPES.has(sourceType)) return false

  const reason = String(row.reason || '').trim()
  if (/^API 调用/i.test(reason) || /^平台 API 调用/i.test(reason)) return false

  return true
}

export function filterWalletLedgerRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(isWalletFinancialLedgerRow)
}

/** 合并进行中的充值订单与美元流水，按时间倒序 */
export function buildWalletHistoryTimeline({ openRechargeRows = [], ledgerRows = [] } = {}) {
  const items = []
  openRechargeRows.forEach((row) => {
    const order = row?.order || {}
    const sortAt = String(order.updatedAt || order.createdAt || '').trim()
    items.push({
      kind: 'recharge_order',
      id: `recharge:${order.id || row?.display?.id || sortAt}`,
      sortAt,
      sortAtMs: resolveRecordSortTimestamp(sortAt),
      row,
    })
  })
  ledgerRows.forEach((row) => {
    const sortAt = String(row?.createdAt || '').trim()
    items.push({
      kind: 'ledger',
      id: `ledger:${row?.id || sortAt}`,
      sortAt,
      sortAtMs: resolveRecordSortTimestamp(sortAt),
      row,
    })
  })
  return items.sort((left, right) => right.sortAtMs - left.sortAtMs)
}

export function isWalletTopupPlan(plan = {}) {
  if (String(plan?.planKind || '') === 'wallet_topup') return true
  const metadata = plan.metadata || {}
  if (metadata.walletTopup === true || metadata.topup === true) return true
  if (metadata.walletTopup === false || metadata.topup === false) return false
  return String(plan?.billingCycle || '') === 'once'
}

export function isSubscriptionCommerceOrder(order = {}, plans = []) {
  if (order?.walletTopup === true || order?.metadata?.walletTopup === true) return false
  const plan = resolveCommercePlanByKey(plans, order?.planKey)
  if (!plan) return true
  return !isWalletTopupPlan(plan)
}
