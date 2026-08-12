import { createServerAiJob, extractMediaOutput, waitForServerAiJob } from '@/services/aiWallpaper'

export const ILLUSTRATION_COLORING_FEATURE_KEY = 'ai.illustrationColoring'
export const ILLUSTRATION_COLORING_PUBLIC_MODEL = 'standard'

/** 10 分钟后只提示上游结果未知并继续查询，不在前端自动取消任务。 */
export const COLORING_JOB_MAX_WAIT_MS = 10 * 60 * 1000
export const COLORING_JOB_POLL_INTERVAL_MS = 3000
export const COLORING_JOB_MAX_POLLS = Math.ceil(
  COLORING_JOB_MAX_WAIT_MS / COLORING_JOB_POLL_INTERVAL_MS,
)

export function buildColoringPrompt(_styleId, customPrompt = '', options = {}) {
  const referenceCount = Math.max(0, Number(options.referenceCount || 0))
  const extra = String(customPrompt || '').trim()
  const base =
    'Color the first line-art image professionally. Preserve the original composition, line work, subject identity, pose, facial features, text, and every drawing detail. Apply clean fills, coherent lighting, harmonious colors, and finished material rendering. Do not crop, stretch, redraw, or replace the original subject.'
  const referenceHint = referenceCount
    ? ` Use the additional reference image${referenceCount > 1 ? 's' : ''} only as visual references for palette, lighting, material, texture density, contrast, and mood. Do not copy their composition or subjects.`
    : ''
  const userHint = extra ? ` User coloring direction: ${extra}` : ''
  return `${base}${referenceHint}${userHint}`.trim()
}

export async function createIllustrationColoringJob({
  sourceUrl,
  clientRequestId = '',
  title = '',
  styleId = 'coloring',
  customPrompt = '',
  publicModelKey = ILLUSTRATION_COLORING_PUBLIC_MODEL,
  outputSize = 'original',
  aspectRatio = '',
  resolutionScale = '',
  quality = '',
  outputFormat = '',
  moderationLevel = '',
  outputWidth = 0,
  outputHeight = 0,
  outputOrientation = 'source',
  pricingUsd = 0,
  referenceImageUrls = [],
  maxAdditionalReferences = 3,
  referenceStrength = 'balanced',
  batchId = '',
  variantIndex = 1,
  variantCount = 1,
}) {
  const normalizedReferenceUrls = Array.from(
    new Set(
      (Array.isArray(referenceImageUrls) ? referenceImageUrls : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  ).slice(0, Math.max(0, Math.min(15, Number(maxAdditionalReferences) || 0)))
  const orientation = String(outputOrientation || 'source').trim()
  const orientationPrompt =
    orientation === 'source'
      ? ' Keep the original canvas ratio and composition.'
      : ` Compose the final artwork on a ${orientation} canvas. Extend the background naturally when needed while preserving the complete original subject without cropping or stretching.`
  const prompt = `${buildColoringPrompt(styleId, customPrompt, {
    referenceCount: normalizedReferenceUrls.length,
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
      styleId: 'coloring',
      styleLabel: '插画染色',
      customPrompt: String(customPrompt || '').trim(),
      outputSize,
      aspectRatio,
      resolutionScale,
      quality,
      outputFormat,
      moderationLevel,
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
      styleId: 'coloring',
      styleLabel: '插画染色',
      customPrompt: String(customPrompt || '').trim(),
      outputSize,
      aspectRatio,
      resolutionScale,
      quality,
      outputFormat,
      moderationLevel,
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
  styleId = 'coloring',
  customPrompt = '',
  publicModelKey = ILLUSTRATION_COLORING_PUBLIC_MODEL,
  pricingUsd = 0,
  referenceImageUrls = [],
  referenceStrength = 'balanced',
  onStatus = null,
  signal = undefined,
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
    signal,
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
