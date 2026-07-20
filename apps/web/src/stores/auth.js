import {
  clearAuthSession,
  fetchCurrentAccount,
  getAuthSession,
  loginAccount,
  logoutAccount,
  registerAccount,
} from '@/services/auth'
import storageService from '@/services/storage'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const session = ref(getAuthSession())
  const user = ref(session.value?.user || null)
  const isLoading = ref(false)
  const error = ref('')
  let initPromise = null
  let lastAuthCheckedAt = 0
  const AUTH_SESSION_RECHECK_MS = 5 * 60 * 1000

  const isAuthenticated = computed(() => Boolean(user.value?.id))
  const displayName = computed(
    () => user.value?.username || user.value?.displayName || user.value?.email || '未登录',
  )

  function accountScope(nextUser = null) {
    return nextUser?.id ? `user_${nextUser.id}` : 'guest'
  }

  storageService.setActiveScope(accountScope(user.value))

  function applyUser(nextUser) {
    user.value = nextUser || null
    session.value = nextUser ? { user: nextUser } : null
    storageService.setActiveScope(accountScope(nextUser))
  }

  function resetAuthState() {
    clearAuthSession()
    applyUser(null)
    error.value = ''
  }

  async function initAuth(options = {}) {
    if (initPromise) return initPromise
    const force = options.force === true
    const now = Date.now()
    if (!force && lastAuthCheckedAt && now - lastAuthCheckedAt < AUTH_SESSION_RECHECK_MS) {
      return user.value || null
    }

    initPromise = fetchCurrentAccount()
      .then((currentUser) => {
        lastAuthCheckedAt = Date.now()
        if (!currentUser?.id) {
          if (user.value || session.value) resetAuthState()
          return null
        }
        applyUser(currentUser)
        return currentUser
      })
      .catch((err) => {
        if (err?.status === 401 || err?.status === 403) {
          resetAuthState()
          lastAuthCheckedAt = Date.now()
          return null
        }
        throw err
      })
      .finally(() => {
        initPromise = null
      })

    return initPromise
  }

  async function login(credentials) {
    isLoading.value = true
    error.value = ''
    try {
      const result = await loginAccount({
        email: credentials.email,
        password: credentials.password,
      })
      applyUser(result.user)
      lastAuthCheckedAt = Date.now()
      return result
    } catch (err) {
      error.value = err?.message || '登录失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function register(payload) {
    isLoading.value = true
    error.value = ''
    try {
      const result = await registerAccount({
        email: payload.email,
        password: payload.password,
        username: payload.username || payload.displayName || '',
      })
      // 新契约注册即登录
      if (result?.user?.id) {
        applyUser(result.user)
        lastAuthCheckedAt = Date.now()
      }
      return result
    } catch (err) {
      error.value = err?.message || '注册失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function logout() {
    isLoading.value = true
    error.value = ''
    let remoteError = null
    try {
      await logoutAccount()
    } catch (err) {
      remoteError = err
    } finally {
      resetAuthState()
      lastAuthCheckedAt = Date.now()
      isLoading.value = false
    }

    return {
      success: !remoteError,
      remoteCleared: !remoteError,
      error: remoteError,
    }
  }

  /** 修改资料后同步本地 user 快照。 */
  function patchUser(partial = {}) {
    if (!user.value) return
    applyUser({ ...user.value, ...partial })
  }

  return {
    session,
    user,
    isLoading,
    error,
    isAuthenticated,
    displayName,
    initAuth,
    login,
    register,
    logout,
    patchUser,
  }
})
