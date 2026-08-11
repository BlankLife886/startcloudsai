/** 计算两张同尺寸 ImageData 的 RMSE / 最大误差（RGB，忽略 alpha） */
export function computePixelError(original, candidate) {
  if (
    !original ||
    !candidate ||
    original.width !== candidate.width ||
    original.height !== candidate.height
  ) {
    return { rmse: Number.POSITIVE_INFINITY, maxError: Number.POSITIVE_INFINITY }
  }
  const a = original.data
  const b = candidate.data
  let sumSq = 0
  let maxError = 0
  const pixels = original.width * original.height
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const diff = Math.abs(a[i + c] - b[i + c])
      sumSq += diff * diff
      if (diff > maxError) maxError = diff
    }
  }
  return {
    rmse: Math.round(Math.sqrt(sumSq / (pixels * 3)) * 10) / 10,
    maxError: Math.round(maxError * 10) / 10,
  }
}

export function flattenAlphaOnWhite(imageData) {
  const out = new ImageData(imageData.width, imageData.height)
  const src = imageData.data
  const dst = out.data
  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3] / 255
    const inv = 1 - alpha
    dst[i] = Math.round(src[i] * alpha + 255 * inv)
    dst[i + 1] = Math.round(src[i + 1] * alpha + 255 * inv)
    dst[i + 2] = Math.round(src[i + 2] * alpha + 255 * inv)
    dst[i + 3] = 255
  }
  return out
}

/**
 * 在「体积下降」与「误差」之间选甜点：
 * 优先 RMSE≤6 的最小文件；否则用 reduction - 1.8*RMSE 打分。
 * 图标场景可传 targetMaxBytes（如 10KB）优先命中体积预算。
 */
export function pickRecommendedVariant(variants = [], originalBytes = 0, options = {}) {
  const list = (variants || []).filter((item) => item && item.bytes > 0)
  if (!list.length) return null
  const original = Math.max(1, Number(originalBytes) || 0)
  const targetMax = Math.max(0, Number(options.targetMaxBytes) || 0)
  const targetMin = Math.max(0, Number(options.targetMinBytes) || 0)
  const maxRmse = Math.max(1, Number(options.maxRmse) || 6)

  if (targetMax > 0) {
    const underCap = list.filter((item) => item.bytes <= targetMax)
    if (underCap.length) {
      const qualityOk = underCap.filter((item) => item.rmse <= maxRmse)
      const pool = qualityOk.length ? qualityOk : underCap
      const inBand = targetMin > 0 ? pool.filter((item) => item.bytes >= targetMin) : []
      // Prefer in-band (4–10KB); else smallest under the cap with lowest error.
      const ranked = (inBand.length ? inBand : pool).slice().sort((a, b) => {
        if (a.rmse !== b.rmse) return a.rmse - b.rmse
        return a.bytes - b.bytes
      })
      return ranked[0]
    }
    // Nothing under budget — pick the absolute smallest so icons still shrink hard.
    return list.slice().sort((a, b) => a.bytes - b.bytes || a.rmse - b.rmse)[0]
  }

  const underBudget = list.filter((item) => item.bytes < original && item.rmse <= maxRmse)
  if (underBudget.length) {
    return underBudget.sort((a, b) => a.bytes - b.bytes || a.rmse - b.rmse)[0]
  }
  let best = list[0]
  let bestScore = Number.NEGATIVE_INFINITY
  for (const item of list) {
    if (item.bytes >= original) continue
    const reduction = (1 - item.bytes / original) * 100
    const score = reduction - item.rmse * 1.8
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best
}

export function savingsPercent(beforeBytes, afterBytes) {
  const before = Math.max(0, Number(beforeBytes) || 0)
  const after = Math.max(0, Number(afterBytes) || 0)
  if (!before) return 0
  return Math.round(((before - after) / before) * 1000) / 10
}
