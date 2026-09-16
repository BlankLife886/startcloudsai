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
      assistantMessageMaxChars: 12000,
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
    return cachedRuntimeConfig
  })
  runtimeConfigRequest = request
  try {
    return await request
  } finally {
    if (runtimeConfigRequest === request) runtimeConfigRequest = null
  }
}
