import { extractMediaOutput } from '@/services/aiWallpaper'

export function extractImageGenerationOutput(payload) {
  const sharedOutput = extractMediaOutput(payload)
  if (sharedOutput) return sharedOutput
  const data = payload?.data || {}
  const list = Array.isArray(data) ? data : Array.isArray(data?.outputs) ? data.outputs : []
  const first = list[0]
  if (typeof first === 'string') return first
  if (typeof first?.url === 'string') return first.url
  if (typeof first?.b64_json === 'string') return first.b64_json
  if (Array.isArray(data?.images) && data.images[0]) return String(data.images[0])
  if (typeof data?.url === 'string') return data.url
  if (typeof data?.b64_json === 'string') return data.b64_json
  if (typeof data?.output === 'string') return data.output
  if (typeof data?.output_url === 'string') return data.output_url
  if (typeof payload?.output === 'string') return payload.output
  return ''
}

export function extractServerAiPreviewOutput(result) {
  const payload = result?.output ?? result?.result ?? result
  return (
    (typeof payload === 'string' ? payload : '') ||
    extractMediaOutput(payload) ||
    extractMediaOutput(payload?.providerPayload) ||
    ''
  )
}

export function getPredictionResultUrl(payload) {
  if (typeof payload?.urls?.get === 'string') return payload.urls.get
  if (typeof payload?.data?.urls?.get === 'string') return payload.data.urls.get
  if (Array.isArray(payload?.data?.urls) && typeof payload.data.urls[0]?.get === 'string') {
    return payload.data.urls[0].get
  }
  return ''
}

export function normalizeImageOutput(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (value.startsWith('data:image/')) return value
  if (/^https?:\/\//i.test(value)) return value
  // 同源媒体路径（如 /api/client/.../media/result）可直接给 <img> 使用
  if (value.startsWith('/api/') || value.startsWith('/')) return value
  // 服务商偶尔只返回裸 base64。这里补齐 data URL 头，避免浏览器当成相对路径。
  if (/^(iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)/.test(value)) {
    return `data:image/png;base64,${value}`
  }
  return value
}

export function formatAiTaskError(payload, fallback = '未知错误') {
  const message = payload?.message || payload?.data?.error || payload?.error || fallback
  if (/overloaded/i.test(message)) {
    return '当前 AI 处理繁忙，请稍后重试'
  }
  return message
}

export function buildBrowserProviderDiagnostic(message, { stage, httpStatus, endpoint, payload }) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {}
  const resultUrl = getPredictionResultUrl(payload)
  const parts = [
    message,
    `stage=${stage}`,
    `endpoint=${endpoint || ''}`,
    `http=${httpStatus || ''}`,
    payload?.code !== undefined ? `providerCode=${payload.code}` : '',
    data?.status || payload?.status ? `providerStatus=${data?.status || payload?.status}` : '',
    `providerMessage=${formatAiTaskError(payload)}`,
    `hasImageOutput=${Boolean(extractImageGenerationOutput(payload))}`,
    `hasResultUrl=${Boolean(resultUrl)}`,
    resultUrl ? `resultUrlHost=${safeUrlHost(resultUrl)}` : '',
    `keys=${Object.keys(payload || {})
      .slice(0, 16)
      .join('|')}`,
    `dataKeys=${Object.keys(data || {})
      .slice(0, 16)
      .join('|')}`,
  ].filter(Boolean)
  return parts.join(' ; ')
}

export function isAiRetryableError(message) {
  const text = String(message || '').toLowerCase()
  return (
    text.includes('overloaded') ||
    text.includes('繁忙') ||
    text.includes('timeout') ||
    text.includes('超时') ||
    text.includes('429')
  )
}

function safeUrlHost(value) {
  try {
    return new URL(value, window.location.origin).host
  } catch {
    return ''
  }
}
