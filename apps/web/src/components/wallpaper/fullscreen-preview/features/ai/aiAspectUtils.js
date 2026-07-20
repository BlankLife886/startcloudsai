import {
  AI_ASPECT_TOLERANCE,
  AI_OUTPUT_SIZE_PRESETS,
} from '@/components/wallpaper/fullscreen-preview/constants/ai'

// AI 输出尺寸和比例相关的纯函数放在这里，方便请求构造、提示词和验收逻辑复用。
export function toPositiveInt(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.round(num))
}

export function parseResolutionText(text) {
  const raw = String(text || '').trim()
  if (!raw) return { width: 0, height: 0 }
  const match = raw.match(/(\d+)\s*[xX*×]\s*(\d+)/)
  if (!match) return { width: 0, height: 0 }
  return {
    width: toPositiveInt(match[1]),
    height: toPositiveInt(match[2]),
  }
}

export function parseAiOutputSize(value, presets = AI_OUTPUT_SIZE_PRESETS) {
  const raw = String(value || '').trim()
  if (!raw) return { width: 0, height: 0, label: '' }
  const presetList = Array.isArray(presets) ? presets : AI_OUTPUT_SIZE_PRESETS
  const preset = presetList.find((item) => {
    const presetValue = String(item?.value || '').toLowerCase()
    const detail = String(item?.detail || '')
    const label = String(item?.label || '').toLowerCase()
    return (
      raw.toLowerCase() === label ||
      raw.toLowerCase() === presetValue ||
      raw.replace(/\s+/g, '').toLowerCase() === detail.replace(/\s+/g, '').toLowerCase()
    )
  })
  const parsed = parseResolutionText(preset?.value || raw)
  if (!parsed.width || !parsed.height) return { width: 0, height: 0, label: '' }
  return {
    width: parsed.width,
    height: parsed.height,
    label: `${parsed.width}x${parsed.height}`,
  }
}

export function normalizeAiOutputSize(value, presets) {
  const parsed = parseAiOutputSize(value, presets)
  return parsed.label
}

export function gcd(a, b) {
  let x = Math.abs(toPositiveInt(a))
  let y = Math.abs(toPositiveInt(b))
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

export function getReducedAspectLabel(width, height) {
  const w = toPositiveInt(width)
  const h = toPositiveInt(height)
  if (!w || !h) return ''
  const divisor = gcd(w, h)
  return `${Math.round(w / divisor)}:${Math.round(h / divisor)}`
}

export function parseAspectRatioLabel(label) {
  const match = String(label || '')
    .trim()
    .match(/^(\d+)\s*:\s*(\d+)$/)
  if (!match) return null
  const width = toPositiveInt(match[1])
  const height = toPositiveInt(match[2])
  if (!width || !height) return null
  return {
    width,
    height,
    ratio: width / height,
    label: `${width}:${height}`,
  }
}

export function getAspectDiffRatio(width, height, targetWidth, targetHeight) {
  const w = toPositiveInt(width)
  const h = toPositiveInt(height)
  const tw = toPositiveInt(targetWidth)
  const th = toPositiveInt(targetHeight)
  if (!w || !h || !tw || !th) return Number.POSITIVE_INFINITY
  const outputRatio = w / h
  const targetRatio = tw / th
  return Math.abs(outputRatio - targetRatio) / Math.max(targetRatio, 0.0001)
}

export function hasMatchingAspectRatio(width, height, targetWidth, targetHeight) {
  // 供应商返回尺寸可能有轻微偏差；0.2% 内视为同一输出比例。
  return getAspectDiffRatio(width, height, targetWidth, targetHeight) <= AI_ASPECT_TOLERANCE
}
