export function createPricingTailHelpers(dependencies) {
  const {
    usageStatusFilter,
    usageModelFilter,
    usageKeyKindFilter,
    USAGE_KEY_KIND_LABELS,
    httpStatusTone,
    ttftTone,
    formatMoneyDisplay,
    formatCompactNumber,
  } = dependencies

  function referralRecordClass(tone = '') {
    if (tone === 'success') return 'is-success'
    if (tone === 'warn') return 'is-warn'
    return 'is-muted'
  }

  function statusClass(value) {
    const status = String(value || '').toLowerCase()
    if (['success', 'completed', 'active', 'activated'].includes(status)) return 'is-ok'
    if (
      ['pending', 'queued', 'running', 'paused', 'reserved', 'paid', 'activating'].includes(status)
    ) {
      return 'is-paused'
    }
    if (['failed', 'error', 'revoked', 'cancelled', 'canceled', 'expired'].includes(status))
      return 'is-revoked'
    return ''
  }

  function resetUsageFilters() {
    usageStatusFilter.value = 'all'
    usageModelFilter.value = 'all'
    usageKeyKindFilter.value = 'all'
  }

  function usageKeyKindLabel(value) {
    return USAGE_KEY_KIND_LABELS[String(value || 'wallet')] || USAGE_KEY_KIND_LABELS.wallet
  }

  function usageHttpToneClass(value) {
    const tone = httpStatusTone(value)
    return tone ? `is-${tone}` : ''
  }

  function usageTtftToneClass(value) {
    const tone = ttftTone(value)
    return tone ? `is-${tone}` : ''
  }

  function usageStatusLabel(value) {
    const map = {
      success: '成功',
      charged_failed: '已扣费失败',
      reserved: '占用中',
      released: '已释放',
      completed: '完成',
      pending: '等待',
      failed: '失败',
      error: '错误',
    }
    return map[String(value || '')] || String(value || '-')
  }

  function ledgerSourceTypeLabel(value) {
    const map = {
      redeem_code: '兑换码',
      commerce_order: '充值到账',
      referral: '推荐奖励',
      manual: '手动调整',
      credit_exchange: '兑换积分',
      usd_exchange: '美元兑换',
      api_usage: 'API 调用',
    }
    return map[String(value || '')] || String(value || '-')
  }

  function resolveUsdLedgerRowTitle(row = {}) {
    const reason = String(row.reason || '').trim()
    if (reason) return reason
    if (row.sourceType === 'commerce_order') return '钱包充值'
    return ledgerDirectionLabel(row.direction)
  }

  function ledgerDirectionLabel(value) {
    const map = {
      grant: '入账',
      spend: '扣减',
      credit: '入账',
      debit: '扣减',
      freeze: '冻结',
      unfreeze: '解冻',
    }
    return map[String(value || '')] || String(value || '-')
  }

  function isLedgerSpend(value) {
    return ['spend', 'debit'].includes(String(value || '').toLowerCase())
  }

  function formatUsdLimitPair(daily, monthly) {
    const day = Number(daily || 0)
    const month = Number(monthly || 0)
    if (!day && !month) return '不限'
    const parts = []
    if (day > 0) parts.push(`日 ${formatMoneyDisplay(day)}`)
    if (month > 0) parts.push(`月 ${formatMoneyDisplay(month)}`)
    return parts.join(' · ')
  }

  function formatLimitPair(daily, monthly, unit = '') {
    const day = Number(daily || 0)
    const month = Number(monthly || 0)
    if (!day && !month) return '不限'
    const parts = []
    if (day > 0) parts.push(`日 ${formatCompactNumber(day)}${unit}`)
    if (month > 0) parts.push(`月 ${formatCompactNumber(month)}${unit}`)
    return parts.join(' / ')
  }

  function parseLineList(value) {
    return String(value || '')
      .split(/[\n,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function mergePlainObject(base = {}, incoming = {}) {
    const safeBase = base && typeof base === 'object' && !Array.isArray(base) ? base : {}
    const safeIncoming =
      incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {}
    return { ...safeBase, ...safeIncoming }
  }

  return {
    referralRecordClass,
    statusClass,
    resetUsageFilters,
    usageKeyKindLabel,
    usageHttpToneClass,
    usageTtftToneClass,
    usageStatusLabel,
    ledgerSourceTypeLabel,
    resolveUsdLedgerRowTitle,
    ledgerDirectionLabel,
    isLedgerSpend,
    formatUsdLimitPair,
    formatLimitPair,
    parseLineList,
    mergePlainObject,
  }
}
