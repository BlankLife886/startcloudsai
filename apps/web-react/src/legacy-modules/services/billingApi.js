/**
 * 套餐目录 API。支付结算由价格页调用订单接口完成。
 */
import { apiGet, apiPost } from './apiClient'

export async function listPlans({ signal } = {}) {
  const data = await apiGet('/plans', { signal, fallbackMessage: '套餐读取失败' })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    paymentEnabled: data?.paymentEnabled === true,
  }
}

export async function listOrders({ status = '', cursor = '', limit = 12, signal } = {}) {
  const data = await apiGet('/orders', {
    query: { status, cursor, limit },
    signal,
    fallbackMessage: '订单读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

export function getOrder(id, { signal } = {}) {
  return apiGet(`/orders/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: '订单状态读取失败',
  })
}

export function closeOrder(id) {
  return apiPost(`/orders/${encodeURIComponent(id)}/close`, null, {
    fallbackMessage: '订单关闭失败',
  })
}

export function formatCents(cents, { withSymbol = true } = {}) {
  const value = Number(cents || 0) / 100
  const text = value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return withSymbol ? `¥${text}` : text
}

/** 钱包历史字段以 Cents 结尾，但值为整数积分，不做货币换算。 */
export function formatPoints(points, { withUnit = true } = {}) {
  const value = Number(points || 0)
  const text = (Number.isFinite(value) ? Math.round(value) : 0).toLocaleString('zh-CN')
  return withUnit ? `${text} 积分` : text
}
