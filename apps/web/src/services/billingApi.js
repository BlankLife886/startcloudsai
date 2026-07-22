/**
 * 套餐只读 API。支付尚未接入，客户端不提供创建订单或支付调用。
 */
import { apiGet } from './apiClient'

export async function listPlans({ signal } = {}) {
  const data = await apiGet('/plans', { signal, fallbackMessage: '套餐读取失败' })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    paymentEnabled: data?.paymentEnabled === true,
  }
}

export function formatCents(cents, { withSymbol = true } = {}) {
  const value = Number(cents || 0) / 100
  const text = value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return withSymbol ? `¥${text}` : text
}
