export function createPricingGeneralHelpers(dependencies) {
  function normalizeUsageLog(row = {}, keyKindLookup = null) {
    const resourceKey = String(row.resourceKey || row.metadata?.model || '')
    const lookup = keyKindLookup || dependencies.usageKeyKindLookup.value
    return dependencies.enrichUsageLog({
      ...row,
      keyKindLookup: lookup,
      id: row.id || row.requestId || `${row.createdAt || ''}-${resourceKey}`,
      requestId: String(row.requestId || ''),
      providerKey: String(row.providerKey || ''),
      providerKeyId: String(row.providerKeyId || ''),
      clientId: String(row.clientId || ''),
      resourceType: String(row.resourceType || ''),
      resourceKey,
      modelLabel: dependencies.formatUsageModelLabel({ ...row, resourceKey }),
      units: Number(row.units || 0),
      estimatedCostUsd: Number(row.estimatedCostUsd || 0),
      status: String(row.status || 'unknown'),
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      createdAt: row.createdAt || '',
    })
  }

  function normalizeLedgerRow(row = {}) {
    return {
      id: row.id || `${row.createdAt || ''}-${row.amount || 0}`,
      direction: String(row.direction || ''),
      amount: Number(row.amount || 0),
      balanceAfter: Number(row.balanceAfter || 0),
      sourceType: String(row.sourceType || ''),
      reason: String(row.reason || ''),
      createdAt: row.createdAt || '',
    }
  }

  function formatEndpoint(value) {
    const raw = String(value || '').trim() || '/v1'
    if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '')
    return `${window.location.origin}${raw.startsWith('/') ? raw : `/${raw}`}`.replace(/\/+$/, '')
  }

  function formatMoney(value) {
    return dependencies.formatUsdFixed4(value)
  }

  function formatCredits(value) {
    const number = Number(value || 0)
    if (!Number.isFinite(number)) return '0'
    return number >= 1000
      ? Math.round(number).toLocaleString()
      : `${Math.round(number * 1000) / 1000}`
  }

  function formatCompactNumber(value) {
    const number = Number(value || 0)
    return number >= 1000 ? number.toLocaleString() : `${Math.round(number * 1000) / 1000}`
  }

  function formatDate(value) {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  function planPriceParts(plan) {
    const cents = Number(plan?.priceCents ?? plan?.amountCents ?? 0)
    const cycle =
      {
        once: '单次',
        day: '天',
        week: '周',
        month: '月',
        year: '年',
      }[String(plan?.billingCycle || 'month')] || '月'
    if (cents <= 0) return { amount: '免费', cycle: '' }
    const decimals = cents % 100 === 0 ? 0 : 2
    return { amount: `$${(cents / 100).toFixed(decimals)}`, cycle: `/ ${cycle}` }
  }

  function formatPlanPrice(plan) {
    const cents = Number(plan?.priceCents ?? plan?.amountCents ?? 0)
    const currency = String(plan?.currency || 'USD').toUpperCase()
    const cycle =
      {
        once: '一次',
        day: '天',
        week: '周',
        month: '月',
        year: '年',
      }[String(plan?.billingCycle || 'month')] || '月'
    if (cents <= 0) return '免费'
    return `${currency === 'USD' ? '$' : `${currency} `}${(cents / 100).toFixed(2)} / ${cycle}`
  }

  function walletRechargeStatusLabel(status = '') {
    return dependencies.resolveWalletRechargeStatusLabel(status)
  }

  function checkoutStatusLabel(value) {
    return dependencies.resolveCommerceOrderStatusLabel(value)
  }

  function summarizePlanEntitlements(plan) {
    const rows = []
    ;(plan?.entitlements || []).forEach((item) => {
      const name = String(item?.name || '').trim()
      if (name && !rows.includes(name)) rows.push(name)
    })
    if (!rows.length) {
      rows.push('开放已配置模型', 'API 按美元余额扣费', '套餐用户限 1 个 API Key')
    }
    return rows.slice(0, 5)
  }

  function formatBillingMode(value) {
    const map = {
      request: '按次',
      token: '按 Token',
      image: '按图',
      credit: '按次（美元）',
      minute: '按分钟',
      second: '按秒',
      storage: '按存储',
    }
    return map[String(value || '')] || '按量'
  }

  return {
    normalizeUsageLog,
    normalizeLedgerRow,
    formatEndpoint,
    formatMoney,
    formatCredits,
    formatCompactNumber,
    formatDate,
    planPriceParts,
    formatPlanPrice,
    walletRechargeStatusLabel,
    checkoutStatusLabel,
    summarizePlanEntitlements,
    formatBillingMode,
  }
}
