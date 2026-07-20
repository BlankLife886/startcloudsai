export function createPricingComputedState(dependencies) {
  const visibleNavItems = dependencies.computed(() => dependencies.PRICING_NAV_ITEMS)
  const mobileNavItems = dependencies.computed(() =>
    dependencies.filterMobileNavItems(visibleNavItems.value),
  )
  const sidebarNavGroups = dependencies.computed(() =>
    dependencies.buildSidebarNavGroups(dependencies.PRICING_NAV_GROUPS, visibleNavItems.value),
  )
  const sidebarFooterLinks = dependencies.computed(() => dependencies.PRICING_SIDEBAR_FOOTER_LINKS)
  const internalNavItems = dependencies.computed(() =>
    visibleNavItems.value.filter((item) => !item.href),
  )
  const navGroups = dependencies.computed(() => sidebarNavGroups.value)
  const activeNavItem = dependencies.computed(() =>
    dependencies.getPricingNavItem(dependencies.activeSection.value).id
      ? dependencies.getPricingNavItem(dependencies.activeSection.value)
      : visibleNavItems.value[0] || { id: '', label: '', icon: 'bi-circle' },
  )
  const sectionTitle = dependencies.computed(
    () =>
      dependencies.getPricingSection(dependencies.activeSection.value).title ||
      activeNavItem.value.label ||
      '',
  )
  const sectionSubtitle = dependencies.computed(
    () => dependencies.getPricingSection(dependencies.activeSection.value).subtitle || '',
  )

  const account = dependencies.computed(
    () =>
      dependencies.resourceSummary.value.wallet || dependencies.resourceSummary.value.account || {},
  )
  const usage = dependencies.computed(
    () =>
      dependencies.resourceSummary.value.usage || dependencies.createEmptyResourceSummary().usage,
  )
  const credits = dependencies.computed(
    () => dependencies.resourceSummary.value.credits || { account: {}, ledger: [] },
  )
  const usdLedger = dependencies.computed(
    () => dependencies.resourceSummary.value.usd || { ledger: [] },
  )
  const billing = dependencies.computed(
    () => dependencies.resourceSummary.value.billing || { mode: 'payg' },
  )
  const apiKeys = dependencies.computed(() =>
    Array.isArray(dependencies.resourceSummary.value.apiKeys)
      ? dependencies.resourceSummary.value.apiKeys
      : [],
  )
  const activeApiKeyCount = dependencies.computed(
    () => apiKeys.value.filter((item) => String(item.status || 'active') === 'active').length,
  )
  const activeWalletKeyCount = dependencies.computed(
    () =>
      apiKeys.value.filter(
        (item) =>
          String(item.status || 'active') === 'active' &&
          String(item.keyKind || 'wallet') !== 'subscription',
      ).length,
  )
  const walletKeyLimit = dependencies.computed(() =>
    Number(dependencies.resourceSummary.value?.billing?.apiKeyLimits?.wallet || 10),
  )
  const canCreateWalletKey = dependencies.computed(
    () => activeWalletKeyCount.value < walletKeyLimit.value,
  )
  const sidebarNavBadges = dependencies.computed(() => ({
    keys: activeWalletKeyCount.value > 0 ? activeWalletKeyCount.value : '',
  }))
  const walletApiKeys = dependencies.computed(() =>
    apiKeys.value.filter((item) => String(item.keyKind || 'wallet') !== 'subscription'),
  )
  const filteredApiKeys = dependencies.computed(() => {
    const rank = (status) => {
      if (status === 'active') return 0
      if (status === 'paused') return 1
      if (status === 'expired') return 2
      if (status === 'revoked') return 3
      return 4
    }
    return [...walletApiKeys.value].sort((a, b) => {
      const statusDiff = rank(String(a.status || 'active')) - rank(String(b.status || 'active'))
      if (statusDiff !== 0) return statusDiff
      const aUsed = new Date(a.lastUsedAt || 0).getTime()
      const bUsed = new Date(b.lastUsedAt || 0).getTime()
      if (bUsed !== aUsed) return bUsed - aUsed
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    })
  })
  const selectedScopeCount = dependencies.computed(() =>
    Array.isArray(dependencies.accountKeyForm.scopes)
      ? dependencies.accountKeyForm.scopes.length
      : 0,
  )
  const keyIpLineCount = dependencies.computed(
    () => dependencies.parseLineList(dependencies.accountKeyForm.allowedIpsText).length,
  )
  const keyLimitsSummary = dependencies.computed(() => {
    if (dependencies.keyLimitMode.value === 'usd') {
      const budget = dependencies.formatUsdLimitPair(
        dependencies.accountKeyForm.dailyLimitUsd,
        dependencies.accountKeyForm.monthlyLimitUsd,
      )
      return budget === '不限' ? '日/月不限额' : budget
    }
    if (dependencies.keyLimitMode.value === 'count') {
      const units = dependencies.formatLimitPair(
        dependencies.accountKeyForm.dailyLimitUnits,
        dependencies.accountKeyForm.monthlyLimitUnits,
        ' 次',
      )
      return units === '不限' ? '次数不限' : units
    }
    return '不限额'
  })
  const keyAdvancedSummary = dependencies.computed(() => {
    const parts = [
      keyAllowAllModels.value ? '全部公开模型' : `限定 ${selectedKeyModelCount.value} 个模型`,
      selectedScopeCount.value ? `${selectedScopeCount.value} 项接口权限` : '平台默认接口权限',
      keyLimitsSummary.value.replace('调用 ', '').replace(' · 预算 ', ' · '),
    ]
    if (keyIpLineCount.value) parts.push(`${keyIpLineCount.value} 个 IP`)
    if (dependencies.accountKeyForm.expiresAt) parts.push('设有过期时间')
    return parts.join(' · ')
  })
  const selectedKeyModelLabels = dependencies.computed(() =>
    (Array.isArray(dependencies.accountKeyForm.allowedPublicModels)
      ? dependencies.accountKeyForm.allowedPublicModels
      : []
    )
      .map((id) => dependencies.resolvePublicModelLabel(id))
      .filter(Boolean),
  )
  const usageKeyKindLookup = dependencies.computed(() =>
    dependencies.buildKeyKindLookup(apiKeys.value),
  )
  const usageLogs = dependencies.computed(() =>
    dependencies.filterApiGatewayUsageLogs(
      (Array.isArray(usage.value.logs) ? usage.value.logs : []).map((row) =>
        dependencies.normalizeUsageLog(row, usageKeyKindLookup.value),
      ),
    ),
  )
  const keyKindUsageCards = dependencies.computed(() =>
    dependencies.buildKeyKindUsageCards(
      dependencies.buildKeyKindBreakdown({
        usageSummary: usage.value,
        period: 'month',
        logs: usageLogs.value,
        apiKeys: apiKeys.value,
        lookup: usageKeyKindLookup.value,
      }),
    ),
  )
  const usageStatsCards = dependencies.computed(() =>
    dependencies.buildUsageStatsCards(usage.value, usageLogs.value),
  )
  const usageTokenTotals24h = dependencies.computed(() =>
    dependencies.buildUsageTokenTotals24h(usageLogs.value),
  )
  const creditLedgerRows = dependencies.computed(() =>
    (Array.isArray(credits.value.ledger) ? credits.value.ledger : []).map(
      dependencies.normalizeLedgerRow,
    ),
  )
  const usdLedgerRows = dependencies.computed(() =>
    (Array.isArray(usdLedger.value.ledger) ? usdLedger.value.ledger : []).map(
      dependencies.normalizeLedgerRow,
    ),
  )
  const walletLedgerRows = dependencies.computed(() =>
    dependencies.filterWalletLedgerRows(usdLedgerRows.value),
  )

  const commercePlans = dependencies.computed(() => dependencies.planOverview.value?.plans || [])
  const walletRechargeCatalog = dependencies.computed(
    () => dependencies.planOverview.value?.walletRechargePlans || [],
  )
  const currentPlan = dependencies.computed(() => dependencies.planOverview.value?.current || null)
  const commerceOrders = dependencies.computed(() => dependencies.planOverview.value?.orders || [])
  const walletRechargeOrders = dependencies.computed(() => {
    if (Array.isArray(dependencies.planOverview.value?.walletOrders))
      return dependencies.planOverview.value.walletOrders
    return commerceOrders.value.filter((order) => dependencies.isWalletTopupCommerceOrder(order))
  })
  const subscriptionCommerceOrders = dependencies.computed(() => {
    if (Array.isArray(dependencies.planOverview.value?.subscriptionOrders))
      return dependencies.planOverview.value.subscriptionOrders
    return commerceOrders.value.filter((order) =>
      dependencies.isSubscriptionCommerceOrder(order, commercePlans.value),
    )
  })
  const walletOpenRechargeOrders = dependencies.computed(() =>
    walletRechargeOrders.value.filter(
      (order) => !dependencies.buildWalletRechargeOrderDisplay(order).isSettled,
    ),
  )
  const subscriptionOrderRows = dependencies.computed(() =>
    dependencies.sortCommerceOrdersByCreatedAt(subscriptionCommerceOrders.value).map((order) => ({
      order,
      display: dependencies.buildSubscriptionOrderDisplay(order, commercePlans.value),
    })),
  )
  const walletRechargeOrderRows = dependencies.computed(() =>
    dependencies.sortCommerceOrdersByCreatedAt(walletOpenRechargeOrders.value).map((order) => ({
      order,
      display: dependencies.buildWalletRechargeOrderDisplay(order),
    })),
  )
  const walletHistoryTimeline = dependencies.computed(() =>
    dependencies.buildWalletHistoryTimeline({
      openRechargeRows: walletRechargeOrderRows.value,
      ledgerRows: walletLedgerRows.value,
    }),
  )
  const publicModels = dependencies.computed(() => {
    if (dependencies.pricingPublicModels.value.length) return dependencies.pricingPublicModels.value
    return dependencies.runtimeConfigStore.getAiModelCatalog()?.publicModels || []
  })
  const pricedModels = dependencies.computed(() =>
    publicModels.value
      .filter((model) => {
        if (model?.status === 'draft') return false
        const key = String(model?.publicModelKey || model?.id || '').trim()
        return !dependencies.isStudioPublicModelKey(key)
      })
      .map((model) => {
        const billingModeRaw = String(model?.billingMode || 'request')
        const tokenPricing = dependencies.readPublicModelTokenPricing(model)
        const providerKeys = Array.isArray(model?.providerKeys)
          ? model.providerKeys.map(String).filter(Boolean)
          : []
        return {
          raw: model,
          id: dependencies.publicModelId(model),
          displayId: dependencies.publicModelApiId(model),
          label: model?.label || model?.publicModelKey || model?.id || '公开模型',
          description: String(model?.description || '').trim(),
          billingModeRaw,
          billingMode: dependencies.formatBillingMode(billingModeRaw),
          inputPrice: tokenPricing.input,
          outputPrice: tokenPricing.output,
          cachedInputPrice: tokenPricing.cachedInput,
          cardPriceLines: dependencies.buildModelCardPriceLines(
            billingModeRaw,
            tokenPricing,
            model,
          ),
          unitPrice: billingModeRaw === 'token' ? 0 : Number(model?.userPriceUsd || 0),
          creditCost: Number(model?.creditCost || 0),
          capabilities: Array.isArray(model?.capabilities) ? model.capabilities : [],
          providerKeys,
          providerLabel: providerKeys.join(' · ') || '—',
          routeCount: Number(model?.routeCount || 0),
          upstreamModelIds: Array.isArray(model?.upstreamModelIds)
            ? model.upstreamModelIds.map(String).filter(Boolean)
            : [],
          visibility: String(model?.visibility || 'public'),
          discountLabel: dependencies.readModelDiscountLabel(model),
          marketLine: dependencies.buildModelMarketLine(model),
          iconUrl: dependencies.readPublicModelIconUrl(model),
          availabilityRows: dependencies.splitAvailabilityRows(
            Array.isArray(model?.availabilitySegments) && model.availabilitySegments.length
              ? model.availabilitySegments.map(String)
              : dependencies.buildIdleAvailabilitySegments(),
          ),
          availabilityPercent:
            model?.availabilityPercent === null || model?.availabilityPercent === undefined
              ? null
              : Number(model.availabilityPercent),
          availabilitySource: String(model?.availabilitySource || 'none'),
          operational: model?.operational === true,
          successCount24h: Number(model?.successCount24h || 0),
          failedCount24h: Number(model?.failedCount24h || 0),
        }
      }),
  )
  const publicModelOptions = dependencies.computed(() =>
    pricedModels.value.map((model) => ({
      id: model.id,
      label: model.label,
      displayId: model.displayId,
    })),
  )
  const publicModelLabelLookup = dependencies.computed(() =>
    dependencies.buildPublicModelLabelLookup(publicModels.value),
  )
  const keyAllowAllModels = dependencies.computed(
    () =>
      !Array.isArray(dependencies.accountKeyForm.allowedPublicModels) ||
      !dependencies.accountKeyForm.allowedPublicModels.length,
  )
  const filteredKeyModelOptions = dependencies.computed(() => {
    const keyword = String(dependencies.keyModelSearch.value || '')
      .trim()
      .toLowerCase()
    if (!keyword) return publicModelOptions.value
    return publicModelOptions.value.filter(
      (model) =>
        String(model.label || '')
          .toLowerCase()
          .includes(keyword) ||
        String(model.displayId || '')
          .toLowerCase()
          .includes(keyword),
    )
  })
  const keyEditAllowAllModels = dependencies.computed(
    () =>
      !Array.isArray(dependencies.keyEditForm.allowedPublicModels) ||
      !dependencies.keyEditForm.allowedPublicModels.length,
  )
  const filteredKeyEditModelOptions = dependencies.computed(() => {
    const keyword = String(dependencies.keyEditModelSearch.value || '')
      .trim()
      .toLowerCase()
    if (!keyword) return publicModelOptions.value
    return publicModelOptions.value.filter(
      (model) =>
        String(model.label || '')
          .toLowerCase()
          .includes(keyword) ||
        String(model.displayId || '')
          .toLowerCase()
          .includes(keyword),
    )
  })
  const keyEditBlockedReason = dependencies.computed(() => {
    if (!dependencies.keyEditModal.value || dependencies.keyEditModal.value === 'limits') return ''
    if (!String(dependencies.keyEditForm.label || '').trim()) return '请输入密钥名称'
    if (!keyEditAllowAllModels.value && !dependencies.keyEditForm.allowedPublicModels.length) {
      return '请至少选择一个模型，或切换回「全部模型」'
    }
    return ''
  })
  const KEY_LIMIT_PERIOD_OPTIONS = [
    { id: 'unlimited', label: '不限' },
    { id: 'daily', label: '每日' },
    { id: 'monthly', label: '每月' },
  ]
  const keyEditLimitsDraft = dependencies.computed(() =>
    dependencies.buildKeyLimitsPayloadFromState({
      mode: dependencies.keyEditLimitMode.value,
      period: dependencies.keyEditLimitPeriod.value,
      amount: dependencies.keyEditLimitAmount.value,
      dailyUnits: dependencies.keyEditDailyUnits.value,
      monthlyUnits: dependencies.keyEditMonthlyUnits.value,
    }),
  )
  const keyEditLimitsPreviewLines = dependencies.computed(() => ({
    summary: dependencies.formatKeyLimitCell(keyEditLimitsDraft.value),
  }))
  const keyEditingKeyMeta = dependencies.computed(() => {
    const key = dependencies.keyEditingKey.value
    if (!key) return ''
    return key.keyPrefix ? `${key.keyPrefix}••••` : ''
  })
  const selectedKeyModelCount = dependencies.computed(() =>
    Array.isArray(dependencies.accountKeyForm.allowedPublicModels)
      ? dependencies.accountKeyForm.allowedPublicModels.length
      : 0,
  )
  const selectedKeyEditModelCount = dependencies.computed(() =>
    Array.isArray(dependencies.keyEditForm.allowedPublicModels)
      ? dependencies.keyEditForm.allowedPublicModels.length
      : 0,
  )
  const scopeLabelMap = dependencies.computed(() => {
    const map = new Map()
    scopeOptions.value.forEach((item) => map.set(item.value, item.label))
    return map
  })
  const modelCapabilityOptions = dependencies.computed(() => {
    const options = new Set()
    pricedModels.value.forEach((model) => {
      model.capabilities.forEach((capability) => {
        const value = String(capability || '').trim()
        if (value) options.add(value)
      })
    })
    return Array.from(options)
  })
  const modelBillingOptions = dependencies.computed(() => {
    const options = new Map()
    pricedModels.value.forEach((model) => {
      if (!options.has(model.billingModeRaw)) {
        options.set(model.billingModeRaw, model.billingMode)
      }
    })
    return Array.from(options.entries()).map(([value, label]) => ({ value, label }))
  })
  const modelProviderOptions = dependencies.computed(() => {
    const options = new Set()
    pricedModels.value.forEach((model) => {
      model.providerKeys.forEach((provider) => options.add(provider))
    })
    return Array.from(options)
  })
  const hasActiveModelFilters = dependencies.computed(
    () =>
      Boolean(dependencies.modelSearch.value.trim()) ||
      dependencies.modelCapabilityFilter.value !== 'all' ||
      dependencies.modelBillingFilter.value !== 'all' ||
      dependencies.modelProviderFilter.value !== 'all',
  )
  const filteredPricedModels = dependencies.computed(() =>
    pricedModels.value.filter((model) => {
      const query = dependencies.modelSearch.value.trim().toLowerCase()
      if (query) {
        const haystack =
          `${model.label} ${model.description} ${model.displayId} ${model.id} ${model.providerLabel} ${model.upstreamModelIds.join(' ')} ${model.capabilities.join(' ')}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (
        dependencies.modelCapabilityFilter.value !== 'all' &&
        !model.capabilities.map(String).includes(dependencies.modelCapabilityFilter.value)
      )
        return false
      if (
        dependencies.modelBillingFilter.value !== 'all' &&
        model.billingModeRaw !== dependencies.modelBillingFilter.value
      )
        return false
      if (
        dependencies.modelProviderFilter.value !== 'all' &&
        !model.providerKeys.includes(dependencies.modelProviderFilter.value)
      )
        return false
      return true
    }),
  )
  const recentUsageRows = dependencies.computed(() => usageLogs.value.slice(0, 5))
  const activeSubscriptionKeyCount = dependencies.computed(
    () =>
      apiKeys.value.filter(
        (item) =>
          String(item.status || 'active') === 'active' &&
          String(item.keyKind || 'wallet') === 'subscription',
      ).length,
  )
  const overviewDashboard = dependencies.computed(() =>
    dependencies.buildOverviewDashboard({
      usage: usage.value,
      usageLogs: usageLogs.value,
      apiKeys: apiKeys.value,
      keyKindLookup: usageKeyKindLookup.value,
      activeApiKeyCount: activeApiKeyCount.value,
      activeSubscriptionKeyCount: activeSubscriptionKeyCount.value,
      activeWalletKeyCount: activeWalletKeyCount.value,
      currentPlanLabel: dependencies.currentPlanLabel.value,
      planUnsubscribed: dependencies.isPlanUnsubscribed.value,
      subscriptionPeriodHint: dependencies.subscriptionPeriodHint.value,
      balanceDisplay: dependencies.formatMoneyDisplay(dependencies.availableUsd.value),
      availableUsd: dependencies.availableUsd.value,
      wallpaperCredits: dependencies.wallpaperCredits.value,
      trendRange: dependencies.overviewTrendRange.value,
      insightsRange: dependencies.overviewInsightsRange.value,
      publicModels: publicModels.value,
      showSubscriptionPanel:
        dependencies.authStore.isAuthenticated && dependencies.subscriptionPeriod.value.isActive,
      showSubscriptionCtaPanel: dependencies.authStore.isAuthenticated,
    }),
  )
  const overviewNumbersEnabled = dependencies.computed(
    () =>
      dependencies.activeSection.value === 'overview' &&
      !dependencies.sectionSwitchPending.value &&
      !dependencies.consoleBooting.value,
  )
  const sidenavNumbersEnabled = dependencies.computed(() => !dependencies.consoleBooting.value)
  const sectionNumbersEnabled = dependencies.computed(
    () => !dependencies.consoleBooting.value && !dependencies.sectionSwitchPending.value,
  )
  const overviewCacheGauge = dependencies.computed(() => {
    const rate = Number(overviewDashboard.value.cacheRate || 0)
    const radius = 48
    const circumference = 2 * Math.PI * radius
    return {
      rate,
      dash: (Math.max(0, Math.min(rate, 100)) / 100) * circumference,
      circumference,
      missRate: Math.max(0, 100 - rate),
    }
  })
  const overviewTrendHoverPoint = dependencies.computed(() => {
    const points = overviewDashboard.value.trendChart?.points || []
    const index = dependencies.overviewTrendHoverIndex.value
    if (index < 0 || !points[index]) return null
    return points[index]
  })
  const overviewTrendTooltipStyle = dependencies.computed(() => {
    const point = overviewTrendHoverPoint.value
    const chart = overviewDashboard.value.trendChart
    if (!point || !chart?.width) return {}
    const left = `${(point.x / chart.width) * 100}%`
    const top = `${(point.y / chart.height) * 100}%`
    return { left, top }
  })
  const scopeOptions = dependencies.computed(() => {
    const configured = dependencies.pricingSettings.value.apiKeys?.scopeOptions
    if (Array.isArray(configured) && configured.length) {
      return configured
        .map((item) => {
          const value = String(item?.value || item?.id || item || '').trim()
          if (!value) return null
          return {
            value,
            label: String(item?.label || value),
            hint: String(item?.hint || '').trim() || undefined,
          }
        })
        .filter(Boolean)
    }
    const defaults = Array.isArray(dependencies.pricingSettings.value.apiKeys?.defaultScopes)
      ? dependencies.pricingSettings.value.apiKeys.defaultScopes
      : []
    return defaults.map((value) => ({ value: String(value), label: String(value) }))
  })
  const usageModelOptions = dependencies.computed(() => {
    const options = new Map()
    usageLogs.value.forEach((item) => {
      const key = String(item.resourceKey || item.providerKey || '').trim()
      if (!key || options.has(key)) return
      options.set(
        key,
        dependencies.formatUsageModelLabel({ resourceKey: key, providerKey: item.providerKey }),
      )
    })
    return Array.from(options.entries()).map(([value, label]) => ({ value, label }))
  })
  const filteredUsageLogs = dependencies.computed(() =>
    usageLogs.value.filter((item) => {
      if (dependencies.usageKeyKindFilter.value !== 'all') {
        const kind = String(item.keyKind || 'wallet')
        if (kind !== dependencies.usageKeyKindFilter.value) return false
      }
      if (dependencies.usageModelFilter.value !== 'all') {
        const model = item.resourceKey || item.providerKey
        if (model !== dependencies.usageModelFilter.value) return false
      }
      if (dependencies.usageStatusFilter.value !== 'all') {
        const code = Number(item.httpStatus || 0)
        if (dependencies.usageStatusFilter.value === '2xx' && (code < 200 || code >= 300))
          return false
        if (dependencies.usageStatusFilter.value === '4xx' && (code < 400 || code >= 500))
          return false
        if (dependencies.usageStatusFilter.value === '5xx' && (code < 500 || code >= 600))
          return false
      }
      return true
    }),
  )
  const displayedUsageLogs = dependencies.computed(() => filteredUsageLogs.value.slice(0, 20))

  return {
    visibleNavItems,
    mobileNavItems,
    sidebarNavGroups,
    sidebarFooterLinks,
    internalNavItems,
    navGroups,
    activeNavItem,
    sectionTitle,
    sectionSubtitle,
    account,
    usage,
    credits,
    usdLedger,
    billing,
    apiKeys,
    activeApiKeyCount,
    activeWalletKeyCount,
    walletKeyLimit,
    canCreateWalletKey,
    sidebarNavBadges,
    walletApiKeys,
    filteredApiKeys,
    selectedScopeCount,
    keyIpLineCount,
    keyLimitsSummary,
    keyAdvancedSummary,
    selectedKeyModelLabels,
    usageKeyKindLookup,
    usageLogs,
    keyKindUsageCards,
    usageStatsCards,
    usageTokenTotals24h,
    creditLedgerRows,
    usdLedgerRows,
    walletLedgerRows,
    commercePlans,
    walletRechargeCatalog,
    currentPlan,
    commerceOrders,
    walletRechargeOrders,
    subscriptionCommerceOrders,
    walletOpenRechargeOrders,
    subscriptionOrderRows,
    walletRechargeOrderRows,
    walletHistoryTimeline,
    publicModels,
    pricedModels,
    publicModelOptions,
    publicModelLabelLookup,
    keyAllowAllModels,
    filteredKeyModelOptions,
    keyEditAllowAllModels,
    filteredKeyEditModelOptions,
    keyEditBlockedReason,
    KEY_LIMIT_PERIOD_OPTIONS,
    keyEditLimitsDraft,
    keyEditLimitsPreviewLines,
    keyEditingKeyMeta,
    selectedKeyModelCount,
    selectedKeyEditModelCount,
    scopeLabelMap,
    modelCapabilityOptions,
    modelBillingOptions,
    modelProviderOptions,
    hasActiveModelFilters,
    filteredPricedModels,
    recentUsageRows,
    activeSubscriptionKeyCount,
    overviewDashboard,
    overviewNumbersEnabled,
    sidenavNumbersEnabled,
    sectionNumbersEnabled,
    overviewCacheGauge,
    overviewTrendHoverPoint,
    overviewTrendTooltipStyle,
    scopeOptions,
    usageModelOptions,
    filteredUsageLogs,
    displayedUsageLogs,
  }
}
