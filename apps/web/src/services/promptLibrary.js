import { buildApiUrl } from '@/services/apiBase'
import { clientLogHeaders } from '@/services/clientLogHeaders'
import { getApiData, getApiErrorMessage, isApiSuccess } from '@/services/apiResponse'

export async function listPromptLibrary(
  page = 'text-to-image',
  { pageNumber = 1, pageSize = 24, category = 'all' } = {},
) {
  const params = new URLSearchParams({
    page,
    pageNumber: String(pageNumber),
    pageSize: String(pageSize),
    category: String(category || 'all'),
  })
  const response = await fetch(buildApiUrl(`/client/prompt-library?${params.toString()}`), {
    credentials: 'include',
    headers: clientLogHeaders(),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !isApiSuccess(payload, response.status)) {
    throw new Error(getApiErrorMessage(payload, '提示词库读取失败'))
  }
  return getApiData(payload)
}
