import { computed, ref } from 'vue'

import { usePreviewFitMode } from '@/components/wallpaper/fullscreen-preview/features/display/usePreviewFitMode'
import { usePreviewFullscreen } from '@/components/wallpaper/fullscreen-preview/features/fullscreen/usePreviewFullscreen'
import { usePreviewRotation } from '@/components/wallpaper/fullscreen-preview/features/rotate/usePreviewRotation'
import { usePreviewMinimap } from '@/components/wallpaper/fullscreen-preview/features/viewport/usePreviewMinimap'
import { usePreviewZoomPan } from '@/components/wallpaper/fullscreen-preview/features/viewport/usePreviewZoomPan'

// 视口层负责缩放、拖拽、旋转、铺满/适应、全屏和小地图的几何计算。
export function usePreviewViewport({ onControlsActivity, getPreferredFitMode } = {}) {
  const previewContainer = ref(null)
  const imageElement = ref(null)
  const { isFullscreen, toggleFullscreen, exitFullscreenIfActive, handleFullscreenChange } =
    usePreviewFullscreen({ previewContainer })
  const { rotation, rotateImage, resetRotation } = usePreviewRotation({
    onRotate: () => applyConstraints(),
  })
  const { baseFitMode, currentFitMode, fitMode, applyPreferredFitMode, setFitMode, toggleFitMode } =
    usePreviewFitMode({
      getPreferredFitMode,
      onFitModeChange: () => resetZoom(),
    })

  const imageObjectFit = computed(() => fitMode.value)
  const imageSizingStyle = computed(() => ({
    width: '100%',
    height: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
  }))

  function getActiveViewportElement() {
    return imageElement.value?.parentElement || previewContainer.value || null
  }

  function getBaseDisplayMetrics() {
    const activeViewport = getActiveViewportElement()
    if (!imageElement.value || !activeViewport) return null

    const naturalWidth = imageElement.value.naturalWidth || imageElement.value.clientWidth || 0
    const naturalHeight = imageElement.value.naturalHeight || imageElement.value.clientHeight || 0
    const containerWidth = activeViewport.clientWidth || 0
    const containerHeight = activeViewport.clientHeight || 0
    if (!naturalWidth || !naturalHeight || !containerWidth || !containerHeight) return null

    const containScale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight)
    const coverScale = Math.max(containerWidth / naturalWidth, containerHeight / naturalHeight)
    const baseScale = containScale || 1
    const coverZoomFactor = coverScale > 0 ? coverScale / Math.max(baseScale, 0.0001) : 1

    return {
      naturalWidth,
      naturalHeight,
      containerWidth,
      containerHeight,
      containScale,
      coverScale,
      baseScale,
      coverZoomFactor: Math.max(1, coverZoomFactor),
      baseDisplayWidth: naturalWidth * baseScale,
      baseDisplayHeight: naturalHeight * baseScale,
    }
  }

  const {
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
  } = usePreviewZoomPan({
    imageElement,
    getActiveViewportElement,
    getBaseDisplayMetrics,
    baseFitMode,
    rotation,
    onControlsActivity,
  })

  const { showMinimap, minimapStyle, minimapViewportStyle, startMinimapDrag, cleanupMinimap } =
    usePreviewMinimap({
      zoomLevel,
      rotation,
      getVisibleSourceRect,
      clampOffsets,
      offsetX,
      offsetY,
      onControlsActivity,
    })

  function resetViewportState() {
    applyPreferredFitMode()
    resetZoom()
    resetRotation()
  }

  function cleanupViewport() {
    cleanupZoomPan()
    cleanupMinimap()
  }

  // 初始化时应用一次用户配置，默认仍为 contain。
  applyPreferredFitMode()

  return {
    isZoomed,
    zoomLevel,
    isFullscreen,
    previewContainer,
    imageElement,
    isDragging,
    offsetX,
    offsetY,
    dragMoved,
    rotation,
    fitMode,
    transformStyle,
    cursorStyle,
    imageObjectFit,
    imageSizingStyle,
    showMinimap,
    minimapStyle,
    minimapViewportStyle,
    currentFitMode,
    getActiveViewportElement,
    getBaseDisplayMetrics,
    getVisibleSourceRect,
    applyPreferredFitMode,
    setFitMode,
    toggleFitMode,
    resetViewportState,
    toggleZoom,
    handleZoomIn,
    handleZoomOut,
    resetZoom,
    handleWheel,
    rotateImage,
    toggleFullscreen,
    startDrag,
    handleMouseMove,
    handleMouseUp,
    applyConstraints,
    drag,
    endDrag,
    startMinimapDrag,
    exitFullscreenIfActive,
    handleFullscreenChange,
    cleanupViewport,
  }
}
