import { zip } from 'fflate'
import { pickRecommendedVariant, savingsPercent as metricsSavings } from './imageMetrics.js'

export const MAX_FILE_BYTES = 30 * 1024 * 1024
export const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
export const MAX_EDGE_OPTIONS = [
  { value: 0, label: '原尺寸' },
  { value: 2560, label: '最长边 2560' },
  { value: 1920, label: '最长边 1920' },
  { value: 1280, label: '最长边 1280' },
  { value: 1080, label: '最长边 1080' },
  { value: 512, label: '图标 512' },
  { value: 256, label: '图标 256' },
  { value: 128, label: '图标 128' },
  { value: 64, label: '图标 64' },
]
/** Typical app/favicon icon budget after resize + lossy encode. */
export const ICON_TARGET_BYTES = {
  min: 4 * 1024,
  max: 10 * 1024,
}

export function isIconMaxEdge(maxEdge = 0) {
  const edge = Number(maxEdge) || 0
  return edge > 0 && edge <= 512
}
export const INTENSITY_OPTIONS = [
  { value: 'balanced', label: '均衡' },
  { value: 'max', label: '更小体积' },
]
export const COMPRESS_MODE_OPTIONS = [
  { value: 'lossless', label: '无损' },
  { value: 'lossy', label: '智能有损' },
]
export const LOSSY_FORMAT_OPTIONS = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'png', label: 'PNG 减色' },
]

const LARGE_PIXEL_THRESHOLD = 8_000_000

let worker = null
let lossyWorker = null
let requestId = 0
const pending = new Map()
const lossyPending = new Map()

function ensureWorker() {
  if (worker) return worker
  if (typeof Worker === 'undefined') throw new Error('当前浏览器不支持后台压缩')
  worker = new Worker(new URL('./workers/losslessCompress.worker.js', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (event) => {
    const data = event.data || {}
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.type === 'complete' && data.buffer) {
      entry.resolve({
        buffer: data.buffer,
        mimeType: data.mimeType,
        format: data.format,
      })
      return
    }
    entry.reject(new Error(data.message || '无损压缩失败'))
  }
  worker.onerror = (event) => {
    event.preventDefault?.()
    const error = new Error(event.message || '压缩 Worker 运行失败')
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function ensureLossyWorker() {
  if (lossyWorker) return lossyWorker
  if (typeof Worker === 'undefined') throw new Error('当前浏览器不支持后台压缩')
  lossyWorker = new Worker(new URL('./workers/lossyAnalyze.worker.js', import.meta.url), {
    type: 'module',
  })
  lossyWorker.onmessage = (event) => {
    const data = event.data || {}
    const entry = lossyPending.get(data.id)
    if (!entry) return
    if (data.type === 'progress') {
      entry.onProgress?.(data.done, data.total)
      return
    }
    lossyPending.delete(data.id)
    if (data.type === 'complete' && Array.isArray(data.variants)) {
      entry.resolve(data.variants)
      return
    }
    entry.reject(new Error(data.message || '智能压缩分析失败'))
  }
  lossyWorker.onerror = (event) => {
    event.preventDefault?.()
    const error = new Error(event.message || '压缩 Worker 运行失败')
    for (const entry of lossyPending.values()) entry.reject(error)
    lossyPending.clear()
    lossyWorker?.terminate()
    lossyWorker = null
  }
  return lossyWorker
}

export function isAcceptedImageFile(file) {
  if (!file) return false
  const type = String(file.type || '').toLowerCase()
  if (ACCEPTED_TYPES.has(type)) return true
  return /\.(png|jpe?g|webp)$/i.test(String(file.name || ''))
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 2 : 1)} MB`
}

export function savingsPercent(beforeBytes, afterBytes) {
  return metricsSavings(beforeBytes, afterBytes)
}

function mimeToExt(mimeType = '', format = '') {
  const fmt = String(format || '').toLowerCase()
  if (fmt === 'png' || String(mimeType).includes('png')) return 'png'
  if (fmt === 'webp' || String(mimeType).includes('webp')) return 'webp'
  if (fmt === 'jpg' || fmt === 'jpeg' || String(mimeType).includes('jpeg') || String(mimeType).includes('jpg')) {
    return 'jpg'
  }
  return 'png'
}

function normalizeFormatExt(format = 'webp') {
  const fmt = String(format || '').toLowerCase()
  if (fmt === 'png') return 'png'
  if (fmt === 'jpg' || fmt === 'jpeg') return 'jpg'
  return 'webp'
}

export function outputFilename(name = 'image', format = 'webp') {
  const ext = normalizeFormatExt(format)
  const base =
    String(name || 'image')
      .replace(/\.(png|jpe?g|webp)$/i, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim()
      .slice(0, 96) || 'image'
  return `${base}.${ext}`
}

async function decodeToImageData(file, { maxEdge = 0 } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const sourceWidth = bitmap.width
    const sourceHeight = bitmap.height
    if (!sourceWidth || !sourceHeight) throw new Error('无法读取图片尺寸')
    const limit = Math.max(0, Number(maxEdge) || 0)
    const longEdge = Math.max(sourceWidth, sourceHeight)
    const scale = limit > 0 && longEdge > limit ? limit / longEdge : 1
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const resized = scale < 1
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height })
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new Error('无法解码图片')
    context.drawImage(bitmap, 0, 0, width, height)
    return {
      imageData: context.getImageData(0, 0, width, height),
      width,
      height,
      sourceWidth,
      sourceHeight,
      resized,
    }
  } finally {
    bitmap.close?.()
  }
}

function compressInWorker({ imageData, format, sourcePngBuffer, intensity, signal }) {
  if (signal?.aborted) throw new DOMException('压缩已取消', 'AbortError')
  const id = `cmp-${++requestId}`
  const active = ensureWorker()
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      pending.delete(id)
      reject(new DOMException('压缩已取消', 'AbortError'))
    }
    pending.set(id, {
      resolve: (value) => {
        signal?.removeEventListener('abort', handleAbort)
        resolve(value)
      },
      reject: (error) => {
        signal?.removeEventListener('abort', handleAbort)
        reject(error)
      },
    })
    signal?.addEventListener('abort', handleAbort, { once: true })
    const transfer = [imageData.data.buffer]
    const message = {
      type: 'compress',
      id,
      format,
      intensity: String(intensity || 'balanced'),
      width: imageData.width,
      height: imageData.height,
      buffer: imageData.data.buffer,
      lowMemory: imageData.width * imageData.height > LARGE_PIXEL_THRESHOLD,
    }
    if (sourcePngBuffer) {
      message.sourcePngBuffer = sourcePngBuffer
      transfer.push(sourcePngBuffer)
    }
    active.postMessage(message, transfer)
  })
}

/**
 * 无损压缩单个文件。
 * @returns {Promise<{
 *   blob: Blob,
 *   mimeType: string,
 *   format: string,
 *   beforeBytes: number,
 *   afterBytes: number,
 *   keptOriginal: boolean,
 *   resized: boolean,
 *   width: number,
 *   height: number,
 *   sourceWidth: number,
 *   sourceHeight: number,
 * }>}
 */
export async function compressImageFile(
  file,
  {
    format = 'webp',
    keepIfLarger = true,
    maxEdge = 0,
    intensity = 'balanced',
    signal,
  } = {},
) {
  if (!isAcceptedImageFile(file)) throw new Error('请选择 PNG、JPG 或 WebP 图片')
  if (file.size > MAX_FILE_BYTES) throw new Error('图片不能超过 30MB')

  const targetFormat = String(format || 'webp').toLowerCase() === 'png' ? 'png' : 'webp'
  const sourceType = String(file.type || '').toLowerCase()
  const originalBuffer = await file.arrayBuffer()
  const beforeBytes = originalBuffer.byteLength
  const decoded = await decodeToImageData(
    new Blob([originalBuffer], { type: file.type || 'application/octet-stream' }),
    { maxEdge },
  )
  const { imageData, width, height, sourceWidth, sourceHeight, resized } = decoded

  // 缩放后像素已变，不能再喂原始 PNG buffer 给 oxipng
  let sourcePngBuffer = null
  if (
    !resized &&
    targetFormat === 'png' &&
    (sourceType.includes('png') || /\.png$/i.test(file.name || ''))
  ) {
    sourcePngBuffer = originalBuffer.slice(0)
  }

  const encoded = await compressInWorker({
    imageData,
    format: targetFormat,
    sourcePngBuffer,
    intensity,
    signal,
  })

  const sameFamily =
    (targetFormat === 'png' && sourceType.includes('png')) ||
    (targetFormat === 'webp' && sourceType.includes('webp'))

  let outputBuffer = encoded.buffer
  let mimeType = encoded.mimeType
  let keptOriginal = false

  // 缩放过的结果不能回退原图，否则尺寸设置会失效
  if (!resized && keepIfLarger && sameFamily && outputBuffer.byteLength >= beforeBytes) {
    outputBuffer = originalBuffer
    mimeType = file.type || mimeType
    keptOriginal = true
  }

  const blob = new Blob([outputBuffer], { type: mimeType })
  return {
    blob,
    mimeType,
    format: keptOriginal ? mimeToExt(mimeType, targetFormat) : targetFormat,
    beforeBytes,
    afterBytes: blob.size,
    keptOriginal,
    resized,
    width: keptOriginal ? sourceWidth : width,
    height: keptOriginal ? sourceHeight : height,
    sourceWidth,
    sourceHeight,
  }
}

export function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }
}

function zipFiles(files) {
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
}

export async function downloadBlobsAsZip(items = [], zipName = 'image-compress.zip') {
  const ready = (items || []).filter((item) => item?.blob)
  if (!ready.length) throw new Error('没有可打包下载的图片')

  // Single image: download the file directly — never wrap one picture in a ZIP.
  if (ready.length === 1) {
    const item = ready[0]
    const filename = outputFilename(item.name || 'image', item.format || 'webp')
    downloadBlob(item.blob, filename)
    return { count: 1, bytes: item.blob.size, zipped: false }
  }

  const files = {}
  for (const [index, item] of ready.entries()) {
    const ext = normalizeFormatExt(item.format || 'webp')
    let filename = outputFilename(item.name || `image-${index + 1}`, ext)
    let suffix = 2
    while (files[filename]) {
      const base = filename.replace(/\.(png|jpe?g|webp)$/i, '')
      filename = `${base}-${suffix}.${ext}`
      suffix += 1
    }
    files[filename] = new Uint8Array(await item.blob.arrayBuffer())
  }
  const archive = await zipFiles(files)
  downloadBlob(new Blob([archive], { type: 'application/zip' }), zipName)
  return { count: Object.keys(files).length, bytes: archive.byteLength, zipped: true }
}

function analyzeInLossyWorker({ imageData, format, signal, onProgress }) {
  if (signal?.aborted) throw new DOMException('压缩已取消', 'AbortError')
  const id = `lossy-${++requestId}`
  const active = ensureLossyWorker()
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      lossyPending.delete(id)
      reject(new DOMException('压缩已取消', 'AbortError'))
    }
    lossyPending.set(id, {
      onProgress,
      resolve: (value) => {
        signal?.removeEventListener('abort', handleAbort)
        resolve(value)
      },
      reject: (error) => {
        signal?.removeEventListener('abort', handleAbort)
        reject(error)
      },
    })
    signal?.addEventListener('abort', handleAbort, { once: true })
    active.postMessage(
      {
        type: 'analyze',
        id,
        format,
        width: imageData.width,
        height: imageData.height,
        buffer: imageData.data.buffer,
      },
      [imageData.data.buffer],
    )
  })
}

/**
 * 智能有损多档分析（JPEG / WebP / PNG 减色）。
 * @returns {Promise<{
 *   beforeBytes: number,
 *   width: number,
 *   height: number,
 *   sourceWidth: number,
 *   sourceHeight: number,
 *   resized: boolean,
 *   variants: Array<object>,
 *   recommended: object|null,
 * }>}
 */
export async function analyzeLossyImageFile(
  file,
  {
    format = 'jpeg',
    maxEdge = 0,
    targetMaxBytes = 0,
    targetMinBytes = 0,
    maxRmse = 0,
    signal,
    onProgress,
  } = {},
) {
  if (!isAcceptedImageFile(file)) throw new Error('请选择 PNG、JPG 或 WebP 图片')
  if (file.size > MAX_FILE_BYTES) throw new Error('图片不能超过 30MB')

  const target = String(format || 'jpeg').toLowerCase()
  const analyzeFormat = target === 'png' || target === 'webp' ? target : 'jpeg'
  const originalBuffer = await file.arrayBuffer()
  const beforeBytes = originalBuffer.byteLength
  const decoded = await decodeToImageData(
    new Blob([originalBuffer], { type: file.type || 'application/octet-stream' }),
    { maxEdge },
  )
  const { imageData, width, height, sourceWidth, sourceHeight, resized } = decoded

  const rawVariants = await analyzeInLossyWorker({
    imageData,
    format: analyzeFormat,
    signal,
    onProgress,
  })

  const variants = (rawVariants || []).map((item) => {
    const blob = new Blob([item.buffer], { type: item.mimeType || 'application/octet-stream' })
    return {
      id: item.id,
      label: item.label,
      kind: item.kind,
      quality: item.quality ?? null,
      colors: item.colors ?? null,
      mimeType: item.mimeType,
      format: mimeToExt(item.mimeType, item.format),
      bytes: item.bytes || blob.size,
      rmse: Number(item.rmse) || 0,
      maxError: Number(item.maxError) || 0,
      savings: savingsPercent(beforeBytes, item.bytes || blob.size),
      blob,
      recommended: false,
    }
  })

  const iconBudget = isIconMaxEdge(maxEdge)
  const recommended = pickRecommendedVariant(variants, beforeBytes, {
    targetMaxBytes:
      Number(targetMaxBytes) || (iconBudget ? ICON_TARGET_BYTES.max : 0),
    targetMinBytes:
      Number(targetMinBytes) || (iconBudget ? ICON_TARGET_BYTES.min : 0),
    maxRmse: Number(maxRmse) || (iconBudget ? 10 : 6),
  })
  if (recommended) recommended.recommended = true

  return {
    beforeBytes,
    width,
    height,
    sourceWidth,
    sourceHeight,
    resized,
    variants,
    recommended,
    iconBudget,
  }
}

export async function makePreviewDataUrl(blob, maxEdge = 160) {
  if (!blob) return ''
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return ''
    context.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } finally {
    bitmap.close?.()
  }
}

export function terminateCompressWorker() {
  for (const entry of pending.values()) {
    entry.reject(new DOMException('压缩已取消', 'AbortError'))
  }
  pending.clear()
  worker?.terminate()
  worker = null

  for (const entry of lossyPending.values()) {
    entry.reject(new DOMException('压缩已取消', 'AbortError'))
  }
  lossyPending.clear()
  lossyWorker?.terminate()
  lossyWorker = null
}
