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

export async function fetchRuntimeConfig() {
  const config = await apiGet('/runtime-config', {
    fallbackMessage: '模型配置读取失败',
  })
  return normalizeRuntimeConfig(config)
}
