import {
  getReducedAspectLabel,
  parseAiOutputSize,
  parseAspectRatioLabel,
  parseResolutionText,
  toPositiveInt,
} from '@/components/wallpaper/fullscreen-preview/features/ai/aiAspectUtils'

// 目标尺寸依赖用户输出尺寸；比例从尺寸自动得出，避免比例和尺寸互相冲突。
export function createPreviewAiTargetAspect({
  props,
  imageElement,
  imageInfo,
  aiOutputSize,
  aiSourceReferenceSize,
  aiImageProcessingConfig,
}) {
  function getReferenceImageSize() {
    const candidates = [
      aiSourceReferenceSize.value || {},
      props.wallpaper || {},
      imageInfo.value || {},
    ]

    for (const item of candidates) {
      const pairs = [
        [item.dimension_x, item.dimension_y],
        [item.width, item.height],
        [item.w, item.h],
        [item.resolution_x, item.resolution_y],
      ]
      for (const [w, h] of pairs) {
        const width = toPositiveInt(w)
        const height = toPositiveInt(h)
        if (width > 0 && height > 0) {
          return { width, height }
        }
      }

      const fromText = parseResolutionText(item.resolution || item.res || item.size)
      if (fromText.width > 0 && fromText.height > 0) return fromText
    }

    const naturalWidth = toPositiveInt(imageElement.value?.naturalWidth)
    const naturalHeight = toPositiveInt(imageElement.value?.naturalHeight)
    if (naturalWidth > 0 && naturalHeight > 0) {
      return { width: naturalWidth, height: naturalHeight }
    }

    return { width: 0, height: 0 }
  }

  function getAiOutputTargetSize() {
    const requested = parseAiOutputSize(
      aiOutputSize.value,
      aiImageProcessingConfig?.value?.outputSizePresets || [],
    )
    if (requested.width > 0 && requested.height > 0) {
      return { width: requested.width, height: requested.height }
    }
    return { width: 0, height: 0 }
  }

  function getTargetOutputSizeValue() {
    const { width, height } = getAiOutputTargetSize()
    return width > 0 && height > 0 ? `${width}x${height}` : ''
  }

  function getTargetAspectRatio() {
    const { width, height } = getAiOutputTargetSize()
    if (width > 0 && height > 0) return width / height
    return 0
  }

  function getSelectedOutputAspectValue() {
    const { width, height } = getAiOutputTargetSize()
    return getReducedAspectLabel(width, height)
  }

  function getTargetAspectValue() {
    return getSelectedOutputAspectValue()
  }

  function getTargetAspectLabel() {
    const { width, height } = getAiOutputTargetSize()
    const aspect = getReducedAspectLabel(width, height)
    if (!width || !height || !aspect) return '输出尺寸：未设置'
    return `输出尺寸：${width}x${height}，输出比例：${aspect}`
  }

  function getTargetAspectParts() {
    return parseAspectRatioLabel(getTargetAspectValue())
  }

  return {
    getAiOutputTargetSize,
    getReferenceImageSize,
    getSelectedOutputAspectValue,
    getTargetAspectLabel,
    getTargetAspectParts,
    getTargetAspectRatio,
    getTargetAspectValue,
    getTargetOutputSizeValue,
  }
}
