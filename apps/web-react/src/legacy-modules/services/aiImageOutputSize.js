export const GPT_IMAGE_OUTPUT_LIMITS = Object.freeze({
  step: 16,
  maxEdge: 3840,
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxAspectRatio: 3,
})

function toPositiveInteger(value) {
  const normalized = Math.round(Number(value) || 0)
  return normalized > 0 ? normalized : 1
}

function isValidCandidate(width, height) {
  const { step, maxEdge, minPixels, maxPixels, maxAspectRatio } = GPT_IMAGE_OUTPUT_LIMITS
  const pixels = width * height
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  return (
    width % step === 0 &&
    height % step === 0 &&
    longEdge <= maxEdge &&
    longEdge / shortEdge <= maxAspectRatio &&
    pixels >= minPixels &&
    pixels <= maxPixels
  )
}

/**
 * 将任意目标尺寸收敛为 GPT Image 2 支持的自定义尺寸，同时尽量保留长边和宽高比。
 */
export function normalizeGptImageOutputSize(width, height) {
  const requestedWidth = toPositiveInteger(width)
  const requestedHeight = toPositiveInteger(height)
  const landscape = requestedWidth >= requestedHeight
  const requestedLongEdge = Math.max(requestedWidth, requestedHeight)
  const requestedShortEdge = Math.min(requestedWidth, requestedHeight)
  const { step, maxEdge, maxAspectRatio } = GPT_IMAGE_OUTPUT_LIMITS
  const targetRatio = Math.max(1 / maxAspectRatio, requestedShortEdge / requestedLongEdge)
  let best = null

  for (let longEdge = step; longEdge <= maxEdge; longEdge += step) {
    const shortEdge = Math.max(step, Math.round((longEdge * targetRatio) / step) * step)
    const candidateWidth = landscape ? longEdge : shortEdge
    const candidateHeight = landscape ? shortEdge : longEdge
    if (!isValidCandidate(candidateWidth, candidateHeight)) continue

    const sizeDistance = Math.abs(longEdge - requestedLongEdge)
    const ratioDistance = Math.abs(shortEdge / longEdge - targetRatio)
    const score = sizeDistance * 1_000 + ratioDistance
    if (!best || score < best.score) {
      best = { width: candidateWidth, height: candidateHeight, score }
    }
  }

  if (!best) {
    // 理论上约束区间内始终有合法候选；兜底使用 1024 方图，避免发送非法参数。
    best = { width: 1024, height: 1024, score: 0 }
  }

  return {
    width: best.width,
    height: best.height,
    adjusted: best.width !== requestedWidth || best.height !== requestedHeight,
  }
}
