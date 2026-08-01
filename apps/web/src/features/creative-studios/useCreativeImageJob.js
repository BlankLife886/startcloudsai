import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAuthStore } from '@/stores/auth'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import {
  cancelServerAiJob,
  createServerAiJob,
  deleteServerAiJob,
  listServerAiJobs,
  uploadAiInputFile,
  waitForServerAiJob,
} from '@/services/aiWallpaper'
import { extractServerJobOutputs } from '@/features/ai-wallpaper/domain/mapServerJobToTask'
import { resolvePublicModelCreditCost } from '@/features/ai-shared/resolveWallpaperCreditCost'
import { useInsufficientCreditsPrompt } from '@/composables/useInsufficientCreditsPrompt'
import { formatPoints, getFeatureUnitPriceCents } from '@/services/pricing'
import { fetchAuthenticatedMediaBlob } from '@/services/authenticatedMedia'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { normalizeGptImageOutputSize } from '@/services/aiImageOutputSize'
import {
  coerceImageModelSettings,
  normalizeImageModelCapabilities,
} from '@/features/ai-shared/modelImageCapabilities'

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'waiting_provider'])
const OUTPUT_GROUP_LIMIT = 4

// 任务结果媒体是站内鉴权路径（/client/business/ai/jobs/:id/media/*），
// 上游服务商无法直接拉取，作为参考图前必须重新上传成公开的 ai-temp URL。
function isInternalJobMediaUrl(url) {
  return /\/ai\/jobs\/[^/]+\/media\//i.test(String(url || ''))
}

export function useCreativeImageJob(options = {}) {
  const router = useRouter()
  const runtimeConfigStore = useRuntimeConfigStore()
  const authStore = useAuthStore()
  const modelId = ref('')
  const status = ref('')
  const error = ref('')
  const running = ref(false)
  const outputs = ref([])
  const activeOutput = ref('')
  const lastJobId = ref('')
  const cancelling = ref(false)
  const historyLoading = ref(false)
  const historyHydrated = ref(false)
  const historyHasMore = ref(false)
  const historyLoadingVariants = ref({})
  const historyHasMoreVariants = ref({})
  let historyCursors = {}
  let historyBatchAttemptTimes = new Map()
  let lastHistoryJobs = []
  const outputJobIds = ref({})
  // outputs 始终保存可下载/编辑的原图；列表与胶片条通过此映射读取缩略图。
  const outputPreviewUrls = ref({})
  const outputGroups = ref({})
  const outputGroupIndexes = ref({})
  const outputGroupSizes = ref({})
  const outputAspectRatios = ref({})
  const outputTimings = ref({})
  const outputParents = ref({})
  const batchProgress = ref([])
  const batchFailures = ref([])
  const generationTasks = ref([])
  const batchRetryContexts = new Map()
  const generationRunContexts = new Map()
  const generationTaskRemovalTimers = new Set()
  let controller = new AbortController()
  let cancelRequested = false
  const activeJobIds = new Set()
  const featureKey = String(options.featureKey || 'ai.optimize')
  const preferOriginalOutputs = options.preferOriginalOutputs === true
  const initialHistoryLimit = Math.max(1, Math.min(Number(options.initialHistoryLimit) || 12, 100))
  const creditsPrompt = useInsufficientCreditsPrompt()
  // 服务端任务单价（积分/张），null 表示读取失败（提交按钮附近显示「以服务端结算为准」）
  const unitPriceCents = ref(null)
  const jobKindPrefix = String(options.jobKindPrefix || 'image')
  // 可选的子类型集合（如游戏工作台的 character/prop…），任务 kind 会带上子类型，
  // 让历史记录能按子类型归类展示。
  const kindVariants = Array.isArray(options.kindVariants)
    ? options.kindVariants.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const outputKinds = ref({})
  const groupStoreKey = `creative-output-groups-${jobKindPrefix}-v2`
  const legacyGroupStoreKey = `creative-output-groups-${jobKindPrefix}-v1`

  try {
    const parsed = JSON.parse(getScopedLocalItem(groupStoreKey) || '{}')
    if (parsed?.version === 2) {
      outputGroups.value = parsed.groups && typeof parsed.groups === 'object' ? parsed.groups : {}
      outputGroupIndexes.value =
        parsed.indexes && typeof parsed.indexes === 'object' ? parsed.indexes : {}
      outputGroupSizes.value = parsed.sizes && typeof parsed.sizes === 'object' ? parsed.sizes : {}
    } else {
      const legacy = JSON.parse(getScopedLocalItem(legacyGroupStoreKey) || '{}')
      if (legacy && typeof legacy === 'object') {
        const indexes = {}
        const sizes = {}
        for (const [url, rawGroupId] of Object.entries(legacy)) {
          const groupId = String(rawGroupId || '').trim()
          if (!url || !groupId) continue
          const index = sizes[groupId] || 0
          outputGroups.value[url] = groupId
          indexes[url] = index
          sizes[groupId] = index + 1
        }
        outputGroupIndexes.value = indexes
        outputGroupSizes.value = sizes
      }
    }
  } catch {
    outputGroups.value = {}
    outputGroupIndexes.value = {}
    outputGroupSizes.value = {}
  }

  function persistGroups() {
    const entries = Object.entries(outputGroups.value)
    // 只保留最近的映射，避免 localStorage 无限膨胀。
    const groups =
      entries.length > 240 ? Object.fromEntries(entries.slice(-240)) : outputGroups.value
    const indexes = Object.fromEntries(
      Object.keys(groups).map((url) => [
        url,
        Math.max(0, Number(outputGroupIndexes.value[url]) || 0),
      ]),
    )
    const retainedGroupIds = new Set(Object.values(groups))
    const sizes = Object.fromEntries(
      Object.entries(outputGroupSizes.value).filter(([groupId]) => retainedGroupIds.has(groupId)),
    )
    setScopedLocalItem(groupStoreKey, JSON.stringify({ version: 2, groups, indexes, sizes }))
  }

  function rememberOutputGroup(urls, groupId, options = {}) {
    if (!groupId) return
    const overwrite = options.overwrite !== false
    const startIndex = Math.max(0, Number(options.index) || 0)
    const declaredSize = Math.max(
      startIndex + urls.length,
      Number(options.size) || 0,
      Number(outputGroupSizes.value[groupId]) || 0,
    )
    const nextGroups = { ...outputGroups.value }
    const nextIndexes = { ...outputGroupIndexes.value }
    const nextSizes = { ...outputGroupSizes.value, [groupId]: declaredSize }
    let changed = false
    urls.forEach((url, offset) => {
      if (!url) return
      if (!overwrite && nextGroups[url]) return
      const index = startIndex + offset
      if (nextGroups[url] === groupId && nextIndexes[url] === index) return
      nextGroups[url] = groupId
      nextIndexes[url] = index
      changed = true
    })
    if (!changed && outputGroupSizes.value[groupId] === declaredSize) return
    outputGroups.value = nextGroups
    outputGroupIndexes.value = nextIndexes
    outputGroupSizes.value = nextSizes
    persistGroups()
  }

  function rememberOutputAspectRatio(urls, value) {
    const aspectRatio = String(value || '').trim()
    if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(aspectRatio)) return
    const next = { ...outputAspectRatios.value }
    let changed = false
    for (const url of urls) {
      if (!url || next[url] === aspectRatio) continue
      next[url] = aspectRatio
      changed = true
    }
    if (changed) outputAspectRatios.value = next
  }

  function rememberOutputParent(urls, value) {
    const parent = String(value || '').trim()
    if (!parent) return
    const next = { ...outputParents.value }
    let changed = false
    for (const url of urls) {
      if (!url || next[url] === parent) continue
      next[url] = parent
      changed = true
    }
    if (changed) outputParents.value = next
  }

  function readJobBatchMeta(job = {}) {
    const params =
      job?.input && typeof job.input === 'object'
        ? job.input
        : job?.params && typeof job.params === 'object'
          ? job.params
          : {}
    const id = String(params.batchId || '').trim()
    const index = Math.max(0, Number(params.batchIndex) || 0)
    const size = Math.max(index + 1, Number(params.batchSize) || 1)
    return {
      id,
      index,
      size,
      createdAt: String(params.batchCreatedAt || '').trim(),
    }
  }

  function createGroupId() {
    return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  function syncGenerationState() {
    const activeTasks = generationTasks.value.filter(
      (task) => task.state === 'running' || task.state === 'cancelling',
    )
    running.value = activeTasks.length > 0
    cancelling.value = activeTasks.some((task) => task.state === 'cancelling')
    const latest = activeTasks[0]
    if (latest) {
      status.value = latest.status
      batchProgress.value = latest.progress
    }
  }

  function patchGenerationTask(taskId, patch) {
    generationTasks.value = generationTasks.value.map((task) =>
      task.id === taskId ? { ...task, ...patch } : task,
    )
    syncGenerationState()
  }

  function removeGenerationTask(taskId) {
    generationTasks.value = generationTasks.value.filter((task) => task.id !== taskId)
    syncGenerationState()
  }

  function rememberBatchFailure(groupId, index, item, message) {
    const contextItem = batchRetryContexts.get(groupId)?.items?.[index]
    const failure = {
      groupId,
      index,
      label: String(item?.viewLabel || '') || `第 ${index + 1} 张`,
      kindVariant: String(item?.kindVariant || contextItem?.kindVariant || ''),
      jobId: String(item?.jobId || ''),
      message: sanitizeCreativeError(message || '生成失败'),
    }
    batchFailures.value = [
      ...batchFailures.value.filter((entry) => entry.groupId !== groupId || entry.index !== index),
      failure,
    ]
    historyBatchAttemptTimes.set(
      `${groupId}:${index}`,
      Math.max(historyBatchAttemptTimes.get(`${groupId}:${index}`) || 0, Date.now()),
    )
  }

  function clearBatchFailure(groupId, index, { releaseContext = true } = {}) {
    batchFailures.value = batchFailures.value.filter(
      (entry) => entry.groupId !== groupId || entry.index !== index,
    )
    if (releaseContext && !batchFailures.value.some((entry) => entry.groupId === groupId)) {
      batchRetryContexts.delete(groupId)
    }
  }

  async function deleteBatchFailure(groupIdValue, indexValue) {
    const groupId = String(groupIdValue || '').trim()
    const index = Math.max(0, Number(indexValue) || 0)
    const failure = batchFailures.value.find(
      (entry) => entry.groupId === groupId && entry.index === index,
    )
    if (!failure) return false
    if (failure.jobId) await deleteServerAiJob(failure.jobId)
    clearBatchFailure(groupId, index)
    historyBatchAttemptTimes.delete(`${groupId}:${index}`)
    return true
  }

  function buildJobKind(variant, mode) {
    const suffix = String(variant || '').trim()
    return suffix ? `${jobKindPrefix}-${suffix}-${mode}` : `${jobKindPrefix}-${mode}`
  }

  function resolveJobOutputUrls(job = {}, result = null) {
    const originals = [
      ...(Array.isArray(job?.originalMediaUrls) ? job.originalMediaUrls : []),
      ...(Array.isArray(job?.originalResultMediaUrls) ? job.originalResultMediaUrls : []),
      job?.originalMediaUrl,
      job?.originalResultMediaUrl,
    ]
    const extracted = result ? extractServerJobOutputs(result) : []
    const expectedCountValue = Number(job?.count ?? job?.input?.count ?? job?.params?.count)
    const expectedCount =
      Number.isFinite(expectedCountValue) && expectedCountValue > 0
        ? Math.min(Math.floor(expectedCountValue), OUTPUT_GROUP_LIMIT)
        : OUTPUT_GROUP_LIMIT
    if (preferOriginalOutputs) {
      const originalCandidates = [...originals, ...extracted]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      if (originalCandidates.length) {
        return Array.from(new Set(originalCandidates)).slice(0, expectedCount)
      }
    }
    return Array.from(
      new Set(
        [
          ...(Array.isArray(job?.resultMediaUrls) ? job.resultMediaUrls : []),
          job?.resultMediaUrl,
          ...extracted,
        ]
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    ).slice(0, expectedCount)
  }

  function rememberJobOutputPreviews(outputUrls, job = {}) {
    if (!Array.isArray(outputUrls) || !outputUrls.length) return
    const hasDedicatedThumbnails = Array.isArray(job?.thumbnailKeys)
      ? job.thumbnailKeys.length > 0
      : false
    const thumbnails = hasDedicatedThumbnails
      ? [...(Array.isArray(job?.resultMediaUrls) ? job.resultMediaUrls : []), job?.resultMediaUrl]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : []
    const originals = [
      ...(Array.isArray(job?.originalMediaUrls) ? job.originalMediaUrls : []),
      ...(Array.isArray(job?.originalResultMediaUrls) ? job.originalResultMediaUrls : []),
      job?.originalMediaUrl,
      job?.originalResultMediaUrl,
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    const next = { ...outputPreviewUrls.value }
    outputUrls.forEach((url, outputIndex) => {
      if (!url) return
      const originalIndex = originals.indexOf(url)
      const index = originalIndex >= 0 ? originalIndex : outputIndex
      next[url] = thumbnails[index] || thumbnails[outputIndex] || url
    })
    outputPreviewUrls.value = next
  }

  // 有子类型的工作台只查询带类型的任务，早期未分类任务不混入任一类型。
  function historyKinds() {
    if (!kindVariants.length) return [`${jobKindPrefix}-generation`, `${jobKindPrefix}-edit`]
    return kindVariants.flatMap((variant) => [
      buildJobKind(variant, 'generation'),
      buildJobKind(variant, 'edit'),
    ])
  }

  function rememberOutputKind(urls, kind) {
    if (!kind) return
    const next = { ...outputKinds.value }
    let changed = false
    for (const url of urls) {
      if (!url || next[url] === kind) continue
      next[url] = kind
      changed = true
    }
    if (changed) outputKinds.value = next
  }
  const outputLongSide = Math.max(1024, Math.min(Number(options.outputLongSide) || 1536, 2048))

  const models = computed(() => {
    const feature = runtimeConfigStore.getFeaturePayload(featureKey) || {}
    const publicModels = Array.isArray(feature.publicModels) ? feature.publicModels : []
    const usablePublic = publicModels
      .map((item) => ({
        id: String(item.id || item.publicModelKey || ''),
        label: String(item.label || item.id || item.publicModelKey || ''),
        publicModelKey: String(item.id || item.publicModelKey || ''),
        provider: String(item.providerName || item.provider || ''),
        resolutions: Array.isArray(item.resolutions)
          ? item.resolutions.map((value) => String(value || '').toUpperCase()).filter(Boolean)
          : [],
        default: item.default === true,
        fastMode: item.fastMode === true,
        creditCost: resolvePublicModelCreditCost(item, feature),
        pricePoints: Number(item.pricePoints ?? item.creditCost ?? 0),
        standardPricePoints: Number(
          item.standardPricePoints ?? item.pricePoints ?? item.creditCost ?? 0,
        ),
        discountPricePoints:
          item.discountPricePoints === null || item.discountPricePoints === undefined
            ? null
            : Number(item.discountPricePoints),
        userPriceUsd: Number(item.userPriceUsd || 0),
        ...normalizeImageModelCapabilities(item),
      }))
      .filter((item) => item.id)
    if (usablePublic.length) return usablePublic
    const catalog = runtimeConfigStore.getAiModelCatalog()
    return (catalog.providers || [])
      .flatMap((provider) =>
        (provider.models || []).map((item) => ({
          id: String(item.id || item.model || ''),
          label: String(item.label || item.name || item.id || ''),
          publicModelKey: '',
          provider: String(provider.id || provider.providerKey || ''),
        })),
      )
      .filter((item) => item.id)
  })

  const selectedModel = computed(() => {
    const selected =
      models.value.find((item) => item.id === modelId.value) || models.value[0] || null
    if (selected && !modelId.value) modelId.value = selected.id
    return selected
  })

  async function initialize() {
    void getFeatureUnitPriceCents(featureKey)
      .then((value) => {
        unitPriceCents.value = value
      })
      .catch(() => null)
    try {
      await Promise.all([
        runtimeConfigStore.loadRuntimeConfig({ force: true }).catch(() => null),
        authStore.initAuth().catch(() => null),
      ])
      if (!modelId.value) modelId.value = models.value[0]?.id || ''
      // 首屏先完成历史归组，再一次性开放画布；运行中任务会同步登记后继续后台轮询。
      if (authStore.isAuthenticated) {
        await loadHistory(initialHistoryLimit).catch(() => [])
        void resumeActiveJobs(lastHistoryJobs).catch(() => null)
      }
    } finally {
      historyHydrated.value = true
    }
  }

  function resolveRunnableModel(prompt) {
    error.value = ''
    status.value = ''
    if (!authStore.isAuthenticated) {
      // 直接带回跳参数去登录页，避免用户停在一条静态错误提示上
      router.push({
        path: '/auth',
        query: createLoginRedirectQuery(router.currentRoute.value.fullPath),
      })
      return null
    }
    if (!runtimeConfigStore.canUse(featureKey)) {
      error.value = '该功能当前未启用，或后台还没有分配可用模型。'
      return null
    }
    const model = selectedModel.value
    if (!model) {
      error.value = '后台还没有为图片工作台分配可用模型。'
      return null
    }
    if (!prompt) {
      error.value = '请先填写生成要求。'
      return null
    }
    return model
  }

  function resolveOutputSize(input = {}) {
    const explicit = String(input.outputSize || input.size || '')
      .trim()
      .toLowerCase()
    if (/^\d{2,5}x\d{2,5}$/.test(explicit)) return explicit
    const [rawW, rawH] = String(input.aspectRatio || '1:1')
      .split(':')
      .map((part) => Number(part))
    const ratioW = Number.isFinite(rawW) && rawW > 0 ? rawW : 1
    const ratioH = Number.isFinite(rawH) && rawH > 0 ? rawH : 1
    const width = ratioW >= ratioH ? outputLongSide : (outputLongSide * ratioW) / ratioH
    const height = ratioW >= ratioH ? (outputLongSide * ratioH) / ratioW : outputLongSide
    const normalized = normalizeGptImageOutputSize(width, height)
    return `${normalized.width}x${normalized.height}`
  }

  async function runImageJob(input, model, source, onStatus = () => {}, runContext = null) {
    onStatus('正在创建云端任务...')
    const count = Math.max(1, Math.min(Number(input.count) || 1, 4))
    const sourceKeys = Array.from(
      new Set(
        (Array.isArray(input.sourceKeys) ? input.sourceKeys : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    )
    const sourceList = Array.isArray(source) ? source.filter(Boolean) : source ? [source] : []
    const sourceUrl = sourceList[0] || ''
    const maskUrl = String(input.maskUrl || '').trim()
    const modelSettings = coerceImageModelSettings(model, {
      aspectRatio: input.aspectRatio,
      quality: input.quality,
      transparentBackground: input.transparentPngEnabled,
      outputFormat: input.outputFormat || input.upscaleOutputFormat,
      moderationLevel: input.moderationLevel,
    })
    // 尺寸必须按模型最终接受的比例计算，避免控件旧值与切换后的模型能力不一致。
    const outputSize = resolveOutputSize({ ...input, aspectRatio: modelSettings.aspectRatio })
    const shared = {
      sourceUrl,
      sourceUrls: sourceList,
      ...(maskUrl ? { maskUrl, mask: maskUrl } : {}),
      aspectRatio: modelSettings.aspectRatio,
      size: outputSize,
      outputSize,
      count,
      transparentPngEnabled: modelSettings.transparentBackground,
      transparentBackground: modelSettings.transparentBackground,
      upscaleOutputFormat: modelSettings.transparentBackground
        ? 'png'
        : String(input.upscaleOutputFormat || 'auto'),
      ...(modelSettings.outputFormat ? { outputFormat: modelSettings.outputFormat } : {}),
      ...(modelSettings.moderationLevel ? { moderationLevel: modelSettings.moderationLevel } : {}),
      quality: modelSettings.quality,
      ...(input.platform ? { platform: String(input.platform) } : {}),
      iterationMode: input.iterationMode === true,
      parentOutputUrl: String(input.parentOutputUrl || ''),
      viewId: String(input.viewId || ''),
      viewLabel: String(input.viewLabel || ''),
      outputMode: String(input.outputMode || ''),
      batchId: String(input.batchId || input.groupId || ''),
      batchIndex: Math.max(0, Number(input.batchIndex) || 0),
      batchSize: Math.max(1, Number(input.batchSize) || count),
      batchCreatedAt: String(input.batchCreatedAt || ''),
    }
    const jobKind = buildJobKind(input.kindVariant, sourceUrl ? 'edit' : 'generation')
    const response = await createServerAiJob({
      kind: jobKind,
      // 每个任务一个幂等键，经适配层映射为服务端 idempotencyKey
      clientRequestId: crypto.randomUUID(),
      inputKeys: sourceKeys,
      prompt: String(input.prompt || '').trim(),
      input: {
        source: options.source || 'creative-studio',
        ...shared,
      },
      params: {
        providerHint: model.publicModelKey ? '' : model.provider,
        modelHint: model.id,
        publicModelKey: model.publicModelKey,
        ...shared,
        executionMode: 'server',
      },
      units: count,
    })
    const jobId = response.job?.id
    if (!jobId) throw new Error('任务创建后未返回任务 ID')
    lastJobId.value = jobId
    const jobIds = runContext?.jobIds || activeJobIds
    const signal = runContext?.controller?.signal || controller.signal
    jobIds.add(jobId)
    if (runContext?.cancelRequested) {
      await cancelServerAiJob(jobId).catch(() => undefined)
      jobIds.delete(jobId)
      throw new DOMException('任务已取消', 'AbortError')
    }
    let completed
    const streamedOutputs = new Set()
    try {
      completed = await waitForServerAiJob(jobId, {
        intervalMs: 2500,
        maxPolls: 260,
        signal,
        onStatus,
        onImage: (partialOutputs, partialJob, partialResult) => {
          const resolved = resolveJobOutputUrls(partialJob, partialResult)
          rememberJobOutputPreviews(resolved, partialJob)
          const fresh = resolved.filter((url) => !streamedOutputs.has(url))
          if (!fresh.length) return
          fresh.forEach((url) => streamedOutputs.add(url))
          rememberOutputKind(fresh, jobKind)
          prependOutputs(fresh, jobId, String(input.batchId || input.groupId || jobId), {
            index: input.batchIndex,
            size: input.batchSize,
            aspectRatio: modelSettings.aspectRatio,
            parentOutputUrl: input.parentOutputUrl,
            activate: true,
            createdAt: response.job?.createdAt || input.batchCreatedAt,
            startedAt: partialJob?.startedAt,
          })
        },
      })
    } catch (caught) {
      if (caught && typeof caught === 'object' && !caught.jobId) caught.jobId = jobId
      throw caught
    } finally {
      jobIds.delete(jobId)
    }
    const nextOutputs = resolveJobOutputUrls(completed.job, completed.result)
    rememberJobOutputPreviews(nextOutputs, completed.job)
    if (!nextOutputs.length) {
      const missingOutputError = new Error('任务已完成，但没有返回可用图片')
      missingOutputError.jobId = jobId
      throw missingOutputError
    }
    rememberOutputKind(nextOutputs, jobKind)
    return {
      jobId,
      outputs: nextOutputs,
      createdAt: String(
        completed.job?.createdAt || response.job?.createdAt || input.batchCreatedAt || '',
      ),
      startedAt: String(completed.job?.startedAt || response.job?.startedAt || ''),
      finishedAt: String(completed.job?.finishedAt || new Date().toISOString()),
    }
  }

  async function rehostInternalUrl(url) {
    const trimmed = String(url || '').trim()
    if (!trimmed || !isInternalJobMediaUrl(trimmed)) return trimmed
    status.value = '正在准备参考图...'
    const blob = await fetchAuthenticatedMediaBlob(trimmed, { cache: 'no-store' })
    const file = new File([blob], `reference-${Date.now()}.png`, {
      type: blob.type || 'image/png',
    })
    return uploadAiInputFile(file, { featureKey })
  }

  // 支持多参考图：files + sourceUrls 全部归一成上游可访问的 URL 列表。
  async function resolveSourceList(input = {}, model = selectedModel.value) {
    const list = []
    const files = Array.isArray(input.files)
      ? input.files.filter(Boolean)
      : input.file
        ? [input.file]
        : []
    if (files.length) {
      status.value = '正在上传参考图...'
      list.push(
        ...(await Promise.all(files.map((file) => uploadAiInputFile(file, { featureKey })))),
      )
    }
    const urls = Array.isArray(input.sourceUrls)
      ? input.sourceUrls
      : input.sourceUrl
        ? [input.sourceUrl]
        : []
    const resolvedUrls = await Promise.all(urls.map((url) => rehostInternalUrl(url)))
    list.push(...resolvedUrls.filter(Boolean))
    const limit = normalizeImageModelCapabilities(model || {}).maxReferenceImages
    return Array.from(new Set(list)).slice(0, limit)
  }

  function rememberOutputJob(urls, jobId) {
    if (!jobId) return
    const next = { ...outputJobIds.value }
    for (const url of urls) next[url] = jobId
    outputJobIds.value = next
  }

  function rememberOutputTiming(urls, timing = {}) {
    const createdAt = String(timing.createdAt || '').trim()
    const startedAt = String(timing.startedAt || '').trim()
    const finishedAt = String(timing.finishedAt || '').trim()
    if (!createdAt && !startedAt && !finishedAt) return
    const next = { ...outputTimings.value }
    for (const url of urls) {
      if (!url) continue
      next[url] = { createdAt, startedAt, finishedAt }
    }
    outputTimings.value = next
  }

  function prependOutputs(nextOutputs, jobId = '', groupId = '', groupMeta = {}) {
    rememberOutputJob(nextOutputs, jobId)
    rememberOutputTiming(nextOutputs, groupMeta)
    rememberOutputGroup(nextOutputs, groupId || jobId, groupMeta)
    rememberOutputAspectRatio(nextOutputs, groupMeta.aspectRatio)
    rememberOutputParent(nextOutputs, groupMeta.parentOutputUrl)
    if (groupId && Number.isFinite(Number(groupMeta.index))) {
      const key = `${groupId}:${Math.max(0, Number(groupMeta.index) || 0)}`
      const attemptedAt =
        Date.parse(groupMeta.finishedAt || groupMeta.startedAt || groupMeta.createdAt || '') ||
        Date.now()
      historyBatchAttemptTimes.set(
        key,
        Math.max(historyBatchAttemptTimes.get(key) || 0, attemptedAt),
      )
    }
    outputs.value = Array.from(new Set([...nextOutputs, ...outputs.value]))
    if (groupMeta.activate !== false) activeOutput.value = nextOutputs[0] || activeOutput.value
  }

  async function deleteOutput(url) {
    const target = String(url || '').trim()
    if (!target) return false
    const jobId = outputJobIds.value[target] || ''
    if (jobId) await deleteServerAiJob(jobId)
    // 同一任务可能有多张结果图，云端删除是按任务删除的，本地同步移除。
    const removed = jobId
      ? outputs.value.filter((item) => outputJobIds.value[item] === jobId)
      : [target]
    outputs.value = outputs.value.filter((item) => !removed.includes(item))
    const next = { ...outputJobIds.value }
    const nextGroups = { ...outputGroups.value }
    const nextGroupIndexes = { ...outputGroupIndexes.value }
    const nextAspectRatios = { ...outputAspectRatios.value }
    const nextTimings = { ...outputTimings.value }
    const nextParents = { ...outputParents.value }
    const nextKinds = { ...outputKinds.value }
    const nextPreviewUrls = { ...outputPreviewUrls.value }
    for (const item of removed) {
      delete next[item]
      delete nextGroups[item]
      delete nextGroupIndexes[item]
      delete nextAspectRatios[item]
      delete nextTimings[item]
      delete nextParents[item]
      delete nextKinds[item]
      delete nextPreviewUrls[item]
    }
    outputJobIds.value = next
    outputGroups.value = nextGroups
    outputGroupIndexes.value = nextGroupIndexes
    outputAspectRatios.value = nextAspectRatios
    outputTimings.value = nextTimings
    outputParents.value = nextParents
    outputKinds.value = nextKinds
    outputPreviewUrls.value = nextPreviewUrls
    persistGroups()
    if (removed.includes(activeOutput.value)) activeOutput.value = outputs.value[0] || ''
    return true
  }

  async function generate(input = {}) {
    const allowWhileRunning = input.allowWhileRunning === true
    if (running.value && !allowWhileRunning) return []
    const count = Math.max(1, Math.min(Number(input.count) || 1, 4))
    // 每次提交都是独立批次；即使只有一张，也走同一任务会话模型。
    const result = await generateBatch(
      Array.from({ length: count }, (_, index) => ({
        ...input,
        count: 1,
        viewLabel:
          count > 1
            ? String(input.viewLabel || '')
              ? `${String(input.viewLabel).trim()} ${index + 1}`
              : `方案 ${index + 1}`
            : String(input.viewLabel || '') || '生成图片',
      })),
      {
        files: input.files,
        file: input.file,
        sourceUrls: input.sourceUrls,
        sourceUrl: input.sourceUrl,
        concurrency: count,
        groupId: String(input.groupId || ''),
        allowWhileRunning,
      },
    )
    return result.outputs
  }

  async function generateBatch(items = [], batchOptions = {}) {
    if (running.value && batchOptions.allowWhileRunning !== true) {
      return { outputs: [], items: [], failures: [], groupId: '' }
    }
    const rawInputs = (Array.isArray(items) ? items : [])
      .map((item) => ({ ...item, prompt: String(item?.prompt || '').trim() }))
      .filter((item) => item.prompt)
    const model = batchOptions.model || resolveRunnableModel(rawInputs[0]?.prompt || '')
    if (!model || !rawInputs.length) return { outputs: [], items: [], groupId: '' }
    const groupId = String(batchOptions.groupId || '') || createGroupId()
    const batchCreatedAt = String(batchOptions.batchCreatedAt || '') || new Date().toISOString()
    const preserveBatchMeta = batchOptions.preserveBatchMeta === true
    const inputs = rawInputs.map((item, index) => ({
      ...item,
      count: 1,
      batchId: groupId,
      batchIndex: preserveBatchMeta ? Math.max(0, Number(item.batchIndex) || 0) : index,
      batchSize: preserveBatchMeta
        ? Math.max(1, Number(item.batchSize) || rawInputs.length)
        : rawInputs.length,
      batchCreatedAt: preserveBatchMeta
        ? String(item.batchCreatedAt || batchCreatedAt)
        : batchCreatedAt,
    }))
    // 批次先登记槽位总数，即使全部失败，画布仍能还原对应失败位置。
    rememberOutputGroup([], groupId, { size: inputs.length })
    const taskId = `${groupId}:${crypto.randomUUID()}`
    const progress = inputs.map((item, index) => ({
      groupId,
      index: item.batchIndex ?? index,
      label: String(item.viewLabel || '') || `第 ${index + 1} 张`,
      status: 'pending',
      message: '',
    }))
    const runContext = {
      controller: new AbortController(),
      jobIds: new Set(),
      cancelRequested: false,
    }
    generationRunContexts.set(taskId, runContext)
    generationTasks.value = [
      {
        id: taskId,
        groupId,
        label: String(inputs[0]?.viewLabel || '生成任务').replace(/\s+[1-4]$/, ''),
        kindVariant: String(inputs[0]?.kindVariant || ''),
        previewUrl: String(inputs[0]?.referencePreviewUrl || ''),
        state: 'running',
        status: '正在准备生成任务',
        progress,
        completedCount: 0,
        totalCount: inputs.length,
        createdAt: batchCreatedAt,
        finishedAt: '',
      },
      ...generationTasks.value,
    ]
    syncGenerationState()
    const results = new Array(inputs.length)
    const failures = []
    let completedCount = 0
    let cursor = 0
    const markProgress = (index, state, details = {}) => {
      const task = generationTasks.value.find((entry) => entry.id === taskId)
      const nextProgress = (task?.progress || progress).map((entry, at) =>
        at === index ? { ...entry, status: state, ...details } : entry,
      )
      patchGenerationTask(taskId, { progress: nextProgress })
    }
    const updateTaskStatus = (message) => {
      patchGenerationTask(taskId, { status: String(message || '') })
    }
    try {
      updateTaskStatus('正在准备参考图')
      const sourceList = await resolveSourceList(
        {
          files: batchOptions.files,
          file: batchOptions.file,
          sourceUrls: batchOptions.sourceUrls,
          sourceUrl: batchOptions.sourceUrl,
        },
        model,
      )
      if (!preserveBatchMeta) {
        batchRetryContexts.set(groupId, {
          groupId,
          model,
          sourceList: [...sourceList],
          items: inputs.map((item) => ({ ...item })),
        })
      }
      // 无参考图时可选用第一张成功结果作为后续视图的参考，
      // 保证同批多视图输出的是同一个主体。
      const chainFirstOutput = batchOptions.chainFirstOutputAsSource === true && !sourceList.length
      let effectiveSourceList = sourceList
      const concurrency = chainFirstOutput
        ? 1
        : Math.max(1, Math.min(Number(batchOptions.concurrency) || inputs.length, 4))
      const worker = async () => {
        while (cursor < inputs.length && !runContext.cancelRequested) {
          const index = cursor
          cursor += 1
          const item = inputs[index]
          try {
            markProgress(index, 'running')
            updateTaskStatus(
              `正在生成 ${item.viewLabel || `第 ${index + 1} 张`} · ${completedCount}/${inputs.length}`,
            )
            const result = await runImageJob(
              item,
              model,
              effectiveSourceList,
              updateTaskStatus,
              runContext,
            )
            results[index] = { ...item, jobId: result.jobId, outputs: result.outputs }
            prependOutputs(result.outputs, result.jobId, groupId, {
              index: item.batchIndex,
              size: item.batchSize,
              aspectRatio: item.aspectRatio,
              parentOutputUrl: item.parentOutputUrl,
              activate: generationTasks.value[0]?.id === taskId,
              createdAt: result.createdAt,
              startedAt: result.startedAt,
              finishedAt: result.finishedAt,
            })
            clearBatchFailure(groupId, item.batchIndex ?? index, { releaseContext: false })
            markProgress(index, 'done', {
              jobId: result.jobId,
              outputs: result.outputs,
            })
            if (chainFirstOutput && !effectiveSourceList.length && result.outputs[0]) {
              effectiveSourceList = await resolveSourceList(
                {
                  sourceUrl: result.outputs[0],
                },
                model,
              ).catch(() => [])
            }
          } catch (caught) {
            const message = sanitizeCreativeError(caught?.message || '生成失败')
            markProgress(index, runContext.cancelRequested ? 'cancelled' : 'failed', { message })
            creditsPrompt.handleCreditError(caught)
            const failedItem = { ...item, jobId: String(caught?.jobId || '') }
            failures.push({ index: item.batchIndex ?? index, item: failedItem, message })
            if (!runContext.cancelRequested) {
              rememberBatchFailure(groupId, item.batchIndex ?? index, failedItem, message)
            }
          } finally {
            completedCount += 1
            patchGenerationTask(taskId, {
              completedCount,
              status: `生成进度 ${completedCount}/${inputs.length}`,
            })
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()),
      )
      const completedItems = results.filter(Boolean)
      const nextOutputs = completedItems.flatMap((item) => item.outputs)
      if (runContext.cancelRequested) {
        const task = generationTasks.value.find((entry) => entry.id === taskId)
        const cancelledProgress = (task?.progress || progress).map((entry) =>
          entry.status === 'pending' || entry.status === 'running'
            ? { ...entry, status: 'cancelled' }
            : entry,
        )
        patchGenerationTask(taskId, {
          state: 'cancelled',
          progress: cancelledProgress,
          status: completedItems.length
            ? `已取消，保留 ${completedItems.length} 张已完成图片`
            : '任务已取消',
          finishedAt: new Date().toISOString(),
        })
        error.value = ''
        if (!batchFailures.value.some((entry) => entry.groupId === groupId)) {
          batchRetryContexts.delete(groupId)
        }
        return { outputs: nextOutputs, items: completedItems, failures, groupId }
      }
      if (!nextOutputs.length) throw new Error(failures[0]?.message || '本次批量生成全部失败')
      outputs.value = Array.from(new Set([...nextOutputs, ...outputs.value]))
      if (generationTasks.value[0]?.id === taskId) activeOutput.value = nextOutputs[0]
      const finalStatus = failures.length
        ? `已完成 ${completedItems.length}/${inputs.length} 张`
        : `${inputs.length} 张全部生成完成`
      patchGenerationTask(taskId, {
        state: failures.length ? 'partial' : 'completed',
        status: finalStatus,
        completedCount,
        finishedAt: new Date().toISOString(),
      })
      // 单张失败由对应画布槽位承载，不再污染工作台全局错误区。
      error.value = ''
      if (!batchFailures.value.some((entry) => entry.groupId === groupId)) {
        batchRetryContexts.delete(groupId)
      }
      return { outputs: nextOutputs, items: completedItems, failures, groupId }
    } catch (caught) {
      if (runContext.cancelRequested) {
        patchGenerationTask(taskId, {
          state: 'cancelled',
          status: '任务已取消',
          finishedAt: new Date().toISOString(),
        })
        error.value = ''
        return { outputs: [], items: [], failures, groupId }
      }
      creditsPrompt.handleCreditError(caught)
      const message = sanitizeCreativeError(caught?.message || '批量生成失败')
      patchGenerationTask(taskId, {
        state: 'failed',
        status: message,
        finishedAt: new Date().toISOString(),
      })
      error.value = failures.length ? '' : message
      return { outputs: [], items: [], failures, groupId }
    } finally {
      generationRunContexts.delete(taskId)
      syncGenerationState()
      const removalTimer = window.setTimeout(() => {
        generationTaskRemovalTimers.delete(removalTimer)
        removeGenerationTask(taskId)
      }, 1200)
      generationTaskRemovalTimers.add(removalTimer)
    }
  }

  async function retryBatchItem(groupIdValue, indexValue, overrides = {}) {
    const groupId = String(groupIdValue || '')
    const index = Number(indexValue)
    const context = batchRetryContexts.get(groupId)
    const item = context?.items?.[index]
    if (!context || !item) {
      error.value = '该失败图片的重试信息已失效，请重新发起一组生成。'
      return []
    }
    error.value = ''
    const retryItem = {
      ...item,
      ...(typeof overrides.prompt === 'string' && overrides.prompt.trim()
        ? { prompt: overrides.prompt.trim() }
        : {}),
      ...(typeof overrides.kindVariant === 'string' && overrides.kindVariant.trim()
        ? { kindVariant: overrides.kindVariant.trim() }
        : {}),
    }
    const result = await generateBatch([retryItem], {
      groupId,
      model: context.model,
      sourceUrls: context.sourceList,
      concurrency: 1,
      preserveBatchMeta: true,
      allowWhileRunning: true,
      batchCreatedAt: item.batchCreatedAt,
    })
    if (result.outputs.length) {
      clearBatchFailure(groupId, index)
      status.value = `${item.viewLabel || `第 ${index + 1} 张`}已重新生成`
      error.value = ''
      return result.outputs
    }
    return []
  }

  async function resumeActiveJobs(seedJobs = null) {
    if (!authStore.isAuthenticated || running.value) return []
    let candidates = Array.isArray(seedJobs) ? seedJobs : []
    if (!candidates.length) {
      const kinds = historyKindQueries()
      const responses = await Promise.all(
        kinds.map((kind) => listServerAiJobs(12, { kind }).catch(() => null)),
      )
      candidates = responses.flatMap((response) =>
        Array.isArray(response?.jobs) ? response.jobs : [],
      )
    }
    const active = candidates.filter((job) =>
      ACTIVE_JOB_STATUSES.has(String(job?.status || '').toLowerCase()),
    )
    if (!active.length || running.value) return []

    const jobEntry = (job) => {
      const params =
        job?.input && typeof job.input === 'object'
          ? job.input
          : job?.params && typeof job.params === 'object'
            ? job.params
            : {}
      const batch = readJobBatchMeta(job)
      const jobId = String(job?.id || '')
      const groupId = batch.id || jobId
      const createdAt = String(
        batch.createdAt || job?.createdAt || job?.created_at || job?.startedAt || '',
      )
      return {
        job,
        params,
        batch,
        jobId,
        groupId,
        index: batch.id ? batch.index : 0,
        size: batch.id ? batch.size : 1,
        createdAt,
        attemptedAt:
          Date.parse(job?.createdAt || job?.created_at || job?.startedAt || job?.updatedAt || '') ||
          0,
      }
    }

    const activeEntries = active.map(jobEntry).filter((entry) => entry.jobId && entry.groupId)
    const activeGroupIds = new Set(activeEntries.map((entry) => entry.groupId))
    const latestBySlot = new Map()
    for (const job of candidates) {
      const entry = jobEntry(job)
      if (!entry.jobId || !activeGroupIds.has(entry.groupId)) continue
      const key = `${entry.groupId}:${entry.index}`
      const previous = latestBySlot.get(key)
      if (!previous || entry.attemptedAt >= previous.attemptedAt) latestBySlot.set(key, entry)
    }
    // 旧的运行记录如果已经被同槽位的更新重试取代，不再重复接管。
    const latestActiveEntries = activeEntries.filter(
      (entry) => latestBySlot.get(`${entry.groupId}:${entry.index}`)?.jobId === entry.jobId,
    )
    if (!latestActiveEntries.length || running.value) return []

    const statusOf = (job) => {
      const value = String(job?.status || '').toLowerCase()
      if (ACTIVE_JOB_STATUSES.has(value)) return 'running'
      if (value === 'completed' || value === 'done') return 'done'
      if (value === 'failed') return 'failed'
      if (value === 'cancelled') return 'cancelled'
      return 'pending'
    }
    const groups = new Map()
    for (const entry of latestBySlot.values()) {
      if (!latestActiveEntries.some((activeEntry) => activeEntry.groupId === entry.groupId))
        continue
      let group = groups.get(entry.groupId)
      if (!group) {
        group = { id: entry.groupId, size: entry.size, entries: new Map() }
        groups.set(entry.groupId, group)
      }
      group.size = Math.max(group.size, entry.size, entry.index + 1)
      group.entries.set(entry.index, entry)
    }

    const restoredTasks = Array.from(groups.values())
      .map((group) => {
        const anchor =
          latestActiveEntries.find((entry) => entry.groupId === group.id) ||
          group.entries.values().next().value
        const progress = Array.from({ length: group.size }, (_, index) => {
          const entry = group.entries.get(index)
          const itemStatus = statusOf(entry?.job)
          const urls = itemStatus === 'done' ? resolveJobOutputUrls(entry.job) : []
          if (urls.length) rememberJobOutputPreviews(urls, entry.job)
          return {
            groupId: group.id,
            index,
            label: String(entry?.params?.viewLabel || '') || `第 ${index + 1} 张`,
            status: itemStatus,
            message:
              itemStatus === 'failed'
                ? sanitizeCreativeError(entry?.job?.error || entry?.job?.errorMessage || '生成失败')
                : '',
            ...(entry?.jobId ? { jobId: entry.jobId } : {}),
            ...(urls.length ? { outputs: urls } : {}),
          }
        })
        const settledCount = progress.filter((item) =>
          ['done', 'failed', 'cancelled'].includes(item.status),
        ).length
        const rawLabel = String(anchor?.params?.viewLabel || '生成任务')
        return {
          id: `resume:${group.id}`,
          groupId: group.id,
          label: rawLabel.replace(/\s+[1-4]$/, ''),
          kindVariant: resolveHistoryKindVariant(anchor?.job),
          previewUrl: String(
            anchor?.params?.sourceUrl ||
              (Array.isArray(anchor?.params?.sourceUrls) ? anchor.params.sourceUrls[0] : '') ||
              '',
          ),
          state: 'running',
          status: `正在恢复生成进度 ${settledCount}/${group.size}`,
          progress,
          completedCount: settledCount,
          totalCount: group.size,
          createdAt: anchor?.createdAt || new Date().toISOString(),
          finishedAt: '',
        }
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

    if (!restoredTasks.length) return []
    generationTasks.value = [
      ...restoredTasks,
      ...generationTasks.value.filter(
        (task) => !restoredTasks.some((restored) => restored.id === task.id),
      ),
    ]
    for (const task of restoredTasks) {
      const jobIds = latestActiveEntries
        .filter((entry) => entry.groupId === task.groupId)
        .map((entry) => entry.jobId)
      generationRunContexts.set(task.id, {
        controller: new AbortController(),
        jobIds: new Set(jobIds),
        cancelRequested: false,
      })
    }
    syncGenerationState()
    status.value = `已恢复 ${latestActiveEntries.length} 个进行中的任务`

    const patchSlot = (taskId, slotIndex, slotPatch) => {
      const task = generationTasks.value.find((entry) => entry.id === taskId)
      if (!task) return
      const progress = task.progress.map((item) =>
        item.index === slotIndex ? { ...item, ...slotPatch } : item,
      )
      const completedCount = progress.filter((item) =>
        ['done', 'failed', 'cancelled'].includes(item.status),
      ).length
      patchGenerationTask(taskId, {
        progress,
        completedCount,
        status: `生成进度 ${completedCount}/${task.totalCount}`,
      })
    }
    const recovered = []
    try {
      await Promise.all(
        restoredTasks.map(async (task) => {
          const runContext = generationRunContexts.get(task.id)
          const entries = latestActiveEntries.filter((entry) => entry.groupId === task.groupId)
          await Promise.all(
            entries.map(async (entry) => {
              activeJobIds.add(entry.jobId)
              patchSlot(task.id, entry.index, { status: 'running', message: '' })
              try {
                const completed = await waitForServerAiJob(entry.jobId, {
                  intervalMs: 3000,
                  maxPolls: 240,
                  signal: runContext?.controller.signal || controller.signal,
                  onStatus: (message) => {
                    patchGenerationTask(task.id, { status: String(message || '正在生成') })
                  },
                })
                const urls = resolveJobOutputUrls(completed.job, completed.result)
                rememberJobOutputPreviews(urls, completed.job)
                if (urls.length) {
                  const batch = readJobBatchMeta(completed.job || entry.job)
                  const groupId = batch.id || task.groupId
                  rememberOutputKind(urls, String(completed.job?.kind || entry.job?.kind || ''))
                  prependOutputs(urls, entry.jobId, groupId, {
                    index: batch.id ? batch.index : entry.index,
                    size: batch.id ? batch.size : task.totalCount,
                    aspectRatio:
                      completed.job?.input?.aspectRatio ||
                      completed.job?.params?.aspectRatio ||
                      entry.params.aspectRatio,
                    parentOutputUrl:
                      completed.job?.input?.parentOutputUrl ||
                      completed.job?.params?.parentOutputUrl ||
                      entry.params.parentOutputUrl,
                    activate: generationTasks.value[0]?.id === task.id,
                    createdAt: completed.job?.createdAt || entry.job?.createdAt,
                    startedAt: completed.job?.startedAt || entry.job?.startedAt,
                    finishedAt: completed.job?.finishedAt || entry.job?.finishedAt,
                  })
                  recovered.push(...urls)
                }
                patchSlot(task.id, entry.index, {
                  status: 'done',
                  jobId: entry.jobId,
                  outputs: urls,
                })
              } catch (caught) {
                const cancelled = runContext?.cancelRequested || caught?.name === 'AbortError'
                const message = cancelled
                  ? ''
                  : sanitizeCreativeError(caught?.message || '生成失败')
                patchSlot(task.id, entry.index, {
                  status: cancelled ? 'cancelled' : 'failed',
                  message,
                })
                if (!cancelled) {
                  restoreBatchFailureFromJob(
                    { ...entry.job, status: 'failed', error: message },
                    entry.batch.id
                      ? entry.batch
                      : {
                          id: task.groupId,
                          index: entry.index,
                          size: task.totalCount,
                          createdAt: task.createdAt,
                        },
                  )
                }
              } finally {
                activeJobIds.delete(entry.jobId)
                runContext?.jobIds.delete(entry.jobId)
              }
            }),
          )

          const finishedTask = generationTasks.value.find((entry) => entry.id === task.id)
          const progress = finishedTask?.progress || []
          const doneCount = progress.filter((item) => item.status === 'done').length
          const failedCount = progress.filter((item) => item.status === 'failed').length
          const cancelledCount = progress.filter((item) => item.status === 'cancelled').length
          const finalState = failedCount
            ? doneCount
              ? 'partial'
              : 'failed'
            : cancelledCount && !doneCount
              ? 'cancelled'
              : 'completed'
          patchGenerationTask(task.id, {
            state: finalState,
            status:
              finalState === 'completed'
                ? `${doneCount} 张全部生成完成`
                : finalState === 'partial'
                  ? `已完成 ${doneCount}/${task.totalCount} 张`
                  : finalState === 'cancelled'
                    ? '任务已取消'
                    : '任务生成失败',
            finishedAt: new Date().toISOString(),
          })
          generationRunContexts.delete(task.id)
          const removalTimer = window.setTimeout(() => {
            generationTaskRemovalTimers.delete(removalTimer)
            removeGenerationTask(task.id)
          }, 1200)
          generationTaskRemovalTimers.add(removalTimer)
        }),
      )
      const restoredTaskIds = new Set(restoredTasks.map((task) => task.id))
      const finalRestoredTasks = generationTasks.value.filter((task) =>
        restoredTaskIds.has(task.id),
      )
      status.value = recovered.length
        ? `已恢复 ${recovered.length} 张此前进行中的输出`
        : finalRestoredTasks.some((task) => task.state === 'cancelled')
          ? '任务已取消'
          : '进行中的任务已结束'
      return recovered
    } finally {
      syncGenerationState()
    }
  }

  function inferLegacyBatchMeta(jobs) {
    const buckets = new Map()
    for (const job of jobs) {
      if (readJobBatchMeta(job).id) continue
      const params =
        job?.input && typeof job.input === 'object'
          ? job.input
          : job?.params && typeof job.params === 'object'
            ? job.params
            : {}
      const match = String(params.viewLabel || '')
        .trim()
        .match(/^(.*\S)\s+([1-4])$/)
      if (!match) continue
      const index = Number(match[2]) - 1
      const signature = JSON.stringify({
        kind: String(job?.kind || params._kind || ''),
        prompt: String(job?.prompt || ''),
        model: String(job?.model || params.modelHint || params.publicModelKey || ''),
        view: match[1],
        aspectRatio: String(params.aspectRatio || ''),
        size: String(params.outputSize || params.size || ''),
        sourceUrls: Array.isArray(params.sourceUrls)
          ? params.sourceUrls.map((item) => String(item || '')).sort()
          : [String(params.sourceUrl || '')],
      })
      if (!buckets.has(signature)) buckets.set(signature, [])
      buckets.get(signature).push({
        job,
        index,
        time: Date.parse(job?.createdAt || job?.created_at || '') || 0,
      })
    }

    const inferred = new Map()
    for (const entries of buckets.values()) {
      entries.sort((a, b) => a.time - b.time || a.index - b.index)
      let cluster = []
      const commit = () => {
        if (cluster.length < 2) {
          cluster = []
          return
        }
        const anchor = cluster.find((entry) => entry.index === 0) || cluster[0]
        const groupId = `legacy-batch:${String(anchor.job?.id || '')}`
        const size = Math.max(...cluster.map((entry) => entry.index)) + 1
        cluster.forEach((entry) => {
          inferred.set(String(entry.job?.id || ''), {
            id: groupId,
            index: entry.index,
            size,
            createdAt: new Date(cluster[0].time || Date.now()).toISOString(),
          })
        })
        cluster = []
      }
      for (const entry of entries) {
        const duplicateSlot = cluster.some((item) => item.index === entry.index)
        const outsideWindow = cluster.length && entry.time - cluster[0].time > 90_000
        if (duplicateSlot || outsideWindow) commit()
        cluster.push(entry)
      }
      commit()
    }
    return inferred
  }

  function resolveHistoryKindVariant(job = {}) {
    const kind = String(job?.kind || '').trim()
    return (
      kindVariants.find(
        (variant) =>
          kind === buildJobKind(variant, 'generation') || kind === buildJobKind(variant, 'edit'),
      ) || ''
    )
  }

  function resolveHistoryRetryModel(job = {}) {
    const params =
      job?.input && typeof job.input === 'object'
        ? job.input
        : job?.params && typeof job.params === 'object'
          ? job.params
          : {}
    const publicModelKey = String(params.publicModelKey || job?.gatewayModelId || '').trim()
    const restoredModelId = String(params.modelHint || job?.model || publicModelKey).trim()
    return (
      models.value.find(
        (model) =>
          model.id === restoredModelId ||
          (publicModelKey && model.publicModelKey === publicModelKey),
      ) ||
      (restoredModelId
        ? {
            id: restoredModelId,
            label: restoredModelId,
            publicModelKey,
            provider: String(params.providerHint || '').trim(),
          }
        : null)
    )
  }

  function restoreBatchFailureFromJob(job, batch) {
    if (!batch.id) return
    const params =
      job?.input && typeof job.input === 'object'
        ? job.input
        : job?.params && typeof job.params === 'object'
          ? job.params
          : {}
    const item = {
      jobId: String(job?.id || ''),
      prompt: String(job?.prompt || params.prompt || '').trim(),
      aspectRatio: String(params.aspectRatio || '1:1'),
      outputSize: String(params.outputSize || params.size || ''),
      quality: String(params.quality || ''),
      transparentPngEnabled: params.transparentPngEnabled === true,
      upscaleOutputFormat: String(params.upscaleOutputFormat || ''),
      viewId: String(params.viewId || ''),
      viewLabel: String(params.viewLabel || '') || `第 ${batch.index + 1} 张`,
      outputMode: String(params.outputMode || ''),
      kindVariant: resolveHistoryKindVariant(job),
      sourceKeys: Array.isArray(job?.inputKeys) ? job.inputKeys.filter(Boolean) : [],
      batchId: batch.id,
      batchIndex: batch.index,
      batchSize: batch.size,
      batchCreatedAt: batch.createdAt || String(job?.createdAt || ''),
      count: 1,
    }
    if (!item.prompt) return

    const existing = batchRetryContexts.get(batch.id)
    const items = Array.isArray(existing?.items) ? [...existing.items] : []
    items[batch.index] = item
    batchRetryContexts.set(batch.id, {
      groupId: batch.id,
      model: resolveHistoryRetryModel(job) || existing?.model || null,
      sourceList: Array.isArray(existing?.sourceList) ? existing.sourceList : [],
      items,
    })
    rememberOutputGroup([], batch.id, { size: batch.size })
    rememberBatchFailure(batch.id, batch.index, item, job?.error || job?.errorMessage || '生成失败')
  }

  function ingestHistoryJobs(jobs) {
    const inferredBatches = inferLegacyBatchMeta(jobs)
    const batchMetaOf = (job) => {
      const persisted = readJobBatchMeta(job)
      return persisted.id ? persisted : inferredBatches.get(String(job?.id || '')) || persisted
    }
    const latestBatchAttempts = new Map()
    for (const job of jobs) {
      const batch = batchMetaOf(job)
      if (!batch.id) continue
      const key = `${batch.id}:${batch.index}`
      const attemptedAt =
        Date.parse(job?.createdAt || job?.created_at || job?.startedAt || job?.finishedAt || '') ||
        0
      const existing = latestBatchAttempts.get(key)
      if (!existing || attemptedAt > existing.attemptedAt) {
        latestBatchAttempts.set(key, { job, attemptedAt })
      }
    }
    for (const [key, attempt] of latestBatchAttempts) {
      const seenAt = historyBatchAttemptTimes.get(key)
      attempt.shouldIngest = seenAt == null || attempt.attemptedAt > seenAt
      if (attempt.shouldIngest) historyBatchAttemptTimes.set(key, attempt.attemptedAt)
    }

    const sorted = [...jobs].sort((a, b) => {
      const batchA = batchMetaOf(a)
      const batchB = batchMetaOf(b)
      const timeA = Date.parse(batchA.createdAt || a?.createdAt || a?.created_at || '') || 0
      const timeB = Date.parse(batchB.createdAt || b?.createdAt || b?.created_at || '') || 0
      if (timeA !== timeB) return timeB - timeA
      if (batchA.id && batchA.id === batchB.id) return batchA.index - batchB.index
      return 0
    })
    const historyOutputs = []
    for (const job of sorted) {
      const jobStatus = String(job?.status || '').toLowerCase()
      const batch = batchMetaOf(job)
      if (batch.id) {
        const latest = latestBatchAttempts.get(`${batch.id}:${batch.index}`)
        if (latest?.job !== job || !latest.shouldIngest) continue
      }
      if (jobStatus === 'failed') {
        restoreBatchFailureFromJob(job, batch)
        continue
      }
      if (jobStatus === 'cancelled') {
        if (batch.id) clearBatchFailure(batch.id, batch.index)
        continue
      }
      if (!['completed', 'done'].includes(jobStatus)) continue
      if (batch.id) clearBatchFailure(batch.id, batch.index, { releaseContext: false })
      const urls = resolveJobOutputUrls(job)
      rememberJobOutputPreviews(urls, job)
      rememberOutputJob(urls, String(job?.id || ''))
      rememberOutputTiming(urls, {
        createdAt: job?.createdAt || job?.created_at,
        startedAt: job?.startedAt || job?.started_at,
        finishedAt: job?.finishedAt || job?.finished_at || job?.updatedAt,
      })
      rememberOutputKind(urls, String(job?.kind || ''))
      const cachedGroupId = outputGroups.value[urls[0]] || ''
      const groupId = batch.id || cachedGroupId || String(job?.id || '')
      // 服务端 batchId 是分组事实来源；旧任务才回退到一次性迁移的本地缓存。
      rememberOutputGroup(urls, groupId, {
        overwrite: Boolean(batch.id) || !cachedGroupId,
        index: batch.id ? batch.index : outputGroupIndexes.value[urls[0]] || 0,
        size: batch.id ? batch.size : outputGroupSizes.value[groupId] || urls.length,
      })
      const params =
        job?.input && typeof job.input === 'object'
          ? job.input
          : job?.params && typeof job.params === 'object'
            ? job.params
            : {}
      rememberOutputAspectRatio(urls, params.aspectRatio)
      rememberOutputParent(urls, params.parentOutputUrl)
      historyOutputs.push(...urls)
    }
    if (historyOutputs.length) {
      // 历史追加在现有输出之后：新生成的结果始终排在最前。
      outputs.value = Array.from(new Set([...outputs.value, ...historyOutputs]))
      if (!activeOutput.value) activeOutput.value = outputs.value[0] || ''
    }
    return historyOutputs
  }

  function collectHistoryResponses(entries, responses) {
    const jobs = []
    let hasMore = false
    responses.forEach((response, index) => {
      const entry = entries[index]
      if (!entry) return
      if (Array.isArray(response?.jobs)) jobs.push(...response.jobs)
      const nextCursor = String(response?.pagination?.nextCursor || '')
      const more = response?.pagination?.hasMore === true && Boolean(nextCursor)
      historyCursors[entry.key] = more ? nextCursor : ''
      if (more) hasMore = true
    })
    historyHasMore.value = Object.values(historyCursors).some(Boolean)
    if (kindVariants.length) {
      historyHasMoreVariants.value = Object.fromEntries(
        kindVariants.map((variant) => [variant, Boolean(historyCursors[variant])]),
      )
    }
    return { jobs, hasMore }
  }

  // 每个子类型拥有自己的 generation/edit 合并查询和分页游标。
  function historyQueryEntries() {
    if (kindVariants.length) {
      return kindVariants.map((variant) => ({
        key: variant,
        kind: [buildJobKind(variant, 'generation'), buildJobKind(variant, 'edit')].join(','),
      }))
    }
    return historyKinds().map((kind) => ({ key: kind, kind }))
  }

  function historyKindQueries() {
    return historyQueryEntries().map((entry) => entry.kind)
  }

  async function loadHistory(limit = 24) {
    if (historyLoading.value) return []
    if (!authStore.isAuthenticated) return []
    historyLoading.value = true
    const entries = historyQueryEntries()
    historyLoadingVariants.value = Object.fromEntries(entries.map((entry) => [entry.key, true]))
    try {
      historyCursors = {}
      historyBatchAttemptTimes = new Map()
      const responses = await Promise.all(
        entries.map((entry) => listServerAiJobs(limit, { kind: entry.kind }).catch(() => null)),
      )
      const { jobs } = collectHistoryResponses(entries, responses)
      lastHistoryJobs = jobs
      return ingestHistoryJobs(jobs)
    } finally {
      historyLoading.value = false
      historyLoadingVariants.value = {}
    }
  }

  async function loadMoreHistory(limit = 24, loadOptions = {}) {
    if (historyLoading.value || !historyHasMore.value) return []
    if (!authStore.isAuthenticated) return []
    const requestedVariant = String(loadOptions?.kindVariant || '').trim()
    const entriesByKey = new Map(historyQueryEntries().map((entry) => [entry.key, entry]))
    const pending = Object.entries(historyCursors)
      .filter(([key, cursor]) => Boolean(cursor) && (!requestedVariant || key === requestedVariant))
      .map(([key, cursor]) => ({ ...entriesByKey.get(key), key, cursor }))
      .filter((entry) => entry.kind)
    if (!pending.length) return []
    historyLoading.value = true
    historyLoadingVariants.value = {
      ...historyLoadingVariants.value,
      ...Object.fromEntries(pending.map((entry) => [entry.key, true])),
    }
    try {
      const responses = await Promise.all(
        pending.map((entry) =>
          listServerAiJobs(limit, { kind: entry.kind, cursor: entry.cursor }).catch(() => null),
        ),
      )
      const { jobs } = collectHistoryResponses(pending, responses)
      return ingestHistoryJobs(jobs)
    } finally {
      historyLoading.value = false
      const nextLoadingVariants = { ...historyLoadingVariants.value }
      for (const entry of pending) delete nextLoadingVariants[entry.key]
      historyLoadingVariants.value = nextLoadingVariants
    }
  }

  function formatCostEstimate(count = 1) {
    const units = Math.max(1, Number(count) || 1)
    const model = selectedModel.value
    const selectedUnitPrice = Number(model?.creditCost)
    if (model && Number.isFinite(selectedUnitPrice) && selectedUnitPrice >= 0) {
      const total = selectedUnitPrice * units
      if (total === 0) return '免费'
      return units > 1
        ? `预计 ${formatPoints(total)}（${formatPoints(selectedUnitPrice)} / 张 × ${units}）`
        : `${formatPoints(selectedUnitPrice)} / 张`
    }
    // 旧配置没有模型价格时，回退到页面级价格。
    if (unitPriceCents.value != null) {
      const total = formatPoints(unitPriceCents.value * units)
      return units > 1
        ? `预计 ${total}（${formatPoints(unitPriceCents.value)} / 张 × ${units}）`
        : `${formatPoints(unitPriceCents.value)} / 张`
    }
    if (!model) return ''
    const credits = Number(model.creditCost || 0) * units
    const usd = Number(model.userPriceUsd || 0) * units
    if (credits > 0) return `预计 ${credits} 积分`
    if (usd > 0) return `预计 $${usd.toFixed(4)}`
    return '费用以服务端结算为准'
  }

  // 蒙版局部修正：以某张输出为源图，只重绘涂抹区域，其余保持不变。
  async function generateMaskedEdit(input = {}) {
    if (running.value) return []
    const prompt = String(input.prompt || '').trim()
    const model = resolveRunnableModel(prompt)
    if (!model) return []
    if (!(input.maskFile instanceof File) || !input.maskFile.size) {
      error.value = '蒙版无效，请重新涂抹'
      return []
    }
    running.value = true
    cancelRequested = false
    try {
      const sourceUrl = String(input.sourceUrl || '').trim()
      const sourceGroup = outputGroups.value[sourceUrl] || ''
      const sourceGroupIndexes = Object.entries(outputGroups.value)
        .filter(([, groupId]) => groupId === sourceGroup)
        .map(([url]) => Math.max(0, Number(outputGroupIndexes.value[url]) || 0))
      const nextGroupIndex = sourceGroupIndexes.length ? Math.max(...sourceGroupIndexes) + 1 : 0
      const nextGroupSize = Math.max(
        nextGroupIndex + 1,
        Number(outputGroupSizes.value[sourceGroup]) || 0,
      )
      const sourceList = await resolveSourceList({ sourceUrl })
      if (!sourceList.length) throw new Error('没有可用于修正的原图')
      status.value = '正在上传蒙版...'
      const maskUrl = await uploadAiInputFile(input.maskFile, { featureKey })
      const result = await runImageJob(
        {
          prompt: `${prompt}\n只修改蒙版覆盖的区域，其余部分与原图保持完全一致（构图、比例、光照、材质不变）。`,
          aspectRatio: input.aspectRatio || '1:1',
          count: 1,
          quality: input.quality || 'high',
          maskUrl,
          viewLabel: String(input.viewLabel || '局部修正'),
          outputMode: 'mask-edit',
          kindVariant: input.kindVariant,
          batchId: sourceGroup,
          batchIndex: nextGroupIndex,
          batchSize: nextGroupSize,
          batchCreatedAt: new Date().toISOString(),
        },
        model,
        sourceList,
        (message) => {
          status.value = message
        },
      )
      // 修正结果并入源图所在分组，保持同一组视图的完整性。
      prependOutputs(result.outputs, result.jobId, sourceGroup, {
        index: nextGroupIndex,
        size: nextGroupSize,
        aspectRatio: input.aspectRatio || '1:1',
        createdAt: result.createdAt,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      })
      status.value = '修正完成'
      return result.outputs
    } catch (caught) {
      if (cancelRequested) {
        status.value = '任务已取消'
        error.value = ''
        return []
      }
      creditsPrompt.handleCreditError(caught)
      error.value = sanitizeCreativeError(caught?.message || '局部修正失败')
      return []
    } finally {
      running.value = false
    }
  }

  async function cancel(taskId = '') {
    const targetTask = taskId
      ? generationTasks.value.find((task) => task.id === taskId)
      : generationTasks.value.find((task) => task.state === 'running')
    const runContext = targetTask ? generationRunContexts.get(targetTask.id) : null
    if (targetTask && runContext) {
      if (runContext.cancelRequested) return
      runContext.cancelRequested = true
      patchGenerationTask(targetTask.id, {
        state: 'cancelling',
        status: '正在取消任务…',
      })
      const jobIds = [...runContext.jobIds]
      runContext.controller.abort()
      await Promise.allSettled(jobIds.map((jobId) => cancelServerAiJob(jobId)))
      return
    }
    if (!running.value || cancelling.value) return
    cancelling.value = true
    cancelRequested = true
    status.value = '正在取消任务…'
    const jobIds = [...activeJobIds]
    controller.abort()
    controller = new AbortController()
    try {
      await Promise.allSettled(jobIds.map((jobId) => cancelServerAiJob(jobId)))
    } finally {
      cancelling.value = false
    }
  }

  onBeforeUnmount(() => {
    controller.abort()
    generationRunContexts.forEach((runContext) => runContext.controller.abort())
    generationRunContexts.clear()
    generationTaskRemovalTimers.forEach((timer) => window.clearTimeout(timer))
    generationTaskRemovalTimers.clear()
  })

  return {
    authStore,
    creditsPrompt,
    unitPriceCents,
    modelId,
    models,
    selectedModel,
    status,
    error,
    running,
    cancelling,
    historyLoading,
    historyHydrated,
    historyHasMore,
    historyLoadingVariants,
    historyHasMoreVariants,
    outputs,
    activeOutput,
    outputJobIds,
    outputPreviewUrls,
    outputGroups,
    outputGroupIndexes,
    outputGroupSizes,
    outputAspectRatios,
    outputTimings,
    outputParents,
    outputKinds,
    generationTasks,
    batchProgress,
    batchFailures,
    lastJobId,
    initialize,
    generate,
    generateBatch,
    retryBatchItem,
    deleteBatchFailure,
    generateMaskedEdit,
    cancel,
    loadHistory,
    loadMoreHistory,
    resumeActiveJobs,
    deleteOutput,
    formatCostEstimate,
  }
}

function sanitizeCreativeError(value) {
  const text = String(value || '')
    .replace(/https?:\/\/[^\s"']+/gi, '[上游地址]')
    .replace(/(?:authorization|cookie|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[已隐藏]')
  if (/upstream_text_reply/i.test(text) && /(裸露|色情|情色|性暗示|挑逗|防护限制)/.test(text)) {
    return '上游模型将当前参考图或服装描述判定为受限内容。系统已应用完整穿着规则，请使用“单独重新生成”重试该图片。'
  }
  if (text.length > 260 || /bodyPreview|providerPayload|dataKeys=/i.test(text)) {
    return '上游图片服务没有返回有效结果，请稍后重试或切换模型。'
  }
  return text.slice(0, 260)
}
