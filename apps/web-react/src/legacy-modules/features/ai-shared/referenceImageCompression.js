/**
 * 参考图上传前压缩：超过阈值的图片转为 WebP（不缩边，保留透明通道）。
 * 服务端对单个任务的输入图有累计大小上限，多张手机原图直接上传很容易超限。
 * 仅用于参考图；蒙版、抠图原图等需要精确像素的输入不要走这里。
 */
import {
  encodeLossyImageFile,
  outputFilename,
} from '../image-compress/compressEngine.js'

export const REFERENCE_COMPRESSION_THRESHOLD_BYTES = 1024 * 1024
export const REFERENCE_WEBP_QUALITY = 80

export function needsReferenceCompression(file) {
  return Number(file?.size || 0) > REFERENCE_COMPRESSION_THRESHOLD_BYTES
}

/**
 * @param {File} file
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.fallbackToOriginal=true] 压缩失败（如 GIF/HEIC 等不支持的格式）时退回原图
 */
export async function compressReferenceImageFile(file, { signal, fallbackToOriginal = true } = {}) {
  if (!file) throw new Error('请先选择图片')
  if (!needsReferenceCompression(file)) return file
  try {
    const encoded = await encodeLossyImageFile(file, {
      format: 'webp',
      quality: REFERENCE_WEBP_QUALITY,
      maxEdge: 0,
      maxInputBytes: 80 * 1024 * 1024,
      signal,
    })
    if (fallbackToOriginal && encoded.blob.size >= file.size) return file
    return new File(
      [encoded.blob],
      outputFilename(file.name || 'reference-image', encoded.format || 'webp'),
      { type: encoded.mimeType || 'image/webp', lastModified: Date.now() },
    )
  } catch (error) {
    if (!fallbackToOriginal || error?.name === 'AbortError' || signal?.aborted) throw error
    return file
  }
}
