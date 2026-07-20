/**
 * AI 任务 API（新契约 /api/tasks*、/api/uploads）。
 *
 * 任务类型：t2i | coloring | ui_design | model_sheet | game_art | puzzle
 * 状态机：queued → running → succeeded | failed | canceled
 */
import { apiDelete, apiGet, apiPost, apiRequest } from './apiClient'

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

export function isTerminalTaskStatus(status = '') {
  return TERMINAL_TASK_STATUSES.has(String(status || '').trim().toLowerCase())
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
  const startedAt = Date.now()
  for (;;) {
    if (signal?.aborted) throw createAbortError()
    const task = await getTask(id, { signal })
    if (typeof onUpdate === 'function') onUpdate(task)
    if (isTerminalTaskStatus(task?.status)) return task
    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error('任务等待超时，请稍后在历史记录中查看结果')
    }
    await sleep(Math.max(500, Number(intervalMs) || 2000), signal)
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function createAbortError() {
  return new DOMException('Aborted', 'AbortError')
}
