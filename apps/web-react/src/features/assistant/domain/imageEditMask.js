// 图片编辑器的局部修改：把涂抹的笔迹或评论的图钉变成服务端局部编辑要的
// 裁切图 + 蒙版 + 区域（与 WallevenRegionEditor 的格式一致：蒙版里透明的部分是要改的区域）。

function canvasBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片处理失败'))), type)
  })
}

// 读出画了笔迹的范围（像素坐标，基于 selection 画布本身）。
export function paintedBounds(canvas) {
  if (!canvas?.width || !canvas?.height) return null
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX: Math.min(width - 1, maxX + 1), maxY: Math.min(height - 1, maxY + 1) }
}

// 在 selection 画布上为每个评论图钉画一个圆形区域（坐标是 0-1 的相对位置）。
export function paintCommentPins(canvas, pins, radiusRatio = 0.09) {
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#000'
  const radius = Math.max(16, Math.round(Math.min(canvas.width, canvas.height) * radiusRatio))
  for (const pin of pins) {
    context.beginPath()
    context.arc(pin.x * canvas.width, pin.y * canvas.height, radius, 0, Math.PI * 2)
    context.fill()
  }
}

// image：已加载的原图；selection：与原图同比例的笔迹画布；sourceBlob：原图文件（没有 fileKey 时作为底图上传）。
export async function buildImageEditMaskPayload({ image, selection, prompt, sourceBlob = null }) {
  const bounds = paintedBounds(selection)
  if (!image || !bounds) throw new Error('请先在图片上标出要修改的区域')
  const padding = Math.max(24, Math.round(Math.max(selection.width, selection.height) * 0.06))
  const work = {
    x: Math.max(0, bounds.minX - padding),
    y: Math.max(0, bounds.minY - padding),
    right: Math.min(selection.width, bounds.maxX + padding + 1),
    bottom: Math.min(selection.height, bounds.maxY + padding + 1),
  }
  const scaleX = image.naturalWidth / selection.width
  const scaleY = image.naturalHeight / selection.height
  const rect = {
    x: Math.floor(work.x * scaleX),
    y: Math.floor(work.y * scaleY),
    width: Math.max(1, Math.ceil((work.right - work.x) * scaleX)),
    height: Math.max(1, Math.ceil((work.bottom - work.y) * scaleY)),
  }
  rect.width = Math.min(rect.width, image.naturalWidth - rect.x)
  rect.height = Math.min(rect.height, image.naturalHeight - rect.y)

  const crop = document.createElement('canvas')
  crop.width = rect.width
  crop.height = rect.height
  crop.getContext('2d').drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)

  const mask = document.createElement('canvas')
  mask.width = rect.width
  mask.height = rect.height
  const maskContext = mask.getContext('2d', { alpha: true })
  maskContext.fillStyle = '#fff'
  maskContext.fillRect(0, 0, rect.width, rect.height)
  maskContext.globalCompositeOperation = 'destination-out'
  maskContext.drawImage(selection, work.x, work.y, work.right - work.x, work.bottom - work.y, 0, 0, rect.width, rect.height)

  const [cropBlob, maskBlob] = await Promise.all([canvasBlob(crop), canvasBlob(mask)])
  crop.width = mask.width = 1
  crop.height = mask.height = 1
  const stamp = Date.now()
  const baseType = sourceBlob?.type || 'image/png'
  const baseExtension = baseType.includes('jpeg') ? 'jpg' : baseType.includes('webp') ? 'webp' : 'png'
  return {
    prompt: String(prompt || '').trim(),
    cropFile: new File([cropBlob], `region-edit-${stamp}.png`, { type: 'image/png' }),
    maskFile: new File([maskBlob], `region-mask-${stamp}.png`, { type: 'image/png' }),
    baseFile: sourceBlob ? new File([sourceBlob], `region-base-${stamp}.${baseExtension}`, { type: baseType }) : null,
    maskRect: `${rect.x},${rect.y},${rect.width},${rect.height}`,
  }
}
