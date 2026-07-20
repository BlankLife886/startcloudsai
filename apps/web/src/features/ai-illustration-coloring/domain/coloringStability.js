export const COMPLETED_WITHOUT_OUTPUT_ERROR = '服务商已标记完成，但未返回可用结果图，请重试原任务'

export const COLORING_ERROR_TEXT_MAX_LENGTH = 120

const COLORING_INTERNAL_DIAGNOSTIC_PATTERN =
  /(?:^|[;\s])(?:stage|endpoint|requestId|providerStatus|providerMessage|providerCode|bodyPreview|keys|dataKeys|outputCandidates|resultUrlHost)=/i

export function isAiTempSourceUrl(url = '') {
  return /\/(?:api\/)?ai-temp\//i.test(String(url || ''))
}

export function coloringRetryMayCreatePaidRequest(item = {}) {
  const status = String(item?.status || '')
    .trim()
    .toLowerCase()
  return (
    Boolean(String(item?.serverJobId || '').trim()) &&
    item?.statusConfidence !== 'client-validation' &&
    ['failed', 'cancelled', 'canceled'].includes(status)
  )
}

export function isColoringCreateOutcomeUnknown(error) {
  if (error?.responseReceived !== true) return true
  if (error?.retryable === true) return true
  if (String(error?.apiCode || '') === 'idempotency_request_pending') return true
  const status = Number(error?.httpStatus || 0)
  return status >= 500 || [408, 425, 429].includes(status)
}

export function shouldReplayUnknownColoringCreate(item = {}) {
  return (
    !String(item?.serverJobId || '').trim() &&
    String(item?.clientRequestId || '').trim() &&
    String(item?.statusConfidence || '').trim() === 'create-response-unknown' &&
    item?.createRequest &&
    typeof item.createRequest === 'object'
  )
}

export function formatColoringErrorText(value = '', maxLength = COLORING_ERROR_TEXT_MAX_LENGTH) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  const limit = Math.max(1, Number(maxLength) || COLORING_ERROR_TEXT_MAX_LENGTH)
  if (!text) return ''

  const bodyPreviewError = readBodyPreviewError(text)
  const mappedMessage = mapColoringProviderError(bodyPreviewError || text)
  if (mappedMessage) return truncateColoringErrorText(mappedMessage, limit)

  if (bodyPreviewError) {
    return '上游处理失败，请稍后重试'
  }

  if (COLORING_INTERNAL_DIAGNOSTIC_PATTERN.test(text) || /https?:\/\//i.test(text)) {
    return '生图服务处理失败，请稍后重试'
  }

  return truncateColoringErrorText(text, limit)
}

function readBodyPreviewError(text = '') {
  const marker = 'bodyPreview='
  const markerIndex = text.indexOf(marker)
  if (markerIndex < 0) return ''
  const preview = text.slice(markerIndex + marker.length).trim()
  if (!preview) return ''

  try {
    const payload = JSON.parse(preview)
    const structuredError = readStructuredProviderError(payload)
    if (structuredError) return structuredError
  } catch {
    // Runner diagnostics are length-capped, so bodyPreview may be truncated JSON.
  }

  const patterns = [
    /"data"\s*:\s*\{[\s\S]*?"error"\s*:\s*"((?:\\.|[^"\\])*)"/i,
    /"error"\s*:\s*\{[\s\S]*?"message"\s*:\s*"((?:\\.|[^"\\])*)"/i,
    /"error"\s*:\s*"((?:\\.|[^"\\])*)"/i,
  ]
  for (const pattern of patterns) {
    const match = preview.match(pattern)
    if (match?.[1]) return decodeJsonStringFragment(match[1])
  }
  return ''
}

function readStructuredProviderError(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const data = payload.data && typeof payload.data === 'object' ? payload.data : null
  const candidates = [data?.error, payload.error, data?.message]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (candidate && typeof candidate === 'object') {
      const message = String(candidate.message || '').trim()
      if (message) return message
    }
  }
  return ''
}

function decodeJsonStringFragment(value = '') {
  try {
    return String(JSON.parse(`"${value}"`) || '').trim()
  } catch {
    return String(value || '')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim()
  }
}

function mapColoringProviderError(value = '') {
  const text = String(value || '').trim()
  const normalized = text.toLowerCase()
  if (!normalized) return ''

  if (
    /image fetch failed|remote url rejected|file upload api|failed to (?:fetch|download|load).*(?:image|url)|unable to (?:fetch|download|load).*(?:image|url)/i.test(
      text,
    )
  ) {
    return '上游无法读取源图，请重新上传后重试'
  }
  if (
    /file type not supported|unsupported.*(?:file|image).*(?:type|format)|invalid image format/i.test(
      text,
    )
  ) {
    return '上游不支持当前图片格式，请转换为 PNG、JPEG 或 WebP 后重试'
  }
  if (
    /aspect[_ -]?ratio.*(?:not within|invalid|unsupported|allowed)|(?:invalid|unsupported).*aspect[_ -]?ratio/i.test(
      text,
    )
  ) {
    return '上游不支持当前图片比例，请调整输出尺寸后重试'
  }
  if (
    /network connection lost|connection (?:lost|reset|closed)|provider_network_lost|上游或中间网关连接中断/i.test(
      text,
    )
  ) {
    return '上游连接中断，暂未收到最终图片，请稍后查看任务状态'
  }
  if (
    /未返回图片|没有可识别.*图片|no (?:image|media).*(?:output|result)|empty response|parse_media_output/i.test(
      text,
    )
  ) {
    return '服务商未返回可用结果图，请重试'
  }
  if (/404 page not found|provider_http_error[\s\S]*http=404/i.test(text)) {
    return '当前生图模型接口不可用，请稍后再试'
  }
  if (
    /unauthorized|forbidden|invalid[_\s-]?api[_\s-]?key|quota|balance|billing|insufficient|rate.?limit/i.test(
      text,
    )
  ) {
    return '生图服务暂不可用，请稍后再试'
  }
  return ''
}

function truncateColoringErrorText(text, limit) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trimEnd()}…`
}

export function isUsableColoringImageMeta(meta = {}) {
  const type = String(meta?.type || '')
    .trim()
    .toLowerCase()
  const width = Number(meta?.width || 0)
  const height = Number(meta?.height || 0)
  const bytes = Number(meta?.bytes || 0)
  const hasDimensions = width > 0 && height > 0
  return hasDimensions || (type.startsWith('image/') && bytes > 0)
}

export async function validateReusableAiTempImageUrl(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {},
) {
  const candidate = String(url || '').trim()
  if (!candidate || !isAiTempSourceUrl(candidate) || typeof fetchImpl !== 'function') return false

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 4000
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null
  try {
    const response = await fetchImpl(candidate, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
      ...(controller ? { signal: controller.signal } : {}),
    })
    if (!response?.ok) return false
    const contentType = String(response.headers?.get?.('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    return contentType.startsWith('image/')
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function isLocalImageSource(url = '') {
  const candidate = String(url || '').trim()
  return candidate.startsWith('blob:') || /^data:image\//i.test(candidate)
}

/**
 * Resolve an ai-temp URL without ever returning an expired URL to the caller.
 * Reference images restored from history may still have a local object URL or
 * persisted data-URL thumbnail; those are the only safe recovery inputs here.
 */
export async function resolveReusableAiTempImageUrl(
  remoteUrl,
  {
    recoveryCandidates = [],
    validateUrl = validateReusableAiTempImageUrl,
    reuploadLocalSource,
  } = {},
) {
  const candidate = String(remoteUrl || '').trim()
  if (!candidate || !isAiTempSourceUrl(candidate)) {
    return { url: '', reused: false, recovered: false, expired: false }
  }

  if (await validateUrl(candidate)) {
    return { url: candidate, reused: true, recovered: false, expired: false }
  }

  const localSources = Array.from(
    new Set(
      (Array.isArray(recoveryCandidates) ? recoveryCandidates : [])
        .map((item) => String(item || '').trim())
        .filter((item) => item && item !== candidate && isLocalImageSource(item)),
    ),
  )
  if (typeof reuploadLocalSource === 'function') {
    for (const localSource of localSources) {
      try {
        const uploaded = String((await reuploadLocalSource(localSource)) || '').trim()
        if (uploaded && !uploaded.startsWith('blob:') && isAiTempSourceUrl(uploaded)) {
          return { url: uploaded, reused: false, recovered: true, expired: true }
        }
      } catch {
        // Try the next local representation (for example, a persisted thumbnail).
      }
    }
  }

  return { url: '', reused: false, recovered: false, expired: true }
}
