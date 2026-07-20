export function createPricingKeyHelpers(dependencies) {
  const {
    selectSection,
    accountNewSecret,
    accountNewSecretKeyId,
    notificationService,
    authStore,
    loadResources,
    planConsoleTab,
    scopeLabelMap,
    accountKeyForm,
    publicModelOptions,
    resolveUsageModelLabel,
    publicModelLabelLookup,
    pricingSettings,
    keyModelSearch,
    keyAdvancedOpen,
    keyLimitMode,
    keyLimitPeriod,
    keyLimitAmount,
    keyCreateModalOpen,
    keyMenuTriggerEl,
    keyMenuDropdownRef,
    keyMenuStyle,
    keyMenuOpenId,
    keyMenuOpenKey,
    nextTick,
    openKeyResetModal,
    openKeyRevokeModal,
    keyEditLimitMode,
    keyEditLimitPeriod,
    keyEditLimitAmount,
    keyEditDailyUnits,
    keyEditMonthlyUnits,
    scheduleKeyEditLimitSegmentSync,
    keyEditingKey,
    keyEditModal,
    keyEditForm,
    keyEditModelSearch,
    keyActionLoading,
    updateClientApiKey,
    keyEditAllowAllModels,
    parseLineList,
    formatCompactNumber,
    subtractUsd,
    availableUsd,
    formatMoneyDisplay,
    createPlatformKey,
    scopeOptions,
  } = dependencies

  function apiKeyStatusLabel(value) {
    const map = { active: '启用', paused: '暂停', revoked: '已注销', expired: '已过期' }
    return map[String(value || '')] || String(value || '未知')
  }

  function apiKeyKindLabel(value) {
    return String(value || 'wallet') === 'subscription' ? '订阅密钥' : '充值密钥'
  }

  function isSubscriptionApiKey(key = {}) {
    return String(key.keyKind || 'wallet') === 'subscription'
  }

  function revealSubscriptionApiKeySecret(payload = {}) {
    const secret = String(payload?.key || '').trim()
    selectSection('plans')
    if (secret) {
      accountNewSecret.value = secret
      accountNewSecretKeyId.value = String(payload?.apiKey?.id || '')
      notificationService.success('订阅密钥已生成，请立即复制保存（仅显示一次）')
      return
    }
    const apiKey = payload?.apiKey
    if (apiKey?.id) {
      accountNewSecretKeyId.value = String(apiKey.id)
      notificationService.warning('未能获取完整订阅密钥，请点击「重置密钥」')
    }
  }

  async function handleSubscriptionActivated(payload = {}, { reloadResources = true } = {}) {
    if (reloadResources && authStore.isAuthenticated) {
      await loadResources({ silent: true })
    }
    selectSection('plans')
    planConsoleTab.value = 'current'
    if (payload?.subscriptionApiKey) {
      revealSubscriptionApiKeySecret(payload.subscriptionApiKey)
    }
  }

  function scopeLabel(value) {
    return scopeLabelMap.value.get(String(value || '')) || String(value || '')
  }

  function setKeyAllowAllModels(allowAll) {
    if (allowAll) {
      accountKeyForm.allowedPublicModels = []
      return
    }
    if (!accountKeyForm.allowedPublicModels.length && publicModelOptions.value.length) {
      accountKeyForm.allowedPublicModels = [publicModelOptions.value[0].id]
    }
  }

  function toggleKeyModelSelection(modelId) {
    const normalized = String(modelId || '').trim()
    if (!normalized) return
    const current = Array.isArray(accountKeyForm.allowedPublicModels)
      ? [...accountKeyForm.allowedPublicModels]
      : []
    const index = current.indexOf(normalized)
    if (index >= 0) current.splice(index, 1)
    else current.push(normalized)
    accountKeyForm.allowedPublicModels = current
  }

  function isKeyModelSelected(modelId) {
    return accountKeyForm.allowedPublicModels.includes(String(modelId || ''))
  }

  function resolvePublicModelLabel(modelId) {
    const normalized = String(modelId || '').trim()
    if (!normalized) return ''
    return (
      resolveUsageModelLabel({ resourceKey: normalized }, publicModelLabelLookup.value) ||
      normalized
    )
  }

  function formatUsageModelLabel(row = {}) {
    return resolveUsageModelLabel(row, publicModelLabelLookup.value)
  }

  function formatKeyModelsSummary(models) {
    const list = Array.isArray(models) ? models.map(String).filter(Boolean) : []
    if (!list.length) {
      return { mode: 'all', labels: [], text: '全部公开模型' }
    }
    const labels = list.map((id) => resolvePublicModelLabel(id))
    return {
      mode: 'restricted',
      labels,
      text: labels.join('、'),
    }
  }

  function resetKeyFormState() {
    const settings = pricingSettings.value.apiKeys || {}
    accountKeyForm.label = ''
    accountKeyForm.prefix = String(settings.defaultPrefix || '')
    accountKeyForm.allowedPublicModels = []
    accountKeyForm.allowedIpsText = ''
    accountKeyForm.expiresAt = ''
    accountKeyForm.dailyLimitUnits = 0
    accountKeyForm.monthlyLimitUnits = 0
    accountKeyForm.dailyLimitUsd = 0
    accountKeyForm.monthlyLimitUsd = 0
    accountKeyForm.scopes = Array.isArray(settings.defaultScopes)
      ? settings.defaultScopes.map(String).filter(Boolean)
      : []
    keyModelSearch.value = ''
    keyAdvancedOpen.value = false
  }

  function selectAllKeyModels() {
    accountKeyForm.allowedPublicModels = publicModelOptions.value.map((model) => model.id)
  }

  function clearKeyModels() {
    accountKeyForm.allowedPublicModels = []
  }

  function openKeyCreateModal() {
    resetKeyFormState()
    keyLimitMode.value = 'unlimited'
    keyLimitPeriod.value = 'unlimited'
    keyLimitAmount.value = ''
    closeKeyMenu()
    keyCreateModalOpen.value = true
  }

  function closeKeyCreateModal() {
    keyCreateModalOpen.value = false
  }

  function updateKeyMenuPosition() {
    const triggerEl = keyMenuTriggerEl.value
    const menuEl = keyMenuDropdownRef.value
    if (!triggerEl?.getBoundingClientRect || !menuEl?.getBoundingClientRect) return
    const rect = triggerEl.getBoundingClientRect()
    const menuRect = menuEl.getBoundingClientRect()
    const gap = 6
    let top = rect.bottom + gap
    let left = rect.right - menuRect.width
    if (top + menuRect.height > window.innerHeight - 8) {
      top = rect.top - menuRect.height - gap
    }
    if (top < 8) top = 8
    left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8))
    keyMenuStyle.value = {
      top: `${top}px`,
      left: `${left}px`,
    }
  }

  async function toggleKeyMenu(key, event) {
    event?.stopPropagation?.()
    const normalized = String(key?.id || '')
    if (!normalized) return
    if (keyMenuOpenId.value === normalized) {
      closeKeyMenu()
      return
    }
    keyMenuTriggerEl.value = event?.currentTarget || null
    keyMenuOpenKey.value = key
    keyMenuOpenId.value = normalized
    keyMenuStyle.value = { top: '-9999px', left: '0px', visibility: 'hidden' }
    await nextTick()
    updateKeyMenuPosition()
    keyMenuStyle.value = {
      ...keyMenuStyle.value,
      visibility: 'visible',
    }
  }

  function closeKeyMenu() {
    keyMenuOpenId.value = ''
    keyMenuOpenKey.value = null
    keyMenuTriggerEl.value = null
  }

  function handleKeyMenuOutsidePointer(event) {
    if (!keyMenuOpenId.value) return
    const target = event.target
    if (keyMenuTriggerEl.value?.contains(target)) return
    if (keyMenuDropdownRef.value?.contains(target)) return
    closeKeyMenu()
  }

  function handleKeyMenuViewportChange() {
    if (!keyMenuOpenId.value) return
    updateKeyMenuPosition()
  }

  function runKeyMenuAction(action, key) {
    closeKeyMenu()
    if (action === 'limits') openKeyLimitsModal(key)
    else if (action === 'info') openKeyInfoModal(key)
    else if (action === 'reset') openKeyResetModal(key)
    else if (action === 'revoke') openKeyRevokeModal(key)
  }

  function applyKeyLimitFieldsToForm() {
    accountKeyForm.dailyLimitUsd = 0
    accountKeyForm.monthlyLimitUsd = 0
    accountKeyForm.dailyLimitUnits = 0
    accountKeyForm.monthlyLimitUnits = 0

    if (keyLimitMode.value === 'usd') {
      const amount = Math.max(0, Number(keyLimitAmount.value || 0))
      if (keyLimitPeriod.value === 'daily') accountKeyForm.dailyLimitUsd = amount
      if (keyLimitPeriod.value === 'monthly') accountKeyForm.monthlyLimitUsd = amount
      return
    }

    if (keyLimitMode.value === 'count') {
      accountKeyForm.dailyLimitUnits = Math.max(0, Number(accountKeyForm.dailyLimitUnits || 0))
      accountKeyForm.monthlyLimitUnits = Math.max(0, Number(accountKeyForm.monthlyLimitUnits || 0))
    }
  }

  function selectKeyLimitMode(mode) {
    keyLimitMode.value = mode
    keyLimitPeriod.value = mode === 'usd' ? 'daily' : 'unlimited'
    keyLimitAmount.value = ''
    accountKeyForm.dailyLimitUsd = 0
    accountKeyForm.monthlyLimitUsd = 0
    accountKeyForm.dailyLimitUnits = 0
    accountKeyForm.monthlyLimitUnits = 0
  }

  function selectKeyEditLimitMode(mode) {
    keyEditLimitMode.value = mode
    if (mode === 'usd') {
      if (keyEditLimitPeriod.value === 'unlimited') keyEditLimitPeriod.value = 'daily'
    } else {
      keyEditLimitPeriod.value = 'unlimited'
      keyEditLimitAmount.value = ''
    }
    if (mode !== 'count') {
      keyEditDailyUnits.value = ''
      keyEditMonthlyUnits.value = ''
    }
    scheduleKeyEditLimitSegmentSync()
  }

  function keyHasLegacyDualLimits(key = {}) {
    const hasUsd = Number(key.dailyLimitUsd || 0) > 0 || Number(key.monthlyLimitUsd || 0) > 0
    const hasCount = Number(key.dailyLimitUnits || 0) > 0 || Number(key.monthlyLimitUnits || 0) > 0
    return hasUsd && hasCount
  }

  function buildKeyLimitsPayloadFromState(input = {}) {
    const mode = String(input.mode || 'unlimited')
    if (mode === 'usd') {
      const amount = Math.max(0, Number(input.amount || 0))
      let dailyLimitUsd = 0
      let monthlyLimitUsd = 0
      if (input.period === 'daily') dailyLimitUsd = amount
      if (input.period === 'monthly') monthlyLimitUsd = amount
      return {
        dailyLimitUsd,
        monthlyLimitUsd,
        dailyLimitUnits: 0,
        monthlyLimitUnits: 0,
      }
    }
    if (mode === 'count') {
      return {
        dailyLimitUsd: 0,
        monthlyLimitUsd: 0,
        dailyLimitUnits: Math.max(0, Number(input.dailyUnits || 0)),
        monthlyLimitUnits: Math.max(0, Number(input.monthlyUnits || 0)),
      }
    }
    return {
      dailyLimitUsd: 0,
      monthlyLimitUsd: 0,
      dailyLimitUnits: 0,
      monthlyLimitUnits: 0,
    }
  }

  function resolveKeyLimitMode(key = {}) {
    const hasUsd = Number(key.dailyLimitUsd || 0) > 0 || Number(key.monthlyLimitUsd || 0) > 0
    const hasCount = Number(key.dailyLimitUnits || 0) > 0 || Number(key.monthlyLimitUnits || 0) > 0
    if (hasUsd) return 'usd'
    if (hasCount) return 'count'
    return 'unlimited'
  }

  function readKeyLimitPeriod(key = {}) {
    if (Number(key.monthlyLimitUsd || 0) > 0) return 'monthly'
    if (Number(key.dailyLimitUsd || 0) > 0) return 'daily'
    return 'unlimited'
  }

  function readKeyLimitAmount(key = {}) {
    const monthly = Number(key.monthlyLimitUsd || 0)
    const daily = Number(key.dailyLimitUsd || 0)
    if (monthly > 0) return String(monthly)
    if (daily > 0) return String(daily)
    return ''
  }

  function selectKeyEditLimitPeriod(period) {
    keyEditLimitPeriod.value = period
    if (period === 'unlimited') keyEditLimitAmount.value = ''
    scheduleKeyEditLimitSegmentSync()
  }

  function openKeyLimitsModal(key) {
    if (!key?.id || isKeyToggleDisabled(key)) return
    closeKeyMenu()
    keyEditingKey.value = key
    keyEditLimitMode.value = resolveKeyLimitMode(key)
    keyEditLimitPeriod.value = readKeyLimitPeriod(key)
    keyEditLimitAmount.value = readKeyLimitAmount(key)
    keyEditDailyUnits.value =
      keyEditLimitMode.value === 'count' && Number(key.dailyLimitUnits || 0) > 0
        ? String(key.dailyLimitUnits)
        : ''
    keyEditMonthlyUnits.value =
      keyEditLimitMode.value === 'count' && Number(key.monthlyLimitUnits || 0) > 0
        ? String(key.monthlyLimitUnits)
        : ''
    keyEditModal.value = 'limits'
    scheduleKeyEditLimitSegmentSync()
  }

  function openKeyInfoModal(key) {
    if (!key?.id || isKeyToggleDisabled(key)) return
    closeKeyMenu()
    keyEditingKey.value = key
    keyEditForm.label = String(key.label || '')
    keyEditForm.allowedPublicModels = Array.isArray(key.allowedPublicModels)
      ? [...key.allowedPublicModels]
      : []
    keyEditForm.scopes =
      Array.isArray(key.scopes) && key.scopes.length
        ? [...key.scopes.map(String)]
        : (pricingSettings.value.apiKeys?.defaultScopes || []).map(String).filter(Boolean)
    keyEditForm.allowedIpsText = formatIpsToText(key.allowedIps)
    keyEditForm.expiresAt = String(key.expiresAt || '')
    keyEditModelSearch.value = ''
    keyEditModal.value = 'info'
  }

  function closeKeyEditModal() {
    keyEditModal.value = ''
    keyEditingKey.value = null
    keyEditForm.label = ''
    keyEditForm.allowedPublicModels = []
    keyEditForm.scopes = []
    keyEditForm.allowedIpsText = ''
    keyEditForm.expiresAt = ''
    keyEditModelSearch.value = ''
    keyEditDailyUnits.value = ''
    keyEditMonthlyUnits.value = ''
    keyEditLimitMode.value = 'unlimited'
  }

  function setKeyEditAllowAllModels(allowAll) {
    if (allowAll) {
      keyEditForm.allowedPublicModels = []
      return
    }
    if (!keyEditForm.allowedPublicModels.length && publicModelOptions.value.length) {
      keyEditForm.allowedPublicModels = [publicModelOptions.value[0].id]
    }
  }

  function isKeyEditModelSelected(modelId) {
    return keyEditForm.allowedPublicModels.includes(String(modelId || ''))
  }

  function toggleKeyEditModelSelection(modelId) {
    const normalized = String(modelId || '').trim()
    if (!normalized) return
    const current = [...keyEditForm.allowedPublicModels]
    const index = current.indexOf(normalized)
    if (index >= 0) current.splice(index, 1)
    else current.push(normalized)
    keyEditForm.allowedPublicModels = current
  }

  async function saveKeyLimits() {
    const key = keyEditingKey.value
    if (!key?.id) return
    if (keyEditLimitMode.value === 'usd') {
      const amount = Math.max(0, Number(keyEditLimitAmount.value || 0))
      if (keyEditLimitPeriod.value === 'unlimited' || amount <= 0) {
        notificationService.warning('请选择日或月并输入大于 0 的金额，或改选「不限」')
        return
      }
      warnKeyLimitAboveWalletBalance(amount)
    }
    if (keyEditLimitMode.value === 'count') {
      const message = validateKeyCountLimits(keyEditDailyUnits.value, keyEditMonthlyUnits.value)
      if (message) {
        notificationService.warning(message)
        return
      }
    }
    const limits = buildKeyLimitsPayloadFromState({
      mode: keyEditLimitMode.value,
      period: keyEditLimitPeriod.value,
      amount: keyEditLimitAmount.value,
      dailyUnits: keyEditDailyUnits.value,
      monthlyUnits: keyEditMonthlyUnits.value,
    })
    keyActionLoading.value = `limits:${key.id}`
    try {
      await updateClientApiKey(key.id, limits)
      notificationService.success('密钥限额已更新')
      closeKeyEditModal()
      await loadResources({ silent: true })
    } catch (error) {
      notificationService.error(error?.message || '密钥限额更新失败')
    } finally {
      keyActionLoading.value = ''
    }
  }

  async function saveKeyInfo() {
    const key = keyEditingKey.value
    if (!key?.id) return
    if (!String(keyEditForm.label || '').trim()) {
      notificationService.warning('请输入密钥名称')
      return
    }
    if (!keyEditAllowAllModels.value && !keyEditForm.allowedPublicModels.length) {
      notificationService.warning('请至少选择一个可调用的模型')
      return
    }
    keyActionLoading.value = `info:${key.id}`
    try {
      await updateClientApiKey(key.id, {
        label: String(keyEditForm.label || '').trim(),
        allowedPublicModels: keyEditAllowAllModels.value
          ? []
          : keyEditForm.allowedPublicModels.map(String),
        scopes:
          Array.isArray(key.scopes) && key.scopes.length
            ? key.scopes.map(String)
            : keyEditForm.scopes.map(String),
        allowedIps: parseLineList(keyEditForm.allowedIpsText),
        expiresAt: String(keyEditForm.expiresAt || '').trim(),
      })
      notificationService.success('密钥信息已更新')
      closeKeyEditModal()
      await loadResources({ silent: true })
    } catch (error) {
      notificationService.error(error?.message || '密钥信息更新失败')
    } finally {
      keyActionLoading.value = ''
    }
  }

  function formatIpsToText(ips) {
    return Array.isArray(ips) ? ips.filter(Boolean).join('\n') : ''
  }

  function toggleCreateScope(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return
    const current = [...accountKeyForm.scopes.map(String)]
    const index = current.indexOf(normalized)
    if (index >= 0) current.splice(index, 1)
    else current.push(normalized)
    accountKeyForm.scopes = current
  }

  function toggleKeyEditScope(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return
    const current = [...keyEditForm.scopes.map(String)]
    const index = current.indexOf(normalized)
    if (index >= 0) current.splice(index, 1)
    else current.push(normalized)
    keyEditForm.scopes = current
  }

  function isCreateScopeSelected(value) {
    return accountKeyForm.scopes.includes(String(value || ''))
  }

  function isKeyEditScopeSelected(value) {
    return keyEditForm.scopes.includes(String(value || ''))
  }

  function validateKeyCountLimits(daily, monthly) {
    const day = Math.max(0, Number(daily || 0))
    const month = Math.max(0, Number(monthly || 0))
    if (day <= 0 && month <= 0) return '请至少设置每日或每月次数，或改选「不限」'
    if (day > 0 && month > 0 && month < day) return '每月次数不能低于每日次数'
    return ''
  }

  function formatKeyLimitCountCell(key = {}) {
    const dayLimit = Number(key.dailyLimitUnits || 0)
    const monthLimit = Number(key.monthlyLimitUnits || 0)
    if (!dayLimit && !monthLimit) return '不限'
    const parts = []
    if (dayLimit > 0) parts.push(`${formatCompactNumber(dayLimit)} 次/日`)
    if (monthLimit > 0) parts.push(`${formatCompactNumber(monthLimit)} 次/月`)
    return parts.join(' · ')
  }

  function formatKeyLimitUnitsDisplay(key = {}) {
    return formatKeyLimitCountCell(key)
  }

  function formatKeyLimitCell(key = {}) {
    const mode = resolveKeyLimitMode(key)
    if (mode === 'usd') return formatKeyLimitUsdCell(key)
    if (mode === 'count') return formatKeyLimitUnitsDisplay(key)
    return '不限'
  }

  function formatKeyUsedCell(key = {}) {
    const mode = resolveKeyLimitMode(key)
    if (mode === 'count') {
      const monthly = Number(key.monthlyLimitUnits || 0)
      const daily = Number(key.dailyLimitUnits || 0)
      const parts = []
      if (daily > 0) parts.push(`日 ${formatCompactNumber(key.usage?.today?.count || 0)} 次`)
      if (monthly > 0) parts.push(`月 ${formatCompactNumber(key.usage?.month?.count || 0)} 次`)
      return parts.length ? parts.join(' · ') : '—'
    }
    return formatKeyUsedUsdDisplay(key)
  }

  function isWalletBilledKey(key = {}) {
    return String(key.keyKind || 'wallet') !== 'subscription'
  }

  function resolveKeyPeriodRemainingUsd(key = {}) {
    const monthly = Number(key.monthlyLimitUsd || 0)
    const daily = Number(key.dailyLimitUsd || 0)
    if (monthly > 0) {
      return Math.max(0, subtractUsd(monthly, key.usage?.month?.estimatedCostUsd))
    }
    if (daily > 0) {
      return Math.max(0, subtractUsd(daily, key.usage?.today?.estimatedCostUsd))
    }
    return null
  }

  function resolveKeyEffectiveRemainingUsd(key = {}) {
    const periodRemaining = resolveKeyPeriodRemainingUsd(key)
    if (!isWalletBilledKey(key)) return periodRemaining
    const walletAvailable = Math.max(0, Number(availableUsd.value || 0))
    if (periodRemaining === null) return walletAvailable
    return Math.min(periodRemaining, walletAvailable)
  }

  function formatKeyRemainingCell(key = {}) {
    const mode = resolveKeyLimitMode(key)
    if (mode === 'count') {
      const monthly = Number(key.monthlyLimitUnits || 0)
      const daily = Number(key.dailyLimitUnits || 0)
      const parts = []
      if (daily > 0) {
        parts.push(
          `日 ${formatCompactNumber(Math.max(0, daily - Number(key.usage?.today?.count || 0)))} 次`,
        )
      }
      if (monthly > 0) {
        parts.push(
          `月 ${formatCompactNumber(Math.max(0, monthly - Number(key.usage?.month?.count || 0)))} 次`,
        )
      }
      return parts.length ? parts.join(' · ') : '—'
    }

    const effective = resolveKeyEffectiveRemainingUsd(key)
    if (effective === null) return '—'
    return formatMoneyDisplay(effective)
  }

  function formatKeyRemainingTitle(key = {}) {
    const mode = resolveKeyLimitMode(key)
    if (mode === 'count') return '剩余可调用次数'
    if (!isWalletBilledKey(key)) return '日/月剩余预算'

    const periodRemaining = resolveKeyPeriodRemainingUsd(key)
    const walletAvailable = Math.max(0, Number(availableUsd.value || 0))
    if (periodRemaining === null) {
      return `未设日/月上限，本密钥可用额度与左侧钱包可用余额一致`
    }
    if (periodRemaining + 1e-9 >= walletAvailable) {
      return `日/月剩余 ${formatMoneyDisplay(periodRemaining)}，实际可用受左侧钱包余额限制`
    }
    return `日/月剩余 ${formatMoneyDisplay(periodRemaining)}`
  }

  function warnKeyLimitAboveWalletBalance(amountUsd) {
    const amount = Math.max(0, Number(amountUsd || 0))
    const walletAvailable = Math.max(0, Number(availableUsd.value || 0))
    if (amount <= 0 || amount <= walletAvailable + 1e-9) return false
    notificationService.warning(
      `限额 ${formatMoneyDisplay(amount)} 高于左侧可用余额 ${formatMoneyDisplay(walletAvailable)}，实际可花以钱包为准`,
    )
    return true
  }

  function formatKeyLimitUsdCell(key = {}) {
    const monthly = Number(key.monthlyLimitUsd || 0)
    const daily = Number(key.dailyLimitUsd || 0)
    if (monthly > 0) return `${formatMoneyDisplay(monthly)} / 月`
    if (daily > 0) return `${formatMoneyDisplay(daily)} / 日`
    return '不限'
  }

  function formatKeyLastUsedCell(key = {}) {
    if (!key.lastUsedAt) {
      return key.lastUsedIp ? `— · ${key.lastUsedIp}` : '尚未使用'
    }
    const time = formatKeyDateTime(key.lastUsedAt)
    return key.lastUsedIp ? `${time} · ${key.lastUsedIp}` : time
  }

  function formatKeyLastUsed(key = {}) {
    if (!key.lastUsedAt) return '尚未使用'
    return formatKeyDateTime(key.lastUsedAt)
  }

  function formatKeyScopesSummary(key = {}) {
    const scopes = Array.isArray(key.scopes) ? key.scopes : []
    if (!scopes.length) return '平台默认'
    return scopes.map((item) => scopeLabel(item)).join('、')
  }

  function formatKeyLimitUsdDisplay(key = {}) {
    const monthly = Number(key.monthlyLimitUsd || 0)
    const daily = Number(key.dailyLimitUsd || 0)
    if (monthly > 0) return formatMoneyDisplay(monthly)
    if (daily > 0) return formatMoneyDisplay(daily)
    return '不限'
  }

  function formatKeyLimitPeriodDisplay(key = {}) {
    const monthly = Number(key.monthlyLimitUsd || 0)
    const daily = Number(key.dailyLimitUsd || 0)
    if (monthly > 0) return '每月'
    if (daily > 0) return '每日'
    return ''
  }

  function formatKeyUsedUsdDisplay(key = {}) {
    const monthly = Number(key.monthlyLimitUsd || 0)
    const daily = Number(key.dailyLimitUsd || 0)
    if (monthly > 0) return formatMoneyDisplay(key.usage?.month?.estimatedCostUsd)
    if (daily > 0) return formatMoneyDisplay(key.usage?.today?.estimatedCostUsd)
    return formatMoneyDisplay(
      key.usage?.month?.estimatedCostUsd ?? key.usage?.total?.estimatedCostUsd,
    )
  }

  function formatKeyBalanceUsdDisplay(key = {}) {
    const monthly = Number(key.monthlyLimitUsd || 0)
    const daily = Number(key.dailyLimitUsd || 0)
    if (monthly > 0) {
      return formatMoneyDisplay(subtractUsd(monthly, key.usage?.month?.estimatedCostUsd))
    }
    if (daily > 0) {
      return formatMoneyDisplay(subtractUsd(daily, key.usage?.today?.estimatedCostUsd))
    }
    return '—'
  }

  function formatKeyModelsCell(key = {}) {
    const summary = formatKeyModelsSummary(key.allowedPublicModels)
    return summary.mode === 'all' ? '全部' : summary.text
  }

  function formatKeyDateTime(value) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    const m = date.getMonth() + 1
    const d = date.getDate()
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `${m}/${d} ${h}:${min}`
  }

  function isKeyToggleDisabled(key = {}) {
    const status = String(key.status || 'active')
    return ['revoked', 'expired'].includes(status)
  }

  function focusKeyCreateForm() {
    openKeyCreateModal()
  }

  function applyKeyNamePreset(name) {
    accountKeyForm.label = String(name || '')
    focusKeyCreateForm()
  }

  function dismissNewSecret() {
    accountNewSecret.value = ''
    accountNewSecretKeyId.value = ''
  }

  function handleKeyLabelKeydown(event) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    createPlatformKey()
  }

  function isKeyExpiringSoon(value) {
    if (!value) return false
    const expires = new Date(value).getTime()
    if (Number.isNaN(expires)) return false
    const days = (expires - Date.now()) / (1000 * 60 * 60 * 24)
    return days >= 0 && days <= 7
  }

  function resetKeyAdvancedSettings() {
    const settings = pricingSettings.value.apiKeys || {}
    setKeyAllowAllModels(true)
    accountKeyForm.allowedPublicModels = []
    accountKeyForm.allowedIpsText = ''
    accountKeyForm.expiresAt = ''
    accountKeyForm.dailyLimitUnits = Number(settings.defaultDailyLimitUnits || 0)
    accountKeyForm.monthlyLimitUnits = Number(settings.defaultMonthlyLimitUnits || 0)
    accountKeyForm.dailyLimitUsd = Number(settings.defaultDailyLimitUsd || 0)
    accountKeyForm.monthlyLimitUsd = Number(settings.defaultMonthlyLimitUsd || 0)
    accountKeyForm.scopes = Array.isArray(settings.defaultScopes)
      ? settings.defaultScopes.map(String).filter(Boolean)
      : []
    keyModelSearch.value = ''
  }

  function applyKeyLimitsPreset(presetId) {
    if (presetId === 'personal') {
      selectKeyLimitMode('count')
      accountKeyForm.dailyLimitUnits = 0
      accountKeyForm.monthlyLimitUnits = 5000
      return
    }
    if (presetId === 'share') {
      selectKeyLimitMode('usd')
      keyLimitPeriod.value = 'monthly'
      keyLimitAmount.value = '20'
      accountKeyForm.monthlyLimitUsd = 20
      return
    }
    selectKeyLimitMode('unlimited')
  }

  function selectAllScopes() {
    accountKeyForm.scopes = scopeOptions.value.map((item) => item.value)
  }

  function clearAllScopes() {
    accountKeyForm.scopes = []
  }

  function restoreDefaultScopes() {
    const settings = pricingSettings.value.apiKeys || {}
    accountKeyForm.scopes = Array.isArray(settings.defaultScopes)
      ? settings.defaultScopes.map(String).filter(Boolean)
      : []
  }

  return {
    apiKeyStatusLabel,
    apiKeyKindLabel,
    isSubscriptionApiKey,
    revealSubscriptionApiKeySecret,
    handleSubscriptionActivated,
    scopeLabel,
    setKeyAllowAllModels,
    toggleKeyModelSelection,
    isKeyModelSelected,
    resolvePublicModelLabel,
    formatUsageModelLabel,
    formatKeyModelsSummary,
    resetKeyFormState,
    selectAllKeyModels,
    clearKeyModels,
    openKeyCreateModal,
    closeKeyCreateModal,
    updateKeyMenuPosition,
    toggleKeyMenu,
    closeKeyMenu,
    handleKeyMenuOutsidePointer,
    handleKeyMenuViewportChange,
    runKeyMenuAction,
    applyKeyLimitFieldsToForm,
    selectKeyLimitMode,
    selectKeyEditLimitMode,
    keyHasLegacyDualLimits,
    buildKeyLimitsPayloadFromState,
    resolveKeyLimitMode,
    readKeyLimitPeriod,
    readKeyLimitAmount,
    selectKeyEditLimitPeriod,
    openKeyLimitsModal,
    openKeyInfoModal,
    closeKeyEditModal,
    setKeyEditAllowAllModels,
    isKeyEditModelSelected,
    toggleKeyEditModelSelection,
    saveKeyLimits,
    saveKeyInfo,
    formatIpsToText,
    toggleCreateScope,
    toggleKeyEditScope,
    isCreateScopeSelected,
    isKeyEditScopeSelected,
    validateKeyCountLimits,
    formatKeyLimitCountCell,
    formatKeyLimitUnitsDisplay,
    formatKeyLimitCell,
    formatKeyUsedCell,
    isWalletBilledKey,
    resolveKeyPeriodRemainingUsd,
    resolveKeyEffectiveRemainingUsd,
    formatKeyRemainingCell,
    formatKeyRemainingTitle,
    warnKeyLimitAboveWalletBalance,
    formatKeyLimitUsdCell,
    formatKeyLastUsedCell,
    formatKeyLastUsed,
    formatKeyScopesSummary,
    formatKeyLimitUsdDisplay,
    formatKeyLimitPeriodDisplay,
    formatKeyUsedUsdDisplay,
    formatKeyBalanceUsdDisplay,
    formatKeyModelsCell,
    formatKeyDateTime,
    isKeyToggleDisabled,
    focusKeyCreateForm,
    applyKeyNamePreset,
    dismissNewSecret,
    handleKeyLabelKeydown,
    isKeyExpiringSoon,
    resetKeyAdvancedSettings,
    applyKeyLimitsPreset,
    selectAllScopes,
    clearAllScopes,
    restoreDefaultScopes,
  }
}
