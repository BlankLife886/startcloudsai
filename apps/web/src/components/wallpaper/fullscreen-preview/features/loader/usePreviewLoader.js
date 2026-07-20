import { ref, watch } from 'vue'

import {
  buildProcessedPreviewImageData,
  hasMeaningfulPreviewAdjustment,
} from '@/components/wallpaper/fullscreen-preview/features/loader/previewProcessedImageBuilder'
import { hasColorGradeAdjustment } from '@/features/filters/filterEngine'
import { usePreviewDownloadModalState } from '@/components/wallpaper/fullscreen-preview/features/loader/usePreviewDownloadModalState'
import { usePreviewImageSource } from '@/components/wallpaper/fullscreen-preview/features/loader/usePreviewImageSource'
import notificationService from '@/services/notification'

// 图片加载层现在只装配：图片来源、滤镜预览渲染、下载弹窗状态分别在独立模块里处理。
export function usePreviewLoader({
  wallpaperRef,
  imageElement,
  rotation,
  activeFilter,
  filterIntensity,
  filterParams,
  showFilters,
  activeArtStyle,
  artStyleIntensity,
  artStyleParams,
  selectedPresetId,
  downloadsStore,
  settingsStore,
  currentProcessedImageData,
}) {
  const {
    isLoading,
    error,
    imageUrl,
    previewImageUrl,
    sourceFullUrl,
    imageInfo,
    sourceImageElement,
    loadImageElementFromUrl,
    loadImage,
    loadImageInfo,
    handleImageError,
    markImageLoaded,
    retryLoadCurrentImage,
    resetImageSourceState,
  } = usePreviewImageSource()

  const previewBuildTimer = ref(null)
  const previewQualityTimer = ref(null)
  const previewBuildToken = ref(0)
  const previewBuildInFlight = ref(false)
  const pendingFullPreview = ref(false)
  const lastPreviewKey = ref('')

  function hasMeaningfulFilterAdjustment() {
    return hasMeaningfulPreviewAdjustment({
      rotation,
      activeFilter,
      activeArtStyle,
      filterParams,
    })
  }

  async function buildProcessedImageData({
    forPreview = false,
    previewMode = 'full',
    sourceUrl = '',
  } = {}) {
    // 关键：风格强度每次都必须基于原图重算，不能拿已处理过的 dataURL 再处理。
    let sourceImage = null
    if (sourceUrl) {
      sourceImage = await loadImageElementFromUrl(sourceUrl)
    } else {
      sourceImage = sourceImageElement.value
    }
    if (!sourceImage && !sourceUrl) {
      sourceImage = await loadImageElementFromUrl(imageUrl.value)
      if (sourceImage) sourceImageElement.value = sourceImage
    }
    if (!sourceImage) return null

    return await buildProcessedPreviewImageData({
      sourceImage,
      rotation,
      activeFilter,
      filterIntensity,
      filterParams,
      showFilters,
      activeArtStyle,
      artStyleIntensity,
      artStyleParams,
      forPreview,
      previewMode,
    })
  }

  async function getProcessedImageData(options = {}) {
    return buildProcessedImageData({ forPreview: false, ...options })
  }

  const {
    closeDownloadModal,
    downloadDirectly,
    handleDownloadSubmit,
    openDownloadModal,
    resetDownloadModalState,
    showDownloadModal,
  } = usePreviewDownloadModalState({
    activeArtStyle,
    activeFilter,
    artStyleIntensity,
    artStyleParams,
    downloadsStore,
    filterIntensity,
    filterParams,
    getProcessedImageData,
    hasMeaningfulFilterAdjustment,
    notificationService,
    currentProcessedImageData,
    rotation,
    selectedPresetId,
    settingsStore,
    wallpaperRef,
  })

  function requestPreviewRender(mode = 'fast') {
    if (!imageUrl.value) return
    if (previewBuildInFlight.value) {
      if (mode === 'full') pendingFullPreview.value = true
      return
    }

    const token = Date.now()
    previewBuildToken.value = token
    previewBuildInFlight.value = true
    buildProcessedImageData({ forPreview: true, previewMode: mode })
      .then((processed) => {
        if (previewBuildToken.value !== token) return
        previewImageUrl.value = processed || imageUrl.value
      })
      .finally(() => {
        if (previewBuildToken.value === token) {
          previewBuildInFlight.value = false
        }
        if (pendingFullPreview.value) {
          pendingFullPreview.value = false
          requestPreviewRender('full')
        }
      })
  }

  function schedulePreviewRebuild() {
    const styleId = activeArtStyle?.value || 'none'
    const previewKey = JSON.stringify({
      imageUrl: imageUrl.value,
      styleId,
      styleIntensity: artStyleIntensity?.value ?? 60,
      styleParams: artStyleParams?.[styleId] || {},
      activeFilter: activeFilter.value,
      filterIntensity: filterIntensity.value,
      showFilters: showFilters.value,
      rotation: rotation.value,
      filterParams: { ...filterParams },
    })
    if (previewKey === lastPreviewKey.value && previewImageUrl.value) return
    lastPreviewKey.value = previewKey

    if (previewBuildTimer.value) {
      clearTimeout(previewBuildTimer.value)
      previewBuildTimer.value = null
    }
    if (previewQualityTimer.value) {
      clearTimeout(previewQualityTimer.value)
      previewQualityTimer.value = null
    }

    previewBuildTimer.value = setTimeout(() => {
      previewBuildTimer.value = null
      if (!imageUrl.value) return
      const needsCanvasPreview =
        (activeArtStyle?.value && activeArtStyle.value !== 'none') ||
        hasColorGradeAdjustment(filterParams)
      if (!needsCanvasPreview) {
        previewImageUrl.value = imageUrl.value
        return
      }

      // 快速预览优先响应拖动/调参，停止操作后再补一次高质量渲染。
      requestPreviewRender('fast')
      previewQualityTimer.value = setTimeout(() => {
        previewQualityTimer.value = null
        requestPreviewRender('full')
      }, 260)
    }, 60)
  }

  function handleImageLoaded() {
    isLoading.value = false
    error.value = null
    const currentSrc = imageElement.value?.currentSrc || imageElement.value?.src || ''
    markImageLoaded(currentSrc || imageUrl.value)
    if (!currentSrc.startsWith('data:')) {
      sourceImageElement.value = imageElement.value
    } else {
      // dataURL 仅作展示，真实处理仍应回到原图 source。
      sourceImageElement.value = null
      return
    }
    schedulePreviewRebuild()
  }

  function resetLoaderState() {
    resetImageSourceState()
    resetDownloadModalState()
    previewBuildToken.value = 0
    previewBuildInFlight.value = false
    pendingFullPreview.value = false
    lastPreviewKey.value = ''
    if (previewBuildTimer.value) {
      clearTimeout(previewBuildTimer.value)
      previewBuildTimer.value = null
    }
    if (previewQualityTimer.value) {
      clearTimeout(previewQualityTimer.value)
      previewQualityTimer.value = null
    }
  }

  watch(
    [
      activeFilter,
      filterIntensity,
      showFilters,
      rotation,
      activeArtStyle,
      artStyleIntensity,
      artStyleParams,
    ],
    () => {
      if (!imageUrl.value) return
      schedulePreviewRebuild()
    },
  )

  watch(
    filterParams,
    () => {
      if (!imageUrl.value) return
      schedulePreviewRebuild()
    },
    { deep: true },
  )

  watch(
    artStyleParams,
    () => {
      if (!imageUrl.value) return
      schedulePreviewRebuild()
    },
    { deep: true },
  )

  watch(imageUrl, (nextUrl) => {
    previewImageUrl.value = nextUrl || ''
    sourceImageElement.value = null
  })

  return {
    isLoading,
    error,
    imageUrl,
    previewImageUrl,
    sourceFullUrl,
    imageInfo,
    showDownloadModal,
    loadImage,
    loadImageInfo,
    getProcessedImageData,
    openDownloadModal,
    closeDownloadModal,
    handleDownloadSubmit,
    downloadDirectly,
    handleImageLoaded,
    handleImageError,
    retryLoadCurrentImage,
    resetLoaderState,
  }
}
