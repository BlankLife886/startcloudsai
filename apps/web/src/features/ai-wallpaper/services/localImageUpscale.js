import createPica from 'pica'
import { fetchAuthenticatedMediaBlob } from '@/services/authenticatedMedia'
import {
  analyzeLocalImageQuality,
  resolveAdaptiveSharpening,
} from './localImageQualityAnalysis'
import { refineTransparentImageData } from './transparentEdgeRefinement'

let sharedResizer = null
let sharedLargeResizer = null
const LOCAL_UPSCALE_STEP = 16
const LOCAL_UPSCALE_MAX_EDGE = 7680
const LOCAL_UPSCALE_MAX_PIXELS = 7680 * 7680
const LARGE_IMAGE_PIXEL_THRESHOLD = 7680 * 4320
const ALPHA_REFINEMENT_MAX_PIXELS = 6_000_000

function getResizer() {
  if (!sharedResizer) {
    sharedResizer = createPica({
      tile: 1024,
      concurrency: Math.max(
        1,
        Math.min(4, Number(globalThis.navigator?.hardwareConcurrency || 2)),
      ),
      features: ['js', 'wasm', 'ww'],
    })
  }
  return sharedResizer
}

function getLargeImageResizer() {
  if (!sharedLargeResizer) {
    sharedLargeResizer = createPica({
      tile: 512,
      concurrency: 1,
      features: ['js', 'wasm', 'ww'],
    })
  }
  return sharedLargeResizer
}

function selectResizer(pixelCount) {
  return pixelCount > LARGE_IMAGE_PIXEL_THRESHOLD ? getLargeImageResizer() : getResizer()
}

export function resolveLocalUpscaleTarget(width, height, resolutionScale = '2K') {
  const sourceWidth = Math.max(1, Math.floor(Number(width || 0)))
  const sourceHeight = Math.max(1, Math.floor(Number(height || 0)))
  const requestedScale = String(resolutionScale || '').trim().toUpperCase()
  const targetLongEdge =
    requestedScale === '8K'
      ? 7680
      : requestedScale === '4K'
        ? 3840
        : requestedScale === '2K'
          ? 2048
          : 1024
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight)

  if (targetLongEdge <= 1024) {
    return {
      width: sourceWidth,
      height: sourceHeight,
      scale: 1,
      resolutionScale: '1K',
      // 1K keeps the provider dimensions but still receives the same
      // lossless detail-enhancement pass as the larger output presets.
      shouldResize: sourceLongEdge <= 1024,
    }
  }

  if (sourceLongEdge >= targetLongEdge) {
    return {
      width: sourceWidth,
      height: sourceHeight,
      scale: 1,
      resolutionScale: requestedScale,
      shouldResize: false,
    }
  }

  let edgeScale = targetLongEdge / sourceLongEdge
  let targetWidth = sourceWidth * edgeScale
  let targetHeight = sourceHeight * edgeScale
  const requestedPixels = targetWidth * targetHeight
  if (requestedPixels > LOCAL_UPSCALE_MAX_PIXELS) {
    edgeScale *= Math.sqrt(LOCAL_UPSCALE_MAX_PIXELS / requestedPixels)
    targetWidth = sourceWidth * edgeScale
    targetHeight = sourceHeight * edgeScale
  }
  targetWidth = Math.min(
    LOCAL_UPSCALE_MAX_EDGE,
    Math.max(LOCAL_UPSCALE_STEP, Math.round(targetWidth / LOCAL_UPSCALE_STEP) * LOCAL_UPSCALE_STEP),
  )
  targetHeight = Math.min(
    LOCAL_UPSCALE_MAX_EDGE,
    Math.max(LOCAL_UPSCALE_STEP, Math.round(targetHeight / LOCAL_UPSCALE_STEP) * LOCAL_UPSCALE_STEP),
  )
  if (targetWidth * targetHeight > LOCAL_UPSCALE_MAX_PIXELS) {
    const safeScale = Math.sqrt(LOCAL_UPSCALE_MAX_PIXELS / (targetWidth * targetHeight))
    targetWidth = Math.floor((targetWidth * safeScale) / LOCAL_UPSCALE_STEP) * LOCAL_UPSCALE_STEP
    targetHeight = Math.floor((targetHeight * safeScale) / LOCAL_UPSCALE_STEP) * LOCAL_UPSCALE_STEP
  }

  return {
    width: targetWidth,
    height: targetHeight,
    scale: Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight),
    resolutionScale: ['2K', '4K', '8K'].includes(requestedScale) ? requestedScale : '2K',
    shouldResize:
      targetWidth > sourceWidth &&
      targetHeight > sourceHeight &&
      targetWidth * targetHeight <= LOCAL_UPSCALE_MAX_PIXELS,
  }
}

function createAbortToken(signal) {
  if (!signal) return null
  if (signal.aborted) {
    return Promise.reject(new DOMException('高清放大已取消', 'AbortError'))
  }
  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('高清放大已取消', 'AbortError')),
      { once: true },
    )
  })
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob, { imageOrientation: 'from-image' })
  }
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = objectUrl
    await image.decode()
    return image
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

function encodeWebpInWorker(imageData, signal) {
  if (typeof Worker === 'undefined') throw new Error('当前浏览器不支持后台图片编码')
  if (signal?.aborted) throw new DOMException('高清放大已取消', 'AbortError')

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/losslessWebp.worker.js', import.meta.url), {
      type: 'module',
    })
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', handleAbort)
      worker.terminate()
      callback(value)
    }
    const handleAbort = () =>
      finish(reject, new DOMException('高清放大已取消', 'AbortError'))

    worker.onmessage = (event) => {
      if (event.data?.type === 'complete' && event.data.buffer) {
        finish(resolve, event.data.buffer)
        return
      }
      finish(reject, new Error(event.data?.message || '无损 WebP 编码失败'))
    }
    worker.onerror = (event) => {
      event.preventDefault?.()
      finish(reject, new Error(event.message || '无损 WebP Worker 运行失败'))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
    const buffer = imageData.data.buffer
    worker.postMessage(
      {
        type: 'encode',
        width: imageData.width,
        height: imageData.height,
        buffer,
        lowMemory: imageData.width * imageData.height > LARGE_IMAGE_PIXEL_THRESHOLD,
      },
      [buffer],
    )
  })
}

async function encodePng(canvas) {
  const blob = await getResizer().toBlob(canvas, 'image/png')
  if (!blob?.size) throw new Error('无损 PNG 编码失败')
  return { blob, extension: 'png', type: 'image/png' }
}

async function encodeJpeg(canvas, extension = 'jpg') {
  const blob = await getResizer().toBlob(canvas, 'image/jpeg', 1)
  if (!blob?.size) throw new Error('最高质量 JPEG 编码失败')
  return {
    blob,
    extension: extension === 'jpeg' ? 'jpeg' : 'jpg',
    type: 'image/jpeg',
  }
}

async function encodeOutput(canvas, signal, { format = 'auto', forcePng = false } = {}) {
  if (forcePng) return encodePng(canvas)
  if (format === 'jpeg' || format === 'jpg') return encodeJpeg(canvas, format)
  try {
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new Error('无法读取高清画布')
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const encoded = await encodeWebpInWorker(imageData, signal)
    const blob = new Blob([encoded], { type: 'image/webp' })
    if (!blob.size) throw new Error('无损 WebP 编码失败')
    return { blob, extension: 'webp', type: 'image/webp' }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    if (import.meta.env.DEV) console.warn('[local-upscale] lossless WebP unavailable', error)
    // PNG is the lossless compatibility fallback. Never silently fall back to
    // JPEG because that would introduce a second lossy generation.
    return await encodePng(canvas)
  }
}

function refineTransparentGraphicSource(image, width, height) {
  if (
    typeof document === 'undefined' ||
    width * height > ALPHA_REFINEMENT_MAX_PIXELS
  ) {
    return { source: image, refined: false, release: () => {} }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!context) return { source: image, refined: false, release: () => {} }
  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const frame = context.getImageData(0, 0, width, height)
  const refinement = refineTransparentImageData(frame.data, width, height)
  context.putImageData(frame, 0, 0)
  return {
    source: canvas,
    refined: refinement.changedPixels > 0,
    release() {
      canvas.width = 1
      canvas.height = 1
    },
  }
}

function releaseDecodedImage(image) {
  if (typeof image?.close === 'function') image.close()
  const src = String(image?.src || '')
  if (src.startsWith('blob:')) URL.revokeObjectURL(src)
}

export async function createLocalUpscaledImage({
  sourceUrl,
  resolutionScale,
  transparentPng = false,
  outputFormat = 'auto',
  signal,
  onProgress = () => {},
}) {
  const url = String(sourceUrl || '').trim()
  if (!url) throw new Error('没有可用于高清放大的原图')

  onProgress(8, '正在读取原始图片', { stage: 'download' })
  const sourceBlob = await fetchAuthenticatedMediaBlob(url, {
    cache: 'no-store',
    signal,
  })

  onProgress(16, '正在解析图片尺寸', { stage: 'decode' })
  const sourceImage = await decodeImage(sourceBlob)
  const sourceWidth = Number(sourceImage.naturalWidth || sourceImage.width || 0)
  const sourceHeight = Number(sourceImage.naturalHeight || sourceImage.height || 0)
  if (!sourceWidth || !sourceHeight) {
    releaseDecodedImage(sourceImage)
    throw new Error('无法识别原图尺寸')
  }

  onProgress(22, '正在分析纹理、边缘与噪点', { stage: 'analyze' })
  const detectedAnalysis = analyzeLocalImageQuality(sourceImage)
  const transparencyAware = transparentPng || detectedAnalysis.hasTransparency === true
  const requestedFormat = String(outputFormat || 'auto').trim().toLowerCase()
  const forcePng = transparencyAware || requestedFormat === 'png'
  const analysis = transparencyAware
    ? {
        ...detectedAnalysis,
        profile: 'transparent-graphic',
        label: '透明图形边缘优化',
        hasTransparency: true,
      }
    : detectedAnalysis
  const target = resolveLocalUpscaleTarget(sourceWidth, sourceHeight, resolutionScale)
  onProgress(28, `${analysis.label} · 已匹配自适应增强参数`, {
    stage: 'analyze',
    profile: analysis.label,
  })
  if (!target.shouldResize) {
    releaseDecodedImage(sourceImage)
    return {
      file: null,
      sourceWidth,
      sourceHeight,
      targetWidth: sourceWidth,
      targetHeight: sourceHeight,
      skipped: true,
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const refinedSource = transparencyAware
    ? refineTransparentGraphicSource(sourceImage, sourceWidth, sourceHeight)
    : { source: sourceImage, refined: false, release: () => {} }
  try {
    if (refinedSource.refined) {
      onProgress(32, '正在平滑 Alpha 轮廓并清理边缘底色', {
        stage: 'alpha-edge',
        profile: analysis.label,
      })
    }
    onProgress(36, `正在重建 ${target.width}×${target.height} 像素`, {
      stage: 'resize',
      profile: analysis.label,
    })
    const resizer = selectResizer(target.width * target.height)
    await resizer.resize(refinedSource.source, canvas, {
      // Pica recommends mks2013 as its production default. It combines
      // resampling with restrained sharpening and avoids a second lossy pass.
      filter: 'mks2013',
      ...resolveAdaptiveSharpening(target.resolutionScale, analysis),
      cancelToken: createAbortToken(signal),
    })
    if (signal?.aborted) throw new DOMException('高清放大已取消', 'AbortError')

    onProgress(82, '边缘与微纹理增强完成', {
      stage: 'enhance',
      profile: analysis.label,
    })
    const encodingLabel = forcePng
      ? '正在编码无损 PNG'
      : ['jpeg', 'jpg'].includes(requestedFormat)
        ? '正在编码最高质量 JPEG'
        : '正在后台编码无损 WebP'
    onProgress(88, encodingLabel, {
      stage: 'encode',
      profile: analysis.label,
    })
    const output = await encodeOutput(canvas, signal, {
      format: requestedFormat,
      forcePng,
    })
    const file = new File(
      [output.blob],
      `wallpaper-${target.width}x${target.height}-lossless.${output.extension}`,
      { type: output.type },
    )
    onProgress(94, '无损编码完成，准备安全保存', {
      stage: 'encode',
      profile: analysis.label,
    })
    return {
      file,
      sourceWidth,
      sourceHeight,
      targetWidth: target.width,
      targetHeight: target.height,
      resolutionScale: target.resolutionScale,
      enhancementProfile: analysis.label,
      outputFormat: output.extension.toUpperCase(),
      skipped: false,
    }
  } finally {
    refinedSource.release()
    releaseDecodedImage(sourceImage)
    canvas.width = 1
    canvas.height = 1
  }
}
