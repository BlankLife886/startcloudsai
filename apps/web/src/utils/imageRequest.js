// 图片请求属性统一放这里：同一张代理图片必须用同一种请求模式，浏览器缓存才能稳定复用。
const loadedImageUrls = new Set()
const MAX_LOADED_IMAGE_URLS = 260

export function isInlineImageData(url) {
  const value = String(url || '').trim()
  return value.startsWith('data:image/') || value.startsWith('blob:')
}

export function normalizeImageRequestUrl(url) {
  const value = String(url || '').trim()
  if (!value || isInlineImageData(value)) return value
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    return new URL(value, base).href
  } catch {
    return value
  }
}

export function isImageProxyUrl(url) {
  const value = String(url || '').trim()
  if (!value) return false
  if (value.startsWith('/api/image-proxy')) return true
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const parsed = new URL(value, base)
    return parsed.pathname === '/api/image-proxy'
  } catch {
    return false
  }
}

export function shouldUseAnonymousImageCrossorigin(url) {
  const value = String(url || '').trim()
  if (!value || isInlineImageData(value)) return false
  if (isImageProxyUrl(value)) return true
  if (value.startsWith('/')) return true
  try {
    if (typeof window === 'undefined') return false
    const parsed = new URL(value, window.location.origin)
    return parsed.origin === window.location.origin
  } catch {
    return false
  }
}

export function getImageCrossorigin(url) {
  return shouldUseAnonymousImageCrossorigin(url) ? 'anonymous' : null
}

export function markLoadedImageUrl(url) {
  const normalized = normalizeImageRequestUrl(url)
  if (!normalized) return
  loadedImageUrls.delete(normalized)
  loadedImageUrls.add(normalized)
  if (loadedImageUrls.size <= MAX_LOADED_IMAGE_URLS) return
  const oldest = loadedImageUrls.values().next().value
  loadedImageUrls.delete(oldest)
}

export function hasLoadedImageUrl(url) {
  const normalized = normalizeImageRequestUrl(url)
  return Boolean(normalized && loadedImageUrls.has(normalized))
}
