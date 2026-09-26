/**
 * 认证服务（新契约 /api/v1/auth/*）。
 * 鉴权靠 HttpOnly Cookie（sc_session），前端不再保存 token/CSRF；
 * 仅在内存/会话存储里缓存 user 供刷新前快速渲染。
 */
import { apiDelete, apiGet, apiPost, isMalformedSuccessResponse } from './apiClient.js'

const AUTH_SESSION_FALLBACK_KEY = 'sc_auth_session_cache'
let currentAccountRequest = null

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

export async function requestEmailAuthCode(email) {
  try {
    return await apiPost(
      '/auth/email-verification-codes',
      {
        email: String(email || '').trim(),
      },
      { fallbackMessage: '验证码发送失败' },
    )
  } catch (error) {
    // 发码成功但 body 偶发丢失时，服务端通常已写入验证码；按已发送处理，避免误导重试撞限流。
    if (isMalformedSuccessResponse(error)) {
      return { expiresIn: 600, resendAfter: 60 }
    }
    throw error
  }
}

export async function verifyEmailAccount({ email, code, referralCode = '', skipReferral = false }) {
  try {
    const data = await apiPost(
      '/auth/session',
      {
        email: String(email || '').trim(),
        code: String(code || '').trim(),
        referralCode: String(referralCode || ''),
        skipReferral: Boolean(skipReferral),
      },
      { fallbackMessage: '验证失败' },
    )
    if (data?.user?.id) setAuthSession({ user: data.user })
    return data
  } catch (error) {
    // 登录接口偶发只带回 Set-Cookie、JSON body 被截断；用会话探针恢复。
    if (!isMalformedSuccessResponse(error)) throw error
    const user = await fetchCurrentAccount()
    if (!user?.id) throw error
    return { user, isNewUser: false, referral: { status: 'unknown', message: '' } }
  }
}

/** 当前用户；未登录返回 null（后端返回 data.user = null）。 */
export async function fetchCurrentAccount() {
  if (currentAccountRequest) return currentAccountRequest
  const request = apiGet('/auth/session', { fallbackMessage: '登录状态读取失败' }).then((data) => {
    const user = data?.user || null
    if (user?.id) {
      setAuthSession({ user })
      return user
    }
    clearAuthSession()
    return null
  })
  currentAccountRequest = request
  try {
    return await request
  } finally {
    if (currentAccountRequest === request) currentAccountRequest = null
  }
}

export async function logoutAccount() {
  try {
    return await apiDelete('/auth/session', { fallbackMessage: '退出失败' })
  } finally {
    clearAuthSession()
  }
}
