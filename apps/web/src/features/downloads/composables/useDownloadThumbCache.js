/**
 * 公开缩略图预热缓存：提前 decode，配合浏览器 HTTP 缓存，
 * 虚拟列表滚动时减少白屏与重复骨架闪烁。
 */
const MAX_ENTRIES = 96
const cache = new Map()

function trimCache() {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
}

export function isDownloadThumbReady(url = '') {
  const key = String(url || '').trim()
  return key ? cache.get(key) === 'ready' : false
}

export function warmDownloadThumb(url = '') {
  const key = String(url || '').trim()
  if (!key || typeof Image === 'undefined') return
  if (cache.has(key)) return

  cache.set(key, 'loading')
  trimCache()

  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    cache.set(key, 'ready')
  }
  image.onerror = () => {
    cache.set(key, 'error')
  }
  image.src = key
}

export function warmDownloadThumbs(urls = [], limit = 24) {
  const seen = new Set()
  for (const raw of urls) {
    if (seen.size >= limit) break
    const key = String(raw || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    warmDownloadThumb(key)
  }
}

export function clearDownloadThumbCache() {
  cache.clear()
}
