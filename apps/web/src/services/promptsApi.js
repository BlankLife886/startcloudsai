/**
 * 提示词库公开接口（社区运营 v3）：GET /api/v1/prompts
 *
 * 词条字段：{id, title, prompt, taskType, category, tags[], coverUrl}
 * 带简单内存缓存（按 type/category/cursor/limit 维度，短 TTL），
 * 失败或为空时由调用方决定回退到本地静态词库。
 */
import { apiGet, apiPost } from './apiClient'

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map()

function normalizePromptItem(raw = {}) {
  return {
    id: String(raw?.id || ''),
    title: String(raw?.title || '').trim(),
    prompt: String(raw?.prompt || '').trim(),
    taskType: String(raw?.taskType || ''),
    category: String(raw?.category || '').trim(),
    tags: Array.isArray(raw?.tags) ? raw.tags.map((tag) => String(tag)).filter(Boolean) : [],
    coverUrl: String(raw?.coverUrl || ''),
    coverWidth: Math.max(0, Number(raw?.coverWidth) || 0),
    coverHeight: Math.max(0, Number(raw?.coverHeight) || 0),
    likeCount: Math.max(0, Number(raw?.likeCount) || 0),
    favoriteCount: Math.max(0, Number(raw?.favoriteCount) || 0),
    useCount: Math.max(0, Number(raw?.useCount) || 0),
    liked: raw?.liked === true,
    favorited: raw?.favorited === true,
  }
}

/**
 * 拉取服务端词条（cursor 分页）。
 *
 * @param {object} options
 * @param {string} [options.type] - 工作台类型：t2i / game_art / model_sheet / ui_design / coloring
 * @param {string} [options.category] - 分类筛选（可空）
 * @param {string} [options.scope] - 用户范围（favorites 表示仅我的收藏）
 * @param {string} [options.cursor] - 分页游标（可空）
 * @param {number} [options.limit]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{items: Array, nextCursor: string|null, categoryCounts: object}>}
 */
export async function listPrompts({
  type = '',
  category = '',
  search = '',
  tags = [],
  scope = '',
  sort = 'recommended',
  cursor = '',
  limit = 24,
  signal,
} = {}) {
  const cacheKey = [type, category, search, tags.join(','), scope, sort, cursor, limit].join('|')
  const hit = cache.get(cacheKey)
  if (hit && hit.expiresAt > Date.now()) return hit.data

  const data = await apiGet('/prompts', {
    query: { type, category, search, tag: tags, scope, sort, cursor, limit },
    signal,
    fallbackMessage: '提示词库读取失败',
  })
  const result = {
    items: (Array.isArray(data?.items) ? data.items : [])
      .map(normalizePromptItem)
      .filter((item) => item.id && item.prompt),
    nextCursor: data?.nextCursor ? String(data.nextCursor) : null,
    categoryCounts:
      data?.categoryCounts && typeof data.categoryCounts === 'object'
        ? Object.fromEntries(
            Object.entries(data.categoryCounts).map(([key, count]) => [key, Number(count) || 0]),
          )
        : {},
    tags: Array.isArray(data?.tags) ? data.tags.map(String).filter(Boolean) : [],
    total: Math.max(0, Number(data?.total) || 0),
  }
  cache.set(cacheKey, {
    expiresAt: Date.now() + (scope === 'today' ? 30_000 : CACHE_TTL_MS),
    data: result,
  })
  return result
}

export async function recordPromptEngagement(id, action, active = true) {
  const data = await apiPost(`/prompts/${encodeURIComponent(String(id))}/engagements`, {
    action,
    active,
  })
  cache.clear()
  return data
}

/** 清空词库缓存（当前仅供调试/测试使用）。 */
export function clearPromptsCache() {
  cache.clear()
}
