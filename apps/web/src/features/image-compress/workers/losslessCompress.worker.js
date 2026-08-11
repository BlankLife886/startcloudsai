import { init as initWebpEncoder } from '@jsquash/webp/encode.js'
import { defaultOptions as webpDefaults } from '@jsquash/webp/meta.js'
import webpEncoderWasmUrl from '@jsquash/webp/codec/enc/webp_enc.wasm?url'
import webpEncoderSimdWasmUrl from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url'
import optimisePng, { init as initOxipng } from '@jsquash/oxipng/optimise.js'
import oxipngWasmUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url'
import { exactEncodedBuffer } from '../exactEncodedBuffer.js'

let webpReady = null
let oxipngReady = null

function ensureWebp() {
  if (!webpReady) {
    webpReady = initWebpEncoder(undefined, {
      locateFile(path) {
        return String(path || '').includes('_simd')
          ? webpEncoderSimdWasmUrl
          : webpEncoderWasmUrl
      },
    })
  }
  return webpReady
}

function ensureOxipng() {
  if (!oxipngReady) {
    oxipngReady = initOxipng(oxipngWasmUrl)
  }
  return oxipngReady
}

function resolveIntensity(value) {
  const key = String(value || 'balanced').toLowerCase()
  if (key === 'max') {
    return { pngLevel: 4, webpMethod: 6 }
  }
  return { pngLevel: 3, webpMethod: 4 }
}

async function encodeLosslessWebp(imageData, lowMemory, method) {
  const module = await ensureWebp()
  const result = module.encode(imageData.data, imageData.width, imageData.height, {
    ...webpDefaults,
    lossless: 1,
    quality: 100,
    method: Math.max(0, Math.min(6, Number(method) || 4)),
    exact: 1,
    near_lossless: 100,
    alpha_quality: 100,
    low_memory: lowMemory ? 1 : 0,
  })
  if (!result?.byteLength) throw new Error('WebP 编码失败')
  return exactEncodedBuffer(result)
}

async function encodePngViaCanvas(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('无法编码 PNG')
  context.putImageData(imageData, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  if (!blob?.size) throw new Error('PNG 编码失败')
  return blob.arrayBuffer()
}

async function encodeLosslessPng(imageData, sourcePngBuffer, level) {
  const pngLevel = Math.max(1, Math.min(6, Number(level) || 3))
  try {
    await ensureOxipng()
    if (sourcePngBuffer && sourcePngBuffer.byteLength) {
      return exactEncodedBuffer(
        await optimisePng(sourcePngBuffer, {
          level: pngLevel,
          interlace: false,
          optimiseAlpha: true,
        }),
      )
    }
    return exactEncodedBuffer(
      await optimisePng(imageData, {
        level: pngLevel,
        interlace: false,
        optimiseAlpha: true,
      }),
    )
  } catch {
    return encodePngViaCanvas(imageData)
  }
}

self.onmessage = async (event) => {
  const payload = event.data || {}
  if (payload.type !== 'compress') return
  const id = payload.id
  try {
    const format = String(payload.format || 'webp').toLowerCase() === 'png' ? 'png' : 'webp'
    const width = Number(payload.width) || 0
    const height = Number(payload.height) || 0
    if (!width || !height || !payload.buffer) {
      throw new Error('图片数据无效')
    }
    const imageData = new ImageData(new Uint8ClampedArray(payload.buffer), width, height)
    const lowMemory = width * height > 8_000_000
    const intensity = resolveIntensity(payload.intensity)
    let buffer
    let mimeType
    if (format === 'png') {
      buffer = await encodeLosslessPng(
        imageData,
        payload.sourcePngBuffer || null,
        intensity.pngLevel,
      )
      mimeType = 'image/png'
    } else {
      buffer = await encodeLosslessWebp(imageData, lowMemory, intensity.webpMethod)
      mimeType = 'image/webp'
    }
    self.postMessage(
      {
        type: 'complete',
        id,
        buffer,
        mimeType,
        format,
      },
      [buffer],
    )
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : '无损压缩失败',
    })
  }
}
