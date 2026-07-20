import axios from 'axios'
import { API_BASE_URL, buildApiUrl } from './apiBase'
import { getApiData, getApiErrorMessage, isApiSuccess } from './apiResponse'
import { attachClientLogHeaders } from './clientLogHeaders'
import { getClientId } from './clientIdentity'
import storageService from './storage'

const AUTH_SESSION_KEY = 'auth_session'
const AUTH_SESSION_FALLBACK_KEY = 'walleven_auth_session_fallback'

const authApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 12000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  validateStatus: () => true,
})

authApi.interceptors.request.use((config) => attachClientLogHeaders(config))

let authConfigCache = null
let authConfigPromise = null

export function getAuthSession() {
  return (
    normalizeStoredSession(storageService.get(AUTH_SESSION_KEY, null)) || getFallbackAuthSession()
  )
}

export function getAuthToken() {
  return getAuthSession()?.token || ''
}

export function getCsrfToken() {
  return getAuthSession()?.csrfToken || ''
}

export function setAuthSession(session) {
  if (!session) {
    clearAuthSession()
    return false
  }
  const stored = storageService.set(AUTH_SESSION_KEY, session)
  setFallbackAuthSession(session)
  return stored
}

export function clearAuthSession() {
  storageService.remove(AUTH_SESSION_KEY)
  try {
    sessionStorage.removeItem(AUTH_SESSION_FALLBACK_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function normalizeStoredSession(session) {
  if (!session || typeof session !== 'object') return null
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    clearAuthSession()
    return null
  }
  return session
}

function getFallbackAuthSession() {
  try {
    return normalizeStoredSession(
      JSON.parse(sessionStorage.getItem(AUTH_SESSION_FALLBACK_KEY) || 'null'),
    )
  } catch {
    return null
  }
}

function setFallbackAuthSession(session) {
  try {
    sessionStorage.setItem(AUTH_SESSION_FALLBACK_KEY, JSON.stringify(session))
  } catch {
    // Ignore storage failures.
  }
}

function authHeaders() {
  const token = getAuthToken()
  const csrfToken = getCsrfToken()
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  }
}

function normalizeAuthResponse(response) {
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !isApiSuccess(response.data, response.status)
  ) {
    const error = new Error(getApiErrorMessage(response.data, `认证失败(${response.status})`))
    error.response = response
    error.status = response.status
    throw error
  }
  return getApiData(response.data)
}

export async function fetchAuthConfig(options = {}) {
  if (!options.force && authConfigCache) return authConfigCache
  if (!options.force && authConfigPromise) return authConfigPromise

  authConfigPromise = authApi
    .get('/client/auth/config')
    .then((response) => {
      const data = normalizeAuthResponse(response)
      authConfigCache = data.config || data
      return authConfigCache
    })
    .catch(() => {
      authConfigCache = {
        turnstileSiteKey: '',
        turnstileEnabled: false,
        requireEmailVerification: true,
        oauthProviders: [],
      }
      return authConfigCache
    })
    .finally(() => {
      authConfigPromise = null
    })

  return authConfigPromise
}

export async function requestEmailCode({ email, purpose = 'register', turnstileToken = '' }) {
  const response = await authApi.post('/client/auth/email-code/request', {
    email,
    purpose,
    turnstileToken,
    clientId: getClientId(),
  })
  return normalizeAuthResponse(response)
}

export async function verifyEmailCode({ email, code, purpose = 'register' }) {
  const response = await authApi.post('/client/auth/email-code/verify', {
    email,
    code,
    purpose,
  })
  return normalizeAuthResponse(response)
}

export async function registerAccount({
  email,
  password,
  displayName = '',
  referrerId = '',
  emailVerificationToken = '',
  turnstileToken = '',
}) {
  const response = await authApi.post('/client/auth/register', {
    email,
    password,
    displayName,
    clientId: getClientId(),
    referrerId,
    emailVerificationToken,
    turnstileToken,
  })
  return normalizeAuthResponse(response)
}

export async function loginAccount({ email, password, turnstileToken = '' }) {
  const response = await authApi.post('/client/auth/login', {
    email,
    password,
    clientId: getClientId(),
    turnstileToken,
  })
  const data = normalizeAuthResponse(response)
  setAuthSession({
    user: data.user,
    token: data.token || '',
    csrfToken: data.csrfToken || '',
    expiresAt: data.expiresAt,
  })
  return data
}

export async function fetchCurrentAccount() {
  const response = await authApi.get('/client/auth/me', {
    headers: authHeaders(),
  })

  if (response.status === 401 || response.status === 403) {
    clearAuthSession()
    return null
  }

  const data = normalizeAuthResponse(response)
  if (!data?.user?.id) {
    clearAuthSession()
    return null
  }

  const session = getAuthSession()
  setAuthSession({
    ...(session || {}),
    user: data.user,
    token: session?.token || '',
    csrfToken: data.csrfToken || session?.csrfToken || '',
  })
  return data.user
}

export async function logoutAccount() {
  const response = await authApi.post('/client/auth/logout', null, {
    headers: authHeaders(),
  })
  clearAuthSession()
  return normalizeAuthResponse(response)
}

export async function requestPasswordReset({ email, turnstileToken = '' }) {
  const response = await authApi.post('/client/auth/password-reset/request', {
    email,
    identifier: email,
    clientId: getClientId(),
    turnstileToken,
  })
  return normalizeAuthResponse(response)
}

export async function confirmPasswordReset({
  token = '',
  email = '',
  verificationToken = '',
  newPassword,
}) {
  const response = await authApi.post('/client/auth/password-reset/confirm', {
    token,
    email,
    verificationToken,
    newPassword,
    password: newPassword,
  })
  return normalizeAuthResponse(response)
}

export async function verifyMagicLinkToken(token) {
  const response = await authApi.post('/client/auth/magic-link/verify', {
    token,
    clientId: getClientId(),
  })
  const data = normalizeAuthResponse(response)
  setAuthSession({
    user: data.user,
    token: data.token || '',
    csrfToken: data.csrfToken || '',
    expiresAt: data.expiresAt,
  })
  return data
}

export function buildOAuthStartUrl(provider, redirect = '/profile') {
  const params = new URLSearchParams({
    redirect,
    client_id: getClientId(),
  })
  return buildApiUrl(`/client/auth/oauth/${provider}/start?${params.toString()}`)
}
