export function isApiSuccess(payload, status = 200) {
  if (!payload || typeof payload !== 'object') return false
  return status >= 200 && status < 300 && payload.success === true
}

export function getApiErrorMessage(payload, fallback = '请求失败') {
  if (payload && typeof payload === 'object') {
    return String(payload.error || payload.message || fallback)
  }
  return fallback
}

export function getApiData(payload) {
  if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error('接口返回缺少 data 字段')
  }
  return payload.data
}

export function unwrapApiData(payload, status = 200, fallback = '请求失败') {
  if (!isApiSuccess(payload, status)) {
    throw new Error(getApiErrorMessage(payload, fallback))
  }
  return getApiData(payload)
}
