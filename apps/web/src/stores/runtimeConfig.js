import { fetchRuntimeConfig, getDefaultRuntimeConfig, normalizeRuntimeConfig } from '@/services/runtimeConfig'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const RUNTIME_CONFIG_STORAGE_KEY = 'walleven.runtime-config.v1'
const RUNTIME_CONFIG_STORAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const ROUTE_FALLBACK_MESSAGES = {
  hidden: '当前页面暂未开放',
  disabled: '当前页面暂未开放',
  maintenance: '当前页面维护中',
  forbidden: '当前页面无访问权限',
}

export const useRuntimeConfigStore = defineStore('runtimeConfig', () => {
  const hydrated = hydrateRuntimeConfigFromStorage()
  const config = ref(hydrated?.config || getDefaultRuntimeConfig())
  const isLoading = ref(false)
  const isReady = ref(Boolean(hydrated))
  const error = ref('')
  let loadPromise = null
  let lastLoadedAt = hydrated?.savedAt || 0

  const blacklist = computed(() => config.value.blacklist || {})
  const isBlocked = computed(() => Boolean(blacklist.value.blocked))
  const blockReason = computed(() => blacklist.value.reason || '当前账号或设备已被限制')

  async function loadRuntimeConfig(options = {}) {
    const now = Date.now()
    const force = options.force === true
    const background = options.background === true
    if (loadPromise) return loadPromise
    if (!force && isReady.value && now - lastLoadedAt < REFRESH_INTERVAL_MS) {
      return config.value
    }

    if (!background) {
      isLoading.value = true
    }
    error.value = ''
    loadPromise = fetchRuntimeConfig()
      .then((nextConfig) => {
        config.value = nextConfig
        isReady.value = true
        lastLoadedAt = Date.now()
        persistRuntimeConfigToStorage(nextConfig)
        return nextConfig
      })
      .catch((err) => {
        error.value = err?.message || '运行时配置读取失败'
        isReady.value = true
        return config.value
      })
      .finally(() => {
        isLoading.value = false
        loadPromise = null
      })

    return loadPromise
  }

  function refreshRuntimeConfigInBackground() {
    return loadRuntimeConfig({ background: true, force: true }).catch(() => config.value)
  }

  function getRouteConfig(path = '') {
    const normalized = normalizePath(path)
    const routes = config.value.routes || {}
    if (routes[path]) return normalizeRouteConfig(routes[path])
    if (routes[normalized]) return normalizeRouteConfig(routes[normalized])
    const matchedKey = Object.keys(routes)
      .filter((routePath) => routePath !== '/' && normalized.startsWith(`${routePath}/`))
      .sort((a, b) => b.length - a.length)[0]
    return matchedKey ? normalizeRouteConfig(routes[matchedKey]) : { enabled: true, fallbackType: 'hidden' }
  }

  function isRouteEnabled(path = '') {
    return getRouteConfig(path).enabled !== false
  }

  function getRouteFallbackType(path = '') {
    return getRouteConfig(path).fallbackType || 'hidden'
  }

  function isRouteVisible(path = '') {
    const routeConfig = getRouteConfig(path)
    return routeConfig.enabled !== false || routeConfig.fallbackType === 'disabled'
  }

  function isRouteClickable(path = '') {
    return getRouteConfig(path).enabled !== false
  }

  function getRouteDisabledMessage(path = '') {
    const routeConfig = getRouteConfig(path)
    return routeConfig.message || ROUTE_FALLBACK_MESSAGES[routeConfig.fallbackType] || ROUTE_FALLBACK_MESSAGES.hidden
  }

  function getFeatureConfig(featureKey = '') {
    return (config.value.features || {})[featureKey] || { enabled: true }
  }

  function isFeatureEnabled(featureKey = '') {
    return getFeatureConfig(featureKey).enabled !== false
  }

  function getFeaturePayload(featureKey = '') {
    return getFeatureConfig(featureKey).config || {}
  }

  function getAiModelCatalog() {
    return config.value.aiModelCatalog || { providers: [], models: [], publicModels: [], featurePublicModels: [], updatedAt: '' }
  }

  function getPageLayout(pageKey = '') {
    const pageLayout = (config.value.pageLayout || {})[pageKey] || {}
    if (!pageLayout || typeof pageLayout !== 'object' || pageLayout.enabled !== false) {
      return pageLayout
    }
    return Object.entries(pageLayout).reduce((next, [key, value]) => {
      if (key === 'enabled') {
        next[key] = false
        return next
      }
      next[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? { ...value, enabled: false }
          : value
      return next
    }, {})
  }

  function canUse(featureKey = '') {
    if (isBlocked.value) return false
    return isFeatureEnabled(featureKey)
  }

  return {
    config,
    isLoading,
    isReady,
    error,
    blacklist,
    isBlocked,
    blockReason,
    loadRuntimeConfig,
    refreshRuntimeConfigInBackground,
    getRouteConfig,
    isRouteEnabled,
    getRouteFallbackType,
    isRouteVisible,
    isRouteClickable,
    getRouteDisabledMessage,
    getFeatureConfig,
    isFeatureEnabled,
    getFeaturePayload,
    getAiModelCatalog,
    getPageLayout,
    canUse,
  }
})

function hydrateRuntimeConfigFromStorage() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const savedAt = Number(parsed?.savedAt || 0)
    if (!parsed?.config || !savedAt) return null
    if (Date.now() - savedAt > RUNTIME_CONFIG_STORAGE_MAX_AGE_MS) return null
    return {
      config: normalizeRuntimeConfig(parsed.config),
      savedAt,
    }
  } catch {
    return null
  }
}

function persistRuntimeConfigToStorage(nextConfig) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      RUNTIME_CONFIG_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        config: nextConfig,
      }),
    )
  } catch {
    /* ignore quota */
  }
}

function normalizePath(path = '') {
  if (!path) return '/'
  const value = String(path).split('?')[0].split('#')[0]
  return value || '/'
}

function normalizeRouteConfig(routeConfig = {}) {
  const fallbackType = ['hidden', 'disabled', 'maintenance', 'forbidden'].includes(routeConfig.fallbackType)
    ? routeConfig.fallbackType
    : 'hidden'
  return {
    ...routeConfig,
    enabled: routeConfig.enabled !== false,
    fallbackType,
    message: routeConfig.message || ROUTE_FALLBACK_MESSAGES[fallbackType] || ROUTE_FALLBACK_MESSAGES.hidden,
  }
}
