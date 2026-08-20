/**
 * AI 任务 API（新契约 /api/v1/tasks*、/api/v1/uploads）。
 *
 * 任务类型：t2i | coloring | ui_design | ecommerce_design | model_sheet | game_art | puzzle | background_remove
 * 无限画布不是独立 type，而是 t2i / background_remove + params._source=react_canvas
 * 状态机：queued → running → succeeded | failed | canceled
 */
import { apiDelete, apiGet, apiPatch, apiPost, apiRequest, buildApiPath } from './apiClient.js'
import { listNotifications } from './meApi.js'
import { scheduleWalletRefresh } from './walletSync.js'

export const TASK_TYPES = [
  't2i',
  'coloring',
  'ui_design',
  'ecommerce_design',
  'model_sheet',
  'game_art',
  'puzzle',
  'background_remove',
]

export const TASK_TYPE_LABELS = {
  t2i: '文生图',
  coloring: '插画染色',
  ui_design: 'UI 设计稿',
  ecommerce_design: 'AI 电商',
  model_sheet: '模型设计',
  game_art: '游戏设计',
  puzzle: '拼图',
  background_remove: '背景移除',
}

export function taskOriginLabel(item = {}) {
  const record = item && typeof item === 'object' ? item : {}
  const params = record.params && typeof record.params === 'object' && !Array.isArray(record.params)
    ? record.params
    : {}
  const source = String(record.source || params._source || params.source || '')
    .trim()
    .toLowerCase()
  const kind = String(params._kind || params.kind || '')
    .trim()
    .toLowerCase()
  const workspace = String(params.workspace || '')
    .trim()
    .toLowerCase()
  const displayName = String(record.displayName || '').trim()
  if (displayName === '无限画布' || displayName === '画布去背') return displayName
  if (
    source === 'react_canvas' ||
    source === 'infinite_canvas' ||
    workspace === 'infinite_canvas' ||
    kind.startsWith('canvas-')
  ) {
    return kind === 'canvas-background-remove' ? '画布去背' : '无限画布'
  }
  return TASK_TYPE_LABELS[record.taskType || record.type] || '创作'
}

export const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'canceled'])
export const TASK_UPDATE_EVENT = 'starclouds:task-update'
export const NOTIFICATIONS_UPDATED_EVENT = 'starclouds:notifications-updated'

/** SSE 断开期间未读通知数的兜底轮询间隔。 */
const NOTIFICATIONS_FALLBACK_POLL_MS = 120_000

const TASK_BATCH_LIMIT = 100
const TASK_SUBMISSION_CONCURRENCY = 6
const taskWaitEntries = new Map()
const submissionQueue = []
let activeSubmissions = 0
let taskPollTimer = 0
let taskPollScheduledAt = 0
let taskPollRunning = false
let taskUpdateBridgeReady = false

export function isTerminalTaskStatus(status = '') {
  return TERMINAL_TASK_STATUSES.has(
    String(status || '')
      .trim()
      .toLowerCase(),
  )
}

function dispatchTaskUpdate(task, payload) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TASK_UPDATE_EVENT, { detail: { task, payload } }))
  if (isTerminalTaskStatus(task?.status)) scheduleWalletRefresh()
}

function runSubmissionQueue() {
  while (activeSubmissions < TASK_SUBMISSION_CONCURRENCY && submissionQueue.length) {
    const queued = submissionQueue.shift()
    activeSubmissions += 1
    Promise.resolve()
      .then(queued.operation)
      .then(queued.resolve, queued.reject)
      .finally(() => {
        activeSubmissions -= 1
        runSubmissionQueue()
      })
  }
}

function withSubmissionSlot(operation) {
  return new Promise((resolve, reject) => {
    submissionQueue.push({ operation, resolve, reject })
    runSubmissionQueue()
  })
}

async function postTaskWithRecovery(body, idempotencyKey) {
  const attempts = idempotencyKey ? 2 : 1
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), 30000)
    try {
      return await apiPost('/tasks', body, {
        signal: controller.signal,
        fallbackMessage: '任务创建失败',
      })
    } catch (error) {
      lastError = error
      const retryable =
        error?.name === 'AbortError' ||
        error?.code === 'network_error' ||
        Number(error?.status) >= 500
      if (!retryable || attempt + 1 >= attempts) throw error
      await new Promise((resolve) => globalThis.setTimeout(resolve, 300))
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
  throw lastError || new Error('任务创建失败')
}

/**
 * 创建任务。费用按 count × 单价冻结，余额不足抛 code=insufficient_balance。
 * @returns {Promise<object>} 完整 task 对象
 */
export async function createTask({
  type,
  prompt,
  params = {},
  inputKeys = [],
  count = 1,
  idempotencyKey = '',
} = {}) {
  const body = {
    type,
    prompt: String(prompt || ''),
    params: params && typeof params === 'object' ? params : {},
    inputKeys: (Array.isArray(inputKeys) ? inputKeys : []).filter(Boolean),
    count: Math.max(1, Math.min(Number(count) || 1, 4)),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  }
  const data = await withSubmissionSlot(() => postTaskWithRecovery(body, idempotencyKey))
  scheduleWalletRefresh()
  return data?.task || data
}

/** 任务详情（轮询用），支持 AbortSignal。 */
export async function getTask(id, { signal } = {}) {
  const data = await apiGet(`/tasks/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: '任务读取失败',
  })
  return data?.task || data
}

/** 批量读取任务快照，供高并发等待协调器使用。 */
export async function getTasksBatch(ids, { signal } = {}) {
  const unique = Array.from(
    new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)),
  ).slice(0, TASK_BATCH_LIMIT)
  if (!unique.length) return []
  const data = await apiGet('/tasks', {
    query: { ids: unique.join(',') },
    signal,
    fallbackMessage: '任务批量读取失败',
  })
  return Array.isArray(data?.items) ? data.items : []
}

/**
 * Subscribe to persisted task snapshots. The returned function closes the SSE
 * connection; callers should keep polling as a fallback when SSE is unavailable.
 */
export function subscribeTask(id, { onUpdate = null, onError = null } = {}) {
  if (!id || typeof EventSource === 'undefined') return () => {}
  const source = new EventSource(buildApiPath(`/tasks/${encodeURIComponent(id)}/events`))
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data || '{}')
      const task = payload?.task || payload
      if (typeof onUpdate === 'function') onUpdate(task, payload)
      dispatchTaskUpdate(task, payload)
      if (isTerminalTaskStatus(task?.status)) source.close()
    } catch {
      // Ignore malformed transient events; the polling path remains authoritative.
    }
  }
  source.onerror = (event) => {
    source.close()
    if (typeof onError === 'function') onError(event)
  }
  return () => source.close()
}

function publishUnreadCount(unreadCount, sourceTag) {
  const count = Number(unreadCount)
  if (typeof window === 'undefined' || !Number.isFinite(count)) return
  window.dispatchEvent(
    new CustomEvent(NOTIFICATIONS_UPDATED_EVENT, {
      detail: { unreadCount: Math.max(0, count), source: sourceTag },
    }),
  )
}

/**
 * Account-wide task events keep completion notifications live across pages.
 * The same EventSource also carries `notifications` events ({unreadCount})
 * for the navbar badge; while the stream is down we fall back to a
 * low-frequency unread-count poll and stop it as soon as SSE recovers.
 */
export function subscribeUserTasks({ onUpdate = null, onError = null } = {}) {
  if (typeof EventSource === 'undefined') return () => {}
  const source = new EventSource(buildApiPath('/me/tasks/events'))
  let fallbackTimer = 0
  let fallbackInFlight = false

  const stopFallbackPolling = () => {
    if (!fallbackTimer) return
    globalThis.clearInterval(fallbackTimer)
    fallbackTimer = 0
  }
  const pollUnreadCount = async () => {
    if (fallbackInFlight) return
    fallbackInFlight = true
    try {
      const { unread } = await listNotifications({ limit: 1 })
      publishUnreadCount(unread, 'sse-fallback')
    } catch {
      // 静默：保持上一次徽标值，等待下一轮或 SSE 恢复。
    } finally {
      fallbackInFlight = false
    }
  }
  const startFallbackPolling = () => {
    if (fallbackTimer) return
    fallbackTimer = globalThis.setInterval(() => {
      void pollUnreadCount()
    }, NOTIFICATIONS_FALLBACK_POLL_MS)
    void pollUnreadCount()
  }

  source.onopen = () => stopFallbackPolling()
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data || '{}')
      const task = payload?.task || payload
      dispatchTaskUpdate(task, payload)
      if (typeof onUpdate === 'function') onUpdate(task, payload)
    } catch {
      // Keep the stream alive; a later persisted snapshot can still recover it.
    }
  }
  source.addEventListener('notifications', (event) => {
    stopFallbackPolling()
    try {
      const payload = JSON.parse(event.data || '{}')
      publishUnreadCount(payload?.unreadCount, 'sse')
    } catch {
      // Malformed heartbeat payloads are ignored; the next event corrects it.
    }
  })
  source.onerror = (event) => {
    startFallbackPolling()
    if (typeof onError === 'function') onError(event)
  }
  return () => {
    stopFallbackPolling()
    source.close()
  }
}

function taskSnapshotSignature(task) {
  return JSON.stringify([
    task?.status,
    task?.errorCode,
    task?.outputKeys,
    task?.thumbnailKeys,
    task?.outputUrls,
    task?.displayUrls,
    task?.originalUrls,
    task?.finishedAt,
  ])
}

function taskSnapshotHasOutput(task) {
  return [task?.outputKeys, task?.outputUrls, task?.originalUrls].some(
    (items) => Array.isArray(items) && items.some(Boolean),
  )
}

function applyWaitingTaskSnapshot(task, payload = null, broadcast = false) {
  const id = String(task?.id || '').trim()
  const entry = taskWaitEntries.get(id)
  if (!entry) return
  const terminal = isTerminalTaskStatus(task?.status)
  for (const waiter of [...entry.waiters]) {
    const signature = taskSnapshotSignature(task)
    if (signature !== waiter.lastSignature) {
      waiter.lastSignature = signature
      if (typeof waiter.onUpdate === 'function') waiter.onUpdate(task)
    }
    if (!terminal) continue
    const succeededWithoutOutput =
      String(task?.status || '').toLowerCase() === 'succeeded' && !taskSnapshotHasOutput(task)
    if (succeededWithoutOutput) {
      // Completion can become visible just before replicated output fields.
      // Confirm the empty result through polling before ending the waiter.
      if (payload?.source !== 'batch-poll') {
        entry.nextPollAt = 0
        scheduleTaskPoll(0)
        continue
      }
      waiter.emptySuccessPolls += 1
      if (waiter.emptySuccessPolls < 2) continue
    } else {
      waiter.emptySuccessPolls = 0
    }
    waiter.finish(waiter.resolve, task)
  }
  if (broadcast) dispatchTaskUpdate(task, payload || { source: 'batch-poll' })
}

function ensureTaskUpdateBridge() {
  if (taskUpdateBridgeReady || typeof window === 'undefined') return
  taskUpdateBridgeReady = true
  window.addEventListener(TASK_UPDATE_EVENT, (event) => {
    if (event?.detail?.payload?.source === 'batch-poll') return
    applyWaitingTaskSnapshot(event?.detail?.task, event?.detail?.payload, false)
  })
}

function taskPollDelay(entry) {
  const waitingCount = taskWaitEntries.size
  const loadDelay =
    waitingCount > 50 ? 6000 : waitingCount > 20 ? 5000 : waitingCount > 4 ? 3500 : 0
  const visibleDelay = Math.max(entry.pollEvery, loadDelay)
  const hiddenDelay = typeof document !== 'undefined' && document.hidden ? 12000 : visibleDelay
  return Math.min(30000, hiddenDelay * 2 ** Math.min(entry.failureCount, 3))
}

function scheduleTaskPoll(delay = null) {
  if (taskPollRunning || !taskWaitEntries.size) return
  const now = Date.now()
  const nextAt = Math.min(...[...taskWaitEntries.values()].map((entry) => entry.nextPollAt))
  const wait = delay == null ? Math.max(0, nextAt - now) : Math.max(0, delay)
  const scheduledAt = now + wait
  if (taskPollTimer && taskPollScheduledAt <= scheduledAt) return
  if (taskPollTimer) globalThis.clearTimeout(taskPollTimer)
  taskPollScheduledAt = scheduledAt
  taskPollTimer = globalThis.setTimeout(() => {
    taskPollTimer = 0
    taskPollScheduledAt = 0
    void pollWaitingTasks()
  }, wait)
}

async function pollWaitingTasks() {
  if (taskPollRunning || !taskWaitEntries.size) return
  const now = Date.now()
  const dueIDs = [...taskWaitEntries.entries()]
    .filter(([, entry]) => entry.nextPollAt <= now)
    .slice(0, TASK_BATCH_LIMIT)
    .map(([id]) => id)
  if (!dueIDs.length) {
    scheduleTaskPoll()
    return
  }
  taskPollRunning = true
  try {
    const tasks = await getTasksBatch(dueIDs)
    const received = new Set()
    for (const task of tasks) {
      const id = String(task?.id || '')
      received.add(id)
      const entry = taskWaitEntries.get(id)
      if (entry) entry.failureCount = 0
      applyWaitingTaskSnapshot(task, { source: 'batch-poll' }, true)
    }
    for (const id of dueIDs) {
      const entry = taskWaitEntries.get(id)
      if (entry && !received.has(id)) entry.failureCount += 1
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      for (const id of dueIDs) {
        const entry = taskWaitEntries.get(id)
        if (entry) entry.failureCount += 1
      }
    }
  } finally {
    const nextNow = Date.now()
    for (const id of dueIDs) {
      const entry = taskWaitEntries.get(id)
      if (entry) entry.nextPollAt = nextNow + taskPollDelay(entry)
    }
    taskPollRunning = false
    scheduleTaskPoll(taskWaitEntries.size > TASK_BATCH_LIMIT ? 0 : null)
  }
}

/**
 * 当前用户任务列表（cursor 分页）。
 * @returns {Promise<{items: object[], nextCursor: string|null}>}
 */
export async function listTasks({ type = '', status = '', limit = 20, cursor = '', excludeSource = '', source = '', signal } = {}) {
  const data = await apiGet('/tasks', {
    query: { type, status, limit, cursor, excludeSource, source },
    signal,
    fallbackMessage: '任务列表读取失败',
  })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor || null,
  }
}

/** 取消任务（仅 queued 状态可取消，解冻费用）。 */
export async function cancelTask(id) {
  const data = await apiPatch(
    `/tasks/${encodeURIComponent(id)}`,
    { status: 'canceled' },
    {
      fallbackMessage: '任务取消失败',
    },
  )
  return data?.task || data
}

/** 删除终态任务记录（同时删除产物）。 */
export async function deleteTask(id, { cascade = false } = {}) {
  return apiDelete(`/tasks/${encodeURIComponent(id)}${cascade ? '?cascade=true' : ''}`, {
    fallbackMessage: '任务删除失败',
  })
}

/**
 * 上传输入图片（≤15MB，png/jpg/webp）。
 * @returns {Promise<{key: string, url: string}>}
 */
export async function uploadFile(file, { signal } = {}) {
  if (!file) throw new Error('请先选择文件')
  const formData = new FormData()
  formData.append('file', file, file.name || `upload-${Date.now()}.png`)
  return apiRequest('/uploads', {
    method: 'POST',
    body: formData,
    signal,
    fallbackMessage: '文件上传失败',
  })
}

/**
 * 轮询任务直到终态（2s 间隔），全程支持 AbortSignal。
 * @param {string} id
 * @param {object} options
 * @param {AbortSignal} [options.signal]
 * @param {(task: object) => void} [options.onUpdate] - 每轮状态回调
 * @param {number} [options.intervalMs]
 * @param {number} [options.maxWaitMs]
 * @returns {Promise<object>} 终态 task；failed/canceled 也正常返回，由调用方判断
 */
export async function waitForTask(
  id,
  { signal, onUpdate = null, intervalMs = 2000, maxWaitMs = 15 * 60 * 1000 } = {},
) {
  const pollEvery = Math.max(500, Number(intervalMs) || 2000)
  const timeoutAfter = Math.max(pollEvery, Number(maxWaitMs) || 15 * 60 * 1000)
  ensureTaskUpdateBridge()
  return new Promise((resolve, reject) => {
    let settled = false
    const taskID = String(id || '').trim()
    if (!taskID) {
      reject(new Error('任务 ID 无效'))
      return
    }
    let entry = taskWaitEntries.get(taskID)
    if (!entry) {
      entry = { waiters: new Set(), pollEvery, failureCount: 0, nextPollAt: 0 }
      taskWaitEntries.set(taskID, entry)
    } else {
      entry.pollEvery = Math.min(entry.pollEvery, pollEvery)
      entry.nextPollAt = 0
    }
    const cleanup = () => {
      entry.waiters.delete(waiter)
      globalThis.clearTimeout(timeoutTimer)
      signal?.removeEventListener('abort', abort)
      if (!entry.waiters.size) {
        entry.unsubscribe?.()
        taskWaitEntries.delete(taskID)
      }
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const abort = () => finish(reject, createAbortError())
    const waiter = {
      resolve,
      reject,
      finish,
      onUpdate,
      lastSignature: '',
      emptySuccessPolls: 0,
    }
    entry.waiters.add(waiter)
    if (!entry.unsubscribe) entry.unsubscribe = subscribeTask(taskID)
    const timeoutTimer = globalThis.setTimeout(() => {
      finish(reject, new Error('任务等待超时，请稍后在历史记录中查看结果'))
    }, timeoutAfter)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    scheduleTaskPoll(0)
  })
}

function createAbortError() {
  return new DOMException('Aborted', 'AbortError')
}
