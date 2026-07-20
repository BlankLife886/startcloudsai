import { proxyWallhavenImageUrl } from '@/services/api'

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function decodeImageProxyUrl(url) {
  if (!url || typeof url !== 'string') return ''

  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const parsed = new URL(url, baseUrl)
    const proxiedUrl = parsed.searchParams.get('url')
    if (parsed.pathname.endsWith('/image-proxy') && proxiedUrl) {
      return proxiedUrl
    }
  } catch {
    return url
  }

  return url
}

export function buildFullImageUrlFromThumb(url, wallpaperId) {
  const sourceUrl = decodeImageProxyUrl(url)
  if (!sourceUrl || !wallpaperId) return sourceUrl

  try {
    const parsed = new URL(sourceUrl)
    const prefix = wallpaperId.substring(0, 2)
    if (parsed.hostname === 'th.wallhaven.cc' || parsed.pathname.includes('/small/')) {
      return `https://w.wallhaven.cc/full/${prefix}/wallhaven-${wallpaperId}.jpg`
    }
  } catch {
    return sourceUrl
  }

  return sourceUrl
}

export function getCandidateImageUrls(wallpaperId, wallpaperData = {}, taskUrl = '') {
  const rawThumbs = wallpaperData.raw_thumbs || {}
  const candidates = [
    wallpaperData.path,
    wallpaperData.image_url,
    wallpaperData.url,
    taskUrl,
    wallpaperData.raw_thumbnail,
    rawThumbs.original,
    rawThumbs.large,
    rawThumbs.small,
    wallpaperData.thumbnail,
  ]
    .filter(Boolean)
    .map((url) => decodeImageProxyUrl(url))

  const fullImageCandidates = candidates.map((url) => buildFullImageUrlFromThumb(url, wallpaperId))
  const prefix = wallpaperId ? wallpaperId.substring(0, 2) : ''

  if (wallpaperId && prefix) {
    fullImageCandidates.push(
      `https://w.wallhaven.cc/full/${prefix}/wallhaven-${wallpaperId}.jpg`,
      `https://w.wallhaven.cc/full/${prefix}/wallhaven-${wallpaperId}.png`,
    )
  }

  return [...new Set(fullImageCandidates.filter(Boolean))]
}

export function getExtensionFromContentType(contentType = '') {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return ''
}

export function getExtensionFromUrl(url = '') {
  try {
    const pathname = new URL(decodeImageProxyUrl(url), window.location.origin).pathname
    const match = pathname.match(/\.([a-z0-9]+)$/i)
    return match ? match[1].toLowerCase() : ''
  } catch {
    const match = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)
    return match ? match[1].toLowerCase() : ''
  }
}

export function buildDownloadFilename(downloadTask, contentType = '', sourceUrl = '') {
  const customFilename =
    downloadTask.options.customFilename ||
    downloadTask.options.file_name ||
    downloadTask.options.custom_file_name

  const extension =
    getExtensionFromUrl(customFilename || '') ||
    getExtensionFromContentType(contentType) ||
    getExtensionFromUrl(sourceUrl) ||
    'jpg'

  if (customFilename) {
    return /\.[a-z0-9]+$/i.test(customFilename) ? customFilename : `${customFilename}.${extension}`
  }

  return `wallhaven-${downloadTask.wallpaperId}.${extension}`
}

export function buildImageProxyDownloadUrl(sourceUrl, filename) {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const decodedSourceUrl = decodeImageProxyUrl(sourceUrl)

  try {
    const source = new URL(decodedSourceUrl, baseUrl)
    if (
      source.protocol === 'https:' &&
      ['th.wallhaven.cc', 'w.wallhaven.cc'].includes(source.hostname)
    ) {
      const sameOriginProxyUrl = new URL('/api/image-proxy', baseUrl)
      sameOriginProxyUrl.searchParams.set('url', source.href)
      sameOriginProxyUrl.searchParams.set('v', '2')
      sameOriginProxyUrl.searchParams.set('download', '1')
      sameOriginProxyUrl.searchParams.set('filename', filename)
      return sameOriginProxyUrl.toString()
    }
  } catch {
    /* Fall back to the generic proxy handling below. */
  }

  const proxiedUrl = proxyWallhavenImageUrl(sourceUrl)
  const parsed = new URL(proxiedUrl, baseUrl)
  // 非代理的签名 URL 不能追加任何查询参数，否则会导致 SignatureDoesNotMatch。
  if (!parsed.pathname.endsWith('/image-proxy')) {
    return parsed.toString()
  }
  parsed.searchParams.set('download', '1')
  parsed.searchParams.set('filename', filename)
  return parsed.toString()
}

export function resolveDownloadSavePath(downloadTask, settingsStore) {
  try {
    const baseDir =
      downloadTask.options.save_dir ||
      settingsStore.getSetting('save_dir', '~/Downloads/星空云绘')
    const saveMode =
      downloadTask.options.save_mode || settingsStore.getSetting('save_mode', 'default')
    const customFolder =
      downloadTask.options.custom_folder || settingsStore.getSetting('custom_folder', '')

    let path = baseDir

    if (saveMode === 'resolution' && downloadTask.wallpaperData.resolution) {
      path += `/${downloadTask.wallpaperData.resolution}`
    } else if (saveMode === 'date') {
      const date = new Date()
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      path += `/${year}-${month}-${day}`
    } else if (saveMode === 'custom' && customFolder) {
      path += `/${customFolder}`
    }

    path += `/${downloadTask.wallpaperId}.jpg`
    return path
  } catch (err) {
    console.error('获取保存路径失败:', err)
    return '未知路径'
  }
}
