export function createPricingState(dependencies) {
  const walletCardBgStyle = {
    '--pc-wallet-card-bg': `url("${dependencies.walletRechargeHeroDarkArt}")`,
  }

  const overviewTrendRange = dependencies.ref('7d')
  const overviewTrendHoverIndex = dependencies.ref(-1)
  const overviewStreakHoverCell = dependencies.ref(null)
  const overviewInsightsRange = dependencies.ref('7d')
  const planBillingTab = dependencies.ref('month')
  const planBillingTabs = dependencies.PLAN_BILLING_TABS
  const planConsoleTab = dependencies.ref('catalog')
  const planTabsRef = dependencies.ref(null)
  const planTabButtonRefs = new Map()
  const planTabIndicatorStyle = dependencies.ref({
    opacity: '0',
    width: '0px',
    transform: 'translateX(0px)',
  })
  const planTabIndicatorReady = dependencies.ref(false)
  const planConsoleTabs = [
    { id: 'current', label: '当前套餐', requiresAuth: true },
    { id: 'catalog', label: '套餐列表' },
    { id: 'orders', label: '订单列表', requiresAuth: true },
  ]
  const visiblePlanConsoleTabs = dependencies.computed(() =>
    planConsoleTabs.filter((tab) => !tab.requiresAuth || authStore.isAuthenticated),
  )
  function resolveDefaultPlanConsoleTab() {
    if (authStore.isAuthenticated && dependencies.subscriptionPeriod.value.isActive) {
      return 'current'
    }
    return 'catalog'
  }
  const overviewRangeOptions = dependencies.OVERVIEW_RANGE_OPTIONS

  const KEY_NAME_PRESETS = ['本地开发', 'Cursor', 'Claude Code', '团队共享']
  const KEY_LIMIT_MODE_OPTIONS = [
    { id: 'unlimited', label: '不限' },
    { id: 'usd', label: '日/月限额' },
    { id: 'count', label: '次数限额' },
  ]
  const KEY_LIMIT_PRESETS = [
    { id: 'none', label: '不限额', hint: '个人开发' },
    { id: 'personal', label: '个人常用', hint: '月 5000 次' },
    { id: 'share', label: '对外分发', hint: '月 $20 预算' },
  ]

  let billingRealtimeTimer = null

  const authStore = dependencies.useAuthStore()
  const { availableUsd, balanceDisplay, applyWalletFromSummary, refreshWalletBalance } =
    dependencies.useClientWalletBalance()
  const runtimeConfigStore = dependencies.useRuntimeConfigStore()
  const route = dependencies.useRoute()
  const router = dependencies.useRouter()
  const pricingPageRoot = dependencies.ref(null)
  let pricingMotion = null
  let skipSectionMotion = true

  const activeSection = dependencies.ref(dependencies.PRICING_DEFAULT_SECTION)
  const plansLoading = dependencies.ref(true)
  let plansLoadPromise = null
  let pricingSettingsLoadPromise = null
  const resourceLoadPromises = new Map()
  const pricingModelsLoading = dependencies.ref(false)
  const pricingPublicModels = dependencies.ref([])
  const consoleBooting = dependencies.ref(false)
  const sectionSwitchPending = dependencies.ref(false)
  const resourcesLoading = dependencies.ref(false)
  const referralsLoading = dependencies.ref(false)
  const accountSettingsLoading = dependencies.ref(false)
  const checkoutLoading = dependencies.ref('')
  const checkoutUiPhase = dependencies.ref(dependencies.CHECKOUT_UI_PHASE.IDLE)
  const checkoutModalOpen = dependencies.ref(false)
  const checkoutModalMessage = dependencies.ref('')
  const keyActionLoading = dependencies.ref('')
  const accountError = dependencies.ref('')
  const accountNewSecret = dependencies.ref('')
  const checkoutOrder = dependencies.ref(null)
  const checkoutOptions = dependencies.ref({
    stripeEnabled: false,
    paypalEnabled: false,
    alipayEnabled: false,
    walletEnabled: true,
    testCheckoutEnabled: false,
  })
  const selectedCheckoutProvider = dependencies.ref('wallet')
  const CHECKOUT_PROVIDER_ICONS = {
    alipay: 'bi-wallet2',
    paypal: 'bi-globe-americas',
    stripe: 'bi-stripe',
    wallet: 'bi-wallet2',
    manual: 'bi-bug',
  }
  const checkoutProviderCatalog = dependencies.ref([])
  const checkoutOrderView = dependencies.computed(() =>
    dependencies.buildCheckoutOrderView(checkoutOrder.value, {
      plans: dependencies.commercePlans.value,
    }),
  )
  const checkoutModalPresentation = dependencies.computed(() =>
    dependencies.buildCheckoutModalPresentation({
      phase: checkoutUiPhase.value,
      orderView: checkoutOrderView.value,
      isWalletTopup: dependencies.isWalletTopupCommerceOrder(checkoutOrder.value || {}),
      message: checkoutModalMessage.value,
    }),
  )
  const checkoutModalLoading = dependencies.computed(
    () =>
      checkoutLoading.value ||
      checkoutUiPhase.value === dependencies.CHECKOUT_UI_PHASE.CREATING ||
      checkoutUiPhase.value === dependencies.CHECKOUT_UI_PHASE.CONFIRMING ||
      checkoutUiPhase.value === dependencies.CHECKOUT_UI_PHASE.REDIRECTING,
  )
  const checkoutModalShowManualConfirm = dependencies.computed(
    () =>
      checkoutOrderView.value?.isAlipay &&
      checkoutOrderView.value?.isPending &&
      [dependencies.CHECKOUT_UI_PHASE.PAYING, dependencies.CHECKOUT_UI_PHASE.UNPAID].includes(
        checkoutUiPhase.value,
      ),
  )
  const checkoutModalShowContinuePay = dependencies.computed(
    () =>
      checkoutOrderView.value?.isAlipay &&
      checkoutOrderView.value?.isPending &&
      Boolean(checkoutOrder.value?.checkoutUrl) &&
      [dependencies.CHECKOUT_UI_PHASE.PAYING, dependencies.CHECKOUT_UI_PHASE.UNPAID].includes(
        checkoutUiPhase.value,
      ),
  )
  const checkoutModalShowCancel = dependencies.computed(
    () =>
      checkoutOrderView.value?.isPending &&
      [dependencies.CHECKOUT_UI_PHASE.PAYING, dependencies.CHECKOUT_UI_PHASE.UNPAID].includes(
        checkoutUiPhase.value,
      ),
  )
  const checkoutModalShowRefresh = dependencies.computed(
    () =>
      checkoutOrderView.value?.isAlipay &&
      [
        dependencies.CHECKOUT_UI_PHASE.PAYING,
        dependencies.CHECKOUT_UI_PHASE.UNPAID,
        dependencies.CHECKOUT_UI_PHASE.CONFIRMING,
      ].includes(checkoutUiPhase.value),
  )
  const checkoutModalShowTestConfirm = dependencies.computed(
    () =>
      checkoutOrder.value?.status === 'pending' &&
      checkoutOrder.value?.checkoutProvider === 'manual' &&
      checkoutOptions.value.testCheckoutEnabled &&
      checkoutUiPhase.value === dependencies.CHECKOUT_UI_PHASE.PAYING,
  )
  const hasOnlineCheckout = dependencies.computed(() =>
    checkoutProviderCatalog.value.some(
      (item) => item.id !== 'wallet' && item.id !== 'manual' && item.configured,
    ),
  )
  const checkoutProviderOptions = dependencies.computed(() =>
    checkoutProviderCatalog.value.map((item) => ({
      ...item,
      icon: CHECKOUT_PROVIDER_ICONS[item.id] || 'bi-credit-card',
    })),
  )
  const onlineCheckoutProviderOptions = dependencies.computed(() =>
    checkoutProviderOptions.value.filter((item) => item.id !== 'wallet' && item.id !== 'manual'),
  )
  function isCheckoutProviderConfigured(provider = '') {
    const id = String(provider || '')
      .trim()
      .toLowerCase()
    const match = checkoutProviderCatalog.value.find((item) => item.id === id)
    return Boolean(match?.configured)
  }
  function isCheckoutProviderAvailable(provider = '') {
    const id = String(provider || '')
      .trim()
      .toLowerCase()
    return checkoutProviderCatalog.value.some((item) => item.id === id)
  }
  function resolveDefaultCheckoutProvider() {
    for (const id of ['alipay', 'paypal', 'stripe', 'wallet']) {
      if (isCheckoutProviderAvailable(id) && isCheckoutProviderConfigured(id)) return id
    }
    for (const id of ['alipay', 'paypal', 'stripe', 'wallet']) {
      if (isCheckoutProviderAvailable(id)) return id
    }
    if (checkoutOptions.value.testCheckoutEnabled) return 'manual'
    return ''
  }
  function checkoutProviderLabel(provider = '') {
    const map = {
      wallet: '余额支付',
      stripe: 'Stripe',
      paypal: 'PayPal',
      alipay: '支付宝',
      manual: '测试支付',
    }
    return (
      map[
        String(provider || '')
          .trim()
          .toLowerCase()
      ] || String(provider || '—')
    )
  }
  function isRedirectCheckoutProvider(provider = '') {
    return ['stripe', 'paypal', 'alipay'].includes(
      String(provider || '')
        .trim()
        .toLowerCase(),
    )
  }
  function selectCheckoutProvider(provider = '') {
    selectedCheckoutProvider.value =
      String(provider || '').trim() || resolveDefaultCheckoutProvider()
  }
  dependencies.watch(
    checkoutProviderOptions,
    (options) => {
      if (!options.length) {
        selectedCheckoutProvider.value = ''
        return
      }
      if (!options.some((item) => item.id === selectedCheckoutProvider.value)) {
        selectedCheckoutProvider.value =
          options.find((item) => item.configured)?.id || options[0]?.id || ''
      }
    },
    { immediate: true },
  )
  const planOverview = dependencies.ref({
    plans: [],
    walletRechargePlans: [],
    current: null,
    orders: [],
  })
  const resourceSummary = dependencies.ref(dependencies.createEmptyResourceSummary())
  const referralSummary = dependencies.ref(dependencies.createEmptyReferralSummary())
  const selectedRechargeAmount = dependencies.ref(0)
  const walletPanelTab = dependencies.ref('recharge')
  const walletTabsRef = dependencies.ref(null)
  const walletTabButtonRefs = new Map()
  const walletTabIndicatorStyle = dependencies.ref({
    opacity: '0',
    width: '0px',
    transform: 'translateX(0px)',
  })
  const walletTabIndicatorReady = dependencies.ref(false)
  const walletRedeemDraft = dependencies.ref('')
  const walletRedeemLoading = dependencies.ref(false)
  const walletRedeemSuccess = dependencies.ref(null)
  const walletExchangeDraft = dependencies.ref('')
  const walletExchangeLoading = dependencies.ref(false)
  const walletCustomModalOpen = dependencies.ref(false)
  const walletCustomDraft = dependencies.ref('')
  const walletCustomModalInputRef = dependencies.ref(null)
  const usageStatusFilter = dependencies.ref('all')
  const usageModelFilter = dependencies.ref('all')
  const usageKeyKindFilter = dependencies.ref('all')
  const modelSearch = dependencies.ref('')
  const modelCapabilityFilter = dependencies.ref('all')
  const modelBillingFilter = dependencies.ref('all')
  const modelProviderFilter = dependencies.ref('all')
  const keyAdvancedOpen = dependencies.ref(false)
  const keyModelSearch = dependencies.ref('')
  const keyMenuOpenId = dependencies.ref('')
  const keyMenuOpenKey = dependencies.ref(null)
  const keyMenuStyle = dependencies.ref({ top: '0px', left: '0px' })
  const keyMenuTriggerEl = dependencies.ref(null)
  const keyMenuDropdownRef = dependencies.ref(null)
  const keyCreateModalOpen = dependencies.ref(false)
  const keyEditModal = dependencies.ref('')
  const keyResetModalKey = dependencies.ref(null)
  const keyResetNewSecret = dependencies.ref('')
  const keyRevokeModalKey = dependencies.ref(null)
  const keyEditingKey = dependencies.ref(null)
  const keyLimitPeriod = dependencies.ref('unlimited')
  const keyLimitMode = dependencies.ref('unlimited')
  const keyLimitAmount = dependencies.ref('')
  const keyEditLimitMode = dependencies.ref('unlimited')
  const keyEditLimitPeriod = dependencies.ref('unlimited')
  const keyEditLimitSegmentRef = dependencies.ref(null)
  const keyEditLimitSegmentBtnRefs = new Map()
  const keyEditLimitSegmentIndicatorStyle = dependencies.ref({
    opacity: '0',
    width: '0px',
    transform: 'translateX(0px)',
  })
  const keyEditLimitSegmentIndicatorReady = dependencies.ref(false)
  const keyEditLimitAmount = dependencies.ref('')
  const keyEditDailyUnits = dependencies.ref('')
  const keyEditMonthlyUnits = dependencies.ref('')
  const keyEditModelSearch = dependencies.ref('')
  const accountNewSecretKeyId = dependencies.ref('')

  const keyEditForm = dependencies.reactive({
    label: '',
    allowedPublicModels: [],
    scopes: [],
    allowedIpsText: '',
    expiresAt: '',
  })

  const accountKeyForm = dependencies.reactive({
    label: '',
    prefix: '',
    scopes: [],
    allowedPublicModels: [],
    allowedIpsText: '',
    dailyLimitUnits: 0,
    monthlyLimitUnits: 0,
    dailyLimitUsd: 0,
    monthlyLimitUsd: 0,
    expiresAt: '',
  })

  const settingsLoading = dependencies.ref(false)
  const pricingSettings = dependencies.ref(dependencies.createDefaultPricingSettings())

  return {
    walletCardBgStyle,
    overviewTrendRange,
    overviewTrendHoverIndex,
    overviewStreakHoverCell,
    overviewInsightsRange,
    planBillingTab,
    planBillingTabs,
    planConsoleTab,
    planTabsRef,
    planTabButtonRefs,
    planTabIndicatorStyle,
    planTabIndicatorReady,
    planConsoleTabs,
    visiblePlanConsoleTabs,
    resolveDefaultPlanConsoleTab,
    overviewRangeOptions,
    KEY_NAME_PRESETS,
    KEY_LIMIT_MODE_OPTIONS,
    KEY_LIMIT_PRESETS,
    billingRealtimeTimer,
    authStore,
    availableUsd,
    balanceDisplay,
    applyWalletFromSummary,
    refreshWalletBalance,
    runtimeConfigStore,
    route,
    router,
    pricingPageRoot,
    pricingMotion,
    skipSectionMotion,
    activeSection,
    plansLoading,
    plansLoadPromise,
    pricingSettingsLoadPromise,
    resourceLoadPromises,
    pricingModelsLoading,
    pricingPublicModels,
    consoleBooting,
    sectionSwitchPending,
    resourcesLoading,
    referralsLoading,
    accountSettingsLoading,
    checkoutLoading,
    checkoutUiPhase,
    checkoutModalOpen,
    checkoutModalMessage,
    keyActionLoading,
    accountError,
    accountNewSecret,
    checkoutOrder,
    checkoutOptions,
    selectedCheckoutProvider,
    CHECKOUT_PROVIDER_ICONS,
    checkoutProviderCatalog,
    checkoutOrderView,
    checkoutModalPresentation,
    checkoutModalLoading,
    checkoutModalShowManualConfirm,
    checkoutModalShowContinuePay,
    checkoutModalShowCancel,
    checkoutModalShowRefresh,
    checkoutModalShowTestConfirm,
    hasOnlineCheckout,
    checkoutProviderOptions,
    onlineCheckoutProviderOptions,
    isCheckoutProviderConfigured,
    isCheckoutProviderAvailable,
    resolveDefaultCheckoutProvider,
    checkoutProviderLabel,
    isRedirectCheckoutProvider,
    selectCheckoutProvider,
    planOverview,
    resourceSummary,
    referralSummary,
    selectedRechargeAmount,
    walletPanelTab,
    walletTabsRef,
    walletTabButtonRefs,
    walletTabIndicatorStyle,
    walletTabIndicatorReady,
    walletRedeemDraft,
    walletRedeemLoading,
    walletRedeemSuccess,
    walletExchangeDraft,
    walletExchangeLoading,
    walletCustomModalOpen,
    walletCustomDraft,
    walletCustomModalInputRef,
    usageStatusFilter,
    usageModelFilter,
    usageKeyKindFilter,
    modelSearch,
    modelCapabilityFilter,
    modelBillingFilter,
    modelProviderFilter,
    keyAdvancedOpen,
    keyModelSearch,
    keyMenuOpenId,
    keyMenuOpenKey,
    keyMenuStyle,
    keyMenuTriggerEl,
    keyMenuDropdownRef,
    keyCreateModalOpen,
    keyEditModal,
    keyResetModalKey,
    keyResetNewSecret,
    keyRevokeModalKey,
    keyEditingKey,
    keyLimitPeriod,
    keyLimitMode,
    keyLimitAmount,
    keyEditLimitMode,
    keyEditLimitPeriod,
    keyEditLimitSegmentRef,
    keyEditLimitSegmentBtnRefs,
    keyEditLimitSegmentIndicatorStyle,
    keyEditLimitSegmentIndicatorReady,
    keyEditLimitAmount,
    keyEditDailyUnits,
    keyEditMonthlyUnits,
    keyEditModelSearch,
    accountNewSecretKeyId,
    keyEditForm,
    accountKeyForm,
    settingsLoading,
    pricingSettings,
  }
}
