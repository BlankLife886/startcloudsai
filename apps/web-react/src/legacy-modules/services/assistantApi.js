import { ApiError, apiDelete, apiGet, apiPatch, apiPost, buildApiPath } from './apiClient'

// 旧的客户端直连管线（streamAssistantChat / classifyAssistantIntent / generateAssistantImage）
// 已由服务端 runs 管线取代并删除：意图路由与生图统一走 /assistant/runs。

export async function fetchAssistantConfig(signal) {
  const response = await fetch(buildApiPath('/assistant/config'), {
    credentials: 'include',
    signal,
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
    signal,
    fallbackMessage: '对话记录加载失败',
  })
  return Array.isArray(data?.conversations) ? data.conversations : []
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

export async function cancelAssistantRun(id) {
  return apiPatch(
    `/assistant/runs/${encodeURIComponent(id)}`,
    { status: 'canceled' },
    { fallbackMessage: '停止任务失败' },
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

export async function waitForAssistantRun(
  id,
  { signal, onUpdate, intervalMs = 700, maxWaitMs = 20 * 60 * 1000 } = {},
) {
  const startedAt = Date.now()
  for (;;) {
    if (signal?.aborted) throw abortError()
    const data = await getAssistantRun(id, { signal })
    onUpdate?.(data)
    if (['succeeded', 'failed', 'canceled'].includes(data?.run?.status)) return data
    if (Date.now() - startedAt > maxWaitMs) {
      throw new ApiError('任务仍在后台运行，可稍后回到该对话查看', {
        code: 'assistant_run_timeout',
      })
    }
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, intervalMs)
      signal?.addEventListener(
        'abort',
        () => {
          window.clearTimeout(timer)
          reject(abortError())
        },
        { once: true },
      )
    })
  }
}
