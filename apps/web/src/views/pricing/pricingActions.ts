export function createPricingActions(dependencies) {
  async function createPlatformKey() {
    if (!dependencies.authStore.isAuthenticated) {
      dependencies.notificationService.warning('请先登录后再继续')
      return
    }
    if (!String(dependencies.accountKeyForm.label || '').trim()) {
      dependencies.notificationService.warning('请输入密钥名称')
      return
    }
    if (
      !dependencies.keyAllowAllModels.value &&
      !dependencies.accountKeyForm.allowedPublicModels.length
    ) {
      dependencies.notificationService.warning('请至少选择一个可调用的模型')
      return
    }
    if (dependencies.keyLimitMode.value === 'usd') {
      const amount = Math.max(0, Number(dependencies.keyLimitAmount.value || 0))
      if (dependencies.keyLimitPeriod.value === 'unlimited' || amount <= 0) {
        dependencies.notificationService.warning('请选择日或月并输入大于 0 的金额，或改选「不限」')
        return
      }
      dependencies.warnKeyLimitAboveWalletBalance(amount)
    }
    if (dependencies.keyLimitMode.value === 'count') {
      const message = dependencies.validateKeyCountLimits(
        dependencies.accountKeyForm.dailyLimitUnits,
        dependencies.accountKeyForm.monthlyLimitUnits,
      )
      if (message) {
        dependencies.notificationService.warning(message)
        return
      }
    }
    dependencies.keyActionLoading.value = 'create'
    dependencies.accountNewSecret.value = ''
    const limits = dependencies.buildKeyLimitsPayloadFromState({
      mode: dependencies.keyLimitMode.value,
      period: dependencies.keyLimitPeriod.value,
      amount: dependencies.keyLimitAmount.value,
      dailyUnits: dependencies.accountKeyForm.dailyLimitUnits,
      monthlyUnits: dependencies.accountKeyForm.monthlyLimitUnits,
    })
    try {
      const configuredScopes = dependencies.pricingSettings.value.apiKeys?.defaultScopes
      const data = await dependencies.createClientApiKey({
        label: String(dependencies.accountKeyForm.label || '').trim(),
        prefix:
          String(dependencies.accountKeyForm.prefix || '').trim() ||
          dependencies.pricingSettings.value.apiKeys?.defaultPrefix ||
          '',
        scopes:
          Array.isArray(dependencies.accountKeyForm.scopes) &&
          dependencies.accountKeyForm.scopes.length
            ? dependencies.accountKeyForm.scopes.map(String)
            : Array.isArray(configuredScopes) && configuredScopes.length
              ? configuredScopes.map(String)
              : [],
        allowedPublicModels: dependencies.accountKeyForm.allowedPublicModels,
        allowedIps: dependencies.parseLineList(dependencies.accountKeyForm.allowedIpsText),
        ...limits,
        expiresAt: String(dependencies.accountKeyForm.expiresAt || '').trim(),
      })
      dependencies.accountNewSecret.value = data?.key || ''
      dependencies.accountNewSecretKeyId.value = data?.apiKey?.id || ''
      dependencies.notificationService.success('API Key 已创建')
      dependencies.resetKeyFormState()
      dependencies.keyCreateModalOpen.value = false
      await dependencies.loadResources({ silent: true })
    } catch (error) {
      dependencies.notificationService.error(error?.message || 'API Key 创建失败')
    } finally {
      dependencies.keyActionLoading.value = ''
    }
  }

  async function togglePlatformKeyStatus(key) {
    if (!key?.id) return
    const nextStatus = String(key.status || 'active') === 'active' ? 'paused' : 'active'
    dependencies.keyActionLoading.value = `status:${key.id}`
    try {
      await dependencies.updateClientApiKey(key.id, { status: nextStatus })
      dependencies.notificationService.success(
        nextStatus === 'active' ? 'API Key 已启用' : 'API Key 已暂停',
      )
      await dependencies.loadResources({ silent: true })
    } catch (error) {
      dependencies.notificationService.error(error?.message || 'API Key 状态更新失败')
    } finally {
      dependencies.keyActionLoading.value = ''
    }
  }

  async function confirmKeyReset() {
    const key = dependencies.keyResetModalKey.value
    if (!key?.id) return
    dependencies.keyActionLoading.value = `reset:${key.id}`
    try {
      const data = await dependencies.resetClientApiKey(key.id)
      dependencies.keyResetNewSecret.value = data?.key || ''
      dependencies.accountNewSecretKeyId.value = key.id
      dependencies.notificationService.success('API Key 已重置')
      await dependencies.loadResources({ silent: true })
    } catch (error) {
      dependencies.notificationService.error(error?.message || 'API Key 重置失败')
    } finally {
      dependencies.keyActionLoading.value = ''
    }
  }

  function openKeyResetModal(key) {
    if (!key?.id || ['revoked', 'expired'].includes(String(key.status))) return
    dependencies.keyResetModalKey.value = key
    dependencies.keyResetNewSecret.value = ''
  }

  function closeKeyResetModal() {
    dependencies.keyResetModalKey.value = null
    dependencies.keyResetNewSecret.value = ''
  }

  function openKeyRevokeModal(key) {
    if (
      !key?.id ||
      dependencies.isSubscriptionApiKey(key) ||
      ['revoked', 'expired'].includes(String(key.status))
    ) {
      return
    }
    dependencies.keyRevokeModalKey.value = key
  }

  function closeKeyRevokeModal() {
    dependencies.keyRevokeModalKey.value = null
  }

  async function confirmKeyRevoke() {
    const key = dependencies.keyRevokeModalKey.value
    if (!key?.id) return
    dependencies.keyActionLoading.value = `revoke:${key.id}`
    try {
      await dependencies.revokeClientApiKey(key.id)
      dependencies.notificationService.success('API Key 已注销')
      closeKeyRevokeModal()
      await dependencies.loadResources({ silent: true })
    } catch (error) {
      dependencies.notificationService.error(error?.message || 'API Key 注销失败')
    } finally {
      dependencies.keyActionLoading.value = ''
    }
  }

  async function copyText(text, message = '已复制') {
    if (!text) return
    await navigator.clipboard?.writeText(String(text))
    dependencies.notificationService.success(message)
  }

  function buildRechargeUrl(baseUrl = '', amount = 0) {
    const raw = String(baseUrl || '').trim()
    if (!raw) return ''
    try {
      const url = new URL(raw, window.location.origin)
      if (amount > 0) {
        if (!url.searchParams.has('amount')) url.searchParams.set('amount', String(amount))
        if (!url.searchParams.has('usd')) url.searchParams.set('usd', String(amount))
      }
      return url.toString()
    } catch {
      return raw
    }
  }

  function goRecharge() {
    dependencies.selectSection('wallet')
  }

  function goSubscribe() {
    dependencies.selectSection('plans')
    dependencies.planConsoleTab.value = 'catalog'
  }

  function goManageSubscription() {
    dependencies.selectSection('plans')
    dependencies.planConsoleTab.value = dependencies.resolveDefaultPlanConsoleTab()
  }

  async function rechargeWallet() {
    if (!dependencies.authStore.isAuthenticated) {
      dependencies.notificationService.warning('请先登录后再充值')
      return
    }
    const amount = dependencies.selectedRechargeAmount.value
    if (!amount) {
      dependencies.notificationService.warning('请选择充值金额')
      return
    }
    const plan = dependencies.walletTopupPlanByUsd.value.get(amount)
    if (plan) {
      await dependencies.purchasePlan(plan, {
        provider: dependencies.selectedCheckoutProvider.value,
      })
      return
    }
    const rechargeUrl = buildRechargeUrl(
      dependencies.pricingSettings.value.wallet?.rechargeUrl,
      amount,
    )
    if (rechargeUrl) {
      window.open(rechargeUrl, '_blank', 'noopener,noreferrer')
      return
    }
    dependencies.notificationService.warning('该充值金额暂未开放，请联系管理员')
  }

  async function redeemWalletCode() {
    if (!dependencies.authStore.isAuthenticated) {
      dependencies.notificationService.warning('请先登录后再继续')
      return
    }
    const code = String(dependencies.walletRedeemDraft.value || '').trim()
    if (!code) {
      dependencies.notificationService.warning('请输入兑换码')
      return
    }
    dependencies.walletRedeemLoading.value = true
    dependencies.walletRedeemSuccess.value = null
    try {
      const result = await dependencies.redeemClientWalletCode({ code })
      const amountUsd = Number(result?.redemption?.amountUsd || 0)
      const balanceAfter = Number(result?.redemption?.balanceAfter || 0)
      dependencies.walletRedeemDraft.value = ''
      if (balanceAfter > 0) {
        const frozen = Number(dependencies.account.value.frozenBalance || 0)
        const nextWallet = {
          ...dependencies.resourceSummary.value.wallet,
          ...dependencies.resourceSummary.value.account,
          balance: balanceAfter,
          availableBalance: Math.max(0, balanceAfter - frozen),
        }
        dependencies.resourceSummary.value = dependencies.mergeResourceSummary({
          ...dependencies.resourceSummary.value,
          wallet: nextWallet,
          account: nextWallet,
        })
        dependencies.applyWalletFromSummary(dependencies.resourceSummary.value)
      }
      dependencies.walletRedeemSuccess.value = {
        amountUsd,
        balanceAfter: balanceAfter || dependencies.availableUsd.value,
      }
      dependencies.notificationService.success(
        amountUsd > 0
          ? `兑换成功，到账 ${dependencies.formatMoneyDisplay(amountUsd)}`
          : '兑换成功，美元已到账',
      )
      await dependencies.loadResources({ silent: true })
    } catch (error) {
      dependencies.notificationService.error(error instanceof Error ? error.message : '兑换失败')
    } finally {
      dependencies.walletRedeemLoading.value = false
    }
  }

  async function exchangeWalletUsd() {
    if (!dependencies.authStore.isAuthenticated) {
      dependencies.notificationService.warning('请先登录后再继续')
      return
    }
    const amountUsd = Math.round(Number(dependencies.walletExchangeDraft.value) * 100) / 100
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      dependencies.notificationService.warning('请输入有效金额')
      return
    }
    if (amountUsd > dependencies.availableUsd.value) {
      dependencies.notificationService.warning('可用余额不够啦，请少兑换一点或先充值')
      return
    }
    dependencies.walletExchangeLoading.value = true
    try {
      const result = await dependencies.exchangeClientWalletUsd({ amountUsd })
      const credits = Number(
        result?.exchange?.credits || dependencies.walletExchangePreviewCredits.value || 0,
      )
      dependencies.walletExchangeDraft.value = ''
      dependencies.notificationService.success(
        credits > 0
          ? `兑换成功，到账 ${dependencies.formatCredits(credits)} 壁纸积分`
          : '兑换成功，壁纸积分已到账',
      )
      await dependencies.loadResources({ silent: true })
    } catch (error) {
      dependencies.notificationService.error(
        error instanceof Error ? error.message : '兑换积分失败',
      )
    } finally {
      dependencies.walletExchangeLoading.value = false
    }
  }

  return {
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
  }
}
