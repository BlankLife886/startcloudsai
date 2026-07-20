import { buildApiUrl } from '@/services/apiBase'
import { clientLogHeaders } from '@/services/clientLogHeaders'
import { getApiData, getApiErrorMessage, isApiSuccess } from '@/services/apiResponse'
import { getAuthToken, getCsrfToken } from '@/services/auth'

function authHeaders(extra = {}) {
  const token = getAuthToken()
  const csrfToken = getCsrfToken()
  return clientLogHeaders({
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  })
}

async function readResponse(response, fallback) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !isApiSuccess(payload, response.status)) {
    throw new Error(getApiErrorMessage(payload, fallback))
  }
  return getApiData(payload)
}

export async function listShareItems({
  page = 1,
  pageSize = 16,
  category = '',
  sort = 'recommended',
  favoritesOnly = false,
  cursor = '',
  includeTotal = true,
} = {}) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  params.set('sort', sort)
  params.set('pagination', 'cursor')
  params.set('includeTotal', includeTotal ? '1' : '0')
  if (category) params.set('category', category)
  if (favoritesOnly) params.set('favorites', 'mine')
  if (cursor) params.set('cursor', cursor)
  const response = await fetch(buildApiUrl(`/client/share/items?${params.toString()}`), {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(),
  })
  return readResponse(response, '共享内容读取失败')
}

export async function getShareOverview() {
  const response = await fetch(buildApiUrl('/client/share/overview'), {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(),
  })
  return readResponse(response, '社区概览读取失败')
}

export async function listMyShareAssets({ page = 1, pageSize = 48 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  const response = await fetch(buildApiUrl(`/client/share/mine?${params.toString()}`), {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(),
  })
  return readResponse(response, '我的资产读取失败')
}

export async function toggleShareFavorite(itemId) {
  const response = await fetch(
    buildApiUrl(`/client/share/items/${encodeURIComponent(itemId)}/favorite`),
    {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    },
  )
  return readResponse(response, '收藏失败')
}

export async function recordShareView(itemId) {
  const response = await fetch(buildApiUrl(`/client/share/items/${encodeURIComponent(itemId)}/view`), {
    method: 'POST',
    credentials: 'include',
    headers: clientLogHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
  })
  return readResponse(response, '浏览记录失败')
}

export async function listShareComments(itemId, { page = 1, pageSize = 12 } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  const response = await fetch(
    buildApiUrl(`/client/share/items/${encodeURIComponent(itemId)}/comments?${params.toString()}`),
    { method: 'GET', credentials: 'include', headers: authHeaders() },
  )
  return readResponse(response, '评论读取失败')
}

export async function createShareComment(itemId, content) {
  const response = await fetch(
    buildApiUrl(`/client/share/items/${encodeURIComponent(itemId)}/comments`),
    {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content }),
    },
  )
  return readResponse(response, '评论发布失败')
}

export async function deleteShareComment(commentId) {
  const response = await fetch(buildApiUrl(`/client/share/comments/${encodeURIComponent(commentId)}`), {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  })
  return readResponse(response, '评论删除失败')
}

export async function submitShareItem({
  jobId,
  title = '',
  styleLabel = '',
  description = '',
  category = 'other',
  tags = [],
  commentsEnabled = true,
  allowDownload = false,
  allowRemix = false,
  allowRepost = false,
  licenseCode = 'all-rights-reserved',
  publishPrompt = false,
}) {
  const response = await fetch(buildApiUrl('/client/share/submissions'), {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      jobId,
      title,
      styleLabel,
      description,
      category,
      tags,
      commentsEnabled,
      allowDownload,
      allowRemix,
      allowRepost,
      licenseCode,
      publishPrompt,
    }),
  })
  return readResponse(response, '提交共享审核失败')
}
