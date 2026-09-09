import { apiGet, apiPost } from './apiClient'

export async function listMyFeedback({ limit = 20, cursor = '', signal } = {}) {
  const data = await apiGet('/me/feedback', {
    query: { limit, cursor },
    signal,
    fallbackMessage: '反馈记录读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

export async function submitFeedback({ category, title, content, pageUrl = '' }) {
  return apiPost(
    '/me/feedback',
    {
      category: String(category || '').trim(),
      title: String(title || '').trim(),
      content: String(content || '').trim(),
      pageUrl: String(pageUrl || '').trim() || undefined,
    },
    { fallbackMessage: '反馈提交失败' },
  )
}
