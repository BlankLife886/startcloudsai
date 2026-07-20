import { formatUsd } from './pricingMoney.js'

function formatQuotaUsd(value = 0) {
  return formatUsd(value)
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

function resolveSubscriptionBillingModeLabel(plan = {}, dailyQuota = 0, hasSubscription = false) {
  if (!hasSubscription) return ''
  if (dailyQuota > 0) return '每日额度'
  const metadata = plan.metadata || {}
  const configured = String(metadata.planTag || metadata.billingModeLabel || '').trim()
  if (configured) return configured
  const durationDays = resolvePlanDurationDays(plan)
  if (durationDays > 0) return `${durationDays} 天套餐`
  const cycle = String(plan.billingCycle || 'month')
  if (cycle === 'year') return '按年订阅'
  if (cycle === 'week') return '按周订阅'
  if (cycle === 'day') return '按日订阅'
  return '按月订阅'
}

function formatExpiryLabel(value = '') {
  const ms = Date.parse(String(value || ''))
  if (!Number.isFinite(ms)) return '长期'
  const date = new Date(ms)
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function buildSubscriptionDashboard({
  currentPlan = null,
  subscriptionPeriod = null,
  subscriptionKey = null,
  usage = null,
} = {}) {
  const plan = currentPlan?.plan || {}
  const metadata = plan.metadata || {}
  const period = subscriptionPeriod || {}
  const dailyQuota = Math.max(
    0,
    Number(metadata.dailyUsdAllowance || metadata.dailyUsd || 0),
    Number(subscriptionKey?.dailyLimitUsd || 0),
  )
  const usedToday = Math.max(
    0,
    Number(subscriptionKey?.usage?.today?.estimatedCostUsd ?? usage?.today?.subscription?.estimatedCostUsd ?? 0),
  )
  const remaining = dailyQuota > 0 ? Math.max(0, dailyQuota - usedToday) : 0
  const usagePercent =
    dailyQuota > 0 ? Math.min(100, Math.round((usedToday / dailyQuota) * 1000) / 10) : 0
  const isActive =
    period.isActive === true ||
    String(currentPlan?.activeSubscription?.status || '').trim() === 'active'
  const hasSubscription = isActive || Boolean(currentPlan?.activeSubscription)
  const billingMode = resolveSubscriptionBillingModeLabel(plan, dailyQuota, hasSubscription)
  const hasDailyQuota = dailyQuota > 0

  return {
    visible: true,
    hasSubscription,
    isActive,
    hasDailyQuota,
    planName: hasSubscription
      ? String(plan.name || currentPlan?.activeSubscription?.planKey || '当前套餐')
      : '',
    planKey: String(plan.planKey || currentPlan?.activeSubscription?.planKey || ''),
    billingMode,
    statusLabel: isActive ? '生效中' : hasSubscription ? '未生效' : '',
    periodLabel: period.label || (isActive ? '订阅生效中' : '购买套餐后自动创建订阅密钥'),
    dailyQuota,
    dailyQuotaLabel: hasDailyQuota ? `${formatQuotaUsd(dailyQuota)}/天` : hasSubscription ? '无日额度' : '—',
    usedToday,
    usedTodayLabel: hasSubscription ? formatQuotaUsd(usedToday) : '—',
    remaining,
    remainingLabel:
      hasDailyQuota && hasSubscription
        ? formatQuotaUsd(remaining)
        : hasSubscription
          ? '超出走余额'
          : '—',
    usagePercent: hasSubscription && hasDailyQuota ? usagePercent : 0,
    ringCaption: hasDailyQuota ? '今日额度' : hasSubscription ? '套餐订阅' : '今日额度',
    ringStyle: {
      background: `conic-gradient(var(--pc-primary, #97ff7c) ${(hasSubscription && hasDailyQuota ? usagePercent : 0) * 3.6}deg, color-mix(in srgb, var(--pc-line, rgba(255,255,255,0.1)) 70%, transparent) 0)`,
    },
    expiresAtLabel: hasSubscription ? formatExpiryLabel(period.endsAt) : '—',
    keyPrefix: String(subscriptionKey?.keyPrefix || '').trim(),
    canResetKey: Boolean(subscriptionKey?.id),
  }
}
