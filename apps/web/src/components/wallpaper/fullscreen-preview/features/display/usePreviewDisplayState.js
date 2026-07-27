import { computed } from 'vue'

import { getPreviewImageCrossorigin } from '@/components/wallpaper/fullscreen-preview/composables/useCanvasSafeImage'
import { getArtStyleById } from '@/features/filters/artStyleEngine'
import { hasColorGradeAdjustment } from '@/features/filters/filterEngine'

// 展示层派生状态集中放这里，主弹窗只负责把结果传给模板。
export function usePreviewDisplayState({
  activeArtStyle,
  activeFilter,
  aspectBackdropUrl,
  cursorStyle,
  filterStyle,
  filterParams,
  fitMode,
  imageObjectFit,
  imageSizingStyle,
  imageUrl,
  previewDisplayUrl,
  transformStyle,
}) {
  const processedImageStyle = computed(() => {
    const baseStyle = [
      transformStyle.value,
      { cursor: cursorStyle.value, objectFit: imageObjectFit.value },
      imageSizingStyle.value,
    ]
    if (activeArtStyle.value !== 'none' || hasColorGradeAdjustment(filterParams)) return baseStyle
    return [
      transformStyle.value,
      filterStyle.value,
      { cursor: cursorStyle.value, objectFit: imageObjectFit.value },
      imageSizingStyle.value,
    ]
  })

  const originalImageCrossorigin = computed(() => getPreviewImageCrossorigin(imageUrl.value))
  const previewImageCrossorigin = computed(() =>
    getPreviewImageCrossorigin(previewDisplayUrl.value),
  )

  const processedLabel = computed(() => {
    if (activeArtStyle.value !== 'none') {
      return getArtStyleById(activeArtStyle.value)?.label || '风格化'
    }
    return activeFilter.value === 'none' ? '处理后' : activeFilter.value
  })

  const showAspectBackdrop = computed(() => fitMode.value === 'contain' && !!imageUrl.value)

  const aspectBackdropStyle = computed(() => ({
    // 背景层使用主图加载后生成的低清 dataURL，避免再次请求 full 原图。
    backgroundImage: aspectBackdropUrl?.value
      ? `url("${aspectBackdropUrl.value}")`
      : 'radial-gradient(circle at center, rgba(255, 255, 255, 0.1), rgba(0, 0, 0, 0.92))',
  }))

  return {
    aspectBackdropStyle,
    originalImageCrossorigin,
    previewImageCrossorigin,
    processedImageStyle,
    processedLabel,
    showAspectBackdrop,
  }
}
