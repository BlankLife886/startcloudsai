import { isIllustrationColoringJobKind } from '@/features/ai-shared/aiJobKinds'
import { extractServerJobOutputs } from '@/features/ai-wallpaper/domain/mapServerJobToTask'
import { COMPLETED_WITHOUT_OUTPUT_ERROR } from '@/features/ai-illustration-coloring/domain/coloringStability'
import { findColoringStylePreset } from '@/services/aiIllustrationColoring'
import { normalizeColoringHistoryItem } from '@/services/aiIllustrationColoringState'
import { buildApiUrl } from '@/services/apiBase'

const TERMINAL_JOB_STATUSES = new Set([
  'completed',
  'done',
  'failed',
  'cancelled',
  'canceled',
  'paused',
])
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'waiting_provider'])

export const COLORING_TIMEOUT_CONTROL_MAX_RETRIES = 3

export function isColoringJobKind(kind = '') {
  return isIllustrationColoringJobKind(kind)
}

export function isTerminalColoringJobStatus(status = '') {
  return TERMINAL_JOB_STATUSES.has(
    String(status || '')
      .trim()
      .toLowerCase(),
  )
}

export function isActiveColoringJobStatus(status = '') {
  return ACTIVE_JOB_STATUSES.has(
    String(status || '')
      .trim()
      .toLowerCase(),
  )
}

export function isConfirmedColoringJobCancellation(response = {}) {
  const status = String(response?.job?.status || '')
    .trim()
    .toLowerCase()
  return response?.cancelled === true || status === 'cancelled' || status === 'canceled'
}

export function nextColoringTimeoutControlRetryState(currentFailures = 0) {
  const failures = Math.max(0, Number(currentFailures || 0)) + 1
  const remaining = Math.max(0, COLORING_TIMEOUT_CONTROL_MAX_RETRIES - failures)
  return {
    failures,
    remaining,
    exhausted: remaining === 0,
  }
}

export function resolveColoringJobPollStartedAt(item = {}, now = Date.now()) {
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const startedAt = Number(item?.startedAt || 0)
  const createdAt = Date.parse(String(item?.createdAt || ''))
  if (Number.isFinite(startedAt) && startedAt > 0) return Math.min(currentTime, startedAt)
  if (Number.isFinite(createdAt) && createdAt > 0) return Math.min(currentTime, createdAt)
  return currentTime
}

function resolveStyleLabel(styleId = '') {
  return findColoringStylePreset(styleId)?.label || '插画染色'
}

function toAbsoluteMediaUrl(pathOrUrl = '') {
  const value = String(pathOrUrl || '').trim()
  if (!value) return ''
  if (/^(https?:|data:|blob:)/i.test(value)) return value
  if (value.startsWith('/api/')) {
    return buildApiUrl(value.replace(/^\/api/, '') || '/')
  }
  if (value.startsWith('/')) return buildApiUrl(value)
  return value
}

function pickPersistableUrl(...values) {
  for (const value of values) {
    const url = toAbsoluteMediaUrl(value)
    if (!url || url.startsWith('blob:')) continue
    if (/\/api\/client\/business\/ai\/jobs\/[^/]+\/result(?:\?|$)/i.test(url)) continue
    return url
  }
  return ''
}

function pickResultUrl(providerResultUrl, ...values) {
  for (const value of values) {
    const url = pickPersistableUrl(value)
    if (!url || url === providerResultUrl) continue
    return url
  }
  return ''
}

function readJobTime(value) {
  if (!value) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function resolveMappedJobStatus(job = {}, existingItem = null) {
  const remoteStatus = String(job?.status || '')
    .trim()
    .toLowerCase()
  const existingStatus = String(existingItem?.status || '')
    .trim()
    .toLowerCase()
  if (!existingStatus) return remoteStatus || 'queued'
  if (!remoteStatus) return existingStatus

  const existingTerminal = isTerminalColoringJobStatus(existingStatus)
  const remoteTerminal = isTerminalColoringJobStatus(remoteStatus)
  const existingCompleted = existingStatus === 'completed' || existingStatus === 'done'
  const remoteCompleted = remoteStatus === 'completed' || remoteStatus === 'done'
  const existingProvisional =
    String(existingItem?.statusConfidence || '')
      .trim()
      .toLowerCase() === 'provisional'
  const existingStartedAt =
    readJobTime(existingItem?.startedAt) || readJobTime(existingItem?.updatedAt)
  const existingFinishedAt =
    readJobTime(existingItem?.finishedAt) || readJobTime(existingItem?.updatedAt)
  const remoteStartedAt = readJobTime(job?.startedAt) || readJobTime(job?.createdAt)
  const remoteFinishedAt = readJobTime(job?.updatedAt) || remoteStartedAt

  if (existingCompleted && !remoteCompleted) return existingStatus
  if (remoteCompleted) return remoteStatus

  // 重试沿用原 serverJobId。若本地新一轮 startedAt 晚于旧远端终态，
  // 列表的旧 failed 快照不能把刚接受的 queued 状态打回去。
  if (remoteTerminal && !existingTerminal && existingStartedAt > remoteFinishedAt) {
    return existingStatus
  }
  // 轮询/list 乱序时，已确认终态不能被旧运行态覆盖；只有服务端明确
  // 开始了更晚的一轮执行，才允许回到非终态。
  if (
    existingTerminal &&
    !existingProvisional &&
    !remoteTerminal &&
    remoteStartedAt <= existingFinishedAt
  ) {
    return existingStatus
  }
  return remoteStatus
}

export function mapColoringJobToHistory(job, { existingItem = null } = {}) {
  const input = job?.input || job?.params || {}
  const styleId = String(input.styleId || existingItem?.styleId || 'watercolor').trim()
  const referenceImageUrls = Array.isArray(input.referenceImageUrls)
    ? input.referenceImageUrls
        .map((item) => pickPersistableUrl(item))
        .filter(Boolean)
        .slice(0, 4)
    : existingItem?.referenceImageUrls || []
  const referenceThumbUrls = Array.isArray(existingItem?.referenceThumbUrls)
    ? existingItem.referenceThumbUrls
    : []
  const sourceRemoteUrl = pickPersistableUrl(
    job?.sourceMediaUrl,
    existingItem?.sourceRemoteUrl,
    existingItem?.sourcePreview,
    input.sourceUrl,
    input.sourcePreview,
  )
  const providerResultUrl = pickPersistableUrl(job?.providerResultUrl)
  const durableResultUrl = pickResultUrl(providerResultUrl, job?.resultMediaUrl)
  const embeddedOutputs = extractServerJobOutputs(job?.result)
  const outputs = Array.from(
    new Set(
      [
        ...(Array.isArray(existingItem?.outputs) ? existingItem.outputs : []),
        durableResultUrl,
        ...embeddedOutputs,
      ]
        .map((item) => pickResultUrl(providerResultUrl, item))
        .filter(Boolean),
    ),
  )
  const resultUrl = pickResultUrl(
    providerResultUrl,
    durableResultUrl,
    existingItem?.resultUrl,
    outputs[0],
  )
  const remoteStatus = String(job?.status || '')
    .trim()
    .toLowerCase()
  const mappedStatus = resolveMappedJobStatus(job, existingItem)
  const completedWithoutOutput =
    (mappedStatus === 'completed' || mappedStatus === 'done') && !resultUrl
  const status = completedWithoutOutput ? 'failed' : mappedStatus
  const keptExistingStatus = Boolean(existingItem && status !== remoteStatus)
  const preserveUpstreamUnknown = Boolean(
    existingItem?.statusConfidence === 'upstream-unknown' && isActiveColoringJobStatus(status),
  )
  const recoveredFromProvisionalTerminal = Boolean(
    existingItem &&
      isTerminalColoringJobStatus(existingItem.status) &&
      String(existingItem.statusConfidence || '')
        .trim()
        .toLowerCase() === 'provisional' &&
      !isTerminalColoringJobStatus(status),
  )
  const serverStartedAt = Date.parse(job?.startedAt || job?.createdAt || '') || 0
  const serverFinishedAt = Date.parse(job?.finishedAt || job?.updatedAt || '') || 0
  const finishedAt = isTerminalColoringJobStatus(status)
    ? serverFinishedAt || (recoveredFromProvisionalTerminal ? 0 : Number(existingItem?.finishedAt || 0)) || Date.now()
    : 0
  const startedAt = serverStartedAt || Number(existingItem?.startedAt || 0) || Date.now()

  return normalizeColoringHistoryItem({
    id: existingItem?.id || `coloring-${job.id}`,
    serverJobId: job.id,
    clientRequestId: String(job?.clientRequestId || existingItem?.clientRequestId || ''),
    createRequest: existingItem?.createRequest || null,
    status,
    statusConfidence: completedWithoutOutput
      ? 'client-validation'
      : preserveUpstreamUnknown
        ? 'upstream-unknown'
        : keptExistingStatus
          ? String(existingItem?.statusConfidence || '')
          : 'server',
    title: String(input.title || existingItem?.title || ''),
    styleId,
    customPrompt: String(input.customPrompt || existingItem?.customPrompt || ''),
    styleLabel: String(input.styleLabel || existingItem?.styleLabel || resolveStyleLabel(styleId)),
    batchId: String(input.batchId || existingItem?.batchId || ''),
    variantIndex: Number(input.variantIndex || existingItem?.variantIndex || 1),
    variantCount: Number(input.variantCount || existingItem?.variantCount || 1),
    sourceRemoteUrl,
    sourcePreview: sourceRemoteUrl,
    sourceThumbUrl: existingItem?.sourceThumbUrl || '',
    referenceImageUrls,
    referenceThumbUrls,
    resultThumbUrl: existingItem?.resultThumbUrl || '',
    sourceName: existingItem?.sourceName || '云端任务',
    sourceWidth: Number(
      existingItem?.sourceWidth ||
        existingItem?.inputWidth ||
        input.sourceWidth ||
        input.inputWidth ||
        0,
    ),
    sourceHeight: Number(
      existingItem?.sourceHeight ||
        existingItem?.inputHeight ||
        input.sourceHeight ||
        input.inputHeight ||
        0,
    ),
    sourceBytes: Number(
      existingItem?.sourceBytes ||
        existingItem?.inputBytes ||
        input.sourceBytes ||
        input.inputBytes ||
        0,
    ),
    inputWidth: Number(
      existingItem?.inputWidth ||
        existingItem?.sourceWidth ||
        input.inputWidth ||
        input.sourceWidth ||
        0,
    ),
    inputHeight: Number(
      existingItem?.inputHeight ||
        existingItem?.sourceHeight ||
        input.inputHeight ||
        input.sourceHeight ||
        0,
    ),
    inputBytes: Number(
      existingItem?.inputBytes ||
        existingItem?.sourceBytes ||
        input.inputBytes ||
        input.sourceBytes ||
        0,
    ),
    inputType: String(existingItem?.inputType || input.inputType || ''),
    outputSize: String(existingItem?.outputSize || input.outputSize || 'original'),
    outputOrientation: String(
      existingItem?.outputOrientation || input.outputOrientation || 'source',
    ),
    requestedOutputWidth: Number(existingItem?.requestedOutputWidth || input.outputWidth || 0),
    requestedOutputHeight: Number(existingItem?.requestedOutputHeight || input.outputHeight || 0),
    resultWidth: Number(existingItem?.resultWidth || 0),
    resultHeight: Number(existingItem?.resultHeight || 0),
    resultBytes: Number(existingItem?.resultBytes || 0),
    resultType: String(existingItem?.resultType || ''),
    outputSizeMatched:
      typeof existingItem?.outputSizeMatched === 'boolean' ? existingItem.outputSizeMatched : null,
    outputSizeWarning: String(existingItem?.outputSizeWarning || ''),
    publicModelKey: String(
      existingItem?.publicModelKey || input.publicModelKey || job?.gatewayModelId || '',
    ),
    resultUrl,
    outputs: resultUrl ? Array.from(new Set([resultUrl, ...outputs].filter(Boolean))) : outputs,
    usageRecorded: existingItem?.usageRecorded === true,
    error: String(
      completedWithoutOutput
        ? job?.error || COMPLETED_WITHOUT_OUTPUT_ERROR
        : preserveUpstreamUnknown
          ? job?.error || existingItem?.error || ''
          : recoveredFromProvisionalTerminal
            ? job?.error || ''
            : keptExistingStatus
              ? existingItem?.error || ''
              : job?.error || existingItem?.error || '',
    ),
    executionTrace: Array.isArray(job?.executionTrace)
      ? job.executionTrace
      : existingItem?.executionTrace || [],
    createdAt: job?.createdAt || existingItem?.createdAt || new Date().toISOString(),
    startedAt,
    finishedAt,
    durationMs: Number(job?.durationMs || existingItem?.durationMs || 0),
    updatedAt:
      (keptExistingStatus ? existingItem?.updatedAt : job?.updatedAt) ||
      existingItem?.updatedAt ||
      new Date().toISOString(),
  })
}

export async function hydrateColoringHistoryItem(item = {}, job = null) {
  const remoteStatus = String(job?.status || item.status || '')
    .trim()
    .toLowerCase()
  const completed = remoteStatus === 'completed' || remoteStatus === 'done'
  const durableSource = pickPersistableUrl(
    job?.sourceMediaUrl,
    item.sourceRemoteUrl,
    item.sourcePreview,
  )
  const providerResult = pickPersistableUrl(job?.providerResultUrl)
  const durableResult = pickResultUrl(providerResult, job?.resultMediaUrl)
  const existingResult = pickResultUrl(
    providerResult,
    item.resultUrl,
    ...(Array.isArray(item.outputs) ? item.outputs : []),
  )

  if (!completed) {
    return normalizeColoringHistoryItem({
      ...item,
      sourceRemoteUrl: durableSource || item.sourceRemoteUrl,
      sourcePreview: durableSource || item.sourcePreview,
    })
  }

  // providerResultUrl 是上游任务 JSON 轮询地址，不能作为图片展示或持久化。
  const preferredResult = durableResult || existingResult
  if (
    preferredResult &&
    (preferredResult.startsWith('data:image/') ||
      preferredResult.startsWith('http') ||
      preferredResult.startsWith('/'))
  ) {
    return normalizeColoringHistoryItem({
      ...item,
      status: remoteStatus,
      statusConfidence: 'server',
      error: '',
      sourceRemoteUrl: durableSource || item.sourceRemoteUrl,
      sourcePreview: durableSource || item.sourcePreview,
      sourceThumbUrl: item.sourceThumbUrl || '',
      referenceImageUrls: item.referenceImageUrls || [],
      referenceThumbUrls: item.referenceThumbUrls || [],
      resultRemoteUrl: preferredResult,
      resultThumbUrl: item.resultThumbUrl || '',
      outputs: [preferredResult],
      resultUrl: preferredResult,
    })
  }

  let outputs = extractServerJobOutputs(job?.result)
    .map((entry) => pickResultUrl(providerResult, entry))
    .filter(Boolean)
  if (!outputs.length) {
    return normalizeColoringHistoryItem({
      ...item,
      status: 'failed',
      statusConfidence: 'client-validation',
      error: item.error || COMPLETED_WITHOUT_OUTPUT_ERROR,
      sourceRemoteUrl: durableSource || item.sourceRemoteUrl,
      sourcePreview: durableSource || item.sourcePreview,
      sourceThumbUrl: item.sourceThumbUrl || '',
      referenceImageUrls: item.referenceImageUrls || [],
      referenceThumbUrls: item.referenceThumbUrls || [],
      resultRemoteUrl: '',
      resultThumbUrl: item.resultThumbUrl || '',
      outputs: [],
      resultUrl: '',
    })
  }
  return normalizeColoringHistoryItem({
    ...item,
    status: remoteStatus,
    statusConfidence: 'server',
    error: '',
    sourceRemoteUrl: durableSource || item.sourceRemoteUrl,
    sourcePreview: durableSource || item.sourcePreview,
    sourceThumbUrl: item.sourceThumbUrl || '',
    referenceImageUrls: item.referenceImageUrls || [],
    referenceThumbUrls: item.referenceThumbUrls || [],
    resultThumbUrl: item.resultThumbUrl || '',
    resultRemoteUrl: outputs[0],
    outputs,
    resultUrl: outputs[0],
  })
}
