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
import { formatPriceCents, getFeatureUnitPriceCents } from '@/services/pricing'
import { fetchAuthenticatedMediaBlob } from '@/services/authenticatedMedia'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { normalizeGptImageOutputSize } from '@/services/aiImageOutputSize'

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'waiting_provider'])
const HISTORY_CAP = 120

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
  const historyHasMore = ref(false)
  let historyCursors = {}
  let lastHistoryJobs = []
  const outputJobIds = ref({})
  const outputGroups = ref({})
  const batchProgress = ref([])
  let controller = new AbortController()
  let cancelRequested = false
  const activeJobIds = new Set()
  const featureKey = String(options.featureKey || 'ai.optimize')
  const creditsPrompt = useInsufficientCreditsPrompt()
  // 服务端任务单价（分/张），null 表示读取失败（提交按钮附近显示「以服务端结算为准」）
  const unitPriceCents = ref(null)
  const jobKindPrefix = String(options.jobKindPrefix || 'image')
  // 可选的子类型集合（如游戏工作台的 character/prop…），任务 kind 会带上子类型，
  // 让历史记录能按子类型归类展示。
  const kindVariants = Array.isArray(options.kindVariants)
    ? options.kindVariants.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const outputKinds = ref({})
  const groupStoreKey = `creative-output-groups-${jobKindPrefix}-v1`

  try {
    const parsed = JSON.parse(getScopedLocalItem(groupStoreKey) || '{}')
    if (parsed && typeof parsed === 'object') outputGroups.value = parsed
  } catch {
    outputGroups.value = {}
  }

  function persistGroups() {
    const entries = Object.entries(outputGroups.value)
    // 只保留最近的映射，避免 localStorage 无限膨胀。
    const trimmed = entries.length > 240 ? Object.fromEntries(entries.slice(-240)) : outputGroups.value
    setScopedLocalItem(groupStoreKey, JSON.stringify(trimmed))
  }

  function rememberOutputGroup(urls, groupId, { overwrite = true } = {}) {
    if (!groupId) return
    const next = { ...outputGroups.value }
    let changed = false
    for (const url of urls) {
      if (!url) continue
      if (!overwrite && next[url]) continue
      if (next[url] === groupId) continue
      next[url] = groupId
      changed = true
    }
    if (!changed) return
    outputGroups.value = next
    persistGroups()
  }

  function createGroupId() {
    return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  function buildJobKind(variant, mode) {
    const suffix = String(variant || '').trim()
    return suffix ? `${jobKindPrefix}-${suffix}-${mode}` : `${jobKindPrefix}-${mode}`
  }

  // 历史查询覆盖的 kind 全集：各子类型 + 未带子类型的早期任务。
  function historyKinds() {
    if (!kindVariants.length) return [`${jobKindPrefix}-generation`, `${jobKindPrefix}-edit`]
    return [
      ...kindVariants.flatMap((variant) => [
        buildJobKind(variant, 'generation'),
        buildJobKind(variant, 'edit'),
      ]),
      `${jobKindPrefix}-generation`,
      `${jobKindPrefix}-edit`,
    ]
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
    const usablePublic = publicModels.map((item) => ({
      id: String(item.id || item.publicModelKey || ''),
      label: String(item.label || item.id || item.publicModelKey || ''),
      publicModelKey: String(item.id || item.publicModelKey || ''),
      provider: '',
      creditCost: resolvePublicModelCreditCost(item, feature),
      userPriceUsd: Number(item.userPriceUsd || 0),
    })).filter((item) => item.id)
    if (usablePublic.length) return usablePublic
    const catalog = runtimeConfigStore.getAiModelCatalog()
    return (catalog.providers || []).flatMap((provider) => (provider.models || []).map((item) => ({
      id: String(item.id || item.model || ''),
      label: String(item.label || item.name || item.id || ''),
      publicModelKey: '',
      provider: String(provider.id || provider.providerKey || ''),
    }))).filter((item) => item.id)
  })

  const selectedModel = computed(() => {
    const selected = models.value.find((item) => item.id === modelId.value) || models.value[0] || null
    if (selected && !modelId.value) modelId.value = selected.id
    return selected
  })

  async function initialize() {
    void getFeatureUnitPriceCents(featureKey)
      .then((value) => {
        unitPriceCents.value = value
      })
      .catch(() => null)
    await Promise.all([
      runtimeConfigStore.loadRuntimeConfig().catch(() => null),
      authStore.initAuth().catch(() => null),
    ])
    if (!modelId.value) modelId.value = models.value[0]?.id || ''
    // 首屏只拉一小页，避免几十张鉴权图并发拉取造成卡顿；滚动加载补齐。
    // resumeActiveJobs 复用同一批列表数据，不再重复请求。
    void loadHistory(12)
      .catch(() => null)
      .then(() => resumeActiveJobs(lastHistoryJobs))
      .catch(() => null)
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

  async function runImageJob(input, model, source, onStatus = () => {}) {
    onStatus('正在创建云端任务...')
    const count = Math.max(1, Math.min(Number(input.count) || 1, 4))
    const sourceList = Array.isArray(source) ? source.filter(Boolean) : source ? [source] : []
    const sourceUrl = sourceList[0] || ''
    const maskUrl = String(input.maskUrl || '').trim()
    // 尺寸必须显式下发：后端 dispatcher 在缺少 size 时会退回 1024x1024 方图，
    // 导致 9:16 等比例请求被上游按方图生成。
    const outputSize = resolveOutputSize(input)
    const shared = {
      sourceUrl,
      sourceUrls: sourceList,
      ...(maskUrl ? { maskUrl, mask: maskUrl } : {}),
      aspectRatio: input.aspectRatio || '1:1',
      size: outputSize,
      outputSize,
      count,
      transparentPngEnabled: input.transparentPngEnabled === true,
      ...(input.quality ? { quality: String(input.quality) } : {}),
      viewId: String(input.viewId || ''),
      viewLabel: String(input.viewLabel || ''),
      outputMode: String(input.outputMode || ''),
    }
    const jobKind = buildJobKind(input.kindVariant, sourceUrl ? 'edit' : 'generation')
    const response = await createServerAiJob({
      kind: jobKind,
      // 每个任务一个幂等键，经适配层映射为服务端 idempotencyKey
      clientRequestId: crypto.randomUUID(),
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
    activeJobIds.add(jobId)
    let completed
    try {
      completed = await waitForServerAiJob(jobId, {
        intervalMs: 2500,
        maxPolls: 260,
        signal: controller.signal,
        onStatus,
      })
    } finally {
      activeJobIds.delete(jobId)
    }
    const nextOutputs = Array.from(
      new Set(
        [
          String(completed.job?.resultMediaUrl || '').trim(),
          ...extractServerJobOutputs(completed.result),
        ].filter(Boolean),
      ),
    )
    if (!nextOutputs.length) throw new Error('任务已完成，但没有返回可用图片')
    rememberOutputKind(nextOutputs, jobKind)
    return { jobId, outputs: nextOutputs }
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

  // 支持多参考图：files + sourceUrls 全部归一成上游可访问的 URL 列表（上限 4）。
  async function resolveSourceList(input = {}) {
    const list = []
    const files = Array.isArray(input.files)
      ? input.files.filter(Boolean)
      : input.file
        ? [input.file]
        : []
    for (const file of files) {
      status.value = '正在上传参考图...'
      list.push(await uploadAiInputFile(file, { featureKey }))
    }
    const urls = Array.isArray(input.sourceUrls)
      ? input.sourceUrls
      : input.sourceUrl
        ? [input.sourceUrl]
        : []
    for (const url of urls) {
      const resolved = await rehostInternalUrl(url)
      if (resolved) list.push(resolved)
    }
    return Array.from(new Set(list)).slice(0, 4)
  }


  function rememberOutputJob(urls, jobId) {
    if (!jobId) return
    const next = { ...outputJobIds.value }
    for (const url of urls) next[url] = jobId
    outputJobIds.value = next
  }

  function prependOutputs(nextOutputs, jobId = '', groupId = '') {
    rememberOutputJob(nextOutputs, jobId)
    rememberOutputGroup(nextOutputs, groupId || jobId)
    outputs.value = Array.from(new Set([...nextOutputs, ...outputs.value])).slice(0, HISTORY_CAP)
    activeOutput.value = nextOutputs[0] || activeOutput.value
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
    const nextKinds = { ...outputKinds.value }
    for (const item of removed) {
      delete next[item]
      delete nextGroups[item]
      delete nextKinds[item]
    }
    outputJobIds.value = next
    outputGroups.value = nextGroups
    outputKinds.value = nextKinds
    persistGroups()
    if (removed.includes(activeOutput.value)) activeOutput.value = outputs.value[0] || ''
    return true
  }

  async function generate(input = {}) {
    if (running.value) return []
    const count = Math.max(1, Math.min(Number(input.count) || 1, 4))
    if (count > 1) {
      // 多张请求拆成并行的单图任务：上游网关对 n>1 会等最慢的一张才返回，
      // 一旦超过 Worker 的上游超时，整批（含已成功的图）都会丢失。
      const result = await generateBatch(
        Array.from({ length: count }, (_, index) => ({
          ...input,
          count: 1,
          viewLabel: String(input.viewLabel || '') || `方案 ${index + 1}`,
        })),
        {
          files: input.files,
          file: input.file,
          sourceUrls: input.sourceUrls,
          sourceUrl: input.sourceUrl,
          concurrency: 2,
          groupId: String(input.groupId || ''),
        },
      )
      return result.outputs
    }
    const prompt = String(input.prompt || '').trim()
    const model = resolveRunnableModel(prompt)
    if (!model) return []
    running.value = true
    cancelRequested = false
    try {
      const sourceList = await resolveSourceList(input)
      const result = await runImageJob(input, model, sourceList, (message) => {
        status.value = message
      })
      prependOutputs(result.outputs, result.jobId, String(input.groupId || ''))
      status.value = '生成完成'
      return result.outputs
    } catch (caught) {
      if (cancelRequested) {
        status.value = '任务已取消'
        error.value = ''
        return []
      }
      creditsPrompt.handleCreditError(caught)
      error.value = sanitizeCreativeError(caught?.message || '图片生成失败')
      return []
    } finally {
      running.value = false
    }
  }

  async function generateBatch(items = [], batchOptions = {}) {
    if (running.value) return { outputs: [], items: [], groupId: '' }
    const inputs = (Array.isArray(items) ? items : [])
      .map((item) => ({ ...item, prompt: String(item?.prompt || '').trim() }))
      .filter((item) => item.prompt)
    const model = resolveRunnableModel(inputs[0]?.prompt || '')
    if (!model || !inputs.length) return { outputs: [], items: [], groupId: '' }
    const groupId = String(batchOptions.groupId || '') || createGroupId()
    running.value = true
    cancelRequested = false
    const results = new Array(inputs.length)
    const failures = []
    let completedCount = 0
    let cursor = 0
    batchProgress.value = inputs.map((item, index) => ({
      label: String(item.viewLabel || '') || `第 ${index + 1} 张`,
      status: 'pending',
    }))
    const markProgress = (index, state) => {
      batchProgress.value = batchProgress.value.map((entry, at) =>
        at === index ? { ...entry, status: state } : entry,
      )
    }
    try {
      const sourceList = await resolveSourceList({
        files: batchOptions.files,
        file: batchOptions.file,
        sourceUrls: batchOptions.sourceUrls,
        sourceUrl: batchOptions.sourceUrl,
      })
      // 无参考图时可选用第一张成功结果作为后续视图的参考，
      // 保证同批多视图输出的是同一个主体。
      const chainFirstOutput = batchOptions.chainFirstOutputAsSource === true && !sourceList.length
      let effectiveSourceList = sourceList
      const concurrency = chainFirstOutput
        ? 1
        : Math.max(1, Math.min(Number(batchOptions.concurrency) || 2, 3))
      const worker = async () => {
        while (cursor < inputs.length && !cancelRequested) {
          const index = cursor
          cursor += 1
          const item = inputs[index]
          try {
            markProgress(index, 'running')
            status.value = `正在生成 ${item.viewLabel || `第 ${index + 1} 张`} · ${completedCount}/${inputs.length}`
            const result = await runImageJob(item, model, effectiveSourceList)
            results[index] = { ...item, jobId: result.jobId, outputs: result.outputs }
            prependOutputs(result.outputs, result.jobId, groupId)
            markProgress(index, 'done')
            if (chainFirstOutput && !effectiveSourceList.length && result.outputs[0]) {
              effectiveSourceList = await resolveSourceList({
                sourceUrl: result.outputs[0],
              }).catch(() => [])
            }
          } catch (caught) {
            markProgress(index, cancelRequested ? 'cancelled' : 'failed')
            creditsPrompt.handleCreditError(caught)
            failures.push({ index, item, message: sanitizeCreativeError(caught?.message || '生成失败') })
          } finally {
            completedCount += 1
            status.value = `生成进度 ${completedCount}/${inputs.length}`
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()))
      const completedItems = results.filter(Boolean)
      const nextOutputs = completedItems.flatMap((item) => item.outputs)
      if (cancelRequested) {
        batchProgress.value = batchProgress.value.map((entry) =>
          entry.status === 'pending' || entry.status === 'running'
            ? { ...entry, status: 'cancelled' }
            : entry,
        )
        status.value = completedItems.length
          ? `已取消，保留 ${completedItems.length} 张已完成图片`
          : '任务已取消'
        error.value = ''
        return { outputs: nextOutputs, items: completedItems, failures, groupId }
      }
      if (!nextOutputs.length) throw new Error(failures[0]?.message || '本次批量生成全部失败')
      outputs.value = Array.from(new Set([...nextOutputs, ...outputs.value])).slice(0, HISTORY_CAP)
      activeOutput.value = nextOutputs[0]
      status.value = failures.length
        ? `已完成 ${completedItems.length}/${inputs.length} 张`
        : `${inputs.length} 张全部生成完成`
      error.value = failures.length ? `${failures.length} 张生成失败，可重新生成补齐` : ''
      return { outputs: nextOutputs, items: completedItems, failures, groupId }
    } catch (caught) {
      if (cancelRequested) {
        status.value = '任务已取消'
        error.value = ''
        return { outputs: [], items: [], failures, groupId }
      }
      creditsPrompt.handleCreditError(caught)
      error.value = sanitizeCreativeError(caught?.message || '批量生成失败')
      return { outputs: [], items: [], failures, groupId }
    } finally {
      running.value = false
    }
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
    // 页面刷新后接管仍在云端执行的任务：恢复轮询，完成后照常入库展示。
    running.value = true
    cancelRequested = false
    status.value = `恢复 ${active.length} 个进行中的任务…`
    batchProgress.value = active.map((job, index) => ({
      label: `任务 ${index + 1}`,
      status: 'running',
    }))
    const markProgress = (index, state) => {
      batchProgress.value = batchProgress.value.map((entry, at) =>
        at === index ? { ...entry, status: state } : entry,
      )
    }
    const recovered = []
    try {
      await Promise.all(
        active.map(async (job, index) => {
          const jobId = String(job?.id || '')
          if (!jobId) return
          activeJobIds.add(jobId)
          try {
            const completed = await waitForServerAiJob(jobId, {
              intervalMs: 3000,
              maxPolls: 240,
              signal: controller.signal,
              onStatus: (message) => {
                status.value = message
              },
            })
            const urls = Array.from(
              new Set(
                [
                  String(completed.job?.resultMediaUrl || '').trim(),
                  ...extractServerJobOutputs(completed.result),
                ].filter(Boolean),
              ),
            )
            if (urls.length) {
              prependOutputs(urls, jobId, outputGroups.value[urls[0]] || jobId)
              recovered.push(...urls)
            }
            markProgress(index, 'done')
          } catch {
            markProgress(index, cancelRequested ? 'cancelled' : 'failed')
          } finally {
            activeJobIds.delete(jobId)
          }
        }),
      )
      status.value = recovered.length
        ? `已恢复 ${recovered.length} 张此前进行中的输出`
        : cancelRequested
          ? '任务已取消'
          : '进行中的任务已结束'
      return recovered
    } finally {
      running.value = false
    }
  }

  function ingestHistoryJobs(jobs) {
    const sorted = [...jobs].sort(
      (a, b) =>
        (Date.parse(b?.createdAt || b?.created_at || '') || 0) -
        (Date.parse(a?.createdAt || a?.created_at || '') || 0),
    )
    const historyOutputs = []
    for (const job of sorted) {
      const jobStatus = String(job?.status || '').toLowerCase()
      if (!['completed', 'done'].includes(jobStatus)) continue
      const urls = [
        ...(Array.isArray(job?.resultMediaUrls) ? job.resultMediaUrls : []),
        job?.resultMediaUrl,
      ]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      rememberOutputJob(urls, String(job?.id || ''))
      rememberOutputKind(urls, String(job?.kind || ''))
      // 已有本地分组（同一次批量）优先；否则按任务分组（count>1 的多图归一组）。
      rememberOutputGroup(urls, String(job?.id || ''), { overwrite: false })
      historyOutputs.push(...urls)
    }
    if (historyOutputs.length) {
      // 历史追加在现有输出之后：新生成的结果始终排在最前。
      outputs.value = Array.from(new Set([...outputs.value, ...historyOutputs])).slice(0, HISTORY_CAP)
      if (!activeOutput.value) activeOutput.value = outputs.value[0] || ''
    }
    return historyOutputs
  }

  function collectHistoryResponses(kinds, responses) {
    const jobs = []
    let hasMore = false
    responses.forEach((response, index) => {
      const kind = kinds[index]
      if (Array.isArray(response?.jobs)) jobs.push(...response.jobs)
      const nextCursor = String(response?.pagination?.nextCursor || '')
      const more = response?.pagination?.hasMore === true && Boolean(nextCursor)
      historyCursors[kind] = more ? nextCursor : ''
      if (more) hasMore = true
    })
    historyHasMore.value = Object.values(historyCursors).some(Boolean)
    return { jobs, hasMore }
  }

  // 有子类型时把 kind 全集合并成一次查询（后端支持逗号分隔），
  // 否则维持原来的每个 kind 一次请求。
  function historyKindQueries() {
    const kinds = historyKinds()
    return kindVariants.length ? [kinds.join(',')] : kinds
  }

  async function loadHistory(limit = 24) {
    if (historyLoading.value) return []
    if (!authStore.isAuthenticated) return []
    historyLoading.value = true
    try {
      const kinds = historyKindQueries()
      historyCursors = {}
      const responses = await Promise.all(
        kinds.map((kind) =>
          listServerAiJobs(limit, { kind, excludeFailed: true }).catch(() => null),
        ),
      )
      const { jobs } = collectHistoryResponses(kinds, responses)
      lastHistoryJobs = jobs
      return ingestHistoryJobs(jobs)
    } finally {
      historyLoading.value = false
    }
  }

  async function loadMoreHistory(limit = 24) {
    if (historyLoading.value || !historyHasMore.value) return []
    if (!authStore.isAuthenticated) return []
    historyLoading.value = true
    try {
      const pending = Object.entries(historyCursors).filter(([, cursor]) => Boolean(cursor))
      if (!pending.length) {
        historyHasMore.value = false
        return []
      }
      const responses = await Promise.all(
        pending.map(([kind, cursor]) =>
          listServerAiJobs(limit, { kind, excludeFailed: true, cursor }).catch(() => null),
        ),
      )
      const { jobs } = collectHistoryResponses(
        pending.map(([kind]) => kind),
        responses,
      )
      return ingestHistoryJobs(jobs)
    } finally {
      historyLoading.value = false
    }
  }

  function formatCostEstimate(count = 1) {
    const units = Math.max(1, Number(count) || 1)
    // 优先展示服务端真实单价（分/张）
    if (unitPriceCents.value != null) {
      const total = formatPriceCents(unitPriceCents.value * units)
      return units > 1
        ? `预计 ${total}（${formatPriceCents(unitPriceCents.value)} / 张 × ${units}）`
        : `${formatPriceCents(unitPriceCents.value)} / 张`
    }
    const model = selectedModel.value
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
      const sourceList = await resolveSourceList({ sourceUrl: input.sourceUrl })
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
        },
        model,
        sourceList,
        (message) => {
          status.value = message
        },
      )
      // 修正结果并入源图所在分组，保持同一组视图的完整性。
      const sourceGroup = outputGroups.value[String(input.sourceUrl || '').trim()] || ''
      prependOutputs(result.outputs, result.jobId, sourceGroup)
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

  async function cancel() {
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

  onBeforeUnmount(() => controller.abort())

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
    historyHasMore,
    outputs,
    activeOutput,
    outputJobIds,
    outputGroups,
    outputKinds,
    batchProgress,
    lastJobId,
    initialize,
    generate,
    generateBatch,
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
  if (text.length > 260 || /bodyPreview|providerPayload|dataKeys=/i.test(text)) {
    return '上游图片服务没有返回有效结果，请稍后重试或切换模型。'
  }
  return text.slice(0, 260)
}
