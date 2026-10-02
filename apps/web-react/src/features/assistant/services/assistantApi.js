import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiRequest,
  buildApiPath,
} from '@react/legacy-modules/services/apiClient.js'

// 旧的客户端直连管线（streamAssistantChat / classifyAssistantIntent / generateAssistantImage）
// 已由服务端 runs 管线取代并删除：意图路由与生图统一走 /assistant/runs。

export async function fetchAssistantConfig(signal) {
  const response = await fetch(buildApiPath('/assistant/config'), {
    credentials: 'include',
    signal,
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success !== true) {
    throw new ApiError(payload?.error || 'AI 服务尚未配置', {
      code: payload?.code || 'assistant_unavailable',
      status: response.status,
    })
  }
  return payload.data
}

export async function listAssistantConversations({ signal } = {}) {
  const data = await apiGet('/assistant/conversations', {
    query: { messageLimit: 24 },
    signal,
    fallbackMessage: '对话记录加载失败',
  })
  return Array.isArray(data?.conversations) ? data.conversations : []
}

export async function getAssistantConversation(id, { beforeMessageId = '', messageLimit = 80, signal } = {}) {
  return apiGet(`/assistant/conversations/${encodeURIComponent(id)}`, {
    query: {
      messageLimit,
      ...(beforeMessageId ? { beforeMessageId } : {}),
    },
    signal,
    fallbackMessage: '更早对话加载失败',
  })
}

export async function createAssistantConversation(
  title = '新对话',
  { workspace = 'assistant', signal } = {},
) {
  return apiPost(
    '/assistant/conversations',
    { title, workspace },
    { signal, fallbackMessage: '新建对话失败' },
  )
}

export async function patchAssistantConversation(id, { title } = {}) {
  return apiPatch(
    `/assistant/conversations/${encodeURIComponent(id)}`,
    { title },
    { fallbackMessage: '重命名失败' },
  )
}

export async function deleteAssistantConversation(id, { cancelActive = false } = {}) {
  return apiDelete(`/assistant/conversations/${encodeURIComponent(id)}`, {
    query: cancelActive ? { cancelActive: true } : null,
    fallbackMessage: '删除对话失败',
  })
}

export async function deleteAssistantMessage(id) {
  return apiDelete(`/assistant/messages/${encodeURIComponent(id)}`, {
    fallbackMessage: '删除内容失败',
  })
}

export async function setAssistantMessageFeedback(id, rating = '') {
  const normalizedRating = String(rating || '').trim().toLowerCase()
  if (!['', 'positive', 'negative'].includes(normalizedRating)) {
    throw new Error('不支持的回复评价')
  }
  return apiRequest(`/assistant/messages/${encodeURIComponent(id)}/feedback`, {
    method: 'PUT',
    body: { rating: normalizedRating },
    fallbackMessage: '回复评价提交失败',
  })
}

export async function deleteAssistantMessageImage(messageId, imageId) {
  return apiDelete(
    `/assistant/messages/${encodeURIComponent(messageId)}/images/${encodeURIComponent(imageId)}`,
    { fallbackMessage: '删除图片失败' },
  )
}

export async function deleteAssistantTurn(userMessageId) {
  return apiDelete(`/assistant/messages/${encodeURIComponent(userMessageId)}`, {
    query: { scope: 'turn' },
    fallbackMessage: '撤回本轮失败',
  })
}

export async function createAssistantContextBoundary(conversationId) {
  return apiPost(
    `/assistant/conversations/${encodeURIComponent(conversationId)}/context-boundaries`,
    {},
    { fallbackMessage: '清除上文失败' },
  )
}

export async function importAssistantConversations(conversations, { signal } = {}) {
  return apiPost(
    '/assistant/conversation-imports',
    { conversations },
    { signal, fallbackMessage: '旧对话迁移失败' },
  )
}

export async function createAssistantRun(input, { signal } = {}) {
  return apiPost('/assistant/runs', input, { signal, fallbackMessage: '任务创建失败' })
}

export async function uploadAssistantFile(file, { signal } = {}) {
  if (!file) throw new Error('请先选择文档')
  const formData = new FormData()
  formData.append('file', file, file.name || `document-${Date.now()}`)
  const data = await apiRequest('/assistant/files', {
    method: 'POST', body: formData, signal, fallbackMessage: '文档上传失败',
  })
  return data?.file || data
}

export async function getAssistantFile(id, { signal } = {}) {
  const data = await apiGet(`/assistant/files/${encodeURIComponent(id)}`, {
    signal, fallbackMessage: '文档状态读取失败',
  })
  return data?.file || data
}

export async function deleteAssistantFile(id) {
  return apiDelete(`/assistant/files/${encodeURIComponent(id)}`, {
    fallbackMessage: '删除文档失败',
  })
}

export async function waitForAssistantFile(
  id,
  { signal, onUpdate, intervalMs = 600, maxWaitMs = 5 * 60 * 1000 } = {},
) {
  const startedAt = Date.now()
  for (;;) {
    if (signal?.aborted) throw abortError()
    const file = await getAssistantFile(id, { signal })
    onUpdate?.(file)
    if (file?.status === 'ready') return file
    if (file?.status === 'failed') throw new ApiError(file.errorMessage || '文档解析失败', {
      code: file.errorCode || 'assistant_file_failed',
    })
    if (Date.now() - startedAt > maxWaitMs) {
      throw new ApiError('文档仍在后台解析，请稍后重试', { code: 'assistant_file_timeout' })
    }
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, intervalMs)
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timer)
        reject(abortError())
      }, { once: true })
    })
  }
}

/**
 * 打开助手任务的 SSE 增量流（真流式打字机）。
 * 事件形如 {content, kind, stage, image, imageTotal, done, status}；
 * 轮询仍是状态机权威，本流负责加速文本和逐张图片呈现。
 */
export function openAssistantRunStream(id, { onEvent } = {}) {
  let source
  try {
    source = new EventSource(buildApiPath(`/assistant/runs/${encodeURIComponent(id)}/events`))
  } catch {
    return null
  }
  source.onmessage = (event) => {
    let payload
    try {
      payload = JSON.parse(event.data)
    } catch {
      return
    }
    onEvent?.(payload)
    if (payload?.done && ['succeeded', 'failed', 'canceled'].includes(payload.status)) {
      source.close()
    }
  }
  source.onerror = () => {
    // EventSource 自带重连；服务端对终结任务会立即回 done 并关闭
  }
  return source
}

export async function getAssistantRun(id, { signal } = {}) {
  return apiGet(`/assistant/runs/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: '任务状态读取失败',
  })
}

export async function listActiveAssistantRuns({ workspace = '', signal } = {}) {
  const data = await apiGet('/assistant/runs', {
    query: workspace ? { workspace } : null,
    signal,
    fallbackMessage: '任务状态读取失败',
  })
  return Array.isArray(data?.runs) ? data.runs : []
}

export async function cancelAssistantRun(id, { acknowledgeUpstream = false, signal } = {}) {
  return apiPatch(
    `/assistant/runs/${encodeURIComponent(id)}`,
    { status: 'canceled', acknowledgeUpstream },
    { signal, fallbackMessage: '停止任务失败' },
  )
}

export async function editQueuedAssistantRun(id, prompt) {
  return apiPatch(
    `/assistant/runs/${encodeURIComponent(id)}`,
    { action: 'edit', prompt, userMessageContent: prompt },
    { fallbackMessage: '修改排队任务失败' },
  )
}

export async function moveQueuedAssistantRun(id, direction) {
  const action = direction === 'up' ? 'move_up' : 'move_down'
  return apiPatch(
    `/assistant/runs/${encodeURIComponent(id)}`,
    { action },
    { fallbackMessage: '调整排队顺序失败' },
  )
}

function abortError() {
  try {
    return new DOMException('Aborted', 'AbortError')
  } catch {
    const error = new Error('Aborted')
    error.name = 'AbortError'
    return error
  }
}

// Long runs are never abandoned: after a few minutes polling slows down
// instead of stopping, so a slow generation still lands on screen. Callers
// that want a hard limit pass maxWaitMs.
const SLOW_POLL_AFTER_MS = 5 * 60 * 1000
const SLOW_POLL_MS = 5000

export async function waitForAssistantRun(
  id,
  { signal, onUpdate, intervalMs = 700, maxWaitMs = 0 } = {},
) {
  const startedAt = Date.now()
  let transientFailures = 0
  for (;;) {
    if (signal?.aborted) throw abortError()
    if (maxWaitMs > 0 && Date.now() - startedAt > maxWaitMs) {
      throw new ApiError('任务仍在后台运行，可停止任务或稍后回到该对话查看', {
        code: 'assistant_run_timeout',
      })
    }
    let data
    try {
      data = await getAssistantRun(id, { signal })
      transientFailures = 0
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      const status = Number(error?.status || 0)
      if (status > 0 && status < 500) throw error
      transientFailures += 1
      await waitForAssistantDelay(
        Math.min(5000, Math.max(intervalMs, intervalMs * 2 ** Math.min(transientFailures, 3))),
        signal,
      )
      continue
    }
    onUpdate?.(data)
    if (['succeeded', 'failed', 'canceled'].includes(data?.run?.status)) return data
    await waitForAssistantDelay(Date.now() - startedAt > SLOW_POLL_AFTER_MS ? Math.max(intervalMs, SLOW_POLL_MS) : intervalMs, signal)
  }
}

function waitForAssistantDelay(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// 电商套图：方案卡片读取进度、确认生成、重做、触发检查。
export function getAssistantCommerceSet(id, { signal } = {}) {
  return apiGet(`/assistant/commerce-sets/${encodeURIComponent(id)}`, { signal })
}

export function generateAssistantCommerceSet(id, expectedTotalCents) {
  return apiPost(`/assistant/commerce-sets/${encodeURIComponent(id)}/generate`, { expectedTotalCents })
}

export function redoAssistantCommerceShots(id, { shotIds, note = '', expectedTotalCents }) {
  return apiPost(`/assistant/commerce-sets/${encodeURIComponent(id)}/redo`, { shotIds, note, expectedTotalCents })
}

export function reviewAssistantCommerceSet(id) {
  return apiPost(`/assistant/commerce-sets/${encodeURIComponent(id)}/review`, {})
}

export function assistantCommerceSetArchiveUrl(id) {
  return buildApiPath(`/assistant/commerce-sets/${encodeURIComponent(id)}/archive`)
}

// 资产整理：助手只出方案，用户在卡片上确认后执行，并可撤销。
export function executeAssistantAssetAction(action) {
  return apiPost('/assistant/asset-actions/execute', { action })
}

export function undoAssistantAssetAction(undo) {
  return apiPost('/assistant/asset-actions/undo', { undo })
}

// 记忆：助手记住的品牌、商品、偏好与满意方案；回复里的记忆卡片用同一组接口撤销。
export function listAssistantMemories({ signal } = {}) {
  return apiGet('/assistant/memories', { signal })
}

export function createAssistantMemory(memory) {
  return apiPost('/assistant/memories', memory)
}

export function rememberAssistantCommerceSet(commerceSetId) {
  return apiPost('/assistant/memories', { commerceSetId })
}

export function updateAssistantMemory(id, patch) {
  return apiPatch(`/assistant/memories/${encodeURIComponent(id)}`, patch)
}

export function deleteAssistantMemory(id) {
  return apiDelete(`/assistant/memories/${encodeURIComponent(id)}`)
}

export function setAssistantMemoryEnabled(enabled) {
  return apiPut('/assistant/memories/settings', { enabled })
}

// 撤销一次记忆改动：新建的删掉，修改的改回去，删除的重新记上。
export function undoAssistantMemoryChange(change) {
  const previous = change?.previous
  if (change?.action === 'created' && change.memory?.id) return deleteAssistantMemory(change.memory.id)
  if (change?.action === 'updated' && previous?.id) {
    return updateAssistantMemory(previous.id, { kind: previous.kind, title: previous.title, content: previous.content, imageKeys: previous.imageKeys || [] })
  }
  if (change?.action === 'deleted' && previous) {
    return createAssistantMemory({ kind: previous.kind, title: previous.title, content: previous.content, imageKeys: previous.imageKeys || [] })
  }
  return Promise.reject(new Error('这次改动无法撤销'))
}

// 主动提醒：长任务完成通知、异常提醒、定时报告的开关。
export function getAssistantProactiveSettings({ signal } = {}) {
  return apiGet('/assistant/proactive/settings', { signal })
}

export function updateAssistantProactiveSettings(patch) {
  return apiPut('/assistant/proactive/settings', patch)
}

// 主动建议：新对话空白页上“接着做”的卡片（按记忆和最近的套图算，不调用模型）。
export function getAssistantSuggestions({ signal } = {}) {
  return apiGet('/assistant/proactive/suggestions', { signal })
}
