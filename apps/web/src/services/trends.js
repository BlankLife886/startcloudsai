import { buildApiUrl } from '@/services/api'
import { getApiData, getApiErrorMessage, isApiSuccess } from '@/services/apiResponse'

export async function fetchTrendSnapshot(filters = {}) {
  const params = new URLSearchParams()
  if (filters.source) params.set('source', filters.source)
  if (filters.group) params.set('group', filters.group)
  if (filters.query) params.set('q', filters.query)
  if (filters.refresh) params.set('refresh', '1')
  params.set('limit', String(filters.limit || 120))
  const response = await fetch(buildApiUrl(`/client/trends?${params}`), {
    credentials: 'include',
    cache: filters.refresh ? 'no-store' : 'default',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !isApiSuccess(payload, response.status)) {
    throw new Error(getApiErrorMessage(payload, `热点读取失败（${response.status}）`))
  }
  return getApiData(payload)
}
