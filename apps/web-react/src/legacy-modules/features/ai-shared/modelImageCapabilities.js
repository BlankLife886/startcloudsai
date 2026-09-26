import { normalizeExactSizeCapabilities } from '../../../config/exactImageSize.js'

export const IMAGE_ASPECT_RATIOS = [
  'auto',
  '16:9',
  '9:16',
  '1:1',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '4:3',
  '3:4',
  '21:9',
  '9:21',
]

export const IMAGE_QUALITIES = ['low', 'medium', 'high']
export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp']
export const IMAGE_MODERATION_LEVELS = ['auto', 'low']
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K']
export const IMAGE_COUNT_DEFAULT_MAX = 4
// 单次生成张数以后台模型配置（服务端下发的 maxImages）为准；这里只镜像服务端
// modelconfig.MaxImagesLimit 作为兜底，不再在前端另设更小的上限。
export const IMAGE_COUNT_HARD_MAX = 100

function normalizeEnumList(value, allowed, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const allowedSet = new Set(allowed)
  return Array.from(
    new Set(
      value
        .map((item) =>
          String(item || '')
            .trim()
            .toLowerCase(),
        )
        .map((item) => (item === 'jpg' ? 'jpeg' : item))
        .filter((item) => allowedSet.has(item)),
    ),
  )
}

export function normalizeImageQuality(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (normalized === 'standard') return 'medium'
  if (normalized === 'hd') return 'high'
  return normalized
}

export function normalizeImageModelCapabilities(model = {}) {
  // 默认参数对 null 不生效；模型未就绪时必须兜底，否则文生图页会白屏崩溃
  const safeModel = model && typeof model === 'object' ? model : {}
  const hasConfiguredAspectRatios = Array.isArray(safeModel.aspectRatios)
  const globalAspectRatios = normalizeEnumList(
    safeModel.aspectRatios,
    IMAGE_ASPECT_RATIOS,
    IMAGE_ASPECT_RATIOS,
  )
  const qualities = normalizeEnumList(safeModel.qualities, IMAGE_QUALITIES, IMAGE_QUALITIES)
  const outputFormats = normalizeEnumList(
    safeModel.outputFormats,
    IMAGE_OUTPUT_FORMATS,
    IMAGE_OUTPUT_FORMATS,
  )
  const moderationLevels = normalizeEnumList(
    safeModel.moderationLevels,
    IMAGE_MODERATION_LEVELS,
    IMAGE_MODERATION_LEVELS,
  )
  const parsedReferenceLimit = Number(safeModel.maxReferenceImages)
  const supportedResolutions = Array.isArray(safeModel.resolutions)
    ? safeModel.resolutions
        .map((resolution) =>
          String(resolution || '')
            .trim()
            .toUpperCase(),
        )
        .filter((resolution) => IMAGE_RESOLUTIONS.includes(resolution))
    : IMAGE_RESOLUTIONS
  const sourceRatiosByResolution =
    safeModel.aspectRatiosByResolution && typeof safeModel.aspectRatiosByResolution === 'object'
      ? safeModel.aspectRatiosByResolution
      : {}
  const sourceAutoRatios =
    safeModel.autoAspectRatios && typeof safeModel.autoAspectRatios === 'object'
      ? safeModel.autoAspectRatios
      : {}
  const hasResolutionRules = Object.keys(sourceRatiosByResolution).length > 0
  const aspectRatiosByResolution = Object.fromEntries(
    supportedResolutions.map((resolution) => {
      const configuredValue =
        sourceRatiosByResolution[resolution] ||
        sourceRatiosByResolution[resolution.toLowerCase()]
      const legacyValue =
        sourceAutoRatios[resolution] || sourceAutoRatios[resolution.toLowerCase()]
      let sourceValue = configuredValue
      if (!hasResolutionRules && legacyValue) {
        sourceValue = [
          ...(globalAspectRatios.includes('auto') ? ['auto'] : []),
          ...(Array.isArray(legacyValue) ? legacyValue : [legacyValue]),
        ]
      }
      const configured = normalizeEnumList(
        Array.isArray(sourceValue) ? sourceValue : sourceValue ? [sourceValue] : globalAspectRatios,
        IMAGE_ASPECT_RATIOS,
        globalAspectRatios,
      )
      return [resolution, configured.length ? configured : [...globalAspectRatios]]
    }),
  )
  const configuredRatioSet = new Set(Object.values(aspectRatiosByResolution).flat())
  const aspectRatios = supportedResolutions.length
    ? IMAGE_ASPECT_RATIOS.filter((ratio) => configuredRatioSet.has(ratio))
    : globalAspectRatios

  return {
    ...normalizeExactSizeCapabilities(safeModel),
    resolutions: supportedResolutions,
    aspectRatios: aspectRatios.length
      ? aspectRatios
      : hasConfiguredAspectRatios
        ? []
        : ['1:1'],
    aspectRatiosByResolution,
    qualities,
    transparentBackground: safeModel.transparentBackground !== false,
    outputFormats,
    moderationLevels,
    maxReferenceImages: Number.isFinite(parsedReferenceLimit)
      ? Math.min(16, Math.max(0, Math.round(parsedReferenceLimit)))
      : 4,
    maxImages: imageModelMaxCount(safeModel),
  }
}

export function imageModelMaxCount(model = {}) {
  const raw = Number(model?.maxImages)
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.min(IMAGE_COUNT_HARD_MAX, Math.max(1, Math.floor(raw)))
  }
  return IMAGE_COUNT_DEFAULT_MAX
}

export function imageCountOptions(model = {}) {
  return Array.from({ length: imageModelMaxCount(model) }, (_, index) => index + 1)
}

// 张数选择器的候选项：上限不超过 8 时逐一列出，更大时按 1/2/4/8… 倍增并补上
// 上限本身，保证选项数量可控；current 为当前值时一并保留，避免选中态丢失。
export function imageCountChoices(model = {}, current) {
  const max = imageModelMaxCount(model)
  const choices = new Set()
  if (max <= 8) {
    for (let count = 1; count <= max; count += 1) choices.add(count)
  } else {
    for (let count = 1; count < max; count *= 2) choices.add(count)
    choices.add(max)
  }
  const selected = Math.round(Number(current))
  if (Number.isFinite(selected) && selected >= 1 && selected <= max) choices.add(selected)
  return [...choices].sort((a, b) => a - b)
}

export function clampImageCount(value, model, fallback = 2) {
  const counts = imageCountOptions(model)
  const count = Math.round(Number(value))
  if (counts.includes(count)) return count
  if (Number.isFinite(count) && counts.length) {
    return Math.min(counts[counts.length - 1], Math.max(counts[0], count))
  }
  if (counts.includes(fallback)) return fallback
  return counts[0] || 1
}

export function getModelAspectRatiosForResolution(model, resolution) {
  const capabilities = normalizeImageModelCapabilities(model)
  const resolutionKey = String(resolution || '')
    .trim()
    .toUpperCase()
  const configured = capabilities.aspectRatiosByResolution[resolutionKey]
  return Array.isArray(configured) && configured.length
    ? configured
    : capabilities.aspectRatios
}

export function getModelAutoAspectRatioCandidates(model, resolution) {
  const capabilities = normalizeImageModelCapabilities(model)
  const configured = getModelAspectRatiosForResolution(model, resolution).filter(
    (ratio) => ratio !== 'auto',
  )
  if (configured.length) return configured
  const fallback = capabilities.aspectRatios.find((ratio) => ratio !== 'auto')
  return fallback ? [fallback] : []
}

export function coerceImageModelSettings(model, settings = {}) {
  const capabilities = normalizeImageModelCapabilities(model)
  const requestedAspectRatio = String(settings.aspectRatio || '')
    .trim()
    .toLowerCase()
  const requestedQuality = normalizeImageQuality(settings.quality)
  const requestedFormat = String(settings.outputFormat || '')
    .trim()
    .toLowerCase()
    .replace(/^jpg$/, 'jpeg')
  const requestedModeration = String(settings.moderationLevel || '')
    .trim()
    .toLowerCase()

  const allowedAspectRatios = getModelAspectRatiosForResolution(
    model,
    settings.resolutionScale || settings.resolution,
  )
  return {
    ...capabilities,
    aspectRatio: allowedAspectRatios.includes(requestedAspectRatio)
      ? requestedAspectRatio
      : allowedAspectRatios[0],
    quality: capabilities.qualities.includes(requestedQuality)
      ? requestedQuality
      : capabilities.qualities[0] || '',
    transparentBackground:
      capabilities.transparentBackground && settings.transparentBackground === true,
    outputFormat: capabilities.outputFormats.includes(requestedFormat)
      ? requestedFormat
      : capabilities.outputFormats[0] || '',
    moderationLevel: capabilities.moderationLevels.includes(requestedModeration)
      ? requestedModeration
      : capabilities.moderationLevels[0] || '',
  }
}
