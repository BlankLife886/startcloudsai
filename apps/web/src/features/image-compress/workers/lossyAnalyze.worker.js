import mozjpegEnc from '@jsquash/jpeg/codec/enc/mozjpeg_enc.js'
import { initEmscriptenModule as initJpegModule } from '@jsquash/jpeg/utils.js'
import decodeJpeg, { init as initJpegDec } from '@jsquash/jpeg/decode.js'
import { defaultOptions as jpegDefaults } from '@jsquash/jpeg/meta.js'
import jpegEncWasm from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url'
import jpegDecWasm from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?url'
import { init as initWebpEnc } from '@jsquash/webp/encode.js'
import decodeWebp, { init as initWebpDec } from '@jsquash/webp/decode.js'
import { defaultOptions as webpDefaults } from '@jsquash/webp/meta.js'
import webpEncWasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url'
import webpEncSimdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url'
import webpDecWasm from '@jsquash/webp/codec/dec/webp_dec.wasm?url'
import optimisePng, { init as initOxipng } from '@jsquash/oxipng/optimise.js'
import oxipngWasm from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url'
import { applyPalette, buildPalette, utils } from 'image-q'
import { exactEncodedBuffer } from '../exactEncodedBuffer.js'
import { computePixelError, flattenAlphaOnWhite } from '../imageMetrics.js'

const JPEG_QUALITIES = [100, 95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 15]
const WEBP_QUALITIES = [100, 95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 15, 10]
const PNG_COLORS = [256, 128, 64, 32, 16, 8, 4]

let jpegEncReady = null
let jpegDecReady = null
let webpEncReady = null
let webpDecReady = null
let oxipngReady = null

function ensureJpegEnc() {
  if (!jpegEncReady) {
    // @jsquash/jpeg 的 init() 不返回 module，这里直接初始化以便拿到 Uint8Array 视图
    jpegEncReady = initJpegModule(mozjpegEnc, undefined, {
      locateFile: () => jpegEncWasm,
    })
  }
  return jpegEncReady
}

function ensureJpegDec() {
  if (!jpegDecReady) {
    jpegDecReady = initJpegDec(undefined, {
      locateFile: () => jpegDecWasm,
    })
  }
  return jpegDecReady
}

function ensureWebpEnc() {
  if (!webpEncReady) {
    webpEncReady = initWebpEnc(undefined, {
      locateFile(path) {
        return String(path || '').includes('_simd') ? webpEncSimdWasm : webpEncWasm
      },
    })
  }
  return webpEncReady
}

function ensureWebpDec() {
  if (!webpDecReady) {
    webpDecReady = initWebpDec(undefined, {
      locateFile: () => webpDecWasm,
    })
  }
  return webpDecReady
}

function ensureOxipng() {
  if (!oxipngReady) oxipngReady = initOxipng(oxipngWasm)
  return oxipngReady
}

async function encodeJpegBuffer(imageData, options) {
  const module = await ensureJpegEnc()
  const result = module.encode(imageData.data, imageData.width, imageData.height, {
    ...jpegDefaults,
    ...options,
  })
  if (!result?.byteLength) throw new Error('JPEG 编码失败')
  return exactEncodedBuffer(result)
}

async function encodeWebpBuffer(imageData, options) {
  const module = await ensureWebpEnc()
  const result = module.encode(imageData.data, imageData.width, imageData.height, {
    ...webpDefaults,
    ...options,
  })
  if (!result?.byteLength) throw new Error('WebP 编码失败')
  return exactEncodedBuffer(result)
}

async function encodePngCanvas(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('无法编码 PNG')
  context.putImageData(imageData, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  if (!blob?.size) throw new Error('PNG 编码失败')
  return blob.arrayBuffer()
}

async function encodeOptimizedPng(imageData) {
  try {
    await ensureOxipng()
    return exactEncodedBuffer(
      await optimisePng(imageData, {
        level: 3,
        interlace: false,
        optimiseAlpha: true,
      }),
    )
  } catch {
    return encodePngCanvas(imageData)
  }
}

function toTransferableVariant(variant) {
  const buffer = exactEncodedBuffer(variant.buffer)
  return {
    ...variant,
    buffer,
  }
}

async function analyzeJpeg(original, onProgress) {
  const flat = flattenAlphaOnWhite(original)
  await ensureJpegEnc()
  await ensureJpegDec()
  const variants = []
  for (let index = 0; index < JPEG_QUALITIES.length; index += 1) {
    const quality = JPEG_QUALITIES[index]
    const buffer = await encodeJpegBuffer(flat, {
      quality,
      progressive: true,
      optimize_coding: true,
      trellis_multipass: quality <= 90,
      chroma_subsample: 2,
      auto_subsample: true,
    })
    const decoded = await decodeJpeg(buffer)
    const metrics = computePixelError(flat, decoded)
    variants.push({
      id: `jpeg-q${quality}`,
      label: `JPEG 质量 ${quality}`,
      kind: 'jpeg',
      quality,
      mimeType: 'image/jpeg',
      format: 'jpg',
      bytes: buffer.byteLength,
      rmse: metrics.rmse,
      maxError: metrics.maxError,
      buffer,
    })
    onProgress?.(index + 1, JPEG_QUALITIES.length)
  }
  return variants
}

async function analyzeWebp(original, onProgress) {
  await ensureWebpEnc()
  await ensureWebpDec()
  const variants = []
  for (let index = 0; index < WEBP_QUALITIES.length; index += 1) {
    const quality = WEBP_QUALITIES[index]
    const buffer = await encodeWebpBuffer(original, {
      quality,
      method: 4,
      lossless: 0,
      exact: 0,
      alpha_quality: Math.min(100, quality + 5),
    })
    const decoded = await decodeWebp(buffer)
    const metrics = computePixelError(original, decoded)
    variants.push({
      id: `webp-q${quality}`,
      label: `WebP 质量 ${quality}`,
      kind: 'webp',
      quality,
      mimeType: 'image/webp',
      format: 'webp',
      bytes: buffer.byteLength,
      rmse: metrics.rmse,
      maxError: metrics.maxError,
      buffer,
    })
    onProgress?.(index + 1, WEBP_QUALITIES.length)
  }
  return variants
}

async function analyzePng(original, onProgress) {
  const total = PNG_COLORS.length + 1
  const variants = []
  const losslessBuffer = await encodeOptimizedPng(original)
  variants.push({
    id: 'png-lossless',
    label: '无损',
    kind: 'png',
    colors: null,
    mimeType: 'image/png',
    format: 'png',
    bytes: losslessBuffer.byteLength,
    rmse: 0,
    maxError: 0,
    buffer: losslessBuffer,
  })
  onProgress?.(1, total)

  const pointContainer = utils.PointContainer.fromImageData(original)
  for (let index = 0; index < PNG_COLORS.length; index += 1) {
    const colors = PNG_COLORS[index]
    const palette = await buildPalette([pointContainer], {
      colors,
      paletteQuantization: 'wuquant',
      colorDistanceFormula: 'euclidean-bt709',
    })
    const quantized = await applyPalette(pointContainer.clone(), palette, {
      imageQuantization: 'floyd-steinberg',
      colorDistanceFormula: 'euclidean-bt709',
    })
    const rgba = quantized.toUint8Array()
    const imageData = new ImageData(
      new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      original.width,
      original.height,
    )
    const buffer = await encodeOptimizedPng(imageData)
    const metrics = computePixelError(original, imageData)
    variants.push({
      id: `png-c${colors}`,
      label: `${colors} 色`,
      kind: 'png',
      colors,
      mimeType: 'image/png',
      format: 'png',
      bytes: buffer.byteLength,
      rmse: metrics.rmse,
      maxError: metrics.maxError,
      buffer,
    })
    onProgress?.(index + 2, total)
  }
  return variants
}

self.onmessage = async (event) => {
  const payload = event.data || {}
  if (payload.type !== 'analyze') return
  const id = payload.id
  try {
    const format = String(payload.format || 'jpeg').toLowerCase()
    const width = Number(payload.width) || 0
    const height = Number(payload.height) || 0
    if (!width || !height || !payload.buffer) throw new Error('图片数据无效')
    const original = new ImageData(new Uint8ClampedArray(payload.buffer), width, height)
    const report = (done, total) => {
      self.postMessage({ type: 'progress', id, done, total })
    }
    let variants
    if (format === 'png') variants = await analyzePng(original, report)
    else if (format === 'webp') variants = await analyzeWebp(original, report)
    else variants = await analyzeJpeg(original, report)

    const transferable = variants.map(toTransferableVariant)
    const buffers = transferable.map((item) => item.buffer)
    self.postMessage(
      {
        type: 'complete',
        id,
        variants: transferable,
      },
      buffers,
    )
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : '智能压缩分析失败',
    })
  }
}
