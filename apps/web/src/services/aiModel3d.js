import {
  createServerAiJob,
  getServerAiJob,
  getServerAiJobResult,
  runServerAiJob,
} from '@/services/aiWallpaper'
import {
  blobToDataUrl,
  compressBlobToLimit,
  fetchImageBlobForAi,
  uploadAiTempBlob,
} from '@/components/wallpaper/fullscreen-preview/features/ai/aiImageIO'

const MODEL_STATUS_DONE = new Set(['completed', 'done'])
const MODEL_STATUS_FAILED = new Set(['failed', 'cancelled', 'canceled'])

export function buildTripoImageTo3dRequest({
  imageUrl,
  model = 'tripo3d-v2.5',
  quality = 'standard',
  format = 'glb',
  texture = true,
  pbr = true,
  targetPolycount = 'auto',
  textureQuality = '',
  faceLimit = '',
  quadMesh = false,
  textureAlignment = 'original_image',
  orientation = 'default',
  autoSize = false,
  seed = '',
  textureSeed = '',
}) {
  const resolvedTexture =
    textureQuality || (!texture ? 'no' : quality === 'high' ? 'HD' : 'standard')
  const resolvedFaceLimit = resolveFaceLimit(faceLimit || targetPolycount)
  const outputFormat = quadMesh ? 'fbx' : format || 'glb'
  return {
    label: `${model || 'Tripo3D'} Image to 3D`,
    endpoint: '/api/v3/tripo3d/tripo3d-v2.5/image-to-3d',
    fallbackEndpoints: ['/api/v3/tripo3d/v2.5/image-to-3d'],
    outputType: 'model',
    pollResult: true,
    body: {
      model: model || 'tripo3d-v2.5',
      image: imageUrl,
      image_url: imageUrl,
      model_type: quality === 'fast' ? 'lowpoly' : 'standard',
      texture: resolvedTexture,
      texture_quality: resolvedTexture,
      texture_alignment: textureAlignment || 'original_image',
      pbr: Boolean(pbr),
      enable_pbr: Boolean(pbr),
      quad: Boolean(quadMesh),
      should_texture: resolvedTexture !== 'no',
      should_remesh: Boolean(quadMesh || resolvedFaceLimit),
      topology: quadMesh ? 'quad' : 'triangle',
      face_limit: resolvedFaceLimit || undefined,
      target_polycount: resolvedFaceLimit || undefined,
      auto_size: Boolean(autoSize),
      orientation: orientation || 'default',
      symmetry_mode: 'auto',
      seed: normalizeOptionalInteger(seed),
      texture_seed: normalizeOptionalInteger(textureSeed),
      hd_texture: resolvedTexture === 'HD',
      texture_prompt:
        resolvedTexture === 'HD'
          ? 'high quality detailed PBR texture, sharp material details, clean UV texture'
          : 'clean aligned texture, faithful colors',
      negative_prompt:
        'blurred, broken geometry, melted surface, noisy texture, duplicated limbs, warped shape, low detail',
      target_formats: [outputFormat],
      output_format: outputFormat,
    },
  }
}

function resolveFaceLimit(value) {
  if (!value || value === 'auto') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.max(1000, Math.min(Math.round(parsed), 300000))
}

function normalizeOptionalInteger(value) {
  if (value === '' || value === null || value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.min(Math.round(parsed), 2147483647))
}

export function extractModelTaskResult(result) {
  const payload = result?.output?.output ?? result?.output ?? result?.result ?? result
  if (payload?.type === 'model') return payload
  if (payload?.providerPayload) return extractModelTaskResult(payload.providerPayload)
  if (payload?.modelUrls || payload?.model_urls) {
    return {
      type: 'model',
      modelUrls: payload.modelUrls || payload.model_urls || {},
      textureUrls: payload.textureUrls || payload.texture_urls || {},
      thumbnailUrl: payload.thumbnailUrl || payload.thumbnail_url || '',
    }
  }
  return null
}

export async function createImageTo3dJob({
  imageUrl,
  loadImageFromSrc,
  provider = 'gptproto',
  model = 'tripo3d-v2.5',
  maxUploadMb = 10,
  quality,
  format,
  texture,
  pbr,
  targetPolycount,
  textureQuality,
  faceLimit,
  quadMesh,
  textureAlignment,
  orientation,
  autoSize,
  seed,
  textureSeed,
  cropMode = 'subject',
  onStatus = null,
}) {
  const sourceUrl = String(imageUrl || '').trim()
  if (!sourceUrl) throw new Error('当前预览图不可用，无法创建模型任务')
  const publicImageUrl = await prepareImageTo3dInputUrl({
    sourceUrl,
    loadImageFromSrc,
    cropMode,
    maxUploadMb,
    onStatus,
  })

  onStatus?.('正在创建图转模型任务...')
  const response = await createServerAiJob({
    kind: 'image-to-3d',
    prompt: 'Convert the source image into a textured 3D model.',
    input: {
      source: 'fullscreen-preview',
      imageUrl: publicImageUrl,
      sourceUrl,
      originalImageUrl: sourceUrl,
      quality,
      format,
      texture,
      pbr,
      targetPolycount,
      textureQuality,
      faceLimit,
      quadMesh,
      textureAlignment,
      orientation,
      autoSize,
      seed,
      textureSeed,
      cropMode,
    },
    params: {
      providerHint: provider,
      modelHint: model,
      imageUrl: publicImageUrl,
      originalImageUrl: sourceUrl,
      options: {
        quality,
        format,
        texture,
        pbr,
        targetPolycount,
        textureQuality,
        faceLimit,
        quadMesh,
        textureAlignment,
        orientation,
        autoSize,
        seed,
        textureSeed,
        cropMode,
      },
    },
    estimatedCostUsd: 0,
    units: 1,
  })

  const jobId = response?.job?.id
  if (!jobId) throw new Error('模型任务创建失败：服务端未返回任务 ID')
  onStatus?.('模型任务已创建，正在排队生成...')
  return response.job
}

export async function prepareImageTo3dInputUrl({
  sourceUrl,
  loadImageFromSrc,
  cropMode = 'subject',
  maxUploadMb = 10,
  onStatus = null,
}) {
  const raw = String(sourceUrl || '').trim()
  if (!raw) throw new Error('当前预览图不可用，无法准备模型输入')

  const maxBytes = Math.max(1, Number(maxUploadMb) || 10) * 1024 * 1024
  onStatus?.('正在准备模型输入图...')

  if (/^https?:\/\//i.test(raw)) {
    try {
      const input = await fetchImageBlobForAi(raw)
      return await materializePreparedBlob({
        blob: input.blob,
        loadImageFromSrc,
        cropMode,
        onStatus,
        maxBytes,
      })
    } catch (error) {
      if (isCompressionLimitError(error)) throw error
      return raw
    }
  }

  if (raw.startsWith('data:image/')) {
    const blob = await dataUrlToBlob(raw)
    return materializePreparedBlob({ blob, loadImageFromSrc, cropMode, onStatus, maxBytes })
  }

  if (raw.startsWith('blob:')) {
    const response = await fetch(raw)
    if (!response.ok) throw new Error(`本地预览图读取失败（${response.status}）`)
    const blob = await response.blob()
    return materializePreparedBlob({ blob, loadImageFromSrc, cropMode, onStatus, maxBytes })
  }

  const absoluteUrl =
    typeof window !== 'undefined' ? new URL(raw, window.location.origin).toString() : raw
  return prepareImageTo3dInputUrl({ sourceUrl: absoluteUrl, loadImageFromSrc, cropMode, maxUploadMb, onStatus })
}

async function materializePreparedBlob({ blob, loadImageFromSrc, cropMode, onStatus, maxBytes }) {
  if (!blob?.size) throw new Error('模型输入图为空')
  const inputBlob = await cropModelInputBlob({ blob, cropMode, loadImageFromSrc, onStatus })
  onStatus?.('正在转码模型输入图...')
  const prepared =
    inputBlob.size > maxBytes
      ? await compressBlobToLimit({
          blob: inputBlob,
          loadImageFromSrc,
          maxBytes: maxBytes * 0.95,
        })
      : inputBlob
  if (!prepared?.size) throw new Error('模型输入图处理失败')
  if (prepared.size > maxBytes) {
    throw new Error(`图片超过 ${formatMaxUploadMb(maxBytes)}MB，压缩后仍无法上传`)
  }
  try {
    onStatus?.('正在上传模型输入图...')
    const tempUrl = await uploadAiTempBlob(prepared, {
      featureKey: 'ai.imageToModel',
    })
    if (!isLocalhostUrl(tempUrl)) return tempUrl
  } catch {
    // 本地开发或 R2 未配置时，继续尝试 dataURL。部分 GPTProto 图像接口支持内联图片。
  }
  return await blobToDataUrl(prepared)
}

function formatMaxUploadMb(maxBytes) {
  return Number((maxBytes / 1024 / 1024).toFixed(1)).toString()
}

function isCompressionLimitError(error) {
  return error instanceof Error && error.message.includes('压缩后仍无法上传')
}

async function cropModelInputBlob({ blob, cropMode, loadImageFromSrc, onStatus }) {
  const mode = String(cropMode || 'full')
  if (mode === 'full') return blob
  if (typeof document === 'undefined') return blob
  if (typeof loadImageFromSrc !== 'function') return blob

  const imageUrl = URL.createObjectURL(blob)
  try {
    const img = await loadImageFromSrc(imageUrl)
    if (!img?.naturalWidth || !img?.naturalHeight) return blob
    const crop = getModelInputCropRect(img.naturalWidth, img.naturalHeight, mode)
    if (!crop) return blob
    onStatus?.('正在裁剪模型主体输入图...')
    const canvas = document.createElement('canvas')
    canvas.width = crop.width
    canvas.height = crop.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const cropped = await canvasToBlob(canvas, blob.type || 'image/jpeg', 0.94)
    return cropped || blob
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

function getModelInputCropRect(width, height, mode) {
  const safe = (x, y, w, h) => ({
    x: Math.max(0, Math.round(x * width)),
    y: Math.max(0, Math.round(y * height)),
    width: Math.min(width, Math.round(w * width)),
    height: Math.min(height, Math.round(h * height)),
  })
  if (mode === 'subject') {
    return safe(0.16, 0.02, 0.64, 0.96)
  }
  if (mode === 'upper_body') {
    return safe(0.24, 0.02, 0.54, 0.48)
  }
  if (mode === 'head') {
    return safe(0.34, 0.02, 0.34, 0.26)
  }
  return null
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.94) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

function isLocalhostUrl(url) {
  try {
    const parsed = new URL(String(url || ''))
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = String(dataUrl || '').split(',')
  if (!body) throw new Error('图片 dataURL 无效')
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mime })
}

export async function waitForImageTo3dJob(
  jobId,
  { onStatus = null, intervalMs = 3500, maxPolls = 100, signal = null } = {},
) {
  for (let index = 0; index < maxPolls; index += 1) {
    if (signal?.aborted) throw createAbortError()
    const response = await getServerAiJob(jobId, { signal })
    const job = response.job || {}
    const status = String(job.status || '').toLowerCase()
    onStatus?.(formatImageTo3dStatus(status, job.providerStatus))
    if (MODEL_STATUS_DONE.has(status)) {
      const resultResponse = await getServerAiJobResult(jobId, { signal })
      const model = extractModelTaskResult(resultResponse.result)
      if (!model?.modelUrls || !Object.keys(model.modelUrls).length) {
        throw new Error('模型任务已完成，但没有返回可下载模型文件')
      }
      return { job, model }
    }
    if (status === 'waiting_provider') {
      await runServerAiJob(jobId, { signal }).catch((error) => {
        if (signal?.aborted) throw error
        return null
      })
    }
    if (MODEL_STATUS_FAILED.has(status)) {
      throw new Error(job.error || '图转模型任务失败')
    }
    await waitForPollDelay(Math.max(800, Number(intervalMs) || 3500), signal)
  }
  throw new Error('图转模型等待超时，请稍后重试')
}

function waitForPollDelay(delayMs, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, delayMs))
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function createAbortError() {
  return new DOMException('模型任务状态同步已取消', 'AbortError')
}

function formatImageTo3dStatus(status, providerStatus = '') {
  const providerText = providerStatus ? `（${providerStatus}）` : ''
  if (status === 'queued') return '模型任务排队中...'
  if (status === 'running') return `模型正在生成${providerText}...`
  if (status === 'waiting_provider') return `云端仍在处理${providerText}...`
  if (status === 'completed' || status === 'done') return '模型已生成，正在读取文件...'
  if (status === 'failed') return '模型生成失败'
  return '正在同步模型任务状态...'
}
