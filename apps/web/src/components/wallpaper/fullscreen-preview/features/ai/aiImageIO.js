import { buildApiUrl, proxyWallhavenImageUrl } from '@/services/api'
import { clientLogHeaders } from '@/services/clientLogHeaders'
import { getApiData, getApiErrorMessage, isApiSuccess } from '@/services/apiResponse'
import { webDebugInfo } from '@/services/debugLog'
import { normalizeImageOutput } from '@/components/wallpaper/fullscreen-preview/features/ai/aiPreviewUtils'

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

export function isWallhavenUrl(url) {
  return /(^https?:\/\/)?([a-z0-9-]+\.)?(wallhaven\.cc|whvn\.cc)\//i.test(String(url || ''))
}

export async function fetchImageBlobForAi(url) {
  const sourceUrl = String(url || '').trim()
  if (!sourceUrl) return null

  const candidates = [sourceUrl]
  if (isWallhavenUrl(sourceUrl)) {
    candidates.push(proxyWallhavenImageUrl(sourceUrl))
  }

  let lastError = null
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        method: 'GET',
        cache: 'no-store',
        credentials: candidate.includes('/api/') ? 'include' : 'same-origin',
        referrerPolicy: 'no-referrer',
        headers: candidate.includes('/api/') ? clientLogHeaders() : undefined,
      })
      if (!response.ok) throw new Error(`图片拉取失败(${response.status})`)
      const contentType = response.headers.get('content-type') || ''
      if (contentType && !contentType.startsWith('image/')) {
        throw new Error('返回内容不是图片')
      }
      const blob = await response.blob()
      if (!blob?.size) throw new Error('图片内容为空')
      return { blob, source: candidate }
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`输入图读取失败：${lastError?.message || '未知错误'}`)
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

export async function uploadAiTempBlob(blob, { featureKey = 'ai.optimize' } = {}) {
  const formData = new FormData()
  formData.append('file', blob, `ai-input-${Date.now()}.jpg`)
  formData.append('featureKey', String(featureKey || 'ai.optimize'))
  const endpoint = buildApiUrl('/ai-temp-upload')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: clientLogHeaders(),
    body: formData,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !isApiSuccess(payload, response.status)) {
    throw new Error(getApiErrorMessage(payload, `临时上传失败(${response.status})`))
  }
  const data = getApiData(payload)
  const tempUrl = String(data?.url || '').trim()
  if (!tempUrl) throw new Error('临时上传未返回可用 URL')
  return tempUrl
}

export async function prepareAiInputSourceUrl({
  sourceUrl,
  model,
  loadImageFromSrc,
  onStatus = null,
  maxUploadMb = 10,
  providerPayloadMaxMb = null,
  featureKey = 'ai.optimize',
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
  } catch (error) {
    console.warn('[AI Input Debug] 输入图拉取失败，跳过上传压缩流程:', error)
    return sourceUrl
  }

  const originalBlob = input.blob
  if (originalBlob.size <= providerMaxBytes) {
    return sourceUrl
  }

  if (typeof onStatus === 'function') {
    onStatus('正在压缩输入图，避免上游请求体过大...')
  }
  const compressed = await compressBlobToLimit({
    blob: originalBlob,
    loadImageFromSrc,
    maxBytes: providerMaxBytes,
  })
  if (!compressed || compressed.size > uploadMaxBytes || compressed.size > providerMaxBytes) {
    throw new Error(
      `输入图压缩后仍超过上游安全大小（${normalizedProviderMaxMb}MB），请换一张更小的图片再试`,
    )
  }

  const tempUrl = await uploadAiTempBlob(compressed, { featureKey })
  webDebugInfo('ai', '[AI Input Debug] 已启用临时上传输入图', {
    fromBytes: originalBlob.size,
    toBytes: compressed.size,
    tempUrl,
  })
  return tempUrl
}

export async function fetchImageAsDataUrl({ url, notificationService }) {
  const sourceUrl = String(url || '').trim()
  if (!sourceUrl) return ''
  if (sourceUrl.startsWith('data:image/')) return sourceUrl

  const candidates = [sourceUrl]
  if (isWallhavenUrl(sourceUrl)) {
    try {
      candidates.push(proxyWallhavenImageUrl(sourceUrl))
    } catch {
      // ignore
    }
  }

  let lastError = null
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        method: 'GET',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: candidate.includes('/api/') ? clientLogHeaders() : undefined,
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
      lastError = error
    }
  }

  // 某些第三方 AI 图床存在 CORS 限制，无法转 dataURL；此时回退远程 URL，避免整次任务失败。
  notificationService?.warning?.(
    `AI 结果已生成，但当前源站限制本地转码，暂以远程地址展示（建议尽快下载）：${lastError?.message || '未知原因'}`,
  )
  return sourceUrl
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
