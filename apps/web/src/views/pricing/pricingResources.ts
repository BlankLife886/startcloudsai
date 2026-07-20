export function createEmptyResourceSummary() {
  const emptyWallet = {
    balance: 0,
    frozenBalance: 0,
    availableBalance: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
  }
  return {
    wallet: { ...emptyWallet },
    account: { ...emptyWallet },
    credits: {
      account: { ...emptyWallet },
      ledger: [],
    },
    usd: { ledger: [] },
    billing: { mode: 'payg', apiKeyLimit: null, apiKeyLimits: { subscription: 0, wallet: 10 } },
    usage: {
      today: { units: 0, estimatedCostUsd: 0, count: 0 },
      week: { units: 0, estimatedCostUsd: 0, count: 0 },
      month: { units: 0, estimatedCostUsd: 0, count: 0 },
      total: { units: 0, estimatedCostUsd: 0, count: 0 },
      logs: [],
      byKeyKind: {
        today: {
          subscription: { units: 0, estimatedCostUsd: 0, count: 0 },
          wallet: { units: 0, estimatedCostUsd: 0, count: 0 },
        },
        week: {
          subscription: { units: 0, estimatedCostUsd: 0, count: 0 },
          wallet: { units: 0, estimatedCostUsd: 0, count: 0 },
        },
        month: {
          subscription: { units: 0, estimatedCostUsd: 0, count: 0 },
          wallet: { units: 0, estimatedCostUsd: 0, count: 0 },
        },
      },
    },
    apiKeys: [],
  }
}

export function createPricingResources(dependencies) {
  function setWalletTabButtonRef(tab, el) {
    if (el) {
      dependencies.walletTabButtonRefs.set(tab, el)
      if (tab === dependencies.walletPanelTab.value) scheduleWalletTabIndicatorSync()
    } else {
      dependencies.walletTabButtonRefs.delete(tab)
    }
  }

  function scheduleWalletTabIndicatorSync() {
    void dependencies.nextTick(() => {
      requestAnimationFrame(() => {
        syncWalletTabIndicator()
      })
    })
  }

  function syncWalletTabIndicator() {
    const btn = dependencies.walletTabButtonRefs.get(dependencies.walletPanelTab.value)
    const container = dependencies.walletTabsRef.value
    if (!btn || !container) {
      dependencies.walletTabIndicatorReady.value = false
      dependencies.walletTabIndicatorStyle.value = {
        opacity: '0',
        width: '0px',
        transform: 'translateX(0px)',
      }
      return
    }
    dependencies.walletTabIndicatorReady.value = true
    dependencies.walletTabIndicatorStyle.value = {
      opacity: '1',
      width: `${btn.offsetWidth}px`,
      transform: `translateX(${btn.offsetLeft}px)`,
    }
  }

  function selectWalletPanelTab(tab) {
    dependencies.walletPanelTab.value = tab
  }

  dependencies.watch(dependencies.walletPanelTab, () => {
    scheduleWalletTabIndicatorSync()
  })

  dependencies.watch(dependencies.activeSection, (section) => {
    if (section !== 'wallet') {
      dependencies.walletTabIndicatorReady.value = false
      return
    }
    scheduleWalletTabIndicatorSync()
  })

  dependencies.watch(dependencies.planConsoleTab, () => {
    schedulePlanTabIndicatorSync()
  })

  dependencies.watch(dependencies.visiblePlanConsoleTabs, () => {
    schedulePlanTabIndicatorSync()
  })

  dependencies.watch(dependencies.activeSection, (section) => {
    if (section !== 'plans') {
      dependencies.planTabIndicatorReady.value = false
      return
    }
    schedulePlanTabIndicatorSync()
  })

  function setPlanTabButtonRef(tab, el) {
    if (el) {
      dependencies.planTabButtonRefs.set(tab, el)
      if (tab === dependencies.planConsoleTab.value) schedulePlanTabIndicatorSync()
    } else {
      dependencies.planTabButtonRefs.delete(tab)
    }
  }

  function schedulePlanTabIndicatorSync() {
    void dependencies.nextTick(() => {
      requestAnimationFrame(() => {
        syncPlanTabIndicator()
      })
    })
  }

  function syncPlanTabIndicator() {
    const btn = dependencies.planTabButtonRefs.get(dependencies.planConsoleTab.value)
    const container = dependencies.planTabsRef.value
    if (!btn || !container) {
      dependencies.planTabIndicatorReady.value = false
      dependencies.planTabIndicatorStyle.value = {
        opacity: '0',
        width: '0px',
        transform: 'translateX(0px)',
      }
      return
    }
    dependencies.planTabIndicatorReady.value = true
    dependencies.planTabIndicatorStyle.value = {
      opacity: '1',
      width: `${btn.offsetWidth}px`,
      transform: `translateX(${btn.offsetLeft}px)`,
    }
  }

  function setKeyEditLimitSegmentBtnRef(period, el) {
    if (el) {
      dependencies.keyEditLimitSegmentBtnRefs.set(period, el)
      if (
        dependencies.keyEditModal.value === 'limits' &&
        period === dependencies.keyEditLimitPeriod.value
      ) {
        scheduleKeyEditLimitSegmentSync()
      }
    } else {
      dependencies.keyEditLimitSegmentBtnRefs.delete(period)
    }
  }

  function scheduleKeyEditLimitSegmentSync() {
    void dependencies.nextTick(() => {
      requestAnimationFrame(() => {
        syncKeyEditLimitSegmentIndicator()
      })
    })
  }

  function syncKeyEditLimitSegmentIndicator() {
    const btn = dependencies.keyEditLimitSegmentBtnRefs.get(dependencies.keyEditLimitPeriod.value)
    const container = dependencies.keyEditLimitSegmentRef.value
    if (!btn || !container) {
      dependencies.keyEditLimitSegmentIndicatorReady.value = false
      dependencies.keyEditLimitSegmentIndicatorStyle.value = {
        opacity: '0',
        width: '0px',
        transform: 'translateX(0px)',
      }
      return
    }
    dependencies.keyEditLimitSegmentIndicatorReady.value = true
    dependencies.keyEditLimitSegmentIndicatorStyle.value = {
      opacity: '1',
      width: `${btn.offsetWidth}px`,
      transform: `translateX(${btn.offsetLeft}px)`,
    }
  }

  dependencies.watch(dependencies.keyEditLimitPeriod, () => {
    if (dependencies.keyEditModal.value === 'limits') scheduleKeyEditLimitSegmentSync()
  })

  dependencies.watch(dependencies.keyEditModal, (modal) => {
    if (modal === 'limits') scheduleKeyEditLimitSegmentSync()
    else dependencies.keyEditLimitSegmentIndicatorReady.value = false
  })

  function selectPlanConsoleTab(tab) {
    dependencies.planConsoleTab.value = tab
  }

  function syncActiveSectionFromRoute() {
    const requested = String(dependencies.route.query.section || '').trim()
    if (requested === 'guides') {
      dependencies.activeSection.value = 'docs'
      replaceSectionQuery('docs')
      return
    }
    const candidates = [
      requested,
      dependencies.PRICING_DEFAULT_SECTION,
      dependencies.internalNavItems.value[0]?.id,
    ].filter(Boolean)
    const next =
      candidates.find((id) => dependencies.internalNavItems.value.some((item) => item.id === id)) ||
      dependencies.internalNavItems.value[0]?.id ||
      dependencies.PRICING_DEFAULT_SECTION
    dependencies.activeSection.value = next
  }

  function selectSection(id) {
    const item = dependencies.visibleNavItems.value.find((entry) => entry.id === id)
    if (!item) return
    if (item.href) {
      dependencies.router.push(item.href)
      return
    }
    if (
      id !== dependencies.activeSection.value &&
      !dependencies.skipSectionMotion &&
      !dependencies.prefersReducedMotion()
    ) {
      dependencies.sectionSwitchPending.value = true
    }
    dependencies.activeSection.value = id
    replaceSectionQuery(id)
  }

  function replaceSectionQuery(id) {
    const nextQuery = { ...dependencies.route.query, section: id }
    if (String(dependencies.route.query.section || '') === String(id)) return
    dependencies.router.replace({ query: nextQuery })
  }

  function mergeResourceSummary(summary) {
    const empty = createEmptyResourceSummary()
    const wallet = dependencies.resolveWalletSnapshot(summary?.wallet || summary?.account || {})

    const creditsSource = summary?.credits || {}
    const creditsAccountSource = creditsSource.account || {}
    const creditSnapshot = dependencies.resolveWalletSnapshot(creditsAccountSource)

    return {
      ...empty,
      ...(summary || {}),
      wallet,
      account: wallet,
      credits: {
        ...empty.credits,
        ...creditsSource,
        account: creditSnapshot,
        ledger: Array.isArray(creditsSource.ledger) ? creditsSource.ledger : [],
      },
      usd: {
        ...empty.usd,
        ...(summary?.usd || {}),
        ledger: Array.isArray(summary?.usd?.ledger) ? summary.usd.ledger : [],
      },
      billing: { ...empty.billing, ...(summary?.billing || {}) },
      usage: dependencies.mergeUsageSummary(empty.usage, summary?.usage || {}),
      apiKeys: Array.isArray(summary?.apiKeys) ? summary.apiKeys : [],
    }
  }

  function resolveResourceScope(section = dependencies.activeSection.value) {
    if (section === 'wallet') return 'wallet'
    return 'usage'
  }

  async function loadResources({ silent = false, scope = resolveResourceScope() } = {}) {
    if (!dependencies.authStore.isAuthenticated) return
    const scopeKey = String(scope || 'usage')
    if (dependencies.resourceLoadPromises.has(scopeKey))
      return dependencies.resourceLoadPromises.get(scopeKey)
    dependencies.resourcesLoading.value = true
    dependencies.accountError.value = ''
    const task = (async () => {
      try {
        const data = await dependencies.getClientResourceSummary({ scope: scopeKey })
        dependencies.resourceSummary.value = mergeResourceSummary(data?.summary)
        dependencies.applyWalletFromSummary(dependencies.resourceSummary.value)
      } catch (error) {
        dependencies.accountError.value = error?.message || '资源用量读取失败'
        if (!silent) dependencies.notificationService.error(dependencies.accountError.value)
      } finally {
        dependencies.resourceLoadPromises.delete(scopeKey)
        dependencies.resourcesLoading.value = dependencies.resourceLoadPromises.size > 0
      }
    })()
    dependencies.resourceLoadPromises.set(scopeKey, task)
    return task
  }

  async function loadReferrals({ silent = false } = {}) {
    if (!dependencies.authStore.isAuthenticated) return
    dependencies.referralsLoading.value = true
    try {
      const data = await dependencies.getClientReferralSummary()
      dependencies.referralSummary.value = {
        ...dependencies.createEmptyReferralSummary(),
        ...(data?.summary || {}),
        referrals: Array.isArray(data?.summary?.referrals) ? data.summary.referrals : [],
      }
    } catch (error) {
      dependencies.referralSummary.value = dependencies.createEmptyReferralSummary()
      if (!silent) dependencies.notificationService.error(error?.message || '推荐计划读取失败')
    } finally {
      dependencies.referralsLoading.value = false
    }
  }

  async function loadAccountSettings({ silent = false } = {}) {
    if (!dependencies.authStore.isAuthenticated) return
    dependencies.accountSettingsLoading.value = true
    try {
      await dependencies.authStore.initAuth({ force: true })
      await Promise.allSettled([loadResources({ silent: true }), loadPlans()])
    } catch (error) {
      if (!silent) dependencies.notificationService.error(error?.message || '账号信息刷新失败')
    } finally {
      dependencies.accountSettingsLoading.value = false
    }
  }

  async function loadPricingPublicModels({ includeAvailability = false, silent = false } = {}) {
    if (!silent) dependencies.pricingModelsLoading.value = true
    try {
      const data = await dependencies.getClientPricingPublicModels({ includeAvailability })
      const rows = Array.isArray(data?.publicModels) ? data.publicModels : []
      if (includeAvailability && dependencies.pricingPublicModels.value.length) {
        const availabilityByKey = new Map(
          rows.map((item) => [String(item.publicModelKey || item.id || ''), item]),
        )
        dependencies.pricingPublicModels.value = dependencies.pricingPublicModels.value.map(
          (item) => {
            const key = String(item.publicModelKey || item.id || '')
            const next = availabilityByKey.get(key)
            return next ? { ...item, ...next } : item
          },
        )
        return
      }
      dependencies.pricingPublicModels.value = rows
    } catch (error) {
      if (!silent) dependencies.notificationService.error(error?.message || '公开模型目录读取失败')
    } finally {
      if (!silent) dependencies.pricingModelsLoading.value = false
    }
  }

  async function loadPricingSettings() {
    if (dependencies.pricingSettingsLoadPromise) return dependencies.pricingSettingsLoadPromise
    dependencies.settingsLoading.value = true
    dependencies.pricingSettingsLoadPromise = (async () => {
      try {
        const data = await dependencies.getClientPricingSettings()
        dependencies.pricingSettings.value = dependencies.mergePricingSettings(
          dependencies.createDefaultPricingSettings(),
          data?.settings || data,
        )
      } catch {
        dependencies.pricingSettings.value = dependencies.createDefaultPricingSettings()
      } finally {
        dependencies.settingsLoading.value = false
        dependencies.pricingSettingsLoadPromise = null
      }
    })()
    return dependencies.pricingSettingsLoadPromise
  }

  async function loadPlans() {
    if (dependencies.plansLoadPromise) return dependencies.plansLoadPromise
    dependencies.plansLoading.value = true
    dependencies.plansLoadPromise = (async () => {
      try {
        const data = await dependencies.getClientCommercePlans()
        dependencies.planOverview.value = {
          plans: Array.isArray(data.plans) ? data.plans : [],
          walletRechargePlans: Array.isArray(data.walletRechargePlans)
            ? data.walletRechargePlans
            : [],
          current: data.current || null,
          orders: Array.isArray(data.orders) ? data.orders : [],
        }
        dependencies.checkoutOptions.value = {
          stripeEnabled: data.checkout?.stripeEnabled === true,
          paypalEnabled: data.checkout?.paypalEnabled === true,
          alipayEnabled: data.checkout?.alipayEnabled === true,
          walletEnabled: data.checkout?.walletEnabled !== false,
          testCheckoutEnabled: data.checkout?.testCheckoutEnabled === true,
        }
        dependencies.checkoutProviderCatalog.value = Array.isArray(data.checkout?.providers)
          ? data.checkout.providers
          : []
      } catch {
        dependencies.planOverview.value = {
          plans: [],
          walletRechargePlans: [],
          current: null,
          orders: [],
        }
      } finally {
        dependencies.plansLoading.value = false
        dependencies.plansLoadPromise = null
      }
    })()
    return dependencies.plansLoadPromise
  }

  async function refreshConsole() {
    await Promise.allSettled([
      dependencies.runtimeConfigStore.loadRuntimeConfig({ force: true }),
      loadPricingSettings(),
      loadPlans(),
      dependencies.authStore.isAuthenticated
        ? dependencies.authStore.initAuth({ force: true })
        : Promise.resolve(),
      dependencies.authStore.isAuthenticated ? loadResources({ silent: true }) : Promise.resolve(),
      dependencies.authStore.isAuthenticated ? loadReferrals({ silent: true }) : Promise.resolve(),
    ])
    dependencies.notificationService.success('价格控制台已刷新')
  }

  async function refreshActiveSection() {
    const section = dependencies.activeSection.value
    const jobs = []
    const reloadRuntime = () => dependencies.runtimeConfigStore.loadRuntimeConfig({ force: true })
    const reloadResources = () =>
      dependencies.authStore.isAuthenticated ? loadResources({ silent: true }) : Promise.resolve()

    switch (section) {
      case 'overview':
        jobs.push(loadResources({ silent: true, scope: 'usage' }), reloadRuntime())
        break
      case 'models':
        jobs.push(loadPricingPublicModels({ includeAvailability: true }))
        break
      case 'keys':
        jobs.push(
          loadPricingPublicModels({ includeAvailability: true }),
          loadResources({ silent: true, scope: 'usage' }),
        )
        break
      case 'docs':
        jobs.push(loadPricingPublicModels())
        break
      case 'usage':
        jobs.push(loadResources({ silent: true, scope: 'usage' }))
        break
      case 'wallet':
        jobs.push(
          loadPricingSettings(),
          loadPlans(),
          loadResources({ silent: true, scope: 'wallet' }),
        )
        break
      case 'plans':
        jobs.push(loadPlans(), loadPricingSettings())
        break
      case 'referrals':
        jobs.push(loadReferrals())
        break
      case 'settings':
        jobs.push(loadAccountSettings({ silent: true }))
        break
      default:
        jobs.push(reloadRuntime(), loadPricingSettings(), loadPlans(), reloadResources())
        break
    }

    await Promise.allSettled(jobs)
    dependencies.notificationService.success('价格控制台已刷新')
  }

  return {
    setWalletTabButtonRef,
    scheduleWalletTabIndicatorSync,
    syncWalletTabIndicator,
    selectWalletPanelTab,
    setPlanTabButtonRef,
    schedulePlanTabIndicatorSync,
    syncPlanTabIndicator,
    setKeyEditLimitSegmentBtnRef,
    scheduleKeyEditLimitSegmentSync,
    syncKeyEditLimitSegmentIndicator,
    selectPlanConsoleTab,
    syncActiveSectionFromRoute,
    selectSection,
    replaceSectionQuery,
    createEmptyResourceSummary,
    mergeResourceSummary,
    resolveResourceScope,
    loadResources,
    loadReferrals,
    loadAccountSettings,
    loadPricingPublicModels,
    loadPricingSettings,
    loadPlans,
    refreshConsole,
    refreshActiveSection,
  }
}
