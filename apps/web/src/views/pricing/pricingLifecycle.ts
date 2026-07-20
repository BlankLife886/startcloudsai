export function createPricingLifecycle(dependencies) {
  function handleBillingRealtimeUpdate() {
    window.clearTimeout(dependencies.billingRealtimeTimer)
    dependencies.billingRealtimeTimer = window.setTimeout(() => {
      void Promise.allSettled([
        dependencies.loadPlans(),
        dependencies.authStore.isAuthenticated
          ? dependencies.loadResources({
              silent: true,
              scope: dependencies.activeSection.value === 'wallet' ? 'wallet' : 'usage',
            })
          : Promise.resolve(),
      ])
    }, 240)
  }

  function sectionNeedsBillingBoot(section = dependencies.activeSection.value) {
    return ['overview', 'wallet', 'plans'].includes(String(section || '').trim())
  }

  function sectionNeedsPublicModelsBoot(section = dependencies.activeSection.value) {
    return ['models', 'keys', 'docs'].includes(String(section || '').trim())
  }

  function sectionNeedsUsageBoot(section = dependencies.activeSection.value) {
    return ['overview', 'usage', 'keys', 'wallet'].includes(String(section || '').trim())
  }

  async function bootstrapPricingConsole() {
    dependencies.syncActiveSectionFromRoute()
    const section = dependencies.activeSection.value

    // 路由层会持续显示唯一骨架，组件就绪后直接进入内容，避免再次闪烁骨架。
    await dependencies.nextTick()

    dependencies.pricingMotion?.dispose()
    dependencies.pricingMotion = dependencies.createPricingMotion(dependencies.pricingPageRoot)
    dependencies.pricingMotion?.mount()
    dependencies.pricingMotion?.playPageIntro({ fromBoot: true })
    dependencies.skipSectionMotion = false

    const bootJobs = []
    if (sectionNeedsPublicModelsBoot(section)) {
      bootJobs.push(dependencies.loadPricingPublicModels({ silent: true }))
    }
    if (sectionNeedsBillingBoot(section) || !sectionNeedsPublicModelsBoot(section)) {
      bootJobs.push(dependencies.loadPricingSettings(), dependencies.loadPlans())
    }

    if (sectionNeedsUsageBoot(section)) {
      void dependencies.loadResources({
        silent: true,
        scope: section === 'wallet' ? 'wallet' : 'usage',
      })
    } else if (dependencies.authStore.isAuthenticated) {
      void dependencies.loadResources({ silent: true, scope: 'usage' })
    } else {
      void dependencies.authStore.initAuth({ deferLocalReload: true }).then((user) => {
        if (user?.id) void dependencies.loadResources({ silent: true })
      })
    }
    if (sectionNeedsPublicModelsBoot(section)) {
      void dependencies.loadPricingPublicModels({ includeAvailability: true, silent: true })
    } else {
      void dependencies.runtimeConfigStore.refreshRuntimeConfigInBackground()
    }
    void dependencies.handleCheckoutReturn()
    restorePendingCheckoutOrder()

    await Promise.allSettled(bootJobs)
    if (dependencies.activeSection.value === 'wallet') dependencies.scheduleWalletTabIndicatorSync()
    if (dependencies.activeSection.value === 'plans') dependencies.schedulePlanTabIndicatorSync()
  }

  function restorePendingCheckoutOrder() {
    const pending = dependencies.readPendingCheckout()
    if (!pending?.id) return
    const order = dependencies.commerceOrders.value.find(
      (item) => String(item.id || '') === String(pending.id),
    )
    if (!order) return
    if (String(order.checkoutProvider || '').toLowerCase() !== 'alipay') return
    const status = String(order.status || '')
      .trim()
      .toLowerCase()
    if (status === 'activated' || status === 'cancelled') {
      dependencies.clearPendingCheckout()
      return
    }
    dependencies.checkoutOrder.value = order
    dependencies.syncCheckoutPhaseFromOrder(order, dependencies.CHECKOUT_UI_PHASE.PAYING)
    dependencies.checkoutModalOpen.value = true
  }

  dependencies.watch(
    dependencies.commerceOrders,
    () => {
      if (dependencies.checkoutModalOpen.value) return
      restorePendingCheckoutOrder()
    },
    { deep: true },
  )

  dependencies.onUnmounted(() => {
    window.clearTimeout(dependencies.billingRealtimeTimer)
    dependencies.pricingMotion?.dispose()
    dependencies.pricingMotion = null
    document.removeEventListener('pointerdown', dependencies.handleKeyMenuOutsidePointer, true)
    window.removeEventListener('resize', dependencies.handleKeyMenuViewportChange)
    window.removeEventListener('scroll', dependencies.handleKeyMenuViewportChange, true)
    window.removeEventListener('resize', dependencies.syncWalletTabIndicator)
    window.removeEventListener('resize', dependencies.syncPlanTabIndicator)
    window.removeEventListener('walleven:wallet-updated', handleBillingRealtimeUpdate)
    window.removeEventListener('walleven:subscription-updated', handleBillingRealtimeUpdate)
  })

  return {
    handleBillingRealtimeUpdate,
    sectionNeedsBillingBoot,
    sectionNeedsPublicModelsBoot,
    sectionNeedsUsageBoot,
    bootstrapPricingConsole,
    restorePendingCheckoutOrder,
  }
}
