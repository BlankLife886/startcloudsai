import { getReducedAspectLabel } from '@/components/wallpaper/fullscreen-preview/features/ai/aiAspectUtils'
import { isWebDebugEnabled, webDebugGroup, webDebugWarn } from '@/services/debugLog'

// 输入图排查信息只在控制台输出，抽离后不会干扰真正的生成流程。
export async function logPreviewAiInputDebug({
  model,
  sourceUrl,
  baseUrl,
  prompt,
  loadImageFromSrc,
  getReferenceImageSize,
  getTargetAspectLabel,
  getTargetAspectRatio,
  getTargetAspectValue,
}) {
  if (!isWebDebugEnabled('ai')) return

  try {
    const img = await loadImageFromSrc(sourceUrl)
    const naturalWidth = Number(img?.naturalWidth || 0)
    const naturalHeight = Number(img?.naturalHeight || 0)
    const refSize = getReferenceImageSize()
    const pickedBySmallThumb = /th\.wallhaven\.cc\/small/i.test(String(sourceUrl || ''))

    webDebugGroup('ai', '[AI Input Debug] 图生图输入信息', () => {
      console.log('model:', model)
      console.log('baseUrl:', baseUrl)
      console.log('sourceUrl:', sourceUrl)
      console.log('sourceNaturalSize:', `${naturalWidth}x${naturalHeight}`)
      console.log('referenceSize:', `${refSize.width || 0}x${refSize.height || 0}`)
      console.log('pickedBySmallThumb:', pickedBySmallThumb)
      console.log('targetAspectLabel:', getTargetAspectLabel())
      console.log('requestAspect:', getTargetAspectValue())
      console.log('sourceAspect:', getReducedAspectLabel(refSize.width, refSize.height))
      console.log('targetAspectRatio:', getTargetAspectRatio())
      console.log('resolutionPolicy:', '不限精确分辨率，仅校验输出比例')
      console.log('promptPreview:', String(prompt || '').slice(0, 280))
    })
  } catch (error) {
    webDebugWarn('ai', '[AI Input Debug] 日志采集失败:', error)
  }
}
