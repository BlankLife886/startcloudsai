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

/** 注册并登录，返回 { user }。 */
export async function registerAccount({ email, password, displayName = '', username = '' }) {
  const data = await apiPost(
    '/auth/register',
    {
      email: String(email || '').trim(),
      password: String(password || ''),
      ...(username || displayName ? { username: String(username || displayName).trim() } : {}),
    },
    { fallbackMessage: '注册失败' },
  )
  if (data?.user?.id) setAuthSession({ user: data.user })
  return data
}

/** 登录，返回 { user }。 */
export async function loginAccount({ email, password }) {
  const data = await apiPost(
    '/auth/login',
    {
      email: String(email || '').trim(),
      password: String(password || ''),
    },
    { fallbackMessage: '登录失败' },
  )
  if (data?.user?.id) setAuthSession({ user: data.user })
  return data
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
