/**
 * 元信息 API（/api/meta/*）。
 */
import { apiGet } from './apiClient'

/** 任务单价：{ taskPrices: { t2i: cents, ... }, freeDailyCents } */
export async function getTaskPricing({ signal } = {}) {
  return apiGet('/meta/pricing', { signal, fallbackMessage: '价格读取失败' })
}

/** 更新说明条目（后台可维护）。 */
export async function getRemoteChangelog({ signal } = {}) {
  const data = await apiGet('/meta/changelog', { signal, fallbackMessage: '更新说明读取失败' })
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}

/** 生效中公告。 */
export async function getActiveAnnouncements({ signal } = {}) {
  const data = await apiGet('/meta/announcements', { signal, fallbackMessage: '公告读取失败' })
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}
