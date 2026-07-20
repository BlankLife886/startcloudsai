import { extractMediaOutput } from '@/services/aiWallpaper'

export function extractImageGenerationOutput(payload) {
  const sharedOutput = extractMediaOutput(payload)
  if (sharedOutput) return sharedOutput
  const data = payload?.data || {}
  const list = Array.isArray(data) ? data : Array.isArray(data?.outputs) ? data.outputs : []
  const first = list[0]
  if (typeof first === 'string') return first
  if (typeof first?.url === 'string') return first.url
  if (Array.isArray(data?.images) && data.images[0]) return String(data.images[0])
  if (typeof data?.url === 'string') return data.url
  if (typeof data?.output === 'string') return data.output
  if (typeof payload?.output === 'string') return payload.output
  return ''
}

export function extractServerAiPreviewOutput(result) {
  const payload = result?.output ?? result?.result ?? result
  return (
    (typeof payload === 'string' ? payload : '') ||
    extractMediaOutput(payload) ||
    ''
  )
}

export function normalizeImageOutput(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (value.startsWith('data:image/')) return value
  if (/^https?:\/\//i.test(value)) return value
  // 同源媒体路径（如 /api/files/...）可直接给 <img> 使用
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
