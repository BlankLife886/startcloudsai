import { getRuntimeAiProviderConfig } from './aiModels'

export const AI_FEATURE_CONFIGS = [
  {
    key: 'wallpaper',
    title: '文生图',
    icon: 'bi-magic',
    description: '用于文生图页面的文字生图、图生图和图生视频。',
    defaultCapability: 'imageToImage',
    runtimeCapabilities: ['imageToImage', 'imageEdit', 'textToImage', 'imageToVideo'],
  },
  {
    key: 'preview',
    title: '壁纸全屏预览',
    icon: 'bi-aspect-ratio',
    description: '用于全屏预览中的 AI 图像处理。',
    defaultCapability: 'imageEdit',
    runtimeCapabilities: ['imageEdit'],
  },
  {
    key: 'profile',
    title: '个人资料 AI 分析',
    icon: 'bi-person-lines-fill',
    description: '用于个人中心的收藏、浏览和画像分析。',
    defaultCapability: 'profileAnalysis',
    runtimeCapabilities: ['profileAnalysis', 'textToText'],
  },
]

const RUNTIME_FEATURE_KEY_BY_CLIENT_FEATURE = {
  wallpaper: 'ai.wallpaperGeneration',
  preview: 'ai.optimize',
  // Profile analysis uses catalog capability filtering; no gateway feature key.
}

export function getAiFeatureConfig(featureKey) {
  return AI_FEATURE_CONFIGS.find((feature) => feature.key === featureKey) || AI_FEATURE_CONFIGS[0]
}

export function getAiProviderBudget(source, providerId) {
  if (!source) return { dailyBudget: 0, monthlyBudget: 0 }
  const normalizedProvider = String(providerId || '').trim().toLowerCase()
  const dailyKey = normalizedProvider ? `ai_${normalizedProvider}_daily_budget_usd` : ''
  const monthlyKey = normalizedProvider ? `ai_${normalizedProvider}_monthly_budget_usd` : ''
  const getValue =
    typeof source.getSetting === 'function'
      ? (key, fallback) => source.getSetting(key, fallback)
      : (key, fallback) => source[key] ?? fallback
  return {
    dailyBudget: Number(
      (dailyKey ? getValue(dailyKey, getValue('ai_daily_budget_usd', 0)) : getValue('ai_daily_budget_usd', 0)) || 0,
    ),
    monthlyBudget: Number(
      (monthlyKey ? getValue(monthlyKey, getValue('ai_monthly_budget_usd', 0)) : getValue('ai_monthly_budget_usd', 0)) || 0,
    ),
  }
}

export function getAiFeatureEnabledModelIds() {
  return []
}

export function resolveAiFeatureRuntimeConfig(settingsStore, featureKey, overrides = {}) {
  const feature = getAiFeatureConfig(featureKey)
  const runtimeFeature = readRuntimeFeatureConfig(featureKey, overrides.runtimeConfig || null)
  const catalogPublicModels = normalizeRuntimePublicModels(overrides.runtimeModelCatalog?.publicModels)
  const publicModels = normalizeRuntimePublicModels(runtimeFeature?.publicModels)
  const fallbackPublicModels = publicModels.length
    ? publicModels
    : filterPublicModelsForFeature(catalogPublicModels, featureKey)
  const provider =
    overrides.provider ||
    ''
  const providerConfig = getRuntimeAiProviderConfig(provider, overrides.runtimeModelCatalog || null)
  const baseUrl = providerConfig.baseURL || ''
  const model =
    overrides.model ||
    ''

  return {
    feature,
    provider,
    providerConfig,
    baseUrl,
    apiKey: '',
    model: String(model || '').trim(),
    publicModel: null,
    publicModels: fallbackPublicModels,
    ...getAiProviderBudget(settingsStore, provider),
  }
}

function readRuntimeFeatureConfig(featureKey, runtimeConfig) {
  const runtimeFeatureKey = RUNTIME_FEATURE_KEY_BY_CLIENT_FEATURE[featureKey] || featureKey
  if (!runtimeConfig || typeof runtimeConfig !== 'object') return null
  if (runtimeConfig.features?.[runtimeFeatureKey]?.config) return runtimeConfig.features[runtimeFeatureKey].config
  if (runtimeConfig.config?.features?.[runtimeFeatureKey]?.config) return runtimeConfig.config.features[runtimeFeatureKey].config
  if (runtimeConfig[runtimeFeatureKey]) return runtimeConfig[runtimeFeatureKey]
  if (runtimeFeatureKey === 'ai.optimize' && runtimeConfig.publicModels) return runtimeConfig
  return null
}

function normalizeRuntimePublicModels(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const id = String(item?.id || item?.publicModelKey || '').trim()
      if (!id) return null
      return {
        id,
        label: String(item?.label || id),
        capabilities: Array.isArray(item?.capabilities)
          ? item.capabilities.map((capability) => String(capability || '').trim()).filter(Boolean)
          : [],
        userPriceUsd: Number(item?.userPriceUsd || 0),
        creditCost: Number(item?.creditCost || 0),
      }
    })
    .filter(Boolean)
}

function filterPublicModelsForFeature(models, featureKey) {
  if (!models.length) return []
  const wanted = featureKey === 'profile'
    ? ['text.chat', 'text.analysis', 'image.understand']
    : featureKey === 'preview' || featureKey === 'wallpaper'
      ? ['image.edit', 'image.generate', 'image.understand']
      : []
  if (!wanted.length) return models
  return models.filter((model) => model.capabilities.some((capability) => wanted.includes(capability)))
}
