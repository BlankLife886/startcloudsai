import { zip } from 'fflate'
import { fetchAuthenticatedMediaBlob } from '@/services/authenticatedMedia'

const metadataCache = new Map()
const metadataWaiters = []
let activeMetadataReads = 0
const MAX_METADATA_READS = 2

async function withMetadataReadSlot(task) {
  if (activeMetadataReads >= MAX_METADATA_READS) {
    await new Promise((resolve) => metadataWaiters.push(resolve))
  }
  activeMetadataReads += 1
  try {
    return await task()
  } finally {
    activeMetadataReads = Math.max(0, activeMetadataReads - 1)
    metadataWaiters.shift()?.()
  }
}

function imageExtension(contentType = '') {
  const type = String(contentType).toLowerCase()
  if (type.includes('webp')) return 'webp'
  if (type.includes('jpeg')) return 'jpg'
  if (type.includes('gif')) return 'gif'
  if (type.includes('avif')) return 'avif'
  return 'png'
}

function cleanFilename(value = 'ai-image') {
  return (
    String(value || 'ai-image')
      .replace(/\.(?:png|jpe?g|webp|gif|avif)$/i, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/./g, (character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 96) || 'ai-image'
  )
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        dispose: () => bitmap.close?.(),
      }
    } catch {
      // Safari versions with partial ImageBitmap support use the element fallback.
    }
  }
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
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      dispose: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

async function inspectImageBlob(blob) {
  const decoded = await decodeImage(blob)
  try {
    let transparent = false
    if (!/jpe?g/i.test(blob.type || '')) {
      const scale = Math.min(1, 256 / Math.max(decoded.width, decoded.height))
      const width = Math.max(1, Math.round(decoded.width * scale))
      const height = Math.max(1, Math.round(decoded.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
      if (context) {
        context.clearRect(0, 0, width, height)
        decoded.draw(context, width, height)
        const pixels = context.getImageData(0, 0, width, height).data
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] < 255) {
            transparent = true
            break
          }
        }
      }
      canvas.width = 1
      canvas.height = 1
    }
    return {
      width: decoded.width,
      height: decoded.height,
      bytes: blob.size,
      contentType: blob.type || 'image/png',
      transparent,
    }
  } finally {
    decoded.dispose()
  }
}

export function readHistoryImageMetadata(url = '') {
  const source = String(url || '').trim()
  if (!source) return Promise.reject(new Error('没有可读取的原图'))
  if (metadataCache.has(source)) return metadataCache.get(source)
  const request = withMetadataReadSlot(async () => {
    const blob = await fetchAuthenticatedMediaBlob(source, { cache: 'default' })
    return inspectImageBlob(blob)
  })
    .catch((error) => {
      metadataCache.delete(source)
      throw error
    })
  metadataCache.set(source, request)
  return request
}

function zipFiles(files, options = {}) {
  return new Promise((resolve, reject) => {
    zip(files, options, (error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
}

export async function downloadHistoryImagesAsZip(items = [], { onProgress } = {}) {
  const sources = (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      url: String(item?.url || '').trim(),
      name: cleanFilename(item?.filename || `ai-image-${index + 1}`),
    }))
    .filter((item) => item.url)
  if (!sources.length) throw new Error('没有可打包下载的原图')

  const files = {}
  let completed = 0
  const queue = [...sources]
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (!item) continue
      const blob = await fetchAuthenticatedMediaBlob(item.url, { cache: 'default' })
      let filename = `${item.name}.${imageExtension(blob.type)}`
      let suffix = 2
      while (files[filename]) {
        filename = `${item.name}-${suffix}.${imageExtension(blob.type)}`
        suffix += 1
      }
      files[filename] = new Uint8Array(await blob.arrayBuffer())
      completed += 1
      onProgress?.({ phase: 'fetching', completed, total: sources.length })
    }
  })
  await Promise.all(workers)
  onProgress?.({ phase: 'packing', completed, total: sources.length })
  const archive = await zipFiles(files, { level: 0 })
  const objectUrl = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `ai-originals-${new Date().toISOString().slice(0, 10)}.zip`
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }
  onProgress?.({ phase: 'done', completed, total: sources.length })
  return { count: sources.length, bytes: archive.byteLength }
}
