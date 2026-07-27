import { applyArtStyleToCanvas } from '@/features/filters/artStyleEngine'
import {
  applyColorGradeToCanvas,
  buildPreviewFilterCssString,
} from '@/features/filters/filterEngine'

export const DEFAULT_PREVIEW_FILTER_PARAMS = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  hueRotate: 0,
  invert: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  shadowCool: 0,
  highlightWarm: 0,
  vignette: 0,
  lutStyle: 'none',
  lutIntensity: 0,
  curveStrength: 0,
  grain: 0,
  skinProtect: 70,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  blackPoint: 0,
  vibrance: 0,
  clarity: 0,
  skinSmooth: 0,
  skinWarmth: 0,
  cameraProfile: 'none',
  profileIntensity: 0,
}

const HEAVY_ART_STYLES = new Set(['oil_paint', 'comic', 'chibi', 'perler_beads', 'game'])

export function hasMeaningfulPreviewAdjustment({
  rotation,
  activeFilter,
  activeArtStyle,
  filterParams,
}) {
  if (rotation.value !== 0) return true
  if (activeFilter.value !== 'none') return true
  if (activeArtStyle?.value && activeArtStyle.value !== 'none') return true
  return Object.entries(DEFAULT_PREVIEW_FILTER_PARAMS).some(([key, defaultValue]) => {
    const value = filterParams[key]
    if (typeof defaultValue === 'string') return String(value || defaultValue) !== defaultValue
    return Number(value) !== defaultValue
  })
}

// 处理后预览图统一在这里生成，避免 loader 同时背负 canvas 细节。
export async function buildProcessedPreviewImageData({
  sourceImage,
  rotation,
  activeFilter,
  filterIntensity,
  filterParams,
  showFilters,
  activeArtStyle,
  artStyleIntensity,
  artStyleParams,
  forPreview = false,
  previewMode = 'full',
}) {
  if (!sourceImage) return null

  const activeStyleId = activeArtStyle?.value || 'none'
  const maxPreviewPixels = forPreview
    ? HEAVY_ART_STYLES.has(activeStyleId)
      ? previewMode === 'fast'
        ? 900 * 900
        : 1300 * 1300
      : previewMode === 'fast'
        ? 1400 * 1400
        : 1900 * 1900
    : Infinity
  const rawWidth = sourceImage.naturalWidth || sourceImage.width || 0
  const rawHeight = sourceImage.naturalHeight || sourceImage.height || 0
  if (!rawWidth || !rawHeight) return null

  let drawWidth = rawWidth
  let drawHeight = rawHeight
  if (forPreview && rawWidth * rawHeight > maxPreviewPixels) {
    const scale = Math.sqrt(maxPreviewPixels / (rawWidth * rawHeight))
    drawWidth = Math.max(1, Math.round(rawWidth * scale))
    drawHeight = Math.max(1, Math.round(rawHeight * scale))
  }

  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    canvas.width = drawWidth
    canvas.height = drawHeight

    const css = buildPreviewFilterCssString(
      activeFilter.value,
      showFilters.value,
      filterIntensity.value,
      filterParams,
    )
    ctx.filter = css === 'none' ? 'none' : css
    ctx.drawImage(sourceImage, 0, 0, drawWidth, drawHeight)
    ctx.filter = 'none'
    applyColorGradeToCanvas(ctx, drawWidth, drawHeight, filterParams)

    if (activeArtStyle?.value && activeArtStyle.value !== 'none') {
      applyArtStyleToCanvas(
        ctx,
        drawWidth,
        drawHeight,
        activeArtStyle.value,
        artStyleIntensity?.value ?? 60,
        artStyleParams,
      )
    }

    if (!forPreview && rotation.value !== 0) {
      const rotatedCanvas = document.createElement('canvas')
      const rotatedCtx = rotatedCanvas.getContext('2d')
      if (!rotatedCtx) return null
      rotatedCanvas.width = drawWidth
      rotatedCanvas.height = drawHeight
      rotatedCtx.translate(drawWidth / 2, drawHeight / 2)
      rotatedCtx.rotate((rotation.value * Math.PI) / 180)
      rotatedCtx.drawImage(canvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
      return rotatedCanvas.toDataURL('image/jpeg', 0.95)
    }

    const quality = forPreview ? (previewMode === 'fast' ? 0.78 : 0.9) : 0.95
    return canvas.toDataURL('image/jpeg', quality)
  } catch (err) {
    console.error('生成处理图像失败:', err)
    return null
  }
}
