import { proxyWallhavenImageUrl } from '@/services/api'
import {
  decodeImageProxyUrl,
  getCandidateImageUrls,
  getExtensionFromContentType,
  getExtensionFromUrl,
} from '@/stores/downloads/helpers'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let j = 0; j < 8; j += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function uint16(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff])
}

function uint32(value) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ])
}

function dateToDosTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: dosDate }
}

function concatParts(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function createZipBlob(files) {
  const encoder = new TextEncoder()
  const chunks = []
  const centralDirectory = []
  let offset = 0

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name)
    const checksum = crc32(file.bytes)
    const modified = dateToDosTime(file.modifiedAt)
    const localHeader = concatParts([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(modified.time),
      uint16(modified.date),
      uint32(checksum),
      uint32(file.bytes.length),
      uint32(file.bytes.length),
      uint16(nameBytes.length),
      uint16(0),
      nameBytes,
    ])

    chunks.push(localHeader, file.bytes)
    centralDirectory.push(
      concatParts([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(modified.time),
        uint16(modified.date),
        uint32(checksum),
        uint32(file.bytes.length),
        uint32(file.bytes.length),
        uint16(nameBytes.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBytes,
      ]),
    )
    offset += localHeader.length + file.bytes.length
  })

  const centralOffset = offset
  const centralSize = centralDirectory.reduce((total, part) => total + part.length, 0)
  chunks.push(
    ...centralDirectory,
    concatParts([
      uint32(0x06054b50),
      uint16(0),
      uint16(0),
      uint16(files.length),
      uint16(files.length),
      uint32(centralSize),
      uint32(centralOffset),
      uint16(0),
    ]),
  )

  return new Blob(chunks, { type: 'application/zip' })
}

function saveBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
}

export function createZipDownloadCancelledError() {
  const error = new Error('打包已取消')
  error.name = 'AbortError'
  error.code = 'ZIP_DOWNLOAD_CANCELLED'
  return error
}

export function isZipDownloadCancelled(error) {
  return (
    error?.name === 'AbortError' ||
    error?.code === 'ZIP_DOWNLOAD_CANCELLED' ||
    /aborted|abort|cancel|取消/i.test(String(error?.message || ''))
  )
}

function throwIfCancelled(signal) {
  if (signal?.aborted) {
    throw createZipDownloadCancelledError()
  }
}

function safeName(value, fallback = 'wallpapers') {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80) || fallback
}

async function fetchWallpaperBlob(wallpaper, timeoutMs = 45000, signal = null) {
  const candidates = getCandidateImageUrls(wallpaper?.id, wallpaper, wallpaper?.path || wallpaper?.url)
  let lastError = null

  for (const candidate of candidates) {
    throwIfCancelled(signal)
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timedOut = false
    const abortFromParent = () => controller?.abort()
    const timer = controller
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      : null
    try {
      if (controller && signal) {
        signal.addEventListener('abort', abortFromParent, { once: true })
      }
      const response = await fetch(proxyWallhavenImageUrl(candidate), {
        cache: 'no-store',
        signal: controller?.signal,
      })
      throwIfCancelled(signal)
      if (!response.ok) throw new Error(`图片请求失败(${response.status})`)
      const contentType = response.headers.get('content-type') || ''
      if (contentType && !contentType.startsWith('image/')) {
        throw new Error('返回内容不是图片')
      }
      const blob = await response.blob()
      throwIfCancelled(signal)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const extension =
        getExtensionFromContentType(blob.type || contentType) ||
        getExtensionFromUrl(decodeImageProxyUrl(candidate)) ||
        'jpg'
      return { bytes, extension }
    } catch (error) {
      if (signal?.aborted) {
        throw createZipDownloadCancelledError()
      }
      if (error?.name === 'AbortError' && timedOut) {
        lastError = new Error('图片请求超时')
        continue
      }
      lastError = error
    } finally {
      if (timer) clearTimeout(timer)
      if (controller && signal) {
        signal.removeEventListener('abort', abortFromParent)
      }
    }
  }

  throw lastError || new Error('没有可用的图片地址')
}

export async function downloadWallpapersAsZip(wallpapers, options = {}) {
  const uniqueWallpapers = Array.from(
    new Map((Array.isArray(wallpapers) ? wallpapers : []).map((item) => [String(item?.id), item])).values(),
  ).filter((item) => item?.id)

  if (uniqueWallpapers.length === 0) {
    return { successCount: 0, failCount: 0 }
  }

  const files = []
  let failCount = 0

  for (let index = 0; index < uniqueWallpapers.length; index += 1) {
    throwIfCancelled(options.signal)
    const wallpaper = uniqueWallpapers[index]
    try {
      options.onProgress?.({
        current: index,
        total: uniqueWallpapers.length,
        percent: Math.round((index / uniqueWallpapers.length) * 92),
      })
      const result = await fetchWallpaperBlob(wallpaper, options.timeoutMs, options.signal)
      throwIfCancelled(options.signal)
      files.push({
        name: `wallhaven-${safeName(wallpaper.id, `image-${index + 1}`)}.${result.extension}`,
        bytes: result.bytes,
        modifiedAt: new Date(),
      })
    } catch (error) {
      if (isZipDownloadCancelled(error) || options.signal?.aborted) {
        throw createZipDownloadCancelledError()
      }
      failCount += 1
      console.warn('壁纸加入压缩包失败:', wallpaper?.id, error)
    }
  }

  if (files.length > 0) {
    throwIfCancelled(options.signal)
    options.onProgress?.({
      current: uniqueWallpapers.length,
      total: uniqueWallpapers.length,
      percent: 96,
    })
    const zipBlob = createZipBlob(files)
    throwIfCancelled(options.signal)
    saveBlob(zipBlob, `${safeName(options.filename)}.zip`)
    options.onProgress?.({
      current: uniqueWallpapers.length,
      total: uniqueWallpapers.length,
      percent: 100,
    })
  }

  return { successCount: files.length, failCount }
}
