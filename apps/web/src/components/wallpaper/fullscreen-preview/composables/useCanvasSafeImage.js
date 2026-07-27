import { proxyWallhavenImageUrl } from '@/services/api'
import {
  getImageCrossorigin,
  isImageProxyUrl,
  shouldUseAnonymousImageCrossorigin,
} from '@/utils/imageRequest'

export { isInlineImageData } from '@/utils/imageRequest'

// canvas 会被跨域图片污染；这里统一把远程图转成代理地址并设置合适的 crossorigin。
export function shouldUseAnonymousCrossorigin(url) {
  return shouldUseAnonymousImageCrossorigin(url)
}

export function toCanvasSafeImageSrc(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (value.startsWith('data:') || value.startsWith('blob:')) return value
  if (isImageProxyUrl(value)) return value
  if (value.startsWith('/')) return value
  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.origin === window.location.origin) return parsed.href
    return proxyWallhavenImageUrl(parsed.href)
  } catch {
    return value
  }
}

export function getPreviewImageCrossorigin(url) {
  return getImageCrossorigin(url)
}

export function loadCanvasSafeImageFromSrc(src, { timeout = 15000 } = {}) {
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    const safeSrc = toCanvasSafeImageSrc(src)
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), timeout)
    if (shouldUseAnonymousCrossorigin(safeSrc)) {
      img.crossOrigin = 'anonymous'
    }
    img.referrerPolicy = 'no-referrer'
    img.onload = () => done(img)
    img.onerror = () => done(null)
    img.src = safeSrc || src
  })
}
