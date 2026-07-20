import { buildApiUrl, proxyWallhavenImageUrl } from '@/services/api'
import { getApiData, getApiErrorMessage, isApiSuccess } from '@/services/apiResponse'
import { getAuthToken, getCsrfToken } from '@/services/auth'
import { clientLogHeaders } from '@/services/clientLogHeaders'

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
const STALE_RUNNING_JOB_MS = 5 * 60 * 1000
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
  const embeddedDataUrl = value.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i)?.[0]
  if (embeddedDataUrl) return embeddedDataUrl
  const embeddedUrl = value.match(
    /https?:\/\/[^\s"'<>)]*\.(?:png|jpe?g|webp|gif)(?:[^\s"'<>)]*)?/i,
  )?.[0]
  if (embeddedUrl) return embeddedUrl
  if (/^(iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)/.test(value)) {
    return `data:image/png;base64,${value}`
  }
  return value
}

export function extractMediaOutput(payload) {
  const data = payload?.data || {}
  const firstChoice = Array.isArray(payload?.choices) ? payload.choices[0] : null
  const firstDataChoice = Array.isArray(data?.choices) ? data.choices[0] : null
  const choiceContent = firstChoice?.message?.content || firstDataChoice?.message?.content || ''
  const candidates = [
    ...(Array.isArray(choiceContent)
      ? choiceContent.map((item) => item?.image_url?.url || item?.url || item?.text || '')
      : [choiceContent]),
    data?.url,
    data?.output,
    data?.output_url,
    data?.result,
    data?.result_url,
    data?.video_url,
    data?.image_url,
    data?.b64_json,
    data?.image?.url,
    data?.image?.image_url,
    data?.image?.b64_json,
    payload?.output,
    payload?.url,
    payload?.result,
    payload?.result_url,
  ]
  const lists = [
    Array.isArray(data) ? data : [],
    Array.isArray(data?.outputs) ? data.outputs : [],
    Array.isArray(data?.output) ? data.output : [],
    Array.isArray(data?.images) ? data.images : [],
    Array.isArray(data?.videos) ? data.videos : [],
    Array.isArray(payload?.outputs) ? payload.outputs : [],
  ]
  for (const list of lists) {
    const first = list[0]
    if (typeof first === 'string') candidates.push(first)
    candidates.push(
      first?.url,
      first?.video_url,
      first?.image_url,
      first?.imageUrl,
      first?.b64_json,
      first?.output,
      first?.result,
    )
    addStructuredMediaCandidates(candidates, first)
  }
  addStructuredMediaCandidates(candidates, payload?.output)
  addStructuredMediaCandidates(candidates, data?.output)
  addStructuredMediaCandidates(candidates, payload?.outputs)
  addStructuredMediaCandidates(candidates, data?.outputs)
  const found = candidates.find((item) => typeof item === 'string' && item.trim())
  return normalizeAiOutput(found)
}

export function extractMediaOutputs(payload) {
  const candidates = []
  const data = payload?.data || {}
  const choiceLists = [
    Array.isArray(payload?.choices) ? payload.choices : [],
    Array.isArray(data?.choices) ? data.choices : [],
  ]
  for (const choices of choiceLists) {
    for (const choice of choices) {
      addStructuredMediaCandidates(candidates, choice?.message?.content)
      addStructuredMediaCandidates(candidates, choice?.image_url)
      addStructuredMediaCandidates(candidates, choice?.url)
      addStructuredMediaCandidates(candidates, choice?.b64_json)
    }
  }
  addStructuredMediaCandidates(candidates, payload)
  return Array.from(
    new Set(
      candidates
        .map((item) => normalizeAiOutput(item))
        .filter(Boolean),
    ),
  )
}

function addStructuredMediaCandidates(candidates, value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return
  if (typeof value === 'string') {
    candidates.push(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => addStructuredMediaCandidates(candidates, item, depth + 1))
    return
  }
  if (typeof value !== 'object') return
  candidates.push(
    value.url,
    value.image_url,
    value.imageUrl,
    value.video_url,
    value.videoUrl,
    value.b64_json,
    value.b64Json,
    value.output_url,
    value.outputUrl,
    value.result_url,
    value.resultUrl,
    value.result,
    value.image?.url,
    value.image?.image_url,
    value.image?.imageUrl,
    value.image?.b64_json,
    value.image?.b64Json,
  )
  addStructuredMediaCandidates(candidates, value.image_url, depth + 1)
  addStructuredMediaCandidates(candidates, value.imageUrl, depth + 1)
  addStructuredMediaCandidates(candidates, value.content, depth + 1)
  addStructuredMediaCandidates(candidates, value.output, depth + 1)
  addStructuredMediaCandidates(candidates, value.outputs, depth + 1)
  addStructuredMediaCandidates(candidates, value.data, depth + 1)
  addStructuredMediaCandidates(candidates, value.images, depth + 1)
  addStructuredMediaCandidates(candidates, value.image_urls, depth + 1)
  addStructuredMediaCandidates(candidates, value.imageUrls, depth + 1)
  addStructuredMediaCandidates(candidates, value.media, depth + 1)
  addStructuredMediaCandidates(candidates, value.files, depth + 1)
  addStructuredMediaCandidates(candidates, value.artifacts, depth + 1)
  addStructuredMediaCandidates(candidates, value.providerPayload, depth + 1)
}

export function getPredictionResultUrl(payload) {
  if (typeof payload?.urls?.get === 'string') return payload.urls.get
  if (typeof payload?.data?.urls?.get === 'string') return payload.data.urls.get
  if (Array.isArray(payload?.data?.urls) && typeof payload.data.urls[0]?.get === 'string') {
    return payload.data.urls[0].get
  }
  if (typeof payload?.data?.result_url === 'string') return payload.data.result_url
  if (typeof payload?.result_url === 'string') return payload.result_url
  return ''
}

export function isWallhavenImageUrl(url) {
  return /(^https?:\/\/)?([a-z0-9-]+\.)?(wallhaven\.cc|whvn\.cc)\//i.test(String(url || ''))
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
  const source = wallpaper.thumbs?.large || wallpaper.thumbnail || getBestWallpaperSource(wallpaper)
  return proxyWallhavenImageUrl(source)
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
    if (/^https?:\/\//i.test(src) && !isWallhavenImageUrl(src)) img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => done({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 })
    img.onerror = () => done({ width: 0, height: 0 })
    img.src = src
  })
}

export async function uploadAiInputFile(
  file,
  { featureKey = 'ai.wallpaperGeneration' } = {},
) {
  if (!file) throw new Error('请先选择一张图片')
  const formData = new FormData()
  formData.append('file', file, file.name || `ai-wallpaper-${Date.now()}.jpg`)
  formData.append('featureKey', String(featureKey || 'ai.wallpaperGeneration'))
  const endpoint = buildApiUrl('/ai-temp-upload')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: clientLogHeaders(),
    body: formData,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !isApiSuccess(payload, response.status)) {
    throw new Error(getApiErrorMessage(payload, `临时上传失败（${response.status}）`))
  }
  const data = getApiData(payload)
  const url = String(data?.url || '').trim()
  if (!url) throw new Error('临时上传未返回可用 URL')
  return url
}

function aiJobHeaders(extraHeaders = {}) {
  const token = getAuthToken()
  const csrfToken = getCsrfToken()
  return clientLogHeaders({
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  })
}

async function readAiJobResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !isApiSuccess(payload, response.status)) {
    const error = new Error(
      getApiErrorMessage(payload, `${fallbackMessage}（${response.status}）`),
    )
    error.responseReceived = true
    error.httpStatus = Number(response.status || 0)
    error.apiCode = String(payload?.code || payload?.error?.code || '')
    error.retryable = payload?.retryable === true
    throw error
  }
  return getApiData(payload)
}

export async function createServerAiJob(payload) {
  const response = await fetch(buildApiUrl('/client/business/ai/jobs'), {
    method: 'POST',
    credentials: 'include',
    headers: aiJobHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload || {}),
  })
  return readAiJobResponse(response, 'AI 任务创建失败')
}

export async function listServerAiJobs(limit = 30, options = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  const kind = String(options.kind || '').trim()
  if (kind) params.set('kind', kind)
  const cursor = String(options.cursor || '').trim()
  if (cursor) params.set('cursor', cursor)
  if (options.excludeFailed) params.set('excludeFailed', '1')
  const response = await fetch(buildApiUrl(`/client/business/ai/jobs?${params.toString()}`), {
    method: 'GET',
    credentials: 'include',
    headers: aiJobHeaders(),
  })
  return readAiJobResponse(response, 'AI 任务读取失败')
}

export async function getServerAiJob(jobId, options = {}) {
  const response = await fetch(
    buildApiUrl(`/client/business/ai/jobs/${encodeURIComponent(jobId)}`),
    {
      method: 'GET',
      credentials: 'include',
      headers: aiJobHeaders(),
      signal: options.signal,
    },
  )
  return readAiJobResponse(response, 'AI 任务状态读取失败')
}

export async function getServerAiJobResult(jobId, options = {}) {
  const response = await fetch(
    buildApiUrl(`/client/business/ai/jobs/${encodeURIComponent(jobId)}/result`),
    {
      method: 'GET',
      credentials: 'include',
      headers: aiJobHeaders(),
      signal: options.signal,
    },
  )
  return readAiJobResponse(response, 'AI 任务结果读取失败')
}

export async function replaceServerAiJobResultWithLocalUpscale(
  jobId,
  file,
  { targetWidth, targetHeight, resolutionScale, signal } = {},
) {
  if (!jobId) throw new Error('AI 任务 ID 无效')
  if (!file) throw new Error('缺少高清图片文件')
  const formData = new FormData()
  formData.append('file', file, file.name || `wallpaper-${Date.now()}.jpg`)
  formData.append('targetWidth', String(Math.max(0, Number(targetWidth || 0))))
  formData.append('targetHeight', String(Math.max(0, Number(targetHeight || 0))))
  formData.append('resolutionScale', String(resolutionScale || ''))
  const response = await fetch(
    buildApiUrl(
      `/client/business/ai/jobs/${encodeURIComponent(jobId)}/result-media/local-upscale`,
    ),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders(),
      body: formData,
      signal,
    },
  )
  return readAiJobResponse(response, '高清结果保存失败')
}

export async function listCloudUpscaleProviders(options = {}) {
  const response = await fetch(buildApiUrl('/client/business/ai/upscale-providers'), {
    method: 'GET',
    credentials: 'include',
    headers: aiJobHeaders(),
    signal: options.signal,
  })
  return readAiJobResponse(response, '云端超清方案读取失败')
}

export async function listServerAiUpscaleExperiments(jobId, options = {}) {
  if (!jobId) throw new Error('AI 任务 ID 无效')
  const response = await fetch(
    buildApiUrl(
      `/client/business/ai/jobs/${encodeURIComponent(jobId)}/upscale-experiments`,
    ),
    {
      method: 'GET',
      credentials: 'include',
      headers: aiJobHeaders(),
      signal: options.signal,
    },
  )
  return readAiJobResponse(response, '云端超清实验读取失败')
}

export async function createServerAiUpscaleExperiment(jobId, input = {}, options = {}) {
  if (!jobId) throw new Error('AI 任务 ID 无效')
  const response = await fetch(
    buildApiUrl(
      `/client/business/ai/jobs/${encodeURIComponent(jobId)}/upscale-experiments`,
    ),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        provider: input.provider,
        target: input.target,
        prompt: input.prompt,
      }),
      signal: options.signal,
    },
  )
  return readAiJobResponse(response, '云端超清实验失败')
}

export async function deleteServerAiJob(jobId) {
  const response = await fetch(
    buildApiUrl(`/client/business/ai/jobs/${encodeURIComponent(jobId)}`),
    {
      method: 'DELETE',
      credentials: 'include',
      headers: aiJobHeaders(),
    },
  )
  return readAiJobResponse(response, 'AI 任务删除失败')
}

export async function runServerAiJob(jobId, options = {}) {
  const response = await fetch(
    buildApiUrl(`/client/business/ai/jobs/${encodeURIComponent(jobId)}/run`),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders(),
      signal: options.signal,
    },
  )
  return readAiJobResponse(response, 'AI 任务执行失败')
}

export async function waitForServerAiJob(
  jobId,
  { onStatus = null, intervalMs = 3000, maxPolls = 100, runInline = false, signal = undefined } = {},
) {
  if (!jobId) throw new Error('AI 任务 ID 无效')
  if (runInline) {
    if (typeof onStatus === 'function') onStatus('正在启动服务端 AI 执行...')
    await runServerAiJob(jobId)
  }

  for (let index = 0; index < maxPolls; index += 1) {
    const response = await getServerAiJob(jobId, { signal })
    const job = response.job || {}
    const status = String(job.status || '').toLowerCase()
    if (typeof onStatus === 'function') {
      onStatus(formatServerAiJobStatus(status))
    }
    if (status === 'completed' || status === 'done') {
      const resultResponse = await getServerAiJobResult(jobId)
      return { job, result: resultResponse.result }
    }
    if (status === 'waiting_provider') {
      await runServerAiJob(jobId).catch(() => null)
    }
    if (status === 'running' && isStaleRunningJob(job)) {
      await runServerAiJob(jobId).catch(() => null)
    }
    if (['failed', 'paused', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(formatServerAiJobTerminalError(status, job.error))
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(500, Number(intervalMs) || 3000)))
  }

  throw new Error('AI 任务等待超时，请稍后在任务列表查看结果')
}

function isStaleRunningJob(job) {
  const updatedAt = Date.parse(job?.updatedAt || job?.updated_at || '')
  if (!Number.isFinite(updatedAt)) return false
  return Date.now() - updatedAt > STALE_RUNNING_JOB_MS
}

function formatServerAiJobTerminalError(status, error) {
  const message = String(error || '').trim()
  if (status === 'paused') {
    if (/provider_timeout|our_fetch_timeout|network connection lost|连接中断|传输中断/i.test(message)) {
      return '图片服务连接超时或中断，任务已安全暂停且不会自动重复提交。请切换模型后重新生成。'
    }
    return message || '图片任务已暂停，系统不会自动重复提交。请切换模型后重新生成。'
  }
  if (status === 'failed') return message || 'AI 任务执行失败'
  return message || 'AI 任务已取消'
}

export async function cancelServerAiJob(jobId) {
  const response = await fetch(
    buildApiUrl(`/client/business/ai/jobs/${encodeURIComponent(jobId)}/cancel`),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders(),
    },
  )
  return readAiJobResponse(response, 'AI 任务取消失败')
}

export async function getClientResourceSummary(options = {}) {
  const scope = String(options.scope || 'usage')
    .trim()
    .toLowerCase()
  const url = new URL(buildApiUrl('/client/business/resources'), window.location.origin)
  if (scope) url.searchParams.set('scope', scope)
  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    // 双保险：即使 API 响应头仍允许缓存，也强制绕过浏览器缓存，保证余额实时。
    cache: 'no-store',
    headers: aiJobHeaders(),
  })
  return readAiJobResponse(response, '资源用量读取失败')
}

export async function getClientReferralSummary() {
  const response = await fetch(buildApiUrl('/client/business/referrals'), {
    method: 'GET',
    credentials: 'include',
    headers: aiJobHeaders(),
  })
  return readAiJobResponse(response, '推荐计划读取失败')
}

export async function redeemClientWalletCode(payload = {}) {
  const response = await fetch(buildApiUrl('/client/business/wallet/redeem'), {
    method: 'POST',
    credentials: 'include',
    headers: aiJobHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return readAiJobResponse(response, '兑换失败')
}

export async function exchangeClientWalletUsd(payload = {}) {
  const response = await fetch(buildApiUrl('/client/business/wallet/exchange'), {
    method: 'POST',
    credentials: 'include',
    headers: aiJobHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return readAiJobResponse(response, '兑换积分失败')
}

export async function getClientCommercePlans() {
  const response = await fetch(buildApiUrl('/client/business/plans'), {
    method: 'GET',
    credentials: 'include',
    headers: aiJobHeaders(),
  })
  return readAiJobResponse(response, '套餐读取失败')
}

export async function getClientPricingPublicModels(options = {}) {
  const includeAvailability = options.includeAvailability === true
  const url = new URL(buildApiUrl('/client/business/pricing/public-models'), window.location.origin)
  if (includeAvailability) {
    url.searchParams.set('availability', '1')
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: aiJobHeaders(),
  })
  return readAiJobResponse(response, '公开模型目录读取失败')
}

export async function getClientPricingSettings() {
  const response = await fetch(buildApiUrl('/client/business/pricing/settings'), {
    method: 'GET',
    credentials: 'include',
    headers: aiJobHeaders(),
  })
  return readAiJobResponse(response, '价格页设置读取失败')
}

export async function getClientCheckoutOrder(id) {
  const response = await fetch(
    buildApiUrl(`/client/business/checkout/orders/${encodeURIComponent(id)}`),
    {
      method: 'GET',
      credentials: 'include',
      headers: aiJobHeaders(),
    },
  )
  return readAiJobResponse(response, '订单读取失败')
}

export async function createClientCheckoutOrder(payload = {}) {
  const response = await fetch(buildApiUrl('/client/business/checkout/orders'), {
    method: 'POST',
    credentials: 'include',
    headers: aiJobHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  })
  return readAiJobResponse(response, '订单创建失败')
}

export async function confirmClientCheckoutOrder(id, payload = {}) {
  const response = await fetch(
    buildApiUrl(`/client/business/checkout/orders/${encodeURIComponent(id)}/confirm`),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(payload),
    },
  )
  return readAiJobResponse(response, '订单确认失败')
}

export async function captureClientPayPalCheckout(id, payload = {}) {
  const response = await fetch(
    buildApiUrl(`/client/business/checkout/orders/${encodeURIComponent(id)}/paypal/capture`),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(payload),
    },
  )
  return readAiJobResponse(response, 'PayPal 扣款失败')
}

export async function cancelClientCheckoutOrder(id) {
  const response = await fetch(
    buildApiUrl(`/client/business/checkout/orders/${encodeURIComponent(id)}/cancel`),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({}),
    },
  )
  return readAiJobResponse(response, '订单取消失败')
}

export async function confirmClientAlipayCheckout(id) {
  const response = await fetch(
    buildApiUrl(`/client/business/checkout/orders/${encodeURIComponent(id)}/alipay/confirm`),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({}),
    },
  )
  return readAiJobResponse(response, '支付宝入账确认失败')
}

export async function listClientApiKeys() {
  const response = await fetch(buildApiUrl('/client/business/api-keys'), {
    method: 'GET',
    credentials: 'include',
    headers: aiJobHeaders(),
  })
  return readAiJobResponse(response, 'API Key 读取失败')
}

export async function createClientApiKey(payload = {}) {
  const response = await fetch(buildApiUrl('/client/business/api-keys'), {
    method: 'POST',
    credentials: 'include',
    headers: aiJobHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  })
  return readAiJobResponse(response, 'API Key 创建失败')
}

export async function updateClientApiKey(id, payload = {}) {
  const response = await fetch(buildApiUrl(`/client/business/api-keys/${encodeURIComponent(id)}`), {
    method: 'PUT',
    credentials: 'include',
    headers: aiJobHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  })
  return readAiJobResponse(response, 'API Key 保存失败')
}

export async function resetClientApiKey(id) {
  const response = await fetch(
    buildApiUrl(`/client/business/api-keys/${encodeURIComponent(id)}/reset`),
    {
      method: 'POST',
      credentials: 'include',
      headers: aiJobHeaders(),
    },
  )
  return readAiJobResponse(response, 'API Key 重置失败')
}

export async function revokeClientApiKey(id) {
  const response = await fetch(buildApiUrl(`/client/business/api-keys/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'include',
    headers: aiJobHeaders(),
  })
  return readAiJobResponse(response, 'API Key 注销失败')
}

function formatServerAiJobStatus(status) {
  if (status === 'running') return '云端 AI 正在执行...'
  if (status === 'queued') return '云端 AI 排队中...'
  if (status === 'waiting_provider') return '云端 AI 正在处理结果...'
  if (status === 'completed' || status === 'done') return '云端 AI 已完成，正在读取结果...'
  if (status === 'failed') return '云端 AI 执行失败'
  if (status === 'paused') return '云端 AI 已安全暂停'
  if (status === 'cancelled' || status === 'canceled') return '云端 AI 已取消'
  return '正在同步云端 AI 状态...'
}
