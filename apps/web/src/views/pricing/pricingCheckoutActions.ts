export function createPricingCheckout(dependencies) {
  async function handleAccountLogout() {
    try {
      await dependencies.authStore.logout()
      dependencies.notificationService.success('已退出登录')
      dependencies.router.push({
        name: 'auth',
        query: { mode: 'login', redirect: '/pricing?section=settings' },
      })
    } catch {
      dependencies.notificationService.error('退出登录失败')
    }
  }

  function handleAccountSecurityAction(action = {}) {
    if (action.action === 'logout') {
      void handleAccountLogout()
    }
  }

  function openCheckoutModal(phase = dependencies.CHECKOUT_UI_PHASE.PAYING, message = '') {
    dependencies.checkoutUiPhase.value = phase
    dependencies.checkoutModalMessage.value = message
    dependencies.checkoutModalOpen.value = true
  }

  function closeCheckoutModal(clearOrder = false) {
    dependencies.checkoutModalOpen.value = false
    dependencies.checkoutModalMessage.value = ''
    if (clearOrder) {
      dependencies.checkoutOrder.value = null
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.IDLE
      dependencies.clearPendingCheckout()
    }
  }

  function syncCheckoutPhaseFromOrder(
    order,
    fallbackPhase = dependencies.CHECKOUT_UI_PHASE.PAYING,
  ) {
    const status = String(order?.status || '')
      .trim()
      .toLowerCase()
    if (status === 'activated') {
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.SUCCESS
      return
    }
    if (status === 'paid' || status === 'activating') {
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.CONFIRMING
      return
    }
    if (status === 'expired') {
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.EXPIRED
      return
    }
    if (status === 'cancelled') {
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.CANCELLED
      return
    }
    if (status === 'failed') {
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.FAILED
      return
    }
    dependencies.checkoutUiPhase.value = fallbackPhase
  }

  function resolveAlipaySuccessMessage(result = {}, order = null) {
    const target = order || result?.order || dependencies.checkoutOrder.value || {}
    return dependencies.resolveAlipayConfirmSuccessMessage({
      isWalletTopup: dependencies.isWalletTopupCommerceOrder(target),
      subscriptionApiKey: result?.subscriptionApiKey || null,
    })
  }

  async function applyAlipayConfirmationResult(confirm = {}, options = {}) {
    if (confirm.current) dependencies.planOverview.value.current = confirm.current
    dependencies.checkoutOrder.value = confirm.order || dependencies.checkoutOrder.value
    await dependencies.loadPlans()
    await dependencies.handleSubscriptionActivated(confirm, {
      reloadResources: options.reloadResources !== false,
    })
    const status = String(dependencies.checkoutOrder.value?.status || '')
      .trim()
      .toLowerCase()
    if (status === 'activated') {
      dependencies.clearPendingCheckout()
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.SUCCESS
      dependencies.checkoutModalOpen.value = true
    } else if (status === 'paid' || status === 'activating') {
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.CONFIRMING
      dependencies.checkoutModalMessage.value = '支付已确认，正在开通套餐…'
      dependencies.checkoutModalOpen.value = true
    }
  }

  async function confirmAlipayCheckoutWithRetry(orderId, options = {}) {
    const id = String(orderId || '').trim()
    if (!id) throw new Error('订单号无效')
    const confirmOnce = () => dependencies.confirmClientAlipayCheckout(id)
    if (options.poll) {
      return dependencies.pollAlipayConfirmation(confirmOnce, {
        maxAttempts: options.maxAttempts || 6,
        intervalMs: options.intervalMs || 2000,
      })
    }
    return confirmOnce()
  }

  async function redirectToCheckout(url = '', provider = '') {
    const target = String(url || '').trim()
    if (!target) return
    const providerId = String(provider || '')
      .trim()
      .toLowerCase()
    if (providerId === 'alipay') {
      openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.REDIRECTING)
      await dependencies.sleep(900)
    }
    window.location.assign(target)
  }

  async function handleCheckoutReturn() {
    const parsed = dependencies.parseCheckoutReturnQuery(dependencies.route.query || {})
    const {
      orderId,
      success,
      cancelled,
      provider: returnProvider,
      section: returnSection,
      paypalToken,
    } = parsed
    if (!success && !cancelled && !orderId) return

    if (returnSection) dependencies.selectSection(returnSection)

    let handledReturn = false
    if (cancelled && orderId) {
      handledReturn = true
      if (dependencies.authStore.isAuthenticated) {
        try {
          const cancelResult = await dependencies.cancelClientCheckoutOrder(orderId)
          if (cancelResult?.order) dependencies.checkoutOrder.value = cancelResult.order
        } catch {
          // 可能已支付、过期或已取消，下面 loadPlans 会同步最新状态
        }
      }
      await dependencies.loadPlans()
      const order = dependencies.commerceOrders.value.find(
        (item) => String(item.id || '') === orderId,
      )
      if (order) dependencies.checkoutOrder.value = order
      syncCheckoutPhaseFromOrder(order || {}, dependencies.CHECKOUT_UI_PHASE.CANCELLED)
      dependencies.checkoutModalOpen.value = true
      dependencies.notificationService.warning('支付已取消，订单未扣款')
    } else if (
      success &&
      orderId &&
      returnProvider === 'alipay' &&
      dependencies.authStore.isAuthenticated
    ) {
      handledReturn = true
      openCheckoutModal(
        dependencies.CHECKOUT_UI_PHASE.CONFIRMING,
        '正在向支付宝确认付款结果，请稍候…',
      )
      try {
        const confirm = await confirmAlipayCheckoutWithRetry(orderId, { poll: true })
        await applyAlipayConfirmationResult(confirm, { reloadResources: true })
        const walletTopup =
          returnSection === 'wallet' ||
          dependencies.isWalletTopupCommerceOrder(
            confirm.order ||
              dependencies.commerceOrders.value.find((item) => String(item.id || '') === orderId) ||
              {},
          )
        dependencies.notificationService.success(
          dependencies.resolveAlipayConfirmSuccessMessage({
            isWalletTopup: walletTopup,
            subscriptionApiKey: confirm.subscriptionApiKey || null,
          }),
        )
      } catch (error) {
        await dependencies.loadPlans()
        if (dependencies.authStore.isAuthenticated) {
          await dependencies.loadResources({ silent: true })
        }
        const pending = dependencies.commerceOrders.value.find(
          (item) => String(item.id || '') === orderId,
        )
        if (pending) dependencies.checkoutOrder.value = pending
        openCheckoutModal(
          dependencies.CHECKOUT_UI_PHASE.UNPAID,
          error?.message || '暂未检测到支付结果，如已完成付款请点击「我已完成支付」。',
        )
      }
    } else if (
      success &&
      orderId &&
      paypalToken &&
      returnProvider === 'paypal' &&
      dependencies.authStore.isAuthenticated
    ) {
      handledReturn = true
      try {
        const capture = await dependencies.captureClientPayPalCheckout(orderId, { paypalToken })
        if (capture.current) dependencies.planOverview.value.current = capture.current
        await dependencies.loadPlans()
        await dependencies.handleSubscriptionActivated(capture, { reloadResources: true })
        dependencies.notificationService.success(
          capture.subscriptionApiKey?.key
            ? 'PayPal 支付成功，订阅密钥已生成'
            : 'PayPal 支付成功，套餐已开通',
        )
      } catch (error) {
        dependencies.notificationService.error(error?.message || 'PayPal 扣款失败')
      }
    } else {
      await dependencies.loadPlans()
      if (dependencies.authStore.isAuthenticated) {
        await dependencies.loadResources({ silent: true })
      }
    }

    const order = dependencies.commerceOrders.value.find(
      (item) => String(item.id || '') === orderId,
    )
    const walletTopup = order?.planKey
      ? dependencies.isWalletTopupPlan(
          dependencies.commercePlans.value.find((plan) => plan.planKey === order.planKey) || {},
        )
      : returnSection === 'wallet'
    if (!handledReturn && success && order) {
      dependencies.checkoutOrder.value = order
      syncCheckoutPhaseFromOrder(order, dependencies.CHECKOUT_UI_PHASE.UNPAID)
      dependencies.checkoutModalOpen.value = true
      const status = String(order.status || '')
        .trim()
        .toLowerCase()
      if (status === 'activated') {
        dependencies.notificationService.success(
          walletTopup ? '充值成功，余额已到账' : '支付成功，套餐已开通',
        )
      } else if (status === 'paid' || status === 'activating') {
        dependencies.checkoutModalMessage.value = '支付已确认，正在开通套餐…'
        dependencies.notificationService.info('支付已确认，正在开通套餐')
      } else if (returnProvider === 'alipay') {
        dependencies.checkoutModalMessage.value =
          '已返回本站。若你已完成付款，请点击「我已完成支付」；若尚未付款，可继续支付。'
      } else {
        dependencies.notificationService.info(
          walletTopup
            ? '已返回支付成功页，正在等待入账'
            : '已返回支付成功页，正在等待支付回调开通套餐',
        )
      }
    } else if (order && !cancelled) {
      dependencies.checkoutOrder.value = order
    }

    const nextQuery = { ...(dependencies.route.query || {}) }
    ;[
      'order_id',
      'orderId',
      'out_trade_no',
      'checkout_success',
      'payment_success',
      'checkout_cancel',
      'payment_cancel',
      'section',
      'provider',
      'token',
      'PayerID',
      'charset',
      'method',
      'sign',
      'sign_type',
      'timestamp',
      'version',
      'app_id',
      'auth_app_id',
      'seller_id',
      'trade_no',
    ].forEach((key) => {
      delete nextQuery[key]
    })
    dependencies.router.replace({ path: dependencies.route.path, query: nextQuery }).catch(() => {})
  }

  async function purchasePlan(plan, options = {}) {
    if (!dependencies.authStore.isAuthenticated) {
      dependencies.notificationService.warning('请先登录后再购买套餐')
      return
    }
    const planKey = String(plan?.planKey || '')
    if (!planKey) return
    const purchase = dependencies.evaluatePlanPurchaseEligibility(
      plan,
      dependencies.currentPlan.value,
    )
    if (!purchase.allowed) {
      dependencies.notificationService.warning(purchase.reason || '当前不能购买该套餐')
      return
    }
    const priceCents = Number(plan?.priceCents || 0)
    if (priceCents <= 0) {
      dependencies.notificationService.warning('当前不提供免费套餐')
      return
    }
    const walletTopup = dependencies.isWalletTopupPlan(plan)
    const checkoutSection = walletTopup ? 'wallet' : 'plans'
    const provider = String(
      options.provider ||
        dependencies.selectedCheckoutProvider.value ||
        dependencies.resolveDefaultCheckoutProvider(),
    )
    if (!dependencies.isCheckoutProviderAvailable(provider)) {
      dependencies.notificationService.warning('该支付方式未开放，请选择其他支付方式')
      return
    }
    if (!dependencies.isCheckoutProviderConfigured(provider)) {
      dependencies.notificationService.warning(
        `${dependencies.checkoutProviderLabel(provider)} 尚未完成配置，请联系管理员`,
      )
      return
    }
    if (provider === 'wallet' && dependencies.availableUsd.value + 1e-9 < priceCents / 100) {
      dependencies.notificationService.warning('余额不太够完成这次购买，可以先充值，或改用在线支付')
      return
    }
    dependencies.checkoutLoading.value = planKey
    openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.CREATING)
    try {
      const data = await dependencies.createClientCheckoutOrder({
        planKey,
        provider,
        returnUrl: `${window.location.origin}/pricing?section=${checkoutSection}`,
      })
      dependencies.checkoutOrder.value = data.order || null
      if (data.order?.id && dependencies.isRedirectCheckoutProvider(data.order?.checkoutProvider)) {
        dependencies.rememberPendingCheckout(data.order)
      }
      if (data.current) dependencies.planOverview.value.current = data.current
      await dependencies.loadPlans()
      if (provider === 'wallet' || data.order?.checkoutProvider === 'wallet') {
        closeCheckoutModal(true)
        if (!walletTopup) {
          await dependencies.handleSubscriptionActivated(data)
          dependencies.notificationService.success(
            data.subscriptionApiKey?.key ? '订阅已开通，订阅密钥已生成' : '订阅已开通',
          )
        } else {
          dependencies.notificationService.success('余额已到账')
          if (dependencies.authStore.isAuthenticated)
            await dependencies.loadResources({ silent: true })
        }
      } else if (
        dependencies.checkoutOrder.value?.checkoutUrl &&
        dependencies.isRedirectCheckoutProvider(dependencies.checkoutOrder.value?.checkoutProvider)
      ) {
        const redirectProvider = dependencies.checkoutOrder.value.checkoutProvider
        openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.PAYING)
        if (redirectProvider === 'alipay') {
          await redirectToCheckout(dependencies.checkoutOrder.value.checkoutUrl, redirectProvider)
        } else {
          dependencies.notificationService.success(
            `正在前往${dependencies.checkoutProviderLabel(redirectProvider)}支付页`,
          )
          window.location.assign(dependencies.checkoutOrder.value.checkoutUrl)
        }
      } else if (
        dependencies.checkoutOrder.value?.checkoutProvider === 'manual' &&
        dependencies.checkoutOptions.value.testCheckoutEnabled
      ) {
        openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.PAYING)
        dependencies.notificationService.success('测试订单已创建，请点击「确认测试支付」完成订阅')
      } else {
        openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.PAYING)
        dependencies.notificationService.success('订单已创建，请完成支付')
      }
    } catch (error) {
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.FAILED
      dependencies.checkoutModalMessage.value = error?.message || '订单创建失败'
      dependencies.checkoutModalOpen.value = true
      dependencies.notificationService.error(error?.message || '订单创建失败')
    } finally {
      dependencies.checkoutLoading.value = ''
    }
  }

  function canPayPlanWithWallet(plan = {}) {
    const priceCents = Number(plan?.priceCents || 0)
    if (priceCents <= 0) return false
    return dependencies.availableUsd.value + 1e-9 >= priceCents / 100
  }

  async function confirmOrder(order = dependencies.checkoutOrder.value) {
    if (!order?.id) return
    dependencies.checkoutLoading.value = order.planKey || order.id
    openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.CONFIRMING, '正在确认测试支付…')
    try {
      const data = await dependencies.confirmClientCheckoutOrder(order.id, {
        providerReference: `manual-${Date.now()}`,
      })
      dependencies.checkoutOrder.value = data.order || null
      if (data.current) dependencies.planOverview.value.current = data.current
      await dependencies.loadPlans()
      await dependencies.handleSubscriptionActivated(data)
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.SUCCESS
      dependencies.checkoutModalOpen.value = true
      dependencies.notificationService.success('套餐已开通')
    } catch (error) {
      dependencies.checkoutUiPhase.value = dependencies.CHECKOUT_UI_PHASE.FAILED
      dependencies.checkoutModalMessage.value = error?.message || '订单确认失败'
      dependencies.notificationService.error(error?.message || '订单确认失败')
    } finally {
      dependencies.checkoutLoading.value = ''
    }
  }

  async function confirmAlipayOrder(order = null) {
    const target = order || dependencies.checkoutOrder.value
    if (!target?.id) return
    if (String(target.checkoutProvider || '').toLowerCase() !== 'alipay') {
      dependencies.notificationService.warning('该订单不是支付宝支付')
      return
    }
    dependencies.checkoutOrder.value = target
    dependencies.checkoutLoading.value = target.planKey || target.id
    openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.CONFIRMING, '正在确认支付宝付款结果，请稍候…')
    try {
      const confirm = await confirmAlipayCheckoutWithRetry(target.id, { poll: true })
      await applyAlipayConfirmationResult(confirm, { reloadResources: true })
      dependencies.notificationService.success(resolveAlipaySuccessMessage(confirm, target))
    } catch (error) {
      await dependencies.loadPlans()
      const latest = dependencies.commerceOrders.value.find(
        (item) => String(item.id || '') === String(target.id),
      )
      if (latest) dependencies.checkoutOrder.value = latest
      syncCheckoutPhaseFromOrder(latest || target, dependencies.CHECKOUT_UI_PHASE.UNPAID)
      dependencies.checkoutModalMessage.value =
        error?.message || '暂未检测到支付结果，请确认是否已完成付款后再试'
      dependencies.checkoutModalOpen.value = true
      dependencies.notificationService.warning(dependencies.checkoutModalMessage.value)
    } finally {
      dependencies.checkoutLoading.value = ''
    }
  }

  function openCheckoutOrderStatus(order = null) {
    if (!order?.id) return
    dependencies.checkoutOrder.value = order
    syncCheckoutPhaseFromOrder(order)
    dependencies.checkoutModalOpen.value = true
  }

  async function cancelCheckoutOrder() {
    const target = dependencies.checkoutOrder.value
    if (!target?.id) return
    if (!dependencies.checkoutOrderView.value?.isPending) {
      dependencies.notificationService.warning('当前订单无法取消')
      return
    }
    dependencies.checkoutLoading.value = target.planKey || target.id
    try {
      const result = await dependencies.cancelClientCheckoutOrder(target.id)
      if (result?.order) dependencies.checkoutOrder.value = result.order
      dependencies.clearPendingCheckout()
      openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.CANCELLED, '订单已取消，未发生扣款。')
      dependencies.notificationService.info('订单已取消')
      await dependencies.loadPlans()
    } catch (error) {
      await dependencies.loadPlans()
      const latest = dependencies.commerceOrders.value.find(
        (item) => String(item.id || '') === String(target.id),
      )
      if (latest) {
        dependencies.checkoutOrder.value = latest
        syncCheckoutPhaseFromOrder(latest)
      }
      dependencies.checkoutModalMessage.value = error?.message || '订单取消失败'
      dependencies.notificationService.error(dependencies.checkoutModalMessage.value)
    } finally {
      dependencies.checkoutLoading.value = ''
    }
  }

  async function handleCheckoutModalClose() {
    if (
      [
        dependencies.CHECKOUT_UI_PHASE.CREATING,
        dependencies.CHECKOUT_UI_PHASE.CONFIRMING,
        dependencies.CHECKOUT_UI_PHASE.REDIRECTING,
      ].includes(dependencies.checkoutUiPhase.value)
    ) {
      return
    }
    closeCheckoutModal(
      dependencies.checkoutUiPhase.value === dependencies.CHECKOUT_UI_PHASE.SUCCESS,
    )
  }

  async function refreshCheckoutStatus() {
    const order = dependencies.checkoutOrder.value
    if (order?.id && dependencies.authStore.isAuthenticated) {
      try {
        const latestResult = await dependencies.getClientCheckoutOrder(order.id)
        if (latestResult?.order) {
          dependencies.checkoutOrder.value = latestResult.order
          const latest = latestResult.order
          const status = String(latest.status || '')
            .trim()
            .toLowerCase()
          if (status === 'activated') {
            await dependencies.handleSubscriptionActivated({}, { reloadResources: true })
            openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.SUCCESS)
            dependencies.clearPendingCheckout()
            dependencies.notificationService.success('支付成功')
            return
          }
          if (status === 'paid' || status === 'activating') {
            openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.CONFIRMING, '订单正在开通中，请稍候…')
            return
          }
          if (status === 'expired') {
            openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.EXPIRED)
            return
          }
          if (status === 'cancelled') {
            openCheckoutModal(dependencies.CHECKOUT_UI_PHASE.CANCELLED)
            return
          }
        }
      } catch {
        // fall through to list reload
      }
    }
    if (
      order?.id &&
      dependencies.checkoutOrderView.value?.isPending &&
      String(order.checkoutProvider || '').toLowerCase() === 'alipay' &&
      dependencies.authStore.isAuthenticated
    ) {
      await confirmAlipayOrder(order)
      return
    }
    await dependencies.loadPlans()
    const latest = dependencies.checkoutOrder.value?.id
      ? dependencies.commerceOrders.value.find(
          (item) => String(item.id || '') === String(dependencies.checkoutOrder.value.id),
        )
      : dependencies.commerceOrders.value[0]
    if (latest) dependencies.checkoutOrder.value = latest
    syncCheckoutPhaseFromOrder(latest || {}, dependencies.CHECKOUT_UI_PHASE.UNPAID)
    if (latest?.status === 'activated') {
      await dependencies.handleSubscriptionActivated({}, { reloadResources: true })
      dependencies.clearPendingCheckout()
      dependencies.notificationService.success('套餐已开通')
    } else if (latest?.status === 'pending') {
      dependencies.checkoutModalMessage.value = '订单仍在等待支付，请继续支付或确认付款结果。'
    }
  }

  return {
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
  }
}
