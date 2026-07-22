/**
 * 旧「AI 任务（job）」服务层 → 新「任务（task）」契约的适配层。
 *
 * 三套旧任务链路（文生图 useWallpaperTasks、插画染色 useIllustrationColoringState、
 * 创意工作台 useCreativeImageJob）都通过本文件的 createServerAiJob / waitForServerAiJob /
 * listServerAiJobs 等函数访问网络。这里把它们统一映射到 /api/tasks，
 * 上层组合式函数无需大改。
 */
import {
  cancelTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  uploadFile,
  waitForTask,
} from '@/services/tasksApi'

const SUPPORTED_ASPECTS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '9:21',
]

export function nearestAspectLabel(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w || !h) return '16:9'
  const ratio = w / h
  return (
    SUPPORTED_ASPECTS.map((label) => {
      const [aw, ah] = label.split(':').map(Number)
      return {
        label,
        diff: Math.abs(ratio - aw / ah),
      }
    }).sort((a, b) => a.diff - b.diff)[0]?.label || '16:9'
  )
}

export function normalizeAiOutput(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (value.startsWith('data:')) return value
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('/api/')) return value
  if (/^(iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)/.test(value)) {
    return `data:image/png;base64,${value}`
  }
  return value
}

export function extractMediaOutput(payload) {
  return extractMediaOutputs(payload)[0] || ''
}

export function extractMediaOutputs(payload) {
  if (!payload) return []
  if (typeof payload === 'string') return [normalizeAiOutput(payload)].filter(Boolean)
  const lists = [
    Array.isArray(payload?.outputs) ? payload.outputs : [],
    Array.isArray(payload?.outputUrls) ? payload.outputUrls : [],
    Array.isArray(payload?.images) ? payload.images : [],
  ]
  const candidates = [payload?.url, payload?.output, payload?.result]
  for (const list of lists) {
    for (const item of list) {
      if (typeof item === 'string') candidates.push(item)
      else if (item && typeof item === 'object') candidates.push(item.url, item.image_url)
    }
  }
  return Array.from(new Set(candidates.map((item) => normalizeAiOutput(item)).filter(Boolean)))
}

export function getBestWallpaperSource(wallpaper = {}) {
  return (
    wallpaper.path ||
    wallpaper.image_url ||
    wallpaper.url ||
    wallpaper.thumbs?.original ||
    wallpaper.thumbs?.large ||
    wallpaper.thumbnail ||
    ''
  )
}

export function getDisplayImageUrl(wallpaper = {}) {
  return wallpaper.thumbs?.large || wallpaper.thumbnail || getBestWallpaperSource(wallpaper)
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

export function loadImageSize(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve({ width: 0, height: 0 })
      return
    }
    const img = new Image()
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => done({ width: 0, height: 0 }), 12000)
    if (/^https?:\/\//i.test(src)) img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => done({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 })
    img.onerror = () => done({ width: 0, height: 0 })
    img.src = src
  })
}

// ---------------------------------------------------------------------------
// kind → 新任务类型映射
// ---------------------------------------------------------------------------

const KIND_TYPE_RULES = [
  [/^illustration-coloring/, 'coloring'],
  [/^ui-design/, 'ui_design'],
  [/^ultra-reference/, 'model_sheet'],
  [/^game-art/, 'game_art'],
  [/^(puzzle|collage)/, 'puzzle'],
  [/^wallpaper/, 't2i'],
]

export function mapJobKindToTaskType(kind = '') {
  const value = String(kind || '')
    .trim()
    .toLowerCase()
  for (const [pattern, type] of KIND_TYPE_RULES) {
    if (pattern.test(value)) return type
  }
  return 't2i'
}

const DEFAULT_KIND_BY_TYPE = {
  t2i: 'wallpaper-image-generation',
  coloring: 'illustration-coloring',
  ui_design: 'ui-design-generation',
  model_sheet: 'ultra-reference-generation',
  game_art: 'game-art-generation',
  puzzle: 'puzzle-generation',
}

// ---------------------------------------------------------------------------
// URL ↔ R2 key 注册表：新契约用 inputKeys 传参考图，
// 前端展示用 URL；这里维护双向映射，让「用历史产物当参考图」直接命中 key。
// ---------------------------------------------------------------------------

const urlKeyRegistry = new Map()

/** 供外部上传逻辑登记 URL → R2 key 映射。 */
export function registerUploadedUrl(url, key) {
  registerUrlKey(url, key)
}

function registerUrlKey(url, key) {
  const normalizedUrl = String(url || '').trim()
  const normalizedKey = String(key || '').trim()
  if (!normalizedUrl || !normalizedKey) return
  urlKeyRegistry.set(normalizedUrl, normalizedKey)
}

function lookupKeyForUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (urlKeyRegistry.has(value)) return urlKeyRegistry.get(value)
  // /api/files/{key} 形式的站内地址可直接还原 key
  const match = value.match(/\/api\/files\/(.+?)(?:\?|$)/)
  if (match) return decodeURIComponent(match[1])
  return ''
}

function createInputImageLostError() {
  const error = new Error('参考图已失效，请重新上传')
  error.code = 'input_image_lost'
  return error
}

/**
 * URL → R2 key。解析失败（blob: 刷新后失效、过期 URL 等）时抛出
 * code='input_image_lost' 的错误并阻断提交，避免参考图静默丢失。
 */
async function resolveInputKeyForUrl(url) {
  const known = lookupKeyForUrl(url)
  if (known) return known
  const value = String(url || '').trim()
  if (!value) return ''
  // 未知来源（data: / blob: / 过期 URL）：拉取后重新上传拿 key
  try {
    const response = await fetch(value)
    if (!response.ok) throw new Error(`参考图读取失败（${response.status}）`)
    const blob = await response.blob()
    const file = new File([blob], `reference-${Date.now()}.png`, {
      type: blob.type || 'image/png',
    })
    const uploaded = await uploadFile(file)
    registerUrlKey(uploaded.url, uploaded.key)
    registerUrlKey(value, uploaded.key)
    return uploaded.key
  } catch {
    throw createInputImageLostError()
  }
}

// ---------------------------------------------------------------------------
// task → 旧 job 形状映射
// ---------------------------------------------------------------------------

const STATUS_TO_LEGACY = {
  queued: 'queued',
  running: 'running',
  succeeded: 'completed',
  failed: 'failed',
  canceled: 'cancelled',
}

function taskToLegacyJob(task = {}) {
  const outputUrls = Array.isArray(task.outputUrls) ? task.outputUrls.filter(Boolean) : []
  const thumbnailUrls = Array.isArray(task.thumbnailUrls)
    ? task.thumbnailUrls.filter(Boolean)
    : outputUrls
  const originalUrls = Array.isArray(task.originalUrls)
    ? task.originalUrls.filter(Boolean)
    : outputUrls
  const outputKeys = Array.isArray(task.outputKeys) ? task.outputKeys : []
  const thumbnailKeys = Array.isArray(task.thumbnailKeys) ? task.thumbnailKeys : []
  thumbnailUrls.forEach((url, index) => {
    if (thumbnailKeys[index]) registerUrlKey(url, thumbnailKeys[index])
  })
  originalUrls.forEach((url, index) => {
    if (outputKeys[index]) registerUrlKey(url, outputKeys[index])
  })
  const params = task.params && typeof task.params === 'object' ? task.params : {}
  return {
    id: task.id,
    taskId: task.id,
    kind: String(params._kind || DEFAULT_KIND_BY_TYPE[task.type] || task.type || ''),
    type: task.type,
    model: String(task.model || params.modelHint || '').trim(),
    gatewayModelId: String(params.publicModelKey || '').trim(),
    status: STATUS_TO_LEGACY[String(task.status || '').toLowerCase()] || task.status || 'queued',
    prompt: task.prompt || '',
    input: params,
    params,
    count: Number(task.count || 1),
    inputKeys: Array.isArray(task.inputKeys) ? task.inputKeys : [],
    outputKeys,
    thumbnailKeys,
    resultMediaUrl: thumbnailUrls[0] || outputUrls[0] || '',
    resultMediaUrls: thumbnailUrls.length ? thumbnailUrls : outputUrls,
    originalMediaUrl: originalUrls[0] || '',
    originalMediaUrls: originalUrls,
    error: task.errorMessage || '',
    errorCode: task.errorCode || '',
    costCents: Number(task.costCents || 0),
    estimatedCostUsd: Number(task.costCents || 0) / 100,
    createdAt: task.createdAt || '',
    startedAt: task.startedAt || '',
    finishedAt: task.finishedAt || '',
    updatedAt: task.finishedAt || task.startedAt || task.createdAt || '',
  }
}

function legacyResultFromTask(task = {}) {
  const originals = Array.isArray(task.originalUrls) ? task.originalUrls.filter(Boolean) : []
  const outputs = originals.length
    ? originals
    : Array.isArray(task.outputUrls)
      ? task.outputUrls.filter(Boolean)
      : []
  return { outputs }
}

// ---------------------------------------------------------------------------
// 旧接口签名（供三套任务链路继续调用）
// ---------------------------------------------------------------------------

/** 上传参考图，返回可展示 URL（内部登记 URL→key 供 createServerAiJob 使用）。 */
export async function uploadAiInputFile(file, _options = {}) {
  if (!file) throw new Error('请先选择一张图片')
  const uploaded = await uploadFile(file)
  registerUrlKey(uploaded.url, uploaded.key)
  return uploaded.url
}

/** 创建任务：旧 job payload → 新 createTask 契约。 */
export async function createServerAiJob(payload = {}) {
  const kind = String(payload.kind || '').trim()
  const type = mapJobKindToTaskType(kind)
  const input = payload.input && typeof payload.input === 'object' ? payload.input : {}
  const legacyParams = payload.params && typeof payload.params === 'object' ? payload.params : {}
  const count = Math.max(
    1,
    Math.min(Number(payload.units || input.count || legacyParams.count || 1) || 1, 4),
  )

  const sourceUrls = Array.from(
    new Set(
      [
        ...(Array.isArray(input.sourceUrls) ? input.sourceUrls : []),
        input.sourceUrl,
        ...(Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : []),
      ]
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )
  const maskUrl = String(input.maskUrl || legacyParams.maskUrl || '').trim()

  // 任一参考图/蒙版解析失败都会抛 input_image_lost，阻断本次提交
  const inputKeys = []
  for (const url of sourceUrls) {
    const key = await resolveInputKeyForUrl(url)
    if (key && !inputKeys.includes(key)) inputKeys.push(key)
  }
  let maskKey = ''
  if (maskUrl) {
    maskKey = await resolveInputKeyForUrl(maskUrl)
    if (maskKey && !inputKeys.includes(maskKey)) inputKeys.push(maskKey)
  }

  const task = await createTask({
    type,
    prompt: String(payload.prompt || '').trim(),
    params: {
      ...legacyParams,
      ...input,
      count,
      _kind: kind,
      ...(maskKey ? { maskKey } : {}),
    },
    inputKeys,
    count,
    idempotencyKey: String(payload.clientRequestId || '').trim() || undefined,
  })
  return { job: taskToLegacyJob(task) }
}

export async function listServerAiJobs(limit = 30, options = {}) {
  const kind = String(options.kind || '').trim()
  const type = kind ? mapJobKindToTaskType(kind.split(',')[0]) : ''
  const { items, nextCursor } = await listTasks({
    type,
    limit,
    cursor: String(options.cursor || '').trim(),
  })
  let jobs = items.map((task) => taskToLegacyJob(task))
  if (options.excludeFailed) {
    jobs = jobs.filter((job) => !['failed', 'cancelled'].includes(job.status))
  }
  return {
    jobs,
    pagination: {
      nextCursor: nextCursor || '',
      hasMore: Boolean(nextCursor),
    },
  }
}

export async function getServerAiJob(jobId, options = {}) {
  const task = await getTask(jobId, { signal: options.signal })
  return { job: taskToLegacyJob(task) }
}

export async function getServerAiJobResult(jobId, options = {}) {
  const task = await getTask(jobId, { signal: options.signal })
  return { job: taskToLegacyJob(task), result: legacyResultFromTask(task) }
}

export async function deleteServerAiJob(jobId) {
  await deleteTask(jobId)
  return { deleted: true }
}

/** 新契约任务由服务端队列自动执行，run 是无操作占位。 */
export async function runServerAiJob(jobId) {
  const task = await getTask(jobId)
  return { job: taskToLegacyJob(task) }
}

export async function cancelServerAiJob(jobId) {
  const task = await cancelTask(jobId)
  const job = taskToLegacyJob(task)
  return { cancelled: job.status === 'cancelled', job }
}

/**
 * 轮询任务直到终态（统一 2s 间隔，支持 AbortSignal）。
 * 成功返回 { job, result }；失败/取消抛错，保持旧行为。
 */
export async function waitForServerAiJob(
  jobId,
  { onStatus = null, maxPolls = 450, signal = undefined } = {},
) {
  if (!jobId) throw new Error('AI 任务 ID 无效')
  // 轮询统一 2s 间隔（无视旧调用方各自的 intervalMs 配置）
  const interval = 2000
  const task = await waitForTask(jobId, {
    signal,
    intervalMs: interval,
    maxWaitMs: interval * Math.max(1, Number(maxPolls) || 450),
    onUpdate: (current) => {
      if (typeof onStatus === 'function') {
        onStatus(formatServerAiJobStatus(String(current?.status || '').toLowerCase()))
      }
    },
  })
  const job = taskToLegacyJob(task)
  if (task.status === 'succeeded') {
    return { job, result: legacyResultFromTask(task) }
  }
  if (task.status === 'canceled') {
    throw new Error(task.errorMessage || 'AI 任务已取消')
  }
  throw new Error(task.errorMessage || 'AI 任务执行失败')
}

/**
 * 本地超清结果不再回传服务端（新后端任务产物只读）。
 * 返回本地 blob URL 供当前会话展示与下载；刷新后回退到服务端原图。
 */
export async function replaceServerAiJobResultWithLocalUpscale(jobId, file) {
  const task = await getTask(jobId).catch(() => null)
  const job = task ? taskToLegacyJob(task) : null
  const localUrl = file ? URL.createObjectURL(file) : ''
  if (job && localUrl) {
    return {
      job: {
        ...job,
        originalResultMediaUrl: job.originalMediaUrl || job.resultMediaUrl,
        resultMediaUrl: localUrl,
        resultMediaUrls: [localUrl, ...job.resultMediaUrls.slice(1)],
      },
      persisted: false,
    }
  }
  return { job, persisted: false }
}

/** 云端超清方案已下线：返回空目录，超清面板自动隐藏云端选项。 */
export async function listCloudUpscaleProviders() {
  return { providers: [] }
}

export async function listServerAiUpscaleExperiments() {
  return { experiments: [] }
}

export async function createServerAiUpscaleExperiment() {
  throw new Error('云端超清实验暂未开放')
}

function formatServerAiJobStatus(status) {
  if (status === 'running') return '云端 AI 正在执行...'
  if (status === 'queued') return '云端 AI 排队中...'
  if (status === 'succeeded') return '云端 AI 已完成，正在读取结果...'
  if (status === 'failed') return '云端 AI 执行失败'
  if (status === 'canceled') return '云端 AI 已取消'
  return '正在同步云端 AI 状态...'
}
