/**
 * 统一 API 客户端（新 FastAPI 后端）。
 *
 * 所有接口前缀 /api，响应统一：
 *   成功 { success: true, data: {...} }
 *   失败 { success: false, code: 'xxx', error: '...' }
 *
 * 鉴权使用 HttpOnly Cookie（sc_session），因此所有请求 credentials: 'include'。
 */

const API_PREFIX = '/api'

export class ApiError extends Error {
  constructor(message, { code = '', status = 0 } = {}) {
    super(message || '请求失败')
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function isApiError(error, code = '') {
  if (!(error instanceof ApiError)) return false
  return code ? error.code === code : true
}

export function buildApiPath(path, query = null) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const url = `${API_PREFIX}${normalized}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function parsePayload(response) {
  return response.json().catch(() => null)
}

/**
 * 发起请求并解析统一响应格式，失败时抛出带 code 的 ApiError。
 *
 * @param {string} path - 不含 /api 前缀的路径，如 '/tasks'
 * @param {object} options
 * @param {string} [options.method]
 * @param {object|FormData|null} [options.body] - 普通对象自动 JSON 序列化
 * @param {object} [options.query] - query 参数对象
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.fallbackMessage]
 * @returns {Promise<any>} 响应中的 data 字段
 */
export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body = null,
    query = null,
    signal = undefined,
    fallbackMessage = '请求失败',
  } = options

  const headers = {}
  let requestBody
  if (body instanceof FormData) {
    requestBody = body
  } else if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json'
    requestBody = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(buildApiPath(path, query), {
      method,
      credentials: 'include',
      headers,
      body: requestBody,
      signal,
    })
  } catch (caught) {
    if (caught?.name === 'AbortError') throw caught
    throw new ApiError('网络连接失败，请检查网络后重试', { code: 'network_error', status: 0 })
  }

  const payload = await parsePayload(response)
  if (!response.ok || !payload || payload.success !== true) {
    throw new ApiError(String(payload?.error || `${fallbackMessage}（${response.status}）`), {
      code: String(payload?.code || (response.status >= 500 ? 'internal_error' : 'request_failed')),
      status: response.status,
    })
  }
  return payload.data
}

export const apiGet = (path, options = {}) => apiRequest(path, { ...options, method: 'GET' })
export const apiPost = (path, body = null, options = {}) =>
  apiRequest(path, { ...options, method: 'POST', body })
export const apiPatch = (path, body = null, options = {}) =>
  apiRequest(path, { ...options, method: 'PATCH', body })
export const apiDelete = (path, options = {}) => apiRequest(path, { ...options, method: 'DELETE' })
