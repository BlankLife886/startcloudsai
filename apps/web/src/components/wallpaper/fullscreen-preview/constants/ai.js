// 用户端只保留空兜底；实际 AI 图像处理配置由后台 runtime config 下发。
export const AI_OUTPUT_SIZE_PRESETS = []

export const DEFAULT_AI_OUTPUT_SIZE = ''

export const DEFAULT_AI_IMAGE_PROCESSING_CONFIG = {
  panelTitle: '',
  panelKicker: '',
  defaultOutputSize: DEFAULT_AI_OUTPUT_SIZE,
  outputSizePresets: AI_OUTPUT_SIZE_PRESETS,
  allowManualOutputSize: false,
  manualSizePlaceholder: DEFAULT_AI_OUTPUT_SIZE,
  promptPlaceholder: '',
  promptTemplate: '',
  defaultPromptGoal: '',
  qualityPromptTemplate: '',
  qualityModeInstructions: {
    fast: '',
    balanced: '',
    quality: '',
  },
}

// 尺寸校验先判断比例是否匹配；0.2% 内视为同一输出比例。
export const AI_ASPECT_TOLERANCE = 0.002

export function normalizeAiImageProcessingConfig(value = {}) {
  const config = isPlainObject(value) ? value : {}
  const fallback = DEFAULT_AI_IMAGE_PROCESSING_CONFIG
  return {
    panelTitle: readConfiguredString(config, 'panelTitle', fallback.panelTitle),
    panelKicker: readConfiguredString(config, 'panelKicker', fallback.panelKicker),
    defaultOutputSize: readConfiguredSize(config, 'defaultOutputSize', fallback.defaultOutputSize),
    outputSizePresets: hasOwn(config, 'outputSizePresets')
      ? normalizeOutputSizePresets(config.outputSizePresets)
      : fallback.outputSizePresets,
    allowManualOutputSize: hasOwn(config, 'allowManualOutputSize')
      ? config.allowManualOutputSize !== false
      : fallback.allowManualOutputSize,
    manualSizePlaceholder: readConfiguredString(
      config,
      'manualSizePlaceholder',
      fallback.manualSizePlaceholder,
    ),
    promptPlaceholder: readConfiguredString(config, 'promptPlaceholder', fallback.promptPlaceholder),
    promptTemplate: readConfiguredString(config, 'promptTemplate', fallback.promptTemplate),
    defaultPromptGoal: readConfiguredString(config, 'defaultPromptGoal', fallback.defaultPromptGoal),
    qualityPromptTemplate: readConfiguredString(
      config,
      'qualityPromptTemplate',
      fallback.qualityPromptTemplate,
    ),
    qualityModeInstructions: normalizeQualityModeInstructions(
      config.qualityModeInstructions,
      fallback.qualityModeInstructions,
    ),
  }
}

function normalizeQualityModeInstructions(value, fallback = {}) {
  const config = isPlainObject(value) ? value : {}
  return {
    fast: readConfiguredString(config, 'fast', fallback.fast || ''),
    balanced: readConfiguredString(config, 'balanced', fallback.balanced || ''),
    quality: readConfiguredString(config, 'quality', fallback.quality || ''),
  }
}

function normalizeOutputSizePresets(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!isPlainObject(item)) return null
      const size = normalizeSizeText(item.value)
      if (!size) return null
      return {
        value: size,
        label: String(item.label ?? size).trim() || size,
        detail: String(item.detail ?? formatSizeDetail(size)).trim() || formatSizeDetail(size),
      }
    })
    .filter(Boolean)
}

function readConfiguredString(config, key, fallback) {
  return hasOwn(config, key) ? String(config[key] ?? '') : fallback
}

function readConfiguredSize(config, key, fallback) {
  return hasOwn(config, key) ? normalizeSizeText(config[key]) : fallback
}

function normalizeSizeText(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const match = raw.match(/(\d+)\s*[xX*×]\s*(\d+)/)
  if (!match) return raw
  return `${Math.max(1, Math.round(Number(match[1]) || 0))}x${Math.max(
    1,
    Math.round(Number(match[2]) || 0),
  )}`
}

function formatSizeDetail(value) {
  const match = String(value || '').match(/^(\d+)x(\d+)$/)
  return match ? `${match[1]} x ${match[2]}` : value
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}
