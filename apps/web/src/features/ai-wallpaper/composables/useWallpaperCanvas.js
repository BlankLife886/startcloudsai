import { computed, onBeforeUnmount, ref, watch } from 'vue'
import notificationService from '@/services/notification'

/**
 * 画布：缩放 / 平移 / 对比 / 全屏 / 预览 URL 决议
 * 预览规则：默认 result ?? source；仅 canvasMode=source 时强制原图；对比模式双图。
 */
export function useWallpaperCanvas({
  sourcePreview,
  latestOutput,
  fallbackPreview = () => '',
  notify = (message) => notificationService.warning(message),
} = {}) {
  const canvasMode = ref('auto')
  const selectedOutputIndex = ref(0)
  const comparisonMode = ref(false)
  const canvasFitMode = ref('contain')
  const canvasZoom = ref(100)
  const canvasPan = ref({ x: 0, y: 0 })
  const isCanvasPanning = ref(false)
  const canvasPanStart = ref({ x: 0, y: 0, panX: 0, panY: 0 })
  const previewStageRef = ref(null)
  const isFullscreen = ref(false)
  const holdoverPreviewUrl = ref('')
  const resultRevealing = ref(false)

  let canvasPanFrame = 0
  let pendingCanvasPan = null

  const previewImage = computed(() => {
    if (canvasMode.value === 'source') {
      return resolveSource() || resolveFallback()
    }
    if (canvasMode.value === 'result' && latestOutput?.value) {
      return latestOutput.value
    }
    // auto：结果优先，否则素材
    return latestOutput?.value || resolveSource() || resolveFallback()
  })

  const canvasMediaStyle = computed(() => ({
    objectFit: canvasFitMode.value,
    transform: `translate3d(${canvasPan.value.x}px, ${canvasPan.value.y}px, 0) scale(${canvasZoom.value / 100})`,
    cursor: canvasZoom.value > 100 ? (isCanvasPanning.value ? 'grabbing' : 'grab') : 'default',
  }))

  function resolveSource() {
    return String(sourcePreview?.value || '').trim()
  }

  function resolveFallback() {
    return typeof fallbackPreview === 'function'
      ? String(fallbackPreview() || '').trim()
      : String(fallbackPreview?.value || '').trim()
  }

  function resetCanvasView({ keepFit = false } = {}) {
    canvasZoom.value = 100
    canvasPan.value = { x: 0, y: 0 }
    pendingCanvasPan = null
    isCanvasPanning.value = false
    if (!keepFit) canvasFitMode.value = 'contain'
  }

  function setOutputView(index, { switchToResult = true } = {}) {
    selectedOutputIndex.value = index
    if (switchToResult) canvasMode.value = 'result'
    resetCanvasView({ keepFit: true })
  }

  function handleCanvasPointerDown(event) {
    if (canvasZoom.value <= 100 || event.button !== 0) return
    isCanvasPanning.value = true
    canvasPanStart.value = {
      x: event.clientX,
      y: event.clientY,
      panX: canvasPan.value.x,
      panY: canvasPan.value.y,
    }
    event.currentTarget?.setPointerCapture?.(event.pointerId)
  }

  function handleCanvasPointerMove(event) {
    if (!isCanvasPanning.value) return
    const start = canvasPanStart.value
    pendingCanvasPan = {
      x: start.panX + event.clientX - start.x,
      y: start.panY + event.clientY - start.y,
    }
    if (canvasPanFrame) return
    canvasPanFrame = window.requestAnimationFrame(() => {
      if (pendingCanvasPan) canvasPan.value = pendingCanvasPan
      pendingCanvasPan = null
      canvasPanFrame = 0
    })
  }

  function handleCanvasPointerUp(event) {
    if (!isCanvasPanning.value) return
    isCanvasPanning.value = false
    event.currentTarget?.releasePointerCapture?.(event.pointerId)
  }

  async function togglePreviewFullscreen() {
    const target = previewStageRef.value
    if (!target) return
    try {
      if (!document.fullscreenElement) {
        await target.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (error) {
      notify(error?.message || '无法切换全屏')
    }
  }

  function handleFullscreenChange() {
    isFullscreen.value = document.fullscreenElement === previewStageRef.value
  }

  function beginResultReveal(nextUrl, prevUrl) {
    const next = String(nextUrl || '').trim()
    const prev = String(prevUrl || '').trim()
    if (next && prev && next !== prev) {
      holdoverPreviewUrl.value = prev
      resultRevealing.value = true
      return
    }
    if (next && !prev) {
      holdoverPreviewUrl.value = ''
      resultRevealing.value = true
      return
    }
    if (!next) {
      holdoverPreviewUrl.value = ''
      resultRevealing.value = false
    }
  }

  function clearResultReveal() {
    holdoverPreviewUrl.value = ''
    resultRevealing.value = false
  }

  watch(canvasZoom, (zoom) => {
    if (zoom <= 100) {
      canvasPan.value = { x: 0, y: 0 }
      pendingCanvasPan = null
      isCanvasPanning.value = false
    }
  })

  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', handleFullscreenChange)
  }

  onBeforeUnmount(() => {
    if (canvasPanFrame) window.cancelAnimationFrame(canvasPanFrame)
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
  })

  return {
    canvasMode,
    selectedOutputIndex,
    comparisonMode,
    canvasFitMode,
    canvasZoom,
    canvasPan,
    isCanvasPanning,
    previewStageRef,
    isFullscreen,
    holdoverPreviewUrl,
    resultRevealing,
    previewImage,
    canvasMediaStyle,
    resetCanvasView,
    setOutputView,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    togglePreviewFullscreen,
    handleFullscreenChange,
    beginResultReveal,
    clearResultReveal,
  }
}
