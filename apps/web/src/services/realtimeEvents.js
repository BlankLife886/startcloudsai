import { buildApiUrl } from '@/services/apiBase'
import { getApiData, getApiErrorMessage, isApiSuccess } from '@/services/apiResponse'
import { getAuthToken } from '@/services/auth'
import { clientLogHeaders } from '@/services/clientLogHeaders'

export async function fetchRealtimeEvents(cursor = '', limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const token = getAuthToken()
  const response = await fetch(buildApiUrl(`/client/realtime/events?${params.toString()}`), {
    method: 'GET',
    credentials: 'include',
    headers: clientLogHeaders({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !isApiSuccess(payload, response.status)) {
    throw new Error(getApiErrorMessage(payload, '实时事件补偿读取失败'))
  }
  const data = getApiData(payload)
  return {
    events: Array.isArray(data.events) ? data.events : [],
    cursor: String(data.cursor || cursor || ''),
    hasMore: data.hasMore === true,
  }
}
