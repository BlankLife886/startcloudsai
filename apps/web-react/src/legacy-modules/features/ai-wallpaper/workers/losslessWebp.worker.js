import encodeWebp, { init as initWebpEncoder } from '@jsquash/webp/encode.js'
import webpEncoderWasmUrl from '@jsquash/webp/codec/enc/webp_enc.wasm?url'
import webpEncoderSimdWasmUrl from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url'

let encoderReady = null

function ensureEncoder() {
  if (!encoderReady) {
    encoderReady = initWebpEncoder(undefined, {
      locateFile(path) {
        return String(path || '').includes('_simd')
          ? webpEncoderSimdWasmUrl
          : webpEncoderWasmUrl
      },
    })
  }
  return encoderReady
}

self.onmessage = async (event) => {
  const payload = event.data || {}
  if (payload.type !== 'encode') return
  try {
    await ensureEncoder()
    const imageData = new ImageData(
      new Uint8ClampedArray(payload.buffer),
      Number(payload.width),
      Number(payload.height),
    )
    const encoded = await encodeWebp(imageData, {
      lossless: 1,
      quality: 100,
      method: 4,
      exact: 1,
      near_lossless: 100,
      alpha_quality: 100,
      low_memory: payload.lowMemory ? 1 : 0,
    })
    self.postMessage({ type: 'complete', buffer: encoded }, [encoded])
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '无损 WebP 编码失败',
    })
  }
}
