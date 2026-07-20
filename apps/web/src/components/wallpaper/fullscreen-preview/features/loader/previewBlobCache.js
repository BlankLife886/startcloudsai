import { toCanvasSafeImageSrc } from '@/components/wallpaper/fullscreen-preview/composables/useCanvasSafeImage'
import storageService from '@/services/storage'

const previewSourceCache = new Map()
const DEFAULT_MAX_CACHE_ITEMS = 10
const DEFAULT_MAX_CACHE_BYTES = 80 * 1024 * 1024
const MIN_CACHE_ITEMS = 1
const MAX_CACHE_ITEMS = 100
const MIN_CACHE_BYTES = 1 * 1024 * 1024
const MAX_CACHE_BYTES = 4 * 1024 * 1024 * 1024
let previewSourceCacheBytes = 0

function normalizePreviewCacheKey(id) {
  return String(id || '').trim()
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function getSettingsStore() {
  const settings = storageService.get('settings', {})
  return settings && typeof settings === 'object' ? settings : {}
}

export function readPreviewBlobCacheConfig() {
  const settings = getSettingsStore()
  const enabled = settings.fullscreen_preview_blob_cache_enabled ?? settings.cache_images ?? true

  return {
    enabled: enabled !== false,
    // 张数只能按整数淘汰；容量则保留用户输入的 MB 数值，不额外规整。
    maxItems: Math.floor(
      clampNumber(
        settings.fullscreen_preview_blob_cache_max_items,
        DEFAULT_MAX_CACHE_ITEMS,
        MIN_CACHE_ITEMS,
        MAX_CACHE_ITEMS,
      ),
    ),
    maxBytes:
      clampNumber(
        settings.fullscreen_preview_blob_cache_max_mb,
        DEFAULT_MAX_CACHE_BYTES / (1024 * 1024),
        MIN_CACHE_BYTES / (1024 * 1024),
        MAX_CACHE_BYTES / (1024 * 1024),
      ) *
      1024 *
      1024,
  }
}

function getPreviewSourceBlobBytes(entry) {
  return Math.max(0, Number(entry?.blobSize || 0) || 0)
}

function releasePreviewSourceBlobUrl(entry) {
  const blobUrl = String(entry?.blobUrl || '').trim()
  if (!blobUrl.startsWith('blob:')) return
  try {
    URL.revokeObjectURL(blobUrl)
  } catch {
    // blob URL 释放失败不影响预览，只是让浏览器自行回收。
  }
}

function trimPreviewBlobCache() {
  const config = readPreviewBlobCacheConfig()
  if (!config.enabled) {
    clearPreviewBlobCache()
    return
  }

  while (
    previewSourceCache.size > config.maxItems ||
    (previewSourceCache.size > 1 && previewSourceCacheBytes > config.maxBytes)
  ) {
    const oldestKey = previewSourceCache.keys().next().value
    if (!oldestKey) break
    const oldestEntry = previewSourceCache.get(oldestKey) || null
    previewSourceCache.delete(oldestKey)
    previewSourceCacheBytes -= getPreviewSourceBlobBytes(oldestEntry)
    releasePreviewSourceBlobUrl(oldestEntry)
  }
}

export function clearPreviewBlobCache() {
  previewSourceCache.forEach((entry) => releasePreviewSourceBlobUrl(entry))
  previewSourceCache.clear()
  previewSourceCacheBytes = 0
}

export function readPreviewSource(id) {
  if (!readPreviewBlobCacheConfig().enabled) {
    clearPreviewBlobCache()
    return null
  }

  const key = normalizePreviewCacheKey(id)
  if (!key) return null
  const entry = previewSourceCache.get(key) || null
  if (!entry) return null

  // 读取时刷新 LRU 顺序；用户反复打开的图应该尽量留在缓存里。
  previewSourceCache.delete(key)
  previewSourceCache.set(key, { ...entry, updatedAt: Date.now() })
  return previewSourceCache.get(key) || null
}

export function rememberPreviewSource(id, payload = {}) {
  const config = readPreviewBlobCacheConfig()
  if (!config.enabled) {
    clearPreviewBlobCache()
    return
  }

  const key = normalizePreviewCacheKey(id)
  if (!key) return

  const existing = previewSourceCache.get(key) || null
  const next = {
    ...(existing || {}),
    ...payload,
    updatedAt: Date.now(),
  }

  const existingBytes = getPreviewSourceBlobBytes(existing)
  const nextBytes = getPreviewSourceBlobBytes(next)
  if (existing?.blobUrl && existing.blobUrl !== next.blobUrl) {
    releasePreviewSourceBlobUrl(existing)
  }

  previewSourceCache.delete(key)
  previewSourceCache.set(key, next)
  previewSourceCacheBytes += nextBytes - existingBytes
  trimPreviewBlobCache()
}

export async function fetchPreviewImageBlob(sourceUrl, { timeout = 15000 } = {}) {
  const safeUrl = toCanvasSafeImageSrc(sourceUrl)
  if (!safeUrl) return null

  // 只拉取当前用户真正打开的 full 图；是否保留到内存由设置项控制。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(safeUrl, {
      method: 'GET',
      cache: 'default',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`图片请求失败(${response.status})`)
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.startsWith('image/')) {
      throw new Error('返回内容不是图片')
    }
    const blob = await response.blob()
    if (!blob?.size) throw new Error('图片内容为空')
    return blob
  } finally {
    clearTimeout(timer)
  }
}

export async function loadPreviewBlobUrl(sourceUrl, cacheKey, imageInfo = null) {
  const safeUrl = toCanvasSafeImageSrc(sourceUrl)
  if (!safeUrl) return ''

  const config = readPreviewBlobCacheConfig()
  const cachedSource = readPreviewSource(cacheKey)
  if (config.enabled && cachedSource?.blobUrl && cachedSource.fullUrl === safeUrl) {
    return cachedSource.blobUrl
  }

  const blob = await fetchPreviewImageBlob(safeUrl)
  if (!blob) return ''
  const blobUrl = URL.createObjectURL(blob)
  if (config.enabled) {
    rememberPreviewSource(cacheKey, {
      fullUrl: safeUrl,
      blobUrl,
      blobSize: blob.size,
      imageInfo: imageInfo || cachedSource?.imageInfo || null,
    })
  }
  return blobUrl
}

export function isLikelyFullPreviewUrl(url) {
  const value = String(url || '').trim()
  if (!value) return false
  try {
    const parsed = new URL(value, window.location.origin)
    const proxiedUrl = parsed.searchParams.get('url') || parsed.href
    return /https:\/\/w\.wallhaven\.cc\/full\//i.test(proxiedUrl)
  } catch {
    return /w\.wallhaven\.cc\/full\//i.test(value)
  }
}

export async function promoteLoadedImageToPreviewBlobCache({
  id,
  fullUrl,
  imageElement,
  imageInfo = null,
}) {
  const config = readPreviewBlobCacheConfig()
  if (!config.enabled) return false
  const key = normalizePreviewCacheKey(id)
  const safeUrl = toCanvasSafeImageSrc(fullUrl)
  if (!key || !safeUrl || !isLikelyFullPreviewUrl(safeUrl)) return false

  const cached = readPreviewSource(key)
  if (cached?.blobUrl && cached.fullUrl === safeUrl) return true

  let blob = null
  const img = imageElement
  if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0)
        blob = await new Promise((resolve) => {
          canvas.toBlob((value) => resolve(value), 'image/png')
        })
      }
    } catch {
      // 跨域或浏览器限制时，降级为 fetch；如果 HTTP 缓存命中，通常不会重新下载图片内容。
      blob = null
    }
  }

  if (!blob) {
    blob = await fetchPreviewImageBlob(safeUrl).catch(() => null)
  }
  if (!blob?.size) return false

  rememberPreviewSource(key, {
    fullUrl: safeUrl,
    blobUrl: URL.createObjectURL(blob),
    blobSize: blob.size,
    imageInfo,
  })
  return true
}
