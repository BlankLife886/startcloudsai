import { computed, ref } from 'vue'

// 裁切业务集中在这里：主组件只传入图片元素和加载函数，不直接维护选区细节。
export function usePreviewCrop({
  imageElement,
  previewDisplayUrl,
  loadImageFromSrc,
  applyProcessedResult,
  notificationService,
}) {
  const cropMode = ref(false)
  const cropStart = ref(null)
  const cropRect = ref(null)
  const cropDragging = ref(false)

  const cropReady = computed(() => {
    const rect = cropRect.value
    return !!rect && rect.width > 8 && rect.height > 8
  })

  function cancelCropMode() {
    cropMode.value = false
    cropStart.value = null
    cropRect.value = null
    cropDragging.value = false
  }

  function enterCropMode() {
    cropMode.value = true
    cropStart.value = null
    cropRect.value = null
    cropDragging.value = false
  }

  function getImageContentRect() {
    const img = imageElement.value
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const naturalWidth = img.naturalWidth || 0
    const naturalHeight = img.naturalHeight || 0
    if (!rect.width || !rect.height || !naturalWidth || !naturalHeight) return null
    const imageRatio = naturalWidth / naturalHeight
    const boxRatio = rect.width / rect.height
    let renderWidth = rect.width
    let renderHeight = rect.height
    if (imageRatio > boxRatio) {
      renderHeight = rect.width / imageRatio
    } else {
      renderWidth = rect.height * imageRatio
    }
    return {
      left: rect.left + (rect.width - renderWidth) / 2,
      top: rect.top + (rect.height - renderHeight) / 2,
      width: renderWidth,
      height: renderHeight,
      naturalWidth,
      naturalHeight,
    }
  }

  function startCropSelection(event, { comparisonMode = 'none', mockupMode = 'none' } = {}) {
    if (!cropMode.value || comparisonMode !== 'none' || mockupMode !== 'none') return
    const contentRect = getImageContentRect()
    if (!contentRect) return
    const x = Math.min(
      Math.max(event.clientX, contentRect.left),
      contentRect.left + contentRect.width,
    )
    const y = Math.min(
      Math.max(event.clientY, contentRect.top),
      contentRect.top + contentRect.height,
    )
    cropDragging.value = true
    cropStart.value = { x, y }
    cropRect.value = { left: x, top: y, width: 0, height: 0 }
  }

  function moveCropSelection(event) {
    if (!cropDragging.value || !cropStart.value) return
    const contentRect = getImageContentRect()
    if (!contentRect) return
    const x = Math.min(
      Math.max(event.clientX, contentRect.left),
      contentRect.left + contentRect.width,
    )
    const y = Math.min(
      Math.max(event.clientY, contentRect.top),
      contentRect.top + contentRect.height,
    )
    const left = Math.min(cropStart.value.x, x)
    const top = Math.min(cropStart.value.y, y)
    cropRect.value = {
      left,
      top,
      width: Math.abs(x - cropStart.value.x),
      height: Math.abs(y - cropStart.value.y),
    }
  }

  function endCropSelection() {
    cropDragging.value = false
  }

  async function applyCropSelection() {
    if (!cropReady.value) return
    const contentRect = getImageContentRect()
    if (!contentRect) return
    const img = await loadImageFromSrc(previewDisplayUrl.value)
    if (!img) {
      notificationService.error('裁切失败：图片加载异常')
      return
    }
    const rect = cropRect.value
    const scaleX = contentRect.naturalWidth / contentRect.width
    const scaleY = contentRect.naturalHeight / contentRect.height
    const sx = Math.max(0, Math.round((rect.left - contentRect.left) * scaleX))
    const sy = Math.max(0, Math.round((rect.top - contentRect.top) * scaleY))
    const sw = Math.max(1, Math.round(rect.width * scaleX))
    const sh = Math.max(1, Math.round(rect.height * scaleY))
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    try {
      applyProcessedResult(canvas.toDataURL('image/jpeg', 0.95))
    } catch {
      notificationService.error('裁切失败：跨域图片无法导出，请开启代理后重试')
      return
    }
    cancelCropMode()
    notificationService.success('已应用裁切')
  }

  return {
    cropMode,
    cropRect,
    cropReady,
    applyCropSelection,
    cancelCropMode,
    endCropSelection,
    enterCropMode,
    moveCropSelection,
    startCropSelection,
  }
}
