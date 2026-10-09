import { apiGet } from './apiClient'
import { getDefaultPageControls, normalizePageControls } from '@react/config/pageControls.js'

const STUDIO_FEATURE_KEYS = [
  'ai.wallpaperGeneration',
  'ai.illustrationColoring',
  'ai.uiDesign',
  'ai.ecommerceDesign',
  'ai.ultraModelSheet',
  'ai.gameDesign',
  'ai.puzzle',
  'ai.optimize',
  'wallpaper',
]

let cachedRuntimeConfig = null
let cachedRuntimeConfigAt = 0
let runtimeConfigRequest = null
const RUNTIME_CONFIG_CACHE_TTL_MS = 1000

function buildDefaultFeatures() {
  return Object.fromEntries(
    STUDIO_FEATURE_KEYS.map((key) => [key, { enabled: true, config: { publicModels: [] } }]),
  )
}

export function getDefaultRuntimeConfig() {
  return {
    routes: {},
    features: buildDefaultFeatures(),
    pageLayout: {},
    pageControls: getDefaultPageControls(),
    promptInputLimits: {
      t2iPromptMaxChars: 8000,
      assistantMessageMaxChars: 60000,
      studioHubPromptMaxChars: 2000,
    },
    aiModelCatalog: {
      providers: [],
      models: [],
      publicModels: [],
      featurePublicModels: [],
      updatedAt: '',
    },
    blacklist: { blocked: false, reason: '' },
    mqtt: null,
  }
}

function clampPromptMaxChars(value, fallback) {
  const next = Number(value)
  if (!Number.isFinite(next) || next < 100 || next > 100000) return fallback
  return Math.floor(next)
}

export function normalizePromptInputLimits(limits = {}) {
  const defaults = getDefaultRuntimeConfig().promptInputLimits
  const value = limits && typeof limits === 'object' ? limits : {}
  return {
    t2iPromptMaxChars: clampPromptMaxChars(value.t2iPromptMaxChars, defaults.t2iPromptMaxChars),
    assistantMessageMaxChars: clampPromptMaxChars(value.assistantMessageMaxChars, defaults.assistantMessageMaxChars),
    studioHubPromptMaxChars: clampPromptMaxChars(value.studioHubPromptMaxChars, defaults.studioHubPromptMaxChars),
  }
}

export function normalizeRuntimeConfig(config = {}) {
  const defaults = getDefaultRuntimeConfig()
  const value = config && typeof config === 'object' ? config : {}
  return {
    ...defaults,
    ...value,
    features: { ...defaults.features, ...(value.features || {}) },
    pageControls: normalizePageControls(value.pageControls),
    promptInputLimits: normalizePromptInputLimits(value.promptInputLimits),
    aiModelCatalog: { ...defaults.aiModelCatalog, ...(value.aiModelCatalog || {}) },
  }
}

// 动态调价：服务端在 priceSchedule.nextChangeAt 给出下一次有规则开始或结束的时刻。
// 到点后清掉缓存并广播 SITE_PRICES_CHANGED，页面监听后重新拉取配置，价格和「限时调价」
// 标签随之更新。只保留一个定时器；稍微错开几秒，避免所有标签页同时请求。
export const SITE_PRICES_CHANGED = 'sc:site-prices-changed'
const MAX_PRICE_TIMER_MS = 6 * 3600_000
let priceTimer = null
let priceTimerAt = 0

export function schedulePriceRefresh(nextChangeAt) {
  if (typeof window === 'undefined') return
  const at = Date.parse(nextChangeAt || '')
  if (!Number.isFinite(at)) return
  if (priceTimer && priceTimerAt === at) return
  if (priceTimer) window.clearTimeout(priceTimer)
  priceTimerAt = at
  const delay = Math.max(0, at - Date.now()) + 1000 + Math.floor(Math.random() * 3000)
  priceTimer = window.setTimeout(() => {
    priceTimer = null
    if (delay > MAX_PRICE_TIMER_MS) {
      // 很久以后的变化：先醒一次重新拉配置，再按最新时间安排。
      priceTimerAt = 0
      fetchRuntimeConfig({ force: true }).catch(() => null)
      return
    }
    priceTimerAt = 0
    clearRuntimeConfigCache()
    window.dispatchEvent(new CustomEvent(SITE_PRICES_CHANGED))
  }, Math.min(delay, MAX_PRICE_TIMER_MS))
}

export function onSitePricesChanged(handler) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(SITE_PRICES_CHANGED, handler)
  return () => window.removeEventListener(SITE_PRICES_CHANGED, handler)
}

export function clearRuntimeConfigCache() {
  cachedRuntimeConfig = null
  cachedRuntimeConfigAt = 0
  runtimeConfigRequest = null
}

export async function fetchRuntimeConfig({ force = false } = {}) {
  if (!force && cachedRuntimeConfig && Date.now() - cachedRuntimeConfigAt < RUNTIME_CONFIG_CACHE_TTL_MS) {
    return cachedRuntimeConfig
  }
  if (!force && runtimeConfigRequest) return runtimeConfigRequest

  const request = apiGet('/runtime-config', {
    cache: 'no-store',
    fallbackMessage: '模型配置读取失败',
  }).then((config) => {
    cachedRuntimeConfig = normalizeRuntimeConfig(config)
    cachedRuntimeConfigAt = Date.now()
    schedulePriceRefresh(cachedRuntimeConfig.priceSchedule?.nextChangeAt)
    return cachedRuntimeConfig
  })
  runtimeConfigRequest = request
  try {
    return await request
  } finally {
    if (runtimeConfigRequest === request) runtimeConfigRequest = null
  }
}
