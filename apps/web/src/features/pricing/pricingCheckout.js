import { formatUsd } from './pricingMoney.js'

export const CHECKOUT_UI_PHASE = {
  IDLE: 'idle',
  CREATING: 'creating',
  PAYING: 'paying',
  REDIRECTING: 'redirecting',
  CONFIRMING: 'confirming',
  SUCCESS: 'success',
  UNPAID: 'unpaid',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
}

export function resolveCheckoutProviderLabel(provider = '') {
  const map = {
    wallet: '余额支付',
    stripe: 'Stripe',
    paypal: 'PayPal',
    alipay: '支付宝',
    manual: '测试支付',
  }
  return map[String(provider || '').trim().toLowerCase()] || String(provider || '—')
}

export function normalizeCheckoutOrderId(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.startsWith('order:') ? raw : `order:${raw}`
}

export function parseCheckoutReturnQuery(query = {}) {
  const orderId = String(query.order_id || query.orderId || '').trim()
  const outTradeNo = String(query.out_trade_no || '').trim()
  const provider = String(query.provider || '').trim().toLowerCase()
  const method = String(query.method || '').trim().toLowerCase()
  const isAlipayReturn =
    provider === 'alipay' ||
    method.includes('alipay.trade.page.pay.return') ||
    Boolean(outTradeNo && !orderId)
  const resolvedOrderId = normalizeCheckoutOrderId(orderId || outTradeNo)
  const success =
    query.checkout_success === '1' ||
    query.payment_success === '1' ||
    (isAlipayReturn && query.checkout_cancel !== '1' && query.payment_cancel !== '1')
  const cancelled = query.checkout_cancel === '1' || query.payment_cancel === '1'
  return {
    orderId: resolvedOrderId,
    success: Boolean(success && resolvedOrderId),
    cancelled,
    provider: isAlipayReturn ? 'alipay' : provider,
    section: String(query.section || '').trim(),
    paypalToken: String(query.token || '').trim(),
    isAlipayReturn,
  }
}

export function buildCheckoutOrderView(order, { plans = [] } = {}) {
  if (!order) return null
  const planKey = String(order.planKey || '').trim()
  const plan = plans.find((item) => String(item.planKey || '') === planKey) || null
  const provider = String(order.checkoutProvider || '').trim().toLowerCase()
  const fromOrder = String(order?.planName || order?.metadata?.planName || '').trim()
  const planName =
    fromOrder ||
    String(plan?.name || '').trim() ||
    planKey ||
    '订单'
  const cents = Number(order?.amountCents ?? order?.priceCents ?? 0)
  const currency = String(order?.currency || plan?.currency || 'USD').toUpperCase()
  const amountLabel =
    cents <= 0
      ? '免费'
      : currency === 'USD'
        ? formatUsd(cents / 100)
        : `${currency} ${(cents / 100).toFixed(2)}`

  const metadata =
    order?.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
      ? order.metadata
      : {}
  const alipayPayCny = String(metadata.alipayPayCny || '').trim()
  const payAmountLabel = alipayPayCny ? `¥${alipayPayCny}` : ''
  const status = String(order.status || '').trim().toLowerCase()
  const expiresAt = String(order.expiresAt || order.expires_at || '').trim()
  const expiresMs = Date.parse(expiresAt)
  const isExpired = status === 'expired' || (status === 'pending' && Number.isFinite(expiresMs) && expiresMs <= Date.now())
  let expiresInLabel = ''
  if (status === 'pending' && Number.isFinite(expiresMs) && expiresMs > Date.now()) {
    const minutesLeft = Math.max(1, Math.ceil((expiresMs - Date.now()) / 60000))
    expiresInLabel = `${minutesLeft} 分钟内有效`
  }

  return {
    id: String(order.id || '').replace(/^order:/i, ''),
    planName,
    amountLabel,
    payAmountLabel,
    provider,
    providerLabel: resolveCheckoutProviderLabel(provider),
    isAlipay: provider === 'alipay',
    isPending: status === 'pending' && !isExpired,
    isProcessing: status === 'paid' || status === 'activating',
    isPaid: status === 'activated',
    isExpired,
    expiresAt,
    expiresInLabel,
    status,
    checkoutUrl: String(order.checkoutUrl || order.checkout_url || '').trim(),
  }
}

export function resolveCheckoutUiPhaseFromOrder(order, uiPhase = CHECKOUT_UI_PHASE.IDLE) {
  const activePhase = String(uiPhase || CHECKOUT_UI_PHASE.IDLE)
  if (
    [
      CHECKOUT_UI_PHASE.CREATING,
      CHECKOUT_UI_PHASE.REDIRECTING,
      CHECKOUT_UI_PHASE.CONFIRMING,
      CHECKOUT_UI_PHASE.UNPAID,
      CHECKOUT_UI_PHASE.EXPIRED,
      CHECKOUT_UI_PHASE.CANCELLED,
      CHECKOUT_UI_PHASE.FAILED,
    ].includes(activePhase)
  ) {
    return activePhase
  }
  if (!order) return CHECKOUT_UI_PHASE.IDLE
  const status = String(order.status || '').trim().toLowerCase()
  const view = buildCheckoutOrderView(order)
  if (status === 'activated') return CHECKOUT_UI_PHASE.SUCCESS
  if (status === 'paid' || status === 'activating') return CHECKOUT_UI_PHASE.CONFIRMING
  if (status === 'expired' || view.isExpired) return CHECKOUT_UI_PHASE.EXPIRED
  if (status === 'pending') return CHECKOUT_UI_PHASE.PAYING
  if (status === 'cancelled') return CHECKOUT_UI_PHASE.CANCELLED
  if (status === 'failed') return CHECKOUT_UI_PHASE.FAILED
  return CHECKOUT_UI_PHASE.PAYING
}

export function buildCheckoutFlowSteps(phase = CHECKOUT_UI_PHASE.IDLE) {
  const value = String(phase || CHECKOUT_UI_PHASE.IDLE)
  const createdDone = value !== CHECKOUT_UI_PHASE.CREATING
  const payingActive = [CHECKOUT_UI_PHASE.PAYING, CHECKOUT_UI_PHASE.REDIRECTING].includes(value)
  const payingDone = [
    CHECKOUT_UI_PHASE.CONFIRMING,
    CHECKOUT_UI_PHASE.SUCCESS,
    CHECKOUT_UI_PHASE.UNPAID,
    CHECKOUT_UI_PHASE.EXPIRED,
    CHECKOUT_UI_PHASE.CANCELLED,
    CHECKOUT_UI_PHASE.FAILED,
  ].includes(value)
  const confirmActive = value === CHECKOUT_UI_PHASE.CONFIRMING
  const confirmDone = value === CHECKOUT_UI_PHASE.SUCCESS
  const confirmFailed = [
    CHECKOUT_UI_PHASE.UNPAID,
    CHECKOUT_UI_PHASE.EXPIRED,
    CHECKOUT_UI_PHASE.CANCELLED,
    CHECKOUT_UI_PHASE.FAILED,
  ].includes(value)

  return [
    {
      id: 'created',
      label: '创建订单',
      state: createdDone ? 'done' : 'active',
    },
    {
      id: 'pay',
      label: '支付宝付款',
      state: payingDone ? 'done' : payingActive ? 'active' : createdDone ? 'upcoming' : 'upcoming',
    },
    {
      id: 'confirm',
      label: '确认结果',
      state: confirmDone ? 'done' : confirmFailed ? 'error' : confirmActive ? 'active' : 'upcoming',
    },
  ]
}

export function buildCheckoutModalPresentation({
  phase = CHECKOUT_UI_PHASE.IDLE,
  orderView = null,
  isWalletTopup = false,
  message = '',
} = {}) {
  const value = String(phase || CHECKOUT_UI_PHASE.IDLE)
  const amount = orderView?.amountLabel || '—'
  const payAmountLabel = orderView?.payAmountLabel || ''
  const planName = orderView?.planName || '订单'
  const orderNo = orderView?.id || '—'

  const presets = {
    [CHECKOUT_UI_PHASE.CREATING]: {
      tone: 'info',
      icon: 'bi-receipt',
      title: '正在创建订单',
      description: '请稍候，系统正在为你生成支付订单…',
      showSteps: true,
      closable: false,
      showOrder: false,
    },
    [CHECKOUT_UI_PHASE.REDIRECTING]: {
      tone: 'info',
      icon: 'bi-box-arrow-up-right',
      title: '正在前往支付宝',
      description: '即将打开支付宝收银台，完成付款后请返回本页。',
      showSteps: true,
      closable: false,
      showOrder: true,
    },
    [CHECKOUT_UI_PHASE.PAYING]: {
      tone: 'info',
      icon: 'bi-wallet2',
      title: '等待支付宝付款',
      description: isWalletTopup
        ? '订单已创建。请在新打开的支付宝页面完成付款，返回后点击「我已完成支付」。中途关闭页面可稍后回来继续，或点击「取消订单」。'
        : '订单已创建。请在新打开的支付宝页面完成付款，返回后点击「我已完成支付」。中途关闭页面可稍后回来继续，或点击「取消订单」。',
      showSteps: true,
      closable: true,
      showOrder: true,
    },
    [CHECKOUT_UI_PHASE.CONFIRMING]: {
      tone: 'info',
      icon: 'bi-arrow-repeat',
      title: '正在确认支付结果',
      description: message || '正在向支付宝查询付款状态并开通套餐，请不要关闭页面…',
      showSteps: true,
      closable: false,
      showOrder: true,
    },
    [CHECKOUT_UI_PHASE.SUCCESS]: {
      tone: 'success',
      icon: 'bi-check-circle-fill',
      title: isWalletTopup ? '充值成功' : '支付成功',
      description: isWalletTopup
        ? `已成功充值 ${amount}，余额已到账。`
        : `套餐 ${planName} 已开通，感谢你的购买。`,
      showSteps: true,
      closable: true,
      showOrder: true,
    },
    [CHECKOUT_UI_PHASE.UNPAID]: {
      tone: 'warn',
      icon: 'bi-exclamation-circle-fill',
      title: '暂未检测到付款',
      description:
        message ||
        '系统暂未查询到支付结果。若你已在支付宝完成付款，请点击「我已完成支付」重试；若尚未付款，可继续支付或取消订单。',
      showSteps: true,
      closable: true,
      showOrder: true,
    },
    [CHECKOUT_UI_PHASE.EXPIRED]: {
      tone: 'neutral',
      icon: 'bi-clock-history',
      title: '订单已过期',
      description:
        message ||
        '该订单已超过有效支付时间（30 分钟），无法继续支付。若你已完成付款但余额未到账，请联系客服并提供订单号。',
      showSteps: true,
      closable: true,
      showOrder: true,
    },
    [CHECKOUT_UI_PHASE.CANCELLED]: {
      tone: 'neutral',
      icon: 'bi-x-circle-fill',
      title: '支付已取消',
      description: '你已取消本次支付，订单未扣款。如需继续，可重新发起充值或购买。',
      showSteps: true,
      closable: true,
      showOrder: true,
    },
    [CHECKOUT_UI_PHASE.FAILED]: {
      tone: 'error',
      icon: 'bi-x-octagon-fill',
      title: '支付失败',
      description: message || '订单处理失败，请稍后重试或联系管理员。',
      showSteps: true,
      closable: true,
      showOrder: true,
    },
  }

  const preset = presets[value] || presets[CHECKOUT_UI_PHASE.PAYING]
  const expiresHint = orderView?.expiresInLabel ? `订单 ${orderView.expiresInLabel}。` : ''
  const description =
    expiresHint && preset.showOrder && value === CHECKOUT_UI_PHASE.PAYING
      ? `${expiresHint}${preset.description}`
      : preset.description
  return {
    ...preset,
    description,
    phase: value,
    amount,
    payAmountLabel,
    planName,
    orderNo,
    expiresInLabel: orderView?.expiresInLabel || '',
    steps: buildCheckoutFlowSteps(value),
  }
}

export function resolveAlipayConfirmSuccessMessage({
  isWalletTopup = false,
  subscriptionApiKey = null,
} = {}) {
  if (isWalletTopup) return '充值成功，余额已到账'
  if (subscriptionApiKey?.key) return '支付成功，订阅密钥已生成'
  return '支付成功，套餐已开通'
}

export function rememberPendingCheckout(order) {
  if (!order?.id) return
  try {
    sessionStorage.setItem(
      'walleven_pending_checkout',
      JSON.stringify({
        id: String(order.id || ''),
        provider: String(order.checkoutProvider || ''),
        at: Date.now(),
      }),
    )
  } catch {
    // ignore storage errors
  }
}

export function readPendingCheckout() {
  try {
    const raw = sessionStorage.getItem('walleven_pending_checkout')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.id) return null
    return parsed
  } catch {
    return null
  }
}

export function clearPendingCheckout() {
  try {
    sessionStorage.removeItem('walleven_pending_checkout')
  } catch {
    // ignore storage errors
  }
}

export function sleep(ms = 0) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0))
  })
}

export async function pollAlipayConfirmation(confirmFn, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 6))
  const intervalMs = Math.max(500, Number(options.intervalMs || 2000))
  let lastError = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await confirmFn()
      return result
    } catch (error) {
      lastError = error
      const message = String(error?.message || '')
      const retryable =
        /等待|回调|pending|未支付|查单|trade_status/i.test(message) || attempt < maxAttempts - 1
      if (!retryable) break
      await sleep(intervalMs)
    }
  }
  throw lastError || new Error('暂未检测到支付结果')
}
