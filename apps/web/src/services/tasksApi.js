/**
 * AI 任务 API（新契约 /api/tasks*、/api/uploads）。
 *
 * 任务类型：t2i | coloring | ui_design | model_sheet | game_art | puzzle
 * 状态机：queued → running → succeeded | failed | canceled
 */
import { apiDelete, apiGet, apiPost, apiRequest, buildApiPath } from './apiClient'

export const TASK_TYPES = ['t2i', 'coloring', 'ui_design', 'model_sheet', 'game_art', 'puzzle']

export const TASK_TYPE_LABELS = {
  t2i: '文生图',
  coloring: '插画染色',
  ui_design: 'UI 设计稿',
  model_sheet: '超高清模型图',
  game_art: '游戏设计',
  puzzle: 'AI 拼图',
}

export const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'canceled'])
export const TASK_UPDATE_EVENT = 'starclouds:task-update'

export function isTerminalTaskStatus(status = '') {
  return TERMINAL_TASK_STATUSES.has(String(status || '').trim().toLowerCase())
}

function dispatchTaskUpdate(task, payload) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TASK_UPDATE_EVENT, { detail: { task, payload } }))
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
  const data = await apiPost(
    '/tasks',
    {
      type,
      prompt: String(prompt || ''),
      params: params && typeof params === 'object' ? params : {},
      inputKeys: (Array.isArray(inputKeys) ? inputKeys : []).filter(Boolean),
      count: Math.max(1, Math.min(Number(count) || 1, 4)),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
    { fallbackMessage: '任务创建失败' },
  )
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

/**
 * Subscribe to persisted task snapshots. The returned function closes the SSE
 * connection; callers should keep polling as a fallback when SSE is unavailable.
 */
export function subscribeTask(id, { onUpdate = null, onError = null } = {}) {
  if (!id || typeof EventSource === 'undefined') return () => {}
  const source = new EventSource(buildApiPath(`/tasks/${encodeURIComponent(id)}/stream`))
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

/** Account-wide task events keep completion notifications live across pages. */
export function subscribeUserTasks({ onUpdate = null, onError = null } = {}) {
  if (typeof EventSource === 'undefined') return () => {}
  const source = new EventSource(buildApiPath('/me/tasks/stream'))
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
  source.onerror = (event) => {
    if (typeof onError === 'function') onError(event)
  }
  return () => source.close()
}

/**
 * 当前用户任务列表（cursor 分页）。
 * @returns {Promise<{items: object[], nextCursor: string|null}>}
 */
export async function listTasks({ type = '', status = '', limit = 20, cursor = '', signal } = {}) {
  const data = await apiGet('/tasks', {
    query: { type, status, limit, cursor },
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
  const data = await apiPost(`/tasks/${encodeURIComponent(id)}/cancel`, {}, {
    fallbackMessage: '任务取消失败',
  })
  return data?.task || data
}

/** 删除终态任务记录（同时删除产物）。 */
export async function deleteTask(id) {
  return apiDelete(`/tasks/${encodeURIComponent(id)}`, { fallbackMessage: '任务删除失败' })
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
  return new Promise((resolve, reject) => {
    let settled = false
    let polling = false
    let lastSignature = ''

    const cleanup = () => {
      unsubscribe()
      window.clearInterval(pollTimer)
      window.clearTimeout(timeoutTimer)
      signal?.removeEventListener('abort', abort)
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const apply = (task) => {
      if (!task || settled) return
      const signature = JSON.stringify([
        task.status,
        task.errorCode,
        task.outputKeys,
        task.thumbnailKeys,
      ])
      if (signature !== lastSignature) {
        lastSignature = signature
        if (typeof onUpdate === 'function') onUpdate(task)
      }
      if (isTerminalTaskStatus(task.status)) finish(resolve, task)
    }
    const poll = async () => {
      if (polling || settled) return
      polling = true
      try {
        apply(await getTask(id, { signal }))
      } catch (error) {
        if (error?.name === 'AbortError') finish(reject, error)
        // A transient poll failure does not stop an active SSE connection.
      } finally {
        polling = false
      }
    }
    const abort = () => finish(reject, createAbortError())
    const unsubscribe = subscribeTask(id, { onUpdate: apply })
    const pollTimer = window.setInterval(poll, pollEvery)
    const timeoutTimer = window.setTimeout(() => {
      finish(reject, new Error('任务等待超时，请稍后在历史记录中查看结果'))
    }, timeoutAfter)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    void poll()
  })
}

function createAbortError() {
  return new DOMException('Aborted', 'AbortError')
}
