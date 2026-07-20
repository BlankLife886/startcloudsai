import { nextTick, onMounted, onUnmounted, watch } from 'vue'

// 全屏预览会修改 body 滚动、监听全屏事件，并在打开/换图时重置多组状态。
// 这些属于弹窗会话生命周期，集中在这里能让主组件只负责装配各 feature。
export function usePreviewSessionLifecycle({
  props,
  showControls,
  resetAiSourceReferenceSize,
  resetViewState,
  loadImage,
  syncFavoriteState,
  resetPreviewState,
  startControlsTimer,
  applyPreferredFitMode,
  exitFullscreenIfActive,
  clearControlsTimer,
  handleFullscreenChange,
  cleanupViewport,
  cleanupEffectResources,
  selectConfiguredAiModel,
  loadAiHistory,
  loadAiRecipes,
}) {
  let sessionToken = 0

  function setBodyPreviewLock(locked) {
    if (typeof document === 'undefined') return
    document.body.style.overflow = locked ? 'hidden' : ''
  }

  async function openPreviewSession(
    wallpaper,
    { resetFilters = false, preserveMockup = false, preserveImage = false } = {},
  ) {
    const token = ++sessionToken
    resetAiSourceReferenceSize()
    if (!wallpaper) return

    // 首次打开和切图统一从这里进入，避免 wallpaper/show 两个监听互相重置 loader。
    resetViewState({ resetFilters, resetLoader: !preserveImage })
    showControls.value = true
    startControlsTimer()
    applyPreferredFitMode()

    // 等 v-if="show" 的弹窗容器先挂到 DOM，再写入图片地址，首帧渲染更稳定。
    await nextTick()
    if (token !== sessionToken || !props.show) return

    await loadImage(wallpaper)
    if (token !== sessionToken || !props.show) return

    syncFavoriteState(wallpaper)
    resetPreviewState({ withFeedback: false, preserveMockup })
  }

  watch(
    [() => props.show, () => props.wallpaper],
    async ([newShow, newWallpaper], [oldShow, oldWallpaper] = []) => {
      setBodyPreviewLock(newShow)

      if (!newShow) {
        sessionToken += 1
        if (oldShow) {
          exitFullscreenIfActive()
          clearControlsTimer()
          resetPreviewState({ withFeedback: false })
        }
        return
      }

      resetAiSourceReferenceSize()
      if (!newWallpaper) return

      const opened = !oldShow
      const wallpaperChanged = String(newWallpaper?.id || '') !== String(oldWallpaper?.id || '')

      if (opened || wallpaperChanged) {
        await openPreviewSession(newWallpaper, {
          resetFilters: opened,
          preserveMockup: wallpaperChanged && !opened,
          preserveImage: wallpaperChanged && !opened,
        })
      }
    },
    { immediate: true },
  )

  onMounted(() => {
    selectConfiguredAiModel()
    loadAiHistory()
    loadAiRecipes()
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', handleFullscreenChange)
    }
  })

  onUnmounted(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
    cleanupViewport()
    clearControlsTimer()
    cleanupEffectResources()
    setBodyPreviewLock(false)
  })
}
