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
let runtimeConfigRequest = null

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

export function normalizeRuntimeConfig(config = {}) {
  const defaults = getDefaultRuntimeConfig()
  const value = config && typeof config === 'object' ? config : {}
  return {
    ...defaults,
    ...value,
    features: { ...defaults.features, ...(value.features || {}) },
    pageControls: normalizePageControls(value.pageControls),
    aiModelCatalog: { ...defaults.aiModelCatalog, ...(value.aiModelCatalog || {}) },
  }
}

export function clearRuntimeConfigCache() {
  cachedRuntimeConfig = null
  runtimeConfigRequest = null
}

export async function fetchRuntimeConfig({ force = false } = {}) {
  if (!force && cachedRuntimeConfig) return cachedRuntimeConfig
  if (!force && runtimeConfigRequest) return runtimeConfigRequest

  const request = apiGet('/runtime-config', {
    fallbackMessage: '模型配置读取失败',
  }).then((config) => {
    cachedRuntimeConfig = normalizeRuntimeConfig(config)
    return cachedRuntimeConfig
  })
  runtimeConfigRequest = request
  try {
    return await request
  } finally {
    if (runtimeConfigRequest === request) runtimeConfigRequest = null
  }
}
