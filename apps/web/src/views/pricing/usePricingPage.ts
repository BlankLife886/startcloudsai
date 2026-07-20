import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  captureClientPayPalCheckout,
  cancelClientCheckoutOrder,
  confirmClientAlipayCheckout,
  confirmClientCheckoutOrder,
  createClientApiKey,
  createClientCheckoutOrder,
  getClientCheckoutOrder,
  getClientCommercePlans,
  getClientPricingPublicModels,
  getClientPricingSettings,
  getClientReferralSummary,
  getClientResourceSummary,
  listClientApiKeys,
  exchangeClientWalletUsd,
  redeemClientWalletCode,
  resetClientApiKey,
  revokeClientApiKey,
  updateClientApiKey,
} from '@/services/aiWallpaper'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import notificationService from '@/services/notification'
import {
  PRICING_BRAND,
  PRICING_DEFAULT_SECTION,
  PRICING_NAV_GROUPS,
  PRICING_NAV_ITEMS,
  createDefaultPricingSettings,
  getPricingNavItem,
  getPricingSection,
  mergePricingSettings,
} from '@/features/pricing/pricingConsole'
import {
  HEATMAP_WEEKDAY_LABELS,
  OVERVIEW_RANGE_OPTIONS,
  buildOverviewDashboard,
  formatHeatmapDate,
  formatTrendPointDate,
  formatTrendPointValue,
  heatmapActivityLabel,
  overviewRangeSubtitle,
} from '@/features/pricing/pricingOverview'
import {
  buildPublicModelLabelLookup,
  resolveUsageModelLabel,
} from '@/features/pricing/pricingModelLabels'
import {
  buildCheckoutModalPresentation,
  buildCheckoutOrderView,
  CHECKOUT_UI_PHASE,
  clearPendingCheckout,
  parseCheckoutReturnQuery,
  pollAlipayConfirmation,
  readPendingCheckout,
  rememberPendingCheckout,
  resolveAlipayConfirmSuccessMessage,
  sleep,
} from '@/features/pricing/pricingCheckout'
import { buildSubscriptionDashboard } from '@/features/pricing/pricingSubscription'

import {
  PLAN_BILLING_TABS,
  buildClientSubscriptionPeriodView,
  buildSubscriptionPlanCards,
  buildSubscriptionSidebarHint,
  buildSubscriptionOrderDisplay,
  buildWalletRechargeOrderDisplay,
  buildWalletHistoryTimeline,
  filterWalletLedgerRows,
  evaluatePlanPurchaseEligibility,
  formatCommerceOrderAmount,
  formatCommerceOrderId,
  formatCommerceOrderProvider,
  isSubscriptionCommerceOrder,
  resolveCommerceOrderStatusLabel,
  resolveWalletRechargeStatusLabel,
  planBillingAvailability,
  resolveCommerceOrderPlanName,
  resolveCommerceOrderPlanSubtitle,
  resolveCommerceOrderTimeLabel,
  resolveCommercePlanByKey,
  resolveDefaultPlanBillingTab,
  sortCommerceOrdersByCreatedAt,
  shouldUsePlanCatalogMode,
} from '@/features/pricing/pricingPlans'
import {
  accountAvatarInitial,
  buildAccountInfoRows,
  buildAccountSecurityActions,
  resolveAccountRoleLabel,
} from '@/features/pricing/pricingAccountSettings'
import {
  buildSidebarNavGroups,
  filterMobileNavItems,
  PRICING_SIDEBAR_FOOTER_LINKS,
  resolveSidebarNavBadge,
} from '@/features/pricing/pricingSidebar'
import {
  buildReferralInviteUrl,
  buildReferralRewardSummary,
  buildReferralStatsCards,
  buildReferralSteps,
  createEmptyReferralSummary,
  formatReferralOrderHint,
  formatReferralRewardUsd,
  maskReferralUserId,
  referralRecordView,
  resolveReferralProgramConfig,
} from '@/features/pricing/pricingReferrals'
import {
  formatMoneyDisplay,
  formatUsd,
  mergeUsageSummary,
  resolveAvailableUsdBalance,
  resolveWalletSnapshot,
  formatUsdFixed4,
  clampUsd,
  subtractUsd,
} from '@/features/pricing/pricingMoney.js'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import {
  buildKeyKindBreakdown,
  buildKeyKindLookup,
  buildKeyKindUsageCards,
  buildUsageStatsCards,
  buildUsageTokenTotals24h,
  enrichUsageLog,
  formatUsageCostUsd,
  formatUsageDateTime,
  formatUsageDuration,
  formatUsagePhaseTooltip,
  formatTokenCountShort,
  formatUsageTokenLine,
  formatUsageTps,
  httpStatusTone,
  truncateRequestId,
  ttftTone,
  USAGE_KEY_KIND_LABELS,
} from '@/features/pricing/pricingUsage'
import { filterApiGatewayUsageLogs, isStudioPublicModelKey } from '@/features/ai-shared/studioUsage'
import walletRechargeHeroDarkArt from '@/assets/pricing/wallet/black-card-hero.png'
import walletRechargeIconWallet from '@/assets/pricing/wallet/icon-wallet.png'
import walletRechargeIconCheck from '@/assets/pricing/wallet/icon-check.png'
import walletRechargeIconClock from '@/assets/pricing/wallet/icon-clock.png'
import { createPricingMotion } from '@/features/pricing/pricingMotion'
import { overviewNumberDelay } from '@/features/pricing/pricingNumberMotion'
import { prefersReducedMotion } from '@/lib/anime'
import '@/features/pricing/styles/pricing-page.css'
import '@/features/pricing/styles/pricing-page-motion.css'
import { providePricingPageContext } from './pricingPageContext'
import { createPricingModelHelpers } from './pricingModelHelpers'
import { createPricingKeyHelpers } from './pricingKeyHelpers'
import { createPricingTailHelpers } from './pricingTailHelpers'
import { createPricingState } from './pricingState'
import { createPricingComputedState } from './pricingComputedState'
import { createPricingPlanState } from './pricingPlanState'
import { createPricingLifecycle } from './pricingLifecycle'
import { createEmptyResourceSummary, createPricingResources } from './pricingResources'
import { createPricingCheckout } from './pricingCheckoutActions'
import { createPricingActions } from './pricingActions'
import { createPricingGeneralHelpers } from './pricingGeneralHelpers'

export function usePricingPage() {
  const pricingState = createPricingState({
    get CHECKOUT_UI_PHASE() {
      return CHECKOUT_UI_PHASE
    },
    get OVERVIEW_RANGE_OPTIONS() {
      return OVERVIEW_RANGE_OPTIONS
    },
    get PLAN_BILLING_TABS() {
      return PLAN_BILLING_TABS
    },
    get PRICING_DEFAULT_SECTION() {
      return PRICING_DEFAULT_SECTION
    },
    get buildCheckoutModalPresentation() {
      return buildCheckoutModalPresentation
    },
    get buildCheckoutOrderView() {
      return buildCheckoutOrderView
    },
    get commercePlans() {
      return commercePlans
    },
    get computed() {
      return computed
    },
    get createDefaultPricingSettings() {
      return createDefaultPricingSettings
    },
    get createEmptyReferralSummary() {
      return createEmptyReferralSummary
    },
    get createEmptyResourceSummary() {
      return createEmptyResourceSummary
    },
    get isWalletTopupCommerceOrder() {
      return isWalletTopupCommerceOrder
    },
    get reactive() {
      return reactive
    },
    get ref() {
      return ref
    },
    get subscriptionPeriod() {
      return subscriptionPeriod
    },
    get useAuthStore() {
      return useAuthStore
    },
    get useClientWalletBalance() {
      return useClientWalletBalance
    },
    get useRoute() {
      return useRoute
    },
    get useRouter() {
      return useRouter
    },
    get useRuntimeConfigStore() {
      return useRuntimeConfigStore
    },
    get walletRechargeHeroDarkArt() {
      return walletRechargeHeroDarkArt
    },
    get watch() {
      return watch
    },
  })
  const {
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
    authStore,
    availableUsd,
    balanceDisplay,
    applyWalletFromSummary,
    refreshWalletBalance,
    runtimeConfigStore,
    route,
    router,
    pricingPageRoot,
    activeSection,
    plansLoading,
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
  } = pricingState

  // These values are lifecycle handles, not reactive state snapshots. Keep
  // them mutable in the composition root and expose controlled setters to the
  // extracted modules that own their lifecycle.
  let billingRealtimeTimer = pricingState.billingRealtimeTimer
  let pricingMotion = pricingState.pricingMotion
  let skipSectionMotion = pricingState.skipSectionMotion
  let plansLoadPromise = pricingState.plansLoadPromise
  let pricingSettingsLoadPromise = pricingState.pricingSettingsLoadPromise

  const pricingComputedState = createPricingComputedState({
    get PRICING_NAV_GROUPS() {
      return PRICING_NAV_GROUPS
    },
    get PRICING_NAV_ITEMS() {
      return PRICING_NAV_ITEMS
    },
    get PRICING_SIDEBAR_FOOTER_LINKS() {
      return PRICING_SIDEBAR_FOOTER_LINKS
    },
    get accountKeyForm() {
      return accountKeyForm
    },
    get activeSection() {
      return activeSection
    },
    get authStore() {
      return authStore
    },
    get availableUsd() {
      return availableUsd
    },
    get buildIdleAvailabilitySegments() {
      return buildIdleAvailabilitySegments
    },
    get buildKeyKindBreakdown() {
      return buildKeyKindBreakdown
    },
    get buildKeyKindLookup() {
      return buildKeyKindLookup
    },
    get buildKeyKindUsageCards() {
      return buildKeyKindUsageCards
    },
    get buildKeyLimitsPayloadFromState() {
      return buildKeyLimitsPayloadFromState
    },
    get buildModelCardPriceLines() {
      return buildModelCardPriceLines
    },
    get buildModelMarketLine() {
      return buildModelMarketLine
    },
    get buildOverviewDashboard() {
      return buildOverviewDashboard
    },
    get buildPublicModelLabelLookup() {
      return buildPublicModelLabelLookup
    },
    get buildSidebarNavGroups() {
      return buildSidebarNavGroups
    },
    get buildSubscriptionOrderDisplay() {
      return buildSubscriptionOrderDisplay
    },
    get buildUsageStatsCards() {
      return buildUsageStatsCards
    },
    get buildUsageTokenTotals24h() {
      return buildUsageTokenTotals24h
    },
    get buildWalletHistoryTimeline() {
      return buildWalletHistoryTimeline
    },
    get buildWalletRechargeOrderDisplay() {
      return buildWalletRechargeOrderDisplay
    },
    get computed() {
      return computed
    },
    get consoleBooting() {
      return consoleBooting
    },
    get createEmptyResourceSummary() {
      return createEmptyResourceSummary
    },
    get currentPlanLabel() {
      return currentPlanLabel
    },
    get filterApiGatewayUsageLogs() {
      return filterApiGatewayUsageLogs
    },
    get filterMobileNavItems() {
      return filterMobileNavItems
    },
    get filterWalletLedgerRows() {
      return filterWalletLedgerRows
    },
    get formatBillingMode() {
      return formatBillingMode
    },
    get formatKeyLimitCell() {
      return formatKeyLimitCell
    },
    get formatLimitPair() {
      return formatLimitPair
    },
    get formatMoneyDisplay() {
      return formatMoneyDisplay
    },
    get formatUsageModelLabel() {
      return formatUsageModelLabel
    },
    get formatUsdLimitPair() {
      return formatUsdLimitPair
    },
    get getPricingNavItem() {
      return getPricingNavItem
    },
    get getPricingSection() {
      return getPricingSection
    },
    get isPlanUnsubscribed() {
      return isPlanUnsubscribed
    },
    get isStudioPublicModelKey() {
      return isStudioPublicModelKey
    },
    get isSubscriptionCommerceOrder() {
      return isSubscriptionCommerceOrder
    },
    get isWalletTopupCommerceOrder() {
      return isWalletTopupCommerceOrder
    },
    get keyEditDailyUnits() {
      return keyEditDailyUnits
    },
    get keyEditForm() {
      return keyEditForm
    },
    get keyEditLimitAmount() {
      return keyEditLimitAmount
    },
    get keyEditLimitMode() {
      return keyEditLimitMode
    },
    get keyEditLimitPeriod() {
      return keyEditLimitPeriod
    },
    get keyEditModal() {
      return keyEditModal
    },
    get keyEditModelSearch() {
      return keyEditModelSearch
    },
    get keyEditMonthlyUnits() {
      return keyEditMonthlyUnits
    },
    get keyEditingKey() {
      return keyEditingKey
    },
    get keyLimitMode() {
      return keyLimitMode
    },
    get keyModelSearch() {
      return keyModelSearch
    },
    get modelBillingFilter() {
      return modelBillingFilter
    },
    get modelCapabilityFilter() {
      return modelCapabilityFilter
    },
    get modelProviderFilter() {
      return modelProviderFilter
    },
    get modelSearch() {
      return modelSearch
    },
    get normalizeLedgerRow() {
      return normalizeLedgerRow
    },
    get normalizeUsageLog() {
      return normalizeUsageLog
    },
    get overviewInsightsRange() {
      return overviewInsightsRange
    },
    get overviewTrendHoverIndex() {
      return overviewTrendHoverIndex
    },
    get overviewTrendRange() {
      return overviewTrendRange
    },
    get parseLineList() {
      return parseLineList
    },
    get planOverview() {
      return planOverview
    },
    get pricingPublicModels() {
      return pricingPublicModels
    },
    get pricingSettings() {
      return pricingSettings
    },
    get publicModelApiId() {
      return publicModelApiId
    },
    get publicModelId() {
      return publicModelId
    },
    get readModelDiscountLabel() {
      return readModelDiscountLabel
    },
    get readPublicModelIconUrl() {
      return readPublicModelIconUrl
    },
    get readPublicModelTokenPricing() {
      return readPublicModelTokenPricing
    },
    get resolvePublicModelLabel() {
      return resolvePublicModelLabel
    },
    get resourceSummary() {
      return resourceSummary
    },
    get runtimeConfigStore() {
      return runtimeConfigStore
    },
    get sectionSwitchPending() {
      return sectionSwitchPending
    },
    get sortCommerceOrdersByCreatedAt() {
      return sortCommerceOrdersByCreatedAt
    },
    get splitAvailabilityRows() {
      return splitAvailabilityRows
    },
    get subscriptionPeriod() {
      return subscriptionPeriod
    },
    get subscriptionPeriodHint() {
      return subscriptionPeriodHint
    },
    get usageKeyKindFilter() {
      return usageKeyKindFilter
    },
    get usageModelFilter() {
      return usageModelFilter
    },
    get usageStatusFilter() {
      return usageStatusFilter
    },
    get wallpaperCredits() {
      return wallpaperCredits
    },
  })
  const {
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
  } = pricingComputedState

  const pricingPlanState = createPricingPlanState({
    get account() {
      return account
    },
    get accountAvatarInitial() {
      return accountAvatarInitial
    },
    get accountKeyForm() {
      return accountKeyForm
    },
    get accountNewSecretKeyId() {
      return accountNewSecretKeyId
    },
    get activeSection() {
      return activeSection
    },
    get apiKeys() {
      return apiKeys
    },
    get authStore() {
      return authStore
    },
    get bootstrapPricingConsole() {
      return bootstrapPricingConsole
    },
    get buildAccountInfoRows() {
      return buildAccountInfoRows
    },
    get buildAccountSecurityActions() {
      return buildAccountSecurityActions
    },
    get buildClientSubscriptionPeriodView() {
      return buildClientSubscriptionPeriodView
    },
    get buildReferralInviteUrl() {
      return buildReferralInviteUrl
    },
    get buildReferralRewardSummary() {
      return buildReferralRewardSummary
    },
    get buildReferralStatsCards() {
      return buildReferralStatsCards
    },
    get buildReferralSteps() {
      return buildReferralSteps
    },
    get buildSubscriptionDashboard() {
      return buildSubscriptionDashboard
    },
    get buildSubscriptionPlanCards() {
      return buildSubscriptionPlanCards
    },
    get buildSubscriptionSidebarHint() {
      return buildSubscriptionSidebarHint
    },
    get checkoutProviderLabel() {
      return checkoutProviderLabel
    },
    get clampUsd() {
      return clampUsd
    },
    get commercePlans() {
      return commercePlans
    },
    get computed() {
      return computed
    },
    get consoleBooting() {
      return consoleBooting
    },
    get createEmptyReferralSummary() {
      return createEmptyReferralSummary
    },
    get createEmptyResourceSummary() {
      return createEmptyResourceSummary
    },
    get credits() {
      return credits
    },
    get currentPlan() {
      return currentPlan
    },
    get formatEndpoint() {
      return formatEndpoint
    },
    get formatMoneyDisplay() {
      return formatMoneyDisplay
    },
    get handleBillingRealtimeUpdate() {
      return handleBillingRealtimeUpdate
    },
    get handleKeyMenuOutsidePointer() {
      return handleKeyMenuOutsidePointer
    },
    get handleKeyMenuViewportChange() {
      return handleKeyMenuViewportChange
    },
    get isCheckoutProviderAvailable() {
      return isCheckoutProviderAvailable
    },
    get isCheckoutProviderConfigured() {
      return isCheckoutProviderConfigured
    },
    get isRedirectCheckoutProvider() {
      return isRedirectCheckoutProvider
    },
    get loadAccountSettings() {
      return loadAccountSettings
    },
    get loadPricingPublicModels() {
      return loadPricingPublicModels
    },
    get loadReferrals() {
      return loadReferrals
    },
    get loadResources() {
      return loadResources
    },
    get nextTick() {
      return nextTick
    },
    get notificationService() {
      return notificationService
    },
    get onMounted() {
      return onMounted
    },
    get overviewTrendHoverIndex() {
      return overviewTrendHoverIndex
    },
    get overviewTrendRange() {
      return overviewTrendRange
    },
    get planBillingAvailability() {
      return planBillingAvailability
    },
    get planBillingTab() {
      return planBillingTab
    },
    get planConsoleTab() {
      return planConsoleTab
    },
    get planPriceParts() {
      return planPriceParts
    },
    get prefersReducedMotion() {
      return prefersReducedMotion
    },
    get pricedModels() {
      return pricedModels
    },
    get pricingMotion() {
      return pricingMotion
    },
    get pricingPageRoot() {
      return pricingPageRoot
    },
    get pricingPublicModels() {
      return pricingPublicModels
    },
    get pricingSettings() {
      return pricingSettings
    },
    get ref() {
      return ref
    },
    get referralSummary() {
      return referralSummary
    },
    get refreshWalletBalance() {
      return refreshWalletBalance
    },
    get resolveAccountRoleLabel() {
      return resolveAccountRoleLabel
    },
    get resolveAvailableUsdBalance() {
      return resolveAvailableUsdBalance
    },
    get resolveCommerceOrderPlanName() {
      return resolveCommerceOrderPlanName
    },
    get resolveCommercePlanByKey() {
      return resolveCommercePlanByKey
    },
    get resolveDefaultPlanBillingTab() {
      return resolveDefaultPlanBillingTab
    },
    get resolveDefaultPlanConsoleTab() {
      return resolveDefaultPlanConsoleTab
    },
    get resolveReferralProgramConfig() {
      return resolveReferralProgramConfig
    },
    get resourceSummary() {
      return resourceSummary
    },
    get route() {
      return route
    },
    get runtimeConfigStore() {
      return runtimeConfigStore
    },
    get sectionNeedsPublicModelsBoot() {
      return sectionNeedsPublicModelsBoot
    },
    get sectionNeedsUsageBoot() {
      return sectionNeedsUsageBoot
    },
    get sectionSwitchPending() {
      return sectionSwitchPending
    },
    get selectedCheckoutProvider() {
      return selectedCheckoutProvider
    },
    get selectedRechargeAmount() {
      return selectedRechargeAmount
    },
    get shouldUsePlanCatalogMode() {
      return shouldUsePlanCatalogMode
    },
    get skipSectionMotion() {
      return skipSectionMotion
    },
    get summarizePlanEntitlements() {
      return summarizePlanEntitlements
    },
    get syncActiveSectionFromRoute() {
      return syncActiveSectionFromRoute
    },
    get syncPlanTabIndicator() {
      return syncPlanTabIndicator
    },
    get syncWalletTabIndicator() {
      return syncWalletTabIndicator
    },
    get usage() {
      return usage
    },
    get visiblePlanConsoleTabs() {
      return visiblePlanConsoleTabs
    },
    get walletCustomDraft() {
      return walletCustomDraft
    },
    get walletCustomModalInputRef() {
      return walletCustomModalInputRef
    },
    get walletCustomModalOpen() {
      return walletCustomModalOpen
    },
    get walletExchangeDraft() {
      return walletExchangeDraft
    },
    get walletRechargeCatalog() {
      return walletRechargeCatalog
    },
    get watch() {
      return watch
    },
  })
  const {
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
  } = pricingPlanState

  const pricingLifecycle = createPricingLifecycle({
    get CHECKOUT_UI_PHASE() {
      return CHECKOUT_UI_PHASE
    },
    get activeSection() {
      return activeSection
    },
    get authStore() {
      return authStore
    },
    get billingRealtimeTimer() {
      return billingRealtimeTimer
    },
    set billingRealtimeTimer(value) {
      billingRealtimeTimer = value
    },
    get checkoutModalOpen() {
      return checkoutModalOpen
    },
    get checkoutOrder() {
      return checkoutOrder
    },
    get clearPendingCheckout() {
      return clearPendingCheckout
    },
    get commerceOrders() {
      return commerceOrders
    },
    get createPricingMotion() {
      return createPricingMotion
    },
    get handleCheckoutReturn() {
      return handleCheckoutReturn
    },
    get handleKeyMenuOutsidePointer() {
      return handleKeyMenuOutsidePointer
    },
    get handleKeyMenuViewportChange() {
      return handleKeyMenuViewportChange
    },
    get loadPlans() {
      return loadPlans
    },
    get loadPricingPublicModels() {
      return loadPricingPublicModels
    },
    get loadPricingSettings() {
      return loadPricingSettings
    },
    get loadResources() {
      return loadResources
    },
    get nextTick() {
      return nextTick
    },
    get onUnmounted() {
      return onUnmounted
    },
    get pricingMotion() {
      return pricingMotion
    },
    set pricingMotion(value) {
      pricingMotion = value
    },
    get pricingPageRoot() {
      return pricingPageRoot
    },
    get readPendingCheckout() {
      return readPendingCheckout
    },
    get runtimeConfigStore() {
      return runtimeConfigStore
    },
    get schedulePlanTabIndicatorSync() {
      return schedulePlanTabIndicatorSync
    },
    get scheduleWalletTabIndicatorSync() {
      return scheduleWalletTabIndicatorSync
    },
    get skipSectionMotion() {
      return skipSectionMotion
    },
    set skipSectionMotion(value) {
      skipSectionMotion = value
    },
    get syncActiveSectionFromRoute() {
      return syncActiveSectionFromRoute
    },
    get syncCheckoutPhaseFromOrder() {
      return syncCheckoutPhaseFromOrder
    },
    get syncPlanTabIndicator() {
      return syncPlanTabIndicator
    },
    get syncWalletTabIndicator() {
      return syncWalletTabIndicator
    },
    get watch() {
      return watch
    },
  })
  const {
    handleBillingRealtimeUpdate,
    sectionNeedsBillingBoot,
    sectionNeedsPublicModelsBoot,
    sectionNeedsUsageBoot,
    bootstrapPricingConsole,
    restorePendingCheckoutOrder,
  } = pricingLifecycle

  const pricingResources = createPricingResources({
    get PRICING_DEFAULT_SECTION() {
      return PRICING_DEFAULT_SECTION
    },
    get accountError() {
      return accountError
    },
    get accountSettingsLoading() {
      return accountSettingsLoading
    },
    get activeSection() {
      return activeSection
    },
    get applyWalletFromSummary() {
      return applyWalletFromSummary
    },
    get authStore() {
      return authStore
    },
    get checkoutOptions() {
      return checkoutOptions
    },
    get checkoutProviderCatalog() {
      return checkoutProviderCatalog
    },
    get createDefaultPricingSettings() {
      return createDefaultPricingSettings
    },
    get createEmptyReferralSummary() {
      return createEmptyReferralSummary
    },
    get getClientCommercePlans() {
      return getClientCommercePlans
    },
    get getClientPricingPublicModels() {
      return getClientPricingPublicModels
    },
    get getClientPricingSettings() {
      return getClientPricingSettings
    },
    get getClientReferralSummary() {
      return getClientReferralSummary
    },
    get getClientResourceSummary() {
      return getClientResourceSummary
    },
    get internalNavItems() {
      return internalNavItems
    },
    get keyEditLimitPeriod() {
      return keyEditLimitPeriod
    },
    get keyEditLimitSegmentBtnRefs() {
      return keyEditLimitSegmentBtnRefs
    },
    get keyEditLimitSegmentIndicatorReady() {
      return keyEditLimitSegmentIndicatorReady
    },
    get keyEditLimitSegmentIndicatorStyle() {
      return keyEditLimitSegmentIndicatorStyle
    },
    get keyEditLimitSegmentRef() {
      return keyEditLimitSegmentRef
    },
    get keyEditModal() {
      return keyEditModal
    },
    get mergePricingSettings() {
      return mergePricingSettings
    },
    get mergeUsageSummary() {
      return mergeUsageSummary
    },
    get nextTick() {
      return nextTick
    },
    get notificationService() {
      return notificationService
    },
    get planConsoleTab() {
      return planConsoleTab
    },
    get planOverview() {
      return planOverview
    },
    get planTabButtonRefs() {
      return planTabButtonRefs
    },
    get planTabIndicatorReady() {
      return planTabIndicatorReady
    },
    get planTabIndicatorStyle() {
      return planTabIndicatorStyle
    },
    get planTabsRef() {
      return planTabsRef
    },
    get plansLoadPromise() {
      return plansLoadPromise
    },
    set plansLoadPromise(value) {
      plansLoadPromise = value
    },
    get plansLoading() {
      return plansLoading
    },
    get prefersReducedMotion() {
      return prefersReducedMotion
    },
    get pricingModelsLoading() {
      return pricingModelsLoading
    },
    get pricingPublicModels() {
      return pricingPublicModels
    },
    get pricingSettings() {
      return pricingSettings
    },
    get pricingSettingsLoadPromise() {
      return pricingSettingsLoadPromise
    },
    set pricingSettingsLoadPromise(value) {
      pricingSettingsLoadPromise = value
    },
    get referralSummary() {
      return referralSummary
    },
    get referralsLoading() {
      return referralsLoading
    },
    get resolveWalletSnapshot() {
      return resolveWalletSnapshot
    },
    get resourceLoadPromises() {
      return resourceLoadPromises
    },
    get resourceSummary() {
      return resourceSummary
    },
    get resourcesLoading() {
      return resourcesLoading
    },
    get route() {
      return route
    },
    get router() {
      return router
    },
    get runtimeConfigStore() {
      return runtimeConfigStore
    },
    get sectionSwitchPending() {
      return sectionSwitchPending
    },
    get settingsLoading() {
      return settingsLoading
    },
    get skipSectionMotion() {
      return skipSectionMotion
    },
    get visibleNavItems() {
      return visibleNavItems
    },
    get visiblePlanConsoleTabs() {
      return visiblePlanConsoleTabs
    },
    get walletPanelTab() {
      return walletPanelTab
    },
    get walletTabButtonRefs() {
      return walletTabButtonRefs
    },
    get walletTabIndicatorReady() {
      return walletTabIndicatorReady
    },
    get walletTabIndicatorStyle() {
      return walletTabIndicatorStyle
    },
    get walletTabsRef() {
      return walletTabsRef
    },
    get watch() {
      return watch
    },
  })
  const {
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
  } = pricingResources

  // Route synchronization depends on pricingResources. Register it only after
  // the resource module has created the handlers to avoid setup-time TDZ access.
  watch(
    () => route.query.section,
    () => syncActiveSectionFromRoute(),
    { immediate: true },
  )

  const pricingCheckout = createPricingCheckout({
    get CHECKOUT_UI_PHASE() {
      return CHECKOUT_UI_PHASE
    },
    get authStore() {
      return authStore
    },
    get availableUsd() {
      return availableUsd
    },
    get cancelClientCheckoutOrder() {
      return cancelClientCheckoutOrder
    },
    get captureClientPayPalCheckout() {
      return captureClientPayPalCheckout
    },
    get checkoutLoading() {
      return checkoutLoading
    },
    get checkoutModalMessage() {
      return checkoutModalMessage
    },
    get checkoutModalOpen() {
      return checkoutModalOpen
    },
    get checkoutOptions() {
      return checkoutOptions
    },
    get checkoutOrder() {
      return checkoutOrder
    },
    get checkoutOrderView() {
      return checkoutOrderView
    },
    get checkoutProviderLabel() {
      return checkoutProviderLabel
    },
    get checkoutUiPhase() {
      return checkoutUiPhase
    },
    get clearPendingCheckout() {
      return clearPendingCheckout
    },
    get commerceOrders() {
      return commerceOrders
    },
    get commercePlans() {
      return commercePlans
    },
    get confirmClientAlipayCheckout() {
      return confirmClientAlipayCheckout
    },
    get confirmClientCheckoutOrder() {
      return confirmClientCheckoutOrder
    },
    get createClientCheckoutOrder() {
      return createClientCheckoutOrder
    },
    get currentPlan() {
      return currentPlan
    },
    get evaluatePlanPurchaseEligibility() {
      return evaluatePlanPurchaseEligibility
    },
    get getClientCheckoutOrder() {
      return getClientCheckoutOrder
    },
    get handleSubscriptionActivated() {
      return handleSubscriptionActivated
    },
    get isCheckoutProviderAvailable() {
      return isCheckoutProviderAvailable
    },
    get isCheckoutProviderConfigured() {
      return isCheckoutProviderConfigured
    },
    get isRedirectCheckoutProvider() {
      return isRedirectCheckoutProvider
    },
    get isWalletTopupCommerceOrder() {
      return isWalletTopupCommerceOrder
    },
    get isWalletTopupPlan() {
      return isWalletTopupPlan
    },
    get loadPlans() {
      return loadPlans
    },
    get loadResources() {
      return loadResources
    },
    get notificationService() {
      return notificationService
    },
    get parseCheckoutReturnQuery() {
      return parseCheckoutReturnQuery
    },
    get planOverview() {
      return planOverview
    },
    get pollAlipayConfirmation() {
      return pollAlipayConfirmation
    },
    get rememberPendingCheckout() {
      return rememberPendingCheckout
    },
    get resolveAlipayConfirmSuccessMessage() {
      return resolveAlipayConfirmSuccessMessage
    },
    get resolveDefaultCheckoutProvider() {
      return resolveDefaultCheckoutProvider
    },
    get route() {
      return route
    },
    get router() {
      return router
    },
    get selectSection() {
      return selectSection
    },
    get selectedCheckoutProvider() {
      return selectedCheckoutProvider
    },
    get sleep() {
      return sleep
    },
  })
  const {
    handleAccountLogout,
    handleAccountSecurityAction,
    openCheckoutModal,
    closeCheckoutModal,
    syncCheckoutPhaseFromOrder,
    resolveAlipaySuccessMessage,
    applyAlipayConfirmationResult,
    confirmAlipayCheckoutWithRetry,
    redirectToCheckout,
    handleCheckoutReturn,
    purchasePlan,
    canPayPlanWithWallet,
    confirmOrder,
    confirmAlipayOrder,
    openCheckoutOrderStatus,
    cancelCheckoutOrder,
    handleCheckoutModalClose,
    refreshCheckoutStatus,
  } = pricingCheckout

  const pricingActions = createPricingActions({
    get account() {
      return account
    },
    get accountKeyForm() {
      return accountKeyForm
    },
    get accountNewSecret() {
      return accountNewSecret
    },
    get accountNewSecretKeyId() {
      return accountNewSecretKeyId
    },
    get applyWalletFromSummary() {
      return applyWalletFromSummary
    },
    get authStore() {
      return authStore
    },
    get availableUsd() {
      return availableUsd
    },
    get buildKeyLimitsPayloadFromState() {
      return buildKeyLimitsPayloadFromState
    },
    get createClientApiKey() {
      return createClientApiKey
    },
    get exchangeClientWalletUsd() {
      return exchangeClientWalletUsd
    },
    get formatCredits() {
      return formatCredits
    },
    get formatMoneyDisplay() {
      return formatMoneyDisplay
    },
    get isSubscriptionApiKey() {
      return isSubscriptionApiKey
    },
    get keyActionLoading() {
      return keyActionLoading
    },
    get keyAllowAllModels() {
      return keyAllowAllModels
    },
    get keyCreateModalOpen() {
      return keyCreateModalOpen
    },
    get keyLimitAmount() {
      return keyLimitAmount
    },
    get keyLimitMode() {
      return keyLimitMode
    },
    get keyLimitPeriod() {
      return keyLimitPeriod
    },
    get keyResetModalKey() {
      return keyResetModalKey
    },
    get keyResetNewSecret() {
      return keyResetNewSecret
    },
    get keyRevokeModalKey() {
      return keyRevokeModalKey
    },
    get loadResources() {
      return loadResources
    },
    get mergeResourceSummary() {
      return mergeResourceSummary
    },
    get notificationService() {
      return notificationService
    },
    get parseLineList() {
      return parseLineList
    },
    get planConsoleTab() {
      return planConsoleTab
    },
    get pricingSettings() {
      return pricingSettings
    },
    get purchasePlan() {
      return purchasePlan
    },
    get redeemClientWalletCode() {
      return redeemClientWalletCode
    },
    get resetClientApiKey() {
      return resetClientApiKey
    },
    get resetKeyFormState() {
      return resetKeyFormState
    },
    get resolveDefaultPlanConsoleTab() {
      return resolveDefaultPlanConsoleTab
    },
    get resourceSummary() {
      return resourceSummary
    },
    get revokeClientApiKey() {
      return revokeClientApiKey
    },
    get selectSection() {
      return selectSection
    },
    get selectedCheckoutProvider() {
      return selectedCheckoutProvider
    },
    get selectedRechargeAmount() {
      return selectedRechargeAmount
    },
    get updateClientApiKey() {
      return updateClientApiKey
    },
    get validateKeyCountLimits() {
      return validateKeyCountLimits
    },
    get walletExchangeDraft() {
      return walletExchangeDraft
    },
    get walletExchangeLoading() {
      return walletExchangeLoading
    },
    get walletExchangePreviewCredits() {
      return walletExchangePreviewCredits
    },
    get walletRedeemDraft() {
      return walletRedeemDraft
    },
    get walletRedeemLoading() {
      return walletRedeemLoading
    },
    get walletRedeemSuccess() {
      return walletRedeemSuccess
    },
    get walletTopupPlanByUsd() {
      return walletTopupPlanByUsd
    },
    get warnKeyLimitAboveWalletBalance() {
      return warnKeyLimitAboveWalletBalance
    },
  })
  const {
    createPlatformKey,
    togglePlatformKeyStatus,
    confirmKeyReset,
    openKeyResetModal,
    closeKeyResetModal,
    openKeyRevokeModal,
    closeKeyRevokeModal,
    confirmKeyRevoke,
    copyText,
    buildRechargeUrl,
    goRecharge,
    goSubscribe,
    goManageSubscription,
    rechargeWallet,
    redeemWalletCode,
    exchangeWalletUsd,
  } = pricingActions

  const pricingModelHelpers = createPricingModelHelpers({
    formatMoneyDisplay,
    formatUsd,
    modelSearch,
    modelCapabilityFilter,
    modelBillingFilter,
    modelProviderFilter,
  })
  const {
    publicModelId,
    publicModelApiId,
    readPublicModelTokenPricing,
    formatModelUnitPrice,
    formatCompactUsd,
    formatModelIoPrice,
    readModelPricingMeta,
    PUBLIC_MODEL_CACHE_PRICE_KEYS,
    hasPositivePricingField,
    hasPublicModelCachePricing,
    readOfficialInputPrice,
    formatModelCardPriceAmount,
    buildModelMarketLine,
    buildModelCardPriceLines,
    formatModelCardPrimaryLine,
    readModelDiscountLabel,
    readPublicModelIconUrl,
    buildIdleAvailabilitySegments,
    splitAvailabilityRows,
    formatAvailabilityPercent,
    formatAvailabilityTitle,
    clearModelFilters,
  } = pricingModelHelpers

  const pricingGeneralHelpers = createPricingGeneralHelpers({
    get enrichUsageLog() {
      return enrichUsageLog
    },
    get formatUsageModelLabel() {
      return formatUsageModelLabel
    },
    get formatUsdFixed4() {
      return formatUsdFixed4
    },
    get resolveCommerceOrderStatusLabel() {
      return resolveCommerceOrderStatusLabel
    },
    get resolveWalletRechargeStatusLabel() {
      return resolveWalletRechargeStatusLabel
    },
    get usageKeyKindLookup() {
      return usageKeyKindLookup
    },
  })
  const {
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
  } = pricingGeneralHelpers

  const pricingTailHelpers = createPricingTailHelpers({
    usageStatusFilter,
    usageModelFilter,
    usageKeyKindFilter,
    USAGE_KEY_KIND_LABELS,
    httpStatusTone,
    ttftTone,
    formatMoneyDisplay,
    formatCompactNumber,
  })
  const {
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
  } = pricingTailHelpers

  const pricingKeyHelpers = createPricingKeyHelpers({
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
  })
  const {
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
  } = pricingKeyHelpers

  const pricingPageContext = {
    ...pricingState,
    ...pricingComputedState,
    ...pricingPlanState,
    ...pricingLifecycle,
    ...pricingResources,
    ...pricingCheckout,
    ...pricingActions,
    ...pricingModelHelpers,
    ...pricingGeneralHelpers,
    ...pricingTailHelpers,
    ...pricingKeyHelpers,
    ref,
    PRICING_BRAND,
    HEATMAP_WEEKDAY_LABELS,
    formatHeatmapDate,
    formatTrendPointDate,
    formatTrendPointValue,
    heatmapActivityLabel,
    overviewRangeSubtitle,
    resolveSidebarNavBadge,
    formatReferralOrderHint,
    formatReferralRewardUsd,
    maskReferralUserId,
    referralRecordView,
    formatMoneyDisplay,
    formatUsageCostUsd,
    formatUsageDateTime,
    formatUsageDuration,
    formatUsagePhaseTooltip,
    formatTokenCountShort,
    formatUsageTokenLine,
    formatUsageTps,
    truncateRequestId,
    walletRechargeIconWallet,
    walletRechargeIconCheck,
    walletRechargeIconClock,
    overviewNumberDelay,
  }
  providePricingPageContext(pricingPageContext)
  return pricingPageContext
}
