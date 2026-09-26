/** 插画染色上传预处理：按设置压缩 / 转格式，保证不无故变大 */

function blobFromCanvas(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas 导出失败'))
          return
        }
        resolve(blob)
      },
      type,
      quality,
    )
  })
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

function normalizeMime(type = '') {
  return String(type || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
}

function isLossyFormat(type = '') {
  const mime = normalizeMime(type)
  return mime === 'image/jpeg' || mime === 'image/webp'
}

/**
 * 压缩时优先有损格式：PNG 几乎压不了照片/插画体积，容易「缩小了却更大」。
 */
function resolveExportFormats({ requestedFormat, enableCompress, sourceType }) {
  const requested = normalizeMime(requestedFormat) || 'image/jpeg'
  if (!enableCompress) return [requested]

  // 需要压体积时，PNG 放到最后；优先 JPEG/WebP
  if (requested === 'image/png') {
    return ['image/jpeg', 'image/webp', 'image/png']
  }
  if (requested === 'image/webp') {
    return ['image/webp', 'image/jpeg']
  }
  if (requested === 'image/jpeg') {
    return ['image/jpeg', 'image/webp']
  }
  // 未知格式：尽量保留，并补 JPEG 兜底
  const list = [requested]
  if (sourceType && sourceType !== requested) list.push(sourceType)
  if (!list.includes('image/jpeg')) list.push('image/jpeg')
  return list
}

async function encodeCandidate(img, width, height, format, quality) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await blobFromCanvas(canvas, format, isLossyFormat(format) ? quality : undefined)
  return blob
}

export async function prepareColoringUploadBlob({ blob, settings = {}, onStatus = null }) {
  if (!blob) throw new Error('请先选择图片')
  const enableCompress = settings.enableCompress === true
  const maxBytes = Math.max(64, Number(settings.compressMaxKb || 1024)) * 1024
  const sourceType = normalizeMime(blob.type)
  const requestedRaw = normalizeMime(settings.inputFormat || 'original')
  const preserveOriginalFormat = !requestedRaw || requestedRaw === 'original'
  const requestedFormat = preserveOriginalFormat ? sourceType || 'image/png' : requestedRaw

  // 关闭压缩必须保持原文件字节、格式、尺寸和质量不变。不能进入 Canvas，
  // 因为即使尺寸不变，重新编码 JPEG/WebP 也属于有损压缩。
  if (!enableCompress) {
    onStatus?.('已关闭上传压缩，正在使用原始图片…')
    return {
      blob,
      changed: false,
      width: 0,
      height: 0,
      originalBytes: blob.size,
      processedBytes: blob.size,
      compressionEnabled: false,
    }
  }

  onStatus?.('正在处理上传图片…')
  const img = await loadImageFromBlob(blob)
  const naturalWidth = Math.max(1, Number(img.naturalWidth || img.width || 1))
  const naturalHeight = Math.max(1, Number(img.naturalHeight || img.height || 1))
  const needsFormatChange = Boolean(
    !preserveOriginalFormat && requestedFormat && sourceType && requestedFormat !== sourceType,
  )
  const needsCompress = blob.size > maxBytes

  if (!needsFormatChange && !needsCompress) {
    return {
      blob,
      changed: false,
      width: naturalWidth,
      height: naturalHeight,
      originalBytes: blob.size,
      processedBytes: blob.size,
    }
  }

  const resolvedFormats = resolveExportFormats({
    requestedFormat,
    enableCompress: needsCompress,
    sourceType,
  })
  const formats =
    preserveOriginalFormat && sourceType
      ? [sourceType, ...resolvedFormats.filter((format) => format !== sourceType)]
      : resolvedFormats
  const qualitySteps = needsCompress ? [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42] : [0.92, 0.86, 0.8]
  // 先降质量，再逐步缩小；避免一上来就砍分辨率
  const scaleSteps = needsCompress
    ? [1, 0.92, 0.84, 0.75, 0.66, 0.58, 0.5].map((value) => Number(value.toFixed(3)))
    : [1]

  let bestUnderLimit = null
  let bestOverall = null

  for (const format of formats) {
    for (const scale of scaleSteps) {
      const width = Math.max(1, Math.round(naturalWidth * scale))
      const height = Math.max(1, Math.round(naturalHeight * scale))
      const qualities = isLossyFormat(format) ? qualitySteps : [1]

      for (const quality of qualities) {
        const candidate = await encodeCandidate(img, width, height, format, quality)
        if (!candidate) continue

        const entry = {
          blob: candidate,
          width,
          height,
          format,
          quality,
        }

        // 只接受不比原图更大的候选，避免「压缩后变大」
        if (candidate.size < blob.size) {
          if (!bestOverall || candidate.size < bestOverall.blob.size) {
            bestOverall = entry
          }
        }

        if (candidate.size <= maxBytes && candidate.size <= blob.size) {
          if (!bestUnderLimit || candidate.size < bestUnderLimit.blob.size) {
            bestUnderLimit = entry
          }
          // 已达标：优先返回（同格式下越早越好，保留更高清晰度）
          return {
            blob: candidate,
            changed: true,
            width,
            height,
            originalBytes: blob.size,
            processedBytes: candidate.size,
            exportFormat: format,
          }
        }
      }

      // 无损 PNG 缩放一轮即可，质量循环无意义
      if (!isLossyFormat(format) && bestUnderLimit) break
    }
    if (bestUnderLimit) break
  }

  if (bestUnderLimit) {
    return {
      blob: bestUnderLimit.blob,
      changed: true,
      width: bestUnderLimit.width,
      height: bestUnderLimit.height,
      originalBytes: blob.size,
      processedBytes: bestUnderLimit.blob.size,
      exportFormat: bestUnderLimit.format,
    }
  }

  // 压不到上限，但找到了比原图更小的结果
  if (bestOverall && bestOverall.blob.size < blob.size) {
    return {
      blob: bestOverall.blob,
      changed: true,
      width: bestOverall.width,
      height: bestOverall.height,
      originalBytes: blob.size,
      processedBytes: bestOverall.blob.size,
      exportFormat: bestOverall.format,
      underLimit: false,
    }
  }

  // 怎么转都更大：保留原图
  return {
    blob,
    changed: false,
    width: naturalWidth,
    height: naturalHeight,
    originalBytes: blob.size,
    processedBytes: blob.size,
    skippedGrow: true,
  }
}
