import { ApiError, apiDelete, apiGet, apiPost, buildApiPath } from './apiClient'

function extractDelta(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.delta === 'string') return payload.delta
  if (typeof payload.output_text === 'string') return payload.output_text
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null
  if (typeof choice?.delta?.content === 'string') return choice.delta.content
  if (typeof choice?.message?.content === 'string') return choice.message.content
  return ''
}

function eventError(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (payload.type === 'error') return String(payload.error?.message || payload.message || '')
  if (payload.error) return String(payload.error?.message || payload.error || '')
  return ''
}

export async function streamAssistantChat(
  messages,
  { signal, onDelta, referenceImages = [] } = {},
) {
  const normalizedReferences = (
    await Promise.all(
      referenceImages.slice(0, 4).map((source) => normalizeReferenceImage(source, signal)),
    )
  ).filter(Boolean)
  let remainingReferences = Math.max(0, 4 - normalizedReferences.length)
  const normalizedMessages = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
  for (let index = messages.length - 1; index >= 0 && remainingReferences > 0; index -= 1) {
    const sources = Array.isArray(messages[index]?.referenceImages)
      ? messages[index].referenceImages.slice(0, remainingReferences)
      : []
    if (!sources.length) continue
    const images = (
      await Promise.all(sources.map((source) => normalizeReferenceImage(source, signal)))
    ).filter(Boolean)
    if (!images.length) continue
    normalizedMessages[index].referenceImages = images
    remainingReferences -= images.length
  }
  let response
  try {
    response = await fetch(buildApiPath('/assistant/chat'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: normalizedMessages, referenceImages: normalizedReferences }),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError('网络连接失败，请检查网络后重试', {
      code: 'network_error',
      status: 0,
    })
  }

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null)
    throw new ApiError(payload?.error || `请求失败（${response.status}）`, {
      code: payload?.code || 'assistant_error',
      status: response.status,
    })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      let payload
      try {
        payload = JSON.parse(raw)
      } catch {
        continue
      }
      const message = eventError(payload)
      if (message) {
        throw new ApiError(message, { code: 'assistant_upstream_error', status: 502 })
      }
      const delta = extractDelta(payload)
      if (delta) {
        fullText += delta
        onDelta?.(delta, fullText)
      }
    }
    if (done) break
  }

  return fullText
}

export async function classifyAssistantIntent(prompt, { signal, hasReferenceImage = false } = {}) {
  const result = await streamAssistantChat(
    [
      {
        role: 'system',
        content: `你是意图路由器。本轮${
          hasReferenceImage ? '附带了参考图片' : '没有附带参考图片'
        }。只有用户明确要求创建新图，或修改、重绘、换背景、增删图片元素时回复 IMAGE。识别图片文字/OCR、读取、翻译、描述、分析、总结、解释或回答图片相关问题都回复 CHAT。参考图片的存在本身绝不代表要编辑图片。只回复 IMAGE 或 CHAT。`,
      },
      { role: 'user', content: prompt },
    ],
    { signal },
  )
  return /\bIMAGE\b/i.test(result) ? 'image' : 'chat'
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('参考图读取失败'))
    reader.readAsDataURL(blob)
  })
}

async function normalizeReferenceImage(source, signal) {
  const value = String(source || '').trim()
  if (!value || value.startsWith('data:image/')) return value

  let url
  try {
    url = new URL(value, window.location.origin)
  } catch {
    throw new ApiError('参考图地址无效，请重新添加', {
      code: 'invalid_reference_image',
      status: 422,
    })
  }
  if (url.origin !== window.location.origin && /^https?:$/.test(url.protocol)) return url.href

  const response = await fetch(url.href, { credentials: 'include', signal })
  if (!response.ok) {
    throw new ApiError('参考图读取失败，请重新添加', {
      code: 'reference_image_unavailable',
      status: response.status,
    })
  }
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) {
    throw new ApiError('参考图格式无效，请重新添加', {
      code: 'invalid_reference_image',
      status: 422,
    })
  }
  return blobToDataUrl(blob)
}

export async function generateAssistantImage(
  prompt,
  { size, quality, count, referenceImages = [], signal } = {},
) {
  const normalizedReferences = (
    await Promise.all(
      referenceImages.slice(0, 4).map((source) => normalizeReferenceImage(source, signal)),
    )
  ).filter(Boolean)
  return apiPost(
    '/assistant/images',
    { prompt, size, quality, n: count, referenceImages: normalizedReferences },
    { signal, fallbackMessage: '图片生成失败' },
  )
}

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

export async function createAssistantConversation(title = '新对话') {
  return apiPost('/assistant/conversations', { title }, { fallbackMessage: '新建对话失败' })
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

export async function importAssistantConversations(conversations) {
  return apiPost(
    '/assistant/import',
    { conversations },
    { fallbackMessage: '旧对话迁移失败' },
  )
}

export async function createAssistantRun(input, { signal } = {}) {
  return apiPost('/assistant/runs', input, { signal, fallbackMessage: '任务创建失败' })
}

export async function getAssistantRun(id, { signal } = {}) {
  return apiGet(`/assistant/runs/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: '任务状态读取失败',
  })
}

export async function listActiveAssistantRuns({ signal } = {}) {
  const data = await apiGet('/assistant/runs', { signal, fallbackMessage: '任务状态读取失败' })
  return Array.isArray(data?.runs) ? data.runs : []
}

export async function cancelAssistantRun(id) {
  return apiPost(
    `/assistant/runs/${encodeURIComponent(id)}/cancel`,
    {},
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
