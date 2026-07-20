import { getClientId } from './clientIdentity'

export function getCurrentPagePath() {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}`
}

export function clientLogHeaders(extraHeaders = {}) {
  return {
    ...extraHeaders,
    'X-Client-Id': getClientId(),
    ...(getCurrentPagePath() ? { 'X-Page-Path': getCurrentPagePath() } : {}),
  }
}

export function attachClientLogHeaders(config = {}) {
  config.headers = clientLogHeaders(config.headers || {})
  return config
}
