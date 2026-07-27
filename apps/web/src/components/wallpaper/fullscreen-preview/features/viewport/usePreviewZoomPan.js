import { computed, ref } from 'vue'
import {
  clampOffsets as clampGeometryOffsets,
  clampZoom,
  DOUBLE_CLICK_ZOOM_MAX,
  getVisibleSourceRect as getGeometryVisibleSourceRect,
  getZoomOffsetsAroundPoint,
  MIN_ZOOM,
  ZOOM_STEP_FACTOR,
} from '@/components/wallpaper/fullscreen-preview/features/viewport/previewZoomGeometry'

// 缩放和平移独立管理；几何尺寸由外层 viewport 提供，避免和图片加载/工具栏耦合。
export function usePreviewZoomPan({
  imageElement,
  getActiveViewportElement,
  getBaseDisplayMetrics,
  baseFitMode,
  rotation,
  onControlsActivity,
}) {
  const isZoomed = ref(false)
  const zoomLevel = ref(1)
  const isDragging = ref(false)
  const dragStartX = ref(0)
  const dragStartY = ref(0)
  const offsetX = ref(0)
  const offsetY = ref(0)
  const dragStartOffsetX = ref(0)
  const dragStartOffsetY = ref(0)
  const dragMoved = ref(false)
  const dragThreshold = 3

  const transformStyle = computed(() => {
    const transition = isDragging.value ? 'none' : 'transform 0.2s ease'
    const hasTransform =
      Math.abs(zoomLevel.value - 1) > 0.001 ||
      Math.abs(rotation.value % 360) > 0.001 ||
      Math.abs(offsetX.value) > 0.001 ||
      Math.abs(offsetY.value) > 0.001

    return {
      // 默认完整预览时不施加 transform，避免 contain 在部分环境下出现异常放大。
      transform: hasTransform
        ? `translate(${offsetX.value}px, ${offsetY.value}px) scale(${zoomLevel.value}) rotate(${rotation.value}deg)`
        : 'none',
      transition,
      backfaceVisibility: 'hidden',
      transformOrigin: 'center center',
    }
  })

  const cursorStyle = computed(() => {
    if (isDragging.value) return 'grabbing'
    if (zoomLevel.value > 1) return 'grab'
    return 'default'
  })

  function getPreferredBaseZoom() {
    const metrics = getBaseDisplayMetrics()
    if (!metrics) return MIN_ZOOM
    return baseFitMode.value === 'cover' ? clampZoom(metrics.coverZoomFactor) : MIN_ZOOM
  }

  function clampOffsets(nextOffsetX, nextOffsetY, forZoom = zoomLevel.value) {
    return clampGeometryOffsets(nextOffsetX, nextOffsetY, {
      metrics: getBaseDisplayMetrics(),
      zoom: forZoom,
      rotation: rotation.value,
    })
  }

  function getVisibleSourceRect(
    forZoom = zoomLevel.value,
    forOffsetX = offsetX.value,
    forOffsetY = offsetY.value,
  ) {
    return getGeometryVisibleSourceRect(getBaseDisplayMetrics(), forZoom, forOffsetX, forOffsetY)
  }

  function zoomAroundPoint(targetZoom, point = null) {
    const activeViewport = getActiveViewportElement()
    if (!imageElement.value || !activeViewport) {
      zoomLevel.value = clampZoom(targetZoom)
      isZoomed.value = zoomLevel.value > MIN_ZOOM
      return
    }

    const previousZoom = zoomLevel.value
    const nextZoom = clampZoom(targetZoom)
    if (Math.abs(nextZoom - previousZoom) < 0.001) return

    const containerRect = activeViewport.getBoundingClientRect()
    const nextOffsets = getZoomOffsetsAroundPoint({
      previousZoom,
      nextZoom,
      offsetX: offsetX.value,
      offsetY: offsetY.value,
      containerRect,
      point,
    })
    let nextOffsetX = nextOffsets.x
    let nextOffsetY = nextOffsets.y

    if (nextZoom <= MIN_ZOOM) {
      nextOffsetX = 0
      nextOffsetY = 0
    }

    zoomLevel.value = nextZoom
    isZoomed.value = nextZoom > MIN_ZOOM

    const clamped = clampOffsets(nextOffsetX, nextOffsetY, nextZoom)
    offsetX.value = clamped.x
    offsetY.value = clamped.y
  }

  function toggleZoom(event) {
    if (isDragging.value) return

    if (zoomLevel.value < DOUBLE_CLICK_ZOOM_MAX - 0.01) {
      zoomAroundPoint(Math.min(DOUBLE_CLICK_ZOOM_MAX, zoomLevel.value + 1), event)
    } else {
      resetZoom()
    }
  }

  function applyConstraints() {
    const clamped = clampOffsets(offsetX.value, offsetY.value)
    offsetX.value = clamped.x
    offsetY.value = clamped.y
  }

  function handleZoomIn() {
    const currentZoom = Math.max(zoomLevel.value, getPreferredBaseZoom())
    zoomAroundPoint(currentZoom * ZOOM_STEP_FACTOR)
  }

  function handleZoomOut() {
    zoomAroundPoint(zoomLevel.value / ZOOM_STEP_FACTOR)
  }

  function resetZoom() {
    const preferredZoom = getPreferredBaseZoom()
    zoomLevel.value = preferredZoom
    isZoomed.value = preferredZoom > MIN_ZOOM + 0.001
    offsetX.value = 0
    offsetY.value = 0
  }

  function handleWheel(event) {
    event.preventDefault()
    if (isDragging.value) return

    const delta = event.deltaY || event.detail || event.wheelDelta
    if (!Number.isFinite(delta) || delta === 0) return

    const sensitivity = event.ctrlKey ? 0.003 : 0.0018
    const nextZoom = zoomLevel.value * Math.exp(-delta * sensitivity)
    zoomAroundPoint(nextZoom, event)
  }

  function startDrag(event) {
    if (event.button !== 0) return
    if (zoomLevel.value <= 1) return

    event.preventDefault()
    isDragging.value = true
    dragMoved.value = false
    dragStartX.value = event.clientX
    dragStartY.value = event.clientY
    dragStartOffsetX.value = offsetX.value
    dragStartOffsetY.value = offsetY.value

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    event.stopPropagation()
  }

  function handleMouseMove(event) {
    if (!isDragging.value) return

    event.preventDefault()

    const deltaX = event.clientX - dragStartX.value
    const deltaY = event.clientY - dragStartY.value
    const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

    if (!dragMoved.value && totalMovement > dragThreshold) {
      dragMoved.value = true
    }

    offsetX.value = dragStartOffsetX.value + deltaX
    offsetY.value = dragStartOffsetY.value + deltaY

    applyConstraints()
    onControlsActivity?.()
  }

  function handleMouseUp(event) {
    if (!isDragging.value) return

    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    applyConstraints()
    isDragging.value = false

    if (dragMoved.value) {
      event.stopPropagation()
      if (event.cancelable) {
        event.preventDefault()
      }
    }
  }

  function drag(event) {
    handleMouseMove(event)
  }

  function endDrag(event) {
    handleMouseUp(event)
  }

  function cleanupZoomPan() {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    document.removeEventListener('mousemove', drag)
    document.removeEventListener('mouseup', endDrag)
    isDragging.value = false
    dragMoved.value = false
  }

  return {
    isZoomed,
    zoomLevel,
    isDragging,
    offsetX,
    offsetY,
    dragMoved,
    transformStyle,
    cursorStyle,
    getVisibleSourceRect,
    clampOffsets,
    toggleZoom,
    handleZoomIn,
    handleZoomOut,
    resetZoom,
    handleWheel,
    startDrag,
    handleMouseMove,
    handleMouseUp,
    applyConstraints,
    drag,
    endDrag,
    cleanupZoomPan,
  }
}
