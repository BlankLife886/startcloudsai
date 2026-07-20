import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { normalizeGptImageOutputSize } from './aiImageOutputSize.js'

export const ILLUSTRATION_COLORING_HISTORY_KEY = 'walleven_illustration_coloring_history_v2'
export const ILLUSTRATION_COLORING_DRAFT_KEY = 'walleven_illustration_coloring_draft_v2'
export const ILLUSTRATION_COLORING_SETTINGS_KEY = 'walleven_illustration_coloring_settings_v1'
export const ILLUSTRATION_COLORING_DELETED_KEY = 'walleven_illustration_coloring_deleted_v1'

const MAX_HISTORY = 200
const MAX_VISIBLE_HISTORY = 20
const MAX_DELETED = 200

export const ILLUSTRATION_COLORING_HISTORY_LIMIT = MAX_HISTORY
export const ILLUSTRATION_COLORING_VISIBLE_HISTORY_LIMIT = MAX_VISIBLE_HISTORY

export const COLORING_OUTPUT_SIZE_OPTIONS = [
  { id: 'original', label: '原图尺寸', hint: '按输入图分辨率输出（超限自动适配）' },
  { id: '1k', label: '1K', hint: '约 1024 长边' },
  { id: '2k', label: '2K', hint: '约 2048 长边' },
  { id: '3k', label: '3K', hint: '约 3072 长边' },
  { id: '4k', label: '4K', hint: '最高 3840 长边（受总像素限制）' },
]

export const COLORING_OUTPUT_ORIENTATION_OPTIONS = [
  { id: 'source', label: '保持原图方向', hint: '按线稿原有构图染色' },
  { id: 'portrait', label: '竖图', hint: '适合人物、海报和移动端展示' },
  { id: 'landscape', label: '横图扩展', hint: '向左右延展画面，适合桌面与场景展示' },
]

export const COLORING_FORMAT_OPTIONS = [
  { id: 'original', label: '原格式', ext: '' },
  { id: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  { id: 'image/png', label: 'PNG', ext: 'png' },
  { id: 'image/webp', label: 'WEBP', ext: 'webp' },
]

export const COLORING_COMPRESS_KB_OPTIONS = [256, 512, 1024, 1536, 2048, 3072, 4096]
export const COLORING_BATCH_COUNT_OPTIONS = [1, 2, 3, 4, 5]

export const DEFAULT_COLORING_SETTINGS = {
  enableCompress: false,
  compressMaxKb: 1024,
  inputFormat: 'original',
  outputSize: 'original',
  outputOrientation: 'source',
  generationCount: 1,
  confirmBeforeDelete: false,
  publicModelKey: '',
}

function readJson(key, fallback) {
  try {
    const raw = getScopedLocalItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function readTime(value) {
  if (!value) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const time = Date.parse(String(value))
  return Number.isFinite(time) ? time : 0
}

function historySortTime(item = {}) {
  return Math.max(
    readTime(item.updatedAt),
    readTime(item.finishedAt),
    readTime(item.startedAt),
    readTime(item.createdAt),
  )
}

function persistentMediaUrl(value = '') {
  const url = String(value || '').trim()
  if (!url || /^blob:/i.test(url)) return ''
  // /jobs/:id/result returns a JSON result document, not image bytes. Older
  // clients persisted this endpoint as an <img> source, which produces a 200
  // response followed by a broken image.
  if (/\/api\/client\/business\/ai\/jobs\/[^/]+\/result(?:\?|$)/i.test(url)) return ''
  return url
}

function persistentMediaUrls(values = [], limit = MAX_HISTORY) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((entry) => persistentMediaUrl(entry))
        .filter(Boolean),
    ),
  ).slice(0, limit)
}

function serializableRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const cloned = JSON.parse(JSON.stringify(value))
    return cloned && typeof cloned === 'object' && !Array.isArray(cloned) ? cloned : null
  } catch {
    return null
  }
}

/**
 * 展示顺序必须稳定：轮询只会改变 updatedAt，不能让并发任务在历史栏里互换位置。
 */
export function coloringHistoryDisplayTime(item = {}) {
  return (
    readTime(item.createdAt) ||
    readTime(item.startedAt) ||
    readTime(item.finishedAt) ||
    readTime(item.updatedAt)
  )
}

function isCompletedHistoryStatus(status = '') {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  return value === 'completed' || value === 'done'
}

function isFailedHistoryStatus(status = '') {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  return value === 'failed' || value === 'cancelled' || value === 'canceled'
}

function isTerminalHistoryStatus(status = '') {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  return isCompletedHistoryStatus(value) || isFailedHistoryStatus(value) || value === 'paused'
}

function isProvisionalHistoryStatus(item = {}) {
  return (
    String(item.statusConfidence || '')
      .trim()
      .toLowerCase() === 'provisional'
  )
}

function isNewerHistoryAttempt(candidate = {}, terminal = {}) {
  const candidateStartedAt = readTime(candidate.startedAt) || readTime(candidate.updatedAt)
  const terminalFinishedAt =
    readTime(terminal.finishedAt) || readTime(terminal.updatedAt) || readTime(terminal.startedAt)
  return Boolean(
    candidateStartedAt && terminalFinishedAt && candidateStartedAt > terminalFinishedAt,
  )
}

function hasHistoryResult(item = {}) {
  return Boolean(
    String(item.resultUrl || '').trim() ||
      (Array.isArray(item.outputs) && item.outputs.some((entry) => String(entry || '').trim())),
  )
}

function mergeHistoryPair(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing

  const existingRemote = existing.__remoteSync === true
  const incomingRemote = incoming.__remoteSync === true
  const existingCompleted = isCompletedHistoryStatus(existing.status)
  const incomingCompleted = isCompletedHistoryStatus(incoming.status)
  const existingTerminal = isTerminalHistoryStatus(existing.status)
  const incomingTerminal = isTerminalHistoryStatus(incoming.status)
  const existingHasResult = hasHistoryResult(existing)
  const incomingHasResult = hasHistoryResult(incoming)

  // 成功结果是最高优先级终态，任何迟到的 failed/cancelled/running 都不能覆盖。
  if (existingCompleted && !incomingCompleted) return { ...incoming, ...existing }
  if (incomingCompleted && !existingCompleted) return { ...existing, ...incoming }

  // 列表刷新、MQTT 与逐任务轮询可能乱序返回。服务端已确认的终态不能被
  // 旧 queued/running 快照覆盖；唯一例外是 startedAt 明确晚于上次终态的重试。
  // 本地“状态同步失败”属于临时结论，远端事实可以直接纠正。
  if (
    existingTerminal &&
    !incomingTerminal &&
    !isProvisionalHistoryStatus(existing) &&
    !isNewerHistoryAttempt(incoming, existing)
  ) {
    return { ...incoming, ...existing }
  }
  if (
    incomingTerminal &&
    !existingTerminal &&
    !isProvisionalHistoryStatus(incoming) &&
    !isNewerHistoryAttempt(existing, incoming)
  ) {
    return { ...existing, ...incoming }
  }
  if (existingTerminal && !incomingTerminal && isNewerHistoryAttempt(incoming, existing)) {
    return { ...existing, ...incoming }
  }
  if (incomingTerminal && !existingTerminal && isNewerHistoryAttempt(existing, incoming)) {
    return { ...incoming, ...existing }
  }

  if (existingRemote && !incomingRemote) {
    return {
      ...incoming,
      ...existing,
      sourceRemoteUrl: existing.sourceRemoteUrl || incoming.sourceRemoteUrl,
      sourcePreview: existing.sourcePreview || incoming.sourcePreview,
      sourceThumbUrl: existing.sourceThumbUrl || incoming.sourceThumbUrl,
      referenceImageUrls: existing.referenceImageUrls?.length
        ? existing.referenceImageUrls
        : incoming.referenceImageUrls,
      referenceThumbUrls: existing.referenceThumbUrls?.length
        ? existing.referenceThumbUrls
        : incoming.referenceThumbUrls,
      resultThumbUrl: existing.resultThumbUrl || incoming.resultThumbUrl,
      resultUrl: existing.resultUrl || incoming.resultUrl,
      outputs: existingHasResult ? existing.outputs : incoming.outputs,
    }
  }

  if (incomingRemote && !existingRemote) {
    return {
      ...existing,
      ...incoming,
      sourceRemoteUrl: incoming.sourceRemoteUrl || existing.sourceRemoteUrl,
      sourcePreview: incoming.sourcePreview || existing.sourcePreview,
      sourceThumbUrl: incoming.sourceThumbUrl || existing.sourceThumbUrl,
      referenceImageUrls: incoming.referenceImageUrls?.length
        ? incoming.referenceImageUrls
        : existing.referenceImageUrls,
      referenceThumbUrls: incoming.referenceThumbUrls?.length
        ? incoming.referenceThumbUrls
        : existing.referenceThumbUrls,
      resultThumbUrl: incoming.resultThumbUrl || existing.resultThumbUrl,
      resultUrl: incoming.resultUrl || existing.resultUrl,
      outputs: incomingHasResult ? incoming.outputs : existing.outputs,
    }
  }

  if (incomingCompleted && (incomingHasResult || !existingHasResult)) {
    return { ...existing, ...incoming }
  }

  if (existingCompleted && !incomingCompleted && isFailedHistoryStatus(incoming.status)) {
    return { ...incoming, ...existing }
  }

  if (incomingHasResult && !existingHasResult) return { ...existing, ...incoming }
  if (existingHasResult && !incomingHasResult) return { ...incoming, ...existing }

  return historySortTime(incoming) >= historySortTime(existing)
    ? { ...existing, ...incoming }
    : { ...incoming, ...existing }
}

export function normalizeColoringHistoryItem(item = {}) {
  // Object URLs 只在创建它们的当前页面生命周期内有效，绝不能进入 localStorage。
  // 历史记录读取时也经过这里，因此旧版本残留的 blob: 地址会被自动迁移清除。
  const sourceRemoteUrl =
    persistentMediaUrl(item.sourceRemoteUrl) || persistentMediaUrl(item.sourcePreview)
  const sourcePreview = persistentMediaUrl(item.sourcePreview) || sourceRemoteUrl
  const referenceImageUrls = persistentMediaUrls(item.referenceImageUrls, 4)
  const referenceThumbUrls = persistentMediaUrls(item.referenceThumbUrls, 4)
  const outputs = persistentMediaUrls(
    Array.isArray(item.outputs) ? item.outputs : item.resultUrl ? [item.resultUrl] : [],
  )
  const resultRemoteUrl =
    persistentMediaUrl(item.resultRemoteUrl) ||
    persistentMediaUrl(item.resultUrl) ||
    outputs[0] ||
    ''
  const resultUrl = persistentMediaUrl(item.resultUrl) || resultRemoteUrl || outputs[0] || ''
  return {
    id: String(item.id || item.serverJobId || '').trim(),
    serverJobId: String(item.serverJobId || '').trim(),
    clientRequestId: String(item.clientRequestId || '').trim().toLowerCase(),
    createRequest: serializableRecord(item.createRequest),
    status: String(item.status || 'queued'),
    statusConfidence: String(item.statusConfidence || ''),
    title: String(item.title || ''),
    styleId: String(item.styleId || 'watercolor'),
    customPrompt: String(item.customPrompt || ''),
    styleLabel: String(item.styleLabel || ''),
    batchId: String(item.batchId || ''),
    variantIndex: Math.max(1, Number(item.variantIndex || 1)),
    variantCount: Math.max(1, Number(item.variantCount || 1)),
    sourceRemoteUrl,
    sourcePreview,
    sourceThumbUrl:
      persistentMediaUrl(item.sourceThumbUrl) || persistentMediaUrl(item.sourceThumbnailUrl),
    referenceImageUrls,
    referenceThumbUrls,
    resultThumbUrl:
      persistentMediaUrl(item.resultThumbUrl) || persistentMediaUrl(item.resultThumbnailUrl),
    sourceName: String(item.sourceName || '线稿插画'),
    sourceWidth: Number(item.sourceWidth || 0),
    sourceHeight: Number(item.sourceHeight || 0),
    sourceBytes: Number(item.sourceBytes || 0),
    inputWidth: Number(item.inputWidth || item.sourceWidth || 0),
    inputHeight: Number(item.inputHeight || item.sourceHeight || 0),
    inputBytes: Number(item.inputBytes || item.sourceBytes || 0),
    inputType: String(item.inputType || ''),
    outputSize: String(item.outputSize || 'original'),
    outputOrientation: String(item.outputOrientation || 'source'),
    requestedOutputWidth: Number(item.requestedOutputWidth || 0),
    requestedOutputHeight: Number(item.requestedOutputHeight || 0),
    resultWidth: Number(item.resultWidth || 0),
    resultHeight: Number(item.resultHeight || 0),
    resultBytes: Number(item.resultBytes || 0),
    resultType: String(item.resultType || ''),
    outputSizeMatched: typeof item.outputSizeMatched === 'boolean' ? item.outputSizeMatched : null,
    outputSizeWarning: String(item.outputSizeWarning || ''),
    publicModelKey: String(item.publicModelKey || ''),
    resultRemoteUrl,
    resultUrl,
    outputs,
    usageRecorded: item.usageRecorded === true,
    shareSubmitted: item.shareSubmitted === true,
    error: String(item.error || ''),
    executionTrace: Array.isArray(item.executionTrace)
      ? item.executionTrace
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => ({
            stage: String(entry.stage || ''),
            at: String(entry.at || ''),
            message: String(entry.message || ''),
            details:
              entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details)
                ? entry.details
                : {},
          }))
          .filter((entry) => entry.stage && entry.at)
          .slice(-24)
      : [],
    createdAt: String(item.createdAt || new Date().toISOString()),
    startedAt: Number(item.startedAt || 0),
    finishedAt: Number(item.finishedAt || 0),
    updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
  }
}

export function readColoringHistory() {
  const raw = readJson(ILLUSTRATION_COLORING_HISTORY_KEY, [])
  const items = Array.isArray(raw) ? raw : []
  const deleted = new Set(readDeletedColoringJobIds())
  return items
    .map(normalizeColoringHistoryItem)
    .filter((item) => item.id || item.serverJobId)
    .filter((item) => !item.serverJobId || !deleted.has(item.serverJobId))
    .sort((left, right) => coloringHistoryDisplayTime(right) - coloringHistoryDisplayTime(left))
    .slice(0, MAX_HISTORY)
}

export function writeColoringHistory(items = []) {
  const deleted = new Set(readDeletedColoringJobIds())
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeColoringHistoryItem)
    .filter((item) => item.id || item.serverJobId)
    .filter((item) => !item.serverJobId || !deleted.has(item.serverJobId))
    .sort((left, right) => coloringHistoryDisplayTime(right) - coloringHistoryDisplayTime(left))
    .slice(0, MAX_HISTORY)
  try {
    setScopedLocalItem(ILLUSTRATION_COLORING_HISTORY_KEY, JSON.stringify(normalized))
  } catch {
    // ignore storage quota errors
  }
  return normalized
}

export function mergeColoringHistory(remoteItems = [], localItems = []) {
  const deleted = new Set(readDeletedColoringJobIds())
  const map = new Map()
  const append = (item, remoteSync = false) => {
    const normalized = normalizeColoringHistoryItem(item)
    if (remoteSync) normalized.__remoteSync = true
    const localId = String(normalized.id || '').trim()
    if (!normalized.clientRequestId && !normalized.serverJobId && !localId) return
    const key = normalized.clientRequestId
      ? `request:${normalized.clientRequestId}`
      : normalized.serverJobId
        ? `server:${normalized.serverJobId}`
        : `local:${localId}`
    if (normalized.serverJobId && deleted.has(normalized.serverJobId)) {
      // 旧版本会把失败任务误标为“已删除”。若云端仍返回该任务，说明它并未真正删除，
      // 以云端事实恢复历史；用户主动删除成功的任务不会再出现在远端列表中。
      if (!remoteSync) return
      unmarkColoringJobDeleted(normalized.serverJobId)
    }
    const existing = map.get(key)
    const merged = mergeHistoryPair(existing, normalized)
    if (existing && normalized.clientRequestId) {
      const localIdentity = existing.__remoteSync
        ? normalized.__remoteSync
          ? null
          : normalized
        : existing
      if (localIdentity?.id) merged.id = localIdentity.id
      merged.serverJobId = normalized.serverJobId || existing.serverJobId || ''
      merged.clientRequestId = normalized.clientRequestId
    }
    map.set(key, merged)
  }
  remoteItems.forEach((item) => append(item, true))
  localItems.forEach((item) => append(item, false))
  return Array.from(map.values())
    .sort((left, right) => coloringHistoryDisplayTime(right) - coloringHistoryDisplayTime(left))
    .slice(0, MAX_HISTORY)
}

export function readDeletedColoringJobIds() {
  const raw = readJson(ILLUSTRATION_COLORING_DELETED_KEY, [])
  return Array.isArray(raw)
    ? raw
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, MAX_DELETED)
    : []
}

export function markColoringJobDeleted(serverJobId) {
  const id = String(serverJobId || '').trim()
  if (!id) return readDeletedColoringJobIds()
  const next = Array.from(new Set([id, ...readDeletedColoringJobIds()])).slice(0, MAX_DELETED)
  try {
    setScopedLocalItem(ILLUSTRATION_COLORING_DELETED_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  return next
}

export function unmarkColoringJobDeleted(serverJobId) {
  const id = String(serverJobId || '').trim()
  if (!id) return readDeletedColoringJobIds()
  const next = readDeletedColoringJobIds().filter((item) => item !== id)
  try {
    setScopedLocalItem(ILLUSTRATION_COLORING_DELETED_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  return next
}

export function readColoringDraft() {
  const draft = readJson(ILLUSTRATION_COLORING_DRAFT_KEY, null)
  if (!draft || typeof draft !== 'object') return null
  return {
    ...draft,
    sourceRemoteUrl: persistentMediaUrl(draft.sourceRemoteUrl),
    sourcePreview: persistentMediaUrl(draft.sourcePreview),
    resultUrl: persistentMediaUrl(draft.resultUrl),
    referenceImageUrls: persistentMediaUrls(draft.referenceImageUrls, 4),
    referenceThumbUrls: persistentMediaUrls(draft.referenceThumbUrls, 4),
  }
}

export function writeColoringDraft(draft = {}) {
  try {
    setScopedLocalItem(
      ILLUSTRATION_COLORING_DRAFT_KEY,
      JSON.stringify({
        ...draft,
        sourceRemoteUrl: persistentMediaUrl(draft.sourceRemoteUrl),
        sourcePreview: persistentMediaUrl(draft.sourcePreview),
        resultUrl: persistentMediaUrl(draft.resultUrl),
        referenceImageUrls: persistentMediaUrls(draft.referenceImageUrls, 4),
        referenceThumbUrls: persistentMediaUrls(draft.referenceThumbUrls, 4),
        updatedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // ignore storage errors
  }
}

export function normalizeColoringSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const compressMaxKb = Number(source.compressMaxKb || DEFAULT_COLORING_SETTINGS.compressMaxKb)
  const format = COLORING_FORMAT_OPTIONS.some((item) => item.id === source.inputFormat)
    ? source.inputFormat
    : DEFAULT_COLORING_SETTINGS.inputFormat
  const outputSize = COLORING_OUTPUT_SIZE_OPTIONS.some((item) => item.id === source.outputSize)
    ? source.outputSize
    : DEFAULT_COLORING_SETTINGS.outputSize
  const generationCount = COLORING_BATCH_COUNT_OPTIONS.includes(Number(source.generationCount))
    ? Number(source.generationCount)
    : DEFAULT_COLORING_SETTINGS.generationCount
  return {
    // 只有用户明确开启才允许压缩。缺失、字符串或旧版脏值都按关闭处理，
    // 避免默认关闭的开关在读取后被意外翻转为开启。
    enableCompress: source.enableCompress === true,
    compressMaxKb: COLORING_COMPRESS_KB_OPTIONS.includes(compressMaxKb)
      ? compressMaxKb
      : DEFAULT_COLORING_SETTINGS.compressMaxKb,
    inputFormat: format,
    outputSize,
    outputOrientation: COLORING_OUTPUT_ORIENTATION_OPTIONS.some(
      (item) => item.id === source.outputOrientation,
    )
      ? source.outputOrientation
      : DEFAULT_COLORING_SETTINGS.outputOrientation,
    generationCount,
    confirmBeforeDelete: source.confirmBeforeDelete === true,
    publicModelKey: String(source.publicModelKey || '').trim(),
  }
}

export function readColoringSettings() {
  return normalizeColoringSettings(
    readJson(ILLUSTRATION_COLORING_SETTINGS_KEY, DEFAULT_COLORING_SETTINGS),
  )
}

export function writeColoringSettings(settings = {}) {
  const normalized = normalizeColoringSettings(settings)
  try {
    setScopedLocalItem(ILLUSTRATION_COLORING_SETTINGS_KEY, JSON.stringify(normalized))
  } catch {
    // ignore
  }
  return normalized
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

export function gcd(a, b) {
  let x = Math.abs(Math.round(Number(a) || 0))
  let y = Math.abs(Math.round(Number(b) || 0))
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

export function getAspectLabel(width, height) {
  const w = Math.max(0, Math.round(Number(width) || 0))
  const h = Math.max(0, Math.round(Number(height) || 0))
  if (!w || !h) return ''
  const divisor = gcd(w, h)
  return `${Math.round(w / divisor)}:${Math.round(h / divisor)}`
}

export function resolveOutputEdge(outputSize = 'original') {
  return (
    {
      '1k': 1024,
      '2k': 2048,
      '3k': 3072,
      '4k': 3840,
    }[String(outputSize || '').trim()] || 0
  )
}

export function resolveColoringOutputOrientation(width, height, outputOrientation = 'source') {
  const w = Math.max(1, Math.round(Number(width) || 1))
  const h = Math.max(1, Math.round(Number(height) || 1))
  const requested = String(outputOrientation || 'source').trim()
  // 横图线稿不允许压成竖图，避免主体被截断或产生不自然的补画。
  if (w > h && requested === 'portrait') return 'source'
  if (['source', 'portrait', 'landscape'].includes(requested)) return requested
  return 'source'
}

export function resolveOutputPixelSize(
  width,
  height,
  outputSize = 'original',
  outputOrientation = 'source',
) {
  const w = Math.max(1, Math.round(Number(width) || 1))
  const h = Math.max(1, Math.round(Number(height) || 1))
  const edge = resolveOutputEdge(outputSize)
  const orientation = resolveColoringOutputOrientation(w, h, outputOrientation)
  const maxEdge = edge || Math.max(w, h)
  let requestedWidth = 0
  let requestedHeight = 0
  if (orientation === 'landscape') {
    requestedWidth = Math.max(1, Math.round(maxEdge))
    requestedHeight = Math.max(1, Math.round((requestedWidth * 9) / 16))
  } else if (orientation === 'portrait') {
    requestedHeight = Math.max(1, Math.round(maxEdge))
    requestedWidth = Math.max(1, Math.round((requestedHeight * 9) / 16))
  } else {
    const scale = maxEdge / Math.max(w, h)
    requestedWidth = Math.max(1, Math.round(w * scale))
    requestedHeight = Math.max(1, Math.round(h * scale))
  }
  const normalized = normalizeGptImageOutputSize(requestedWidth, requestedHeight)
  return {
    ...normalized,
    label: `${normalized.width}x${normalized.height}`,
    orientation,
  }
}
