/**
 * 公开配置与内容 API（/api/v1/*）。
 */
import { apiGet } from './apiClient'

/** 任务单价：{ taskPointPrices: { t2i: points, ... } } */
export async function getTaskPricing({ signal } = {}) {
  return apiGet('/pricing', { signal, fallbackMessage: '价格读取失败' })
}

/** 更新说明条目（后台可维护）。 */
export async function getRemoteChangelog({ signal } = {}) {
  const data = await apiGet('/changelog', { signal, fallbackMessage: '更新说明读取失败' })
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}

/** 生效中公告。 */
export async function getActiveAnnouncements({ signal } = {}) {
  const data = await apiGet('/announcements', { signal, fallbackMessage: '公告读取失败' })
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}
