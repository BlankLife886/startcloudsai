export const COLOR_GRADE_DEFAULTS = {
  temperature: 0,
  tint: 0,
  fade: 0,
  shadowCool: 0,
  highlightWarm: 0,
  vignette: 0,
  lutStyle: 'none',
  lutIntensity: 0,
  curveStrength: 0,
  grain: 0,
  skinProtect: 70,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  blackPoint: 0,
  vibrance: 0,
  clarity: 0,
  skinSmooth: 0,
  skinWarmth: 0,
  cameraProfile: 'none',
  profileIntensity: 0,
}

const COLOR_GRADE_KEYS = Object.keys(COLOR_GRADE_DEFAULTS)

function clamp(value, min, max, fallback = 0) {
  const next = Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}

function channel(value) {
  return clamp(Math.round(value), 0, 255)
}

function gradeValue(filterParams, key) {
  return clamp(filterParams?.[key], -100, 100, COLOR_GRADE_DEFAULTS[key] || 0)
}

function normalizedLookStyle(filterParams) {
  return String(filterParams?.lutStyle || 'none')
}

function normalizedCameraProfile(filterParams) {
  return String(filterParams?.cameraProfile || 'none')
}

export function hasColorGradeAdjustment(filterParams) {
  const lutStyle = normalizedLookStyle(filterParams)
  const lutIntensity = Number(filterParams?.lutIntensity || 0)
  const cameraProfile = normalizedCameraProfile(filterParams)
  const profileIntensity = Number(filterParams?.profileIntensity || 0)

  return COLOR_GRADE_KEYS.some((key) => {
    if (key === 'skinProtect') return false
    if (key === 'lutStyle' || key === 'lutIntensity') {
      return lutStyle !== 'none' && lutIntensity !== 0
    }
    if (key === 'cameraProfile' || key === 'profileIntensity') {
      return cameraProfile !== 'none' && profileIntensity !== 0
    }
    return Number(filterParams?.[key] || 0) !== 0
  })
}

function mixChannel(base, target, amount) {
  return base * (1 - amount) + target * amount
}

function contrastChannel(value, amount) {
  return (value - 128) * amount + 128
}

function applyCurve(value, strength) {
  if (strength === 0) return value
  const normalized = clamp(value / 255, 0, 1)
  const amount = Math.abs(strength) / 100
  const curved =
    strength > 0
      ? normalized < 0.5
        ? 2 * normalized * normalized
        : 1 - 2 * (1 - normalized) * (1 - normalized)
      : normalized ** (1 - amount * 0.55)
  return mixChannel(value, curved * 255, amount)
}

function pixelNoise(pixelIndex) {
  const x = Math.sin(pixelIndex * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function saturationMask(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max <= 0) return 0
  return (max - min) / max
}

function applyVibrance(r, g, b, amount) {
  if (amount === 0) return { r, g, b }
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const sat = saturationMask(r, g, b)
  const strength = (amount / 100) * (1 - sat * 0.72)
  return {
    r: gray + (r - gray) * (1 + strength),
    g: gray + (g - gray) * (1 + strength),
    b: gray + (b - gray) * (1 + strength),
  }
}

function skinMask(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const isLikelySkin =
    r > 48 &&
    g > 30 &&
    b > 18 &&
    r > g * 0.94 &&
    r < g * 1.48 &&
    r > b * 1.08 &&
    g > b * 0.82 &&
    chroma > 10
  if (!isLikelySkin) return 0
  const warmth = clamp((r - b) / 95, 0, 1)
  const balance = 1 - clamp(Math.abs(r - g * 1.28) / 90, 0, 1)
  return clamp(0.35 + warmth * 0.4 + balance * 0.25, 0, 1)
}

function applyCameraProfile(profile, r, g, b, luma, shadow, highlight) {
  let tr = r
  let tg = g
  let tb = b

  if (profile === 'canon_portrait') {
    tr = contrastChannel(r, 0.99) + highlight * 3 + 2
    tg = contrastChannel(g, 1.0) + 1
    tb = contrastChannel(b, 0.97) - highlight * 3
  } else if (profile === 'nikon_landscape') {
    tr = contrastChannel(r, 1.03) + highlight * 2
    tg = contrastChannel(g, 1.06) + 4
    tb = contrastChannel(b, 1.06) + highlight * 5
  } else if (profile === 'sony_clean') {
    tr = contrastChannel(r, 1.02)
    tg = contrastChannel(g, 1.03) + highlight * 1
    tb = contrastChannel(b, 1.04) + highlight * 3
  } else if (profile === 'leica_classic') {
    tr = contrastChannel(r, 1.05) + highlight * 3
    tg = contrastChannel(g, 1.01)
    tb = contrastChannel(b, 0.99) - shadow * 2
  } else if (profile === 'hasselblad_natural') {
    tr = contrastChannel(r, 0.99) + highlight * 1
    tg = contrastChannel(g, 1.0) + 1
    tb = contrastChannel(b, 1.01) + shadow * 1
  } else if (profile === 'ricoh_gr') {
    tr = contrastChannel(r, 1.05) - shadow * 2
    tg = contrastChannel(g, 1.03) + shadow * 2
    tb = contrastChannel(b, 1.04) + highlight * 1
  } else if (profile === 'iphone_vivid') {
    tr = contrastChannel(r, 1.03) + highlight * 2
    tg = contrastChannel(g, 1.04) + highlight * 2
    tb = contrastChannel(b, 1.05) + highlight * 3
  }

  return { r: tr, g: tg, b: tb }
}

function stabilizeSkinTone(r, g, b, baseR, baseG, baseB, amount) {
  if (amount <= 0) return { r, g, b }
  const targetWarmth = baseR - baseB
  const currentWarmth = r - b
  const warmthDelta = (targetWarmth - currentWarmth) * amount * 0.36
  const targetGreenBalance = baseG - (baseR + baseB) * 0.39
  const currentGreenBalance = g - (r + b) * 0.39
  const greenDelta = (targetGreenBalance - currentGreenBalance) * amount * 0.28
  const baseLuma = 0.2126 * baseR + 0.7152 * baseG + 0.0722 * baseB
  const anchorR = mixChannel(baseR, baseLuma + 18, 0.42)
  const anchorG = mixChannel(baseG, baseLuma + 4, 0.34)
  const anchorB = mixChannel(baseB, baseLuma - 12, 0.38)

  return {
    r: mixChannel(r + warmthDelta * 0.5, anchorR, amount * 0.2),
    g: mixChannel(g + greenDelta, anchorG, amount * 0.22),
    b: mixChannel(b - warmthDelta * 0.5, anchorB, amount * 0.26),
  }
}

function applyLookStyle(style, r, g, b, luma, shadow, highlight) {
  let tr = r
  let tg = g
  let tb = b

  if (style === 'clean') {
    tr = contrastChannel(r, 1.04) + highlight * 2
    tg = contrastChannel(g, 1.04) + highlight * 2
    tb = contrastChannel(b, 1.04) + highlight * 3
  } else if (style === 'film_gold') {
    tr += 11 * highlight + 6
    tg += 5 * highlight + 2
    tb -= 10 * highlight + 3
    tr = contrastChannel(tr, 0.97)
    tg = contrastChannel(tg, 0.97)
    tb = contrastChannel(tb, 0.97)
  } else if (style === 'kodak_portra') {
    tr = contrastChannel(r, 0.98) + 4 * highlight + 2
    tg = contrastChannel(g, 0.97) + 2 * highlight + 1
    tb = contrastChannel(b, 0.96) - 3 * highlight + shadow * 3
  } else if (style === 'fuji_classic') {
    tr = contrastChannel(r, 0.96) - shadow * 2
    tg = contrastChannel(g, 1.02) + 5
    tb = contrastChannel(b, 0.98) + shadow * 5
  } else if (style === 'fuji_vivid') {
    tr = contrastChannel(r, 1.08) + highlight * 5
    tg = contrastChannel(g, 1.12) + 7
    tb = contrastChannel(b, 1.08) + highlight * 3
  } else if (style === 'film_matte') {
    tr = contrastChannel(r, 0.9) + shadow * 16 + highlight * 3
    tg = contrastChannel(g, 0.9) + shadow * 14 + highlight * 2
    tb = contrastChannel(b, 0.9) + shadow * 12
  } else if (style === 'cinestill') {
    tr = contrastChannel(r, 1.08) + highlight * 14 + shadow * 3
    tg = contrastChannel(g, 1.02) - shadow * 3
    tb = contrastChannel(b, 1.1) + shadow * 14 - highlight * 4
  } else if (style === 'cinema') {
    tr = contrastChannel(r, 1.1) + highlight * 8 - shadow * 4
    tg = contrastChannel(g, 1.06) + shadow * 3
    tb = contrastChannel(b, 1.08) + shadow * 12 - highlight * 5
  } else if (style === 'blockbuster') {
    tr = contrastChannel(r, 1.12) + highlight * 12
    tg = contrastChannel(g, 1.04) + shadow * 4
    tb = contrastChannel(b, 1.1) + shadow * 18 - highlight * 8
  } else if (style === 'noir') {
    const mono = luma * 255
    tr = mono * 0.96
    tg = mono * 0.98
    tb = mono * 1.04
    tr = contrastChannel(tr, 1.18)
    tg = contrastChannel(tg, 1.18)
    tb = contrastChannel(tb, 1.18)
  } else if (style === 'dream') {
    tr = contrastChannel(r, 0.9) + highlight * 10 + 5
    tg = contrastChannel(g, 0.9) + highlight * 8 + 4
    tb = contrastChannel(b, 0.94) + shadow * 8 + 8
  } else if (style === 'korean_cream') {
    tr = contrastChannel(r, 0.9) + highlight * 6 + 8
    tg = contrastChannel(g, 0.9) + highlight * 5 + 6
    tb = contrastChannel(b, 0.92) + highlight * 4 + 4
  } else if (style === 'japan_clear') {
    tr = contrastChannel(r, 0.96) + highlight * 2
    tg = contrastChannel(g, 0.98) + highlight * 5 + 3
    tb = contrastChannel(b, 1.02) + highlight * 9 + shadow * 3
  } else if (style === 'sakura') {
    tr = contrastChannel(r, 0.92) + highlight * 12 + 8
    tg = contrastChannel(g, 0.9) + highlight * 5 + 3
    tb = contrastChannel(b, 0.96) + highlight * 8 + 6
  } else if (style === 'xiaohongshu_oat') {
    tr = contrastChannel(r, 0.9) + shadow * 8 + highlight * 10 + 7
    tg = contrastChannel(g, 0.9) + shadow * 7 + highlight * 8 + 5
    tb = contrastChannel(b, 0.88) + shadow * 5 + highlight * 4
  } else if (style === 'nature') {
    tr = contrastChannel(r, 1.04) - shadow * 2
    tg = contrastChannel(g, 1.08) + 7
    tb = contrastChannel(b, 1.03) + highlight * 3
  } else if (style === 'desert_warm') {
    tr = contrastChannel(r, 1.04) + highlight * 10 + 8
    tg = contrastChannel(g, 1.0) + highlight * 5 + 3
    tb = contrastChannel(b, 0.94) - highlight * 8 - shadow * 2
  } else if (style === 'arctic_clean') {
    tr = contrastChannel(r, 0.98) - shadow * 2
    tg = contrastChannel(g, 1.0) + highlight * 3
    tb = contrastChannel(b, 1.08) + highlight * 10 + shadow * 5
  } else if (style === 'night') {
    tr = contrastChannel(r, 1.08) - shadow * 8 + highlight * 5
    tg = contrastChannel(g, 1.06) + shadow * 3
    tb = contrastChannel(b, 1.12) + shadow * 16
  } else if (style === 'neon') {
    tr = contrastChannel(r, 1.12) + highlight * 8 + shadow * 5
    tg = contrastChannel(g, 1.08) - shadow * 2
    tb = contrastChannel(b, 1.14) + shadow * 14 + highlight * 5
  } else if (style === 'hongkong_neon') {
    tr = contrastChannel(r, 1.12) + highlight * 12 + shadow * 8
    tg = contrastChannel(g, 1.02) + highlight * 2
    tb = contrastChannel(b, 1.1) + shadow * 12
  } else if (style === 'urban_steel') {
    tr = contrastChannel(r, 1.02) - shadow * 5
    tg = contrastChannel(g, 1.04) + shadow * 3
    tb = contrastChannel(b, 1.1) + shadow * 14 + highlight * 2
  } else if (style === 'cyber') {
    tr = contrastChannel(r, 1.14) + highlight * 5 - shadow * 5
    tg = contrastChannel(g, 1.08) + shadow * 8
    tb = contrastChannel(b, 1.18) + shadow * 18 + highlight * 6
  } else if (style === 'hologram') {
    tr = contrastChannel(r, 1.0) + highlight * 6
    tg = contrastChannel(g, 1.08) + highlight * 10 + shadow * 4
    tb = contrastChannel(b, 1.12) + highlight * 12 + shadow * 10
  }

  return { r: tr, g: tg, b: tb }
}

export function applyColorGradeToCanvas(ctx, width, height, filterParams) {
  if (!ctx || !width || !height || !hasColorGradeAdjustment(filterParams)) return

  const temperature = gradeValue(filterParams, 'temperature')
  const tint = gradeValue(filterParams, 'tint')
  const fade = clamp(filterParams?.fade, 0, 100, 0)
  const shadowCool = clamp(filterParams?.shadowCool, 0, 100, 0)
  const highlightWarm = clamp(filterParams?.highlightWarm, 0, 100, 0)
  const vignette = clamp(filterParams?.vignette, 0, 100, 0)
  const lutStyle = normalizedLookStyle(filterParams)
  const lutIntensity = clamp(filterParams?.lutIntensity, 0, 100, 0) / 100
  const curveStrength = gradeValue(filterParams, 'curveStrength')
  const grain = clamp(filterParams?.grain, 0, 100, 0)
  const skinProtect = clamp(filterParams?.skinProtect, 0, 100, COLOR_GRADE_DEFAULTS.skinProtect)
  const exposure = gradeValue(filterParams, 'exposure')
  const highlights = gradeValue(filterParams, 'highlights')
  const shadows = gradeValue(filterParams, 'shadows')
  const blackPoint = gradeValue(filterParams, 'blackPoint')
  const vibrance = gradeValue(filterParams, 'vibrance')
  const clarity = gradeValue(filterParams, 'clarity')
  const skinSmooth = clamp(filterParams?.skinSmooth, 0, 100, 0)
  const skinWarmth = gradeValue(filterParams, 'skinWarmth')
  const cameraProfile = normalizedCameraProfile(filterParams)
  const profileIntensity = clamp(filterParams?.profileIntensity, 0, 100, 0) / 100

  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  const fadeMix = fade / 100

  for (let i = 0; i < data.length; i += 4) {
    const baseR = data[i]
    const baseG = data[i + 1]
    const baseB = data[i + 2]
    let r = baseR
    let g = baseG
    let b = baseB
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    const shadow = (1 - luma) ** 1.7
    const highlight = luma ** 1.65
    const midProtect = 1 - Math.abs(luma - 0.56) * 1.35
    const skin = skinMask(baseR, baseG, baseB)
    const skinBlend = skin * (skinProtect / 100)

    if (exposure !== 0) {
      const gain = 2 ** (exposure / 100)
      r *= gain
      g *= gain
      b *= gain
    }

    if (highlights !== 0) {
      const delta = highlights * highlight * 0.42
      r += delta
      g += delta
      b += delta
    }

    if (shadows !== 0) {
      const delta = shadows * shadow * 0.44
      r += delta
      g += delta
      b += delta
    }

    if (blackPoint !== 0) {
      const lift = blackPoint * shadow * 0.42
      r -= lift
      g -= lift
      b -= lift
    }

    if (cameraProfile !== 'none' && profileIntensity > 0) {
      const profile = applyCameraProfile(cameraProfile, r, g, b, luma, shadow, highlight)
      r = mixChannel(r, profile.r, profileIntensity)
      g = mixChannel(g, profile.g, profileIntensity)
      b = mixChannel(b, profile.b, profileIntensity)
    }

    if (lutStyle !== 'none' && lutIntensity > 0) {
      const look = applyLookStyle(lutStyle, r, g, b, luma, shadow, highlight)
      r = mixChannel(r, look.r, lutIntensity)
      g = mixChannel(g, look.g, lutIntensity)
      b = mixChannel(b, look.b, lutIntensity)
    }

    r += temperature * 0.16
    g += temperature * 0.035
    b -= temperature * 0.16

    r += tint * 0.09
    g -= tint * 0.13
    b += tint * 0.08

    r -= shadowCool * shadow * 0.18
    g += shadowCool * shadow * 0.08
    b += shadowCool * shadow * 0.32

    r += highlightWarm * highlight * 0.26
    g += highlightWarm * highlight * 0.11
    b -= highlightWarm * highlight * 0.2

    if (fadeMix > 0) {
      const lift = 18 * fadeMix
      const contrast = 1 - 0.22 * fadeMix
      r = (r - 128) * contrast + 128 + lift * shadow
      g = (g - 128) * contrast + 128 + lift * shadow
      b = (b - 128) * contrast + 128 + lift * shadow
    }

    if (curveStrength !== 0) {
      r = applyCurve(r, curveStrength)
      g = applyCurve(g, curveStrength)
      b = applyCurve(b, curveStrength)
    }

    if (vibrance !== 0) {
      const vibrant = applyVibrance(r, g, b, vibrance)
      r = vibrant.r
      g = vibrant.g
      b = vibrant.b
    }

    if (clarity !== 0) {
      const clarityAmount = clarity / 100
      const localContrast = (luma - 0.5) * 2
      const delta = localContrast * Math.abs(localContrast) * clarityAmount * 18
      r += delta
      g += delta
      b += delta
    }

    if (grain > 0) {
      const n = (pixelNoise(i / 4) - 0.5) * grain * 0.55
      const grainWeight = 0.35 + shadow * 0.65
      r += n * grainWeight
      g += n * grainWeight
      b += n * grainWeight
    }

    if (midProtect > 0) {
      const protect = Math.min(0.42, midProtect * 0.18)
      r = baseR * protect + r * (1 - protect)
      g = baseG * protect + g * (1 - protect)
      b = baseB * protect + b * (1 - protect)
    }

    if (skinBlend > 0) {
      if (skinWarmth !== 0) {
        const warmth = skinWarmth * skin * 0.24
        r += warmth
        g += warmth * 0.08
        b -= warmth
      }
      if (skinSmooth > 0) {
        const smoothAmount = skin * (skinSmooth / 100) * 0.42
        const skinLuma = 0.6 * baseR + 0.32 * baseG + 0.08 * baseB
        r = mixChannel(r, skinLuma + (baseR - skinLuma) * 0.72, smoothAmount)
        g = mixChannel(g, skinLuma + (baseG - skinLuma) * 0.72, smoothAmount)
        b = mixChannel(b, skinLuma + (baseB - skinLuma) * 0.72, smoothAmount)
      }
      const stable = stabilizeSkinTone(r, g, b, baseR, baseG, baseB, skinBlend)
      r = stable.r
      g = stable.g
      b = stable.b
    }

    data[i] = channel(r)
    data[i + 1] = channel(g)
    data[i + 2] = channel(b)
  }

  ctx.putImageData(image, 0, 0)

  if (vignette > 0) {
    const gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.18,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.62,
    )
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(1, `rgba(0, 0, 0, ${Math.min(0.42, vignette / 210).toFixed(3)})`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }
}

/**
 * 与预览 DOM 一致的 CSS filter 字符串，供 Canvas ctx.filter 与 <img :style> 共用，
 * 避免「预览一套、导出另一套」的商业化大忌。
 */
export function buildPreviewFilterCssString(
  activeFilter,
  showFiltersOpen,
  filterIntensity,
  filterParams,
) {
  if (activeFilter === 'none' && !showFiltersOpen) {
    return 'none'
  }

  if (activeFilter === 'custom' || showFiltersOpen) {
    const { brightness, contrast, saturation, blur, grayscale, sepia, invert } = filterParams
    return [
      `brightness(${brightness}%)`,
      `contrast(${contrast}%)`,
      `saturate(${saturation}%)`,
      `blur(${blur}px)`,
      `grayscale(${grayscale}%)`,
      `sepia(${sepia}%)`,
      `invert(${invert}%)`,
    ].join(' ')
  }

  if (activeFilter === 'grayscale') {
    return 'grayscale(100%)'
  }
  if (activeFilter === 'sepia') {
    return `sepia(${filterIntensity}%)`
  }
  if (activeFilter === 'vintage') {
    return 'sepia(50%) contrast(95%) brightness(90%) saturate(80%)'
  }
  if (activeFilter === 'sharp') {
    return 'contrast(122%) brightness(102%) saturate(108%)'
  }
  if (activeFilter === 'blur') {
    return `blur(${filterIntensity / 10}px)`
  }
  if (activeFilter === 'invert') {
    return `invert(${filterIntensity}%)`
  }

  return 'none'
}
