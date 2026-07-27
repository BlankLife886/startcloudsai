import { ref } from 'vue'

// 浏览器全屏 API 单独封装，主弹窗和工具栏只需要触发/读取状态。
export function usePreviewFullscreen({ previewContainer } = {}) {
  const isFullscreen = ref(false)

  function toggleFullscreen() {
    if (typeof document === 'undefined') return
    if (!previewContainer?.value) return

    if (document.fullscreenElement) {
      document.exitFullscreen()
      isFullscreen.value = false
      return
    }

    previewContainer.value.requestFullscreen()
    isFullscreen.value = true
  }

  function exitFullscreenIfActive() {
    if (typeof document === 'undefined') return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    }
  }

  function handleFullscreenChange() {
    if (typeof document === 'undefined') return
    isFullscreen.value = !!document.fullscreenElement
  }

  return {
    isFullscreen,
    toggleFullscreen,
    exitFullscreenIfActive,
    handleFullscreenChange,
  }
}
