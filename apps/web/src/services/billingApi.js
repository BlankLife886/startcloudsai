/**
 * 套餐与订单 API（/api/plans、/api/orders）。金额一律为「分」。
 */
import { apiGet, apiPost } from './apiClient'

/** 上架套餐列表。 */
export async function listPlans({ signal } = {}) {
  const data = await apiGet('/plans', { signal, fallbackMessage: '套餐读取失败' })
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}

/** 创建订单：{ planId } → { id, status, amountCents, payUrl? } */
export async function createOrder(planId) {
  const data = await apiPost('/orders', { planId }, { fallbackMessage: '订单创建失败' })
  return data?.order || data
}

/** 订单状态轮询。 */
export async function getOrder(id, { signal } = {}) {
  const data = await apiGet(`/orders/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: '订单读取失败',
  })
  return data?.order || data
}

/** 我的订单分页。 */
export async function listOrders({ limit = 20, cursor = '', signal } = {}) {
  const data = await apiGet('/orders', {
    query: { limit, cursor },
    signal,
    fallbackMessage: '订单列表读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

/** 分 → 元 显示。 */
export function formatCents(cents, { withSymbol = true } = {}) {
  const value = Number(cents || 0) / 100
  const text = value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return withSymbol ? `¥${text}` : text
}
