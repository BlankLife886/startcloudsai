import {
  encodeLossyImageFile,
  formatBytes,
  outputFilename,
} from '../image-compress/compressEngine.js'

export const ECOMMERCE_UPLOAD_TARGET_BYTES = 2 * 1024 * 1024
export const ECOMMERCE_UPLOAD_WEBP_QUALITY = 50
const EDGE_STEPS = [0, 2560, 1920, 1280, 1080]

function fileFromEncoded(sourceFile, encoded) {
  const name = outputFilename(sourceFile.name || 'upload.jpg', encoded.format || 'webp')
  return new File([encoded.blob], name, {
    type: encoded.mimeType || 'image/webp',
    lastModified: Date.now(),
  })
}

export async function compressEcommerceUploadFile(
  file,
  {
    targetBytes = ECOMMERCE_UPLOAD_TARGET_BYTES,
    quality = ECOMMERCE_UPLOAD_WEBP_QUALITY,
    signal,
  } = {},
) {
  if (!file) throw new Error('请先选择图片')
  const limit = Math.max(1, Number(targetBytes) || ECOMMERCE_UPLOAD_TARGET_BYTES)
  if (Number(file.size || 0) <= limit) return file

  for (const maxEdge of EDGE_STEPS) {
    if (signal?.aborted) throw new DOMException('压缩已取消', 'AbortError')
    const encoded = await encodeLossyImageFile(file, {
      format: 'webp',
      quality,
      maxEdge,
      maxInputBytes: 80 * 1024 * 1024,
      signal,
    })
    if (encoded.afterBytes <= limit) return fileFromEncoded(file, encoded)
  }

  throw new Error(`压缩后仍超过 ${formatBytes(limit)}，请换一张更小的图片`)
}
