// 图片编辑器的“标注”：画笔、文字、图形和橡皮擦。所有坐标都按图片自身的像素
// （显示用的那张图的原始宽高）存，界面缩放、导出时再换算。

export const MARKUP_COLORS = [
  '#111111', '#6b7280', '#92400e', '#dc2626', '#f97316', '#f59e0b',
  '#16a34a', '#0d9488', '#06b6d4', '#2563eb', '#4f46e5', '#9333ea', '#db2777',
]

export const MARKUP_SHAPES = [
  { id: 'line', label: '直线' },
  { id: 'arrow', label: '箭头' },
  { id: 'rect', label: '矩形' },
  { id: 'ellipse', label: '圆形' },
  { id: 'triangle', label: '三角形' },
  { id: 'diamond', label: '菱形' },
  { id: 'star', label: '星形' },
  { id: 'heart', label: '爱心' },
]

export const MARKUP_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
const LINE_HEIGHT = 1.25

export function isLineShape(shape) {
  return shape === 'line' || shape === 'arrow'
}

// 粗细滑杆是 0-100，按图片短边换算成像素，同一档在大图小图上看起来一样粗。
export function strokeWidthFor(size, base) {
  return Math.max(1, base * (0.003 + (size / 100) * 0.03))
}

export function fontSizeFor(size, base) {
  return Math.max(8, base * (0.025 + (size / 100) * 0.1))
}

export function eraserWidthFor(size, base) {
  return Math.max(4, base * (0.015 + (size / 100) * 0.09))
}

const round = (value) => Math.round(value * 10) / 10

export function penPath(points = []) {
  if (!points.length) return ''
  const [first] = points
  if (points.length === 1) return `M${round(first[0])} ${round(first[1])}L${round(first[0] + 0.1)} ${round(first[1])}`
  let path = `M${round(first[0])} ${round(first[1])}`
  // 用相邻两点的中点做二次曲线，笔迹更顺。
  for (let index = 1; index < points.length - 1; index += 1) {
    const [x, y] = points[index]
    const [nextX, nextY] = points[index + 1]
    path += `Q${round(x)} ${round(y)} ${round((x + nextX) / 2)} ${round((y + nextY) / 2)}`
  }
  const last = points[points.length - 1]
  return `${path}L${round(last[0])} ${round(last[1])}`
}

const HEART = [
  ['M', 0.5, 0.26],
  ['C', 0.5, 0.1, 0.36, 0, 0.23, 0], ['C', 0.09, 0, 0, 0.12, 0, 0.27],
  ['C', 0, 0.48, 0.2, 0.66, 0.5, 0.97],
  ['C', 0.8, 0.66, 1, 0.48, 1, 0.27], ['C', 1, 0.12, 0.91, 0, 0.77, 0],
  ['C', 0.64, 0, 0.5, 0.1, 0.5, 0.26],
]

function boxPath(shape, { x, y, w, h }) {
  const px = (value) => round(x + value * w)
  const py = (value) => round(y + value * h)
  switch (shape) {
    case 'rect':
      return `M${px(0)} ${py(0)}H${px(1)}V${py(1)}H${px(0)}Z`
    case 'ellipse':
      return `M${px(0)} ${py(0.5)}A${round(w / 2)} ${round(h / 2)} 0 1 0 ${px(1)} ${py(0.5)}A${round(w / 2)} ${round(h / 2)} 0 1 0 ${px(0)} ${py(0.5)}Z`
    case 'triangle':
      return `M${px(0.5)} ${py(0)}L${px(1)} ${py(1)}L${px(0)} ${py(1)}Z`
    case 'diamond':
      return `M${px(0.5)} ${py(0)}L${px(1)} ${py(0.5)}L${px(0.5)} ${py(1)}L${px(0)} ${py(0.5)}Z`
    case 'star': {
      let path = ''
      for (let index = 0; index < 10; index += 1) {
        const radius = index % 2 ? 0.2 : 0.5
        const angle = -Math.PI / 2 + (index * Math.PI) / 5
        path += `${index ? 'L' : 'M'}${px(0.5 + radius * Math.cos(angle))} ${py(0.53 + radius * Math.sin(angle))}`
      }
      return `${path}Z`
    }
    case 'heart':
      return HEART.map(([command, ...values]) => command + values.map((value, index) => (index % 2 ? py(value) : px(value))).join(' ')).join('') + 'Z'
    default:
      return ''
  }
}

function linePath({ shape, x1, y1, x2, y2, width }) {
  let path = `M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}`
  if (shape === 'arrow') {
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const length = Math.min(Math.hypot(x2 - x1, y2 - y1) * 0.5, Math.max(width * 4, 10))
    const head = (side) => [x2 - length * Math.cos(angle + side * 0.5), y2 - length * Math.sin(angle + side * 0.5)]
    const [ax, ay] = head(-1)
    const [bx, by] = head(1)
    path += `M${round(ax)} ${round(ay)}L${round(x2)} ${round(y2)}L${round(bx)} ${round(by)}`
  }
  return path
}

// 线条类条目（画笔、图形、橡皮擦）的路径；文字没有路径。
export function itemPath(item) {
  if (item.type === 'pen' || item.type === 'erase') return penPath(item.points)
  if (item.type === 'shape') return isLineShape(item.shape) ? linePath(item) : boxPath(item.shape, item)
  return ''
}

let measureContext = null

function measurer(size) {
  if (!measureContext && typeof document !== 'undefined') measureContext = document.createElement('canvas').getContext('2d')
  if (measureContext) measureContext.font = `600 ${size}px ${MARKUP_FONT}`
  return measureContext
}

// 文字框宽度固定，超出就换行（中文按字、英文也按字符断开，和输入框的 break-all 一致）。
export function wrapText(text, size, maxWidth) {
  const context = measurer(size)
  const lines = []
  for (const paragraph of String(text || '').split('\n')) {
    let line = ''
    for (const char of Array.from(paragraph)) {
      const next = line + char
      if (line && context && context.measureText(next).width > maxWidth) {
        lines.push(line)
        line = char
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines
}

export function textLines(item) {
  return wrapText(item.text, item.size, item.w)
}

// 文字框的高度跟着行数变，宽度不变。
export function textHeight(text, size, width) {
  return wrapText(text, size, width).length * size * LINE_HEIGHT
}

export function defaultTextWidth(x, size, imageWidth) {
  return Math.max(size * 3, Math.min(imageWidth - x, Math.max(size * 8, imageWidth * 0.4)))
}

export function textBaseline(item, index) {
  return item.y + (index + 1) * item.size * LINE_HEIGHT - item.size * 0.3
}

// 条目本身的范围（不含线宽），选中框和缩放都以它为准。
export function itemBounds(item) {
  if (item.type === 'pen' || item.type === 'erase') {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of item.points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  if (item.type === 'shape' && isLineShape(item.shape)) {
    return { x: Math.min(item.x1, item.x2), y: Math.min(item.y1, item.y2), w: Math.abs(item.x2 - item.x1), h: Math.abs(item.y2 - item.y1) }
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h }
}

export function moveItem(item, dx, dy) {
  if (item.type === 'pen' || item.type === 'erase') return { ...item, points: item.points.map(([x, y]) => [x + dx, y + dy]) }
  if (item.type === 'shape' && isLineShape(item.shape)) return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy }
  return { ...item, x: item.x + dx, y: item.y + dy }
}

// 把条目从 from 范围映射到 to 范围；文字按高度等比缩放字号。
export function fitItem(item, from, to) {
  const sx = from.w > 0.01 ? to.w / from.w : 1
  const sy = from.h > 0.01 ? to.h / from.h : 1
  const mapX = (value) => to.x + (value - from.x) * sx
  const mapY = (value) => to.y + (value - from.y) * sy
  if (item.type === 'pen') return { ...item, points: item.points.map(([x, y]) => [mapX(x), mapY(y)]) }
  if (item.type === 'text') {
    const size = Math.max(8, item.size * sy)
    const width = item.w * sy
    return { ...item, x: to.x, y: to.y, size, w: width, h: textHeight(item.text, size, width) }
  }
  return { ...item, x: to.x, y: to.y, w: to.w, h: to.h }
}

// 拖动选中框的某个把手后的新范围；文字始终等比。
export function resizeBounds(bounds, handle, dx, dy, keepRatio, minSize) {
  let left = bounds.x
  let top = bounds.y
  let right = bounds.x + bounds.w
  let bottom = bounds.y + bounds.h
  if (handle.includes('w')) left = Math.min(left + dx, right - minSize)
  if (handle.includes('e')) right = Math.max(right + dx, left + minSize)
  if (handle.includes('n')) top = Math.min(top + dy, bottom - minSize)
  if (handle.includes('s')) bottom = Math.max(bottom + dy, top + minSize)
  if (!keepRatio || !bounds.w || !bounds.h) return { x: left, y: top, w: right - left, h: bottom - top }
  const horizontal = handle.includes('e') || handle.includes('w')
  const vertical = handle.includes('n') || handle.includes('s')
  const scale = horizontal && vertical
    ? Math.max((right - left) / bounds.w, (bottom - top) / bounds.h)
    : horizontal ? (right - left) / bounds.w : (bottom - top) / bounds.h
  const w = bounds.w * scale
  const h = bounds.h * scale
  return {
    x: handle.includes('w') ? bounds.x + bounds.w - w : bounds.x,
    y: handle.includes('n') ? bounds.y + bounds.h - h : bounds.y,
    w,
    h,
  }
}

// 原图叠上标注导出成 PNG：标注先画在单独一层上，橡皮擦只擦标注、不擦原图。
export async function renderMarkupFile(image, items, size) {
  const width = image.naturalWidth
  const height = image.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, width, height)
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = height
  const ink = layer.getContext('2d')
  ink.scale(width / size.width, height / size.height)
  ink.lineCap = 'round'
  ink.lineJoin = 'round'
  for (const item of items) {
    if (item.type === 'text') {
      ink.fillStyle = item.color
      ink.font = `600 ${item.size}px ${MARKUP_FONT}`
      textLines(item).forEach((line, index) => ink.fillText(line, item.x, textBaseline(item, index)))
      continue
    }
    ink.globalCompositeOperation = item.type === 'erase' ? 'destination-out' : 'source-over'
    ink.strokeStyle = item.type === 'erase' ? '#000' : item.color
    ink.lineWidth = item.width
    ink.stroke(new Path2D(itemPath(item)))
  }
  context.drawImage(layer, 0, 0)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('标注图片生成失败'))), 'image/png')
  })
  canvas.width = canvas.height = layer.width = layer.height = 1
  return new File([blob], `markup-${Date.now()}.png`, { type: 'image/png' })
}

export function hasMarks(items = []) {
  return items.some((item) => item.type !== 'erase' && (item.type !== 'text' || item.text.trim()))
}
