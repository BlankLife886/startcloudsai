export const MAX_CLIENT_STATE_BYTES = 850_000

export function estimateJsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function compactFavoriteForSync(item) {
  if (!item || typeof item !== 'object') return item
  return {
    id: item.id,
    favorited_at: item.favorited_at,
    collections: item.collections,
    resolution: item.resolution,
    thumbnail: item.thumbnail,
    thumbs: item.thumbs,
    tags: item.tags,
    category: item.category,
    purity: item.purity,
    uploader: item.uploader,
  }
}

export function compactHistoryForSync(item) {
  if (!item || typeof item !== 'object') return item
  return {
    id: item.id,
    url: item.url,
    path: item.path,
    resolution: item.resolution,
    category: item.category,
    purity: item.purity,
    tags: item.tags,
    thumbnail: item.thumbnail,
    thumbs: item.thumbs,
    viewed_at: item.viewed_at,
    first_viewed_at: item.first_viewed_at,
    view_count: item.view_count,
    view_duration: item.view_duration,
    session_id: item.session_id,
    source: item.source,
    search_query: item.search_query,
  }
}

export function compactCollectionForSync(item) {
  if (!item || typeof item !== 'object') return item
  return {
    id: item.id,
    name: item.name,
    icon: item.icon,
    count: item.count,
    updated_at: item.updated_at,
    created_at: item.created_at,
    description: item.description,
  }
}

function trimArrayField(payload, field, minItems = 60) {
  const next = { ...payload }
  let items = Array.isArray(next[field]) ? [...next[field]] : []
  let trimmed = false

  while (items.length > minItems && estimateJsonBytes({ ...next, [field]: items }) > MAX_CLIENT_STATE_BYTES) {
    items = items.slice(0, Math.max(minItems, Math.floor(items.length * 0.82)))
    trimmed = true
  }

  next[field] = items
  return { payload: next, trimmed }
}

function compactPayloadByKey(stateKey, payload) {
  if (!payload || typeof payload !== 'object') return payload
  const next = { ...payload }

  if (stateKey === 'favorites') {
    if (Array.isArray(next.favorites)) {
      next.favorites = next.favorites.map(compactFavoriteForSync)
    }
    if (Array.isArray(next.collections)) {
      next.collections = next.collections.map(compactCollectionForSync)
    }
  }

  if (stateKey === 'history' && Array.isArray(next.history)) {
    next.history = next.history.map(compactHistoryForSync)
  }

  return next
}

export function prepareClientStatePayload(stateKey, payload, options = {}) {
  const minItems = Number.isFinite(Number(options.minItems))
    ? Math.max(20, Number(options.minItems))
    : 60

  let prepared = compactPayloadByKey(stateKey, payload)
  let trimmed = false

  if (estimateJsonBytes(prepared) <= MAX_CLIENT_STATE_BYTES) {
    return { payload: prepared, trimmed: false, bytes: estimateJsonBytes(prepared) }
  }

  if (stateKey === 'favorites' && Array.isArray(prepared.favorites)) {
    const result = trimArrayField(prepared, 'favorites', minItems)
    prepared = result.payload
    trimmed = trimmed || result.trimmed
  }

  if (stateKey === 'history' && Array.isArray(prepared.history)) {
    const result = trimArrayField(prepared, 'history', minItems)
    prepared = result.payload
    trimmed = trimmed || result.trimmed
  }

  if (estimateJsonBytes(prepared) > MAX_CLIENT_STATE_BYTES && prepared.statistics) {
    const { statistics, ...rest } = prepared
    prepared = rest
    trimmed = true
  }

  // 兜底：downloads/authors/tags/aiWallpaper 等通用桶超限时，
  // 从最大的数组字段开始裁剪，避免直接 413 导致该桶永远无法同步。
  if (estimateJsonBytes(prepared) > MAX_CLIENT_STATE_BYTES && prepared && typeof prepared === 'object') {
    const arrayFields = Object.keys(prepared)
      .filter((field) => Array.isArray(prepared[field]) && prepared[field].length > minItems)
      .sort((a, b) => estimateJsonBytes(prepared[b]) - estimateJsonBytes(prepared[a]))

    for (const field of arrayFields) {
      if (estimateJsonBytes(prepared) <= MAX_CLIENT_STATE_BYTES) break
      const result = trimArrayField(prepared, field, minItems)
      prepared = result.payload
      trimmed = trimmed || result.trimmed
    }
  }

  return {
    payload: prepared,
    trimmed,
    bytes: estimateJsonBytes(prepared),
  }
}

export function getClientStateLabel(stateKey) {
  const labels = {
    settings: '设置',
    favorites: '收藏',
    history: '浏览历史',
    downloads: '下载',
    authors: '关注作者',
    tags: '关注标签',
    aiWallpaper: 'AI 壁纸',
  }
  return labels[stateKey] || '数据'
}
