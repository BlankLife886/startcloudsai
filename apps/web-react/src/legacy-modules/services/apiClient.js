/**
 * 统一 API 客户端（Go REST API）。
 *
 * 所有接口前缀 /api/v1，响应统一：
 *   成功 { success: true, data: {...} }
 *   失败 { success: false, code: 'xxx', error: '...' }
 *
 * 鉴权使用 HttpOnly Cookie（sc_session），因此所有请求 credentials: 'include'。
 */

const API_PREFIX = '/api/v1'

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

/** 2xx 但响应体不是 {success:true}——常见于网关截断 body，Cookie 往往已下发。 */
export function isMalformedSuccessResponse(error) {
  return isApiError(error, 'response_malformed')
    || (isApiError(error) && error.status >= 200 && error.status < 300)
}

/**
 * 401（auth_required）全局处理回调：在应用入口注册（清会话 + 提示 + 跳登录）。
 * 由回调自行判断此前是否为已登录态，避免公开页匿名请求误触发跳转。
 */
let unauthorizedHandler = null

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null
}

export function buildApiPath(path, query = null) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const url = `${API_PREFIX}${normalized}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue
        params.append(key, String(item))
      }
      continue
    }
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function parsePayload(response) {
  if (response.status === 204) return { success: true, data: null }
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 发起请求并解析统一响应格式，失败时抛出带 code 的 ApiError。
 *
 * @param {string} path - 不含 /api/v1 前缀的路径，如 '/tasks'
 * @param {object} options
 * @param {string} [options.method]
 * @param {object|FormData|null} [options.body] - 普通对象自动 JSON 序列化
 * @param {object} [options.query] - query 参数对象
 * @param {AbortSignal} [options.signal]
 * @param {RequestCache} [options.cache]
 * @param {string} [options.fallbackMessage]
 * @returns {Promise<any>} 响应中的 data 字段
 */
export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body = null,
    query = null,
    signal = undefined,
    cache = undefined,
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
      cache,
    })
  } catch (caught) {
    if (caught?.name === 'AbortError') throw caught
    throw new ApiError('网络连接失败，请检查网络后重试', { code: 'network_error', status: 0 })
  }

  const payload = await parsePayload(response)
  if (response.ok && payload?.success === true) {
    return payload.data
  }

  const errorPayload = payload?.error
  const malformedSuccess = response.ok && payload?.success !== true
  const errorMessage = typeof errorPayload === 'string'
    ? errorPayload
    : errorPayload?.message
      || payload?.message
      || (malformedSuccess
        ? `响应异常，请重试（HTTP ${response.status}）`
        : `${fallbackMessage}（${response.status}）`)
  const error = new ApiError(String(errorMessage), {
    code: String(
      payload?.code
        || errorPayload?.code
        || (malformedSuccess
          ? 'response_malformed'
          : (response.status >= 500 ? 'internal_error' : 'request_failed')),
    ),
    status: response.status,
  })
  if (response.status === 401 && error.code === 'auth_required' && unauthorizedHandler) {
    try {
      unauthorizedHandler(error)
    } catch {
      /* 处理器异常不影响原错误抛出 */
    }
  }
  throw error
}

/**
 * Multipart request variant with browser upload progress events.
 * Falls back to fetch when XMLHttpRequest is unavailable.
 */
export function apiUploadRequest(path, options = {}) {
  const {
    method = 'POST',
    body = null,
    query = null,
    signal = undefined,
    fallbackMessage = '请求失败',
    onProgress = undefined,
  } = options
  if (typeof XMLHttpRequest === 'undefined' || !(body instanceof FormData)) {
    return apiRequest(path, { method, body, query, signal, fallbackMessage })
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abortRequest)
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const emitProgress = (event, done = false) => {
      if (typeof onProgress !== 'function') return
      const total = event?.lengthComputable ? Number(event.total || 0) : 0
      const loaded = Number(event?.loaded || (done ? total : 0))
      const percent = done ? 100 : total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0
      try {
        onProgress({ loaded, total, percent, done })
      } catch {
        // UI progress callbacks must never interrupt the request.
      }
    }
    const abortRequest = () => request.abort()

    request.open(method, buildApiPath(path, query), true)
    request.withCredentials = true
    request.upload.onprogress = (event) => emitProgress(event, false)
    request.upload.onload = (event) => emitProgress(event, true)
    request.onerror = () => settle(reject, new ApiError('网络连接失败，请检查网络后重试', { code: 'network_error', status: 0 }))
    request.onabort = () => settle(reject, new DOMException('请求已取消', 'AbortError'))
    request.onload = () => {
      let payload = null
      try {
        payload = request.responseText ? JSON.parse(request.responseText) : null
      } catch {
        payload = null
      }
      const status = Number(request.status || 0)
      const ok = status >= 200 && status < 300
      if (ok && payload?.success === true) {
        settle(resolve, payload.data)
        return
      }
      const errorPayload = payload?.error
      const malformedSuccess = ok && payload?.success !== true
      const errorMessage = typeof errorPayload === 'string'
        ? errorPayload
        : errorPayload?.message
          || payload?.message
          || (malformedSuccess ? `响应异常，请重试（HTTP ${status}）` : `${fallbackMessage}（${status}）`)
      const error = new ApiError(String(errorMessage), {
        code: String(payload?.code || errorPayload?.code || (malformedSuccess ? 'response_malformed' : (status >= 500 ? 'internal_error' : 'request_failed'))),
        status,
      })
      if (status === 401 && error.code === 'auth_required' && unauthorizedHandler) {
        try {
          unauthorizedHandler(error)
        } catch {
          /* 处理器异常不影响原错误抛出 */
        }
      }
      settle(reject, error)
    }

    if (signal?.aborted) {
      settle(reject, new DOMException('请求已取消', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', abortRequest, { once: true })
    request.send(body)
  })
}

export const apiGet = (path, options = {}) => apiRequest(path, { ...options, method: 'GET' })
export const apiPost = (path, body = null, options = {}) =>
  apiRequest(path, { ...options, method: 'POST', body })
export const apiPatch = (path, body = null, options = {}) =>
  apiRequest(path, { ...options, method: 'PATCH', body })
export const apiPut = (path, body = null, options = {}) =>
  apiRequest(path, { ...options, method: 'PUT', body })
export const apiDelete = (path, options = {}) => apiRequest(path, { ...options, method: 'DELETE' })
