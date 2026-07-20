export function createPricingPlanState(dependencies) {
  function isWalletTopupPlan(plan = {}) {
    if (String(plan?.planKind || '') === 'wallet_topup') return true
    const metadata = plan?.metadata || {}
    if (metadata.walletTopup === true || metadata.topup === true) return true
    if (metadata.walletTopup === false || metadata.topup === false) return false
    return String(plan?.billingCycle || '') === 'once'
  }

  const subscriptionPlans = dependencies.computed(() =>
    dependencies.commercePlans.value.filter(
      (plan) => !isWalletTopupPlan(plan) && Number(plan?.priceCents || 0) > 0,
    ),
  )
  const planBillingOptions = dependencies.computed(() =>
    dependencies.planBillingAvailability(subscriptionPlans.value),
  )
  const planCatalogMode = dependencies.computed(() =>
    dependencies.shouldUsePlanCatalogMode(subscriptionPlans.value),
  )
  const subscriptionPlanCards = dependencies.computed(() =>
    dependencies.buildSubscriptionPlanCards({
      plans: subscriptionPlans.value,
      tab: planCatalogMode.value ? 'catalog' : dependencies.planBillingTab.value,
      currentPlanKey: dependencies.currentPlan.value?.plan?.planKey || '',
      featuredPlanKey: featuredPlanKey.value,
      summarizeEntitlements: dependencies.summarizePlanEntitlements,
      current: dependencies.currentPlan.value,
    }),
  )
  const subscriptionPeriod = dependencies.computed(() => {
    const apiPeriod = dependencies.currentPlan.value?.subscriptionPeriod
    if (apiPeriod && typeof apiPeriod.isActive === 'boolean') {
      return apiPeriod
    }
    return dependencies.buildClientSubscriptionPeriodView(
      dependencies.currentPlan.value?.activeSubscription || null,
    )
  })
  dependencies.watch(
    dependencies.activeSection,
    (section) => {
      if (section !== 'plans') return
      dependencies.planConsoleTab.value = dependencies.resolveDefaultPlanConsoleTab()
    },
    { immediate: true },
  )
  dependencies.watch(dependencies.visiblePlanConsoleTabs, (tabs) => {
    if (!tabs.some((tab) => tab.id === dependencies.planConsoleTab.value)) {
      dependencies.planConsoleTab.value = dependencies.resolveDefaultPlanConsoleTab()
    }
  })
  function resolveCommercePlanName(planKey = '') {
    return dependencies.resolveCommerceOrderPlanName({ planKey }, dependencies.commercePlans.value)
  }

  function isWalletTopupCommerceOrder(order = {}) {
    if (order?.walletTopup === true || order?.metadata?.walletTopup === true) return true
    const plan = dependencies.resolveCommercePlanByKey(
      dependencies.commercePlans.value,
      order?.planKey,
    )
    return plan ? isWalletTopupPlan(plan) : false
  }
  const subscriptionKey = dependencies.computed(
    () =>
      dependencies.apiKeys.value.find(
        (item) =>
          String(item.keyKind || 'wallet') === 'subscription' &&
          String(item.status || 'active') !== 'revoked',
      ) || null,
  )
  const subscriptionPeriodHint = dependencies.computed(() =>
    subscriptionPeriod.value.isActive ? subscriptionPeriod.value.label : '',
  )
  const subscriptionSidebarHint = dependencies.computed(() =>
    dependencies.buildSubscriptionSidebarHint(subscriptionPeriod.value),
  )
  const subscriptionDashboard = dependencies.computed(() =>
    dependencies.buildSubscriptionDashboard({
      currentPlan: dependencies.currentPlan.value,
      subscriptionPeriod: subscriptionPeriod.value,
      subscriptionKey: subscriptionKey.value,
      usage: dependencies.usage.value,
    }),
  )
  const subscriptionPanelNumbersEnabled = dependencies.computed(
    () => !dependencies.consoleBooting.value && !dependencies.sectionSwitchPending.value,
  )
  const accountNewSecretIsSubscription = dependencies.computed(
    () =>
      Boolean(dependencies.accountNewSecretKeyId.value) &&
      String(subscriptionKey.value?.id || '') === String(dependencies.accountNewSecretKeyId.value),
  )
  const subscriptionPlansGridClass = dependencies.computed(() => {
    const count = subscriptionPlanCards.value.length
    if (count <= 1) return 'is-single'
    if (count === 2) return 'is-duo'
    if (count >= 4) return 'is-quad'
    return 'is-triple'
  })
  const planSkeletonCount = dependencies.computed(() => {
    const count = subscriptionPlanCards.value.length || subscriptionPlans.value.length
    if (count <= 1) return 1
    if (count === 2) return 2
    if (count >= 4) return 4
    return 3
  })
  const planBillingTabInitialized = dependencies.ref(false)
  dependencies.watch(
    subscriptionPlans,
    (plans) => {
      const availability = dependencies.planBillingAvailability(plans)
      if (!plans.length) return
      if (!planBillingTabInitialized.value) {
        dependencies.planBillingTab.value = dependencies.resolveDefaultPlanBillingTab(plans)
        planBillingTabInitialized.value = true
        return
      }
      if (
        dependencies.planBillingTab.value === 'year' &&
        !availability.year &&
        availability.month
      ) {
        dependencies.planBillingTab.value = 'month'
      } else if (
        dependencies.planBillingTab.value === 'month' &&
        !availability.month &&
        availability.year
      ) {
        dependencies.planBillingTab.value = 'year'
      }
    },
    { immediate: true },
  )
  const walletTopupPlans = dependencies.computed(() =>
    dependencies.walletRechargeCatalog.value
      .filter((plan) => Number(plan?.priceCents || 0) > 0)
      .map((plan) => ({
        plan,
        key: plan.planKey,
        name: plan.name || plan.planKey,
        description: plan.description || '',
        price: dependencies.planPriceParts(plan),
      })),
  )
  const featuredPlanKey = dependencies.computed(() => {
    const plans = dependencies.commercePlans.value
    if (!plans.length) return ''
    const paid = plans.filter((plan) => Number(plan?.priceCents || 0) > 0)
    if (paid.length) {
      const preferred = paid.find((plan) =>
        /pro|plus|standard|premium/i.test(String(plan.planKey || '')),
      )
      return (
        preferred?.planKey || paid[Math.floor((paid.length - 1) / 2)]?.planKey || paid[0]?.planKey
      )
    }
    return plans[Math.min(1, plans.length - 1)]?.planKey || plans[0]?.planKey
  })

  const walletReconcileSummary = dependencies.computed(() => {
    const wallet = dependencies.account.value || {}
    return {
      balance: dependencies.clampUsd(wallet.balance ?? 0),
      frozen: dependencies.clampUsd(wallet.frozenBalance ?? 0),
      available: dependencies.resolveAvailableUsdBalance(wallet),
      lifetimeSpent: dependencies.clampUsd(wallet.lifetimeSpent ?? 0),
      monthEstimate: dependencies.clampUsd(dependencies.usage.value?.month?.estimatedCostUsd ?? 0),
    }
  })
  const wallpaperCredits = dependencies.computed(() => {
    const creditAccount = dependencies.credits.value.account || {}
    const balance = Number(creditAccount.balance ?? 0)
    const frozen = Number(creditAccount.frozenBalance || 0)
    return Math.max(0, balance - frozen)
  })
  const walletExchangeCreditsPerUsd = dependencies.computed(() => {
    const rate = Number(dependencies.pricingSettings.value.wallet?.creditsPerUsd || 100)
    return Number.isFinite(rate) && rate > 0 ? rate : 100
  })
  const walletExchangePreviewCredits = dependencies.computed(() => {
    const amountUsd = Math.round(Number(dependencies.walletExchangeDraft.value) * 100) / 100
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0
    return Math.max(1, Math.round(amountUsd * walletExchangeCreditsPerUsd.value))
  })
  const currentPlanLabel = dependencies.computed(() => {
    if (!subscriptionPeriod.value.isActive) return '未订阅'
    return (
      dependencies.currentPlan.value?.plan?.name ||
      dependencies.currentPlan.value?.activeSubscription?.planKey ||
      '未订阅'
    )
  })
  const isPlanUnsubscribed = dependencies.computed(
    () => currentPlanLabel.value === '未订阅' || !subscriptionPeriod.value.isActive,
  )
  const baseUrl = dependencies.computed(() =>
    dependencies.formatEndpoint(
      dependencies.runtimeConfigStore.config?.endpoints?.openAiBaseUrl || '/v1',
    ),
  )
  const accountSettingsAvatar = dependencies.computed(() =>
    dependencies.accountAvatarInitial(dependencies.authStore.user || {}),
  )
  const accountSettingsRoleLabel = dependencies.computed(() =>
    dependencies.resolveAccountRoleLabel(dependencies.authStore.user?.role),
  )
  const accountSettingsInfoRows = dependencies.computed(() =>
    dependencies.buildAccountInfoRows({
      displayName: dependencies.authStore.displayName,
      email: dependencies.authStore.user?.email || '',
      userId: dependencies.authStore.user?.id || '',
      role: dependencies.authStore.user?.role || '',
      roleLabel: accountSettingsRoleLabel.value,
      baseUrl: baseUrl.value,
    }),
  )
  const accountSettingsSecurityActions = dependencies.computed(() =>
    dependencies.buildAccountSecurityActions(),
  )
  const sampleModelId = dependencies.computed(
    () =>
      dependencies.pricedModels.value[0]?.displayId || dependencies.pricedModels.value[0]?.id || '',
  )
  const walletAmounts = dependencies.computed(() => {
    const amounts = Array.isArray(dependencies.pricingSettings.value.wallet?.rechargeAmounts)
      ? dependencies.pricingSettings.value.wallet.rechargeAmounts
      : []
    return amounts.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
  })
  const walletTopupPlanByUsd = dependencies.computed(() => {
    const map = new Map()
    walletTopupPlans.value.forEach((item) => {
      const usd = Math.round(Number(item.plan?.priceCents || 0)) / 100
      if (usd > 0 && !map.has(usd)) map.set(usd, item.plan)
    })
    return map
  })
  const rechargeAmountOptions = dependencies.computed(() => {
    const fromPlans = [...walletTopupPlanByUsd.value.keys()]
    const amounts = walletAmounts.value.length
      ? walletAmounts.value
      : fromPlans.sort((a, b) => a - b)
    return [...new Set(amounts)]
      .filter((amount) => amount > 0)
      .sort((a, b) => a - b)
      .map((amount) => {
        const plan = walletTopupPlanByUsd.value.get(amount) || null
        return {
          amount,
          plan,
          ready: Boolean(
            plan || String(dependencies.pricingSettings.value.wallet?.rechargeUrl || '').trim(),
          ),
        }
      })
  })
  const orphanTopupPlans = dependencies.computed(() =>
    walletTopupPlans.value.filter((item) => {
      const usd = Math.round(Number(item.plan?.priceCents || 0)) / 100
      return usd > 0 && !rechargeAmountOptions.value.some((option) => option.amount === usd)
    }),
  )
  const selectedRechargePlan = dependencies.computed(
    () => walletTopupPlanByUsd.value.get(dependencies.selectedRechargeAmount.value) || null,
  )
  const selectedRechargeSummary = dependencies.computed(() => {
    const pay = Number(dependencies.selectedRechargeAmount.value || 0)
    return { pay, total: pay }
  })
  const isCustomRechargeSelected = dependencies.computed(() => {
    const amount = Number(dependencies.selectedRechargeAmount.value || 0)
    if (!amount) return false
    return !rechargeAmountOptions.value.some((option) => option.amount === amount)
  })
  function formatRechargeReceiveLabel(option = {}) {
    if (option.amount > 0) return dependencies.formatMoneyDisplay(option.amount)
    if (option.ready) return '待配置'
    return '待配置'
  }
  function selectRechargeAmount(amount) {
    dependencies.selectedRechargeAmount.value = Number(amount || 0)
  }
  function openWalletCustomModal() {
    dependencies.walletCustomDraft.value = isCustomRechargeSelected.value
      ? String(dependencies.selectedRechargeAmount.value)
      : ''
    dependencies.walletCustomModalOpen.value = true
    dependencies.nextTick(() => {
      dependencies.walletCustomModalInputRef.value?.focus()
      dependencies.walletCustomModalInputRef.value?.select()
    })
  }
  function closeWalletCustomModal() {
    dependencies.walletCustomModalOpen.value = false
  }
  function applyCustomRechargeAmount() {
    const amount = Math.round(Number(dependencies.walletCustomDraft.value) * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0) {
      dependencies.notificationService.warning('请输入有效充值金额')
      return
    }
    dependencies.selectedRechargeAmount.value = amount
    dependencies.walletCustomModalOpen.value = false
  }
  const rechargePlanReady = dependencies.computed(() => Boolean(selectedRechargePlan.value))
  const hasRechargeUrl = dependencies.computed(() =>
    Boolean(String(dependencies.pricingSettings.value.wallet?.rechargeUrl || '').trim()),
  )
  const rechargeReady = dependencies.computed(() => {
    const amount = dependencies.selectedRechargeAmount.value
    if (!amount) return false
    if (selectedRechargePlan.value) return true
    return hasRechargeUrl.value
  })
  const canSubmitRecharge = dependencies.computed(() => {
    if (!dependencies.selectedRechargeAmount.value) return false
    if (!rechargePlanReady.value) return false
    const provider = dependencies.selectedCheckoutProvider.value
    if (!dependencies.isCheckoutProviderAvailable(provider)) return false
    if (!dependencies.isCheckoutProviderConfigured(provider)) return false
    if (provider === 'wallet') {
      return rechargePlanReady.value || hasRechargeUrl.value
    }
    if (dependencies.isRedirectCheckoutProvider(provider) || provider === 'manual') {
      return rechargePlanReady.value
    }
    return false
  })
  const selectedRechargeHint = dependencies.computed(() => {
    const amount = dependencies.selectedRechargeAmount.value
    if (!amount) return ''
    if (!rechargePlanReady.value) {
      return `$${amount} 档位尚未就绪。请刷新页面；若仍不可用，请在后台「充值与用户页」保存一次配置。`
    }
    if (!dependencies.isCheckoutProviderAvailable(dependencies.selectedCheckoutProvider.value)) {
      return '当前没有可用的支付方式，请在后台开启至少一种支付通道。'
    }
    if (!dependencies.isCheckoutProviderConfigured(dependencies.selectedCheckoutProvider.value)) {
      return `${dependencies.checkoutProviderLabel(dependencies.selectedCheckoutProvider.value)} 已开启但尚未完成密钥配置，请补全后台支付配置后再试。`
    }
    if (
      dependencies.selectedCheckoutProvider.value === 'wallet' &&
      !hasRechargeUrl.value &&
      !rechargePlanReady.value
    ) {
      return `$${amount} 档位暂未开通余额支付。`
    }
    return ''
  })
  const alipayFxRate = dependencies.computed(() =>
    Number(dependencies.pricingSettings.value?.checkout?.alipay?.fx?.rate || 0),
  )
  const selectedAlipayPayEstimate = dependencies.computed(() => {
    if (dependencies.selectedCheckoutProvider.value !== 'alipay') return ''
    const amount = dependencies.selectedRechargeAmount.value
    const rate = alipayFxRate.value
    if (!amount || !rate) return ''
    return `¥${(amount * rate).toFixed(2)}`
  })
  const alipayFxHint = dependencies.computed(() => {
    const fx = dependencies.pricingSettings.value?.checkout?.alipay?.fx
    if (!fx?.rate || dependencies.selectedCheckoutProvider.value !== 'alipay') return ''
    const time = fx.fetchedAt
      ? new Date(fx.fetchedAt).toLocaleString('zh-CN', { hour12: false })
      : ''
    return `实时汇率 1 USD ≈ ¥${Number(fx.rate).toFixed(4)}${time ? ` · ${time}` : ''}${fx.stale ? '（备用）' : ''}`
  })
  const referralStats = dependencies.computed(
    () => dependencies.referralSummary.value || dependencies.createEmptyReferralSummary(),
  )
  const referralProgramConfig = dependencies.computed(() =>
    dependencies.resolveReferralProgramConfig(
      referralStats.value,
      dependencies.pricingSettings.value.referrals || {},
    ),
  )
  const referralRewardSummary = dependencies.computed(() =>
    dependencies.buildReferralRewardSummary(referralProgramConfig.value),
  )
  const referralSteps = dependencies.computed(() =>
    dependencies.buildReferralSteps(referralProgramConfig.value),
  )
  const referralPendingCount = dependencies.computed(() =>
    Math.max(
      0,
      Number(referralStats.value.totalReferrals || 0) -
        Number(referralStats.value.rewardedReferrals || 0),
    ),
  )
  const referralStatsCards = dependencies.computed(() =>
    dependencies.buildReferralStatsCards({
      totalReferrals: referralStats.value.totalReferrals,
      rewardedReferrals: referralStats.value.rewardedReferrals,
      rewardCredits: referralStats.value.rewardCredits,
      pendingCount: referralPendingCount.value,
    }),
  )
  const referralUrl = dependencies.computed(() => {
    if (!dependencies.authStore.isAuthenticated && !referralProgramConfig.value.invitePath)
      return ''
    const inviteCode = referralStats.value.inviteCode || dependencies.authStore.user?.id || ''
    if (!inviteCode && dependencies.authStore.isAuthenticated) return ''
    return dependencies.buildReferralInviteUrl(
      typeof window !== 'undefined' ? window.location.origin : '',
      referralProgramConfig.value.invitePath,
      inviteCode,
    )
  })
  dependencies.watch(
    () => dependencies.pricingSettings.value,
    (settings) => {
      dependencies.accountKeyForm.prefix =
        dependencies.accountKeyForm.prefix || settings.apiKeys?.defaultPrefix || ''
      if (
        !dependencies.accountKeyForm.scopes.length &&
        Array.isArray(settings.apiKeys?.defaultScopes)
      ) {
        dependencies.accountKeyForm.scopes = settings.apiKeys.defaultScopes
          .map(String)
          .filter(Boolean)
      }
      dependencies.selectedRechargeAmount.value = Number(
        settings.wallet?.defaultAmount || walletAmounts.value[0] || 0,
      )
    },
    { immediate: true },
  )

  dependencies.watch(dependencies.overviewTrendRange, () => {
    dependencies.overviewTrendHoverIndex.value = -1
  })

  dependencies.watch(
    rechargeAmountOptions,
    (options) => {
      if (!options.length) return
      const current = Number(dependencies.selectedRechargeAmount.value || 0)
      if (current > 0) {
        if (options.some((option) => option.amount === current)) return
        if (walletTopupPlanByUsd.value.get(current)) return
        if (String(dependencies.pricingSettings.value.wallet?.rechargeUrl || '').trim()) return
      }
      const preferred = Number(dependencies.pricingSettings.value.wallet?.defaultAmount || 0)
      const fallback = options.find((option) => option.amount === preferred) || options[0]
      if (fallback) dependencies.selectedRechargeAmount.value = fallback.amount
    },
    { immediate: true },
  )

  dependencies.watch(
    dependencies.activeSection,
    () => {
      if (!dependencies.skipSectionMotion && !dependencies.prefersReducedMotion()) {
        dependencies.sectionSwitchPending.value = true
      }
    },
    { flush: 'pre' },
  )

  dependencies.watch(
    () => dependencies.route.path,
    (path) => {
      if (path === '/pricing' && dependencies.authStore.isAuthenticated) {
        void dependencies.refreshWalletBalance({ force: true })
      }
    },
  )

  dependencies.watch(dependencies.activeSection, async (section) => {
    if (
      dependencies.sectionNeedsPublicModelsBoot(section) &&
      !dependencies.pricingPublicModels.value.length
    ) {
      void dependencies.loadPricingPublicModels({ silent: true })
    }
    if (dependencies.sectionNeedsUsageBoot(section) && dependencies.authStore.isAuthenticated) {
      void dependencies.loadResources({
        silent: true,
        scope: section === 'wallet' ? 'wallet' : 'usage',
      })
    }
    if (section === 'referrals' && dependencies.authStore.isAuthenticated) {
      dependencies.loadReferrals({ silent: true })
    }
    if (section === 'settings' && dependencies.authStore.isAuthenticated) {
      dependencies.loadAccountSettings({ silent: true })
    }
    await dependencies.nextTick()
    const main = dependencies.pricingPageRoot.value?.querySelector('.pc-main')
    if (main && typeof main.scrollTo === 'function') {
      main.scrollTo({ top: 0, behavior: 'auto' })
    }
    if (!dependencies.skipSectionMotion) {
      if (dependencies.prefersReducedMotion()) {
        dependencies.sectionSwitchPending.value = false
      } else {
        dependencies.pricingMotion?.playSectionTransition({
          onPrepared: () => {
            dependencies.sectionSwitchPending.value = false
          },
        })
      }
    } else {
      dependencies.sectionSwitchPending.value = false
    }
  })

  dependencies.watch(
    () => dependencies.authStore.isAuthenticated,
    async (isAuthenticated) => {
      if (isAuthenticated) {
        void dependencies.loadResources({ silent: true })
        return
      }
      dependencies.resourceSummary.value = dependencies.createEmptyResourceSummary()
      dependencies.referralSummary.value = dependencies.createEmptyReferralSummary()
    },
  )

  dependencies.onMounted(() => {
    document.addEventListener('pointerdown', dependencies.handleKeyMenuOutsidePointer, true)
    window.addEventListener('resize', dependencies.handleKeyMenuViewportChange)
    window.addEventListener('scroll', dependencies.handleKeyMenuViewportChange, true)
    window.addEventListener('resize', dependencies.syncWalletTabIndicator)
    window.addEventListener('resize', dependencies.syncPlanTabIndicator)
    window.addEventListener('walleven:wallet-updated', dependencies.handleBillingRealtimeUpdate)
    window.addEventListener(
      'walleven:subscription-updated',
      dependencies.handleBillingRealtimeUpdate,
    )
    void dependencies.bootstrapPricingConsole()
  })

  return {
    isWalletTopupPlan,
    subscriptionPlans,
    planBillingOptions,
    planCatalogMode,
    subscriptionPlanCards,
    subscriptionPeriod,
    resolveCommercePlanName,
    isWalletTopupCommerceOrder,
    subscriptionKey,
    subscriptionPeriodHint,
    subscriptionSidebarHint,
    subscriptionDashboard,
    subscriptionPanelNumbersEnabled,
    accountNewSecretIsSubscription,
    subscriptionPlansGridClass,
    planSkeletonCount,
    planBillingTabInitialized,
    walletTopupPlans,
    featuredPlanKey,
    walletReconcileSummary,
    wallpaperCredits,
    walletExchangeCreditsPerUsd,
    walletExchangePreviewCredits,
    currentPlanLabel,
    isPlanUnsubscribed,
    baseUrl,
    accountSettingsAvatar,
    accountSettingsRoleLabel,
    accountSettingsInfoRows,
    accountSettingsSecurityActions,
    sampleModelId,
    walletAmounts,
    walletTopupPlanByUsd,
    rechargeAmountOptions,
    orphanTopupPlans,
    selectedRechargePlan,
    selectedRechargeSummary,
    isCustomRechargeSelected,
    formatRechargeReceiveLabel,
    selectRechargeAmount,
    openWalletCustomModal,
    closeWalletCustomModal,
    applyCustomRechargeAmount,
    rechargePlanReady,
    hasRechargeUrl,
    rechargeReady,
    canSubmitRecharge,
    selectedRechargeHint,
    alipayFxRate,
    selectedAlipayPayEstimate,
    alipayFxHint,
    referralStats,
    referralProgramConfig,
    referralRewardSummary,
    referralSteps,
    referralPendingCount,
    referralStatsCards,
    referralUrl,
  }
}
