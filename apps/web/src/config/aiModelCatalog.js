const AI_CAPABILITY_LABELS = {
  textToText: '文本模型',
  imageToText: '图像理解',
  textToImage: '文生图',
  imageToImage: '图生图',
  imageEdit: '图片编辑',
  textToVideo: '文生视频',
  imageToVideo: '图生视频',
  referenceToVideo: '参考生视频',
  videoToVideo: '视频生视频',
  startEndFrame: '首尾帧视频',
  motionControl: '运动控制',
  imageTo3d: '图生 3D',
  textToAudio: '文生音频',
  audioToText: '音频转文字',
  voiceClone: '声音克隆',
  embedding: '向量模型',
  webSearch: '联网搜索',
  fileAnalysis: '文件分析',
  profileAnalysis: '个人中心分析',
  'text.chat': '文本对话',
  'text.analysis': '数据分析',
  'image.understand': '图片理解',
  'image.generate': '图片生成',
  'image.edit': '图片编辑',
  'image.toVideo': '图生视频',
  'text.toVideo': '文生视频',
  'image.to3d': '图转 3D',
  'file.analysis': '文件分析',
  'web.search': '联网搜索',
  'tool.calling': '工具调用',
}

const PRICE_UNKNOWN_NOTE = '后台暂未配置费用，请以账单为准'

export const AI_PROVIDER_CATALOG = []
export const IMAGE_MODEL_PROVIDERS = []
export const PROFILE_ANALYSIS_PROVIDERS = [
  {
    id: 'inherit',
    label: '继承全局 AI 设置',
    baseURL: '',
  },
]

export function formatAiCapabilityLabel(capability) {
  return AI_CAPABILITY_LABELS[capability] || capability
}

export function getAiProviderConfig(providerId) {
  return {
    id: providerId || '',
    label: providerId || '未配置服务商',
    baseURL: '',
    note: '模型由后台 AI 中转站统一下发，用户端不再内置服务商模型目录。',
    models: [],
  }
}

export function getRuntimeAiProviderConfig(providerId, runtimeCatalog = null) {
  const catalog = normalizeRuntimeCatalog(runtimeCatalog)
  const runtimeProvider = catalog.providers.find((item) => item.id === providerId)
  const providerModels = catalog.models
    .filter((item) => item.provider === providerId || item.providerKey === providerId || item.providerId === providerId)
    .map((item) => normalizeRuntimeModel(item, providerId))
    .filter(Boolean)

  return {
    id: providerId || runtimeProvider?.id || '',
    label: runtimeProvider?.label || providerId || '未配置服务商',
    baseURL: runtimeProvider?.baseURL || runtimeProvider?.baseUrl || '',
    note: runtimeProvider?.note || '由后台 AI 中转站下发。',
    ...runtimeProvider,
    models: providerModels,
  }
}

export function getAiProviderModels(providerId, capability = '') {
  return getRuntimeAiProviderModels(providerId, capability, null)
}

export function getRuntimeAiProviderModels(providerId, capability = '', runtimeCatalog = null) {
  const provider = getRuntimeAiProviderConfig(providerId, runtimeCatalog)
  const models = !capability
    ? provider.models
    : provider.models.filter((item) => item.capabilities.includes(capability))
  return models.sort(
    (a, b) =>
      Number(!!b.adapterReady) - Number(!!a.adapterReady) ||
      a.label.localeCompare(b.label, 'zh-Hans-CN'),
  )
}

export function filterAiProviderModels(providerId, capability = '', enabledModelIds = []) {
  return filterRuntimeAiProviderModels(providerId, capability, enabledModelIds, null)
}

export function filterRuntimeAiProviderModels(
  providerId,
  capability = '',
  enabledModelIds = [],
  runtimeCatalog = null,
) {
  const enabledSet = new Set(
    (Array.isArray(enabledModelIds) ? enabledModelIds : [])
      .map((item) => String(item).trim())
      .filter(Boolean),
  )
  const models = getRuntimeAiProviderModels(providerId, capability, runtimeCatalog)
  if (!enabledSet.size) return models
  return models.filter((model) => enabledSet.has(model.id) || enabledSet.has(`${providerId}:${model.id}`))
}

export function getRuntimeAiProviderCapabilities(providerId, runtimeCatalog = null) {
  const capabilities = new Set()
  getRuntimeAiProviderConfig(providerId, runtimeCatalog).models.forEach((item) => {
    ;(item.capabilities || []).forEach((capability) => capabilities.add(capability))
  })
  return Array.from(capabilities)
}

export function getAiProviderCapabilities(providerId) {
  return getRuntimeAiProviderCapabilities(providerId, null)
}

export function getAiModelConfig(modelId, providerId = '') {
  return getRuntimeAiModelConfig(modelId, providerId, null)
}

export function getRuntimeAiModelConfig(modelId, providerId = '', runtimeCatalog = null) {
  const catalog = normalizeRuntimeCatalog(runtimeCatalog)
  const providerIds = providerId
    ? [providerId]
    : catalog.providers.map((provider) => provider.id).filter(Boolean)

  for (const id of providerIds) {
    const provider = getRuntimeAiProviderConfig(id, catalog)
    const found = provider.models.find((item) => item.id === modelId || `${id}:${item.id}` === modelId)
    if (found) return found
  }
  return null
}

export function hasRuntimeAiModelCatalog(runtimeCatalog = null) {
  const catalog = normalizeRuntimeCatalog(runtimeCatalog)
  return Boolean(catalog.providers.length || catalog.models.length || catalog.publicModels.length)
}

export const IMAGE_TO_IMAGE_MODELS = []
export const TEXT_TO_IMAGE_MODELS = []
export const IMAGE_TO_VIDEO_MODELS = []
export const PROFILE_ANALYSIS_MODELS = []

export function getImageModelPricing(model, providerId = '') {
  return getRuntimeImageModelPricing(model, providerId, null)
}

export function getRuntimeImageModelPricing(model, providerId = '', runtimeCatalog = null) {
  const config = getRuntimeAiModelConfig(model, providerId, runtimeCatalog)
  return normalizePricing(config?.pricing)
}

export function formatImageModelPrice(model, providerId = '') {
  return formatRuntimeImageModelPrice(model, providerId, null)
}

export function formatRuntimeImageModelPrice(model, providerId = '', runtimeCatalog = null) {
  const pricing = getRuntimeImageModelPricing(model, providerId, runtimeCatalog)
  if (pricing.display) return pricing.display
  if (!pricing.usd) return '费用未配置'
  const unitLabel = pricing.unit === 'video' ? '条' : pricing.unit === 'token' ? 'Token' : '张'
  return `$${Number(pricing.usd).toFixed(4)} / ${unitLabel}`
}

export function isAiModelAdapterReady(model, providerId = '') {
  return !!getAiModelConfig(model, providerId)?.adapterReady
}

export function getPreferredAiModel(providerId, capability = '', enabledModelIds = []) {
  return getRuntimePreferredAiModel(providerId, capability, enabledModelIds, null)
}

export function getRuntimePreferredAiModel(
  providerId,
  capability = '',
  enabledModelIds = [],
  runtimeCatalog = null,
) {
  const models = filterRuntimeAiProviderModels(providerId, capability, enabledModelIds, runtimeCatalog)
  return models.find((model) => model.adapterReady) || models[0] || null
}

export function normalizeAiModelIds(providerId, modelIds = []) {
  return normalizeRuntimeAiModelIds(providerId, modelIds, null)
}

export function normalizeRuntimeAiModelIds(providerId, modelIds = [], runtimeCatalog = null) {
  const normalized = Array.from(
    new Set(
      (Array.isArray(modelIds) ? modelIds : [])
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
  )
  const provider = getRuntimeAiProviderConfig(providerId, runtimeCatalog)
  const valid = new Set(provider.models.map((model) => model.id))
  if (!valid.size) return []
  return normalized.filter((item) => valid.has(item) || valid.has(item.split(':').pop()))
}

function normalizeRuntimeCatalog(runtimeCatalog = null) {
  const catalog = runtimeCatalog && typeof runtimeCatalog === 'object' ? runtimeCatalog : {}
  return {
    providers: Array.isArray(catalog.providers) ? catalog.providers.map(normalizeRuntimeProvider).filter(Boolean) : [],
    models: Array.isArray(catalog.models) ? catalog.models : [],
    publicModels: Array.isArray(catalog.publicModels) ? catalog.publicModels : [],
    featurePublicModels: Array.isArray(catalog.featurePublicModels) ? catalog.featurePublicModels : [],
  }
}

function normalizeRuntimeProvider(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || raw.providerKey || raw.provider || '').trim()
  if (!id) return null
  return {
    ...raw,
    id,
    label: String(raw.label || id),
    baseURL: String(raw.baseURL || raw.baseUrl || ''),
  }
}

function normalizeRuntimeModel(raw, providerId) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || raw.modelId || raw.model || raw.name || '').trim()
  if (!id) return null
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  return {
    ...raw,
    id,
    label: String(raw.label || raw.name || id),
    provider: providerId,
    capabilities,
    adapterReady: raw.adapterReady !== false,
    baseModel: raw.baseModel || id,
    source: raw.source || 'runtime-config',
  }
}

function normalizePricing(value) {
  const pricing = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const directUsd = pricing.usd ?? pricing.costUsd ?? pricing.priceUsd ?? pricing.userPriceUsd
  return {
    unit: String(pricing.unit || pricing.billingUnit || 'image'),
    usd: Number(directUsd || 0),
    note: String(pricing.note || PRICE_UNKNOWN_NOTE),
    display: String(pricing.display || ''),
    ...pricing,
  }
}
