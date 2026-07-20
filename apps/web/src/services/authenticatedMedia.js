import { clientLogHeaders } from '@/services/clientLogHeaders'
import { getAuthToken, getCsrfToken } from '@/services/auth'

const mediaCache = new Map()
const inFlightMediaFetches = new Map()
const MAX_MEDIA_CACHE_ENTRIES = 36
const MAX_MEDIA_CACHE_BYTES = 48 * 1024 * 1024
const MAX_THUMBNAIL_DIMENSION = 1200
const THUMBNAIL_RESIZE_CONCURRENCY = 1
let mediaCacheBytes = 0
let trimScheduled = false
let activeThumbnailResizes = 0
const thumbnailResizeWaiters = []

function normalizedMaxDimension(options = {}) {
  const value = Math.round(Number(options?.maxDimension || 0))
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(MAX_THUMBNAIL_DIMENSION, Math.max(96, value))
}

function mediaCacheKey(url, options = {}) {
  const maxDimension = normalizedMaxDimension(options)
  return maxDimension ? `${url}::thumbnail:${maxDimension}` : url
}

function findReusableThumbnail(url, maxDimension) {
  if (!maxDimension) return null
  let best = null
  for (const [key, entry] of mediaCache) {
    if (!key.startsWith(`${url}::thumbnail:`)) continue
    const cachedDimension = Number(entry?.maxDimension || key.split('::thumbnail:').at(-1) || 0)
    if (cachedDimension < maxDimension) continue
    if (!best || cachedDimension < best.maxDimension) {
      best = { entry, maxDimension: cachedDimension }
    }
  }
  return best?.entry || null
}

async function withThumbnailResizeSlot(task) {
  if (activeThumbnailResizes >= THUMBNAIL_RESIZE_CONCURRENCY) {
    await new Promise((resolve) => thumbnailResizeWaiters.push(resolve))
  }
  activeThumbnailResizes += 1
  try {
    return await task()
  } finally {
    activeThumbnailResizes = Math.max(0, activeThumbnailResizes - 1)
    thumbnailResizeWaiters.shift()?.()
  }
}

async function decodeImageBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw(context, width, height) {
          context.drawImage(bitmap, 0, 0, width, height)
        },
        dispose() {
          bitmap.close?.()
        },
      }
    } catch {
      // Fall through to HTMLImageElement for browsers with partial bitmap support.
    }
  }

  if (typeof document === 'undefined') return null
  const objectUrl = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = objectUrl
    })
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw(context, width, height) {
        context.drawImage(image, 0, 0, width, height)
      },
      dispose() {
        image.onload = null
        image.onerror = null
        image.removeAttribute('src')
        URL.revokeObjectURL(objectUrl)
      },
    }
  } catch {
    image.removeAttribute('src')
    URL.revokeObjectURL(objectUrl)
    return null
  }
}

async function createThumbnailBlob(blob, maxDimension) {
  if (!maxDimension || typeof document === 'undefined') {
    return { blob, width: 0, height: 0, displayWidth: 0, displayHeight: 0 }
  }
  return withThumbnailResizeSlot(async () => {
    const decoded = await decodeImageBlob(blob)
    if (!decoded?.width || !decoded?.height) {
      return { blob, width: 0, height: 0, displayWidth: 0, displayHeight: 0 }
    }
    try {
      const largestDimension = Math.max(decoded.width, decoded.height)
      if (largestDimension <= maxDimension) {
        return {
          blob,
          width: decoded.width,
          height: decoded.height,
          displayWidth: decoded.width,
          displayHeight: decoded.height,
        }
      }
      const scale = maxDimension / largestDimension
      const width = Math.max(1, Math.round(decoded.width * scale))
      const height = Math.max(1, Math.round(decoded.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: true })
      if (!context) {
        return {
          blob,
          width: decoded.width,
          height: decoded.height,
          displayWidth: decoded.width,
          displayHeight: decoded.height,
        }
      }
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      decoded.draw(context, width, height)
      const thumbnail = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/webp', maxDimension <= 400 ? 0.78 : 0.84)
      })
      canvas.width = 1
      canvas.height = 1
      return {
        blob: thumbnail?.size ? thumbnail : blob,
        width: decoded.width,
        height: decoded.height,
        displayWidth: thumbnail?.size ? width : decoded.width,
        displayHeight: thumbnail?.size ? height : decoded.height,
      }
    } finally {
      decoded.dispose()
    }
  })
}

function touchMediaCache(key, entry) {
  mediaCache.delete(key)
  mediaCache.set(key, entry)
}

function isObjectUrlInUse(objectUrl = '') {
  if (!objectUrl || typeof document === 'undefined') return false
  for (const image of document.images || []) {
    if (image.currentSrc === objectUrl || image.src === objectUrl) return true
  }
  return false
}

function deleteMediaCacheEntry(key, entry = mediaCache.get(key)) {
  if (!entry || entry.promise) return false
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
  mediaCacheBytes = Math.max(
    0,
    mediaCacheBytes - Number(entry.displayBytes || entry.bytes || 0),
  )
  mediaCache.delete(key)
  return true
}

function trimMediaCache(protectedKey = '') {
  if (
    mediaCache.size <= MAX_MEDIA_CACHE_ENTRIES &&
    mediaCacheBytes <= MAX_MEDIA_CACHE_BYTES
  ) {
    return
  }
  for (const [key, entry] of mediaCache) {
    if (
      mediaCache.size <= MAX_MEDIA_CACHE_ENTRIES &&
      mediaCacheBytes <= MAX_MEDIA_CACHE_BYTES
    ) {
      break
    }
    if (entry?.promise || !entry?.objectUrl) continue
    if (key === protectedKey) continue
    // Never revoke a Blob URL while an <img> is still displaying it. Lazy image
    // components clear their src after leaving the retention area, then ask the
    // cache to trim again.
    if (isObjectUrlInUse(entry.objectUrl)) continue
    deleteMediaCacheEntry(key, entry)
  }
}

function scheduleMediaCacheTrim() {
  if (trimScheduled) return
  trimScheduled = true
  queueMicrotask(() => {
    trimScheduled = false
    trimMediaCache()
  })
}

export function isAuthenticatedAiMediaUrl(value = '') {
  const url = String(value || '')
  return (
    /\/api\/client\/business\/ai\/jobs\/[^/]+\/media\/(source|result|original-result)(?:\?|$)/i.test(
      url,
    ) ||
    /\/api\/client\/business\/ai\/jobs\/[^/]+\/upscale-experiments\/[^/]+\/(?:2K|4K|8K)\/media(?:\?|$)/i.test(
      url,
    ) ||
    /\/api\/client\/share\/mine\/[^/]+\/media(?:\?|$)/i.test(url)
  )
}

export async function fetchAuthenticatedMediaBlob(value = '', options = {}) {
  const url = String(value || '').trim()
  if (!url) throw new Error('没有可读取的图片')

  const protectedMedia = isAuthenticatedAiMediaUrl(url)
  const token = protectedMedia ? getAuthToken() : ''
  const csrfToken = protectedMedia ? getCsrfToken() : ''
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: options.cache || 'default',
    signal: options.signal,
    headers: protectedMedia
      ? clientLogHeaders({
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        })
      : undefined,
  })
  if (!response.ok) throw new Error(`任务图片读取失败(${response.status})`)

  const blob = await response.blob()
  if (!blob.size || !String(blob.type || '').startsWith('image/')) {
    throw new Error('任务图片内容无效')
  }
  return blob
}

function fetchAuthenticatedMediaBlobShared(url) {
  const cached = inFlightMediaFetches.get(url)
  if (cached) return cached
  const promise = fetchAuthenticatedMediaBlob(url).finally(() => {
    window.setTimeout(() => {
      if (inFlightMediaFetches.get(url) === promise) inFlightMediaFetches.delete(url)
    }, 1200)
  })
  inFlightMediaFetches.set(url, promise)
  return promise
}

// 任务媒体支持服务端缩略（?w=，Cloudflare Images 边缘缩放）。
// 缩略图直接取小图，省掉整张原图的下载与本地解码。
function thumbnailFetchUrl(url, maxDimension) {
  if (!maxDimension) return url
  if (!/\/api\/client\/business\/ai\/jobs\/[^/]+\/media\//i.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}w=${maxDimension}`
}

export async function resolveAuthenticatedMediaUrl(value = '', options = {}) {
  const url = String(value || '').trim()
  if (!url || !isAuthenticatedAiMediaUrl(url)) return url
  const maxDimension = normalizedMaxDimension(options)
  const cacheKey = mediaCacheKey(url, { maxDimension })

  const cached = mediaCache.get(cacheKey)
  if (cached?.objectUrl) {
    touchMediaCache(cacheKey, cached)
    return cached.objectUrl
  }
  if (cached?.promise) return cached.promise
  // The stage preview is mounted before its filmstrip/history variants. Reuse
  // that decoded thumbnail instead of downloading and decoding the same 8K
  // file again for every smaller viewport.
  const reusable = findReusableThumbnail(url, maxDimension)
  if (reusable?.objectUrl) return reusable.objectUrl
  if (reusable?.promise) return reusable.promise

  const promise = fetchAuthenticatedMediaBlobShared(thumbnailFetchUrl(url, maxDimension))
    .then(async (blob) => {
      // 服务端已缩好时这里等于直通；仅在服务端缩放不可用时才本地兜底压缩。
      const thumbnail = await createThumbnailBlob(blob, maxDimension)
      const displayBlob = thumbnail.blob
      const objectUrl = URL.createObjectURL(displayBlob)
      mediaCacheBytes += displayBlob.size
      touchMediaCache(cacheKey, {
        objectUrl,
        maxDimension,
        bytes: blob.size,
        displayBytes: displayBlob.size,
        width: thumbnail.width,
        height: thumbnail.height,
        displayWidth: thumbnail.displayWidth,
        displayHeight: thumbnail.displayHeight,
      })
      trimMediaCache(cacheKey)
      return objectUrl
    })
    .catch((error) => {
      mediaCache.delete(cacheKey)
      throw error
    })

  mediaCache.set(cacheKey, { promise, maxDimension })
  return promise
}

export function getAuthenticatedMediaMetadata(value = '', options = {}) {
  const url = String(value || '').trim()
  if (!url || !isAuthenticatedAiMediaUrl(url)) return null
  const maxDimension = normalizedMaxDimension(options)
  const entry =
    mediaCache.get(mediaCacheKey(url, { maxDimension })) ||
    findReusableThumbnail(url, maxDimension)
  if (!entry?.objectUrl) return null
  return {
    bytes: Math.max(0, Number(entry.bytes || 0)),
    displayBytes: Math.max(0, Number(entry.displayBytes || 0)),
    width: Math.max(0, Number(entry.width || 0)),
    height: Math.max(0, Number(entry.height || 0)),
    displayWidth: Math.max(0, Number(entry.displayWidth || 0)),
    displayHeight: Math.max(0, Number(entry.displayHeight || 0)),
  }
}

export async function downloadAuthenticatedMedia(value = '', filename = 'ai-image.png') {
  const source = String(value || '').trim()
  if (!source) throw new Error('没有可下载的图片')
  const blob = await fetchAuthenticatedMediaBlob(source, { cache: 'no-store' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = resolveMediaDownloadFilename(filename, blob.type)
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    // Large 4K/8K blobs may still be consumed by the browser download process
    // after the synthetic click returns. Revoking after one second can abort it.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }
  return {
    bytes: blob.size,
    contentType: blob.type,
    filename: anchor.download,
  }
}

function resolveMediaDownloadFilename(filename, contentType) {
  const requested = String(filename || 'ai-image').trim() || 'ai-image'
  const extension =
    String(contentType || '').toLowerCase() === 'image/webp'
      ? '.webp'
      : String(contentType || '').toLowerCase() === 'image/jpeg'
        ? '.jpg'
        : String(contentType || '').toLowerCase() === 'image/gif'
          ? '.gif'
          : String(contentType || '').toLowerCase() === 'image/avif'
            ? '.avif'
            : '.png'
  return `${requested.replace(/\.(?:png|jpe?g|webp|gif|avif)$/i, '')}${extension}`
}

export function releaseAuthenticatedMediaUrl(value = '', objectUrl = '', options = {}) {
  const url = String(value || '').trim()
  if (!url || !isAuthenticatedAiMediaUrl(url)) return
  const cached = mediaCache.get(mediaCacheKey(url, options))
  if (!cached?.objectUrl || (objectUrl && cached.objectUrl !== objectUrl)) return
  scheduleMediaCacheTrim()
}

export function clearAuthenticatedMediaCache() {
  mediaCache.forEach((entry) => {
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl)
  })
  mediaCache.clear()
  inFlightMediaFetches.clear()
  mediaCacheBytes = 0
}
