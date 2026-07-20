/**
 * 画廊 API（新契约 /api/gallery*，含社区运营 v3 增补：分类 / 精选 / 投稿分类）。
 * 公开列表 + 分类 + 投稿 + 我的投稿；旧的评论/收藏/浏览统计接口已随后端下线。
 */
import { apiGet, apiPost, isApiError } from './apiClient'
export { deleteMyGallerySubmission, listMyGallerySubmissions } from './meApi'

/** 投稿新错误码 → 用户可读中文提示 */
const SUBMISSION_ERROR_MESSAGES = {
  submission_banned: '你已被限制投稿',
  submission_disabled: '社区投稿暂未开放',
  submission_daily_limit: '今日投稿已达上限',
}

/**
 * 公开已过审作品（cursor 分页）。
 * @param {object} options
 * @param {number} [options.limit]
 * @param {string} [options.cursor]
 * @param {string} [options.category] - 分类 id 筛选（空为全部）
 * @param {boolean} [options.featured] - 仅精选作品
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{items: Array<{id,title,coverUrl,mediaUrls,author,createdAt,featured,category}>, nextCursor: string|null}>}
 */
export async function listShareItems({
  limit = 20,
  cursor = '',
  category = '',
  featured = false,
  signal,
} = {}) {
  const data = await apiGet('/gallery', {
    query: { limit, cursor, category, ...(featured ? { featured: 1 } : {}) },
    signal,
    fallbackMessage: '画廊读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

/* —— 公开分类：带简单内存缓存 —— */
const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000
let categoryCache = null

/**
 * 公开画廊分类（active）。请求失败时返回空数组，调用方按“无分类”降级。
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listGalleryCategories({ signal } = {}) {
  if (categoryCache && categoryCache.expiresAt > Date.now()) return categoryCache.items
  try {
    const data = await apiGet('/gallery/categories', {
      signal,
      fallbackMessage: '画廊分类读取失败',
    })
    const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
    const items = rows
      .map((row) => ({ id: String(row?.id || ''), name: String(row?.name || '').trim() }))
      .filter((row) => row.id && row.name)
    categoryCache = { expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS, items }
    return items
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return []
  }
}

/** 社区概览：投稿弹窗用它拿公开分类（拿不到时回退内置分类）。 */
export async function getShareOverview() {
  const categories = await listGalleryCategories()
  return {
    categories: categories.map((item) => ({ key: item.id, label: item.name })),
    tags: [],
    items: [],
  }
}

/**
 * 我的共享资产（旧接口形状：{ items, pagination }）。
 * 新契约映射到「我的画廊投稿」，字段尽量对齐旧模板使用。
 */
export async function listMyShareAssets({ pageSize = 48 } = {}) {
  const { listMyGallerySubmissions } = await import('./meApi')
  const { items } = await listMyGallerySubmissions({ limit: pageSize })
  return {
    items: items.map((item) => ({
      ...item,
      kind: String(item.kind || item.taskType || ''),
      coverUrl: item.coverUrl || item.mediaUrls?.[0] || '',
    })),
    pagination: { hasMore: false },
  }
}

/**
 * 把自己的成功任务投稿到画廊（后端校验产物仍在）。兼容旧调用的 jobId 字段。
 * 可选 categoryId（来自公开分类接口）；新错误码转换为中文提示后重新抛出。
 */
export async function submitShareItem({ taskId = '', jobId = '', title = '', categoryId = '' } = {}) {
  try {
    return await apiPost(
      '/gallery/submissions',
      {
        taskId: String(taskId || jobId),
        title: String(title || '').trim(),
        ...(categoryId ? { categoryId: String(categoryId) } : {}),
      },
      { fallbackMessage: '投稿失败' },
    )
  } catch (error) {
    if (isApiError(error) && SUBMISSION_ERROR_MESSAGES[error.code]) {
      error.message = SUBMISSION_ERROR_MESSAGES[error.code]
    }
    throw error
  }
}
