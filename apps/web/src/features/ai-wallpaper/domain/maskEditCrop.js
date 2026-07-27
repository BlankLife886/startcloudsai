// 局部编辑 crop-and-stitch 前置步骤：
// 上游图像模型（images/edits）会整图重绘，无法保证未选区域逐像素不变。
// 因此把蒙版包围盒外扩出上下文后裁剪送编辑，服务端再把结果羽化贴回原图，
// 裁剪区域之外的像素按构造保持与原图一致。
//
// 蒙版契约（LocalMaskEditorDialog.buildMaskFile）：不透明黑底 + destination-out
// 打洞，alpha=0 即需要编辑的区域。

const SCAN_MAX_DIMENSION = 512
const ALPHA_EDIT_THRESHOLD = 128
const MIN_CROP_SIZE = 512
const PADDING_RATIO = 0.35
const PADDING_MIN = 48
const PADDING_MAX = 384

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

async function blobToBitmap(blob) {
  return createImageBitmap(blob)
}

function drawToCanvas(bitmap, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

function releaseCanvas(canvas) {
  canvas.width = 1
  canvas.height = 1
}

async function canvasToFile(canvas, name, type, quality) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality))
  releaseCanvas(canvas)
  if (!blob) throw new Error('局部编辑裁剪图生成失败')
  return new File([blob], name, { type: blob.type || type })
}

// 在缩小后的蒙版上扫 alpha<阈值 的包围盒，返回归一化坐标（0..1）。
function scanMaskBounds(maskBitmap) {
  const scale = Math.min(
    1,
    SCAN_MAX_DIMENSION / Math.max(maskBitmap.width, maskBitmap.height, 1),
  )
  const canvas = drawToCanvas(maskBitmap, maskBitmap.width * scale, maskBitmap.height * scale)
  const { width, height } = canvas
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
  releaseCanvas(canvas)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < ALPHA_EDIT_THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  // 缩放扫描存在量化误差，包围盒各方向多留 1.5 个采样像素
  const margin = 1.5
  return {
    left: clamp((minX - margin) / width, 0, 1),
    top: clamp((minY - margin) / height, 0, 1),
    right: clamp((maxX + 1 + margin) / width, 0, 1),
    bottom: clamp((maxY + 1 + margin) / height, 0, 1),
  }
}

// 归一化包围盒 → 原图像素矩形：按比例外扩上下文，保证最小尺寸，夹回图内。
function expandRect(bounds, width, height) {
  let x0 = bounds.left * width
  let y0 = bounds.top * height
  let x1 = bounds.right * width
  let y1 = bounds.bottom * height
  const pad = clamp(Math.round(Math.max(x1 - x0, y1 - y0) * PADDING_RATIO), PADDING_MIN, PADDING_MAX)
  x0 -= pad
  y0 -= pad
  x1 += pad
  y1 += pad
  const ensureSpan = (start, end, minSpan) => {
    const span = end - start
    if (span >= minSpan) return [start, end]
    const grow = (minSpan - span) / 2
    return [start - grow, end + grow]
  }
  ;[x0, x1] = ensureSpan(x0, x1, Math.min(MIN_CROP_SIZE, width))
  ;[y0, y1] = ensureSpan(y0, y1, Math.min(MIN_CROP_SIZE, height))
  // 夹回图内（先平移，再截断超出图幅的部分）
  if (x0 < 0) [x0, x1] = [0, x1 - x0]
  if (y0 < 0) [y0, y1] = [0, y1 - y0]
  if (x1 > width) [x0, x1] = [Math.max(0, x0 - (x1 - width)), width]
  if (y1 > height) [y0, y1] = [Math.max(0, y0 - (y1 - height)), height]
  const x = Math.max(0, Math.floor(x0))
  const y = Math.max(0, Math.floor(y0))
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.ceil(x1) - x)),
    height: Math.max(1, Math.min(height - y, Math.ceil(y1) - y)),
  }
}

/** 按裁剪比例挑上游生成尺寸（gpt-image 系列仅支持三档）。 */
export function pickMaskEditUpstreamSize(rect) {
  const ratio = rect.width / Math.max(1, rect.height)
  if (ratio > 1.25) return '1536x1024'
  if (ratio < 0.8) return '1024x1536'
  return '1024x1024'
}

/**
 * 输入原图 blob 与全尺寸蒙版文件，输出：
 * - rect：蒙版包围盒外扩后的裁剪矩形（原图像素坐标）
 * - cropFile：裁剪后的原图（送上游编辑的唯一输入图）
 * - cropMaskFile：同矩形裁剪的蒙版 PNG（服务端合成用）
 */
export async function prepareMaskEditCrop({ sourceBlob, maskFile }) {
  const [sourceBitmap, maskBitmap] = await Promise.all([
    blobToBitmap(sourceBlob),
    blobToBitmap(maskFile),
  ])
  try {
    const bounds = scanMaskBounds(maskBitmap)
    if (!bounds) throw new Error('蒙版为空，请先涂抹需要修改的区域')
    const rect = expandRect(bounds, sourceBitmap.width, sourceBitmap.height)

    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = rect.width
    cropCanvas.height = rect.height
    cropCanvas
      .getContext('2d')
      .drawImage(sourceBitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    const usePng = /png|webp/i.test(String(sourceBlob.type || ''))
    const cropFile = await canvasToFile(
      cropCanvas,
      `local-edit-crop-${Date.now()}.${usePng ? 'png' : 'jpg'}`,
      usePng ? 'image/png' : 'image/jpeg',
      usePng ? undefined : 0.95,
    )

    // 蒙版与原图分辨率一致（同一编辑器导出）；若不一致按比例映射同一归一化矩形
    const maskScaleX = maskBitmap.width / sourceBitmap.width
    const maskScaleY = maskBitmap.height / sourceBitmap.height
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = rect.width
    maskCanvas.height = rect.height
    maskCanvas
      .getContext('2d')
      .drawImage(
        maskBitmap,
        rect.x * maskScaleX,
        rect.y * maskScaleY,
        rect.width * maskScaleX,
        rect.height * maskScaleY,
        0,
        0,
        rect.width,
        rect.height,
      )
    const cropMaskFile = await canvasToFile(
      maskCanvas,
      `local-edit-mask-${Date.now()}.png`,
      'image/png',
    )
    return { rect, cropFile, cropMaskFile }
  } finally {
    sourceBitmap.close?.()
    maskBitmap.close?.()
  }
}
