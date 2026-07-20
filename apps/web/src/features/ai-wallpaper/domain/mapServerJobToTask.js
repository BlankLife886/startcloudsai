import { isWallpaperStudioJobKind } from '@/features/ai-shared/aiJobKinds'
import {
  extractMediaOutput,
  extractMediaOutputs,
  getServerAiJobResult,
} from '@/services/aiWallpaper'
import { resolveTaskOutputSizeFields } from './outputSizeMetadata'

const TERMINAL_JOB_STATUSES = new Set([
  'completed',
  'done',
  'failed',
  'cancelled',
  'canceled',
  'paused',
])

export { isWallpaperStudioJobKind }

export function isWallpaperJobKind(kind = '') {
  return isWallpaperStudioJobKind(kind)
}

function isTerminalJobStatus(status = '') {
  return TERMINAL_JOB_STATUSES.has(
    String(status || '')
      .trim()
      .toLowerCase(),
  )
}

function isCompletedJobStatus(status = '') {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  return value === 'completed' || value === 'done'
}

export function isConfirmedServerJobCancellation(response = {}) {
  const status = String(response?.job?.status || '')
    .trim()
    .toLowerCase()
  return response?.cancelled === true || status === 'cancelled' || status === 'canceled'
}

export function shouldKeepExistingTaskSnapshot(existingStatus = '', incomingStatus = '') {
  const existing = String(existingStatus || '')
    .trim()
    .toLowerCase()
  const incoming = String(incomingStatus || '')
    .trim()
    .toLowerCase()
  if (!incoming) return false
  if (isCompletedJobStatus(existing) && !isCompletedJobStatus(incoming)) return true
  return isTerminalJobStatus(existing) && !isTerminalJobStatus(incoming)
}

function pickPersistableUrl(...values) {
  for (const value of values) {
    const url = String(value || '').trim()
    if (!url || url.startsWith('blob:')) continue
    return url
  }
  return ''
}

function parseServerTime(value, fallback = 0) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function extractServerJobOutputs(result) {
  const outputPayload = result?.output ?? result?.result ?? result
  const candidates = [
    typeof outputPayload === 'string' ? outputPayload : '',
    typeof outputPayload?.output === 'string' ? outputPayload.output : '',
    typeof outputPayload?.url === 'string' ? outputPayload.url : '',
    typeof outputPayload?.resultUrl === 'string' ? outputPayload.resultUrl : '',
    typeof outputPayload?.providerPayload === 'object'
      ? extractMediaOutput(outputPayload.providerPayload)
      : '',
    extractMediaOutput(outputPayload),
    ...extractMediaOutputs(outputPayload),
  ]
  const lists = [
    Array.isArray(outputPayload?.outputs) ? outputPayload.outputs : [],
    Array.isArray(outputPayload?.images) ? outputPayload.images : [],
    Array.isArray(outputPayload?.videos) ? outputPayload.videos : [],
  ]
  for (const list of lists) {
    list.forEach((item) => {
      if (typeof item === 'string') candidates.push(item)
      else if (item && typeof item === 'object')
        candidates.push(item.url, item.image_url, item.video_url, item.output)
    })
  }
  return Array.from(new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean)))
}

function mergePersistedOutputs(persistedOutputs = [], fallbackOutputs = []) {
  if (!persistedOutputs.length) return Array.from(new Set(fallbackOutputs.filter(Boolean)))
  const supplements = fallbackOutputs.slice(persistedOutputs.length)
  return Array.from(new Set([...persistedOutputs, ...supplements].filter(Boolean)))
}

/** 远端 Job 映射为本地 Task，尽量保留 prompt 与输入信息 */
export function mapServerJobToTask(job, { resolveModelLabel, existingTask = null } = {}) {
  const isVideo = String(job?.kind || '').includes('video')
  const input = job?.input || job?.params || {}
  const persistedResultUrl = pickPersistableUrl(job?.resultMediaUrl)
  const persistedResultUrls = Array.from(
    new Set(
      (Array.isArray(job?.resultMediaUrls) ? job.resultMediaUrls : [])
        .map((item) => pickPersistableUrl(item))
        .filter(Boolean),
    ),
  )
  const existingOutputs = Array.isArray(existingTask?.outputs)
    ? existingTask.outputs.filter(Boolean)
    : []
  // 结果媒体是服务端持久化的稳定地址，优先于可能过期的上游 URL 或旧本地快照。
  const stableOutputs = persistedResultUrls.length
    ? persistedResultUrls
    : persistedResultUrl
      ? [persistedResultUrl]
      : []
  const seededOutputs = mergePersistedOutputs(stableOutputs, existingOutputs)
  const outputSizeFields = resolveTaskOutputSizeFields(job, existingTask || {})
  return {
    id: existingTask?.id || `server-${job.id}`,
    serverJobId: job.id,
    kind: String(job?.kind || existingTask?.kind || '').trim(),
    executionMode: 'server',
    status: job.status || existingTask?.status || 'queued',
    type: isVideo ? 'video' : 'image',
    model:
      resolveModelLabel?.(job) ||
      existingTask?.model ||
      String(job?.model || '').trim() ||
      '未知模型',
    sourceMode: input.sourceMode || existingTask?.sourceMode || 'server',
    sourcePreview: pickPersistableUrl(
      existingTask?.sourcePreview,
      input.sourcePreview,
      input.sourceUrl,
    ),
    sourceRemoteUrl: pickPersistableUrl(
      existingTask?.sourceRemoteUrl,
      input.sourceUrl,
      ...(Array.isArray(input.sourceUrls) ? input.sourceUrls : []),
    ),
    sourceLabel: existingTask?.sourceLabel || '云端任务',
    userPrompt: String(
      existingTask?.userPrompt ||
        input.userPrompt ||
        job?.params?.userPrompt ||
        job?.prompt ||
        existingTask?.prompt ||
        input.prompt ||
        '',
    ).trim(),
    prompt: String(job?.prompt || existingTask?.prompt || input.prompt || '').trim(),
    promptPolishEnabled:
      typeof input.promptPolishEnabled === 'boolean'
        ? input.promptPolishEnabled
        : typeof job?.params?.promptPolishEnabled === 'boolean'
          ? job.params.promptPolishEnabled
          : existingTask?.promptPolishEnabled === true,
    autoTranslateEnabled:
      typeof input.autoTranslateEnabled === 'boolean'
        ? input.autoTranslateEnabled
        : typeof job?.params?.autoTranslateEnabled === 'boolean'
          ? job.params.autoTranslateEnabled
          : existingTask?.autoTranslateEnabled === true,
    transparentPngEnabled:
      typeof input.transparentPngEnabled === 'boolean'
        ? input.transparentPngEnabled
        : typeof job?.params?.transparentPngEnabled === 'boolean'
          ? job.params.transparentPngEnabled
          : existingTask?.transparentPngEnabled === true,
    aspectRatio:
      input.aspectRatio || job?.params?.aspectRatio || existingTask?.aspectRatio || '16:9',
    ...outputSizeFields,
    resolutionScale:
      input.resolutionScale || job?.params?.resolutionScale || existingTask?.resolutionScale || '',
    upscaleOutputFormat:
      input.upscaleOutputFormat ||
      job?.params?.upscaleOutputFormat ||
      existingTask?.upscaleOutputFormat ||
      'auto',
    localUpscaleStatus: existingTask?.localUpscaleStatus || '',
    localUpscaleProgress: Number(existingTask?.localUpscaleProgress || 0),
    localUpscaleTarget: existingTask?.localUpscaleTarget || '',
    localUpscaleError: existingTask?.localUpscaleError || '',
    localUpscaleStage: existingTask?.localUpscaleStage || '',
    localUpscaleMessage: existingTask?.localUpscaleMessage || '',
    localUpscaleProfile: existingTask?.localUpscaleProfile || '',
    localUpscaleFormat: existingTask?.localUpscaleFormat || '',
    originalOutputUrl: pickPersistableUrl(
      job?.originalResultMediaUrl,
      existingTask?.originalOutputUrl,
    ),
    quality: input.quality || job?.params?.quality || existingTask?.quality || '',
    publicModelKey: String(
      input.publicModelKey ||
        job?.params?.publicModelKey ||
        job?.gatewayModelId ||
        existingTask?.publicModelKey ||
        '',
    ).trim(),
    count: Number(input.count || input.n || job?.params?.count || existingTask?.count || 1),
    batchId: String(input.batchId || job?.params?.batchId || existingTask?.batchId || '').trim(),
    batchIndex: Math.max(
      0,
      Number(input.batchIndex ?? job?.params?.batchIndex ?? existingTask?.batchIndex ?? 0),
    ),
    batchSize: Math.max(
      1,
      Number(input.batchSize ?? job?.params?.batchSize ?? existingTask?.batchSize ?? 1),
    ),
    batchCreatedAt:
      input.batchCreatedAt ||
      job?.params?.batchCreatedAt ||
      existingTask?.batchCreatedAt ||
      job?.createdAt ||
      '',
    duration: input.duration ?? existingTask?.duration ?? null,
    creativity: existingTask?.creativity ?? 0,
    styleStrength: existingTask?.styleStrength ?? 0,
    detailBoost: existingTask?.detailBoost ?? false,
    privacyMode: existingTask?.privacyMode ?? true,
    motionStrength: input.motionStrength ?? existingTask?.motionStrength ?? null,
    skills: input.skills || job?.params?.skills || existingTask?.skills || [],
    skillIds: input.skillIds || job?.params?.skillIds || existingTask?.skillIds || [],
    mcpServers: existingTask?.mcpServers || [],
    outputs: seededOutputs,
    shareSubmitted: job?.shareSubmitted === true || existingTask?.shareSubmitted === true,
    shareSubmissionStatus: String(
      job?.shareSubmissionStatus || existingTask?.shareSubmissionStatus || '',
    )
      .trim()
      .toLowerCase(),
    logs: existingTask?.logs?.length ? existingTask.logs : ['从云端任务列表同步'],
    error: job.error || existingTask?.error || '',
    estimatedCostUsd: job.estimatedCostUsd || existingTask?.estimatedCostUsd || 0,
    usageRecorded: existingTask?.usageRecorded === true,
    createdAt: job.createdAt || existingTask?.createdAt || new Date().toISOString(),
    startedAt:
      parseServerTime(job?.startedAt) ||
      Number(existingTask?.startedAt || 0) ||
      parseServerTime(job?.createdAt),
    finishedAt:
      parseServerTime(job?.finishedAt) ||
      Number(existingTask?.finishedAt || 0) ||
      (isTerminalJobStatus(job.status)
        ? parseServerTime(job?.updatedAt || job?.createdAt, Date.now())
        : 0),
  }
}

/** 已完成/暂停但本地缺图的云端任务，补拉结果 URL */
export async function hydrateServerJobTaskOutputs(task = {}, job = null) {
  if (!task?.serverJobId) return task
  const status = String(task.status || job?.status || '')
    .trim()
    .toLowerCase()
  if (!isCompletedJobStatus(status) && status !== 'paused') return task
  const existingOutputs = Array.isArray(task.outputs) ? task.outputs.filter(Boolean) : []
  const expectedOutputCount = Math.max(
    1,
    Number(task.count || job?.input?.count || job?.params?.count || 1),
  )
  if (existingOutputs.length >= expectedOutputCount) return task

  const persistedResultUrls = Array.from(
    new Set(
      (Array.isArray(job?.resultMediaUrls) ? job.resultMediaUrls : [job?.resultMediaUrl])
        .map((item) => pickPersistableUrl(item))
        .filter(Boolean),
    ),
  )
  if (persistedResultUrls.length) {
    const merged = mergePersistedOutputs(persistedResultUrls, existingOutputs)
    if (merged.length >= expectedOutputCount) return { ...task, outputs: merged }
  }

  try {
    const resultResponse = await getServerAiJobResult(task.serverJobId)
    const extractedOutputs = extractServerJobOutputs(resultResponse.result)
    const stableOutputs = persistedResultUrls.length ? persistedResultUrls : existingOutputs
    const outputs = mergePersistedOutputs(stableOutputs, extractedOutputs)
    if (outputs.length) {
      return { ...task, outputs }
    }
  } catch {
    // 结果尚未就绪或读取失败，保留任务等待下一轮轮询
  }

  return task
}
