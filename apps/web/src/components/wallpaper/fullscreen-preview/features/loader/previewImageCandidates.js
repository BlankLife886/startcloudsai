import { proxyWallhavenImageUrl } from '@/services/api'

export function dedupePreviewUrls(urls = []) {
  const urlSet = new Set()
  return urls.filter((url) => {
    if (!url || urlSet.has(url)) return false
    urlSet.add(url)
    return true
  })
}

export function getProxiedPreviewUrl(url) {
  return url ? proxyWallhavenImageUrl(url) : ''
}

function isWallhavenFullUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'w.wallhaven.cc' && parsed.pathname.startsWith('/full/')
  } catch {
    return false
  }
}

function buildWallhavenFullGuesses(id) {
  if (!id || id.length < 2) return []
  const prefix = id.substring(0, 2)
  return [
    `https://w.wallhaven.cc/full/${prefix}/wallhaven-${id}.jpg`,
    `https://w.wallhaven.cc/full/${prefix}/wallhaven-${id}.png`,
  ]
}

/** 全屏预览只展示 Wallhaven full 原图，不再回退到 original/large/small 缩略图。 */
export function buildPreviewFullUrls(wallpaper, detailImage = null) {
  const id = wallpaper?.id || ''
  const thumbs = wallpaper?.thumbs || {}
  const detailThumbs = detailImage?.thumbs || {}
  return dedupePreviewUrls(
    [
      detailImage?.path,
      wallpaper?.path,
      wallpaper?.url,
      wallpaper?.fullUrl,
      wallpaper?.full_url,
      wallpaper?.raw_path,
      detailImage?.url,
      detailImage?.fullUrl,
      detailImage?.full_url,
      thumbs.full,
      thumbs.fullUrl,
      thumbs.full_url,
      detailThumbs.full,
      detailThumbs.fullUrl,
      detailThumbs.full_url,
      ...buildWallhavenFullGuesses(id),
    ].filter(isWallhavenFullUrl),
  )
}
