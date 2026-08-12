import { apiDelete, apiGet, apiPatch, apiPost } from './apiClient.js'

export async function listCommerceProducts({
  q = '',
  status = 'active',
  limit = 30,
  cursor = '',
  signal,
} = {}) {
  const data = await apiGet('/commerce/products', {
    query: { q, status, limit, cursor },
    signal,
    fallbackMessage: '商品库读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

export async function getCommerceProduct(id, { signal } = {}) {
  return apiGet(`/commerce/products/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: '商品读取失败',
  })
}

export async function createCommerceProduct(payload) {
  return apiPost('/commerce/products', payload, { fallbackMessage: '商品保存失败' })
}

export async function updateCommerceProduct(id, payload) {
  return apiPatch(`/commerce/products/${encodeURIComponent(id)}`, payload, {
    fallbackMessage: '商品更新失败',
  })
}

export async function deleteCommerceProduct(id) {
  return apiDelete(`/commerce/products/${encodeURIComponent(id)}`, {
    fallbackMessage: '商品删除失败',
  })
}

export async function generateCommerceProductBrief(payload, { signal } = {}) {
  return apiPost('/commerce/product-briefs', payload, {
    signal,
    fallbackMessage: 'AI 商品识别失败',
  })
}
