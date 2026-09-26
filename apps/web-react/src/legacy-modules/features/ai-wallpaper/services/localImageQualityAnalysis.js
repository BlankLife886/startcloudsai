const ANALYSIS_MAX_EDGE = 192

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

function imageDimensions(image) {
  return {
    width: Number(image?.naturalWidth || image?.width || 0),
    height: Number(image?.naturalHeight || image?.height || 0),
  }
}

export function analyzeLocalImageQuality(image) {
  const source = imageDimensions(image)
  if (!source.width || !source.height || typeof document === 'undefined') {
    return {
      profile: 'balanced',
      label: '自然细节',
      sharpness: 0.5,
      noise: 0.2,
      contrast: 0.5,
      hasTransparency: false,
      transparentRatio: 0,
      partialAlphaRatio: 0,
    }
  }

  const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(source.width, source.height))
  const width = Math.max(24, Math.round(source.width * scale))
  const height = Math.max(24, Math.round(source.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!context) {
    return {
      profile: 'balanced',
      label: '自然细节',
      sharpness: 0.5,
      noise: 0.2,
      contrast: 0.5,
      hasTransparency: false,
      transparentRatio: 0,
      partialAlphaRatio: 0,
    }
  }
  context.drawImage(image, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const luminance = new Float32Array(width * height)
  let sum = 0
  let sumSquares = 0
  let transparentSamples = 0
  let partialAlphaSamples = 0
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    const alpha = pixels[index + 3]
    if (alpha <= 8) transparentSamples += 1
    else if (alpha < 247) partialAlphaSamples += 1
    const value = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722
    luminance[pixel] = value
    sum += value
    sumSquares += value * value
  }

  let laplacianSum = 0
  let flatNoiseSum = 0
  let flatSamples = 0
  let samples = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const offset = y * width + x
      const center = luminance[offset]
      const left = luminance[offset - 1]
      const right = luminance[offset + 1]
      const top = luminance[offset - width]
      const bottom = luminance[offset + width]
      const horizontal = Math.abs(right - left)
      const vertical = Math.abs(bottom - top)
      const gradient = (horizontal + vertical) * 0.5
      laplacianSum += Math.abs(center * 4 - left - right - top - bottom)
      if (gradient < 10) {
        flatNoiseSum += Math.abs(center - left) + Math.abs(center - top)
        flatSamples += 2
      }
      samples += 1
    }
  }

  const pixelCount = Math.max(1, width * height)
  const mean = sum / pixelCount
  const deviation = Math.sqrt(Math.max(0, sumSquares / pixelCount - mean * mean))
  const laplacian = laplacianSum / Math.max(1, samples)
  const flatNoise = flatNoiseSum / Math.max(1, flatSamples)
  const sharpness = clamp((laplacian - 1.5) / 13)
  const noise = clamp((flatNoise - 0.7) / 6)
  const contrast = clamp((deviation - 18) / 58)
  const transparentRatio = transparentSamples / pixelCount
  const partialAlphaRatio = partialAlphaSamples / pixelCount
  const hasTransparency = transparentRatio >= 0.005

  canvas.width = 1
  canvas.height = 1

  if (hasTransparency) {
    return {
      profile: 'transparent-graphic',
      label: '透明图形边缘优化',
      sharpness,
      noise,
      contrast,
      hasTransparency,
      transparentRatio,
      partialAlphaRatio,
    }
  }

  if (noise > 0.48) {
    return { profile: 'noise-protected', label: '噪点保护', sharpness, noise, contrast, hasTransparency, transparentRatio, partialAlphaRatio }
  }
  if (sharpness < 0.38) {
    return { profile: 'soft-detail', label: '柔图细节强化', sharpness, noise, contrast, hasTransparency, transparentRatio, partialAlphaRatio }
  }
  if (contrast < 0.28) {
    return { profile: 'low-contrast', label: '低对比纹理强化', sharpness, noise, contrast, hasTransparency, transparentRatio, partialAlphaRatio }
  }
  return { profile: 'balanced', label: '自然纹理增强', sharpness, noise, contrast, hasTransparency, transparentRatio, partialAlphaRatio }
}

export function resolveAdaptiveSharpening(resolutionScale = '2K', analysis = {}) {
  if (analysis.profile === 'transparent-graphic' || analysis.hasTransparency) {
    // Photo-style unsharp masking creates ringing and staircase artifacts on
    // hard Alpha contours. Transparent graphics use a coverage-aware edge pass
    // before resizing, so the resampler should not sharpen the mask again.
    return {
      unsharpAmount: 0,
      unsharpRadius: 0.5,
      unsharpThreshold: 0,
    }
  }
  const presets = {
    '1K': { amount: 110, radius: 0.55 },
    '2K': { amount: 140, radius: 0.65 },
    '4K': { amount: 175, radius: 0.8 },
    '8K': { amount: 200, radius: 0.9 },
  }
  const preset = presets[resolutionScale] || presets['2K']
  const softness = 1 - clamp(analysis.sharpness, 0, 1)
  const noise = clamp(analysis.noise, 0, 1)
  const lowContrast = 1 - clamp(analysis.contrast, 0, 1)
  const amountMultiplier = 1 + softness * 0.16 + lowContrast * 0.06 - noise * 0.28
  const radiusMultiplier = 1 + softness * 0.08 - noise * 0.12
  return {
    unsharpAmount: Math.round(clamp(preset.amount * amountMultiplier, 80, 220)),
    unsharpRadius: Number(clamp(preset.radius * radiusMultiplier, 0.5, 1.15).toFixed(2)),
    unsharpThreshold: Math.max(1, Math.round(1 + noise * 6)),
  }
}
