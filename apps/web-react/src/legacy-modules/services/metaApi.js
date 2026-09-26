/**
 * 公开配置与内容 API（/api/v1/*）。
 */
import { apiGet, buildApiPath } from './apiClient'

/** 任务单价：{ taskPointPrices: { t2i: points, ... } } */
export async function getTaskPricing({ signal } = {}) {
  return apiGet('/pricing', { signal, fallbackMessage: '价格读取失败' })
}

/** 更新说明条目（后台发版）。 */
export async function getRemoteChangelog({ signal } = {}) {
  const data = await apiGet('/changelog', { signal, fallbackMessage: '更新说明读取失败' })
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}

/** 最近一次后台发版，供打开中的页面判断是否需要刷新。 */
export async function getLatestChangelog({ signal } = {}) {
  const data = await apiGet('/changelog/latest', { signal, fallbackMessage: '更新说明读取失败' })
  if (!data || typeof data !== 'object' || !data.id) return null
  return data
}

/** 生效中公告。 */
export async function getActiveAnnouncements({ signal } = {}) {
  const data = await apiGet('/announcements', { signal, cache: 'no-store', fallbackMessage: '公告读取失败' })
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  throw new Error('公告响应格式不正确')
}

/** Public announcement snapshots; EventSource reconnects transport failures. */
export function openAnnouncementEvents({ onSnapshot, onOpen, onError } = {}) {
  if (typeof EventSource === 'undefined') return null
  let source
  try {
    source = new EventSource(buildApiPath('/announcements/events'), { withCredentials: true })
  } catch (error) {
    onError?.(error)
    return null
  }
  source.addEventListener('announcements', (event) => {
    try {
      const payload = JSON.parse(event.data)
      if (!Array.isArray(payload?.items)) throw new Error('公告推送格式不正确')
      onSnapshot?.(payload.items)
    } catch (error) {
      onError?.(error)
    }
  })
  source.onopen = () => onOpen?.()
  source.onerror = (error) => onError?.(error)
  return source
}
