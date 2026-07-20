/**
 * 画廊 API（新契约 /api/gallery*）。
 * 公开列表 + 投稿 + 我的投稿；旧的评论/收藏/浏览统计接口已随后端下线。
 */
import { apiGet, apiPost } from './apiClient'
export { deleteMyGallerySubmission, listMyGallerySubmissions } from './meApi'

/**
 * 公开已过审作品（cursor 分页）。
 * @returns {Promise<{items: Array<{id,title,coverUrl,mediaUrls,author,createdAt}>, nextCursor: string|null}>}
 */
export async function listShareItems({ limit = 20, cursor = '', signal } = {}) {
  const data = await apiGet('/gallery', {
    query: { limit, cursor },
    signal,
    fallbackMessage: '画廊读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

/** 社区概览：新契约无该接口，返回空目录（投稿弹窗回退到内置分类）。 */
export async function getShareOverview() {
  return { categories: [], tags: [], items: [] }
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

/** 把自己的成功任务投稿到画廊（后端校验产物仍在）。兼容旧调用的 jobId 字段。 */
export async function submitShareItem({ taskId = '', jobId = '', title = '' } = {}) {
  return apiPost(
    '/gallery/submissions',
    { taskId: String(taskId || jobId), title: String(title || '').trim() },
    { fallbackMessage: '投稿失败' },
  )
}
