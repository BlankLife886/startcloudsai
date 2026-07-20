/**
 * AI 拼图领域层：模板库、画布/背景/滤镜预设、以及与预览完全一致的导出引擎。
 *
 * 坐标系约定：
 * - 模板单元格 x/y/w/h 均为 0–1 相对值。
 * - gap / radius / padding 以「基准画布宽 BASE_BOARD_WIDTH」为参照的像素值，
 *   预览与导出都按各自实际宽度等比换算，保证所见即所得。
 */

export const BASE_BOARD_WIDTH = 680

export const COLLAGE_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'basic', label: '基础' },
  { id: 'social', label: '社交' },
  { id: 'story', label: '竖版' },
  { id: 'wide', label: '横版' },
  { id: 'mosaic', label: '照片墙' },
]

export const RATIO_PRESETS = [
  { id: 'auto', label: '模板默认', value: 0 },
  { id: 'r1x1', label: '1:1', value: 1 },
  { id: 'r4x3', label: '4:3', value: 4 / 3 },
  { id: 'r3x4', label: '3:4', value: 3 / 4 },
  { id: 'r16x9', label: '16:9', value: 16 / 9 },
  { id: 'r9x16', label: '9:16', value: 9 / 16 },
  { id: 'r3x2', label: '3:2', value: 3 / 2 },
  { id: 'r21x9', label: '21:9', value: 21 / 9 },
]

export const BACKGROUND_PRESETS = [
  { id: 'white', label: '纯白', type: 'solid', color: '#ffffff' },
  { id: 'black', label: '暗夜', type: 'solid', color: '#0b0b10' },
  { id: 'slate', label: '石板', type: 'solid', color: '#1e293b' },
  { id: 'cream', label: '米杏', type: 'solid', color: '#f5efe4' },
  {
    id: 'sunset',
    label: '落日',
    type: 'linear',
    angle: 135,
    stops: [
      ['#fda4af', 0],
      ['#fbbf24', 1],
    ],
  },
  {
    id: 'ocean',
    label: '海雾',
    type: 'linear',
    angle: 160,
    stops: [
      ['#38bdf8', 0],
      ['#312e81', 1],
    ],
  },
  {
    id: 'violet',
    label: '暮紫',
    type: 'linear',
    angle: 130,
    stops: [
      ['#c4b5fd', 0],
      ['#7c3aed', 1],
    ],
  },
  {
    id: 'mint',
    label: '青屿',
    type: 'linear',
    angle: 150,
    stops: [
      ['#a7f3d0', 0],
      ['#0e7490', 1],
    ],
  },
]

/**
 * 滤镜以参数对象描述（顺序固定：grayscale → sepia → saturate → contrast → brightness），
 * 预览用 CSS filter，导出优先 ctx.filter，不支持时退化为逐像素处理，两端语义一致。
 */
export const FILTER_PRESETS = [
  { id: 'none', label: '原图', params: {} },
  { id: 'mono', label: '黑白', params: { grayscale: 1, contrast: 1.06 } },
  { id: 'warm', label: '暖阳', params: { sepia: 0.32, saturate: 1.18, brightness: 1.04 } },
  { id: 'cool', label: '冷调', params: { saturate: 0.86, contrast: 1.05, brightness: 1.02 } },
  { id: 'vivid', label: '浓郁', params: { saturate: 1.45, contrast: 1.1 } },
  { id: 'soft', label: '奶油', params: { saturate: 0.92, contrast: 0.94, brightness: 1.08 } },
  { id: 'film', label: '胶片', params: { sepia: 0.18, saturate: 1.08, contrast: 1.12, brightness: 0.98 } },
]

export const TEXT_POSITIONS = [
  { id: 'top', label: '顶部' },
  { id: 'center', label: '居中' },
  { id: 'bottom', label: '底部' },
]

export const COLLAGE_TEMPLATES = [
  {
    id: 'split-h2',
    name: '左右双图',
    category: 'basic',
    tags: ['简约'],
    ratio: 1,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.5, h: 1 },
      { id: 'b', x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: 'split-v2',
    name: '上下双图',
    category: 'basic',
    tags: ['简约'],
    ratio: 1,
    cells: [
      { id: 'a', x: 0, y: 0, w: 1, h: 0.5 },
      { id: 'b', x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: 'grid-4',
    name: '四宫格',
    category: 'basic',
    tags: ['社交', '简约'],
    ratio: 1,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.5, h: 0.5 },
      { id: 'b', x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { id: 'c', x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { id: 'd', x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: 'grid-6',
    name: '六格矩阵',
    category: 'basic',
    ratio: 1,
    cells: [
      { id: 'a', x: 0, y: 0, w: 1 / 3, h: 0.5 },
      { id: 'b', x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 },
      { id: 'c', x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
      { id: 'd', x: 0, y: 0.5, w: 1 / 3, h: 0.5 },
      { id: 'e', x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
      { id: 'f', x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
    ],
  },
  {
    id: 'grid-9',
    name: '九宫格',
    category: 'social',
    tags: ['社交'],
    ratio: 1,
    cells: Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      x: (i % 3) / 3,
      y: Math.floor(i / 3) / 3,
      w: 1 / 3,
      h: 1 / 3,
    })),
  },
  {
    id: 'grid-8',
    name: '八格双排',
    category: 'wide',
    ratio: 16 / 9,
    cells: Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      x: (i % 4) / 4,
      y: Math.floor(i / 4) / 2,
      w: 1 / 4,
      h: 1 / 2,
    })),
  },
  {
    id: 'hero-left',
    name: '大图 + 双列',
    category: 'mosaic',
    ratio: 4 / 3,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.62, h: 1 },
      { id: 'b', x: 0.62, y: 0, w: 0.38, h: 0.5 },
      { id: 'c', x: 0.62, y: 0.5, w: 0.38, h: 0.5 },
    ],
  },
  {
    id: 'hero-right',
    name: '双列 + 大图',
    category: 'mosaic',
    ratio: 4 / 3,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.38, h: 0.5 },
      { id: 'b', x: 0, y: 0.5, w: 0.38, h: 0.5 },
      { id: 'c', x: 0.38, y: 0, w: 0.62, h: 1 },
    ],
  },
  {
    id: 'hero-top',
    name: '上大下三',
    category: 'mosaic',
    ratio: 4 / 3,
    cells: [
      { id: 'a', x: 0, y: 0, w: 1, h: 0.55 },
      { id: 'b', x: 0, y: 0.55, w: 1 / 3, h: 0.45 },
      { id: 'c', x: 1 / 3, y: 0.55, w: 1 / 3, h: 0.45 },
      { id: 'd', x: 2 / 3, y: 0.55, w: 1 / 3, h: 0.45 },
    ],
  },
  {
    id: 'pin-5',
    name: '瀑布五格',
    category: 'mosaic',
    ratio: 3 / 4,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.5, h: 0.42 },
      { id: 'b', x: 0.5, y: 0, w: 0.5, h: 0.62 },
      { id: 'c', x: 0, y: 0.42, w: 0.5, h: 0.28 },
      { id: 'd', x: 0, y: 0.7, w: 0.5, h: 0.3 },
      { id: 'e', x: 0.5, y: 0.62, w: 0.5, h: 0.38 },
    ],
  },
  {
    id: 'stack-2-3',
    name: '双列瀑布',
    category: 'mosaic',
    ratio: 3 / 4,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.5, h: 0.5 },
      { id: 'b', x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { id: 'c', x: 0.5, y: 0, w: 0.5, h: 1 / 3 },
      { id: 'd', x: 0.5, y: 1 / 3, w: 0.5, h: 1 / 3 },
      { id: 'e', x: 0.5, y: 2 / 3, w: 0.5, h: 1 / 3 },
    ],
  },
  {
    id: 'diag-4',
    name: '错位四格',
    category: 'mosaic',
    ratio: 1,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.6, h: 0.5 },
      { id: 'b', x: 0.6, y: 0, w: 0.4, h: 0.5 },
      { id: 'c', x: 0, y: 0.5, w: 0.4, h: 0.5 },
      { id: 'd', x: 0.4, y: 0.5, w: 0.6, h: 0.5 },
    ],
  },
  {
    id: 'mix-6',
    name: '主次六格',
    category: 'mosaic',
    ratio: 1,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.5, h: 0.5 },
      { id: 'b', x: 0.5, y: 0, w: 0.25, h: 0.5 },
      { id: 'c', x: 0.75, y: 0, w: 0.25, h: 0.5 },
      { id: 'd', x: 0, y: 0.5, w: 0.25, h: 0.5 },
      { id: 'e', x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
      { id: 'f', x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: 'story-3',
    name: '竖版三格',
    category: 'story',
    tags: ['竖版'],
    ratio: 9 / 16,
    cells: [
      { id: 'a', x: 0, y: 0, w: 1, h: 0.34 },
      { id: 'b', x: 0, y: 0.34, w: 1, h: 0.33 },
      { id: 'c', x: 0, y: 0.67, w: 1, h: 0.33 },
    ],
  },
  {
    id: 'story-full',
    name: '竖版双拼',
    category: 'story',
    ratio: 9 / 16,
    cells: [
      { id: 'a', x: 0, y: 0, w: 1, h: 0.5 },
      { id: 'b', x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: 'story-mosaic',
    name: '竖版主图墙',
    category: 'story',
    ratio: 9 / 16,
    cells: [
      { id: 'a', x: 0, y: 0, w: 1, h: 0.5 },
      { id: 'b', x: 0, y: 0.5, w: 0.5, h: 0.25 },
      { id: 'c', x: 0.5, y: 0.5, w: 0.5, h: 0.25 },
      { id: 'd', x: 0, y: 0.75, w: 0.5, h: 0.25 },
      { id: 'e', x: 0.5, y: 0.75, w: 0.5, h: 0.25 },
    ],
  },
  {
    id: 'wide-banner',
    name: '横版横幅',
    category: 'wide',
    tags: ['横版'],
    ratio: 21 / 9,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.35, h: 1 },
      { id: 'b', x: 0.35, y: 0, w: 0.3, h: 1 },
      { id: 'c', x: 0.65, y: 0, w: 0.35, h: 1 },
    ],
  },
  {
    id: 'wide-4',
    name: '横版四联',
    category: 'wide',
    ratio: 16 / 9,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.25, h: 1 },
      { id: 'b', x: 0.25, y: 0, w: 0.25, h: 1 },
      { id: 'c', x: 0.5, y: 0, w: 0.25, h: 1 },
      { id: 'd', x: 0.75, y: 0, w: 0.25, h: 1 },
    ],
  },
  {
    id: 'one-three',
    name: '一主三副',
    category: 'social',
    ratio: 1,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.65, h: 1 },
      { id: 'b', x: 0.65, y: 0, w: 0.35, h: 1 / 3 },
      { id: 'c', x: 0.65, y: 1 / 3, w: 0.35, h: 1 / 3 },
      { id: 'd', x: 0.65, y: 2 / 3, w: 0.35, h: 1 / 3 },
    ],
  },
  {
    id: 'cross',
    name: '十字焦点',
    category: 'mosaic',
    ratio: 1,
    cells: [
      { id: 'a', x: 0, y: 0, w: 0.33, h: 0.33 },
      { id: 'b', x: 0.33, y: 0, w: 0.34, h: 0.33 },
      { id: 'c', x: 0.67, y: 0, w: 0.33, h: 0.33 },
      { id: 'd', x: 0, y: 0.33, w: 0.33, h: 0.34 },
      { id: 'e', x: 0.33, y: 0.33, w: 0.34, h: 0.34 },
      { id: 'f', x: 0.67, y: 0.33, w: 0.33, h: 0.34 },
      { id: 'g', x: 0, y: 0.67, w: 0.33, h: 0.33 },
      { id: 'h', x: 0.33, y: 0.67, w: 0.34, h: 0.33 },
      { id: 'i', x: 0.67, y: 0.67, w: 0.33, h: 0.33 },
    ],
  },
  {
    id: 'film-3',
    name: '胶片三帧',
    category: 'wide',
    ratio: 3 / 2,
    cells: [
      { id: 'a', x: 0.02, y: 0.08, w: 0.3, h: 0.84 },
      { id: 'b', x: 0.35, y: 0.08, w: 0.3, h: 0.84 },
      { id: 'c', x: 0.68, y: 0.08, w: 0.3, h: 0.84 },
    ],
  },
]

export function getTemplateById(id) {
  return COLLAGE_TEMPLATES.find((item) => item.id === id) || COLLAGE_TEMPLATES[0]
}

export function getRatioPresetById(id) {
  return RATIO_PRESETS.find((item) => item.id === id) || RATIO_PRESETS[0]
}

export function getBackgroundPresetById(id) {
  return BACKGROUND_PRESETS.find((item) => item.id === id) || BACKGROUND_PRESETS[0]
}

export function getFilterPresetById(id) {
  return FILTER_PRESETS.find((item) => item.id === id) || FILTER_PRESETS[0]
}

export function filterTemplates(categoryId, keyword = '') {
  const q = String(keyword || '').trim().toLowerCase()
  return COLLAGE_TEMPLATES.filter((item) => {
    if (categoryId !== 'all' && item.category !== categoryId) return false
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) ||
      item.tags?.some((tag) => tag.toLowerCase().includes(q))
    )
  })
}

/** 根据图片数量推荐模板 */
export function recommendTemplate(count) {
  if (count <= 2) return getTemplateById('split-h2')
  if (count === 3) return getTemplateById('hero-left')
  if (count === 4) return getTemplateById('grid-4')
  if (count === 5) return getTemplateById('pin-5')
  if (count === 6) return getTemplateById('mix-6')
  if (count <= 8) return getTemplateById('grid-8')
  return getTemplateById('grid-9')
}

/** 解析画布实际比例（ratioId = auto 时用模板默认值） */
export function resolveBoardRatio(template, ratioId = 'auto') {
  const preset = getRatioPresetById(ratioId)
  if (preset.value > 0) return preset.value
  return template?.ratio || 1
}

// ---------------------------------------------------------------------------
// 滤镜：CSS 字符串（预览 / ctx.filter）与像素级退化处理保持同一语义
// ---------------------------------------------------------------------------

export function buildFilterCss(params = {}) {
  const parts = []
  if (params.grayscale) parts.push(`grayscale(${params.grayscale})`)
  if (params.sepia) parts.push(`sepia(${params.sepia})`)
  if (params.saturate !== undefined && params.saturate !== 1) {
    parts.push(`saturate(${params.saturate})`)
  }
  if (params.contrast !== undefined && params.contrast !== 1) {
    parts.push(`contrast(${params.contrast})`)
  }
  if (params.brightness !== undefined && params.brightness !== 1) {
    parts.push(`brightness(${params.brightness})`)
  }
  return parts.length ? parts.join(' ') : 'none'
}

function applyPixelFilter(imageData, params = {}) {
  const data = imageData.data
  const grayscale = Number(params.grayscale || 0)
  const sepia = Number(params.sepia || 0)
  const saturate = params.saturate === undefined ? 1 : Number(params.saturate)
  const contrast = params.contrast === undefined ? 1 : Number(params.contrast)
  const brightness = params.brightness === undefined ? 1 : Number(params.brightness)

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    if (grayscale > 0) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r += (luma - r) * grayscale
      g += (luma - g) * grayscale
      b += (luma - b) * grayscale
    }

    if (sepia > 0) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b
      const sg = 0.349 * r + 0.686 * g + 0.168 * b
      const sb = 0.272 * r + 0.534 * g + 0.131 * b
      r += (sr - r) * sepia
      g += (sg - g) * sepia
      b += (sb - b) * sepia
    }

    if (saturate !== 1) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = luma + (r - luma) * saturate
      g = luma + (g - luma) * saturate
      b = luma + (b - luma) * saturate
    }

    if (contrast !== 1) {
      r = (r - 127.5) * contrast + 127.5
      g = (g - 127.5) * contrast + 127.5
      b = (b - 127.5) * contrast + 127.5
    }

    if (brightness !== 1) {
      r *= brightness
      g *= brightness
      b *= brightness
    }

    data[i] = Math.max(0, Math.min(255, r))
    data[i + 1] = Math.max(0, Math.min(255, g))
    data[i + 2] = Math.max(0, Math.min(255, b))
  }
  return imageData
}

function hasFilterParams(params = {}) {
  return buildFilterCss(params) !== 'none'
}

// ---------------------------------------------------------------------------
// 背景：预览 CSS 与导出 canvas 填充保持一致
// ---------------------------------------------------------------------------

export function buildBackgroundCss(background) {
  if (!background) return '#ffffff'
  if (background.type === 'linear' && Array.isArray(background.stops)) {
    const stops = background.stops
      .map(([color, offset]) => `${color} ${Math.round(offset * 100)}%`)
      .join(', ')
    return `linear-gradient(${background.angle || 135}deg, ${stops})`
  }
  return background.color || '#ffffff'
}

function fillBackground(ctx, background, width, height) {
  if (background?.type === 'linear' && Array.isArray(background.stops)) {
    // CSS 线性渐变角度：0deg 朝上、90deg 朝右
    const angle = ((background.angle || 135) * Math.PI) / 180
    const dirX = Math.sin(angle)
    const dirY = -Math.cos(angle)
    const lineLength = Math.abs(width * dirX) + Math.abs(height * dirY)
    const cx = width / 2
    const cy = height / 2
    const gradient = ctx.createLinearGradient(
      cx - (dirX * lineLength) / 2,
      cy - (dirY * lineLength) / 2,
      cx + (dirX * lineLength) / 2,
      cy + (dirY * lineLength) / 2,
    )
    background.stops.forEach(([color, offset]) => {
      gradient.addColorStop(Math.max(0, Math.min(1, offset)), color)
    })
    ctx.fillStyle = gradient
  } else {
    ctx.fillStyle = background?.color || '#ffffff'
  }
  ctx.fillRect(0, 0, width, height)
}

// ---------------------------------------------------------------------------
// 布局几何：预览与导出共用同一套计算
// ---------------------------------------------------------------------------

/**
 * 计算某个单元格在画布上的矩形（px）。
 * @param cell 模板格子（相对坐标）
 * @param boardW/boardH 画布尺寸 px
 * @param gap 格间距（已按画布宽换算的 px）
 * @param padding 画布外边距（同上）
 */
export function computeCellRect(cell, boardW, boardH, gap, padding) {
  const innerW = boardW - padding * 2
  const innerH = boardH - padding * 2
  return {
    x: padding + cell.x * innerW + gap / 2,
    y: padding + cell.y * innerH + gap / 2,
    w: Math.max(1, cell.w * innerW - gap),
    h: Math.max(1, cell.h * innerH - gap),
  }
}

/**
 * 计算图片在格子内的绘制矩形（cover + 用户缩放 + 取景偏移）。
 * offsetX/offsetY ∈ [-1, 1]，表示可移动范围内的相对位置。
 */
export function computeImageDrawRect(imgW, imgH, rect, cellState = {}) {
  const scale = Math.max(1, Math.min(3, Number(cellState.scale) || 1))
  const coverScale = Math.max(rect.w / imgW, rect.h / imgH)
  const drawW = imgW * coverScale * scale
  const drawH = imgH * coverScale * scale
  const maxShiftX = Math.max(0, (drawW - rect.w) / 2)
  const maxShiftY = Math.max(0, (drawH - rect.h) / 2)
  const offsetX = Math.max(-1, Math.min(1, Number(cellState.offsetX) || 0))
  const offsetY = Math.max(-1, Math.min(1, Number(cellState.offsetY) || 0))
  return {
    x: rect.x + (rect.w - drawW) / 2 + offsetX * maxShiftX,
    y: rect.y + (rect.h - drawH) / 2 + offsetY * maxShiftY,
    w: drawW,
    h: drawH,
  }
}

export async function loadImage(src) {
  const url = String(src || '').trim()
  if (!url) throw new Error('图片地址无效')

  const decode = (objectUrl, useCors) =>
    new Promise((resolve, reject) => {
      const img = new Image()
      if (useCors) {
        img.crossOrigin = 'anonymous'
        img.referrerPolicy = 'no-referrer'
      }
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片解码失败'))
      img.src = objectUrl
    })

  // blob / data URL 无需跨域
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return decode(url, false)
  }

  try {
    return await decode(url, true)
  } catch {
    // 跨域失败时尝试 fetch 转 blob，提升壁纸导出成功率
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' })
      if (!response.ok) throw new Error('fetch failed')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      try {
        return await decode(objectUrl, false)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch {
      throw new Error('图片加载失败，请换一张或重新上传')
    }
  }
}

/** 预读图片尺寸，供预览取景计算使用 */
export function preloadImageSize(src, onReady) {
  const url = String(src || '').trim()
  if (!url) return
  const img = new Image()
  img.onload = () => {
    onReady?.({
      w: img.naturalWidth || 1,
      h: img.naturalHeight || 1,
    })
  }
  img.src = url
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  if (radius <= 0) {
    ctx.rect(x, y, w, h)
    return
  }
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function supportsCanvasFilter(ctx) {
  return typeof ctx.filter === 'string'
}

function drawCellWithFilter(ctx, img, rect, drawRect, filterParams) {
  if (!hasFilterParams(filterParams)) {
    ctx.drawImage(img, drawRect.x, drawRect.y, drawRect.w, drawRect.h)
    return
  }

  if (supportsCanvasFilter(ctx)) {
    ctx.filter = buildFilterCss(filterParams)
    ctx.drawImage(img, drawRect.x, drawRect.y, drawRect.w, drawRect.h)
    ctx.filter = 'none'
    return
  }

  // 像素级退化：在离屏画布上渲染该格子再滤镜处理
  const off = document.createElement('canvas')
  off.width = Math.max(1, Math.round(rect.w))
  off.height = Math.max(1, Math.round(rect.h))
  const offCtx = off.getContext('2d')
  offCtx.drawImage(
    img,
    drawRect.x - rect.x,
    drawRect.y - rect.y,
    drawRect.w,
    drawRect.h,
  )
  const imageData = offCtx.getImageData(0, 0, off.width, off.height)
  applyPixelFilter(imageData, filterParams)
  offCtx.putImageData(imageData, 0, 0)
  ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h)
}

function drawCaption(ctx, text, boardW, boardH) {
  const content = String(text?.content || '').trim()
  if (!text?.enabled || !content) return

  const fontPx = Math.max(12, (Number(text.size) || 5) / 100 * boardW)
  const pad = boardW * 0.05
  ctx.font = `700 ${Math.round(fontPx)}px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`
  ctx.textAlign = 'center'
  ctx.fillStyle = text.color || '#ffffff'
  if (text.shadow !== false) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = fontPx * 0.35
    ctx.shadowOffsetY = fontPx * 0.06
  }

  const position = text.position || 'bottom'
  if (position === 'top') {
    ctx.textBaseline = 'top'
    ctx.fillText(content, boardW / 2, pad)
  } else if (position === 'center') {
    ctx.textBaseline = 'middle'
    ctx.fillText(content, boardW / 2, boardH / 2)
  } else {
    ctx.textBaseline = 'bottom'
    ctx.fillText(content, boardW / 2, boardH - pad)
  }

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

/**
 * 导出拼图。所有布局与效果参数与预览共用同一套几何计算，保证所见即所得。
 *
 * @param options.cells 数组，每项 { src, scale, offsetX, offsetY, filterId }
 * @param options.gap/radius/padding 以 BASE_BOARD_WIDTH 为基准的 px 值
 * @param options.format 'png' | 'jpeg'
 */
export async function exportCollage({
  template,
  ratioId = 'auto',
  cells = [],
  gap = 8,
  radius = 6,
  padding = 0,
  background = null,
  text = null,
  exportWidth = 2400,
  format = 'png',
  quality = 0.92,
}) {
  const ratio = resolveBoardRatio(template, ratioId)
  const boardW = Math.max(320, Math.round(exportWidth))
  const boardH = Math.round(boardW / ratio)
  const unit = boardW / BASE_BOARD_WIDTH

  const canvas = document.createElement('canvas')
  canvas.width = boardW
  canvas.height = boardH
  const ctx = canvas.getContext('2d')

  const isJpeg = format === 'jpeg'
  fillBackground(ctx, background || { type: 'solid', color: '#ffffff' }, boardW, boardH)

  const gapPx = gap * unit
  const paddingPx = padding * unit
  const radiusPx = radius * unit

  // 先并行加载所有图片，避免逐格等待
  const sources = template.cells.map((_, index) => cells[index]?.src || '')
  const images = await Promise.all(
    sources.map((src) => (src ? loadImage(src).catch(() => null) : Promise.resolve(null))),
  )

  for (let i = 0; i < template.cells.length; i += 1) {
    const img = images[i]
    if (!img) continue
    const cellState = cells[i] || {}
    const rect = computeCellRect(template.cells[i], boardW, boardH, gapPx, paddingPx)
    const drawRect = computeImageDrawRect(img.naturalWidth, img.naturalHeight, rect, cellState)
    const filterParams = getFilterPresetById(cellState.filterId || 'none').params

    ctx.save()
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radiusPx)
    ctx.clip()
    drawCellWithFilter(ctx, img, rect, drawRect, filterParams)
    ctx.restore()
  }

  drawCaption(ctx, text, boardW, boardH)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('导出失败，请重试'))
      },
      isJpeg ? 'image/jpeg' : 'image/png',
      isJpeg ? quality : undefined,
    )
  })
}
