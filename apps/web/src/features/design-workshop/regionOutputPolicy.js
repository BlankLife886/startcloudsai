import {
  GPT_IMAGE_OUTPUT_LIMITS,
  normalizeGptImageOutputSize,
} from '../../services/aiImageOutputSize.js'

export const REGION_RECOGNITION_OPTIONS = Object.freeze([
  { id: 'text', label: '文字', nodeTypes: ['text', 'button', 'input'] },
  { id: 'icon', label: '图标', nodeTypes: ['icon'] },
  { id: 'image', label: '大图', nodeTypes: ['image'] },
])

export const REGION_EDIT_ACTIONS = Object.freeze([
  { id: 'remove', label: '移除元素', icon: 'bi-eraser' },
  { id: 'improve-icon', label: '美化图标', icon: 'bi-stars' },
  { id: 'replace-background', label: '更换背景', icon: 'bi-image' },
  { id: 'custom', label: '自定义', icon: 'bi-sliders2' },
])

export const REGION_OUTPUT_RATIOS = Object.freeze([
  { id: '1:1', value: 1 },
  { id: '5:4', value: 5 / 4 },
  { id: '4:3', value: 4 / 3 },
  { id: '3:2', value: 3 / 2 },
  { id: '16:9', value: 16 / 9 },
  { id: '4:5', value: 4 / 5 },
  { id: '3:4', value: 3 / 4 },
  { id: '2:3', value: 2 / 3 },
  { id: '9:16', value: 9 / 16 },
])

export function normalizeRegionRecognitionTypes(types = []) {
  const allowed = new Set(REGION_RECOGNITION_OPTIONS.map((option) => option.id))
  return [...new Set((Array.isArray(types) ? types : []).map(String))].filter((type) =>
    allowed.has(type),
  )
}

export function regionNodeMatchesRecognitionTypes(node, types = []) {
  const selected = normalizeRegionRecognitionTypes(types)
  if (!selected.length) return false
  const nodeType = String(node?.type || '').trim().toLowerCase()
  return REGION_RECOGNITION_OPTIONS.some(
    (option) => selected.includes(option.id) && option.nodeTypes.includes(nodeType),
  )
}

export function nearestRegionOutputRatio(width, height, allowedRatios = []) {
  const ratio = Math.max(1, Number(width) || 1) / Math.max(1, Number(height) || 1)
  const allowed = new Set((Array.isArray(allowedRatios) ? allowedRatios : []).map(String))
  const candidates = allowed.size
    ? REGION_OUTPUT_RATIOS.filter((candidate) => allowed.has(candidate.id))
    : REGION_OUTPUT_RATIOS
  return (candidates.length ? candidates : REGION_OUTPUT_RATIOS).reduce((best, candidate) => {
    const distance = Math.abs(Math.log(ratio / candidate.value))
    return !best || distance < best.distance ? { ...candidate, distance } : best
  }, null)?.id || '1:1'
}

export function resolveRegionImageRequestSize(value = 'auto', resolution = '1K') {
  const requested = String(value || '')
    .trim()
    .toLowerCase()
  if (!requested || requested === 'auto') return 'auto'

  const explicit = requested.match(/^(\d{3,4})x(\d{3,4})$/)
  if (explicit) {
    const width = Number(explicit[1])
    const height = Number(explicit[2])
    if (width >= 256 && width <= 4096 && height >= 256 && height <= 4096) {
      return `${width}x${height}`
    }
    return 'auto'
  }

  const ratio = requested.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!ratio) return 'auto'
  const ratioWidth = Number(ratio[1])
  const ratioHeight = Number(ratio[2])
  if (!ratioWidth || !ratioHeight) return 'auto'

  const longEdge =
    {
      '1K': 1024,
      '2K': 2048,
      '4K': 3840,
    }[String(resolution || '1K').trim().toUpperCase()] || 1024
  if (Number.isInteger(ratioWidth) && Number.isInteger(ratioHeight)) {
    let best = null
    const maxScale = Math.floor(
      GPT_IMAGE_OUTPUT_LIMITS.maxEdge / Math.max(ratioWidth, ratioHeight),
    )
    for (let scale = 1; scale <= maxScale; scale += 1) {
      const width = ratioWidth * scale
      const height = ratioHeight * scale
      const pixels = width * height
      if (width % GPT_IMAGE_OUTPUT_LIMITS.step || height % GPT_IMAGE_OUTPUT_LIMITS.step) continue
      if (
        pixels < GPT_IMAGE_OUTPUT_LIMITS.minPixels ||
        pixels > GPT_IMAGE_OUTPUT_LIMITS.maxPixels
      ) {
        continue
      }
      const distance = Math.abs(Math.max(width, height) - longEdge)
      if (!best || distance < best.distance) best = { width, height, distance }
    }
    if (best) return `${best.width}x${best.height}`
  }
  const requestedWidth =
    ratioWidth >= ratioHeight ? longEdge : (longEdge * ratioWidth) / ratioHeight
  const requestedHeight =
    ratioHeight >= ratioWidth ? longEdge : (longEdge * ratioHeight) / ratioWidth
  const normalized = normalizeGptImageOutputSize(requestedWidth, requestedHeight)
  return `${normalized.width}x${normalized.height}`
}

export function resolveRegionSelectionRequestSize(width, height) {
  let targetWidth = Math.max(1, Math.round(Number(width) || 1))
  let targetHeight = Math.max(1, Math.round(Number(height) || 1))
  const minEdge = 256
  const maxEdge = 4096
  const downscale = Math.min(1, maxEdge / Math.max(targetWidth, targetHeight))
  targetWidth *= downscale
  targetHeight *= downscale

  const upscale = minEdge / Math.min(targetWidth, targetHeight)
  if (upscale > 1) {
    if (Math.max(targetWidth, targetHeight) * upscale <= maxEdge) {
      targetWidth *= upscale
      targetHeight *= upscale
    } else if (targetWidth >= targetHeight) {
      targetWidth = maxEdge
      targetHeight = minEdge
    } else {
      targetWidth = minEdge
      targetHeight = maxEdge
    }
  }

  return `${Math.max(minEdge, Math.min(maxEdge, Math.round(targetWidth)))}x${Math.max(
    minEdge,
    Math.min(maxEdge, Math.round(targetHeight)),
  )}`
}
