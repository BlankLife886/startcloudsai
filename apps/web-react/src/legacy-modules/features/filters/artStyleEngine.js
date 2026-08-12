export const ART_STYLE_PRESETS = [
  { id: 'none', label: '无风格', description: '保持原始质感' },
  { id: 'mosaic', label: '马赛克', description: '像素块风格' },
  { id: 'pixel_art', label: '像素风', description: '8-bit 像素游戏感' },
  { id: 'perler_beads', label: '拼豆', description: '圆珠拼豆质感' },
  { id: 'polyfun', label: 'PolyFun', description: '低多边形三角剖分' },
  { id: 'hand_drawn', label: '手绘', description: '彩铅线稿与纸面质感' },
  { id: 'pencil_sketch', label: '素描', description: '铅笔线稿与明暗排线' },
  { id: 'eva_style', label: 'EVA风格', description: 'EVA 高彩草图风格' },
  { id: 'pencilized', label: '铅笔画', description: '真实铅笔画纸纹成稿' },
  { id: 'mural', label: '壁画', description: '旧墙壁画与颜料风化' },
  { id: 'relief_mural', label: '浮雕壁画', description: '石膏浅浮雕壁画' },
  { id: 'paper_relief', label: '纸雕浮雕', description: '分层纸雕与切边阴影' },
  { id: 'stained_glass', label: '彩色玻璃', description: '铅条镶嵌玻璃块' },
  { id: 'oil_paint', label: '油画', description: '笔触化块面感' },
  { id: 'comic', label: '漫画风', description: '高对比描边漫画感' },
  { id: 'chibi', label: 'Q版风', description: '明亮柔和卡通感' },
  { id: 'tech', label: '科技风', description: '冷色霓虹科技感' },
  { id: 'game', label: '游戏风', description: '游戏过场氛围感' },
  { id: 'watercolor', label: '水彩', description: '柔和晕染效果' },
  { id: 'posterize', label: '海报化', description: '色阶压缩风格' },
  { id: 'halftone', label: '半色调', description: '网点印刷风格' },
  { id: 'emboss', label: '浮雕', description: '立体雕刻质感' },
  { id: 'glass', label: '玻璃', description: '磨砂玻璃与折射感' },
]

export const ART_STYLE_PARAM_CONFIG = {
  mosaic: [{ key: 'blockSize', label: '块大小', min: 2, max: 50, step: 1, defaultValue: 100 }],
  pixel_art: [
    { key: 'pixelSize', label: '像素尺寸', min: 2, max: 16, step: 1, defaultValue: 100 },
    { key: 'palette', label: '色阶数量', min: 2, max: 12, step: 1, defaultValue: 70 },
  ],
  perler_beads: [
    { key: 'beadSize', label: '拼豆大小', min: 60, max: 180, step: 1, defaultValue: 100 },
    { key: 'clarity', label: '清晰度', min: 0, max: 100, step: 1, defaultValue: 78 },
  ],
  polyfun: [
    { key: 'density', label: '三角密度', min: 20, max: 100, step: 1, defaultValue: 58 },
    { key: 'edgeSense', label: '边缘捕捉', min: 0, max: 100, step: 1, defaultValue: 64 },
  ],
  hand_drawn: [
    { key: 'lineStrength', label: '线稿强度', min: 0, max: 100, step: 1, defaultValue: 66 },
    { key: 'paperTexture', label: '纸纹质感', min: 0, max: 100, step: 1, defaultValue: 58 },
  ],
  pencil_sketch: [
    { key: 'strokeDepth', label: '铅笔深度', min: 0, max: 100, step: 1, defaultValue: 72 },
    { key: 'hatching', label: '排线质感', min: 0, max: 100, step: 1, defaultValue: 68 },
  ],
  eva_style: [
    { key: 'threshold', label: '上色阈值', min: 120, max: 250, step: 1, defaultValue: 224 },
    { key: 'neonTone', label: 'EVA色彩', min: 0, max: 100, step: 1, defaultValue: 72 },
  ],
  pencilized: [
    { key: 'graphite', label: '石墨深度', min: 0, max: 100, step: 1, defaultValue: 76 },
    { key: 'paperGrain', label: '纸张纹理', min: 0, max: 100, step: 1, defaultValue: 70 },
  ],
  mural: [
    { key: 'plaster', label: '墙面质感', min: 0, max: 100, step: 1, defaultValue: 74 },
    { key: 'aging', label: '风化程度', min: 0, max: 100, step: 1, defaultValue: 58 },
  ],
  relief_mural: [
    { key: 'reliefDepth', label: '浮雕深度', min: 0, max: 100, step: 1, defaultValue: 72 },
    { key: 'stoneTexture', label: '石膏质感', min: 0, max: 100, step: 1, defaultValue: 68 },
  ],
  paper_relief: [
    { key: 'layerDepth', label: '纸层深度', min: 0, max: 100, step: 1, defaultValue: 70 },
    { key: 'paperGrain', label: '纸张纤维', min: 0, max: 100, step: 1, defaultValue: 62 },
  ],
  stained_glass: [
    { key: 'pieceSize', label: '玻璃片大小', min: 0, max: 100, step: 1, defaultValue: 54 },
    { key: 'leadWidth', label: '铅条宽度', min: 0, max: 100, step: 1, defaultValue: 58 },
  ],
  oil_paint: [
    { key: 'brush', label: '笔触大小', min: 1, max: 12, step: 1, defaultValue: 6 },
    { key: 'palette', label: '色块层次', min: 3, max: 18, step: 1, defaultValue: 10 },
  ],
  comic: [
    { key: 'edge', label: '描边强度', min: 20, max: 180, step: 1, defaultValue: 95 },
    { key: 'flatness', label: '平涂程度', min: 2, max: 10, step: 1, defaultValue: 6 },
  ],
  chibi: [
    { key: 'softness', label: '柔化', min: 0, max: 100, step: 1, defaultValue: 56 },
    { key: 'cuteColor', label: '萌系色彩', min: 0, max: 100, step: 1, defaultValue: 62 },
  ],
  tech: [
    { key: 'scanline', label: '扫描线', min: 0, max: 100, step: 1, defaultValue: 45 },
    { key: 'glitch', label: '色偏', min: 0, max: 100, step: 1, defaultValue: 52 },
  ],
  game: [
    { key: 'contrastBoost', label: '游戏对比', min: 0, max: 100, step: 1, defaultValue: 58 },
    { key: 'vignette', label: '暗角氛围', min: 0, max: 100, step: 1, defaultValue: 54 },
  ],
  watercolor: [
    { key: 'bleed', label: '晕染', min: 0, max: 100, step: 1, defaultValue: 55 },
    { key: 'wash', label: '水洗感', min: 0, max: 100, step: 1, defaultValue: 45 },
  ],
  posterize: [{ key: 'levels', label: '色阶', min: 2, max: 10, step: 1, defaultValue: 6 }],
  halftone: [{ key: 'dotSize', label: '网点大小', min: 3, max: 16, step: 1, defaultValue: 8 }],
  emboss: [{ key: 'depth', label: '浮雕深度', min: 0, max: 100, step: 1, defaultValue: 52 }],
  glass: [
    { key: 'frost', label: '磨砂', min: 0, max: 100, step: 1, defaultValue: 62 },
    { key: 'refraction', label: '折射', min: 0, max: 100, step: 1, defaultValue: 46 },
  ],
}

export function buildDefaultArtStyleParams() {
  const result = {}
  Object.entries(ART_STYLE_PARAM_CONFIG).forEach(([styleId, controls]) => {
    result[styleId] = {}
    controls.forEach((cfg) => {
      result[styleId][cfg.key] = cfg.defaultValue
    })
  })
  return result
}

export function getArtStyleById(styleId) {
  return ART_STYLE_PRESETS.find((item) => item.id === styleId) || ART_STYLE_PRESETS[0]
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getStyleParam(styleParams, styleId, key, fallback) {
  const raw = styleParams?.[styleId]?.[key]
  if (raw === undefined || raw === null || Number.isNaN(Number(raw))) return fallback
  return Number(raw)
}

function shadeChannel(v, delta) {
  return clamp(Math.round(v + delta), 0, 255)
}

const PERLER_BEAD_PALETTE = [
  [247, 247, 242],
  [224, 224, 215],
  [184, 184, 174],
  [112, 112, 108],
  [38, 38, 36],
  [244, 54, 58],
  [186, 36, 45],
  [247, 117, 42],
  [255, 177, 48],
  [255, 220, 66],
  [252, 238, 139],
  [118, 194, 64],
  [42, 150, 72],
  [20, 103, 72],
  [73, 207, 183],
  [58, 178, 218],
  [43, 125, 205],
  [38, 74, 156],
  [100, 78, 181],
  [174, 92, 189],
  [240, 91, 164],
  [255, 163, 187],
  [255, 203, 180],
  [209, 139, 92],
  [132, 83, 56],
]

const oklabCache = new Map()

function srgbToLinear(channel) {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function rgbToOklab(r, g, b) {
  const cacheKey = `${r},${g},${b}`
  const cached = oklabCache.get(cacheKey)
  if (cached) return cached

  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  const lRoot = Math.cbrt(l)
  const mRoot = Math.cbrt(m)
  const sRoot = Math.cbrt(s)
  const color = {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  }
  oklabCache.set(cacheKey, color)
  return color
}

function oklabDistance(a, b) {
  const dl = a.l - b.l
  const da = a.a - b.a
  const db = a.b - b.b
  return dl * dl + da * da + db * db
}

function closestBeadPaletteColor(r, g, b) {
  const target = rgbToOklab(r, g, b)
  let best = PERLER_BEAD_PALETTE[0]
  let bestDistance = Infinity
  for (const color of PERLER_BEAD_PALETTE) {
    const distance = oklabDistance(target, rgbToOklab(color[0], color[1], color[2]))
    if (distance < bestDistance) {
      bestDistance = distance
      best = color
    }
  }
  return { r: best[0], g: best[1], b: best[2] }
}

function seededNoise(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function lumaFromData(data, width, x, y) {
  const offset = (y * width + x) * 4
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
}

function buildEdgeMap(data, width, height) {
  const edges = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -lumaFromData(data, width, x - 1, y - 1) -
        2 * lumaFromData(data, width, x - 1, y) -
        lumaFromData(data, width, x - 1, y + 1) +
        lumaFromData(data, width, x + 1, y - 1) +
        2 * lumaFromData(data, width, x + 1, y) +
        lumaFromData(data, width, x + 1, y + 1)
      const gy =
        lumaFromData(data, width, x - 1, y - 1) +
        2 * lumaFromData(data, width, x, y - 1) +
        lumaFromData(data, width, x + 1, y - 1) -
        lumaFromData(data, width, x - 1, y + 1) -
        2 * lumaFromData(data, width, x, y + 1) -
        lumaFromData(data, width, x + 1, y + 1)
      edges[y * width + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy))
    }
  }
  return edges
}

function boxBlurGray(values, width, height, radius) {
  const out = new Float32Array(width * height)
  const safeRadius = Math.max(1, Math.round(radius))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let dy = -safeRadius; dy <= safeRadius; dy++) {
        for (let dx = -safeRadius; dx <= safeRadius; dx++) {
          const sx = clamp(x + dx, 0, width - 1)
          const sy = clamp(y + dy, 0, height - 1)
          sum += values[sy * width + sx]
          count++
        }
      }
      out[y * width + x] = sum / Math.max(1, count)
    }
  }
  return out
}

function evaGradientColor(x, y, width, height, neonTone) {
  const colors = [
    [255, 174, 34],
    [201, 60, 250],
    [255, 60, 62],
    [36, 207, 255],
    [48, 255, 204],
  ]
  const position = clamp((x / Math.max(1, width - 1)) * 0.58 + (y / Math.max(1, height - 1)) * 0.42, 0, 1)
  const scaled = position * (colors.length - 1)
  const index = Math.min(colors.length - 2, Math.floor(scaled))
  const t = scaled - index
  const a = colors[index]
  const b = colors[index + 1]
  const punch = 0.75 + neonTone / 180
  return {
    r: clamp(Math.round((a[0] * (1 - t) + b[0] * t) * punch), 0, 255),
    g: clamp(Math.round((a[1] * (1 - t) + b[1] * t) * punch), 0, 255),
    b: clamp(Math.round((a[2] * (1 - t) + b[2] * t) * punch), 0, 255),
  }
}

function circumcircleContains(triangle, point) {
  const ax = triangle.a.x - point.x
  const ay = triangle.a.y - point.y
  const bx = triangle.b.x - point.x
  const by = triangle.b.y - point.y
  const cx = triangle.c.x - point.x
  const cy = triangle.c.y - point.y
  const determinant =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay)
  return determinant > 0
}

function makeEdgeKey(a, b) {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`
}

function triangulatePoints(points, width, height) {
  const span = Math.max(width, height) * 16
  const superA = { id: 'sa', x: -span, y: -span }
  const superB = { id: 'sb', x: width + span, y: -span }
  const superC = { id: 'sc', x: width / 2, y: height + span }
  let triangles = [{ a: superA, b: superB, c: superC }]

  points.forEach((point) => {
    const bad = []
    triangles.forEach((triangle) => {
      if (circumcircleContains(triangle, point)) bad.push(triangle)
    })

    const edgeMap = new Map()
    bad.forEach((triangle) => {
      ;[
        [triangle.a, triangle.b],
        [triangle.b, triangle.c],
        [triangle.c, triangle.a],
      ].forEach(([a, b]) => {
        const key = makeEdgeKey(a, b)
        const existing = edgeMap.get(key)
        edgeMap.set(key, existing ? { ...existing, count: existing.count + 1 } : { a, b, count: 1 })
      })
    })

    triangles = triangles.filter((triangle) => !bad.includes(triangle))
    edgeMap.forEach((edge) => {
      if (edge.count !== 1) return
      triangles.push({ a: edge.a, b: edge.b, c: point })
    })
  })

  return triangles.filter(
    (triangle) =>
      ![triangle.a, triangle.b, triangle.c].some((point) =>
        point.id === 'sa' || point.id === 'sb' || point.id === 'sc',
      ),
  )
}

function applyMosaic(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const target = ctx.createImageData(width, height)
  const src = source.data
  const dst = target.data
  const blockScale = getStyleParam(styleParams, 'mosaic', 'blockSize', 100) / 100
  const block = clamp(Math.round((4 + (intensity / 100) * 30) * blockScale), 2, 50)

  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      const sampleX = Math.min(width - 1, x + Math.floor(block / 2))
      const sampleY = Math.min(height - 1, y + Math.floor(block / 2))
      const sampleOffset = (sampleY * width + sampleX) * 4
      const r = src[sampleOffset]
      const g = src[sampleOffset + 1]
      const b = src[sampleOffset + 2]
      const a = src[sampleOffset + 3]

      for (let yy = y; yy < y + block && yy < height; yy++) {
        for (let xx = x; xx < x + block && xx < width; xx++) {
          const offset = (yy * width + xx) * 4
          dst[offset] = r
          dst[offset + 1] = g
          dst[offset + 2] = b
          dst[offset + 3] = a
        }
      }
    }
  }

  ctx.putImageData(target, 0, 0)
}

function applyPixelArt(ctx, width, height, intensity, styleParams) {
  const pixelScale = getStyleParam(styleParams, 'pixel_art', 'pixelSize', 100) / 100
  const block = clamp(Math.round((2 + (intensity / 100) * 8) * pixelScale), 2, 16)
  const tinyW = Math.max(1, Math.round(width / block))
  const tinyH = Math.max(1, Math.round(height / block))

  const tinyCanvas = document.createElement('canvas')
  tinyCanvas.width = tinyW
  tinyCanvas.height = tinyH
  const tinyCtx = tinyCanvas.getContext('2d')
  if (!tinyCtx) return

  tinyCtx.imageSmoothingEnabled = false
  tinyCtx.drawImage(ctx.canvas, 0, 0, tinyW, tinyH)

  const image = tinyCtx.getImageData(0, 0, tinyW, tinyH)
  const data = image.data
  const palette = getStyleParam(styleParams, 'pixel_art', 'palette', 70)
  const levels = clamp(Math.round(12 - palette * 0.1), 2, 12)
  const step = 255 / (levels - 1)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] / step) * step
    data[i + 1] = Math.round(data[i + 1] / step) * step
    data[i + 2] = Math.round(data[i + 2] / step) * step
  }
  tinyCtx.putImageData(image, 0, 0)

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(tinyCanvas, 0, 0, width, height)
  ctx.imageSmoothingEnabled = true
}

function applyPerlerBeads(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const sizeScale = getStyleParam(styleParams, 'perler_beads', 'beadSize', 100) / 100
  const clarity = getStyleParam(styleParams, 'perler_beads', 'clarity', 78)
  const block = clamp(Math.round((7 + (intensity / 100) * 16) * sizeScale), 6, 32)
  const cellData = []

  function representativeCellColor(startX, startY, cellW, cellH) {
    const bins = new Map()
    let rSum = 0
    let gSum = 0
    let bSum = 0
    let count = 0
    let strongestKey = ''
    let strongestScore = -1
    const quantStep = clarity >= 72 ? 24 : 32

    for (let yy = startY; yy < startY + cellH && yy < height; yy++) {
      for (let xx = startX; xx < startX + cellW && xx < width; xx++) {
        const sampleOffset = (yy * width + xx) * 4
        if (src[sampleOffset + 3] < 128) continue
        const r = src[sampleOffset]
        const g = src[sampleOffset + 1]
        const b = src[sampleOffset + 2]
        rSum += r
        gSum += g
        bSum += b
        count++

        const qr = Math.round(r / quantStep) * quantStep
        const qg = Math.round(g / quantStep) * quantStep
        const qb = Math.round(b / quantStep) * quantStep
        const key = `${qr},${qg},${qb}`
        const nextScore = (bins.get(key)?.score || 0) + 1 + Math.abs(r - g) / 560 + Math.abs(r - b) / 560
        bins.set(key, {
          score: nextScore,
          r: (bins.get(key)?.r || 0) + r,
          g: (bins.get(key)?.g || 0) + g,
          b: (bins.get(key)?.b || 0) + b,
          count: (bins.get(key)?.count || 0) + 1,
        })
        if (nextScore > strongestScore) {
          strongestScore = nextScore
          strongestKey = key
        }
      }
    }

    if (!count) return closestBeadPaletteColor(245, 245, 240)
    const avg = {
      r: rSum / count,
      g: gSum / count,
      b: bSum / count,
    }
    const dominant = bins.get(strongestKey)
    const dominantRgb = dominant
      ? {
          r: dominant.r / dominant.count,
          g: dominant.g / dominant.count,
          b: dominant.b / dominant.count,
        }
      : avg
    const dominantMix = clamp(0.45 + clarity / 220, 0.45, 0.88)
    const mixed = {
      r: Math.round(avg.r * (1 - dominantMix) + dominantRgb.r * dominantMix),
      g: Math.round(avg.g * (1 - dominantMix) + dominantRgb.g * dominantMix),
      b: Math.round(avg.b * (1 - dominantMix) + dominantRgb.b * dominantMix),
    }
    return closestBeadPaletteColor(mixed.r, mixed.g, mixed.b)
  }

  ctx.fillStyle = '#f2f1eb'
  ctx.fillRect(0, 0, width, height)

  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      const cellW = Math.min(block, width - x)
      const cellH = Math.min(block, height - y)
      const color = representativeCellColor(x, y, cellW, cellH)
      cellData.push({ x, y, cellW, cellH, ...color })
    }
  }

  ctx.strokeStyle = 'rgba(50, 48, 42, 0.1)'
  ctx.lineWidth = 1
  for (let y = 0; y < height; y += block) {
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(width, y + 0.5)
    ctx.stroke()
  }
  for (let x = 0; x < width; x += block) {
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, height)
    ctx.stroke()
  }

  for (const cell of cellData) {
    const { x, y, cellW, cellH, r, g, b } = cell
    const beadSpan = Math.min(cellW, cellH)
    const cx = x + cellW / 2
    const cy = y + cellH / 2
    const baseRadius = beadSpan * 0.46
    const innerRadius = baseRadius * (0.82 + clarity / 900)
    const holeRadius = Math.max(1.2, baseRadius * 0.18)
    const highlightRadius = Math.max(1.2, baseRadius * 0.22)
    const shadowLift = Math.round(11 + clarity / 8)

    const grad = ctx.createRadialGradient(
      cx - beadSpan * 0.14,
      cy - beadSpan * 0.16,
      baseRadius * 0.12,
      cx,
      cy,
      baseRadius,
    )
    grad.addColorStop(
      0,
      `rgb(${shadeChannel(r, 34)} ${shadeChannel(g, 34)} ${shadeChannel(b, 34)})`,
    )
    grad.addColorStop(0.52, `rgb(${r} ${g} ${b})`)
    grad.addColorStop(
      1,
      `rgb(${shadeChannel(r, -shadowLift)} ${shadeChannel(g, -shadowLift)} ${shadeChannel(
        b,
        -shadowLift,
      )})`,
    )
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = `rgba(255, 255, 255, ${(0.16 + intensity / 520 + clarity / 620).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(cx - beadSpan * 0.16, cy - beadSpan * 0.17, highlightRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = `rgba(0, 0, 0, ${(0.2 + clarity / 420).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(cx, cy, holeRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.18 + clarity / 700).toFixed(3)})`
    ctx.lineWidth = Math.max(0.7, beadSpan * 0.035)
    ctx.beginPath()
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2)
    ctx.stroke()

    const edgeAlpha = clamp(0.14 + clarity / 260 + intensity / 1100, 0.14, 0.5)
    ctx.strokeStyle = `rgba(24, 22, 20, ${edgeAlpha.toFixed(3)})`
    ctx.lineWidth = Math.max(0.9, beadSpan * (0.035 + clarity / 2800))
    ctx.beginPath()
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2)
    ctx.stroke()
  }

  /** 轻量 Unsharp：让珠子边缘与色块分界更清晰（强度随「清晰度」） */
  const sharpenAmount = 0.18 + (clarity / 100) * 0.42
  if (sharpenAmount <= 0.28) return

  const snap = ctx.getImageData(0, 0, width, height)
  const data = snap.data
  const blur = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rAcc = 0
      let gAcc = 0
      let bAcc = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = clamp(x + dx, 0, width - 1)
          const sy = clamp(y + dy, 0, height - 1)
          const o = (sy * width + sx) * 4
          rAcc += data[o]
          gAcc += data[o + 1]
          bAcc += data[o + 2]
          n++
        }
      }
      const i = (y * width + x) * 3
      blur[i] = rAcc / n
      blur[i + 1] = gAcc / n
      blur[i + 2] = bAcc / n
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const i = (y * width + x) * 3
      const r0 = data[o]
      const g0 = data[o + 1]
      const b0 = data[o + 2]
      const br = blur[i]
      const bg = blur[i + 1]
      const bb = blur[i + 2]
      data[o] = clamp(Math.round(r0 + sharpenAmount * (r0 - br)), 0, 255)
      data[o + 1] = clamp(Math.round(g0 + sharpenAmount * (g0 - bg)), 0, 255)
      data[o + 2] = clamp(Math.round(b0 + sharpenAmount * (b0 - bb)), 0, 255)
    }
  }
  ctx.putImageData(snap, 0, 0)
}

function applyPolyFun(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const density = getStyleParam(styleParams, 'polyfun', 'density', 58)
  const edgeSense = getStyleParam(styleParams, 'polyfun', 'edgeSense', 64)
  const sampleStride = clamp(Math.round(14 - edgeSense / 12), 5, 14)
  const edgeThreshold = clamp(48 - edgeSense * 0.26, 18, 52)
  const maxEdgePoints = clamp(Math.round(45 + density * 1.6 + intensity * 1.2), 60, 300)
  const randomPoints = clamp(Math.round(18 + density * 0.75 + intensity * 0.45), 24, 150)
  const points = [
    { id: 'p0', x: 0, y: 0 },
    { id: 'p1', x: width - 1, y: 0 },
    { id: 'p2', x: 0, y: height - 1 },
    { id: 'p3', x: width - 1, y: height - 1 },
    { id: 'p4', x: width / 2, y: 0 },
    { id: 'p5', x: width / 2, y: height - 1 },
    { id: 'p6', x: 0, y: height / 2 },
    { id: 'p7', x: width - 1, y: height / 2 },
  ]
  const edgeCandidates = []

  const lumaAt = (x, y) => {
    const offset = (y * width + x) * 4
    return src[offset] * 0.299 + src[offset + 1] * 0.587 + src[offset + 2] * 0.114
  }

  for (let y = sampleStride; y < height - sampleStride; y += sampleStride) {
    for (let x = sampleStride; x < width - sampleStride; x += sampleStride) {
      const gx = lumaAt(x + sampleStride, y) - lumaAt(x - sampleStride, y)
      const gy = lumaAt(x, y + sampleStride) - lumaAt(x, y - sampleStride)
      const mag = Math.sqrt(gx * gx + gy * gy)
      if (mag < edgeThreshold) continue
      edgeCandidates.push({
        x: x + (seededNoise(x * 19 + y * 7) - 0.5) * sampleStride * 0.7,
        y: y + (seededNoise(x * 11 + y * 23) - 0.5) * sampleStride * 0.7,
        score: mag,
      })
    }
  }

  edgeCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, maxEdgePoints)
    .forEach((point, index) => {
      points.push({
        id: `e${index}`,
        x: clamp(point.x, 0, width - 1),
        y: clamp(point.y, 0, height - 1),
      })
    })

  for (let i = 0; i < randomPoints; i += 1) {
    points.push({
      id: `r${i}`,
      x: seededNoise(i * 37 + width * 0.13) * (width - 1),
      y: seededNoise(i * 53 + height * 0.17) * (height - 1),
    })
  }

  const triangles = triangulatePoints(points, width, height)
  ctx.clearRect(0, 0, width, height)

  triangles.forEach((triangle) => {
    const cx = clamp(Math.round((triangle.a.x + triangle.b.x + triangle.c.x) / 3), 0, width - 1)
    const cy = clamp(Math.round((triangle.a.y + triangle.b.y + triangle.c.y) / 3), 0, height - 1)
    const offset = (cy * width + cx) * 4
    const r = src[offset]
    const g = src[offset + 1]
    const b = src[offset + 2]
    const luma = (r * 0.299 + g * 0.587 + b * 0.114) / 255
    const lift = (seededNoise(cx * 3 + cy * 5) - 0.5) * (8 + intensity * 0.08)
    const shade = (0.5 - luma) * 8

    ctx.beginPath()
    ctx.moveTo(triangle.a.x, triangle.a.y)
    ctx.lineTo(triangle.b.x, triangle.b.y)
    ctx.lineTo(triangle.c.x, triangle.c.y)
    ctx.closePath()
    ctx.fillStyle = `rgb(${shadeChannel(r, lift + shade)} ${shadeChannel(g, lift + shade)} ${shadeChannel(
      b,
      lift + shade,
    )})`
    ctx.fill()
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.04 + edgeSense / 1800).toFixed(3)})`
    ctx.lineWidth = 0.8
    ctx.stroke()
  })
}

function applyHandDrawn(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const output = ctx.createImageData(width, height)
  const dst = output.data
  const edges = buildEdgeMap(src, width, height)
  const lineStrength = getStyleParam(styleParams, 'hand_drawn', 'lineStrength', 66)
  const paperTexture = getStyleParam(styleParams, 'hand_drawn', 'paperTexture', 58)
  const colorKeep = 0.5 + intensity / 260
  const lineAmount = 0.55 + lineStrength / 105
  const paperAmount = paperTexture / 100

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const r = src[offset]
      const g = src[offset + 1]
      const b = src[offset + 2]
      const luma = r * 0.299 + g * 0.587 + b * 0.114
      const edge = edges[y * width + x] / 255
      const paper =
        (seededNoise(x * 0.77 + y * 1.37) - 0.5) * 18 * paperAmount +
        Math.sin((x + y) * 0.22) * 3 * paperAmount
      const wash = 245 + paper
      const shade = (1 - luma / 255) * 36
      const lineDarken = Math.min(150, edge ** 0.72 * 115 * lineAmount)
      const pencilWobble = (seededNoise(x * 5.3 + y * 2.1) - 0.5) * 8 * edge

      dst[offset] = clamp(Math.round(wash * (1 - colorKeep) + r * colorKeep - shade - lineDarken + pencilWobble), 0, 255)
      dst[offset + 1] = clamp(
        Math.round(wash * (1 - colorKeep) + g * colorKeep - shade * 0.92 - lineDarken + pencilWobble),
        0,
        255,
      )
      dst[offset + 2] = clamp(
        Math.round(wash * (1 - colorKeep) + b * colorKeep - shade * 0.82 - lineDarken * 0.92 + pencilWobble),
        0,
        255,
      )
      dst[offset + 3] = src[offset + 3]
    }
  }
  ctx.putImageData(output, 0, 0)

  ctx.strokeStyle = `rgba(65, 49, 36, ${(0.035 + lineStrength / 1600).toFixed(3)})`
  ctx.lineWidth = 0.7
  const strokeGap = clamp(Math.round(18 - intensity / 11), 8, 18)
  for (let y = -height; y < height; y += strokeGap) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y + width * 0.42)
    ctx.stroke()
  }
}

function applyPencilSketch(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const output = ctx.createImageData(width, height)
  const dst = output.data
  const edges = buildEdgeMap(src, width, height)
  const strokeDepth = getStyleParam(styleParams, 'pencil_sketch', 'strokeDepth', 72)
  const hatching = getStyleParam(styleParams, 'pencil_sketch', 'hatching', 68)
  const depth = 0.72 + strokeDepth / 95
  const hatchAmount = hatching / 100

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const luma = lumaFromData(src, width, x, y)
      const edge = edges[y * width + x] / 255
      const paper = 244 + (seededNoise(x * 1.31 + y * 0.91) - 0.5) * 16
      const graphite = (1 - luma / 255) ** 1.18 * 132 * depth
      const line = edge ** 0.58 * 176 * depth
      const hatchA = Math.abs(((x + y * 1.8) % 14) - 7) < 1.25 ? 30 * hatchAmount : 0
      const hatchB = Math.abs(((x * 1.2 - y) % 18) - 9) < 0.9 ? 22 * hatchAmount : 0
      const shadowMask = clamp((150 - luma) / 120, 0, 1)
      const grain = (seededNoise(x * 3.7 + y * 4.9) - 0.5) * 12
      const value = paper - graphite - line - (hatchA + hatchB) * shadowMask + grain

      dst[offset] = clamp(Math.round(value), 0, 255)
      dst[offset + 1] = clamp(Math.round(value - 1), 0, 255)
      dst[offset + 2] = clamp(Math.round(value - 3), 0, 255)
      dst[offset + 3] = src[offset + 3]
    }
  }
  ctx.putImageData(output, 0, 0)
}

function applyEvaStyle(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const gray = new Float32Array(width * height)
  const inverted = new Float32Array(width * height)
  const threshold = getStyleParam(styleParams, 'eva_style', 'threshold', 224)
  const neonTone = getStyleParam(styleParams, 'eva_style', 'neonTone', 72)

  for (let i = 0; i < width * height; i++) {
    const offset = i * 4
    const g = src[offset] * 0.299 + src[offset + 1] * 0.587 + src[offset + 2] * 0.114
    gray[i] = g
    inverted[i] = 255 - g
  }

  const blur = boxBlurGray(boxBlurGray(inverted, width, height, 3), width, height, 2)
  const sketch = new Float32Array(width * height)
  const minSketch = new Float32Array(width * height)
  for (let i = 0; i < sketch.length; i++) {
    const dodge = (blur[i] * 255) / Math.max(1, 255 - gray[i])
    sketch[i] = clamp(dodge, 0, 255)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minValue = 255
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = clamp(x + dx, 0, width - 1)
          const sy = clamp(y + dy, 0, height - 1)
          minValue = Math.min(minValue, sketch[sy * width + sx])
        }
      }
      minSketch[y * width + x] = minValue
    }
  }

  const output = ctx.createImageData(width, height)
  const dst = output.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const offset = i * 4
      const v = minSketch[i]
      const paperNoise = (seededNoise(x * 2.7 + y * 1.9) - 0.5) * 6
      if (v < threshold) {
        const eva = evaGradientColor(x, y, width, height, neonTone)
        const ink = clamp((threshold - v) / Math.max(1, threshold), 0, 1)
        const mix = clamp(0.55 + ink * 0.45 + intensity / 360, 0.55, 1)
        dst[offset] = clamp(Math.round(v * (1 - mix) + eva.r * mix + paperNoise), 0, 255)
        dst[offset + 1] = clamp(Math.round(v * (1 - mix) + eva.g * mix + paperNoise), 0, 255)
        dst[offset + 2] = clamp(Math.round(v * (1 - mix) + eva.b * mix + paperNoise), 0, 255)
      } else {
        const clean = clamp(v + 10 + paperNoise, 0, 255)
        dst[offset] = clean
        dst[offset + 1] = clean
        dst[offset + 2] = clean
      }
      dst[offset + 3] = src[offset + 3]
    }
  }
  ctx.putImageData(output, 0, 0)
}

function applyPencilized(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const edges = buildEdgeMap(src, width, height)
  const tone = new Float32Array(width * height)
  const graphite = getStyleParam(styleParams, 'pencilized', 'graphite', 76)
  const paperGrain = getStyleParam(styleParams, 'pencilized', 'paperGrain', 70)
  const graphDepth = 0.8 + graphite / 90
  const textureDepth = paperGrain / 100

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const luma = lumaFromData(src, width, x, y) / 255
      const brightLayer = Math.exp(-(1 - luma) / 0.08) * 0.28
      const mildLayer = luma > 0.42 && luma < 0.88 ? 0.38 : 0
      const darkLayer = Math.exp(-((luma - 0.35) ** 2) / 0.018) * 0.34
      tone[y * width + x] = clamp(0.72 + brightLayer + mildLayer - darkLayer - (1 - luma) * 0.52, 0, 1)
    }
  }

  const smoothTone = boxBlurGray(tone, width, height, 2)
  const output = ctx.createImageData(width, height)
  const dst = output.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const edge = edges[y * width + x] / 255
      const luma = lumaFromData(src, width, x, y)
      const paper =
        0.94 +
        (seededNoise(x * 0.91 + y * 1.77) - 0.5) * 0.13 * textureDepth +
        Math.sin(x * 0.18 + y * 0.07) * 0.025 * textureDepth
      const hatch1 = Math.abs(((x + y * 1.55) % 13) - 6.5) < 0.95 ? 0.12 * textureDepth : 0
      const hatch2 = Math.abs(((x * 1.4 - y * 0.8) % 17) - 8.5) < 0.8 ? 0.09 * textureDepth : 0
      const shadow = clamp((160 - luma) / 150, 0, 1)
      const stroke = clamp(1 - edge ** 0.62 * 0.82 * graphDepth, 0, 1)
      const pencil = clamp(smoothTone[y * width + x] * paper * stroke - (hatch1 + hatch2) * shadow, 0, 1)
      const value = clamp(Math.round(pencil * 255), 0, 255)

      dst[offset] = value
      dst[offset + 1] = clamp(Math.round(value - 1), 0, 255)
      dst[offset + 2] = clamp(Math.round(value - 4), 0, 255)
      dst[offset + 3] = src[offset + 3]
    }
  }
  ctx.putImageData(output, 0, 0)
}

function applyMural(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const output = ctx.createImageData(width, height)
  const dst = output.data
  const edges = buildEdgeMap(src, width, height)
  const plaster = getStyleParam(styleParams, 'mural', 'plaster', 74)
  const aging = getStyleParam(styleParams, 'mural', 'aging', 58)
  const plasterAmount = plaster / 100
  const ageAmount = aging / 100
  const wallTone = { r: 198, g: 185, b: 157 }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const r = src[offset]
      const g = src[offset + 1]
      const b = src[offset + 2]
      const luma = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      const coarse = seededNoise(Math.floor(x / 9) * 17 + Math.floor(y / 9) * 31)
      const sand = seededNoise(x * 1.7 + y * 2.3)
      const mineral = (coarse - 0.5) * 42 * plasterAmount + (sand - 0.5) * 18 * plasterAmount
      const erosionNoise = seededNoise(Math.floor(x / 17) * 43 + Math.floor(y / 17) * 29)
      const chip = erosionNoise > 1 - 0.11 * ageAmount && seededNoise(x * 0.4 + y * 0.6) > 0.55
      const pigmentFade = 0.24 + ageAmount * 0.34 + plasterAmount * 0.12
      const pigmentSink = 1 - plasterAmount * 0.18 - ageAmount * 0.1
      const edgeDust = (edges[y * width + x] / 255) ** 0.7 * 16 * plasterAmount
      const crack =
        Math.abs(Math.sin(x * 0.038 + seededNoise(Math.floor(y / 28) * 19) * 4) + Math.cos(y * 0.045)) <
          0.028 + ageAmount * 0.018 &&
        seededNoise(Math.floor(x / 5) * 13 + Math.floor(y / 5) * 7) > 0.56

      let nr = r * pigmentSink + wallTone.r * pigmentFade + mineral
      let ng = g * pigmentSink + wallTone.g * pigmentFade + mineral * 0.94
      let nb = b * pigmentSink + wallTone.b * pigmentFade + mineral * 0.82

      const warmth = (1 - luma) * 10 + ageAmount * 8
      nr += warmth
      ng += warmth * 0.5
      nb -= warmth * 0.35

      if (chip) {
        const exposed = 0.72 + seededNoise(x * 5.1 + y * 3.9) * 0.18
        nr = nr * (1 - exposed) + wallTone.r * exposed
        ng = ng * (1 - exposed) + wallTone.g * exposed
        nb = nb * (1 - exposed) + wallTone.b * exposed
      }

      if (crack) {
        nr -= 70 * ageAmount + edgeDust
        ng -= 64 * ageAmount + edgeDust
        nb -= 56 * ageAmount + edgeDust
      } else {
        nr -= edgeDust * 0.45
        ng -= edgeDust * 0.42
        nb -= edgeDust * 0.36
      }

      dst[offset] = clamp(Math.round(nr), 0, 255)
      dst[offset + 1] = clamp(Math.round(ng), 0, 255)
      dst[offset + 2] = clamp(Math.round(nb), 0, 255)
      dst[offset + 3] = src[offset + 3]
    }
  }
  ctx.putImageData(output, 0, 0)

  ctx.strokeStyle = `rgba(80, 64, 42, ${(0.035 + ageAmount * 0.07).toFixed(3)})`
  ctx.lineWidth = 0.8
  const crackGap = clamp(Math.round(56 - aging / 2), 12, 56)
  for (let y = -height; y < height; y += crackGap) {
    ctx.beginPath()
    for (let x = 0; x <= width; x += 18) {
      const wobble = (seededNoise(x * 0.31 + y * 0.17) - 0.5) * 18 * ageAmount
      const py = y + x * 0.18 + wobble
      if (x === 0) ctx.moveTo(x, py)
      else ctx.lineTo(x, py)
    }
    ctx.stroke()
  }

  const dust = ctx.createRadialGradient(
    width * 0.48,
    height * 0.42,
    Math.min(width, height) * 0.15,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72,
  )
  dust.addColorStop(0, 'rgba(255,255,255,0)')
  dust.addColorStop(1, `rgba(89, 70, 45, ${(0.08 + ageAmount * 0.13).toFixed(3)})`)
  ctx.fillStyle = dust
  ctx.fillRect(0, 0, width, height)
}

function applyReliefMural(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const heightMap = new Float32Array(width * height)
  const edges = buildEdgeMap(src, width, height)
  const reliefDepth = getStyleParam(styleParams, 'relief_mural', 'reliefDepth', 72)
  const stoneTexture = getStyleParam(styleParams, 'relief_mural', 'stoneTexture', 68)
  const depthAmount = reliefDepth / 100
  const stoneAmount = stoneTexture / 100

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const luma = (src[offset] * 0.299 + src[offset + 1] * 0.587 + src[offset + 2] * 0.114) / 255
      const edgeRise = (edges[y * width + x] / 255) ** 0.55
      const chiselNoise =
        (seededNoise(Math.floor(x / 8) * 37 + Math.floor(y / 8) * 23) - 0.5) * 0.12 * stoneAmount
      heightMap[y * width + x] = clamp(luma * 0.45 + edgeRise * 0.55 + chiselNoise, 0, 1)
    }
  }

  const smoothHeight = boxBlurGray(heightMap, width, height, 2)
  const output = ctx.createImageData(width, height)
  const dst = output.data
  const baseStone = { r: 196, g: 184, b: 158 }
  const lightX = -0.58
  const lightY = -0.72
  const lightZ = 0.38
  const normalScale = 4 + depthAmount * 13

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const left = smoothHeight[y * width + clamp(x - 1, 0, width - 1)]
      const right = smoothHeight[y * width + clamp(x + 1, 0, width - 1)]
      const up = smoothHeight[clamp(y - 1, 0, height - 1) * width + x]
      const down = smoothHeight[clamp(y + 1, 0, height - 1) * width + x]
      const nx = (left - right) * normalScale
      const ny = (up - down) * normalScale
      const nz = 1
      const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      const lighting = clamp(
        (nx / normalLength) * lightX + (ny / normalLength) * lightY + (nz / normalLength) * lightZ,
        -1,
        1,
      )

      const r = src[offset]
      const g = src[offset + 1]
      const b = src[offset + 2]
      const luma = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      const mineral =
        (seededNoise(x * 1.41 + y * 2.17) - 0.5) * 24 * stoneAmount +
        Math.sin(x * 0.17 + y * 0.09) * 6 * stoneAmount
      const pigment = 0.28 + (intensity / 100) * 0.22
      const raisedDust = smoothHeight[y * width + x] * 22 * stoneAmount
      const lightBoost = lighting * 72 * depthAmount
      const shadowCarve = lighting < 0 ? lighting * 42 * depthAmount : 0

      let nr = baseStone.r * (1 - pigment) + r * pigment + mineral + lightBoost + shadowCarve
      let ng = baseStone.g * (1 - pigment) + g * pigment + mineral * 0.92 + lightBoost * 0.94 + shadowCarve
      let nb = baseStone.b * (1 - pigment) + b * pigment + mineral * 0.78 + lightBoost * 0.78 + shadowCarve

      const sunBaked = (1 - luma) * 8 + stoneAmount * 6
      nr += sunBaked + raisedDust * 0.16
      ng += sunBaked * 0.42 + raisedDust * 0.09
      nb -= sunBaked * 0.18

      dst[offset] = clamp(Math.round(nr), 0, 255)
      dst[offset + 1] = clamp(Math.round(ng), 0, 255)
      dst[offset + 2] = clamp(Math.round(nb), 0, 255)
      dst[offset + 3] = src[offset + 3]
    }
  }
  ctx.putImageData(output, 0, 0)

  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = `rgba(88, 68, 45, ${(0.06 + stoneAmount * 0.08).toFixed(3)})`
  for (let y = 0; y < height; y += 6) {
    const alpha = 0.015 + seededNoise(y * 2.9) * 0.035 * stoneAmount
    ctx.fillStyle = `rgba(92, 74, 52, ${alpha.toFixed(3)})`
    ctx.fillRect(0, y, width, 1)
  }
  ctx.globalCompositeOperation = 'source-over'

  const glaze = ctx.createLinearGradient(0, 0, width, height)
  glaze.addColorStop(0, `rgba(255, 246, 220, ${(0.09 + depthAmount * 0.04).toFixed(3)})`)
  glaze.addColorStop(0.52, 'rgba(255, 255, 255, 0)')
  glaze.addColorStop(1, `rgba(69, 54, 36, ${(0.1 + stoneAmount * 0.07).toFixed(3)})`)
  ctx.fillStyle = glaze
  ctx.fillRect(0, 0, width, height)
}

function applyPaperRelief(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const edges = buildEdgeMap(src, width, height)
  const layerDepth = getStyleParam(styleParams, 'paper_relief', 'layerDepth', 70)
  const paperGrain = getStyleParam(styleParams, 'paper_relief', 'paperGrain', 62)
  const depthAmount = layerDepth / 100
  const grainAmount = paperGrain / 100
  const layerCount = clamp(Math.round(4 + depthAmount * 5), 4, 9)
  const heightMap = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const luma = (src[offset] * 0.299 + src[offset + 1] * 0.587 + src[offset + 2] * 0.114) / 255
      const stepped = Math.round(luma * (layerCount - 1)) / Math.max(1, layerCount - 1)
      const edgeLift = (edges[y * width + x] / 255) ** 0.62 * 0.16 * depthAmount
      heightMap[y * width + x] = clamp(stepped + edgeLift, 0, 1)
    }
  }

  const smoothHeight = boxBlurGray(heightMap, width, height, 1)
  const output = ctx.createImageData(width, height)
  const dst = output.data
  const cutShadow = 34 + depthAmount * 76
  const pigment = 0.34 + intensity / 260

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const h = smoothHeight[y * width + x]
      const hLeft = smoothHeight[y * width + clamp(x - 1, 0, width - 1)]
      const hRight = smoothHeight[y * width + clamp(x + 1, 0, width - 1)]
      const hUp = smoothHeight[clamp(y - 1, 0, height - 1) * width + x]
      const hDown = smoothHeight[clamp(y + 1, 0, height - 1) * width + x]
      const ridge = Math.abs(hRight - hLeft) + Math.abs(hDown - hUp)
      const light = clamp((h - hRight) * 60 * depthAmount + (h - hDown) * 46 * depthAmount, -1, 1)
      const shadow = clamp((hLeft - h) * 42 * depthAmount + (hUp - h) * 34 * depthAmount, -1, 1)
      const fiber =
        (seededNoise(x * 2.11 + y * 0.77) - 0.5) * 14 * grainAmount +
        Math.sin(x * 0.36 + y * 0.045) * 5 * grainAmount
      const paperTone = 232 + h * 18 + fiber
      const r = src[offset]
      const g = src[offset + 1]
      const b = src[offset + 2]
      const layerTintR = paperTone * 1.01
      const layerTintG = paperTone * 0.985
      const layerTintB = paperTone * 0.94
      let nr = layerTintR * (1 - pigment) + r * pigment
      let ng = layerTintG * (1 - pigment) + g * pigment
      let nb = layerTintB * (1 - pigment) + b * pigment
      const carved = ridge * cutShadow

      nr += light * 32 - shadow * 22 - carved * 0.42
      ng += light * 30 - shadow * 22 - carved * 0.38
      nb += light * 26 - shadow * 20 - carved * 0.32

      dst[offset] = clamp(Math.round(nr), 0, 255)
      dst[offset + 1] = clamp(Math.round(ng), 0, 255)
      dst[offset + 2] = clamp(Math.round(nb), 0, 255)
      dst[offset + 3] = src[offset + 3]
    }
  }
  ctx.putImageData(output, 0, 0)

  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = `rgba(156, 132, 92, ${(0.035 + depthAmount * 0.055).toFixed(3)})`
  for (let y = 4; y < height; y += 11) {
    ctx.fillRect(0, y, width, 1)
  }
  ctx.globalCompositeOperation = 'source-over'

  const paperLight = ctx.createLinearGradient(0, 0, width, height)
  paperLight.addColorStop(0, `rgba(255, 255, 255, ${(0.12 + depthAmount * 0.08).toFixed(3)})`)
  paperLight.addColorStop(0.55, 'rgba(255, 255, 255, 0)')
  paperLight.addColorStop(1, `rgba(95, 72, 42, ${(0.07 + depthAmount * 0.08).toFixed(3)})`)
  ctx.fillStyle = paperLight
  ctx.fillRect(0, 0, width, height)
}

function applyStainedGlass(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const output = ctx.createImageData(width, height)
  const dst = output.data
  const pieceSize = getStyleParam(styleParams, 'stained_glass', 'pieceSize', 54)
  const leadWidth = getStyleParam(styleParams, 'stained_glass', 'leadWidth', 58)
  const cellSize = clamp(Math.round(42 - pieceSize * 0.28), 14, 42)
  const leadThreshold = 0.115 + (leadWidth / 100) * 0.105
  const colorPunch = 1.16 + intensity / 240

  const siteFor = (gx, gy) => {
    const jitterX = (seededNoise(gx * 41.7 + gy * 17.3) - 0.5) * cellSize * 0.74
    const jitterY = (seededNoise(gx * 13.9 + gy * 59.1) - 0.5) * cellSize * 0.74
    return {
      x: gx * cellSize + cellSize * 0.5 + jitterX,
      y: gy * cellSize + cellSize * 0.5 + jitterY,
      seed: gx * 97 + gy * 131,
    }
  }

  for (let y = 0; y < height; y++) {
    const gy = Math.floor(y / cellSize)
    for (let x = 0; x < width; x++) {
      const gx = Math.floor(x / cellSize)
      let best = null
      let second = null
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const site = siteFor(gx + ox, gy + oy)
          const dx = x - site.x
          const dy = y - site.y
          const distance = dx * dx + dy * dy
          if (best === null || distance < best.distance) {
            second = best
            best = { ...site, distance }
          } else if (second === null || distance < second.distance) {
            second = { ...site, distance }
          }
        }
      }

      const offset = (y * width + x) * 4
      const borderRatio = second ? Math.sqrt(second.distance) - Math.sqrt(best.distance) : cellSize
      const lead = borderRatio < cellSize * leadThreshold
      if (lead) {
        const bevel = borderRatio / Math.max(1, cellSize * leadThreshold)
        const shine = seededNoise(x * 0.8 + y * 1.2) * 20 * bevel
        dst[offset] = clamp(Math.round(24 + shine), 0, 255)
        dst[offset + 1] = clamp(Math.round(22 + shine), 0, 255)
        dst[offset + 2] = clamp(Math.round(20 + shine), 0, 255)
        dst[offset + 3] = src[offset + 3]
        continue
      }

      const sampleX = clamp(Math.round(best.x), 0, width - 1)
      const sampleY = clamp(Math.round(best.y), 0, height - 1)
      const sampleOffset = (sampleY * width + sampleX) * 4
      const glassNoise =
        (seededNoise(x * 1.9 + y * 2.7) - 0.5) * 22 +
        Math.sin((x + best.seed) * 0.13) * 7 +
        Math.cos((y - best.seed) * 0.11) * 7
      const facet = clamp(borderRatio / cellSize, 0, 1)
      const highlight = Math.max(0, 1 - facet * 3.2) * 32
      const r = src[sampleOffset]
      const g = src[sampleOffset + 1]
      const b = src[sampleOffset + 2]
      const gray = r * 0.299 + g * 0.587 + b * 0.114
      const localShade = 0.9 + seededNoise(best.seed) * 0.22

      dst[offset] = clamp(Math.round((gray + (r - gray) * colorPunch) * localShade + glassNoise + highlight), 0, 255)
      dst[offset + 1] = clamp(
        Math.round((gray + (g - gray) * colorPunch) * localShade + glassNoise * 0.82 + highlight),
        0,
        255,
      )
      dst[offset + 2] = clamp(
        Math.round((gray + (b - gray) * colorPunch) * localShade + glassNoise * 0.62 + highlight),
        0,
        255,
      )
      dst[offset + 3] = src[offset + 3]
    }
  }

  ctx.putImageData(output, 0, 0)

  const glow = ctx.createLinearGradient(0, 0, width, height)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
  glow.addColorStop(0.34, 'rgba(255, 255, 255, 0.02)')
  glow.addColorStop(1, 'rgba(30, 18, 10, 0.16)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)
}

function applyComic(ctx, width, height, intensity, styleParams) {
  const flatness = getStyleParam(styleParams, 'comic', 'flatness', 6)
  const comicLevel = clamp(100 - flatness * 8, 20, 100)
  applyPosterize(ctx, width, height, comicLevel, styleParams)

  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const edgeMask = new Uint8ClampedArray(width * height)
  const edgeParam = getStyleParam(styleParams, 'comic', 'edge', 95)
  const threshold = clamp(35 + edgeParam * 1.1, 35, 170)

  const grayAt = (x, y) => {
    const offset = (y * width + x) * 4
    return src[offset] * 0.299 + src[offset + 1] * 0.587 + src[offset + 2] * 0.114
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -grayAt(x - 1, y - 1) -
        2 * grayAt(x - 1, y) -
        grayAt(x - 1, y + 1) +
        grayAt(x + 1, y - 1) +
        2 * grayAt(x + 1, y) +
        grayAt(x + 1, y + 1)
      const gy =
        grayAt(x - 1, y - 1) +
        2 * grayAt(x, y - 1) +
        grayAt(x + 1, y - 1) -
        grayAt(x - 1, y + 1) -
        2 * grayAt(x, y + 1) -
        grayAt(x + 1, y + 1)
      const mag = Math.sqrt(gx * gx + gy * gy)
      if (mag > threshold) edgeMask[y * width + x] = 1
    }
  }

  const output = ctx.getImageData(0, 0, width, height)
  const out = output.data
  const edgeDarkness = clamp(160 + intensity, 160, 255)
  for (let i = 0; i < edgeMask.length; i++) {
    if (!edgeMask[i]) continue
    const offset = i * 4
    out[offset] = shadeChannel(out[offset], -edgeDarkness)
    out[offset + 1] = shadeChannel(out[offset + 1], -edgeDarkness)
    out[offset + 2] = shadeChannel(out[offset + 2], -edgeDarkness)
  }
  ctx.putImageData(output, 0, 0)
}

function applyChibi(ctx, width, height, intensity, styleParams) {
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = width
  sourceCanvas.height = height
  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) return
  sourceCtx.drawImage(ctx.canvas, 0, 0, width, height)

  const softness = getStyleParam(styleParams, 'chibi', 'softness', 56)
  const blurPx = (softness / 100) * 2.2
  const cuteColor = getStyleParam(styleParams, 'chibi', 'cuteColor', 62)
  ctx.filter = `blur(${blurPx.toFixed(2)}px) saturate(${(110 + cuteColor * 0.6).toFixed(1)}%) brightness(${(104 + cuteColor * 0.26).toFixed(1)}%)`
  ctx.drawImage(sourceCanvas, 0, 0, width, height)
  ctx.filter = 'none'

  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  const pinkLift = cuteColor * 0.32
  for (let i = 0; i < data.length; i += 4) {
    data[i] = shadeChannel(data[i], pinkLift * 0.6)
    data[i + 1] = shadeChannel(data[i + 1], pinkLift * 0.2)
    data[i + 2] = shadeChannel(data[i + 2], pinkLift * 0.8)
  }
  ctx.putImageData(image, 0, 0)
}

function applyTech(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const data = source.data
  const glitch = getStyleParam(styleParams, 'tech', 'glitch', 52)
  const scanline = getStyleParam(styleParams, 'tech', 'scanline', 45)
  const shift = clamp(Math.round(1 + (glitch / 100) * 6), 1, 8)
  const scanlineAlpha = 0.03 + scanline / 700

  for (let y = 0; y < height; y++) {
    for (let x = width - 1; x >= 0; x--) {
      const i = (y * width + x) * 4
      const left = (y * width + Math.max(0, x - shift)) * 4
      const right = (y * width + Math.min(width - 1, x + shift)) * 4

      const r = data[right]
      const g = data[i + 1]
      const b = data[left + 2]
      data[i] = shadeChannel(r, -8)
      data[i + 1] = shadeChannel(g, 10)
      data[i + 2] = shadeChannel(b, 24)
    }
  }
  ctx.putImageData(source, 0, 0)

  ctx.fillStyle = `rgba(120, 220, 255, ${scanlineAlpha.toFixed(3)})`
  for (let y = 0; y < height; y += 3) {
    ctx.fillRect(0, y, width, 1)
  }
}

function applyGameStyle(ctx, width, height, intensity, styleParams) {
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  const contrastBoost = getStyleParam(styleParams, 'game', 'contrastBoost', 58)
  const satBoost = 1 + contrastBoost / 160
  const contrast = 1 + contrastBoost / 210

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    const gray = (r + g + b) / 3
    r = gray + (r - gray) * satBoost
    g = gray + (g - gray) * satBoost
    b = gray + (b - gray) * satBoost

    r = (r - 128) * contrast + 128 + 4
    g = (g - 128) * contrast + 128 + 2
    b = (b - 128) * contrast + 128 - 3

    data[i] = clamp(Math.round(r), 0, 255)
    data[i + 1] = clamp(Math.round(g), 0, 255)
    data[i + 2] = clamp(Math.round(b), 0, 255)
  }
  ctx.putImageData(image, 0, 0)

  const vignette = getStyleParam(styleParams, 'game', 'vignette', 54)
  const vignetteStrength = 0.12 + vignette / 360
  const gradient = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    Math.min(width, height) * 0.2,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.8,
  )
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(1, `rgba(0, 0, 0, ${vignetteStrength.toFixed(3)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

function applyPosterize(ctx, width, height, intensity, styleParams) {
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  const customLevels = getStyleParam(styleParams, 'posterize', 'levels', 6)
  const levels = clamp(Math.round(customLevels - (intensity / 100) * 2), 2, 10)
  const step = 255 / (levels - 1)

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] / step) * step
    data[i + 1] = Math.round(data[i + 1] / step) * step
    data[i + 2] = Math.round(data[i + 2] / step) * step
  }

  ctx.putImageData(image, 0, 0)
}

function applyEmboss(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const target = ctx.createImageData(width, height)
  const src = source.data
  const dst = target.data
  const depth = getStyleParam(styleParams, 'emboss', 'depth', 52)
  const amount = 0.35 + (depth / 100) * 1.8

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4
      const prev = ((y - 1) * width + (x - 1)) * 4
      const next = ((y + 1) * width + (x + 1)) * 4

      for (let c = 0; c < 3; c++) {
        const value = 128 + (src[next + c] - src[prev + c]) * amount
        dst[i + c] = clamp(Math.round(value), 0, 255)
      }
      dst[i + 3] = src[i + 3]
    }
  }

  ctx.putImageData(target, 0, 0)
}

function applyOilPaint(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const target = ctx.createImageData(width, height)
  const src = source.data
  const dst = target.data
  const brush = getStyleParam(styleParams, 'oil_paint', 'brush', 6)
  const radius = clamp(Math.round(1 + brush), 2, 12)
  // 强度越高色阶越少，块面感更明显（此前方向反了）
  const palette = getStyleParam(styleParams, 'oil_paint', 'palette', 10)
  const binsCount = clamp(Math.round(3 + palette), 4, 18)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const counts = new Array(binsCount).fill(0)
      const sumR = new Array(binsCount).fill(0)
      const sumG = new Array(binsCount).fill(0)
      const sumB = new Array(binsCount).fill(0)

      for (let yy = -radius; yy <= radius; yy++) {
        for (let xx = -radius; xx <= radius; xx++) {
          const px = clamp(x + xx, 0, width - 1)
          const py = clamp(y + yy, 0, height - 1)
          const offset = (py * width + px) * 4
          const r = src[offset]
          const g = src[offset + 1]
          const b = src[offset + 2]
          const lum = Math.floor(((r + g + b) / 3 / 255) * (binsCount - 1))

          counts[lum] += 1
          sumR[lum] += r
          sumG[lum] += g
          sumB[lum] += b
        }
      }

      let maxBin = 0
      for (let i = 1; i < binsCount; i++) {
        if (counts[i] > counts[maxBin]) maxBin = i
      }

      const pixelOffset = (y * width + x) * 4
      const divisor = Math.max(1, counts[maxBin])
      const baseR = Math.round(sumR[maxBin] / divisor)
      const baseG = Math.round(sumG[maxBin] / divisor)
      const baseB = Math.round(sumB[maxBin] / divisor)
      const punch = intensity * 0.1
      dst[pixelOffset] = shadeChannel(baseR, punch)
      dst[pixelOffset + 1] = shadeChannel(baseG, punch * 0.25)
      dst[pixelOffset + 2] = shadeChannel(baseB, -punch * 0.2)
      dst[pixelOffset + 3] = src[pixelOffset + 3]
    }
  }

  ctx.putImageData(target, 0, 0)
}

function applyWatercolor(ctx, width, height, intensity, styleParams) {
  const bleed = getStyleParam(styleParams, 'watercolor', 'bleed', 55)
  const blurPx = (bleed / 100) * 2.2
  if (blurPx > 0.1) {
    const snapshot = document.createElement('canvas')
    snapshot.width = width
    snapshot.height = height
    const snapshotCtx = snapshot.getContext('2d')
    if (!snapshotCtx) return
    snapshotCtx.drawImage(ctx.canvas, 0, 0, width, height)

    const wash = getStyleParam(styleParams, 'watercolor', 'wash', 45)
    ctx.filter = `blur(${blurPx.toFixed(2)}px) saturate(${(92 + wash * 0.52).toFixed(1)}%)`
    ctx.drawImage(snapshot, 0, 0, width, height)
    ctx.filter = 'none'
  }

  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  const levels = clamp(Math.round(10 - (intensity / 100) * 4), 5, 10)
  const step = 255 / (levels - 1)

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] / step) * step
    data[i + 1] = Math.round(data[i + 1] / step) * step
    data[i + 2] = Math.round(data[i + 2] / step) * step
  }
  ctx.putImageData(image, 0, 0)
}

function applyHalftone(ctx, width, height, intensity, styleParams) {
  const source = ctx.getImageData(0, 0, width, height)
  const src = source.data
  const dotSize = getStyleParam(styleParams, 'halftone', 'dotSize', 8)
  const block = clamp(Math.round(dotSize), 3, 16)

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#111'

  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      let luminanceTotal = 0
      let count = 0
      for (let yy = y; yy < y + block && yy < height; yy++) {
        for (let xx = x; xx < x + block && xx < width; xx++) {
          const offset = (yy * width + xx) * 4
          const r = src[offset]
          const g = src[offset + 1]
          const b = src[offset + 2]
          luminanceTotal += 0.299 * r + 0.587 * g + 0.114 * b
          count++
        }
      }
      const luminance = count > 0 ? luminanceTotal / count : 255
      const darkness = 1 - luminance / 255
      const radius = (block * 0.5 * darkness * (0.65 + intensity / 200)).toFixed(2)
      if (Number(radius) <= 0.2) continue
      ctx.beginPath()
      ctx.arc(x + block / 2, y + block / 2, Number(radius), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function applyGlass(ctx, width, height, intensity, styleParams) {
  const frost = getStyleParam(styleParams, 'glass', 'frost', 62)
  const refraction = getStyleParam(styleParams, 'glass', 'refraction', 46)

  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const sourceCtx = source.getContext('2d')
  if (!sourceCtx) return
  sourceCtx.drawImage(ctx.canvas, 0, 0, width, height)

  const blurPx = (frost / 100) * 4.8 + (intensity / 100) * 1.2
  ctx.filter = `blur(${blurPx.toFixed(2)}px) saturate(${(96 + frost * 0.28).toFixed(1)}%)`
  ctx.drawImage(source, 0, 0, width, height)
  ctx.filter = 'none'

  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  const jitter = clamp(Math.round(1 + (refraction / 100) * 4), 1, 5)
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const jitterX = clamp(x + Math.round(Math.sin((y + x) * 0.12) * jitter), 0, width - 1)
      const sample = (y * width + jitterX) * 4
      data[offset] = shadeChannel(data[sample], 6)
      data[offset + 1] = data[sample + 1]
      data[offset + 2] = shadeChannel(data[sample + 2], 10)
    }
  }
  ctx.putImageData(image, 0, 0)

  const glare = ctx.createLinearGradient(0, 0, width, height)
  glare.addColorStop(0, `rgba(255,255,255,${(0.08 + frost / 500).toFixed(3)})`)
  glare.addColorStop(0.4, 'rgba(255,255,255,0.02)')
  glare.addColorStop(1, `rgba(180,220,255,${(0.06 + refraction / 800).toFixed(3)})`)
  ctx.fillStyle = glare
  ctx.fillRect(0, 0, width, height)
}

export function applyArtStyleToCanvas(
  ctx,
  width,
  height,
  styleId,
  intensity = 60,
  styleParams = {},
) {
  if (!ctx || styleId === 'none') return
  const safeIntensity = clamp(Number(intensity) || 0, 0, 100)

  if (styleId === 'mosaic') {
    applyMosaic(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'pixel_art') {
    applyPixelArt(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'perler_beads') {
    applyPerlerBeads(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'polyfun') {
    applyPolyFun(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'hand_drawn') {
    applyHandDrawn(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'pencil_sketch') {
    applyPencilSketch(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'eva_style') {
    applyEvaStyle(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'pencilized') {
    applyPencilized(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'mural') {
    applyMural(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'relief_mural') {
    applyReliefMural(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'paper_relief') {
    applyPaperRelief(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'stained_glass') {
    applyStainedGlass(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'oil_paint') {
    applyOilPaint(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'comic') {
    applyComic(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'chibi') {
    applyChibi(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'tech') {
    applyTech(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'game') {
    applyGameStyle(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'watercolor') {
    applyWatercolor(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'posterize') {
    applyPosterize(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'halftone') {
    applyHalftone(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'emboss') {
    applyEmboss(ctx, width, height, safeIntensity, styleParams)
    return
  }
  if (styleId === 'glass') {
    applyGlass(ctx, width, height, safeIntensity, styleParams)
  }
}
