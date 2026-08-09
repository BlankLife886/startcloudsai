/**
 * Quadrant precision refine for UI mockups.
 *
 * Pipeline (hard cross-cut):
 * 1) Split the full image into 4 non-overlapping quadrants with a cross cut
 *    (TL / TR / BL / BR). Every pixel belongs to exactly one tile.
 * 2) Pad each crop to a model-supported aspect (edge-extend) for generation only.
 * 3) Regenerate the 4 padded tiles concurrently (caller).
 * 4) Unpad → align to the original crop → hard-paste back at exact (x, y).
 *
 * Geometry contract: output width/height === source; tile paste is integer and
 * exclusive — no feather blend, no seam shift, no global rescale.
 */

export const TILE_REFINE_OVERLAP_RATIO = 0
export const TILE_REFINE_MIN_OVERLAP = 0
export const TILE_REFINE_MAX_OUTPUT_EDGE = 3840
export const TILE_REFINE_FEATHER_PX = 0
export const TILE_REFINE_GHOST_DELTA = 18
export const TILE_REFINE_ALIGN_SEARCH = 18
export const TILE_REFINE_DETAIL_AMOUNT = 0.92
export const TILE_REFINE_DRIFT_DELTA = 42

const SUPPORTED_ASPECTS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '9:21',
]

export function buildTileRefinePrompt({ quadrantLabel = '', aspectLabel = '' } = {}) {
  const zone = quadrantLabel ? `（${quadrantLabel}）` : ''
  const ratio = aspectLabel ? `输出比例必须严格为 ${aspectLabel}。` : ''
  return [
    `任务类型：UI 设计稿象限高精度精修${zone}。这是整页中的局部切片，不是完整页面，禁止补全切片外的模块。`,
    '输入说明：参考图主体是当前象限 UI；若四周有贴边延展填充，那是为对齐画布比例，不是页面内容，输出时保持相同构图与边距关系。',
    '锁定规则：切片内布局、组件位置/尺寸、间距、圆角、品牌色、图标语义、全部文案必须与参考一致；禁止改版、换肤、新增/删除模块、平移整页内容。',
    '精度强化（核心）：中文与英文字形清晰锐利、无乱码/伪字；小图标与状态点边缘干净；表格线/分割线/图表轴线稳定对齐；禁止模糊、涂抹、重影、重排。',
    '构图约束：线条、卡片边、表格列必须与参考同位置；不要把其他象限的标题/列表/图表拖进本切片。',
    `${ratio}正视图铺满画布；不要手机样机、多页拼贴、设计软件窗口、水印。`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function nearestTileAspectLabel(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w || !h) return '1:1'
  const ratio = w / h
  return (
    SUPPORTED_ASPECTS.map((label) => {
      const [aw, ah] = label.split(':').map(Number)
      return { label, diff: Math.abs(ratio - aw / ah) }
    }).sort((a, b) => a.diff - b.diff)[0]?.label || '1:1'
  )
}

export function planTilePad(tileW, tileH, aspectLabel = nearestTileAspectLabel(tileW, tileH)) {
  const [aw, ah] = String(aspectLabel)
    .split(':')
    .map((part) => Number(part))
  const targetRatio = (aw > 0 ? aw : 1) / (ah > 0 ? ah : 1)
  const srcRatio = tileW / Math.max(1, tileH)
  let padW
  let padH
  let padX
  let padY
  if (srcRatio > targetRatio) {
    padW = tileW
    padH = Math.max(tileH, Math.round(tileW / targetRatio))
    padX = 0
    padY = Math.floor((padH - tileH) / 2)
  } else {
    padH = tileH
    padW = Math.max(tileW, Math.round(tileH * targetRatio))
    padX = Math.floor((padW - tileW) / 2)
    padY = 0
  }
  return {
    aspectLabel,
    padW,
    padH,
    padX,
    padY,
    contentW: tileW,
    contentH: tileH,
  }
}

export function planQuadrantTiles(width, height, _options = {}) {
  const w = Math.max(2, Math.round(Number(width) || 0))
  const h = Math.max(2, Math.round(Number(height) || 0))
  // 十字切：中线取 floor，奇数边留给右/下象限，四块互不重叠且铺满整图。
  const midX = Math.floor(w / 2)
  const midY = Math.floor(h / 2)
  const overlapX = 0
  const overlapY = 0

  const tiles = [
    {
      id: 'tl',
      label: '左上',
      row: 0,
      col: 0,
      x: 0,
      y: 0,
      w: midX,
      h: midY,
    },
    {
      id: 'tr',
      label: '右上',
      row: 0,
      col: 1,
      x: midX,
      y: 0,
      w: w - midX,
      h: midY,
    },
    {
      id: 'bl',
      label: '左下',
      row: 1,
      col: 0,
      x: 0,
      y: midY,
      w: midX,
      h: h - midY,
    },
    {
      id: 'br',
      label: '右下',
      row: 1,
      col: 1,
      x: midX,
      y: midY,
      w: w - midX,
      h: h - midY,
    },
  ]

  return tiles.map((tile) => {
    const aspectLabel = nearestTileAspectLabel(tile.w, tile.h)
    const pad = planTilePad(tile.w, tile.h, aspectLabel)
    return {
      ...tile,
      overlapX,
      overlapY,
      midX,
      midY,
      fullWidth: w,
      fullHeight: h,
      aspectRatio: aspectLabel,
      aspectLabel,
      pad,
    }
  })
}

export function ratioLabel(width, height) {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const g = gcd(w, h)
  return `${Math.round(w / g)}:${Math.round(h / g)}`
}

function gcd(a, b) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return Math.max(1, x)
}

export function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Hard ownership: each pixel belongs to exactly one cross-cut quadrant. */
export function tileOwnershipWeight(px, py, tile, { feather = TILE_REFINE_FEATHER_PX } = {}) {
  if (px < tile.x || py < tile.y || px >= tile.x + tile.w || py >= tile.y + tile.h) return 0
  if (feather > 0) {
    // Optional soft edge retained for diagnostics only; production stitch uses hard paste.
    const midX = tile.midX
    const midY = tile.midY
    const f = Math.max(1, feather)
    let wx = 1
    let wy = 1
    if (tile.col === 0) wx = 1 - smoothstep(midX - f, midX + f, px + 0.5)
    else wx = smoothstep(midX - f, midX + f, px + 0.5)
    if (tile.row === 0) wy = 1 - smoothstep(midY - f, midY + f, py + 0.5)
    else wy = smoothstep(midY - f, midY + f, py + 0.5)
    return Math.max(0, wx * wy)
  }
  return 1
}

/** Legacy helper retained for tests / diagnostics. */
export function tileBlendWeight(px, py, tile) {
  return tileOwnershipWeight(px, py, tile, {
    feather: Math.max(TILE_REFINE_FEATHER_PX, Math.round(Math.min(tile.overlapX, tile.overlapY) * 0.35)),
  })
}

export async function loadImageElement(source) {
  if (typeof createImageBitmap === 'function' && (source instanceof Blob || source instanceof File)) {
    const bitmap = await createImageBitmap(source)
    return bitmap
  }
  const url =
    typeof source === 'string'
      ? source
      : source instanceof Blob || source instanceof File
        ? URL.createObjectURL(source)
        : ''
  if (!url) throw new Error('无法加载图片')
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片解码失败'))
      if (!String(url).startsWith('blob:') && !String(url).startsWith('data:')) {
        img.crossOrigin = 'anonymous'
      }
      img.src = url
    })
    return image
  } finally {
    if (source instanceof Blob || source instanceof File) URL.revokeObjectURL(url)
  }
}

function drawImageToCanvas(image, width, height, { smooth = false } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  if (!ctx) throw new Error('浏览器无法创建画布')
  ctx.imageSmoothingEnabled = smooth
  if (smooth) ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)
  return { canvas, ctx }
}

function edgeExtendFill(ctx, image, pad) {
  const { padW, padH, padX, padY, contentW, contentH } = pad
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(0, 0, padW, padH)
  // Stretch edge strips into pads so the model sees continuous UI chrome, not empty bars.
  if (padY > 0) {
    ctx.drawImage(image, 0, 0, contentW, 1, padX, 0, contentW, padY)
    ctx.drawImage(
      image,
      0,
      contentH - 1,
      contentW,
      1,
      padX,
      padY + contentH,
      contentW,
      padH - padY - contentH,
    )
  }
  if (padX > 0) {
    ctx.drawImage(image, 0, 0, 1, contentH, 0, padY, padX, contentH)
    ctx.drawImage(
      image,
      contentW - 1,
      0,
      1,
      contentH,
      padX + contentW,
      padY,
      padW - padX - contentW,
      contentH,
    )
  }
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image, 0, 0, contentW, contentH, padX, padY, contentW, contentH)
}

export async function cropTileToPngFile(image, tile) {
  const canvas = await cropTileCanvas(image, tile)
  const blob = await canvasToBlob(canvas, 'image/png')
  return new File([blob], `tile-${tile.id}-${tile.w}x${tile.h}.png`, { type: 'image/png' })
}

async function cropTileCanvas(image, tile) {
  const canvas = document.createElement('canvas')
  canvas.width = tile.w
  canvas.height = tile.h
  const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  if (!ctx) throw new Error('浏览器无法创建切图画布')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h)
  return canvas
}

export async function preparePaddedTileFile(image, tile) {
  const pad = tile.pad || planTilePad(tile.w, tile.h, tile.aspectLabel || tile.aspectRatio)
  const crop = await cropTileCanvas(image, tile)
  const canvas = document.createElement('canvas')
  canvas.width = pad.padW
  canvas.height = pad.padH
  const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  if (!ctx) throw new Error('浏览器无法创建填充画布')
  edgeExtendFill(ctx, crop, pad)
  const blob = await canvasToBlob(canvas, 'image/png')
  return {
    tile,
    pad,
    cropCanvas: crop,
    file: new File([blob], `tile-pad-${tile.id}-${pad.padW}x${pad.padH}.png`, {
      type: 'image/png',
    }),
  }
}

export async function extractQuadrantTileFiles(imageOrBlob, options = {}) {
  const image = await loadImageElement(imageOrBlob)
  try {
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    const tiles = planQuadrantTiles(width, height, options)
    const files = []
    for (const tile of tiles) {
      const prepared = await preparePaddedTileFile(image, tile)
      const cropBlob = await canvasToBlob(prepared.cropCanvas, 'image/png')
      files.push({
        tile,
        pad: prepared.pad,
        file: prepared.file,
        cropFile: new File([cropBlob], `tile-crop-${tile.id}.png`, { type: 'image/png' }),
      })
    }
    return {
      width,
      height,
      tiles,
      files,
      overlapX: tiles[0]?.overlapX || 0,
      overlapY: tiles[0]?.overlapY || 0,
    }
  } finally {
    if (typeof image.close === 'function') image.close()
  }
}

/**
 * Map a regenerated padded image back to the exact tile crop rectangle.
 */
export async function normalizeRegeneratedTile(regenerated, tile, options = {}) {
  const pad = tile.pad || options.pad || planTilePad(tile.w, tile.h, tile.aspectLabel)
  const image = await loadImageElement(regenerated)
  try {
    const iw = image.naturalWidth || image.width
    const ih = image.naturalHeight || image.height
    // 必须回到原切块整数尺寸，才能按坐标硬贴且与原图零几何误差。
    const outW = Math.max(1, tile.w)
    const outH = Math.max(1, tile.h)
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
    if (!ctx) throw new Error('浏览器无法创建回裁画布')

    // 已是内容尺寸（未 pad）时直接拷贝，避免错误按 pad 比例取样。
    const alreadyContentSized = iw === outW && ih === outH
    let sx = 0
    let sy = 0
    let sw = iw
    let sh = ih
    if (!alreadyContentSized) {
      const scaleX = iw / Math.max(1, pad.padW)
      const scaleY = ih / Math.max(1, pad.padH)
      sx = pad.padX * scaleX
      sy = pad.padY * scaleY
      sw = pad.contentW * scaleX
      sh = pad.contentH * scaleY
    }
    const needsResample =
      !alreadyContentSized &&
      (Math.abs(sw - outW) > 0.01 ||
        Math.abs(sh - outH) > 0.01 ||
        Math.abs(sx) > 0.01 ||
        Math.abs(sy) > 0.01)
    ctx.imageSmoothingEnabled = needsResample
    if (needsResample) ctx.imageSmoothingQuality = 'high'
    else ctx.imageSmoothingEnabled = false
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH)

    let shiftX = 0
    let shiftY = 0
    let outputCanvas = canvas
    let structureCanvas = null
    if (options.originalCrop) {
      const original =
        options.originalCrop instanceof HTMLCanvasElement
          ? options.originalCrop
          : await (async () => {
              const src = await loadImageElement(options.originalCrop)
              try {
                return drawImageToCanvas(src, tile.w, tile.h, { smooth: false }).canvas
              } finally {
                if (typeof src.close === 'function') src.close()
              }
            })()
      structureCanvas =
        original.width === outW && original.height === outH
          ? original
          : drawImageToCanvas(original, outW, outH, { smooth: false }).canvas
      const aligned = alignCanvasToReference(canvas, structureCanvas, {
        search: Math.max(4, options.alignSearch ?? TILE_REFINE_ALIGN_SEARCH),
      })
      shiftX = aligned.shiftX
      shiftY = aligned.shiftY
      if (Math.abs(shiftX) > 0.02 || Math.abs(shiftY) > 0.02) {
        const shifted = document.createElement('canvas')
        shifted.width = outW
        shifted.height = outH
        const sctx = shifted.getContext('2d', { alpha: false, colorSpace: 'srgb' })
        if (!sctx) throw new Error('浏览器无法创建对齐画布')
        sctx.imageSmoothingEnabled = Math.abs(shiftX % 1) > 0.001 || Math.abs(shiftY % 1) > 0.001
        if (sctx.imageSmoothingEnabled) sctx.imageSmoothingQuality = 'high'
        // 先铺原结构，再反向平移重绘，避免边缘空像素引入色差。
        sctx.drawImage(structureCanvas, 0, 0)
        sctx.drawImage(canvas, -shiftX, -shiftY)
        outputCanvas = shifted
      }
    }

    // Prefer regenerated pixels so the refine is visible; only pull original back
    // where regenerate invents clearly divergent content (ghost / wrong glyphs).
    if (structureCanvas && options.fuseDetail !== false) {
      outputCanvas = fuseDetailOntoStructure(structureCanvas, outputCanvas, {
        amount: options.detailAmount ?? TILE_REFINE_DETAIL_AMOUNT,
        driftDelta: options.driftDelta ?? TILE_REFINE_DRIFT_DELTA,
      })
    }

    const outCtx = outputCanvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
    return {
      canvas: outputCanvas,
      shiftX,
      shiftY,
      nativeScale: 1,
      imageData: outCtx.getImageData(0, 0, outW, outH),
    }
  } finally {
    if (typeof image.close === 'function') image.close()
  }
}

/**
 * Prefer regenerate (`detailCanvas`); blend back toward original (`structureCanvas`)
 * only where regenerate drifts hard (hallucinated glyphs / wrong modules).
 */
export function fuseDetailOntoStructure(
  structureCanvas,
  detailCanvas,
  { amount = TILE_REFINE_DETAIL_AMOUNT, driftDelta = TILE_REFINE_DRIFT_DELTA } = {},
) {
  const w = structureCanvas.width
  const h = structureCanvas.height
  if (!w || !h || detailCanvas.width !== w || detailCanvas.height !== h) return detailCanvas

  const sctx = structureCanvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  const dctx = detailCanvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  if (!sctx || !dctx) return detailCanvas
  const structure = sctx.getImageData(0, 0, w, h)
  const detail = dctx.getImageData(0, 0, w, h)
  // 低频漂移检测：模糊后再比较，把「笔画变清晰」（高频变化）和
  // 「内容被改写/幻觉」（低频变化）区分开，后者必须完全回退原图。
  const structureBase = boxBlurImageData(structure, 2)
  const detailBase = boxBlurImageData(detail, 2)
  const out = dctx.createImageData(w, h)
  const pull = Math.max(0, Math.min(1, amount))
  const lo = Math.max(1, driftDelta * (1 - 0.5 * pull))
  const hi = Math.max(lo + 1, driftDelta * 1.5)

  for (let i = 0; i < out.data.length; i += 4) {
    const drift = Math.max(
      Math.abs(detailBase.data[i] - structureBase.data[i]),
      Math.abs(detailBase.data[i + 1] - structureBase.data[i + 1]),
      Math.abs(detailBase.data[i + 2] - structureBase.data[i + 2]),
    )
    let towardOriginal = 0
    if (drift > lo) {
      const t = Math.min(1, (drift - lo) / (hi - lo))
      // smoothstep：轻度漂移保留重绘细节，重度漂移 100% 回退原结构（防幻觉/重影）。
      towardOriginal = t * t * (3 - 2 * t)
    }
    for (let c = 0; c < 3; c += 1) {
      out.data[i + c] = clampByte(
        detail.data[i + c] * (1 - towardOriginal) + structure.data[i + c] * towardOriginal,
      )
    }
    out.data[i + 3] = 255
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  if (!ctx) return detailCanvas
  ctx.putImageData(out, 0, 0)
  return canvas
}

function boxBlurImageData(source, radius = 1) {
  const w = source.width
  const h = source.height
  const src = source.data
  const tmp = new Uint8ClampedArray(src.length)
  const out = new ImageData(w, h)
  const r = Math.max(1, Math.round(radius))
  const window = r * 2 + 1

  for (let y = 0; y < h; y += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0
      for (let kx = -r; kx <= r; kx += 1) {
        const x = Math.min(w - 1, Math.max(0, kx))
        sum += src[(y * w + x) * 4 + c]
      }
      for (let x = 0; x < w; x += 1) {
        tmp[(y * w + x) * 4 + c] = Math.round(sum / window)
        const leave = Math.min(w - 1, Math.max(0, x - r))
        const add = Math.min(w - 1, Math.max(0, x + r + 1))
        sum += src[(y * w + add) * 4 + c] - src[(y * w + leave) * 4 + c]
      }
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0
      for (let ky = -r; ky <= r; ky += 1) {
        const y = Math.min(h - 1, Math.max(0, ky))
        sum += tmp[(y * w + x) * 4 + c]
      }
      for (let y = 0; y < h; y += 1) {
        out.data[(y * w + x) * 4 + c] = Math.round(sum / window)
        const leave = Math.min(h - 1, Math.max(0, y - r))
        const add = Math.min(h - 1, Math.max(0, y + r + 1))
        sum += tmp[(add * w + x) * 4 + c] - tmp[(leave * w + x) * 4 + c]
      }
    }
  }
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
  return out
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function unsharpMaskCanvas(sourceCanvas, { amount = 0.35, radius = 1 } = {}) {
  const w = sourceCanvas.width
  const h = sourceCanvas.height
  const ctx = sourceCanvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  if (!ctx || !w || !h) return sourceCanvas
  const src = ctx.getImageData(0, 0, w, h)
  const blur = boxBlurImageData(src, radius)
  const out = ctx.createImageData(w, h)
  const strength = Math.max(0, Math.min(1.5, amount))
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      out.data[i + c] = clampByte(src.data[i + c] + (src.data[i + c] - blur.data[i + c]) * strength)
    }
    out.data[i + 3] = 255
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const octx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  if (!octx) return sourceCanvas
  octx.putImageData(out, 0, 0)
  return canvas
}

/**
 * 两级对齐：缩略图粗搜 → 全分辨率整像素精搜 → 抛物线拟合亚像素偏移。
 * 返回浮点 shift（候选图相对参考图的偏移量，单位 px）。
 */
export function alignCanvasToReference(candidateCanvas, referenceCanvas, { search = TILE_REFINE_ALIGN_SEARCH } = {}) {
  const w = referenceCanvas.width
  const h = referenceCanvas.height
  if (!w || !h || candidateCanvas.width !== w || candidateCanvas.height !== h) {
    return { shiftX: 0, shiftY: 0, score: 0 }
  }

  // 1) 粗搜：缩到 ≤420px 快速定位大致偏移。
  const scale = Math.max(w, h) > 420 ? 420 / Math.max(w, h) : 1
  const rw = Math.max(16, Math.round(w * scale))
  const rh = Math.max(16, Math.round(h * scale))
  const refCoarse = downscaleLuma(referenceCanvas, rw, rh)
  const candCoarse = downscaleLuma(candidateCanvas, rw, rh)
  const maxShift = Math.max(2, Math.round(search * scale) || 2)
  let coarse = { dx: 0, dy: 0, score: -Infinity }
  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      const score = nccLuma(refCoarse, candCoarse, rw, rh, dx, dy)
      if (score > coarse.score) coarse = { dx, dy, score }
    }
  }
  const cx = Math.round(coarse.dx / Math.max(scale, 1e-6))
  const cy = Math.round(coarse.dy / Math.max(scale, 1e-6))

  // 2) 全分辨率整像素精搜（隔行采样控制耗时）。
  const refFull = downscaleLuma(referenceCanvas, w, h)
  const candFull = downscaleLuma(candidateCanvas, w, h)
  const stride = Math.max(1, Math.floor(Math.max(w, h) / 480))
  const fineRadius = Math.max(2, Math.ceil(1 / Math.max(scale, 0.05)) + 1)
  const scores = new Map()
  const scoreAt = (dx, dy) => {
    const key = `${dx}:${dy}`
    if (!scores.has(key)) scores.set(key, nccLuma(refFull, candFull, w, h, dx, dy, stride))
    return scores.get(key)
  }
  let best = { dx: cx, dy: cy, score: scoreAt(cx, cy) }
  for (let dy = cy - fineRadius; dy <= cy + fineRadius; dy += 1) {
    for (let dx = cx - fineRadius; dx <= cx + fineRadius; dx += 1) {
      const score = scoreAt(dx, dy)
      if (score > best.score) best = { dx, dy, score }
    }
  }

  // 3) 亚像素：NCC 峰值抛物线拟合，精度 ~0.1px。
  const subFit = (minus, center, plus) => {
    const denom = minus - 2 * center + plus
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) return 0
    return Math.max(-0.5, Math.min(0.5, (0.5 * (minus - plus)) / denom))
  }
  const subX = subFit(scoreAt(best.dx - 1, best.dy), best.score, scoreAt(best.dx + 1, best.dy))
  const subY = subFit(scoreAt(best.dx, best.dy - 1), best.score, scoreAt(best.dx, best.dy + 1))
  return {
    shiftX: Number((best.dx + subX).toFixed(3)),
    shiftY: Number((best.dy + subY).toFixed(3)),
    score: best.score,
  }
}

function downscaleLuma(sourceCanvas, width, height) {
  const { canvas, ctx } = drawImageToCanvas(sourceCanvas, width, height, { smooth: true })
  const data = ctx.getImageData(0, 0, width, height).data
  const luma = new Float32Array(width * height)
  for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) {
    luma[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114
  }
  canvas.width = 0
  canvas.height = 0
  return luma
}

function nccLuma(ref, cand, width, height, dx, dy, stride = 1) {
  let sumR = 0
  let sumC = 0
  let sumRR = 0
  let sumCC = 0
  let sumRC = 0
  let n = 0
  const step = Math.max(1, Math.round(stride))
  for (let y = 0; y < height; y += step) {
    const sy = y + dy
    if (sy < 0 || sy >= height) continue
    for (let x = 0; x < width; x += step) {
      const sx = x + dx
      if (sx < 0 || sx >= width) continue
      const r = ref[y * width + x]
      const c = cand[sy * width + sx]
      sumR += r
      sumC += c
      sumRR += r * r
      sumCC += c * c
      sumRC += r * c
      n += 1
    }
  }
  if (n < 16) return -Infinity
  const meanR = sumR / n
  const meanC = sumC / n
  const varR = sumRR - n * meanR * meanR
  const varC = sumCC - n * meanC * meanC
  if (varR <= 1e-3 || varC <= 1e-3) return -Infinity
  return (sumRC - n * meanR * meanC) / Math.sqrt(varR * varC)
}

/**
 * Hard-paste regenerated tiles onto a canvas matching the source size.
 * Cross-cut tiles are exclusive — no blend, no rescale, no sharpen.
 */
export async function stitchQuadrantTiles({
  tiles,
  tileImages,
  originalCrops,
  fullWidth,
  fullHeight,
} = {}) {
  if (!tiles?.length) throw new Error('缺少切图方案')
  const outW = Math.max(1, Math.round(Number(fullWidth) || tiles[0].fullWidth || 0))
  const outH = Math.max(1, Math.round(Number(fullHeight) || tiles[0].fullHeight || 0))
  if (!outW || !outH) throw new Error('缺少原图尺寸')

  // Coverage / exclusivity check — reject any plan that would leave holes or overlaps.
  const covered = new Uint8Array(outW * outH)
  for (const tile of tiles) {
    if (tile.x < 0 || tile.y < 0 || tile.x + tile.w > outW || tile.y + tile.h > outH) {
      throw new Error(`切块 ${tile.id} 超出原图范围`)
    }
    for (let y = tile.y; y < tile.y + tile.h; y += 1) {
      for (let x = tile.x; x < tile.x + tile.w; x += 1) {
        const idx = y * outW + x
        if (covered[idx]) throw new Error(`切块重叠于 (${x},${y})，无法保证零误差拼接`)
        covered[idx] = 1
      }
    }
  }
  for (let i = 0; i < covered.length; i += 1) {
    if (!covered[i]) throw new Error('切块未铺满原图，无法保证零误差拼接')
  }

  const normalized = []
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index]
    const raw = Array.isArray(tileImages)
      ? tileImages[index]
      : tileImages?.[tile.id] || tileImages?.get?.(tile.id)
    if (!raw) throw new Error(`缺少 ${tile.label || tile.id} 精修结果`)
    const originalCrop = Array.isArray(originalCrops)
      ? originalCrops[index]
      : originalCrops?.[tile.id] || originalCrops?.get?.(tile.id)
    const result = await normalizeRegeneratedTile(raw, tile, { originalCrop })
    if (result.canvas.width !== tile.w || result.canvas.height !== tile.h) {
      throw new Error(`${tile.label || tile.id} 尺寸与切块不一致`)
    }
    normalized.push({ tile, ...result })
  }

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })
  if (!ctx) throw new Error('浏览器无法创建拼接画布')
  ctx.imageSmoothingEnabled = false

  for (const entry of normalized) {
    const { tile, canvas: sourceCanvas } = entry
    ctx.drawImage(sourceCanvas, 0, 0, tile.w, tile.h, tile.x, tile.y, tile.w, tile.h)
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
      else setTimeout(resolve, 0)
    })
  }

  const blob = await canvasToBlob(canvas, 'image/png')
  return {
    blob,
    width: outW,
    height: outH,
    scale: 1,
    shifts: normalized.map((entry) => ({
      id: entry.tile.id,
      shiftX: entry.shiftX,
      shiftY: entry.shiftY,
    })),
    file: new File([blob], `tile-refine-${outW}x${outH}.png`, { type: 'image/png' }),
  }
}

export function resolveTileOutputLongSide(tile, { maxEdge = TILE_REFINE_MAX_OUTPUT_EDGE } = {}) {
  const pad = tile.pad || planTilePad(tile.w, tile.h, tile.aspectLabel || tile.aspectRatio)
  const long = Math.max(pad.padW, pad.padH)
  // Aim ~2× source tile pixels so small text gets headroom after unpad.
  return Math.max(2048, Math.min(maxEdge, Math.round(long * 2)))
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('画布导出失败'))
        else resolve(blob)
      },
      type,
      quality,
    )
  })
}
