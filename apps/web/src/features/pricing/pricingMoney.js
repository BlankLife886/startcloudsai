/** USD amounts are stored and aggregated at 4 decimal places (matches API ledger). */
export const USD_DECIMALS = 4
export const USD_SCALE = 10 ** USD_DECIMALS

/** Usage rows that count toward billed API consumption (matches api-resource-ledger). */
export const BILLABLE_USAGE_STATUSES = Object.freeze(['success', 'charged_failed'])

const billableStatusSet = new Set(BILLABLE_USAGE_STATUSES)

export function clampUsd(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round(Math.max(0, num) * USD_SCALE) / USD_SCALE
}

export function addUsd(...values) {
  const sum = values.reduce((acc, value) => acc + Number(value || 0), 0)
  return clampUsd(sum)
}

export function subtractUsd(minuend, subtrahend) {
  const result = Number(minuend || 0) - Number(subtrahend || 0)
  if (!Number.isFinite(result)) return 0
  return Math.round(result * USD_SCALE) / USD_SCALE
}

export function isBillableUsageStatus(status) {
  return billableStatusSet.has(String(status || '').trim().toLowerCase())
}

export function isBillableUsageLog(row = {}) {
  return isBillableUsageStatus(row.status)
}

export function getUsageLogEstimatedCostUsd(row = {}) {
  return clampUsd(row.estimatedCostUsd ?? row.estimated_cost_usd ?? 0)
}

/** All USD display strings use exactly 4 decimal places. */
export function formatUsd(value = 0) {
  return `$${clampUsd(value).toFixed(USD_DECIMALS)}`
}

/** Plain numeric amount without currency symbol (4 decimal places). */
export function formatPlainAmount(value = 0) {
  return clampUsd(value).toFixed(USD_DECIMALS)
}

export const formatMoneyDisplay = formatUsd
export const formatUsageCostUsd = formatUsd
export const formatUsdFixed4 = formatUsd

/**
 * Available balance = gross balance minus frozen (pre-auth) amounts.
 * Never subtract frozen twice when API already sends availableBalance.
 */
export function resolveAvailableUsdBalance(wallet = {}) {
  const balance = clampUsd(wallet.balance ?? 0)
  const frozen = clampUsd(wallet.frozenBalance ?? 0)
  const rawAvailable = wallet.availableBalance
  if (rawAvailable !== undefined && rawAvailable !== null && rawAvailable !== '') {
    const parsed = clampUsd(rawAvailable)
    const ceiling = clampUsd(balance - frozen)
    return clampUsd(Math.max(0, Math.min(parsed, ceiling)))
  }
  return clampUsd(Math.max(0, balance - frozen))
}

export function resolveWalletSnapshot(wallet = {}) {
  const balance = clampUsd(wallet.balance ?? 0)
  const frozen = clampUsd(wallet.frozenBalance ?? 0)
  return {
    balance,
    frozenBalance: frozen,
    availableBalance: resolveAvailableUsdBalance({ ...wallet, balance, frozenBalance: frozen }),
    lifetimeSpent: clampUsd(wallet.lifetimeSpent ?? 0),
    lifetimeEarned: clampUsd(wallet.lifetimeEarned ?? 0),
  }
}

export function sumBillableUsageCost(logs = []) {
  return logs.filter(isBillableUsageLog).reduce(
    (total, row) => addUsd(total, getUsageLogEstimatedCostUsd(row)),
    0,
  )
}

function mergeUsagePeriodBucket(empty = {}, source = {}) {
  if (!source || typeof source !== 'object') return empty
  return {
    ...empty,
    ...source,
    units: Number(source.units ?? empty.units ?? 0),
    count: Number(source.count ?? source.units ?? empty.count ?? 0),
    estimatedCostUsd: clampUsd(source.estimatedCostUsd ?? empty.estimatedCostUsd ?? 0),
  }
}

function mergeKeyKindBucket(empty = {}, source = {}) {
  if (!source || typeof source !== 'object') return empty
  const merged = { ...empty, ...source }
  for (const kind of ['subscription', 'wallet']) {
    const bucket = source[kind]
    if (!bucket || typeof bucket !== 'object') continue
    merged[kind] = {
      ...(empty[kind] || {}),
      ...bucket,
      units: Number(bucket.units ?? empty[kind]?.units ?? 0),
      count: Number(bucket.count ?? bucket.units ?? empty[kind]?.count ?? 0),
      estimatedCostUsd: clampUsd(bucket.estimatedCostUsd ?? empty[kind]?.estimatedCostUsd ?? 0),
    }
  }
  return merged
}

export function createEmptyUsageSummary() {
  const emptyBucket = { units: 0, estimatedCostUsd: 0, count: 0 }
  const emptyKeyKind = {
    subscription: { ...emptyBucket },
    wallet: { ...emptyBucket },
  }
  return {
    today: { ...emptyBucket },
    week: { ...emptyBucket },
    month: { ...emptyBucket },
    total: { ...emptyBucket },
    logs: [],
    byKeyKind: {
      today: { ...emptyKeyKind, subscription: { ...emptyBucket }, wallet: { ...emptyBucket } },
      week: { ...emptyKeyKind, subscription: { ...emptyBucket }, wallet: { ...emptyBucket } },
      month: { ...emptyKeyKind, subscription: { ...emptyBucket }, wallet: { ...emptyBucket } },
    },
  }
}

export function normalizeClientResourceSummary(summary = {}) {
  const wallet = resolveWalletSnapshot(summary.wallet || summary.account || {})
  return {
    ...summary,
    wallet,
    account: wallet,
    usage: mergeUsageSummary(createEmptyUsageSummary(), summary.usage || {}),
  }
}

export function mergeUsageSummary(emptyUsage = {}, sourceUsage = {}) {
  if (!sourceUsage || typeof sourceUsage !== 'object') return emptyUsage
  const merged = {
    ...emptyUsage,
    ...sourceUsage,
    today: mergeUsagePeriodBucket(emptyUsage.today, sourceUsage.today),
    week: mergeUsagePeriodBucket(emptyUsage.week, sourceUsage.week),
    month: mergeUsagePeriodBucket(emptyUsage.month, sourceUsage.month),
    total: mergeUsagePeriodBucket(emptyUsage.total, sourceUsage.total),
    logs: Array.isArray(sourceUsage.logs) ? sourceUsage.logs : emptyUsage.logs || [],
  }
  if (sourceUsage.byKeyKind && typeof sourceUsage.byKeyKind === 'object') {
    merged.byKeyKind = {
      today: mergeKeyKindBucket(emptyUsage.byKeyKind?.today, sourceUsage.byKeyKind.today),
      week: mergeKeyKindBucket(emptyUsage.byKeyKind?.week, sourceUsage.byKeyKind.week),
      month: mergeKeyKindBucket(emptyUsage.byKeyKind?.month, sourceUsage.byKeyKind.month),
    }
  }
  return merged
}
