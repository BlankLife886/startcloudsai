/**
 * AI 输入图读取/压缩/上传工具（从旧 fullscreen-preview 迁出）。
 * 上传统一走新契约 /api/uploads。
 */
import { uploadFile } from '@/services/tasksApi'
import { normalizeImageOutput } from './aiPreviewUtils'

const MB_BYTES = 1024 * 1024
const PROVIDER_PAYLOAD_BODY_BUFFER = 0.92

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片转码失败'))
    reader.readAsDataURL(blob)
  })
}

export async function fetchImageBlobForAi(url) {
  const sourceUrl = String(url || '').trim()
  if (!sourceUrl) return null

  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: sourceUrl.includes('/api/') ? 'include' : 'same-origin',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) throw new Error(`图片拉取失败(${response.status})`)
    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.startsWith('image/')) {
      throw new Error('返回内容不是图片')
    }
    const blob = await response.blob()
    if (!blob?.size) throw new Error('图片内容为空')
    return { blob, source: sourceUrl }
  } catch (error) {
    throw new Error(`输入图读取失败：${error?.message || '未知错误'}`, { cause: error })
  }
}

function blobFromCanvas(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas 导出失败'))
          return
        }
        resolve(blob)
      },
      type,
      quality,
    )
  })
}

export async function compressBlobToLimit({
  blob,
  loadImageFromSrc,
  maxBytes = Number.POSITIVE_INFINITY,
}) {
  if (!blob || blob.size <= maxBytes) return blob

  const imageUrl = URL.createObjectURL(blob)
  try {
    const img = await loadImageFromSrc(imageUrl)
    if (!img) throw new Error('压缩前图片加载失败')
    const naturalWidth = Math.max(1, Number(img.naturalWidth || img.width || 1))
    const naturalHeight = Math.max(1, Number(img.naturalHeight || img.height || 1))
    const maxEdge = Math.max(naturalWidth, naturalHeight)
    const edgeScale = maxEdge > 3200 ? 3200 / maxEdge : 1
    const qualitySteps = [0.92, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5]
    const scaleSteps = normalizeScaleSteps([
      edgeScale,
      edgeScale * 0.92,
      edgeScale * 0.84,
      edgeScale * 0.76,
      edgeScale * 0.68,
      edgeScale * 0.6,
      edgeScale * 0.52,
      edgeScale * 0.44,
    ])

    let best = blob
    for (const scale of scaleSteps) {
      const targetWidth = Math.max(1, Math.round(naturalWidth * scale))
      const targetHeight = Math.max(1, Math.round(naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

      for (const quality of qualitySteps) {
        const candidate = await blobFromCanvas(canvas, 'image/jpeg', quality)
        if (candidate.size < best.size) best = candidate
        if (candidate.size <= maxBytes) {
          return candidate
        }
      }
    }
    return best
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

function normalizeScaleSteps(values) {
  const seen = new Set()
  const steps = []
  values.forEach((value) => {
    const normalized = Math.max(0.3, Math.min(1, Number(value) || 1))
    const key = normalized.toFixed(3)
    if (seen.has(key)) return
    seen.add(key)
    steps.push(normalized)
  })
  return steps
}

/** 上传输入图 blob，返回可展示/可下发的 URL（内部走 /api/uploads）。 */
export async function uploadAiTempBlob(blob, _options = {}) {
  const file = new File([blob], `ai-input-${Date.now()}.jpg`, {
    type: blob.type || 'image/jpeg',
  })
  const { registerUploadedUrl } = await import('@/services/aiWallpaper').catch(() => ({}))
  const uploaded = await uploadFile(file)
  if (typeof registerUploadedUrl === 'function') registerUploadedUrl(uploaded.url, uploaded.key)
  const tempUrl = String(uploaded?.url || '').trim()
  if (!tempUrl) throw new Error('上传未返回可用 URL')
  return tempUrl
}

export async function prepareAiInputSourceUrl({
  sourceUrl,
  loadImageFromSrc,
  onStatus = null,
  maxUploadMb = 10,
  providerPayloadMaxMb = null,
}) {
  const normalizedMaxUploadMb = Math.max(1, Number(maxUploadMb) || 10)
  const normalizedProviderMaxMb = Math.max(
    1,
    Number(providerPayloadMaxMb) || normalizedMaxUploadMb,
  )
  const uploadMaxBytes = normalizedMaxUploadMb * MB_BYTES
  const providerMaxBytes = Math.floor(
    Math.min(normalizedMaxUploadMb, normalizedProviderMaxMb) *
      MB_BYTES *
      PROVIDER_PAYLOAD_BODY_BUFFER,
  )
  let input = null
  try {
    if (typeof onStatus === 'function') onStatus('正在检查输入图大小...')
    input = await fetchImageBlobForAi(sourceUrl)
  } catch {
    return sourceUrl
  }

  const originalBlob = input.blob
  if (originalBlob.size <= providerMaxBytes) {
    return sourceUrl
  }

  if (typeof onStatus === 'function') {
    onStatus('正在压缩输入图，避免请求体过大...')
  }
  const compressed = await compressBlobToLimit({
    blob: originalBlob,
    loadImageFromSrc,
    maxBytes: providerMaxBytes,
  })
  if (!compressed || compressed.size > uploadMaxBytes || compressed.size > providerMaxBytes) {
    throw new Error(
      `输入图压缩后仍超过安全大小（${normalizedProviderMaxMb}MB），请换一张更小的图片再试`,
    )
  }

  return uploadAiTempBlob(compressed)
}

export async function fetchImageAsDataUrl({ url, notificationService }) {
  const sourceUrl = String(url || '').trim()
  if (!sourceUrl) return ''
  if (sourceUrl.startsWith('data:image/')) return sourceUrl

  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      credentials: sourceUrl.includes('/api/') ? 'include' : 'same-origin',
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text || `图片请求失败（${response.status}）`)
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.startsWith('image/')) {
      const text = await response.text().catch(() => '')
      throw new Error(text || '返回内容不是图片')
    }
    const blob = await response.blob()
    if (!blob?.size) throw new Error('图片内容为空')
    return await blobToDataUrl(blob)
  } catch (error) {
    // 某些源站存在 CORS 限制，无法转 dataURL；回退远程 URL，避免整次任务失败。
    notificationService?.warning?.(
      `AI 结果已生成，但当前源站限制本地转码，暂以远程地址展示（建议尽快下载）：${error?.message || '未知原因'}`,
    )
    return sourceUrl
  }
}

export async function materializeAiOutput({ rawOutput, notificationService, onStatus = null }) {
  const normalized = normalizeImageOutput(rawOutput)
  if (!normalized) return ''
  if (normalized.startsWith('data:image/')) return normalized
  if (/^https?:\/\//i.test(normalized)) {
    if (typeof onStatus === 'function') {
      onStatus('AI 已返回图片，正在转为本地可下载结果...')
    }
    return await fetchImageAsDataUrl({ url: normalized, notificationService })
  }
  return normalized
}
