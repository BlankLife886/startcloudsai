import {
  getAspectDiffRatio,
  getReducedAspectLabel,
  hasMatchingAspectRatio,
  toPositiveInt,
} from '@/components/wallpaper/fullscreen-preview/features/ai/aiAspectUtils'
import { webDebugInfo } from '@/services/debugLog'

export async function alignAiOutputResolution({
  outputDataUrl,
  loadImageFromSrc,
  notificationService,
  getAiOutputTargetSize,
  getTargetAspectLabel,
  getTargetAspectParts,
}) {
  const source = String(outputDataUrl || '').trim()
  if (!source) return source

  const { width: targetWidth, height: targetHeight } = getAiOutputTargetSize()
  const targetAspect = getTargetAspectParts()
  if (!targetWidth || !targetHeight || !targetAspect) {
    throw new Error('请输入有效输出尺寸')
  }

  const img = await loadImageFromSrc(source)
  if (!img) {
    console.warn('[AI Resize Debug] 输出图加载失败，无法执行尺寸对齐', {
      source: source.slice(0, 120),
    })
    throw new Error('AI 输出图片无法读取像素尺寸，不能保证输出尺寸正确')
  }
  const outputWidth = toPositiveInt(img.naturalWidth)
  const outputHeight = toPositiveInt(img.naturalHeight)
  const aspectDiff = getAspectDiffRatio(
    outputWidth,
    outputHeight,
    targetAspect.width,
    targetAspect.height,
  )
  const aspectMatches = hasMatchingAspectRatio(
    outputWidth,
    outputHeight,
    targetAspect.width,
    targetAspect.height,
  )

  webDebugInfo('ai', '[AI Resize Debug] 输出尺寸校验', {
    outputSize: `${outputWidth}x${outputHeight}`,
    requestSize: `${targetWidth}x${targetHeight}`,
    requestAspect: targetAspect.label,
    targetAspect: getTargetAspectLabel(),
    outputAspect: getReducedAspectLabel(outputWidth, outputHeight),
    aspectDiff,
  })

  if (!aspectMatches) {
    throw new Error(
      `AI 输出比例不正确（输出 ${outputWidth}x${outputHeight} / ${getReducedAspectLabel(outputWidth, outputHeight)}，要求 ${targetAspect.label}），已拒绝使用该结果。`,
    )
  }

  if (outputWidth === targetWidth && outputHeight === targetHeight) {
    notificationService.info(`AI 输出尺寸已通过校验：${outputWidth}x${outputHeight}`)
    return source
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法调整 AI 输出尺寸')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
  notificationService.info(`AI 输出已调整到目标尺寸：${targetWidth}x${targetHeight}`)
  return canvas.toDataURL('image/png')
}
