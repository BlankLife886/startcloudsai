import { createServerAiJob, extractMediaOutput, waitForServerAiJob } from '@/services/aiWallpaper'
import {
  DEFAULT_COLORING_STYLE_CATEGORIES,
  DEFAULT_COLORING_STYLE_PRESETS,
} from '@/config/shared/illustrationColoringStyles'

export const ILLUSTRATION_COLORING_FEATURE_KEY = 'ai.illustrationColoring'
export const ILLUSTRATION_COLORING_PUBLIC_MODEL = 'walleven-illustration-coloring'

/** 10 分钟后只提示上游结果未知并继续查询，不在前端自动取消任务。 */
export const COLORING_JOB_MAX_WAIT_MS = 10 * 60 * 1000
export const COLORING_JOB_POLL_INTERVAL_MS = 3000
export const COLORING_JOB_MAX_POLLS = Math.ceil(
  COLORING_JOB_MAX_WAIT_MS / COLORING_JOB_POLL_INTERVAL_MS,
)

export const COLORING_STYLE_CATEGORIES = DEFAULT_COLORING_STYLE_CATEGORIES
export const COLORING_STYLE_PRESETS = DEFAULT_COLORING_STYLE_PRESETS

function asCatalogRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function normalizeCatalogRows(rows, fallbackRows, mapper) {
  const source = Array.isArray(rows) ? rows : fallbackRows
  const ids = new Set()
  return source
    .map((item, index) => mapper(asCatalogRecord(item), index))
    .filter((item) => {
      if (!item?.id || ids.has(item.id)) return false
      ids.add(item.id)
      return true
    })
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

export function resolveColoringStyleCatalog(value) {
  const catalog = asCatalogRecord(value)
  const categories = normalizeCatalogRows(
    catalog?.categories,
    DEFAULT_COLORING_STYLE_CATEGORIES,
    (item, index) => {
      if (!item) return null
      const id = String(item.id || '').trim()
      if (!id) return null
      return {
        id,
        label: String(item.label || id).trim() || id,
        icon: String(item.icon || 'bi-palette2').trim() || 'bi-palette2',
        hint: String(item.hint || '').trim(),
        enabled: item.enabled !== false,
        sortOrder: Number.isFinite(Number(item.sortOrder))
          ? Number(item.sortOrder)
          : (index + 1) * 10,
      }
    },
  )
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const styles = normalizeCatalogRows(
    catalog?.styles,
    DEFAULT_COLORING_STYLE_PRESETS,
    (item, index) => {
      if (!item) return null
      const id = String(item.id || '').trim()
      const categoryId = String(item.categoryId || 'base').trim() || 'base'
      if (!id) return null
      return {
        id,
        categoryId,
        categoryLabel: String(
          item.categoryLabel || categoryById.get(categoryId)?.label || categoryId,
        ).trim(),
        label: String(item.label || id).trim() || id,
        icon: String(item.icon || 'bi-palette2').trim() || 'bi-palette2',
        hint: String(item.hint || '').trim(),
        prompt: String(item.prompt || ''),
        previewUrl: String(item.previewUrl || '').trim(),
        enabled: item.enabled !== false,
        sortOrder: Number.isFinite(Number(item.sortOrder))
          ? Number(item.sortOrder)
          : (index + 1) * 10,
      }
    },
  )
  const enabledCategories = categories.filter((category) => category.enabled !== false)
  const enabledCategoryIds = new Set(enabledCategories.map((category) => category.id))
  const enabledStyles = styles.filter(
    (style) => style.enabled !== false && enabledCategoryIds.has(style.categoryId),
  )
  return {
    categories: enabledCategories,
    styles: enabledStyles,
  }
}

export function findColoringStylePreset(styleId = '', presets = COLORING_STYLE_PRESETS) {
  if (styleId === 'reference-style') {
    return {
      id: 'reference-style',
      label: '参考图风格',
      categoryId: 'reference',
      categoryLabel: '参考图',
      hint: '使用参考图提取配色、材质、光影和氛围',
      icon: 'bi-images',
      prompt: '',
    }
  }
  return presets.find((item) => item.id === styleId) || presets[0] || null
}

export function getColoringStyleCategory(
  styleId = '',
  categories = COLORING_STYLE_CATEGORIES,
  presets = COLORING_STYLE_PRESETS,
) {
  const preset = findColoringStylePreset(styleId, presets)
  return categories.find((item) => item.id === preset?.categoryId) || categories[0] || null
}

export function listColoringStylePresetsByCategory(
  categoryId = 'base',
  presets = COLORING_STYLE_PRESETS,
) {
  return presets.filter((item) => item.categoryId === categoryId)
}

export function buildColoringPrompt(styleId, customPrompt = '', options = {}) {
  const preset = options.stylePreset || findColoringStylePreset(styleId, options.presets)
  const referenceCount = Math.max(0, Number(options.referenceCount || 0))
  if (referenceCount > 0) {
    return `Color the first line art image using only the additional reference image${referenceCount > 1 ? 's' : ''} as visual style references. Extract palette, lighting, material rendering, texture density, contrast, and overall mood from the reference image${referenceCount > 1 ? 's' : ''}. Preserve the original line art, composition, subject identity, pose, and all drawing details from the first image. Do not apply any separate preset style, do not copy the reference composition or subjects, and keep the final result clean and coherent.`
  }
  const referenceHint = referenceCount
    ? ` Use the additional reference image${referenceCount > 1 ? 's' : ''} only as style references for palette, lighting, texture and mood. The first image is the line art canvas to color; do not copy the reference image composition or subjects.`
    : ''
  if (!preset) return `${String(customPrompt || '').trim()}${referenceHint}`.trim()
  if (styleId === 'custom') {
    const extra = String(customPrompt || '').trim()
    const base =
      'Color this line art illustration professionally. Preserve all original line art, composition and subject details. Use clean fills and harmonious palette.'
    return `${extra ? `${base} ${extra}` : base}${referenceHint}`.trim()
  }
  return `${preset.prompt}${referenceHint}`.trim()
}

export async function createIllustrationColoringJob({
  sourceUrl,
  clientRequestId = '',
  title = '',
  styleId = 'watercolor',
  customPrompt = '',
  publicModelKey = ILLUSTRATION_COLORING_PUBLIC_MODEL,
  outputSize = 'original',
  outputWidth = 0,
  outputHeight = 0,
  outputOrientation = 'source',
  pricingUsd = 0,
  referenceImageUrls = [],
  referenceStrength = 'balanced',
  batchId = '',
  variantIndex = 1,
  variantCount = 1,
  stylePreset = null,
  styleLabel = '',
}) {
  const normalizedReferenceUrls = Array.from(
    new Set(
      (Array.isArray(referenceImageUrls) ? referenceImageUrls : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  ).slice(0, 4)
  const orientation = String(outputOrientation || 'source').trim()
  const orientationPrompt =
    orientation === 'landscape'
      ? ' Extend the original composition naturally to a wide landscape canvas. Preserve every existing subject and line-art detail, and create coherent left and right continuation instead of cropping or stretching the original image.'
      : orientation === 'portrait'
        ? ' Compose the final artwork as a vertical portrait canvas. Preserve every existing subject and line-art detail without cropping or stretching.'
        : ' Keep the original canvas orientation and composition without cropping or stretching.'
  const prompt = `${buildColoringPrompt(styleId, customPrompt, {
    referenceCount: normalizedReferenceUrls.length,
    stylePreset,
  })}${orientationPrompt}`.trim()
  if (!sourceUrl) throw new Error('请先上传线稿插画')
  if (!prompt) throw new Error('请填写自定义配色描述')

  const sizeLabel =
    Number(outputWidth) > 0 && Number(outputHeight) > 0
      ? `${Math.round(outputWidth)}x${Math.round(outputHeight)}`
      : ''

  const response = await createServerAiJob({
    kind: 'illustration-coloring',
    clientRequestId,
    prompt,
    model: publicModelKey,
    input: {
      sourceUrl,
      sourceUrls: [sourceUrl, ...normalizedReferenceUrls],
      referenceImageUrls: normalizedReferenceUrls,
      referenceStrength,
      batchId,
      title: String(title || '').trim(),
      variantIndex: Number(variantIndex || 1),
      variantCount: Number(variantCount || 1),
      styleId: normalizedReferenceUrls.length ? 'reference-style' : styleId,
      styleLabel: normalizedReferenceUrls.length
        ? '参考图风格'
        : String(styleLabel || stylePreset?.label || '').trim(),
      customPrompt: normalizedReferenceUrls.length ? '' : String(customPrompt || '').trim(),
      outputSize,
      outputWidth: Number(outputWidth || 0),
      outputHeight: Number(outputHeight || 0),
      outputOrientation: orientation,
      size: sizeLabel,
    },
    params: {
      publicModelKey,
      modelHint: publicModelKey,
      sourceUrl,
      sourceUrls: [sourceUrl, ...normalizedReferenceUrls],
      referenceImageUrls: normalizedReferenceUrls,
      referenceStrength,
      batchId,
      title: String(title || '').trim(),
      variantIndex: Number(variantIndex || 1),
      variantCount: Number(variantCount || 1),
      styleId: normalizedReferenceUrls.length ? 'reference-style' : styleId,
      styleLabel: normalizedReferenceUrls.length
        ? '参考图风格'
        : String(styleLabel || stylePreset?.label || '').trim(),
      customPrompt: normalizedReferenceUrls.length ? '' : String(customPrompt || '').trim(),
      outputSize,
      outputWidth: Number(outputWidth || 0),
      outputHeight: Number(outputHeight || 0),
      outputOrientation: orientation,
      size: sizeLabel,
      executionMode: 'server',
    },
    estimatedCostUsd: Number(pricingUsd || 0),
    units: 1,
  })

  const jobId = response.job?.id
  if (!jobId) throw new Error('AI 染色任务创建后未返回 ID')
  return { jobId, job: response.job, prompt }
}

export async function submitIllustrationColoringJob({
  sourceUrl,
  styleId = 'watercolor',
  customPrompt = '',
  publicModelKey = ILLUSTRATION_COLORING_PUBLIC_MODEL,
  pricingUsd = 0,
  referenceImageUrls = [],
  referenceStrength = 'balanced',
  onStatus = null,
}) {
  const { jobId } = await createIllustrationColoringJob({
    sourceUrl,
    styleId,
    customPrompt,
    publicModelKey,
    pricingUsd,
    referenceImageUrls,
    referenceStrength,
  })

  const { result } = await waitForServerAiJob(jobId, {
    onStatus,
    intervalMs: COLORING_JOB_POLL_INTERVAL_MS,
    maxPolls: COLORING_JOB_MAX_POLLS,
  })

  const output =
    extractMediaOutput(result?.output ?? result?.result ?? result) ||
    extractMediaOutput(result?.providerPayload)

  if (!output) throw new Error('AI 未返回可用染色结果')
  return {
    jobId,
    output,
    prompt: buildColoringPrompt(styleId, customPrompt, {
      referenceCount: Array.isArray(referenceImageUrls) ? referenceImageUrls.length : 0,
    }),
  }
}
