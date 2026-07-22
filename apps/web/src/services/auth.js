/**
 * 认证服务（新契约 /api/auth/*）。
 * 鉴权靠 HttpOnly Cookie（sc_session），前端不再保存 token/CSRF；
 * 仅在内存/会话存储里缓存 user 供刷新前快速渲染。
 */
import { apiGet, apiPost } from './apiClient'

const AUTH_SESSION_FALLBACK_KEY = 'sc_auth_session_cache'

export function getAuthSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_FALLBACK_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?.user?.id ? parsed : null
  } catch {
    return null
  }
}

export function setAuthSession(session) {
  if (!session?.user?.id) {
    clearAuthSession()
    return false
  }
  try {
    sessionStorage.setItem(AUTH_SESSION_FALLBACK_KEY, JSON.stringify({ user: session.user }))
    return true
  } catch {
    return false
  }
}

export function clearAuthSession() {
  try {
    sessionStorage.removeItem(AUTH_SESSION_FALLBACK_KEY)
  } catch {
    // Ignore storage failures.
  }
}

export async function fetchAuthProviders() {
  return apiGet('/auth/providers', { fallbackMessage: '登录方式读取失败' })
}

export async function requestEmailAuthCode(email, purpose) {
  return apiPost('/auth/email/code', {
    email: String(email || '').trim(),
    purpose: purpose === 'reset' ? 'reset' : 'register',
  }, { fallbackMessage: '验证码发送失败' })
}

export async function registerAccount({ username, email, code, password }) {
  const data = await apiPost('/auth/register', {
    username: String(username || '').trim(),
    email: String(email || '').trim(),
    code: String(code || '').trim(),
    password: String(password || ''),
  }, { fallbackMessage: '注册失败' })
  if (data?.user?.id) setAuthSession({ user: data.user })
  return data
}

export async function loginAccount({ email, password }) {
  const data = await apiPost('/auth/login', {
    email: String(email || '').trim(),
    password: String(password || ''),
  }, { fallbackMessage: '登录失败' })
  if (data?.user?.id) setAuthSession({ user: data.user })
  return data
}

export async function resetAccountPassword({ email, code, password }) {
  return apiPost('/auth/password/reset', {
    email: String(email || '').trim(),
    code: String(code || '').trim(),
    password: String(password || ''),
  }, { fallbackMessage: '密码重置失败' })
}

export function oauthLoginURL(provider) {
  return `/api/auth/oauth/${encodeURIComponent(provider)}`
}

/** 当前用户；未登录返回 null（后端返回 data.user = null）。 */
export async function fetchCurrentAccount() {
  const data = await apiGet('/auth/me', { fallbackMessage: '登录状态读取失败' })
  const user = data?.user || null
  if (user?.id) {
    setAuthSession({ user })
    return user
  }
  clearAuthSession()
  return null
}

export async function logoutAccount() {
  try {
    return await apiPost('/auth/logout', {}, { fallbackMessage: '退出失败' })
  } finally {
    clearAuthSession()
  }
}
