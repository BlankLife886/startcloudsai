import { computed, ref } from 'vue'

const MINIMAP_WIDTH = 180
const MINIMAP_HEIGHT = 112

// 小地图只关心“当前可见原图区域”和拖拽映射，视口缩放/边界仍由外层提供。
export function usePreviewMinimap({
  zoomLevel,
  rotation,
  getVisibleSourceRect,
  clampOffsets,
  offsetX,
  offsetY,
  onControlsActivity,
}) {
  const minimapDragging = ref(false)
  const minimapRect = ref(null)
  const minimapGrabOffsetX = ref(0)
  const minimapGrabOffsetY = ref(0)

  const showMinimap = computed(
    () => zoomLevel.value > 1.001 && Math.abs(rotation.value % 180) < 0.001,
  )

  const minimapMetrics = computed(() => {
    const sourceRect = getVisibleSourceRect()
    if (!sourceRect) {
      return {
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        viewportWidth: MINIMAP_WIDTH,
        viewportHeight: MINIMAP_HEIGHT,
        viewportLeft: 0,
        viewportTop: 0,
      }
    }

    const scale = Math.min(
      MINIMAP_WIDTH / sourceRect.naturalWidth,
      MINIMAP_HEIGHT / sourceRect.naturalHeight,
    )
    const width = Math.max(72, Math.round(sourceRect.naturalWidth * scale))
    const height = Math.max(72, Math.round(sourceRect.naturalHeight * scale))
    const viewportWidth = Math.min(
      width,
      Math.max(18, Math.round((sourceRect.visibleSourceWidth / sourceRect.naturalWidth) * width)),
    )
    const viewportHeight = Math.min(
      height,
      Math.max(
        18,
        Math.round((sourceRect.visibleSourceHeight / sourceRect.naturalHeight) * height),
      ),
    )
    const viewportLeft = (sourceRect.sourceLeft / sourceRect.naturalWidth) * width
    const viewportTop = (sourceRect.sourceTop / sourceRect.naturalHeight) * height

    return {
      width,
      height,
      viewportWidth,
      viewportHeight,
      viewportLeft: Math.max(0, Math.min(width - viewportWidth, viewportLeft)),
      viewportTop: Math.max(0, Math.min(height - viewportHeight, viewportTop)),
    }
  })

  const minimapStyle = computed(() => ({
    width: `${minimapMetrics.value.width}px`,
    height: `${minimapMetrics.value.height}px`,
  }))

  const minimapViewportStyle = computed(() => ({
    width: `${minimapMetrics.value.viewportWidth}px`,
    height: `${minimapMetrics.value.viewportHeight}px`,
    left: `${minimapMetrics.value.viewportLeft}px`,
    top: `${minimapMetrics.value.viewportTop}px`,
  }))

  function setOffsetsFromMinimap(clientX, clientY) {
    const rect = minimapRect.value
    if (!rect) return

    const metrics = minimapMetrics.value
    const sourceRect = getVisibleSourceRect(zoomLevel.value)
    if (!sourceRect) return
    const maxViewportLeft = Math.max(0, metrics.width - metrics.viewportWidth)
    const maxViewportTop = Math.max(0, metrics.height - metrics.viewportHeight)
    const viewportLeft = Math.max(
      0,
      Math.min(maxViewportLeft, clientX - rect.left - minimapGrabOffsetX.value),
    )
    const viewportTop = Math.max(
      0,
      Math.min(maxViewportTop, clientY - rect.top - minimapGrabOffsetY.value),
    )
    const ratioX = maxViewportLeft > 0 ? viewportLeft / maxViewportLeft : 0
    const ratioY = maxViewportTop > 0 ? viewportTop / maxViewportTop : 0
    const sourceLeft = ratioX * sourceRect.maxSourceLeft
    const sourceTop = ratioY * sourceRect.maxSourceTop

    offsetX.value =
      ((sourceRect.naturalWidth - sourceRect.visibleSourceWidth) / 2 - sourceLeft) *
      sourceRect.scale
    offsetY.value =
      ((sourceRect.naturalHeight - sourceRect.visibleSourceHeight) / 2 - sourceTop) *
      sourceRect.scale

    const clamped = clampOffsets(offsetX.value, offsetY.value, zoomLevel.value)
    offsetX.value = clamped.x
    offsetY.value = clamped.y
    onControlsActivity?.()
  }

  function handleMinimapMouseMove(event) {
    if (!minimapDragging.value) return
    event.preventDefault()
    setOffsetsFromMinimap(event.clientX, event.clientY)
  }

  function handleMinimapMouseUp(event) {
    if (!minimapDragging.value) return
    event.preventDefault()
    minimapDragging.value = false
    minimapRect.value = null
    minimapGrabOffsetX.value = 0
    minimapGrabOffsetY.value = 0
    document.removeEventListener('mousemove', handleMinimapMouseMove)
    document.removeEventListener('mouseup', handleMinimapMouseUp)
  }

  function startMinimapDrag(event) {
    if (event.button !== 0) return
    if (!showMinimap.value) return
    const currentTarget = event.currentTarget
    if (!(currentTarget instanceof HTMLElement)) return

    event.preventDefault()
    event.stopPropagation()
    minimapDragging.value = true
    minimapRect.value = currentTarget.getBoundingClientRect()
    const metrics = minimapMetrics.value
    const pointerX = event.clientX - minimapRect.value.left
    const pointerY = event.clientY - minimapRect.value.top
    const viewportRight = metrics.viewportLeft + metrics.viewportWidth
    const viewportBottom = metrics.viewportTop + metrics.viewportHeight
    const insideViewport =
      pointerX >= metrics.viewportLeft &&
      pointerX <= viewportRight &&
      pointerY >= metrics.viewportTop &&
      pointerY <= viewportBottom

    minimapGrabOffsetX.value = insideViewport
      ? pointerX - metrics.viewportLeft
      : metrics.viewportWidth / 2
    minimapGrabOffsetY.value = insideViewport
      ? pointerY - metrics.viewportTop
      : metrics.viewportHeight / 2
    setOffsetsFromMinimap(event.clientX, event.clientY)
    document.addEventListener('mousemove', handleMinimapMouseMove)
    document.addEventListener('mouseup', handleMinimapMouseUp)
  }

  function cleanupMinimap() {
    document.removeEventListener('mousemove', handleMinimapMouseMove)
    document.removeEventListener('mouseup', handleMinimapMouseUp)
    minimapDragging.value = false
    minimapRect.value = null
    minimapGrabOffsetX.value = 0
    minimapGrabOffsetY.value = 0
  }

  return {
    showMinimap,
    minimapStyle,
    minimapViewportStyle,
    startMinimapDrag,
    cleanupMinimap,
  }
}
