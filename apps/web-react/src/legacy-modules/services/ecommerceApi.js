import { apiDelete, apiGet, apiPatch, apiPost, apiRequest } from './apiClient.js'

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

function normalizeTryonCatalogItems(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => ({
      id: String(item?.id || '').trim(),
      label: String(item?.label || '').trim(),
      image: String(item?.imageUrl || item?.image || '').trim(),
      apparel: String(item?.apparel || '').trim(),
    }))
    .filter((item) => item.id && item.label && item.image)
}

export async function listTryonCatalog({ signal } = {}) {
  const data = await apiGet('/commerce/catalog', {
    signal,
    fallbackMessage: '试衣素材读取失败',
  })
  return {
    models: normalizeTryonCatalogItems(data?.models),
    scenes: normalizeTryonCatalogItems(data?.scenes),
    garments: normalizeTryonCatalogItems(data?.garments),
  }
}

export async function generateCommerceProductBrief(payload, { signal } = {}) {
  return apiPost('/commerce/product-briefs', payload, {
    signal,
    fallbackMessage: 'AI 商品识别失败',
  })
}

export async function generateAplusPlan(payload, { signal } = {}) {
  return apiPost('/commerce/aplus-plans', payload, {
    signal,
    fallbackMessage: 'A+ 结构分析失败',
  })
}

export async function getAplusCatalog({ signal } = {}) {
  return apiGet('/commerce/aplus-catalog', {
    signal,
    fallbackMessage: 'A+ 知识库读取失败',
  })
}

export async function listCommerceAssetReviews({ status = '', limit = 100, signal } = {}) {
  const data = await apiGet('/commerce/reviews', {
    query: { status, limit },
    signal,
    fallbackMessage: '商拍质检记录读取失败',
  })
  return Array.isArray(data?.items) ? data.items : []
}

export async function saveCommerceAssetReview(taskId, payload, { signal } = {}) {
  return apiRequest(`/commerce/reviews/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: payload,
    signal,
    fallbackMessage: '商拍质检记录保存失败',
  })
}
