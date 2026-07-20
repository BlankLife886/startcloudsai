import { computed, ref, watch } from 'vue'

// 弹窗外壳层负责控件显隐、信息面板和关闭/切图等全局行为。
export function usePreviewShell({ props, emit, viewport, effects, loader }) {
  const showInfo = ref(false)
  const showControls = ref(true)
  const isControlsHovered = ref(false)
  const controlsTimeout = ref(null)

  const formattedResolution = computed(() => {
    if (!props.wallpaper || !props.wallpaper.resolution) return '未知分辨率'
    return props.wallpaper.resolution
  })

  const formattedFileSize = computed(() => {
    if (!props.wallpaper || !props.wallpaper.file_size) return '未知大小'
    const sizeInBytes = props.wallpaper.file_size
    if (sizeInBytes < 1024) return `${sizeInBytes} B`
    if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(2)} KB`
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`
  })

  const themeStyle = computed(() => {
    return { backgroundColor: 'rgba(0, 0, 0, 0.95)', color: '#fff' }
  })

  /**
   * @param {{ resetFilters?: boolean, resetLoader?: boolean }} options
   * resetFilters: 仅关闭预览时为 true，换图/打开时不要清空滤镜（否则会覆盖本地保存的滤镜配置）
   * resetLoader: 切图时保留上一张 URL，避免整屏闪白后再重载
   */
  function resetViewState({ resetFilters = false, resetLoader = true } = {}) {
    viewport.resetViewportState()
    showInfo.value = false
    if (resetFilters) effects.resetEffectsState()
    if (resetLoader) loader.resetLoaderState()
  }

  function closePreview() {
    resetViewState({ resetFilters: true })
    emit('close')
  }

  function toggleInfo() {
    showInfo.value = !showInfo.value
  }

  function showControlsOnMouseMove() {
    showControls.value = true
    startControlsTimer()
  }

  function setControlsHovered(hovered) {
    isControlsHovered.value = hovered
    showControls.value = true
    if (hovered) {
      clearControlsTimer()
      return
    }
    startControlsTimer()
  }

  function isFilterPanelOpen() {
    return Boolean(effects?.showFilters?.value)
  }

  function startControlsTimer() {
    clearControlsTimer()
    if (isFilterPanelOpen()) return
    controlsTimeout.value = setTimeout(() => {
      if (
        !viewport.isDragging.value &&
        !isControlsHovered.value &&
        !showInfo.value &&
        !isFilterPanelOpen() &&
        !loader.showDownloadModal.value
      ) {
        showControls.value = false
      }
    }, 3000)
  }

  watch(
    () => effects?.showFilters?.value,
    (open) => {
      if (open) {
        showControls.value = true
        clearControlsTimer()
        return
      }
      startControlsTimer()
    },
  )

  function clearControlsTimer() {
    if (controlsTimeout.value) {
      clearTimeout(controlsTimeout.value)
      controlsTimeout.value = null
    }
  }

  return {
    showInfo,
    showControls,
    formattedResolution,
    formattedFileSize,
    themeStyle,
    resetViewState,
    closePreview,
    toggleInfo,
    showControlsOnMouseMove,
    setControlsHovered,
    startControlsTimer,
    clearControlsTimer,
  }
}
