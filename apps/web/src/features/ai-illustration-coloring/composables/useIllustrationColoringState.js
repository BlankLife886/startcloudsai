import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import notificationService from '@/services/notification'
import { createStudioBudgetGuard } from '@/features/ai-shared/studioBudgetGuard'
import { enrichStudioCreditCostSnapshot } from '@/features/ai-shared/studioUsage'
import { useInsufficientCreditsPrompt } from '@/composables/useInsufficientCreditsPrompt'
import { recordAiUsage } from '@/services/aiUsageLedger'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import {
  fetchImageBlobForAi,
  uploadAiTempBlob,
} from '@/features/ai-shared/aiImageIO'
import { pickPreviewSourceImageUrl } from '@/features/ai-shared/aiSourcePicker'
import { normalizeImageOutput } from '@/features/ai-shared/aiPreviewUtils'
import {
  cancelServerAiJob,
  deleteServerAiJob,
  getServerAiJob,
  getServerAiJobResult,
  listServerAiJobs,
  loadImageSize,
  runServerAiJob,
} from '@/services/aiWallpaper'
import { wallpaperApi } from '@/services/api'
import { buildApiUrl } from '@/services/apiBase'
import { resolveAuthenticatedMediaUrl } from '@/services/authenticatedMedia'
import { extractServerJobOutputs } from '@/features/ai-wallpaper/domain/mapServerJobToTask'
import {
  isActiveColoringJobStatus,
  isConfirmedColoringJobCancellation,
  hydrateColoringHistoryItem,
  isColoringJobKind,
  isTerminalColoringJobStatus,
  mapColoringJobToHistory,
} from '@/features/ai-illustration-coloring/domain/mapColoringJobToHistory'
import { prepareColoringUploadBlob } from '@/features/ai-illustration-coloring/domain/prepareColoringUpload'
import {
  coloringRetryMayCreatePaidRequest,
  COMPLETED_WITHOUT_OUTPUT_ERROR,
  formatColoringErrorText,
  isColoringCreateOutcomeUnknown,
  isAiTempSourceUrl,
  isUsableColoringImageMeta,
  resolveReusableAiTempImageUrl,
  shouldReplayUnknownColoringCreate,
  validateReusableAiTempImageUrl,
} from '@/features/ai-illustration-coloring/domain/coloringStability'
import {
  COLORING_OUTPUT_SIZE_OPTIONS,
  formatBytes,
  ILLUSTRATION_COLORING_HISTORY_LIMIT,
  ILLUSTRATION_COLORING_VISIBLE_HISTORY_LIMIT,
  markColoringJobDeleted,
  mergeColoringHistory,
  readColoringDraft,
  readColoringHistory,
  readColoringSettings,
  resolveColoringOutputOrientation,
  resolveOutputPixelSize,
  writeColoringDraft,
  writeColoringHistory,
  writeColoringSettings,
} from '@/services/aiIllustrationColoringState'
import {
  COLORING_JOB_POLL_INTERVAL_MS,
  createIllustrationColoringJob,
  findColoringStylePreset,
  ILLUSTRATION_COLORING_FEATURE_KEY,
  ILLUSTRATION_COLORING_PUBLIC_MODEL,
  resolveColoringStyleCatalog,
} from '@/services/aiIllustrationColoring'
import { submitShareItem } from '@/services/shareGallery'

const SERVER_JOB_POLL_INTERVAL_MS = COLORING_JOB_POLL_INTERVAL_MS
const MAX_REFERENCE_IMAGES = 4
const notifiedTerminalJobs = new Set()

function sanitizeColoringHistoryError(item) {
  if (!item || typeof item !== 'object' || !Object.prototype.hasOwnProperty.call(item, 'error')) {
    return item
  }
  const safeError = formatColoringErrorText(item.error || '')
  return safeError === item.error ? item : { ...item, error: safeError }
}

function formatJobStatus(status = '') {
  return (
    {
      queued: '排队中',
      running: 'AI 染色中',
      waiting_provider: '等待模型结果',
      completed: '已完成',
      done: '已完成',
      failed: '失败',
      cancelled: '已取消',
      canceled: '已取消',
      paused: '已暂停，需手动恢复',
    }[
      String(status || '')
        .trim()
        .toLowerCase()
    ] || '处理中'
  )
}

function isRunningStatus(status = '') {
  return isActiveColoringJobStatus(status)
}

function isPausedStatus(status = '') {
  return (
    String(status || '')
      .trim()
      .toLowerCase() === 'paused'
  )
}

function isFailedOrCancelledHistoryStatus(status = '') {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  return value === 'failed' || value === 'cancelled' || value === 'canceled'
}

function createReferenceImageId() {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatHistoryTime(value) {
  const time = typeof value === 'number' ? value : Date.parse(String(value || ''))
  if (!Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  if (sameDay) return `今天 ${hh}:${mm}`
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day} ${hh}:${mm}`
}

export function useIllustrationColoringState() {
  const router = useRouter()
  const authStore = useAuthStore()
  const settingsStore = useSettingsStore()
  const runtimeConfigStore = useRuntimeConfigStore()

  const styleId = ref('watercolor')
  const workTitle = ref('')
  const customPrompt = ref('')
  const sourcePreview = ref('')
  const sourceName = ref('')
  const sourceBlobUrl = ref('')
  const sourceRemoteUrl = ref('')
  const sourceThumbUrl = ref('')
  const referenceImages = ref([])
  const resultUrl = ref('')
  const statusText = ref('')
  const elapsedNow = ref(Date.now())
  const submitting = ref(false)
  const newTaskMode = ref(false)
  const uploadDragOver = ref(false)
  const favoritePickerOpen = ref(false)
  // 用户对比偏好：result=单图看结果，split=左右并排。展示层可临时并排，但不改写此偏好。
  const compareMode = ref('result')
  const comparePreferenceReady = ref(false)
  const costConfirmOpen = ref(false)
  const pendingCost = ref(null)
  const historyItems = ref([])
  const activeHistoryId = ref('')
  const sourceUploading = ref(false)
  const pageReady = ref(false)
  const settings = ref(readColoringSettings())
  const settingsOpen = ref(false)
  const debugOpen = ref(false)
  const submittingShare = ref(false)
  const sourceMeta = ref({ width: 0, height: 0, bytes: 0, type: '' })
  const originalSourceMeta = ref({ width: 0, height: 0, bytes: 0, type: '' })
  const revealResult = ref(false)
  const selectedModelKey = ref(String(settings.value.publicModelKey || ''))

  let costConfirmResolver = null
  let persistDraftTimer = null
  let persistHistoryTimer = null
  let inspectSourceToken = 0
  let sourceRevision = 0
  let sourceRemoteRevision = 0
  let sourceUploadToken = 0
  let sourceUploadPromise = null
  let sourceUploadPromiseRevision = 0
  let refreshJobsTimer = 0
  let refreshingJobs = false
  let disposed = false
  let historyMutationVersion = 0
  let elapsedTimer = 0
  const serverJobPollers = new Map()
  const serverJobPollInFlight = new Set()
  const serverJobPollGeneration = new Map()
  const sessionStartedJobs = new Set()
  // 轮询请求统一挂在该控制器上，组件卸载时 abort，避免残留请求回写状态
  const pollAbortController = new AbortController()

  const featureConfig = computed(() => ({
    ...(runtimeConfigStore.getFeatureConfig(ILLUSTRATION_COLORING_FEATURE_KEY) || {}),
    aiModelCatalog: runtimeConfigStore.getAiModelCatalog(),
  }))

  const coloringStyleCatalog = computed(() =>
    resolveColoringStyleCatalog(featureConfig.value?.config?.styleCatalog),
  )
  const COLORING_STYLE_CATEGORIES = computed(() => coloringStyleCatalog.value.categories)
  const COLORING_STYLE_PRESETS = computed(() => coloringStyleCatalog.value.styles)

  const disabledMessage = computed(() => {
    if (runtimeConfigStore.isBlocked) return runtimeConfigStore.blockReason
    if (!runtimeConfigStore.canUse(ILLUSTRATION_COLORING_FEATURE_KEY)) {
      return (
        runtimeConfigStore.getFeatureConfig(ILLUSTRATION_COLORING_FEATURE_KEY)?.config?.message ||
        '插画染色功能暂未开放'
      )
    }
    return ''
  })

  const maxUploadMb = computed(() => Number(featureConfig.value?.config?.maxUploadMb || 10))

  const publicModels = computed(() => featureConfig.value?.config?.publicModels || [])

  const selectedPublicModel = computed(() => {
    const models = publicModels.value
    const preferred = String(settings.value.publicModelKey || selectedModelKey.value || '').trim()
    if (preferred) {
      const matched = models.find(
        (item) => String(item.publicModelKey || item.id || '') === preferred,
      )
      if (matched) return matched
      // Prefer an available model over a stale settings key (e.g. disabled
      // provider assignment). Only keep a ghost when the list is still empty.
      if (!models.length) {
        return {
          publicModelKey: preferred,
          id: preferred,
          label: preferred,
        }
      }
    }
    return (
      models.find((item) => item.publicModelKey === ILLUSTRATION_COLORING_PUBLIC_MODEL) ||
      models.find((item) => item.isDefault || item.metadata?.isDefault) ||
      models[0] ||
      null
    )
  })

  const resolvedPublicModelKey = computed(() => {
    const fromSelected = String(
      selectedPublicModel.value?.publicModelKey || selectedPublicModel.value?.id || '',
    ).trim()
    if (fromSelected) return fromSelected
    return String(
      settings.value.publicModelKey || selectedModelKey.value || ILLUSTRATION_COLORING_PUBLIC_MODEL,
    ).trim()
  })

  const sourceInfoText = computed(() => {
    const { width, height, bytes, type } = sourceMeta.value
    const parts = []
    if (width && height) parts.push(`${width}×${height}`)
    if (bytes > 0) parts.push(formatBytes(bytes))
    const format = String(type || '')
      .toLowerCase()
      .replace(/^image\//, '')
      .replace('jpeg', 'jpg')
      .toUpperCase()
    if (format) parts.push(format)
    return parts.join(' · ')
  })

  const canvasAspectRatio = computed(() => {
    const w = Number(sourceMeta.value.width || 0)
    const h = Number(sourceMeta.value.height || 0)
    if (w > 0 && h > 0) return `${w} / ${h}`
    return '1 / 1'
  })

  const imageOrientation = computed(() => {
    const w = Number(sourceMeta.value.width || 0)
    const h = Number(sourceMeta.value.height || 0)
    if (!w || !h) return 'square'
    const ratio = w / h
    if (ratio < 0.92) return 'portrait'
    if (ratio > 1.08) return 'landscape'
    return 'square'
  })

  const frameAspectStyle = computed(() => {
    const w = Math.max(1, Number(sourceMeta.value.width || 1))
    const h = Math.max(1, Number(sourceMeta.value.height || 1))
    const ratio = w / h
    return {
      '--frame-aspect': `${w} / ${h}`,
      '--frame-ratio': String(ratio),
    }
  })

  const outputSizePreview = computed(() =>
    resolveOutputPixelSize(
      sourceMeta.value.width || 1024,
      sourceMeta.value.height || 1024,
      settings.value.outputSize,
      settings.value.outputOrientation,
    ),
  )

  const outputOrientation = computed(() =>
    resolveColoringOutputOrientation(
      sourceMeta.value.width || 1,
      sourceMeta.value.height || 1,
      settings.value.outputOrientation,
    ),
  )

  const budgetGuard = createStudioBudgetGuard({
    settingsStore,
    getPublicModels: () => publicModels.value,
    getFeatureConfig: () => featureConfig.value,
    featureKey: ILLUSTRATION_COLORING_FEATURE_KEY,
  })
  const creditsPrompt = useInsufficientCreditsPrompt()

  const creditCost = computed(() => budgetGuard.getModelUnitCost(resolvedPublicModelKey.value))
  const generationCount = computed(() =>
    Math.max(1, Math.min(5, Math.round(Number(settings.value.generationCount || 1)))),
  )
  const totalCreditCost = computed(() => Number(creditCost.value || 0) * generationCount.value)

  const activeHistoryItem = computed(
    () => historyItems.value.find((item) => item.id === activeHistoryId.value) || null,
  )

  const debugInfo = computed(() => {
    const item = activeHistoryItem.value
    if (item) {
      return {
        publicModelKey: item.publicModelKey || resolvedPublicModelKey.value,
        originalWidth: item.originalWidth || originalSourceMeta.value.width || 0,
        originalHeight: item.originalHeight || originalSourceMeta.value.height || 0,
        originalBytes: item.originalBytes || originalSourceMeta.value.bytes || 0,
        originalType: item.originalType || originalSourceMeta.value.type || '',
        inputWidth: item.inputWidth || item.sourceWidth || sourceMeta.value.width || 0,
        inputHeight: item.inputHeight || item.sourceHeight || sourceMeta.value.height || 0,
        inputBytes: item.inputBytes || item.sourceBytes || sourceMeta.value.bytes || 0,
        inputType: item.inputType || sourceMeta.value.type || '',
        outputSize: item.outputSize || settings.value.outputSize,
        requestedOutputWidth: item.requestedOutputWidth || 0,
        requestedOutputHeight: item.requestedOutputHeight || 0,
        resultWidth: item.resultWidth || 0,
        resultHeight: item.resultHeight || 0,
        resultBytes: item.resultBytes || 0,
        resultType: item.resultType || '',
        outputSizeMatched: item.outputSizeMatched,
        outputSizeWarning: item.outputSizeWarning || '',
      }
    }
    const requested = outputSizePreview.value
    return {
      publicModelKey: resolvedPublicModelKey.value,
      originalWidth: originalSourceMeta.value.width || 0,
      originalHeight: originalSourceMeta.value.height || 0,
      originalBytes: originalSourceMeta.value.bytes || 0,
      originalType: originalSourceMeta.value.type || '',
      inputWidth: sourceMeta.value.width || 0,
      inputHeight: sourceMeta.value.height || 0,
      inputBytes: sourceMeta.value.bytes || 0,
      inputType: sourceMeta.value.type || '',
      outputSize: settings.value.outputSize,
      requestedOutputWidth: requested?.width || 0,
      requestedOutputHeight: requested?.height || 0,
      resultWidth: 0,
      resultHeight: 0,
      resultBytes: 0,
      resultType: '',
      outputSizeMatched: null,
      outputSizeWarning: '',
    }
  })

  const activeJobRunning = computed(() => {
    const item = activeHistoryItem.value
    return Boolean(item && isRunningStatus(item.status))
  })

  /** 画布是否处于当前选中任务的生成态（不含后台其他任务 / 全局提交瞬间） */
  const loading = computed(() => activeJobRunning.value)

  const controlsLocked = computed(
    () => submitting.value || (activeJobRunning.value && !newTaskMode.value),
  )

  const hasRunningJobs = computed(() =>
    historyItems.value.some((item) => isRunningStatus(item.status)),
  )

  const runningJobCount = computed(
    () => historyItems.value.filter((item) => isRunningStatus(item.status)).length,
  )
  const availableConcurrency = computed(() => Math.max(0, 5 - runningJobCount.value))

  const hasReferenceImages = computed(() => referenceImages.value.length > 0)

  const effectiveStyleId = computed(() =>
    hasReferenceImages.value ? 'reference-style' : styleId.value,
  )

  const activeStyle = computed(() => {
    if (hasReferenceImages.value) {
      return {
        id: 'reference-style',
        label: '参考图风格',
        categoryId: 'reference',
        categoryLabel: '参考图',
        hint: '使用参考图提取配色、材质、光影和氛围，不叠加预设风格',
      }
    }
    return (
      findColoringStylePreset(styleId.value, COLORING_STYLE_PRESETS.value) || {
        id: '',
        label: '暂无可用风格',
        categoryId: '',
        categoryLabel: '风格配置',
        hint: '请联系管理员启用至少一个插画染色风格',
        prompt: '',
      }
    )
  })

  const canSubmit = computed(
    () =>
      !submitting.value &&
      (!activeJobRunning.value || newTaskMode.value) &&
      availableConcurrency.value >= generationCount.value &&
      !sourceUploading.value &&
      !disabledMessage.value &&
      !!sourcePreview.value &&
      authStore.isAuthenticated &&
      (hasReferenceImages.value || Boolean(activeStyle.value?.id)) &&
      (hasReferenceImages.value ||
        styleId.value !== 'custom' ||
        customPrompt.value.trim().length >= 2),
  )

  const customPromptLength = computed(() => customPrompt.value.trim().length)

  const stageHint = computed(() => {
    if (submitting.value) return statusText.value || '正在提交…'
    if (activeJobRunning.value) return statusText.value || 'AI 正在染色，请稍候…'
    if (sourceUploading.value) return '线稿上传中…'
    const active = activeHistoryItem.value
    if (active?.status === 'failed') {
      return formatColoringErrorText(active.error || statusText.value || '染色失败')
    }
    if (resultUrl.value) return statusText.value || '染色完成'
    if (statusText.value) return statusText.value
    if (sourcePreview.value) return '已选线稿，选择风格后开始染色'
    return '上传线稿后开始'
  })

  const coloringElapsedText = computed(() => {
    if (!loading.value) return ''
    const started = Number(activeHistoryItem.value?.startedAt || 0)
    if (!started) return ''
    const seconds = Math.max(0, Math.floor((elapsedNow.value - started) / 1000))
    const minutes = Math.floor(seconds / 60)
    return minutes
      ? `已用时 ${minutes}分${String(seconds % 60).padStart(2, '0')}秒`
      : `已用时 ${seconds}秒`
  })

  function revokeSourceBlob() {
    if (sourceBlobUrl.value?.startsWith('blob:')) {
      URL.revokeObjectURL(sourceBlobUrl.value)
    }
    sourceBlobUrl.value = ''
  }

  function revokeReferenceBlob(item) {
    const blobUrl = String(item?.blobUrl || '').trim()
    if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl)
  }

  function revokeAllReferenceBlobs() {
    referenceImages.value.forEach(revokeReferenceBlob)
  }

  function normalizeReferenceUrls(urls = []) {
    return Array.from(
      new Set(
        (Array.isArray(urls) ? urls : [])
          .map((item) => toColoringMediaUrl(item))
          .filter((item) => item && !item.startsWith('blob:')),
      ),
    ).slice(0, MAX_REFERENCE_IMAGES)
  }

  function readPersistableReferenceUrls() {
    return normalizeReferenceUrls(
      referenceImages.value.map((item) => item.remoteUrl || item.previewUrl),
    )
  }

  function readReferenceThumbUrls() {
    return referenceImages.value
      .map((item) => String(item.thumbUrl || '').trim())
      .filter(Boolean)
      .slice(0, MAX_REFERENCE_IMAGES)
  }

  function setReferenceImagesFromUrls(urls = [], thumbs = []) {
    revokeAllReferenceBlobs()
    const normalizedUrls = normalizeReferenceUrls(urls)
    const normalizedThumbs = Array.isArray(thumbs) ? thumbs : []
    referenceImages.value = normalizedUrls.map((url, index) => ({
      id: createReferenceImageId(),
      name: `参考图 ${index + 1}`,
      previewUrl: String(normalizedThumbs[index] || url || '').trim(),
      blobUrl: '',
      remoteUrl: url,
      thumbUrl: String(normalizedThumbs[index] || '').trim(),
      size: 0,
      type: '',
      status: 'ready',
    }))
  }

  async function createImageThumbnail(src, { maxSize = 160, quality = 0.72 } = {}) {
    const url = String(src || '').trim()
    if (!url || typeof document === 'undefined') return ''
    const img = new Image()
    if (/^https?:\/\//i.test(url)) img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(true)
      img.onerror = reject
      img.src = url
    })
    const naturalWidth = Number(img.naturalWidth || img.width || 0)
    const naturalHeight = Number(img.naturalHeight || img.height || 0)
    if (!naturalWidth || !naturalHeight) return ''
    const scale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight))
    const width = Math.max(1, Math.round(naturalWidth * scale))
    const height = Math.max(1, Math.round(naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return ''
    ctx.drawImage(img, 0, 0, width, height)
    try {
      return canvas.toDataURL('image/webp', quality)
    } catch {
      try {
        return canvas.toDataURL('image/jpeg', quality)
      } catch {
        return ''
      }
    }
  }

  function createImageThumbnailIdle(src, callback) {
    const run = () => {
      void createImageThumbnail(src)
        .then((thumb) => {
          if (thumb) callback?.(thumb)
        })
        .catch(() => null)
    }
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 1200 })
    } else if (typeof window !== 'undefined') {
      window.setTimeout(run, 80)
    } else {
      run()
    }
  }

  function resetResult() {
    resultUrl.value = ''
    if (!loading.value) statusText.value = ''
  }

  function workTitleFromSourceName(name) {
    const raw = String(name || '').trim()
    if (!raw) return ''
    return raw.replace(/\.[a-z0-9]{2,8}$/i, '').slice(0, 80)
  }

  function clearSource() {
    if (submitting.value) {
      notificationService.info('正在提交任务，请稍后再更换线稿')
      return
    }
    sourceRevision += 1
    sourceRemoteRevision = 0
    sourceUploadToken += 1
    sourceUploading.value = false
    revokeSourceBlob()
    sourcePreview.value = ''
    sourceName.value = ''
    sourceRemoteUrl.value = ''
    sourceThumbUrl.value = ''
    sourceMeta.value = { width: 0, height: 0, bytes: 0, type: '' }
    originalSourceMeta.value = { width: 0, height: 0, bytes: 0, type: '' }
    revealResult.value = false
    resetResult()
    activeHistoryId.value = ''
    persistColoringDraft({ immediate: true })
  }

  function beginNewColoringTask() {
    if (submitting.value) return
    newTaskMode.value = true
    activeHistoryId.value = ''
    resultUrl.value = ''
    statusText.value = ''
    workTitle.value = ''
    customPrompt.value = ''
    styleId.value = 'watercolor'
    clearSource()
    clearReferenceImages()
    persistColoringDraft({ immediate: true })
  }

  async function inspectSource(src, bytes = 0, type = '', { asOriginal = false } = {}) {
    const token = ++inspectSourceToken
    const size = await loadImageSize(src)
    if (token !== inspectSourceToken) return
    const next = {
      width: Number(size.width || 0),
      height: Number(size.height || 0),
      bytes: Number(bytes || 0),
      type: String(type || ''),
    }
    sourceMeta.value = next
    if (asOriginal || !originalSourceMeta.value.bytes) {
      originalSourceMeta.value = { ...next }
    }
  }

  function toColoringMediaUrl(pathOrUrl = '') {
    const value = String(pathOrUrl || '').trim()
    if (!value) return ''
    if (/^(https?:|data:|blob:)/i.test(value)) return value
    if (value.startsWith('/api/')) {
      return buildApiUrl(value.replace(/^\/api/, '') || '/')
    }
    if (value.startsWith('/')) return buildApiUrl(value)
    return value
  }

  async function resolveCompletedJobOutput(job = {}, historyItem = {}) {
    async function readOutputMeta(output = '') {
      if (!output) return null
      const [size, blob] = await Promise.all([
        loadImageSize(output).catch(() => ({ width: 0, height: 0 })),
        fetch(output)
          .then((response) => (response.ok ? response.blob() : null))
          .catch(() => null),
      ])
      const width = Number(size?.width || 0)
      const height = Number(size?.height || 0)
      const dataType = String(output).match(/^data:([^;,]+)/i)?.[1] || ''
      return {
        width,
        height,
        bytes: Number(blob?.size || 0),
        type: String(blob?.type || dataType),
      }
    }

    async function createResolvedOutput(output = '', outputs = [], persistentOutput = '') {
      const meta = await readOutputMeta(output)
      if (!isUsableColoringImageMeta(meta)) return null
      return {
        output,
        outputs,
        persistentOutput,
        meta,
      }
    }

    const providerResultUrl = toColoringMediaUrl(job.providerResultUrl)
    const candidates = [
      job.resultMediaUrl,
      historyItem.resultRemoteUrl,
      historyItem.resultUrl,
      ...(Array.isArray(historyItem.outputs) ? historyItem.outputs : []),
    ]
      .map((item) => toColoringMediaUrl(item))
      .filter((item) => item && item !== providerResultUrl)

    for (const candidate of candidates) {
      const normalized = normalizeImageOutput(candidate) || candidate
      if (!normalized) continue
      if (normalized.startsWith('data:image/')) {
        const resolved = await createResolvedOutput(normalized, [normalized], normalized)
        if (resolved) return resolved
      }
      if (
        /^https?:\/\//i.test(normalized) ||
        normalized.startsWith('/') ||
        normalized.startsWith('blob:')
      ) {
        const displayUrl = await resolveAuthenticatedMediaUrl(normalized).catch(() => '')
        if (!displayUrl) continue
        const resolved = await createResolvedOutput(displayUrl, [displayUrl], normalized)
        if (resolved) return resolved
      }
    }

    try {
      const resultResponse = await getServerAiJobResult(job.id || historyItem.serverJobId)
      const outputs = extractServerJobOutputs(resultResponse.result)
        .map((item) => normalizeImageOutput(item) || toColoringMediaUrl(item))
        .filter(Boolean)
      for (const output of outputs) {
        const persistentOutput = output.startsWith('blob:') ? '' : output
        const resolved = await createResolvedOutput(output, [output], persistentOutput)
        if (resolved) return resolved
      }
      return { output: '', outputs: [] }
    } catch {
      return { output: '', outputs: [] }
    }
  }

  function openDebugPanel() {
    debugOpen.value = true
  }

  function closeDebugPanel() {
    debugOpen.value = false
  }

  function toggleDebugPanel() {
    debugOpen.value = !debugOpen.value
  }

  function readPersistableSourcePreview() {
    const preview = String(sourcePreview.value || '').trim()
    if (!preview || preview.startsWith('blob:')) return ''
    return preview
  }

  function persistColoringDraft({ immediate = false } = {}) {
    if (typeof window === 'undefined') return
    if (persistDraftTimer) {
      window.clearTimeout(persistDraftTimer)
      persistDraftTimer = null
    }
    const write = () => {
      writeColoringDraft({
        styleId: effectiveStyleId.value,
        workTitle: workTitle.value,
        customPrompt: hasReferenceImages.value ? '' : customPrompt.value,
        sourceRemoteUrl: sourceRemoteUrl.value,
        sourcePreview: readPersistableSourcePreview(),
        sourceName: sourceName.value,
        resultUrl: resultUrl.value,
        activeHistoryId: activeHistoryId.value,
        compareMode: compareMode.value,
        referenceImageUrls: readPersistableReferenceUrls(),
        referenceThumbUrls: readReferenceThumbUrls(),
      })
      persistDraftTimer = null
    }
    if (immediate) {
      write()
      return
    }
    persistDraftTimer = window.setTimeout(write, 240)
  }

  function persistHistory({ immediate = false } = {}) {
    if (typeof window === 'undefined') return
    if (persistHistoryTimer) {
      window.clearTimeout(persistHistoryTimer)
      persistHistoryTimer = null
    }
    const write = () => {
      writeColoringHistory(historyItems.value)
      persistHistoryTimer = null
    }
    if (immediate) {
      write()
      return
    }
    persistHistoryTimer = window.setTimeout(write, 160)
  }

  function loadHistory() {
    historyItems.value = readColoringHistory().map(sanitizeColoringHistoryError)
    historyMutationVersion += 1
    // 将旧版本写入 localStorage 的失效 blob: 地址立即迁移掉。
    persistHistory({ immediate: true })
    const draft = readColoringDraft()
    const savedActiveId = String(draft?.activeHistoryId || '').trim()
    if (savedActiveId && historyItems.value.some((item) => item.id === savedActiveId)) {
      activeHistoryId.value = savedActiveId
    } else {
      activeHistoryId.value = historyItems.value[0]?.id || ''
    }
  }

  function restoreColoringDraft() {
    try {
      const draft = readColoringDraft()
      if (!draft || typeof draft !== 'object') return
      if (draft.styleId) styleId.value = draft.styleId
      if (typeof draft.workTitle === 'string') workTitle.value = draft.workTitle
      if (typeof draft.customPrompt === 'string') customPrompt.value = draft.customPrompt
      if (draft.compareMode === 'split' || draft.compareMode === 'result') {
        compareMode.value = draft.compareMode
        comparePreferenceReady.value = true
      }
      const remote = String(draft.sourceRemoteUrl || draft.sourcePreview || '').trim()
      if (remote && !remote.startsWith('blob:')) {
        sourceRevision += 1
        const revision = sourceRevision
        sourceRemoteUrl.value = toColoringMediaUrl(remote) || remote
        sourcePreview.value = String(draft.sourcePreview || remote).trim() || sourceRemoteUrl.value
        sourceThumbUrl.value = ''
        sourceName.value = String(draft.sourceName || '已保存线稿')
        sourceRemoteRevision = 0
        void materializeSourceFromRemote(revision, sourceRemoteUrl.value)
      }
      const savedResult = String(draft.resultUrl || '').trim()
      if (savedResult) resultUrl.value = savedResult
      if (Array.isArray(draft.referenceImageUrls) && draft.referenceImageUrls.length) {
        setReferenceImagesFromUrls(draft.referenceImageUrls, draft.referenceThumbUrls)
      }
      // 首次进入且无草稿偏好：有线稿+结果时默认并排对比
      if (!comparePreferenceReady.value && savedResult && remote && !remote.startsWith('blob:')) {
        compareMode.value = 'split'
        comparePreferenceReady.value = true
      }
    } catch {
      // ignore corrupt draft
    }
  }

  function ensureComparePreferenceDefault({ hasSource = false, hasResult = false } = {}) {
    if (comparePreferenceReady.value) return
    if (hasSource && hasResult) {
      compareMode.value = 'split'
    } else {
      compareMode.value = 'result'
    }
    comparePreferenceReady.value = true
  }

  function syncStatusFromActive() {
    const item = activeHistoryItem.value
    if (!item) {
      if (!submitting.value) statusText.value = resultUrl.value ? '染色完成' : ''
      return
    }
    const safeError = formatColoringErrorText(item.error || '')
    if (isRunningStatus(item.status)) {
      statusText.value =
        item.statusConfidence === 'upstream-unknown' && item.error
          ? safeError
          : formatJobStatus(item.status)
      return
    }
    if (isFailedOrCancelledHistoryStatus(item.status)) {
      statusText.value =
        safeError || (item.status === 'failed' ? '染色失败' : '任务已取消')
      return
    }
    if (isPausedStatus(item.status)) {
      statusText.value = safeError || '任务已暂停，请手动恢复原任务'
      return
    }
    if (item.resultUrl || resultUrl.value) {
      statusText.value = '染色完成'
    }
  }

  function applyHistoryItemToUi(item, { preserveLocalBlob = false } = {}) {
    if (!item) return
    // 先切 active，再同步源图/结果，保证侧栏与画布始终来自同一条历史
    activeHistoryId.value = item.id
    styleId.value = item.styleId || 'watercolor'
    customPrompt.value = item.customPrompt || ''
    setReferenceImagesFromUrls(item.referenceImageUrls || [], item.referenceThumbUrls || [])

    const durableSource = toColoringMediaUrl(item.sourceRemoteUrl || item.sourcePreview || '')
    const displaySource = String(item.sourcePreview || item.sourceRemoteUrl || '').trim()
    sourceThumbUrl.value = String(item.sourceThumbUrl || '').trim()
    const keepLocalBlob = Boolean(preserveLocalBlob && sourceBlobUrl.value)
    if (!keepLocalBlob) {
      sourceRevision += 1
      const revision = sourceRevision
      sourceRemoteRevision = 0
      revokeSourceBlob()
      if (durableSource || displaySource) {
        // 持久地址与展示地址分开：避免把过期签名 URL 当成可复用源图
        sourceRemoteUrl.value = durableSource || displaySource
        sourcePreview.value = displaySource || durableSource
        sourceName.value = item.sourceName || '历史线稿'
        void materializeSourceFromRemote(revision, durableSource || displaySource)
      } else {
        // 历史没有线稿时清空，避免侧栏残留上一条的图导致「原稿对不上结果」
        sourceRemoteUrl.value = ''
        sourcePreview.value = ''
        sourceThumbUrl.value = ''
        sourceName.value = ''
        sourceMeta.value = { width: 0, height: 0, bytes: 0, type: '' }
        originalSourceMeta.value = { width: 0, height: 0, bytes: 0, type: '' }
      }
    }

    const cachedW = Number(item.inputWidth || item.sourceWidth || item.originalWidth || 0)
    const cachedH = Number(item.inputHeight || item.sourceHeight || item.originalHeight || 0)
    if (cachedW > 0 && cachedH > 0) {
      inspectSourceToken += 1
      sourceMeta.value = {
        width: Number(item.inputWidth || item.sourceWidth || cachedW),
        height: Number(item.inputHeight || item.sourceHeight || cachedH),
        bytes: Number(item.inputBytes || item.sourceBytes || 0),
        type: String(item.inputType || ''),
      }
      originalSourceMeta.value = {
        width: Number(item.originalWidth || item.sourceWidth || item.inputWidth || cachedW),
        height: Number(item.originalHeight || item.sourceHeight || item.inputHeight || cachedH),
        bytes: Number(item.originalBytes || item.sourceBytes || item.inputBytes || 0),
        type: String(item.originalType || item.inputType || ''),
      }
    } else if ((durableSource || displaySource) && !keepLocalBlob) {
      void inspectSource(displaySource || durableSource, Number(item.sourceBytes || 0), '', {
        asOriginal: true,
      })
    }
    if ((durableSource || displaySource) && !item.sourceThumbUrl) {
      createImageThumbnailIdle(displaySource || durableSource, (thumb) => {
        const active = activeHistoryItem.value
        if (!active || active.id !== item.id || active.sourceThumbUrl) return
        sourceThumbUrl.value = thumb
        updateHistoryItem(item.id, { sourceThumbUrl: thumb }, { persistImmediately: true })
      })
    }

    // 结果与源图同一拍更新；没有结果就清空，避免旧结果挂在新线稿上
    const output = String(item.resultUrl || item.outputs?.[0] || '').trim()
    resultUrl.value = output
    revealResult.value = false
    // 切历史只恢复用户对比偏好，不强制抢占；无结果时由展示层临时单图
    ensureComparePreferenceDefault({
      hasSource: Boolean(durableSource || displaySource),
      hasResult: Boolean(output),
    })
    syncStatusFromActive()
    persistColoringDraft()
  }

  function setCompareMode(mode) {
    compareMode.value = mode === 'split' ? 'split' : 'result'
    comparePreferenceReady.value = true
    persistColoringDraft({ immediate: true })
  }

  function toggleCompareMode() {
    setCompareMode(compareMode.value === 'split' ? 'result' : 'split')
  }

  function updateHistoryItem(id, patch = {}, options = {}) {
    const current = historyItems.value.find((item) => item.id === id)
    if (!current) return
    const incomingStatus = String(patch?.status || '')
      .trim()
      .toLowerCase()
    const currentStatus = String(current.status || '')
      .trim()
      .toLowerCase()
    const currentCompleted = currentStatus === 'completed' || currentStatus === 'done'
    const incomingCompleted = incomingStatus === 'completed' || incomingStatus === 'done'
    const protectTerminalSnapshot =
      ((isTerminalColoringJobStatus(currentStatus) &&
        incomingStatus &&
        !isTerminalColoringJobStatus(incomingStatus)) ||
        (currentCompleted && incomingStatus && !incomingCompleted)) &&
      options.allowTerminalReset !== true
    let appliedPatch = Object.prototype.hasOwnProperty.call(patch, 'error')
      ? { ...patch, error: formatColoringErrorText(patch.error || '') }
      : patch
    if (protectTerminalSnapshot) {
      // 慢轮询返回的 queued/running 不得清空已经确认的结果或错误。
      appliedPatch = { ...appliedPatch }
      const terminalOutcomeKeys = [
        'status',
        'statusConfidence',
        'error',
        'finishedAt',
        'resultRemoteUrl',
        'resultUrl',
        'outputs',
        'resultThumbUrl',
        'resultWidth',
        'resultHeight',
        'resultBytes',
        'resultType',
      ]
      terminalOutcomeKeys.forEach((key) => delete appliedPatch[key])
    }
    historyItems.value = historyItems.value.map((item) =>
      item.id === id ? { ...item, ...appliedPatch, updatedAt: new Date().toISOString() } : item,
    )
    historyMutationVersion += 1
    if (activeHistoryId.value === id) {
      if (appliedPatch.resultUrl != null) resultUrl.value = appliedPatch.resultUrl || ''
      syncStatusFromActive()
    }
    if (isFailedOrCancelledHistoryStatus(appliedPatch.status) && options.notifyFailure !== false) {
      notificationService.error(
        formatColoringErrorText(
          appliedPatch.error ||
            (appliedPatch.status === 'cancelled' || appliedPatch.status === 'canceled'
              ? '任务已取消'
              : '染色失败，请稍后重试'),
        ),
      )
    }
    const critical =
      options.persistImmediately === true ||
      appliedPatch.serverJobId != null ||
      appliedPatch.resultUrl != null ||
      appliedPatch.outputs != null ||
      appliedPatch.status === 'completed' ||
      isFailedOrCancelledHistoryStatus(appliedPatch.status)
    persistHistory({ immediate: critical })
  }

  async function removeHistoryItems(itemIds = []) {
    const ids = new Set(
      (Array.isArray(itemIds) ? itemIds : [itemIds])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    )
    const removed = historyItems.value.filter((item) => ids.has(item.id))
    if (!removed.length) return
    if (removed.some((item) => isRunningStatus(item.status))) {
      notificationService.info('进行中的任务请先取消，确认停止后才能删除')
      return
    }
    const removableIds = new Set()
    const failures = []
    await Promise.all(
      removed.map(async (item) => {
        if (!item.serverJobId) {
          removableIds.add(item.id)
          return
        }
        try {
          // paused 已经不执行，可直接删除；终态同理。只有服务端确认删除后
          // 才从本地隐藏，避免云端刷新时把“假删除”的任务重新带回来。
          if (isTerminalColoringJobStatus(item.status) || isPausedStatus(item.status)) {
            await deleteServerAiJob(item.serverJobId)
            markColoringJobDeleted(item.serverJobId)
            removableIds.add(item.id)
            return
          }
          failures.push(`${item.title || item.styleLabel || '任务'}状态暂不可删除`)
        } catch (error) {
          failures.push(formatColoringErrorText(error?.message || '云端任务删除失败'))
        }
      }),
    )
    if (!removableIds.size) {
      notificationService.error(
        formatColoringErrorText(failures[0] || '历史记录删除失败'),
      )
      return
    }
    const activeWasRemoved = removableIds.has(activeHistoryId.value)
    removed
      .filter((item) => removableIds.has(item.id))
      .forEach((item) => stopServerJobPolling(item.id))
    historyItems.value = historyItems.value.filter((item) => !removableIds.has(item.id))
    historyMutationVersion += 1
    if (activeWasRemoved) {
      const next = historyItems.value[0] || null
      activeHistoryId.value = next?.id || ''
      if (next) applyHistoryItemToUi(next)
      else {
        resultUrl.value = ''
        statusText.value = ''
        sourceThumbUrl.value = ''
        revealResult.value = false
      }
    }
    persistHistory({ immediate: true })
    persistColoringDraft({ immediate: true })
    notificationService.success(
      removableIds.size > 1 ? `已删除 ${removableIds.size} 条结果` : '已删除历史记录',
    )
    if (failures.length) notificationService.warning(`${failures.length} 条记录未能删除`)
  }

  async function removeHistoryItem(itemId) {
    await removeHistoryItems([itemId])
  }

  async function preuploadSourceBlob(revision = sourceRevision) {
    const blobUrl = sourceBlobUrl.value
    if (!blobUrl || !authStore.isAuthenticated) return
    if (sourceUploadPromise && sourceUploadPromiseRevision === revision) {
      return sourceUploadPromise
    }
    const uploadToken = ++sourceUploadToken
    sourceUploadPromiseRevision = revision
    sourceUploading.value = true
    sourceUploadPromise = (async () => {
      const blob = await fetch(blobUrl).then((res) => {
        if (!res.ok) throw new Error('线稿读取失败')
        return res.blob()
      })
      if (!blob?.size) throw new Error('线稿为空')
      const prepared = await prepareColoringUploadBlob({
        blob,
        settings: settings.value,
      })
      const uploadBlob = prepared.blob || blob
      if (!uploadBlob?.size) throw new Error('线稿处理失败')
      const remoteUrl = String(
        (await uploadAiTempBlob(uploadBlob, {
          featureKey: 'ai.illustrationColoring',
        })) || '',
      ).trim()
      if (!remoteUrl || remoteUrl.startsWith('blob:') || !isAiTempSourceUrl(remoteUrl)) {
        throw new Error('线稿上传失败')
      }
      if (
        revision !== sourceRevision ||
        blobUrl !== sourceBlobUrl.value ||
        uploadToken !== sourceUploadToken
      ) {
        return
      }
      sourceRemoteUrl.value = remoteUrl
      sourceRemoteRevision = revision
      applyPreparedSourceMeta(prepared, uploadBlob)
      persistColoringDraft({ immediate: true })
      return remoteUrl
    })()
    try {
      return await sourceUploadPromise
    } catch {
      // 预上传失败不阻断，提交时会按上传框图片重试
      return ''
    } finally {
      if (uploadToken === sourceUploadToken) {
        sourceUploading.value = false
      }
      if (sourceUploadPromiseRevision === revision) {
        sourceUploadPromise = null
        sourceUploadPromiseRevision = 0
      }
    }
  }

  async function applyFile(file) {
    if (submitting.value || (activeJobRunning.value && !newTaskMode.value)) {
      notificationService.info('当前任务进行中，请稍后再更换线稿')
      return
    }
    if (!file?.type?.startsWith('image/')) {
      notificationService.warning('请选择图片文件')
      return
    }
    const maxBytes = maxUploadMb.value * 1024 * 1024
    if (file.size > maxBytes) {
      notificationService.warning(`图片不能超过 ${maxUploadMb.value}MB`)
      return
    }

    sourceRevision += 1
    const revision = sourceRevision
    sourceRemoteRevision = 0
    revokeSourceBlob()
    const blobUrl = URL.createObjectURL(file)
    sourceBlobUrl.value = blobUrl
    sourcePreview.value = blobUrl
    sourceName.value = file.name || '本地插画'
    workTitle.value = workTitleFromSourceName(sourceName.value)
    sourceRemoteUrl.value = ''
    sourceThumbUrl.value = ''
    resultUrl.value = ''
    statusText.value = ''
    revealResult.value = false
    activeHistoryId.value = ''
    await inspectSource(blobUrl, file.size, file.type, { asOriginal: true })
    createImageThumbnailIdle(blobUrl, (thumb) => {
      if (revision !== sourceRevision || blobUrl !== sourceBlobUrl.value) return
      sourceThumbUrl.value = thumb
      const active = activeHistoryItem.value
      if (active && !active.sourceThumbUrl) {
        updateHistoryItem(active.id, { sourceThumbUrl: thumb }, { persistImmediately: true })
      }
    })
    persistColoringDraft({ immediate: true })
    if (authStore.isAuthenticated) {
      void preuploadSourceBlob(revision)
    }
  }

  function openFavoritePicker() {
    if (submitting.value || (activeJobRunning.value && !newTaskMode.value)) {
      notificationService.info('当前任务进行中，请稍后再更换线稿')
      return
    }
    favoritePickerOpen.value = true
  }

  function closeFavoritePicker() {
    favoritePickerOpen.value = false
  }

  function buildFavoriteFullCandidates(wallpaper = {}) {
    const id = String(wallpaper.id || '').trim()
    const prefix = id.slice(0, 2)
    const built = id
      ? [
          `https://w.wallhaven.cc/full/${prefix}/wallhaven-${id}.jpg`,
          `https://w.wallhaven.cc/full/${prefix}/wallhaven-${id}.png`,
        ]
      : []
    const seen = new Set()
    return [
      wallpaper.raw_path,
      wallpaper.path,
      wallpaper.url,
      wallpaper.raw_thumbs?.original,
      wallpaper.thumbs?.original,
      ...built,
    ]
      .map((url) => String(url || '').trim())
      .filter((url) => {
        if (!url || seen.has(url)) return false
        seen.add(url)
        return true
      })
  }

  async function resolveFavoriteWallpaper(wallpaper = {}) {
    const id = String(wallpaper.id || '').trim()
    if (!id) return wallpaper
    try {
      const response = await wallpaperApi.getWallpaperDetails(id)
      if (response?.success && response.image) {
        return { ...wallpaper, ...response.image }
      }
    } catch {
      // 详情失败时沿用收藏条目
    }
    return wallpaper
  }

  async function applyFavoriteWallpaper(wallpaper) {
    if (submitting.value || (activeJobRunning.value && !newTaskMode.value)) {
      notificationService.info('当前任务进行中，请稍后再更换线稿')
      return
    }
    if (!wallpaper) return

    favoritePickerOpen.value = false
    sourceUploading.value = true
    statusText.value = '正在载入收藏壁纸…'
    let favoriteRevision = sourceRevision

    try {
      const resolved = await resolveFavoriteWallpaper(wallpaper)
      const fullUrl =
        pickPreviewSourceImageUrl({ wallpaper: resolved }) ||
        buildFavoriteFullCandidates(resolved)[0] ||
        ''
      if (!fullUrl) {
        throw new Error('无法获取该收藏壁纸的图片地址')
      }

      const fetched = await fetchImageBlobForAi(fullUrl)
      if (!fetched?.blob) {
        throw new Error('收藏壁纸图片拉取失败')
      }

      const maxBytes = maxUploadMb.value * 1024 * 1024
      if (fetched.blob.size > maxBytes) {
        throw new Error(`图片不能超过 ${maxUploadMb.value}MB`)
      }

      sourceRevision += 1
      const revision = sourceRevision
      favoriteRevision = revision
      sourceRemoteRevision = 0
      revokeSourceBlob()
      const blobUrl = URL.createObjectURL(fetched.blob)
      sourceBlobUrl.value = blobUrl
      sourcePreview.value = blobUrl
      sourceName.value = resolved.id
        ? `收藏 · ${resolved.id}`
        : resolved.resolution
          ? `收藏 · ${resolved.resolution}`
          : '收藏壁纸'
      workTitle.value = workTitleFromSourceName(
        resolved.id ? `wallhaven-${resolved.id}` : sourceName.value,
      )
      sourceRemoteUrl.value = ''
      sourceThumbUrl.value = ''
      resultUrl.value = ''
      statusText.value = ''
      revealResult.value = false
      activeHistoryId.value = ''

      await inspectSource(blobUrl, fetched.blob.size, fetched.blob.type || '', {
        asOriginal: true,
      })
      createImageThumbnailIdle(blobUrl, (thumb) => {
        if (revision !== sourceRevision || blobUrl !== sourceBlobUrl.value) return
        sourceThumbUrl.value = thumb
        const active = activeHistoryItem.value
        if (active && !active.sourceThumbUrl) {
          updateHistoryItem(active.id, { sourceThumbUrl: thumb }, { persistImmediately: true })
        }
      })
      persistColoringDraft({ immediate: true })

      if (authStore.isAuthenticated) {
        await preuploadSourceBlob(revision)
      }
      notificationService.success('已选用收藏壁纸作为线稿')
    } catch (error) {
      statusText.value = ''
      notificationService.error(
        formatColoringErrorText(error?.message || '载入收藏壁纸失败'),
      )
    } finally {
      if (favoriteRevision === sourceRevision) {
        sourceUploading.value = false
      }
    }
  }

  function handleFileInput(event) {
    const file = event.target?.files?.[0]
    if (file) applyFile(file)
    event.target.value = ''
  }

  async function addReferenceFiles(files = []) {
    if (submitting.value || (activeJobRunning.value && !newTaskMode.value)) {
      notificationService.info('当前任务进行中，请稍后再调整参考图')
      return
    }
    const list = Array.from(files || []).filter(Boolean)
    if (!list.length) return
    const available = Math.max(0, MAX_REFERENCE_IMAGES - referenceImages.value.length)
    if (!available) {
      notificationService.info(`最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`)
      return
    }
    const maxBytes = maxUploadMb.value * 1024 * 1024
    const accepted = []
    for (const file of list.slice(0, available)) {
      if (!file?.type?.startsWith('image/')) {
        notificationService.warning('参考图只支持图片文件')
        continue
      }
      if (file.size > maxBytes) {
        notificationService.warning(`参考图不能超过 ${maxUploadMb.value}MB`)
        continue
      }
      const blobUrl = URL.createObjectURL(file)
      const item = {
        id: createReferenceImageId(),
        name: file.name || `参考图 ${referenceImages.value.length + accepted.length + 1}`,
        previewUrl: blobUrl,
        blobUrl,
        remoteUrl: '',
        thumbUrl: '',
        size: file.size || 0,
        type: file.type || '',
        status: 'local',
      }
      accepted.push(item)
      createImageThumbnailIdle(blobUrl, (thumb) => {
        const active = referenceImages.value.find((entry) => entry.id === item.id)
        if (!active || active.thumbUrl) return
        referenceImages.value = referenceImages.value.map((entry) =>
          entry.id === item.id ? { ...entry, thumbUrl: thumb } : entry,
        )
        persistColoringDraft()
      })
    }
    if (!accepted.length) return
    referenceImages.value = [...referenceImages.value, ...accepted].slice(0, MAX_REFERENCE_IMAGES)
    persistColoringDraft({ immediate: true })
  }

  function handleReferenceInput(event) {
    const files = Array.from(event.target?.files || [])
    if (files.length) void addReferenceFiles(files)
    event.target.value = ''
  }

  function removeReferenceImage(id) {
    if (submitting.value || (activeJobRunning.value && !newTaskMode.value)) {
      notificationService.info('当前任务进行中，请稍后再调整参考图')
      return
    }
    const targetId = String(id || '').trim()
    const item = referenceImages.value.find((entry) => entry.id === targetId)
    if (!item) return
    revokeReferenceBlob(item)
    referenceImages.value = referenceImages.value.filter((entry) => entry.id !== targetId)
    persistColoringDraft({ immediate: true })
  }

  function clearReferenceImages() {
    if (submitting.value || (activeJobRunning.value && !newTaskMode.value)) {
      notificationService.info('当前任务进行中，请稍后再调整参考图')
      return
    }
    revokeAllReferenceBlobs()
    referenceImages.value = []
    persistColoringDraft({ immediate: true })
  }

  function handleDrop(event) {
    uploadDragOver.value = false
    const file = event.dataTransfer?.files?.[0]
    if (file) applyFile(file)
  }

  function triggerUpload(inputRef) {
    if (submitting.value || (activeJobRunning.value && !newTaskMode.value)) {
      notificationService.info('当前任务进行中，请稍后再更换线稿')
      return
    }
    inputRef?.click?.()
  }

  function goLogin() {
    router.push({
      path: '/auth',
      query: createLoginRedirectQuery('/ai-illustration-coloring'),
    })
  }

  function ensureLogin() {
    if (authStore.isAuthenticated) return true
    notificationService.info('登录后可使用 AI 染色')
    goLogin()
    return false
  }

  async function confirmAiCost(cost) {
    pendingCost.value = cost
    costConfirmOpen.value = true
    void enrichStudioCreditCostSnapshot(cost).then((snapshot) => {
      if (costConfirmOpen.value) {
        pendingCost.value = snapshot
      }
    })
    return new Promise((resolve) => {
      costConfirmResolver = resolve
    })
  }

  function resolveCostConfirm(accepted) {
    costConfirmOpen.value = false
    pendingCost.value = null
    costConfirmResolver?.(accepted)
    costConfirmResolver = null
  }

  async function resolveDisplaySourceBlob() {
    const blobUrl = String(sourceBlobUrl.value || '').trim()
    if (blobUrl) {
      const response = await fetch(blobUrl)
      if (!response.ok) throw new Error('上传框中的线稿读取失败，请重新上传')
      const blob = await response.blob()
      if (!blob?.size) throw new Error('上传框中的线稿为空，请重新上传')
      return blob
    }

    const candidates = [
      String(sourceRemoteUrl.value || '').trim(),
      String(sourcePreview.value || '').trim(),
    ]
      .filter(Boolean)
      .filter((url, index, list) => list.indexOf(url) === index)

    if (!candidates.length) {
      throw new Error('请先上传线稿插画')
    }

    for (const candidate of candidates) {
      if (candidate.startsWith('blob:')) continue
      try {
        const durable = toColoringMediaUrl(candidate)
        const displayUrl = await resolveAuthenticatedMediaUrl(durable).catch(() => durable)
        const fetched = await fetchImageBlobForAi(displayUrl || durable)
        if (fetched?.blob?.size) return fetched.blob
      } catch {
        // Try the next durable source candidate without exposing the upstream error.
      }
    }

    throw new Error('上传框中的线稿读取失败，请重新上传')
  }

  async function materializeSourceFromRemote(revision, remoteUrl) {
    const durable = toColoringMediaUrl(remoteUrl)
    if (!durable || revision !== sourceRevision) return false
    try {
      const displayUrl = await resolveAuthenticatedMediaUrl(durable).catch(() => durable)
      if (revision !== sourceRevision) return false
      if (!sourceBlobUrl.value) {
        sourcePreview.value = displayUrl || durable
      }
      const fetched = await fetchImageBlobForAi(displayUrl || durable)
      if (revision !== sourceRevision || !fetched?.blob?.size) return false

      revokeSourceBlob()
      const blobUrl = URL.createObjectURL(fetched.blob)
      sourceBlobUrl.value = blobUrl
      sourcePreview.value = blobUrl
      // 历史图先落到本地，再重新上传临时地址，避免过期 ai-temp / 签名链失效
      sourceRemoteUrl.value = ''
      sourceRemoteRevision = 0
      if (authStore.isAuthenticated) {
        void preuploadSourceBlob(revision)
      }
      return true
    } catch {
      return false
    }
  }

  function applyPreparedSourceMeta(prepared, uploadBlob) {
    if (!prepared?.width || !prepared?.height) return
    sourceMeta.value = {
      ...sourceMeta.value,
      width: prepared.width,
      height: prepared.height,
      bytes: prepared.processedBytes || uploadBlob?.size || sourceMeta.value.bytes,
      type: uploadBlob?.type || prepared.blob?.type || sourceMeta.value.type,
    }
  }

  async function uploadPreparedSourceBlob(blob, onStatus) {
    if (!blob?.size) throw new Error('线稿为空，请重新上传')
    const prepared = await prepareColoringUploadBlob({
      blob,
      settings: settings.value,
      onStatus,
    })
    const uploadBlob = prepared?.blob || blob
    if (!uploadBlob?.size) throw new Error('线稿处理失败，请重新上传')
    const workingUrl = String(
      (await uploadAiTempBlob(uploadBlob, {
        featureKey: 'ai.illustrationColoring',
      })) || '',
    ).trim()
    if (!workingUrl || workingUrl.startsWith('blob:') || !isAiTempSourceUrl(workingUrl)) {
      throw new Error('线稿上传失败，请重试')
    }
    sourceRemoteUrl.value = workingUrl
    sourceRemoteRevision = sourceRevision
    applyPreparedSourceMeta(prepared, uploadBlob)
    persistColoringDraft({ immediate: true })
    return workingUrl
  }

  async function prepareSourceUrl(onStatus) {
    const preview = String(sourcePreview.value || sourceRemoteUrl.value || '').trim()
    if (!preview) {
      throw new Error('请先上传线稿插画')
    }

    // 仅复用「当前上传框这张图」对应的预上传结果，避免旧远程地址或 blob 地址进模型
    if (
      sourceUploading.value &&
      sourceUploadPromise &&
      sourceUploadPromiseRevision === sourceRevision
    ) {
      onStatus?.('等待线稿上传完成…')
      const uploaded = String((await sourceUploadPromise.catch(() => '')) || '').trim()
      const uploadedRemote = String(uploaded || sourceRemoteUrl.value || '').trim()
      if (
        sourceRemoteRevision === sourceRevision &&
        sourceBlobUrl.value &&
        uploadedRemote &&
        !uploadedRemote.startsWith('blob:') &&
        isAiTempSourceUrl(uploadedRemote)
      ) {
        return uploadedRemote
      }
    }

    const reusableRemote = String(sourceRemoteUrl.value || '').trim()
    if (
      sourceRemoteRevision === sourceRevision &&
      reusableRemote &&
      !reusableRemote.startsWith('blob:') &&
      isAiTempSourceUrl(reusableRemote)
    ) {
      onStatus?.('正在检查已上传线稿…')
      const reusable = await validateReusableAiTempImageUrl(reusableRemote)
      if (reusable) {
        sourceRemoteRevision = sourceRevision
        onStatus?.('使用已上传线稿…')
        return reusableRemote
      }

      sourceRemoteUrl.value = ''
      sourceRemoteRevision = 0
      if (!sourceBlobUrl.value) {
        if (String(sourcePreview.value || '').trim() === reusableRemote) sourcePreview.value = ''
        persistColoringDraft({ immediate: true })
        throw new Error('线稿临时链接已过期，且本地原图已不可用，请重新上传线稿')
      }
      onStatus?.('线稿临时链接已过期，正在重新上传本地原图…')
      persistColoringDraft({ immediate: true })
    }

    onStatus?.('正在按上传框中的线稿处理…')
    const blob = await resolveDisplaySourceBlob()
    // 若还没有本地 blob，落到上传框，后续重试更稳
    if (!sourceBlobUrl.value && blob?.size) {
      const blobUrl = URL.createObjectURL(blob)
      sourceBlobUrl.value = blobUrl
      sourcePreview.value = blobUrl
    }
    return uploadPreparedSourceBlob(blob, onStatus)
  }

  async function prepareReferenceImageUrls(onStatus) {
    const refs = referenceImages.value.slice(0, MAX_REFERENCE_IMAGES)
    if (!refs.length) return []
    onStatus?.(`正在准备 ${refs.length} 张参考图…`)
    const uploaded = []

    async function reuploadReferenceSource(source, label) {
      const candidate = String(source || '').trim()
      if (!candidate) throw new Error(`${label}本地图片不可用`)
      let blob = null
      if (candidate.startsWith('blob:') || /^data:image\//i.test(candidate)) {
        const response = await fetch(candidate)
        if (!response.ok) throw new Error(`${label}本地图片读取失败`)
        blob = await response.blob()
      } else {
        const fetched = await fetchImageBlobForAi(candidate)
        blob = fetched?.blob || null
      }
      if (!blob?.size) throw new Error(`${label}图片为空`)
      const prepared = await prepareColoringUploadBlob({
        blob,
        settings: {
          ...settings.value,
          outputSize: 'original',
        },
      })
      const remoteUrl = toColoringMediaUrl(
        await uploadAiTempBlob(prepared?.blob || blob, {
          featureKey: 'ai.illustrationColoring',
        }),
      )
      if (!remoteUrl || remoteUrl.startsWith('blob:') || !isAiTempSourceUrl(remoteUrl)) {
        throw new Error(`${label}上传失败`)
      }
      return remoteUrl
    }

    for (let index = 0; index < refs.length; index += 1) {
      const item = refs[index]
      const label = `参考图 ${index + 1}/${refs.length}`
      const existingRemote = String(item.remoteUrl || '').trim()
      if (
        existingRemote &&
        !existingRemote.startsWith('blob:') &&
        isAiTempSourceUrl(existingRemote)
      ) {
        onStatus?.(`正在检查${label}…`)
        const resolved = await resolveReusableAiTempImageUrl(existingRemote, {
          recoveryCandidates: [item.blobUrl, item.previewUrl, item.thumbUrl],
          reuploadLocalSource: async (localSource) => {
            onStatus?.(`${label}临时链接已过期，正在重新上传本地图片…`)
            return reuploadReferenceSource(localSource, label)
          },
        })
        if (!resolved.url) {
          referenceImages.value = referenceImages.value.map((entry) =>
            entry.id === item.id ? { ...entry, remoteUrl: '', status: 'error' } : entry,
          )
          persistColoringDraft({ immediate: true })
          throw new Error(`${label}临时链接已过期，且本地参考图已不可用，请重新添加`)
        }
        uploaded.push(toColoringMediaUrl(resolved.url))
        if (resolved.recovered) {
          referenceImages.value = referenceImages.value.map((entry) =>
            entry.id === item.id
              ? { ...entry, remoteUrl: resolved.url, status: 'ready' }
              : entry,
          )
        }
        continue
      }
      const source = String(item.blobUrl || item.remoteUrl || item.previewUrl || '').trim()
      if (!source) continue
      onStatus?.(item.blobUrl ? `正在上传${label}…` : `正在重新读取${label}…`)
      const remoteUrl = await reuploadReferenceSource(source, label)
      uploaded.push(remoteUrl)
      referenceImages.value = referenceImages.value.map((entry) =>
        entry.id === item.id ? { ...entry, remoteUrl, status: 'ready' } : entry,
      )
    }
    persistColoringDraft({ immediate: true })
    return Array.from(new Set(uploaded.filter(Boolean))).slice(0, MAX_REFERENCE_IMAGES)
  }

  function openSettings() {
    settingsOpen.value = true
  }

  function closeSettings() {
    settingsOpen.value = false
  }

  function saveSettings(next) {
    const normalized = writeColoringSettings(next)
    // 打开设置时若未点选模型，默认选中当前列表第一项，避免空值回退默认模型
    if (!normalized.publicModelKey && publicModels.value.length) {
      normalized.publicModelKey = String(
        publicModels.value[0]?.publicModelKey || publicModels.value[0]?.id || '',
      ).trim()
      writeColoringSettings(normalized)
    }
    settings.value = normalized
    selectedModelKey.value = String(settings.value.publicModelKey || '')
    settingsOpen.value = false
    if (sourceBlobUrl.value) {
      // 设置改变后必须创建新的源图版本。旧预上传即使稍后返回，也不能覆盖
      // 当前设置对应的原图/压缩图，更不能在正式提交时被复用。
      sourceRevision += 1
      sourceRemoteUrl.value = ''
      sourceRemoteRevision = 0
      void preuploadSourceBlob(sourceRevision)
    }
    notificationService.success(
      selectedModelKey.value ? `设置已保存（模型：${selectedModelKey.value}）` : '设置已保存',
    )
  }

  function recordUsageIfNeeded(item, modelKey) {
    if (!item || item.usageRecorded) return
    const snapshot = budgetGuard.getCostSnapshot(modelKey, 1)
    if (snapshot.billingMode === 'credits' && snapshot.unitCost > 0) {
      recordAiUsage({
        featureKey: ILLUSTRATION_COLORING_FEATURE_KEY,
        model: modelKey,
        status: 'success',
        billingMode: 'credits',
        unitCost: snapshot.unitCost,
      })
    }
    updateHistoryItem(item.id, { usageRecorded: true }, { persistImmediately: true })
  }

  function stopServerJobPolling(historyId) {
    const poller = serverJobPollers.get(historyId)
    if (poller) {
      window.clearInterval(poller)
      serverJobPollers.delete(historyId)
    }
    serverJobPollGeneration.set(historyId, (serverJobPollGeneration.get(historyId) || 0) + 1)
    serverJobPollInFlight.delete(historyId)
  }

  function stopAllServerJobPolling() {
    const historyIds = new Set([
      ...serverJobPollers.keys(),
      ...serverJobPollInFlight,
      ...serverJobPollGeneration.keys(),
    ])
    historyIds.forEach((historyId) => stopServerJobPolling(historyId))
    serverJobPollInFlight.clear()
    serverJobPollGeneration.clear()
  }

  function notifyTerminalOnce(historyId, type, message) {
    const key = `${historyId}:${type}`
    if (notifiedTerminalJobs.has(key)) return
    notifiedTerminalJobs.add(key)
    if (!sessionStartedJobs.has(historyId) && type === 'success') return
    if (type === 'success') notificationService.success(message)
    else notificationService.error(formatColoringErrorText(message || '染色失败，请稍后重试'))
  }

  async function pollColoringJob(historyId) {
    if (disposed) return
    const item = historyItems.value.find((entry) => entry.id === historyId)
    if (!item?.serverJobId || !authStore.isAuthenticated) {
      stopServerJobPolling(historyId)
      return
    }
    // 同一任务的上一次请求尚未完成时不再发起下一次，避免慢请求乱序覆盖新状态。
    if (serverJobPollInFlight.has(historyId)) return
    serverJobPollInFlight.add(historyId)
    const pollGeneration = serverJobPollGeneration.get(historyId) || 0
    const pollIsCurrent = () =>
      !disposed && (serverJobPollGeneration.get(historyId) || 0) === pollGeneration
    try {
      // Server is the single state authority. Do not create a second timeout
      // state machine in the browser: it used to reset its timer and keep a
      // stalled task visually "running" after the server had stopped making
      // progress.
      const response = await getServerAiJob(item.serverJobId, {
        signal: pollAbortController.signal,
      })
      if (!pollIsCurrent()) return
      const job = response.job || {}
      const status = job.status || item.status
      const patch = {
        status,
        statusConfidence: 'server',
        error: formatColoringErrorText(job.error || ''),
      }

      const durableSource = toColoringMediaUrl(job.sourceMediaUrl)
      if (durableSource) {
        patch.sourceRemoteUrl = durableSource
        patch.sourcePreview = await resolveAuthenticatedMediaUrl(durableSource).catch(
          () => item.sourcePreview || durableSource,
        )
        if (!pollIsCurrent()) return
      }

      if (status === 'completed' || status === 'done') {
        const resolved = await resolveCompletedJobOutput(job, item)
        if (!pollIsCurrent()) return
        const output = resolved.output || ''
        const outputs = resolved.outputs?.length ? resolved.outputs : []
        patch.outputs = outputs
        patch.resultRemoteUrl = resolved.persistentOutput || ''
        patch.resultUrl = output
        patch.finishedAt = Date.now()
        if (output && resolved.meta && (!item.resultWidth || !item.resultBytes)) {
          const resultMeta = resolved.meta
          patch.resultWidth = resultMeta.width
          patch.resultHeight = resultMeta.height
          patch.resultBytes = resultMeta.bytes
          patch.resultType = resultMeta.type
        }
        const requestedWidth = Number(item.requestedOutputWidth || 0)
        const requestedHeight = Number(item.requestedOutputHeight || 0)
        const actualWidth = Number(resolved.meta?.width || item.resultWidth || 0)
        const actualHeight = Number(resolved.meta?.height || item.resultHeight || 0)
        if (requestedWidth && requestedHeight && actualWidth && actualHeight) {
          const matched = requestedWidth === actualWidth && requestedHeight === actualHeight
          patch.outputSizeMatched = matched
          patch.outputSizeWarning = matched
            ? ''
            : `请求 ${requestedWidth}×${requestedHeight}，模型实际返回 ${actualWidth}×${actualHeight}`
        }
        const modelKey = item.publicModelKey || resolvedPublicModelKey.value
        if (output) {
          recordUsageIfNeeded({ ...item, ...patch }, modelKey)
          if (!item.resultThumbUrl) {
            createImageThumbnailIdle(output, (thumb) => {
              const active = historyItems.value.find((entry) => entry.id === historyId)
              if (!active || active.resultThumbUrl) return
              updateHistoryItem(historyId, { resultThumbUrl: thumb }, { persistImmediately: true })
            })
          }
          if (item.batchId && Number(item.variantCount || 1) > 1) {
            const batchItems = historyItems.value.filter((entry) => entry.batchId === item.batchId)
            const completedCount =
              batchItems.filter(
                (entry) =>
                  entry.id !== historyId &&
                  (entry.status === 'completed' || entry.status === 'done') &&
                  (entry.resultUrl || entry.outputs?.[0]),
              ).length + 1
            if (completedCount >= batchItems.length) {
              notifyTerminalOnce(item.batchId, 'success', '批量插画染色完成')
            }
          } else {
            notifyTerminalOnce(historyId, 'success', '插画染色完成')
          }
        } else {
          patch.status = 'failed'
          patch.statusConfidence = 'client-validation'
          patch.error = patch.error || COMPLETED_WITHOUT_OUTPUT_ERROR
          notifyTerminalOnce(historyId, 'error', patch.error)
        }
      } else if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
        patch.finishedAt = Date.now()
        notifyTerminalOnce(historyId, 'error', job.error || '染色失败，请稍后重试')
      }

      if (!pollIsCurrent()) return
      const resolvedStatus = patch.status || status
      updateHistoryItem(historyId, patch, {
        persistImmediately: isTerminalColoringJobStatus(resolvedStatus) || !!patch.resultUrl,
        notifyFailure: false,
        allowTerminalReset:
          resolvedStatus === 'failed' && (status === 'completed' || status === 'done'),
      })
      if (isTerminalColoringJobStatus(resolvedStatus)) {
        stopServerJobPolling(historyId)
        submitting.value = false
        if (activeHistoryId.value === historyId) {
          if (patch.resultUrl) {
            resultUrl.value = patch.resultUrl
            statusText.value = '染色完成'
            // 完成后保留用户对比偏好；首次无偏好时默认并排
            ensureComparePreferenceDefault({
              hasSource: Boolean(sourcePreview.value || sourceRemoteUrl.value),
              hasResult: true,
            })
            revealResult.value = false
            persistColoringDraft()
          } else if (
            resolvedStatus === 'failed' ||
            resolvedStatus === 'cancelled' ||
            resolvedStatus === 'canceled'
          ) {
            statusText.value = formatColoringErrorText(patch.error || '染色失败')
          }
        }
      }
    } catch {
      if (pollIsCurrent() && activeHistoryId.value === historyId) {
        statusText.value = '状态同步失败，系统会继续查询原任务'
      }
    } finally {
      if (pollIsCurrent()) serverJobPollInFlight.delete(historyId)
    }
  }

  function startServerJobPolling(historyId) {
    if (disposed || typeof window === 'undefined') return
    const item = historyItems.value.find((entry) => entry.id === historyId)
    if (!item?.serverJobId || !authStore.isAuthenticated) return
    if (!isRunningStatus(item.status)) {
      stopServerJobPolling(historyId)
      return
    }
    if (serverJobPollers.has(historyId)) return
    if (activeHistoryId.value === historyId) {
      statusText.value = formatJobStatus(item.status)
    }
    void pollColoringJob(historyId)
    const poller = window.setInterval(() => {
      void pollColoringJob(historyId)
    }, SERVER_JOB_POLL_INTERVAL_MS)
    serverJobPollers.set(historyId, poller)
  }

  function resumeServerJobPolling() {
    historyItems.value
      .filter((item) => item.serverJobId && isRunningStatus(item.status))
      .forEach((item) => startServerJobPolling(item.id))
  }

  async function listAllServerColoringJobs(
    limit = ILLUSTRATION_COLORING_VISIBLE_HISTORY_LIMIT,
  ) {
    const jobs = []
    const seenIds = new Set()
    const seenCursors = new Set()
    let cursor = ''
    while (jobs.length < limit) {
      const response = await listServerAiJobs(Math.min(80, limit - jobs.length), {
        kind: 'illustration-coloring',
        cursor,
      })
      const pageJobs = (Array.isArray(response?.jobs) ? response.jobs : []).filter((job) =>
        isColoringJobKind(job?.kind),
      )
      pageJobs.forEach((job) => {
        const id = String(job?.id || '').trim()
        if (!id || seenIds.has(id)) return
        seenIds.add(id)
        jobs.push(job)
      })
      const pagination = response?.pagination || {}
      const nextCursor = String(pagination.nextCursor || '').trim()
      if (!pagination.hasMore || !nextCursor || seenCursors.has(nextCursor) || !pageJobs.length) {
        break
      }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }
    return jobs.slice(0, limit)
  }

  async function refreshColoringJobs() {
    if (disposed || !authStore.isAuthenticated) return
    if (refreshingJobs) {
      scheduleRefreshColoringJobs(320)
      return
    }
    refreshingJobs = true
    try {
      const previousActive = historyItems.value.find((item) => item.id === activeHistoryId.value)
      const remoteJobs = await listAllServerColoringJobs()
      const localByServerId = new Map(
        historyItems.value
          .filter((item) => item.serverJobId)
          .map((item) => [item.serverJobId, item]),
      )
      const localByClientRequestId = new Map(
        historyItems.value
          .filter((item) => item.clientRequestId)
          .map((item) => [item.clientRequestId, item]),
      )
      const remoteHistory = remoteJobs.map((job) =>
        mapColoringJobToHistory(job, {
          existingItem:
            localByServerId.get(job.id) ||
            localByClientRequestId.get(String(job?.clientRequestId || '').toLowerCase()),
        }),
      )
      const remoteClientRequestIds = new Set(
        remoteJobs
          .map((job) => String(job?.clientRequestId || '').trim().toLowerCase())
          .filter(Boolean),
      )
      const orphanLocal = historyItems.value.filter(
        (item) =>
          (!item.serverJobId || !remoteJobs.some((job) => job.id === item.serverJobId)) &&
          (!item.clientRequestId || !remoteClientRequestIds.has(item.clientRequestId)),
      )
      const mergedHistory = mergeColoringHistory(remoteHistory, orphanLocal)
      const hydrationBaseVersion = historyMutationVersion
      const remoteJobById = new Map(remoteJobs.map((job) => [String(job?.id || ''), job]))
      const hydratedHistory = await Promise.all(
        mergedHistory.map(async (item) => {
          const job = item.serverJobId ? remoteJobById.get(item.serverJobId) : null
          // Only hydrate the server page that was just fetched. Older local
          // metadata stays durable and its media is resolved lazily by the
          // visible AuthenticatedImage component.
          return job ? hydrateColoringHistoryItem(item, job) : item
        }),
      )
      if (disposed) return
      const nextHistory =
        historyMutationVersion === hydrationBaseVersion
          ? hydratedHistory
          : mergeColoringHistory(hydratedHistory, historyItems.value)
      historyItems.value = nextHistory.map(sanitizeColoringHistoryError)
      historyMutationVersion += 1
      persistHistory({ immediate: true })

      if (
        activeHistoryId.value &&
        !historyItems.value.some((item) => item.id === activeHistoryId.value)
      ) {
        activeHistoryId.value = historyItems.value[0]?.id || ''
      }

      const active = historyItems.value.find((item) => item.id === activeHistoryId.value)
      if (active) {
        const statusChanged = previousActive?.status !== active.status
        const resultChanged =
          String(previousActive?.resultUrl || '') !== String(active.resultUrl || '')
        const sourceChanged =
          String(previousActive?.sourceRemoteUrl || previousActive?.sourcePreview || '') !==
          String(active.sourceRemoteUrl || active.sourcePreview || '')
        if (statusChanged || resultChanged || sourceChanged || !previousActive) {
          applyHistoryItemToUi(active, { preserveLocalBlob: Boolean(sourceBlobUrl.value) })
        } else {
          syncStatusFromActive()
        }
      }

      historyItems.value
        .filter((item) => item.serverJobId && isRunningStatus(item.status))
        .forEach((item) => startServerJobPolling(item.id))

      historyItems.value
        .filter(
          (item) =>
            isTerminalColoringJobStatus(item.status) && item.resultUrl && !item.usageRecorded,
        )
        .forEach((item) => {
          const modelKey = item.publicModelKey || resolvedPublicModelKey.value
          recordUsageIfNeeded(item, modelKey)
        })
    } catch {
      // 云端任务列表失败不影响本地历史
    } finally {
      refreshingJobs = false
    }
  }

  function scheduleRefreshColoringJobs(delay = 500) {
    if (disposed) return
    if (typeof window === 'undefined') {
      void refreshColoringJobs()
      return
    }
    if (refreshJobsTimer && typeof window !== 'undefined') window.clearTimeout(refreshJobsTimer)
    refreshJobsTimer = window.setTimeout(() => {
      refreshJobsTimer = 0
      void refreshColoringJobs()
    }, delay)
  }

  function handleRealtimeColoringJobUpdated(event) {
    const payload = event?.detail?.payload || {}
    const kind = String(payload.kind || payload.job?.kind || '').toLowerCase()
    if (kind && !kind.includes('illustration') && !kind.includes('color')) return
    const jobId = String(payload.jobId || payload.job?.id || payload.id || '').trim()
    if (jobId) {
      const historyItem = historyItems.value.find(
        (item) => String(item.serverJobId || '') === jobId,
      )
      if (historyItem?.id) {
        if (!isTerminalColoringJobStatus(historyItem.status)) {
          startServerJobPolling(historyItem.id)
        }
        void pollColoringJob(historyItem.id)
        return
      }
    }
    scheduleRefreshColoringJobs(180)
  }

  function selectHistoryItem(item) {
    if (!item) return
    newTaskMode.value = false
    if (item.id === activeHistoryId.value) return
    applyHistoryItemToUi(item)
    if (item.serverJobId && isRunningStatus(item.status)) {
      startServerJobPolling(item.id)
    }
  }

  function historyStatusLabel(item) {
    if (!item) return ''
    if (item.status === 'completed' || item.status === 'done') return '已完成'
    if (item.status === 'failed') return '失败'
    if (item.status === 'cancelled' || item.status === 'canceled') return '已取消'
    if (isPausedStatus(item.status)) return '已暂停'
    return formatJobStatus(item.status)
  }

  function historyThumb(item) {
    return String(item?.resultThumbUrl || item?.sourceThumbUrl || '').trim()
  }

  function historyTimeLabel(item) {
    return formatHistoryTime(
      item?.finishedAt || item?.updatedAt || item?.createdAt || item?.startedAt,
    )
  }

  async function startColoring(options = {}) {
    if (!ensureLogin()) return
    if (disabledMessage.value) {
      notificationService.warning(disabledMessage.value)
      return
    }
    if (!sourcePreview.value) {
      notificationService.info('请先上传线稿插画')
      return
    }
    if (
      !hasReferenceImages.value &&
      styleId.value === 'custom' &&
      customPrompt.value.trim().length < 2
    ) {
      notificationService.info('自定义模式下请至少填写 2 个字的配色描述')
      return
    }
    if (submitting.value) {
      notificationService.info('正在提交任务，请稍候')
      return
    }

    const retryHistoryId = String(options.reuseHistoryId || '').trim()
    const retryHistoryItem = retryHistoryId
      ? historyItems.value.find((item) => item.id === retryHistoryId) || null
      : null
    const replayUnknownCreate =
      options.replayUnknownCreate === true &&
      shouldReplayUnknownColoringCreate(retryHistoryItem)
    const replayCreateRequest = replayUnknownCreate ? retryHistoryItem.createRequest : null
    const modelKey = replayCreateRequest?.publicModelKey || resolvedPublicModelKey.value
    const batchCount = retryHistoryItem ? 1 : generationCount.value
    if (batchCount > availableConcurrency.value) {
      notificationService.info(
        availableConcurrency.value
          ? `当前还有 ${availableConcurrency.value} 个可用任务槽位，请先降低一次生成数量`
          : '同时最多可运行 5 个染色任务，请等待已有任务完成',
      )
      return
    }
    const costSnapshot = budgetGuard.getCostSnapshot(modelKey)

    try {
      const confirmed = await budgetGuard.confirmCostIfNeeded(modelKey, batchCount, confirmAiCost)
      if (!confirmed) return
      if (costSnapshot.billingMode === 'credits' && costSnapshot.unitCost > 0) {
        await creditsPrompt.ensureCreditsAvailable(costSnapshot.unitCost * batchCount)
      }
      budgetGuard.ensureBudgetAvailable(modelKey, batchCount, {
        getCreditAvailable: creditsPrompt.readAvailableCredits,
      })
    } catch (error) {
      if (creditsPrompt.handleCreditError(error)) return
      notificationService.error(formatColoringErrorText(error?.message || '预算检查失败'))
      return
    }

    submitting.value = true
    resultUrl.value = ''
    revealResult.value = false
    statusText.value = '准备提交…'
    const batchId = replayCreateRequest?.batchId ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    sessionStartedJobs.add(batchId)
    const styleLabel = activeStyle.value?.label || '插画染色'
    const baseTitle = String(workTitle.value || '').trim() || styleLabel || '插画染色'
    const createdAt = new Date().toISOString()
    const startedAt = Date.now()
    const historyEntries = Array.from({ length: batchCount }, (_, index) => {
      const historyId = batchCount === 1 ? `${Date.now()}` : `${Date.now()}-${index + 1}`
      const reusedHistoryId = retryHistoryItem?.id || historyId
      sessionStartedJobs.add(reusedHistoryId)
      return {
        ...(retryHistoryItem || {}),
        id: reusedHistoryId,
        serverJobId: '',
        clientRequestId: replayUnknownCreate
          ? retryHistoryItem.clientRequestId
          : crypto.randomUUID(),
        createRequest: replayCreateRequest,
        status: 'queued',
        styleId: effectiveStyleId.value,
        title: batchCount > 1 ? `${baseTitle} #${index + 1}` : baseTitle,
        customPrompt: hasReferenceImages.value ? '' : customPrompt.value,
        styleLabel: batchCount > 1 ? `${styleLabel} #${index + 1}` : styleLabel,
        batchId: replayCreateRequest?.batchId || batchId,
        variantIndex: Number(replayCreateRequest?.variantIndex || index + 1),
        variantCount: Number(replayCreateRequest?.variantCount || batchCount),
        sourceRemoteUrl: sourceRemoteUrl.value,
        sourcePreview: readPersistableSourcePreview() || sourceRemoteUrl.value,
        sourceThumbUrl: sourceThumbUrl.value,
        referenceImageUrls: readPersistableReferenceUrls(),
        referenceThumbUrls: readReferenceThumbUrls(),
        resultThumbUrl: '',
        sourceName: sourceName.value || '线稿插画',
        sourceWidth: sourceMeta.value.width || 0,
        sourceHeight: sourceMeta.value.height || 0,
        sourceBytes: sourceMeta.value.bytes || 0,
        originalWidth: originalSourceMeta.value.width || 0,
        originalHeight: originalSourceMeta.value.height || 0,
        originalBytes: originalSourceMeta.value.bytes || 0,
        originalType: originalSourceMeta.value.type || '',
        inputWidth: sourceMeta.value.width || 0,
        inputHeight: sourceMeta.value.height || 0,
        inputBytes: sourceMeta.value.bytes || 0,
        inputType: sourceMeta.value.type || '',
        outputSize: replayCreateRequest?.outputSize || settings.value.outputSize,
        outputOrientation:
          replayCreateRequest?.outputOrientation || outputOrientation.value,
        requestedOutputWidth: 0,
        requestedOutputHeight: 0,
        resultWidth: 0,
        resultHeight: 0,
        resultBytes: 0,
        resultType: '',
        outputSizeMatched: null,
        outputSizeWarning: '',
        publicModelKey: replayCreateRequest?.publicModelKey || modelKey,
        resultUrl: '',
        outputs: [],
        usageRecorded: false,
        error: '',
        createdAt: retryHistoryItem?.createdAt || createdAt,
        startedAt,
        finishedAt: 0,
      }
    })
    const primaryHistoryId = historyEntries[0]?.id || ''
    historyItems.value = retryHistoryItem
      ? historyItems.value.map((item) =>
          item.id === retryHistoryItem.id ? historyEntries[0] : item,
        )
      : [...historyEntries, ...historyItems.value].slice(0, ILLUSTRATION_COLORING_HISTORY_LIMIT)
    historyMutationVersion += 1
    activeHistoryId.value = primaryHistoryId
    persistHistory({ immediate: true })
    persistColoringDraft({ immediate: true })

    try {
      const [sourceUrl, referenceImageUrls] = replayCreateRequest
        ? [
            replayCreateRequest.sourceUrl,
            Array.isArray(replayCreateRequest.referenceImageUrls)
              ? replayCreateRequest.referenceImageUrls
              : [],
          ]
        : await Promise.all([
            prepareSourceUrl((text) => {
              statusText.value = text
            }),
            prepareReferenceImageUrls((text) => {
              statusText.value = text
            }),
          ])
      const normalizedSourceUrl = String(sourceUrl || '').trim()
      if (
        !normalizedSourceUrl ||
        normalizedSourceUrl.startsWith('blob:') ||
        !isAiTempSourceUrl(normalizedSourceUrl)
      ) {
        throw new Error('线稿未准备好，请确认上传框中有图片后重试')
      }
      const referenceThumbUrls = readReferenceThumbUrls()
      const inputMeta = {
        width: sourceMeta.value.width || originalSourceMeta.value.width || 0,
        height: sourceMeta.value.height || originalSourceMeta.value.height || 0,
        bytes: sourceMeta.value.bytes || originalSourceMeta.value.bytes || 0,
        type: sourceMeta.value.type || originalSourceMeta.value.type || '',
      }
      const requested = replayCreateRequest
        ? {
            width: Number(replayCreateRequest.outputWidth || 0),
            height: Number(replayCreateRequest.outputHeight || 0),
          }
        : resolveOutputPixelSize(
            inputMeta.width || sourceMeta.value.width || 1024,
            inputMeta.height || sourceMeta.value.height || 1024,
            settings.value.outputSize,
            outputOrientation.value,
          )
      if (inputMeta.width && inputMeta.height) {
        sourceMeta.value = {
          width: inputMeta.width,
          height: inputMeta.height,
          bytes: inputMeta.bytes || sourceMeta.value.bytes,
          type: inputMeta.type || sourceMeta.value.type,
        }
      }
      const sharedPreparedPatch = {
        sourceRemoteUrl: normalizedSourceUrl,
        sourcePreview: normalizedSourceUrl,
        sourceThumbUrl: sourceThumbUrl.value,
        referenceImageUrls,
        referenceThumbUrls,
        sourceWidth: inputMeta.width || sourceMeta.value.width || 0,
        sourceHeight: inputMeta.height || sourceMeta.value.height || 0,
        sourceBytes: inputMeta.bytes || sourceMeta.value.bytes || 0,
        originalWidth: originalSourceMeta.value.width || 0,
        originalHeight: originalSourceMeta.value.height || 0,
        originalBytes: originalSourceMeta.value.bytes || 0,
        originalType: originalSourceMeta.value.type || '',
        inputWidth: inputMeta.width || sourceMeta.value.width || 0,
        inputHeight: inputMeta.height || sourceMeta.value.height || 0,
        inputBytes: inputMeta.bytes || sourceMeta.value.bytes || 0,
        inputType: inputMeta.type || sourceMeta.value.type || '',
        outputSize: replayCreateRequest?.outputSize || settings.value.outputSize,
        outputOrientation:
          replayCreateRequest?.outputOrientation || outputOrientation.value,
        requestedOutputWidth: requested.width,
        requestedOutputHeight: requested.height,
        publicModelKey: modelKey,
      }
      historyEntries.forEach((entry) => {
        entry.createRequest = replayCreateRequest || {
          sourceUrl: normalizedSourceUrl,
          clientRequestId: entry.clientRequestId,
          styleId: effectiveStyleId.value,
          title: entry.title,
          customPrompt: hasReferenceImages.value ? '' : customPrompt.value,
          publicModelKey: modelKey,
          outputSize: settings.value.outputSize,
          outputOrientation: outputOrientation.value,
          outputWidth: requested.width,
          outputHeight: requested.height,
          referenceImageUrls,
          referenceStrength: 'balanced',
          batchId,
          variantIndex: entry.variantIndex,
          variantCount: batchCount,
          stylePreset: hasReferenceImages.value ? null : activeStyle.value,
          styleLabel: activeStyle.value?.label || '',
        }
        updateHistoryItem(entry.id, { ...sharedPreparedPatch, createRequest: entry.createRequest }, {
          persistImmediately: entry.id === primaryHistoryId,
          notifyFailure: false,
        })
      })
      statusText.value =
        batchCount > 1 ? `AI 正在并发染色（${batchCount} 张）…` : 'AI 正在染色，请稍候…'

      const jobSettled = await Promise.allSettled(
        historyEntries.map(async (entry) => {
          const { jobId, job } = await createIllustrationColoringJob(entry.createRequest)
          return { entry, jobId, job }
        }),
      )
      const createdJobs = jobSettled
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
      const failedEntries = jobSettled
        .map((result, index) =>
          result.status === 'rejected'
            ? { entry: historyEntries[index], error: result.reason }
            : null,
        )
        .filter(Boolean)
      failedEntries.forEach(({ entry, error }) => {
        updateHistoryItem(
          entry.id,
          {
            status: 'failed',
            statusConfidence: isColoringCreateOutcomeUnknown(error)
              ? 'create-response-unknown'
              : 'server-rejected',
            error: formatColoringErrorText(error?.message || '染色任务创建失败'),
            finishedAt: Date.now(),
          },
          { persistImmediately: true, notifyFailure: false },
        )
      })
      if (!createdJobs.length) {
        throw failedEntries[0]?.error || new Error('染色任务创建失败')
      }

      createdJobs.forEach(({ entry, jobId, job }) => {
        updateHistoryItem(
          entry.id,
          {
            serverJobId: jobId,
            status: job?.status || 'queued',
            sourceRemoteUrl: toColoringMediaUrl(job?.sourceMediaUrl) || normalizedSourceUrl,
            sourcePreview: toColoringMediaUrl(job?.sourceMediaUrl) || normalizedSourceUrl,
            sourceThumbUrl: sourceThumbUrl.value,
            referenceImageUrls,
            referenceThumbUrls,
            resultRemoteUrl: toColoringMediaUrl(job?.resultMediaUrl) || '',
            resultUrl: toColoringMediaUrl(job?.resultMediaUrl) || '',
          },
          { persistImmediately: true, notifyFailure: false },
        )
      })

      submitting.value = false
      newTaskMode.value = false
      createdJobs.forEach(({ entry }) => startServerJobPolling(entry.id))
      if (batchCount > 1) {
        notificationService.success(
          failedEntries.length
            ? `已提交 ${createdJobs.length} 张染色任务，${failedEntries.length} 张创建失败`
            : `已提交 ${batchCount} 张并发染色任务`,
        )
      }
      return
    } catch (error) {
      submitting.value = false
      const safeError = formatColoringErrorText(error?.message || '染色失败，请稍后重试')
      statusText.value = safeError
      historyEntries.forEach((entry) => {
        updateHistoryItem(
          entry.id,
          {
            status: 'failed',
            error: safeError,
            finishedAt: Date.now(),
          },
          { persistImmediately: true, notifyFailure: false },
        )
      })
      if (creditsPrompt.handleCreditError(error)) return
      notificationService.error(safeError)
    }
  }

  async function downloadResult() {
    if (!resultUrl.value) return
    try {
      const response = await fetch(resultUrl.value, { cache: 'no-store', credentials: 'include' })
      if (!response.ok) throw new Error('下载失败')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `walleven-coloring-${Date.now()}.png`
      link.click()
      URL.revokeObjectURL(url)
      notificationService.success('已保存染色结果')
    } catch {
      notificationService.error('下载失败，请长按图片另存')
    }
  }

  async function submitActiveToShare(publishOptions = {}) {
    const item = activeHistoryItem.value
    if (!ensureLogin()) return false
    if (!item?.serverJobId) {
      notificationService.warning('当前结果缺少云端任务 ID，无法提交共享')
      return false
    }
    if (!(item.resultUrl || item.outputs?.[0])) {
      notificationService.warning('请等待生成完成后再提交共享')
      return false
    }
    if (item.shareSubmitted) {
      notificationService.info(
        item.shareSubmissionStatus === 'approved'
          ? '该作品已经发布，无需重复提交'
          : '该作品已经提交，正在审核中',
      )
      return false
    }
    if (submittingShare.value) return false
    submittingShare.value = true
    try {
      const response = await submitShareItem({
        jobId: item.serverJobId,
        title: item.title || item.styleLabel || 'AI Share',
        styleLabel: item.styleLabel || activeStyle.value?.label || '',
        category: 'illustration',
        tags: [item.styleLabel || activeStyle.value?.label || '', 'AI 染色'].filter(Boolean),
        ...publishOptions,
      })
      const shareSubmissionStatus = String(response?.item?.status || 'pending').toLowerCase()
      updateHistoryItem(
        item.id,
        { shareSubmitted: true, shareSubmissionStatus },
        { persistImmediately: true },
      )
      notificationService.success(
        shareSubmissionStatus === 'approved'
          ? '该作品已经发布'
          : '已提交共享审核，审核通过后会展示在 Share 页面',
      )
      return true
    } catch (error) {
      notificationService.error(
        formatColoringErrorText(error?.message || '提交共享审核失败'),
      )
      return false
    } finally {
      submittingShare.value = false
    }
  }

  async function useResultAsSource() {
    if (!resultUrl.value) return
    if (submitting.value || activeJobRunning.value) {
      notificationService.info('当前任务进行中，请稍后再操作')
      return
    }
    const next = resultUrl.value
    sourceRevision += 1
    const revision = sourceRevision
    sourceRemoteRevision = 0
    sourceUploadToken += 1
    sourceUploading.value = true
    statusText.value = '正在准备二次染色源图…'
    try {
      const response = await fetch(next, { cache: 'no-store', credentials: 'include' })
      if (!response.ok) throw new Error('结果图读取失败')
      const blob = await response.blob()
      if (!blob?.size) throw new Error('结果图为空，无法二次染色')
      revokeSourceBlob()
      const blobUrl = URL.createObjectURL(blob)
      sourceBlobUrl.value = blobUrl
      sourceRemoteUrl.value = ''
      sourcePreview.value = blobUrl
      sourceThumbUrl.value = activeHistoryItem.value?.resultThumbUrl || ''
      sourceName.value = '上次染色结果'
      resultUrl.value = ''
      statusText.value = ''
      revealResult.value = false
      activeHistoryId.value = ''
      await inspectSource(blobUrl, blob.size, blob.type || '', { asOriginal: true })
      createImageThumbnailIdle(blobUrl, (thumb) => {
        if (revision !== sourceRevision || blobUrl !== sourceBlobUrl.value) return
        sourceThumbUrl.value = thumb
      })
      persistColoringDraft({ immediate: true })
      if (authStore.isAuthenticated) {
        void preuploadSourceBlob(revision)
      } else {
        sourceUploading.value = false
      }
      notificationService.success('已将结果设为新的线稿，可继续二次染色')
    } catch (error) {
      if (revision === sourceRevision) {
        sourceUploading.value = false
        statusText.value = ''
      }
      notificationService.error(
        formatColoringErrorText(error?.message || '结果图读取失败，无法二次染色'),
      )
    }
  }

  async function cancelActiveJob() {
    const item = activeHistoryItem.value
    const status = String(item?.status || '')
      .trim()
      .toLowerCase()
    if (
      !item?.serverJobId ||
      !['queued', 'running', 'waiting_provider', 'paused'].includes(status) ||
      submitting.value
    ) {
      return false
    }

    submitting.value = true
    statusText.value = status === 'paused' ? '正在取消已暂停任务…' : '正在请求取消任务…'
    try {
      const response = await cancelServerAiJob(item.serverJobId)
      if (disposed) return false
      const serverJob = response?.job || {}
      const serverStatus = String(serverJob.status || status)
        .trim()
        .toLowerCase()
      if (!isConfirmedColoringJobCancellation(response)) {
        updateHistoryItem(
          item.id,
          {
            status: serverStatus || status,
            statusConfidence: 'server',
            error: String(serverJob.error || ''),
            finishedAt: isTerminalColoringJobStatus(serverStatus) ? Date.now() : 0,
          },
          { persistImmediately: true, notifyFailure: false },
        )
        statusText.value = isPausedStatus(serverStatus)
          ? '任务仍处于暂停状态，可恢复后再取消'
          : '服务端尚未确认取消，已继续同步任务状态'
        if (!isTerminalColoringJobStatus(serverStatus)) startServerJobPolling(item.id)
        scheduleRefreshColoringJobs(180)
        notificationService.warning(statusText.value)
        return false
      }

      stopServerJobPolling(item.id)
      updateHistoryItem(
        item.id,
        {
          status: serverStatus === 'canceled' ? 'canceled' : 'cancelled',
          statusConfidence: 'server',
          error: String(serverJob.error || '任务已取消'),
          finishedAt: Date.now(),
        },
        { persistImmediately: true, notifyFailure: false },
      )
      statusText.value = '任务已取消'
      notificationService.success('任务已取消，可在原记录上重新开始')
      scheduleRefreshColoringJobs(180)
      return true
    } catch {
      if (!disposed) {
        statusText.value = '取消结果未确认，后台任务未被标记为已取消'
        startServerJobPolling(item.id)
        notificationService.error(statusText.value)
      }
      return false
    } finally {
      submitting.value = false
    }
  }

  async function retryFailedJob() {
    const item = activeHistoryItem.value
    const retryStatus = String(item?.status || '')
      .trim()
      .toLowerCase()
    if (!item || !['failed', 'cancelled', 'canceled', 'paused'].includes(retryStatus)) return
    if (!item.serverJobId && !item.sourceRemoteUrl && !sourcePreview.value) {
      notificationService.warning('缺少线稿，无法重试')
      return
    }
    if (coloringRetryMayCreatePaidRequest(item)) {
      const modelKey = item.publicModelKey || resolvedPublicModelKey.value
      const costSnapshot = budgetGuard.getCostSnapshot(modelKey)
      try {
        const confirmed = await budgetGuard.confirmCostIfNeeded(modelKey, 1, confirmAiCost)
        if (!confirmed) return
        if (costSnapshot.billingMode === 'credits' && costSnapshot.unitCost > 0) {
          await creditsPrompt.ensureCreditsAvailable(costSnapshot.unitCost)
        }
        budgetGuard.ensureBudgetAvailable(modelKey, 1, {
          getCreditAvailable: creditsPrompt.readAvailableCredits,
        })
      } catch (error) {
        if (creditsPrompt.handleCreditError(error)) return
        notificationService.error(formatColoringErrorText(error?.message || '预算检查失败'))
        return
      }
    }
    if (item.sourceRemoteUrl || item.sourcePreview || sourcePreview.value) {
      sourceRevision += 1
      const revision = sourceRevision
      const durable = toColoringMediaUrl(
        item.sourceRemoteUrl || item.sourcePreview || sourceRemoteUrl.value,
      )
      revokeSourceBlob()
      sourceRemoteUrl.value =
        durable || String(item.sourceRemoteUrl || sourceRemoteUrl.value || '').trim()
      sourcePreview.value =
        String(item.sourcePreview || item.sourceRemoteUrl || sourcePreview.value || '').trim() ||
        sourceRemoteUrl.value
      sourceThumbUrl.value = item.sourceThumbUrl || sourceThumbUrl.value || ''
      sourceName.value = item.sourceName || sourceName.value
      sourceRemoteRevision = 0
      if (sourceRemoteUrl.value || sourcePreview.value) {
        void materializeSourceFromRemote(revision, sourceRemoteUrl.value || sourcePreview.value)
      }
    }
    if (item.styleId) styleId.value = item.styleId
    if (item.customPrompt) customPrompt.value = item.customPrompt
    resultUrl.value = ''
    revealResult.value = false
    for (const type of ['success', 'error']) {
      notifiedTerminalJobs.delete(`${item.id}:${type}`)
      if (item.batchId) notifiedTerminalJobs.delete(`${item.batchId}:${type}`)
    }

    if (!item.serverJobId || item.statusConfidence === 'client-validation') {
      await startColoring({
        reuseHistoryId: item.id,
        replayUnknownCreate: shouldReplayUnknownColoringCreate(item),
      })
      return
    }

    stopServerJobPolling(item.id)
    submitting.value = true
    statusText.value = retryStatus === 'paused' ? '正在恢复原任务…' : '正在重试原任务…'
    updateHistoryItem(
      item.id,
      {
        status: 'queued',
        statusConfidence: 'local-retry',
        error: '',
        resultRemoteUrl: '',
        resultUrl: '',
        outputs: [],
        resultThumbUrl: '',
        resultWidth: 0,
        resultHeight: 0,
        resultBytes: 0,
        resultType: '',
        outputSizeMatched: null,
        outputSizeWarning: '',
        usageRecorded: false,
        startedAt: Date.now(),
        finishedAt: 0,
      },
      {
        persistImmediately: true,
        notifyFailure: false,
        allowTerminalReset: true,
      },
    )
    try {
      const response = await runServerAiJob(item.serverJobId)
      const run = response?.result || response || {}
      const status = String(run.status || 'queued')
      updateHistoryItem(
        item.id,
        {
          status,
          statusConfidence: 'server',
          error: String(run.error || ''),
          finishedAt: isTerminalColoringJobStatus(status) ? Date.now() : 0,
        },
        { persistImmediately: true, notifyFailure: false },
      )
      const refreshed = historyItems.value.find((entry) => entry.id === item.id)
      if (refreshed?.serverJobId && !isTerminalColoringJobStatus(refreshed.status)) {
        // /run 以 202 接受后立即回到前端；继续轮询同一个 serverJobId，
        // 不等待执行接口，也绝不新增历史记录。
        startServerJobPolling(item.id)
      } else if (refreshed?.serverJobId) {
        void pollColoringJob(item.id)
      }
      scheduleRefreshColoringJobs(260)
    } catch {
      // /run 的响应可能在服务端已接受后因网络中断丢失。serverJobId 已知时
      // 不能直接宣判失败，更不能新建任务；继续查询同一个原任务即可。
      const messageText = '重试请求结果未确认，正在查询原任务'
      updateHistoryItem(
        item.id,
        {
          status: 'queued',
          statusConfidence: 'provisional',
          error: messageText,
          finishedAt: 0,
        },
        {
          persistImmediately: true,
          notifyFailure: false,
          allowTerminalReset: true,
        },
      )
      statusText.value = messageText
      startServerJobPolling(item.id)
      scheduleRefreshColoringJobs(500)
      notificationService.warning(messageText)
    } finally {
      submitting.value = false
    }
  }

  function resumePausedJob() {
    return retryFailedJob()
  }

  function saveActiveResultThumbnailFromImage(imageEl) {
    const item = activeHistoryItem.value
    if (!item || item.resultThumbUrl || !imageEl?.src) return
    createImageThumbnailIdle(imageEl.src, (thumb) => {
      const active = activeHistoryItem.value
      if (!active || active.id !== item.id || active.resultThumbUrl) return
      updateHistoryItem(item.id, { resultThumbUrl: thumb }, { persistImmediately: true })
    })
  }

  function handleBeforeUnload() {
    persistColoringDraft({ immediate: true })
    persistHistory({ immediate: true })
  }

  watch([styleId, customPrompt, resultUrl, sourceRemoteUrl, activeHistoryId, compareMode], () => {
    persistColoringDraft()
  })

  watch(
    () => authStore.isAuthenticated,
    (authenticated) => {
      if (authenticated && sourceBlobUrl.value && !sourceRemoteUrl.value) {
        void preuploadSourceBlob(sourceRevision)
      }
      if (authenticated) {
        scheduleRefreshColoringJobs()
      }
    },
  )

  onMounted(async () => {
    disposed = false
    elapsedTimer = window.setInterval(() => {
      if (loading.value) elapsedNow.value = Date.now()
    }, 1000)
    loadHistory()
    restoreColoringDraft()
    const active = historyItems.value.find((item) => item.id === activeHistoryId.value)
    if (active && !sourceBlobUrl.value) {
      applyHistoryItemToUi(active, { preserveLocalBlob: true })
    }
    resumeServerJobPolling()
    syncStatusFromActive()
    pageReady.value = true
    void runtimeConfigStore.loadRuntimeConfig({ background: true }).catch(() => null)
    void authStore
      .initAuth({
        reloadLocal: false,
        skipCloudMerge: true,
      })
      .then(() => {
        if (authStore.isAuthenticated) scheduleRefreshColoringJobs()
      })
      .catch(() => null)
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload)
      window.addEventListener('pagehide', handleBeforeUnload)
      window.addEventListener('walleven:ai_job-updated', handleRealtimeColoringJobUpdated)
    }
  })

  onBeforeUnmount(() => {
    disposed = true
    handleBeforeUnload()
    pollAbortController.abort()
    stopAllServerJobPolling()
    revokeSourceBlob()
    revokeAllReferenceBlobs()
    if (refreshJobsTimer) window.clearTimeout(refreshJobsTimer)
    if (elapsedTimer) window.clearInterval(elapsedTimer)
    sessionStartedJobs.clear()
    notifiedTerminalJobs.clear()
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handleBeforeUnload)
      window.removeEventListener('walleven:ai_job-updated', handleRealtimeColoringJobUpdated)
    }
  })

  return {
    COLORING_STYLE_PRESETS,
    COLORING_STYLE_CATEGORIES,
    COLORING_OUTPUT_SIZE_OPTIONS,
    MAX_REFERENCE_IMAGES,
    styleId,
    workTitle,
    customPrompt,
    customPromptLength,
    sourcePreview,
    sourceThumbUrl,
    sourceName,
    sourceInfoText,
    referenceImages,
    sourceMeta,
    canvasAspectRatio,
    imageOrientation,
    frameAspectStyle,
    outputSizePreview,
    outputOrientation,
    resultUrl,
    revealResult,
    statusText,
    coloringElapsedText,
    stageHint,
    loading,
    submitting,
    controlsLocked,
    sourceUploading,
    hasRunningJobs,
    runningJobCount,
    availableConcurrency,
    uploadDragOver,
    favoritePickerOpen,
    openFavoritePicker,
    closeFavoritePicker,
    applyFavoriteWallpaper,
    compareMode,
    setCompareMode,
    toggleCompareMode,
    costConfirmOpen,
    pendingCost,
    historyItems,
    activeHistoryId,
    activeHistoryItem,
    pageReady,
    disabledMessage,
    creditCost,
    generationCount,
    totalCreditCost,
    canSubmit,
    activeStyle,
    authStore,
    settings,
    settingsOpen,
    debugOpen,
    submittingShare,
    debugInfo,
    publicModels,
    selectedPublicModel,
    openSettings,
    closeSettings,
    saveSettings,
    openDebugPanel,
    closeDebugPanel,
    toggleDebugPanel,
    handleFileInput,
    handleReferenceInput,
    removeReferenceImage,
    clearReferenceImages,
    handleDrop,
    triggerUpload,
    clearSource,
    startColoring,
    newTaskMode,
    beginNewColoringTask,
    downloadResult,
    submitActiveToShare,
    useResultAsSource,
    retryFailedJob,
    resumePausedJob,
    cancelActiveJob,
    saveActiveResultThumbnailFromImage,
    selectHistoryItem,
    removeHistoryItem,
    removeHistoryItems,
    historyStatusLabel,
    historyThumb,
    historyTimeLabel,
    isRunningStatus,
    goLogin,
    resolveCostConfirm,
    creditsDialogOpen: creditsPrompt.dialogOpen,
    requiredCredits: creditsPrompt.requiredCredits,
    availableCredits: creditsPrompt.availableCredits,
    closeCreditsDialog: creditsPrompt.closePrompt,
  }
}
