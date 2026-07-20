import { createServerAiJob, waitForServerAiJob } from '@/services/aiWallpaper'
import { extractServerAiPreviewOutput } from '../features/ai/aiPreviewUtils'

// 登录态走后端任务队列：后端保存 provider task/result，避免前端刷新后丢失进度。
export async function submitServerImageEditJob({
  provider,
  model,
  sourceUrl,
  prompt,
  pricingUsd = 0,
  outputAspect = '',
  outputSize = '',
  profileKey = '',
  onStatus = null,
}) {
  const response = await createServerAiJob({
    kind: 'preview-image-edit',
    prompt,
    input: {
      sourceUrl,
      outputAspect,
      aspectRatio: outputAspect,
      outputSize,
      size: outputSize,
    },
    params: {
      providerHint: provider,
      modelHint: model,
      sourceUrl,
      outputAspect,
      aspectRatio: outputAspect,
      outputSize,
      size: outputSize,
      profileKey,
      adapterProfileKey: profileKey,
      executionMode: 'server',
    },
    estimatedCostUsd: Number(pricingUsd || 0),
    units: 1,
  })
  const jobId = response.job?.id
  if (!jobId) throw new Error('云端 AI 任务创建后未返回 ID')
  const { result } = await waitForServerAiJob(jobId, {
    onStatus,
    intervalMs: 2500,
    maxPolls: 80,
  })
  const output = extractServerAiPreviewOutput(result)
  if (!output) throw new Error('云端 AI 未返回可用图片')
  return output
}
