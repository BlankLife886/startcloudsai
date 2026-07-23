import { ApiError, apiPost, buildApiPath } from './apiClient'

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
