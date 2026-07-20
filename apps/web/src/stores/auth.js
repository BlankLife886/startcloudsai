import {
  clearAuthSession,
  fetchCurrentAccount,
  getAuthSession,
  loginAccount,
  logoutAccount,
  registerAccount,
} from '@/services/auth'
import { isCloudSyncEnabled } from '@/services/clientState'
import {
  copyScopedLocalStorageKeys,
  migrateScopedLocalStorageKeys,
} from '@/services/scopedLocalStorage'
import { mergeCloudAiWallpaperState } from '@/services/aiWallpaperState'
import { pushAllLocalClientStateToCloud } from '@/services/clientStateSync'
import storageService from '@/services/storage'
import { DATA_SECTIONS } from '@/services/dataBackup'
import { useDownloadsStore } from '@/stores/downloads'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useSettingsStore } from '@/stores/settings'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useUserStore } from '@/stores/user'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const SCOPED_STORAGE_KEYS = [
  'settings',
  'favorites',
  'favorite_collections',
  'favorites_statistics',
  'favorites_backup',
  'favorites_backup_timestamp',
  'favorites_cleared_marker',
  'favorites_backup_before_clear',
  'favorites_backup_before_import',
  'history',
  'history_statistics',
  'downloads',
  'followed_users',
  'followed_collections_data',
  'followed_tags_data',
]

const SCOPED_LOCAL_KEYS = DATA_SECTIONS.flatMap((section) => section.keys)
  .filter((entry) => entry.type === 'local')
  .map((entry) => entry.key)

export const useAuthStore = defineStore('auth', () => {
  const session = ref(getAuthSession())
  const user = ref(session.value?.user || null)
  const isLoading = ref(false)
  const error = ref('')
  let initPromise = null
  let lastAuthCheckedAt = 0
  const AUTH_SESSION_RECHECK_MS = 5 * 60 * 1000

  const isAuthenticated = computed(() => Boolean(user.value?.id))
  const displayName = computed(() => user.value?.displayName || user.value?.email || '未登录')

  function accountScope(nextUser = null) {
    return nextUser?.id ? `user_${nextUser.id}` : 'guest'
  }

  storageService.setActiveScope(accountScope(user.value))

  function migrateLegacyLocalDataToScope(scope) {
    storageService.migrateKeysToScope(SCOPED_STORAGE_KEYS, scope)
    migrateScopedLocalStorageKeys(SCOPED_LOCAL_KEYS, scope)
  }

  function seedAccountScopeFromGuest(scope) {
    if (!scope || scope === 'guest') return

    const migrationMap = storageService.get('local_scope_migration_v1', {})
    const migratedScopes =
      migrationMap && typeof migrationMap === 'object' && !Array.isArray(migrationMap)
        ? migrationMap
        : {}

    if (migratedScopes[scope]) return

    storageService.copyKeysBetweenScopes(SCOPED_STORAGE_KEYS, 'guest', scope)
    copyScopedLocalStorageKeys(SCOPED_LOCAL_KEYS, 'guest', scope)
    migratedScopes[scope] = new Date().toISOString()
    storageService.set('local_scope_migration_v1', migratedScopes)
  }

  async function syncLocalStateToAccount() {
    return pushAllLocalClientStateToCloud()
  }

  async function reloadSyncedState(options = {}) {
    const settingsStore = useSettingsStore()
    const favoritesStore = useFavoritesStore()
    const historyStore = useHistoryStore()
    const userStore = useUserStore()
    const downloadsStore = useDownloadsStore()
    await Promise.allSettled([
      settingsStore.reloadSettings?.(options),
      favoritesStore.reloadFavorites?.(options),
      historyStore.reloadHistory?.(options),
      Promise.resolve(userStore.initUserData?.(options)),
      Promise.resolve(downloadsStore.initDownloads?.(options)),
      mergeCloudAiWallpaperState(options),
    ])
  }

  async function reloadLocalStores(options = {}) {
    const settingsStore = useSettingsStore()
    const favoritesStore = useFavoritesStore()
    const historyStore = useHistoryStore()
    const userStore = useUserStore()
    const downloadsStore = useDownloadsStore()

    await Promise.allSettled([
      settingsStore.reloadSettings?.(options),
      favoritesStore.reloadFavorites?.(options),
      historyStore.reloadHistory?.(options),
      Promise.resolve(userStore.initUserData?.()),
      Promise.resolve(downloadsStore.initDownloads?.()),
    ])
  }

  async function activateLocalAccountScope(nextUser = null, options = {}) {
    const scope = accountScope(nextUser)
    if (options.seedFromGuest === true) {
      seedAccountScopeFromGuest(scope)
    }
    storageService.setActiveScope(scope)
    if (scope === 'guest' && options.migrateLegacy !== false) {
      migrateLegacyLocalDataToScope(scope)
    }
    if (options.reloadLocal === false) return
    await reloadLocalStores(options.reloadOptions || {})
  }

  function deferLocalAccountReload(options = {}) {
    const run = () => {
      void reloadLocalStores(options).then(() => {
        if (isCloudSyncEnabled()) {
          void mergeCloudAiWallpaperState(options).catch(() => null)
        }
      })
    }
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 1500 })
    } else if (typeof window !== 'undefined') {
      window.setTimeout(run, 0)
    } else {
      run()
    }
  }

  async function resetAuthState(options = {}) {
    clearAuthSession()
    session.value = null
    user.value = null
    error.value = ''
    await activateLocalAccountScope(null, {
      migrateLegacy: false,
      reloadLocal: options.reloadLocal !== false,
    })
    if (options.reloadRuntime !== false) {
      await useRuntimeConfigStore()
        .loadRuntimeConfig({ force: true })
        .catch(() => null)
    }
  }

  async function initAuth(options = {}) {
    if (initPromise) return initPromise
    const force = options.force === true
    const now = Date.now()
    if (!force && lastAuthCheckedAt && now - lastAuthCheckedAt < AUTH_SESSION_RECHECK_MS) {
      return user.value || null
    }

    initPromise = fetchCurrentAccount()
      .then(async (currentUser) => {
        if (!currentUser?.id) {
          if (user.value || session.value) {
            await resetAuthState({ reloadRuntime: false, reloadLocal: true })
          }
          lastAuthCheckedAt = Date.now()
          return null
        }
        user.value = currentUser
        session.value = getAuthSession()
        const deferLocalReload = options.deferLocalReload === true
        await activateLocalAccountScope(currentUser, {
          migrateLegacy: false,
          reloadLocal: !deferLocalReload,
          reloadOptions: {},
        })
        if (deferLocalReload) {
          deferLocalAccountReload()
        } else if (isCloudSyncEnabled() && options.skipCloudMerge !== true) {
          void mergeCloudAiWallpaperState().catch(() => null)
        }
        lastAuthCheckedAt = Date.now()
        return currentUser
      })
      .catch(async (err) => {
        if (
          err?.status === 401 ||
          err?.status === 403 ||
          err?.response?.status === 401 ||
          err?.response?.status === 403
        ) {
          await resetAuthState({ reloadRuntime: false })
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
        turnstileToken: credentials.turnstileToken || '',
      })
      session.value = getAuthSession()
      user.value = result.user
      lastAuthCheckedAt = Date.now()
      await activateLocalAccountScope(result.user, {
        seedFromGuest: credentials.importGuestData === true,
      })
      if (isCloudSyncEnabled()) {
        await reloadSyncedState({ forceRemote: true })
      }
      await useRuntimeConfigStore().loadRuntimeConfig({ force: true })
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
        displayName: payload.displayName,
        referrerId: payload.referrerId,
        emailVerificationToken: payload.emailVerificationToken || '',
        turnstileToken: payload.turnstileToken || '',
      })
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
      try {
        await resetAuthState({ reloadLocal: false })
        lastAuthCheckedAt = Date.now()
        void reloadLocalStores().catch(() => null)
      } finally {
        isLoading.value = false
      }
    }

    return {
      success: !remoteError,
      remoteCleared: !remoteError,
      error: remoteError,
    }
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
  }
})
