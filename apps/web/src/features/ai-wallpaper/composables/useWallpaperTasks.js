import { getRuntimeImageModelPricing } from '@/config/aiModels'
import {
  cancelServerAiJob,
  createServerAiJob,
  deleteServerAiJob,
  getServerAiJob,
  getServerAiJobResult,
  listServerAiJobs,
  replaceServerAiJobResultWithLocalUpscale,
  uploadAiInputFile,
} from '@/services/aiWallpaper'
import {
  extractServerJobOutputs,
  hydrateServerJobTaskOutputs,
  isConfirmedServerJobCancellation,
  isWallpaperJobKind,
  mapServerJobToTask,
  shouldKeepExistingTaskSnapshot,
} from '@/features/ai-wallpaper/domain/mapServerJobToTask'
import { looksLikeIllustrationColoringTask } from '@/features/ai-shared/aiJobKinds'
import {
  AI_WALLPAPER_STUDIO_DRAFT_KEY,
  AI_WALLPAPER_TASKS_KEY,
  syncAiWallpaperState,
} from '@/services/aiWallpaperState'
import { recordAiUsage } from '@/services/aiUsageLedger'
import notificationService from '@/services/notification'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { computed, ref } from 'vue'
import { resolveT2iOutputSize } from '@/features/ai-wallpaper/composables/wallpaperStudioConstants'
import { createLocalUpscaledImage } from '@/features/ai-wallpaper/services/localImageUpscale'
import { createUpscaleProgressController } from '@/features/ai-wallpaper/services/upscaleProgressController'
import {
  buildWallpaperSkillPrompt,
  resolveActiveWallpaperSkills,
} from '@/features/ai-wallpaper/skills/wallpaperSkills.js'
import {
  downloadAuthenticatedMedia,
  fetchAuthenticatedMediaBlob,
} from '@/services/authenticatedMedia'

function normalizeUpscaleOutputFormat(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return ['png', 'webp', 'jpeg', 'jpg'].includes(normalized) ? normalized : 'auto'
}

export function useWallpaperTasks(deps = {}) {
  const {
    authStore,
    settingsStore,
    runtimeModelCatalog = ref({}),
    outputType = ref('image'),
    inputMode = ref('site'),
    prompt = ref(''),
    promptPolishEnabled = ref(false),
    autoTranslateEnabled = ref(false),
    transparentPngEnabled = ref(false),
    sourcePreview: _sourcePreview = ref(''),
    sourceRemoteUrl = ref(''),
    selectedFile: _selectedFile = ref(null),
    pastedFiles: _pastedFiles = ref([]),
    styleReferencePreviews: _styleReferencePreviews = ref([]),
    referenceImages = ref([]),
    sourceLabel: _sourceLabel = ref('请选择参考图片'),
    composePrompt = () => '',
    aspectRatio = ref('1:1'),
    imageCount = ref(1),
    imageQuality = ref('standard'),
    resolutionScale = ref('1K'),
    upscaleOutputFormat = ref('auto'),
    duration = ref(5),
    creativity = ref(46),
    styleStrength = ref(58),
    detailBoost = ref(true),
    privacyMode = ref(true),
    videoMotion = ref(42),
    selectedSkills: _selectedSkills = ref([]),
    customSkills: _customSkills = ref([]),
    selectedMcpServers: _selectedMcpServers = ref([]),
    selectedSkillIds: _selectedSkillIds = ref([]),
    selectedMcpIds: _selectedMcpIds = ref([]),
    imageDispatchModel = ref(''),
    videoDispatchModel = ref(''),
    selectedPublicModel = ref(''),
    publicModelOptions = ref([]),
    superResolutionFeatureEnabled = ref(true),
    studioProvider = ref('gptsapi'),
    studioBudgetGuard = null,
    ensureWallpaperBudgetAvailable = async () => {},
    ensureUploadUrl: _ensureUploadUrl = async () => sourceRemoteUrl.value,
    canCreateTask = ref(true),
    autoSaveConfig = ref(true),
    saveStudioConfig = () => {},
    persistCapabilityKit: _persistCapabilityKit = () => {},
    selectedOutputIndex = ref(0),
    canvasMode = ref('auto'),
    resetCanvasView = () => {},
    inspectorTab = ref('output'),
    syncState = syncAiWallpaperState,
    notify = notificationService,
    // 提交失败时的余额不足回调：返回 true 表示已弹出余额不足引导
    onCreditError = null,
    createServerAiJobRequest = createServerAiJob,
    tasksKey = AI_WALLPAPER_TASKS_KEY,
    studioDraftKey = AI_WALLPAPER_STUDIO_DRAFT_KEY,
    pollIntervalMs = 3000,
  } = deps

  const SERVER_JOB_TERMINAL_STATUSES = new Set([
    'completed',
    'done',
    'failed',
    'cancelled',
    'canceled',
    'paused',
  ])

  const tasks = deps.tasks || ref([])
  const activeTaskId = deps.activeTaskId || ref('')
  const runningTaskId = deps.runningTaskId || ref('')
  const runningTaskIds = deps.runningTaskIds || ref([])
  const elapsedSeconds = deps.elapsedSeconds || ref(0)
  const serverJobsHasMore = ref(false)
  const serverJobsLoadingMore = ref(false)
  const serverJobsNextCursor = ref('')

  let timer = null
  let persistTasksTimer = null
  let disposed = false
  let taskMutationVersion = 0
  let refreshJobsPromise = null
  let refreshRequested = false
  let localTaskSequence = 0
  const taskAbortControllers = new Map()
  const serverJobPollers = new Map()
  const serverJobPollsInFlight = new Map()
  const serverJobPollControllers = new Map()
  const pendingCancelTaskIds = new Set()
  const pendingRemoveTaskIds = new Set()
  const completedResultMisses = new Map()
  const localUpscaleControllers = new Map()
  const localUpscalePromises = new Map()
  // 本会话内创建的任务 id：提交流程仍在本页内存中进行，不能被幽灵回收误杀
  const sessionTaskIds = new Set()

  const activeTask = computed(
    () => tasks.value.find((task) => task.id === activeTaskId.value) || null,
  )
  const isRunning = computed(() => runningTaskIds.value.length > 0)
  const activeOutputs = computed(() => activeTask.value?.outputs || [])
  const latestOutput = computed(
    () => activeOutputs.value[selectedOutputIndex.value] || activeOutputs.value[0] || '',
  )
  const elapsedLabel = computed(() => {
    const minutes = Math.floor(elapsedSeconds.value / 60)
    const seconds = elapsedSeconds.value % 60
    if (!minutes) return `${seconds}s`
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  })
  const statusHeroText = computed(() => {
    const task = activeTask.value
    if (!task) return '等待任务'
    if (task.localUpscaleStatus === 'running') {
      return `正在生成 ${task.localUpscaleTarget || '高清'} · ${Math.round(Number(task.localUpscaleProgress || 0))}%`
    }
    if (task.status === 'running') return `已处理 ${elapsedLabel.value}`
    if (task.status === 'done' || task.status === 'completed')
      return `已完成 ${formatDuration(task.finishedAt - task.startedAt)}`
    if (task.status === 'failed') return '任务失败'
    if (task.status === 'canceled' || task.status === 'cancelled') return '任务已取消'
    if (task.status === 'paused') return '任务已暂停'
    if (task.status === 'queued') return '已提交云端处理'
    return '等待处理'
  })

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000))
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    if (!minutes) return `${rest}s`
    return `${minutes}m ${String(rest).padStart(2, '0')}s`
  }

  function taskTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const parsed = Date.parse(String(value || ''))
    return Number.isFinite(parsed) ? parsed : 0
  }

  function formatTaskElapsed(task) {
    if (!task) return ''
    const startedAt = taskTimestamp(task.startedAt || task.started_at)
    if (!startedAt) return ''
    const explicitDuration = Number(task.durationMs || task.duration_ms || 0)
    if (explicitDuration > 0) return formatDuration(explicitDuration)
    const finishedAt = taskTimestamp(task.finishedAt || task.finished_at)
    const status = String(task.status || '').toLowerCase()
    const isActive = ['queued', 'running', 'waiting_provider'].includes(status)
    // Read the shared timer so active cards re-render every second. Date math
    // remains per-task, which keeps concurrent jobs' durations independent.
    const liveTickMs = elapsedSeconds.value * 1000
    const endAt = finishedAt || (isActive ? Date.now() : startedAt)
    const elapsed = Math.max(0, endAt - startedAt)
    if (isActive) return formatDuration(Math.max(elapsed, liveTickMs))
    return elapsed > 0 ? formatDuration(elapsed) : ''
  }

  function taskKindLabel(task) {
    return task?.type === 'video' ? '视频' : '图片'
  }

  function sourceModeLabel(mode) {
    return (
      {
        text: '文字',
        upload: '参考图',
        site: '本站',
        'mask-edit': '局部编辑',
      }[mode] || '文字'
    )
  }

  function taskStatusLabel(status) {
    return (
      {
        queued: '排队中',
        running: '处理中',
        waiting_provider: '等待上游结果',
        done: '已完成',
        completed: '已完成',
        failed: '失败',
        canceled: '已取消',
        cancelled: '已取消',
        paused: '已暂停',
      }[status] || '待处理'
    )
  }

  function persistTasks({ immediate = false } = {}) {
    if (persistTasksTimer && typeof window !== 'undefined') {
      window.clearTimeout(persistTasksTimer)
      persistTasksTimer = null
    }
    const write = () => {
      const serializableTasks = tasks.value
        .slice(0, 30)
        .map(
          ({ sourceFile: _sourceFile, styleReferenceFiles: _styleReferenceFiles, ...task }) => task,
        )
      setScopedLocalItem(tasksKey, JSON.stringify(serializableTasks))
      void syncState()
      persistTasksTimer = null
    }
    if (immediate || typeof window === 'undefined') {
      write()
      return
    }
    persistTasksTimer = window.setTimeout(write, 160)
  }

  // 提交中断的「幽灵任务」：没有 serverJobId 却停在进行中状态。提交流程只活在
  // 创建它的那个页面会话里——刷新后这类任务永远不会再推进（轮询恢复只认
  // serverJobId），会在胶片条上留下空白的 pending 占位。因此：不属于本会话
  // 创建的直接判失败；本会话内的留一个短宽限期（覆盖提交请求在途的窗口）。
  const GHOST_SUBMIT_GRACE_MS = 3 * 60 * 1000

  function isLegacyObjectStorageUrl(value) {
    const raw = String(value || '').trim()
    if (!/^https?:\/\//i.test(raw)) return false
    try {
      const parsed = new URL(raw)
      return (
        parsed.hostname.endsWith('.r2.cloudflarestorage.com') ||
        parsed.searchParams.has('X-Amz-Signature') ||
        parsed.searchParams.has('X-Amz-Credential')
      )
    } catch {
      return false
    }
  }

  function migratePersistedTaskMedia(task) {
    if (!task?.serverJobId) return { task, changed: false }
    let changed = false
    const migrated = { ...task }
    for (const field of ['outputs', 'originalOutputs', 'thumbnailOutputs']) {
      if (!Array.isArray(task[field])) continue
      const next = task[field].filter((url) => !isLegacyObjectStorageUrl(url))
      if (next.length !== task[field].length) changed = true
      migrated[field] = next
    }
    if (isLegacyObjectStorageUrl(task.originalOutputUrl)) {
      migrated.originalOutputUrl = ''
      changed = true
    }
    return { task: changed ? migrated : task, changed }
  }

  function reconcileGhostTasks(list) {
    const now = Date.now()
    let changed = false
    const next = list.map((task) => {
      const busy = ['queued', 'running', 'waiting_provider'].includes(String(task?.status || ''))
      if (!busy || task.serverJobId) return task
      const created = Number(task.startedAt) || Date.parse(String(task.createdAt || '')) || 0
      if (
        sessionTaskIds.has(String(task?.id || '')) &&
        created &&
        now - created < GHOST_SUBMIT_GRACE_MS
      )
        return task
      changed = true
      return {
        ...task,
        status: 'failed',
        error: '任务提交被中断（提交完成前离开了页面），请重新生成',
        finishedAt: created || now,
      }
    })
    return { next, changed }
  }

  function loadTasks() {
    try {
      const raw = JSON.parse(getScopedLocalItem(tasksKey) || '[]')
      const filtered = (Array.isArray(raw) ? raw : []).filter(
        (task) => !looksLikeIllustrationColoringTask(task),
      )
      let mediaMigrated = false
      const stableMediaTasks = filtered.map((task) => {
        const migrated = migratePersistedTaskMedia(task)
        mediaMigrated = mediaMigrated || migrated.changed
        return migrated.task
      })
      const { next, changed } = reconcileGhostTasks(stableMediaTasks)
      tasks.value = next
      taskMutationVersion += 1
      if (mediaMigrated || changed || tasks.value.length !== (Array.isArray(raw) ? raw.length : 0)) {
        persistTasks({ immediate: true })
      }
    } catch {
      tasks.value = []
    }
    try {
      const draft = JSON.parse(getScopedLocalItem(studioDraftKey) || 'null')
      const savedActiveId = String(draft?.activeTaskId || '').trim()
      if (savedActiveId && tasks.value.some((task) => task.id === savedActiveId)) {
        activeTaskId.value = savedActiveId
      } else {
        activeTaskId.value = tasks.value[0]?.id || ''
      }
    } catch {
      activeTaskId.value = tasks.value[0]?.id || ''
    }
  }

  function restoreRunningTaskUi() {
    const running = tasks.value.filter(
      (task) => task.serverJobId && !isTerminalServerJobStatus(task.status),
    )
    if (!running.length) return
    runningTaskIds.value = running.map((task) => task.id)
    runningTaskId.value = running[0].id
    const startedAt =
      Number(running[0].startedAt) || Date.parse(running[0].createdAt || '') || Date.now()
    startTimer(startedAt)
  }

  function updateTask(id, patch, options = {}) {
    let applied = false
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id) return task
      const incomingStatus = String(patch?.status || '').toLowerCase()
      // A delayed polling/list response must never move a locally observed
      // terminal task back to queued/running. Keep the whole terminal snapshot
      // so stale logs/errors do not flicker either.
      if (shouldKeepExistingTaskSnapshot(task.status, incomingStatus)) {
        return task
      }
      applied = true
      return { ...task, ...patch }
    })
    if (!applied) return
    taskMutationVersion += 1
    if (!activeTaskId.value) activeTaskId.value = id
    const critical =
      options.persistImmediately === true ||
      patch.serverJobId != null ||
      patch.outputs != null ||
      patch.sourceRemoteUrl != null ||
      patch.status === 'completed' ||
      patch.status === 'done' ||
      patch.status === 'failed'
    persistTasks({ immediate: critical })
  }

  function appendLog(id, text) {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return
    const logs = task.logs || []
    if (logs.at(-1) === text) return
    updateTask(id, {
      logs: [...logs, text].slice(-12),
    })
  }

  function isTerminalServerJobStatus(status) {
    return SERVER_JOB_TERMINAL_STATUSES.has(String(status || '').toLowerCase())
  }

  function stopServerJobPolling(taskId) {
    const poller = serverJobPollers.get(taskId)
    if (poller && typeof window !== 'undefined') window.clearInterval(poller)
    serverJobPollers.delete(taskId)
    serverJobPollControllers.get(taskId)?.abort()
    serverJobPollControllers.delete(taskId)
    serverJobPollsInFlight.delete(taskId)
    completedResultMisses.delete(taskId)
  }

  function stopAllServerJobPolling() {
    const taskIds = new Set([...serverJobPollers.keys(), ...serverJobPollControllers.keys()])
    taskIds.forEach(stopServerJobPolling)
  }

  function resumeServerJobPolling() {
    if (typeof window === 'undefined') return
    if (!authStore.isAuthenticated) return
    tasks.value
      .filter((task) => task.serverJobId && !isTerminalServerJobStatus(task.status))
      .slice(0, 8)
      .forEach((task) => startServerJobPolling(task.id))
  }

  function startTimer(startedAt) {
    stopTimer()
    if (typeof window === 'undefined') return
    timer = window.setInterval(() => {
      elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
  }

  function stopTimer() {
    if (timer && typeof window !== 'undefined') {
      window.clearInterval(timer)
      timer = null
    }
  }

  function createTaskRecord(overrides = {}) {
    const now = Date.now()
    const userPrompt = String(prompt.value || '').trim()
    const taskReferences = outputType.value === 'image' ? referenceImages.value.slice(0, 4) : []
    const kind =
      outputType.value === 'video'
        ? 'wallpaper-video-generation'
        : inputMode.value === 'text' && !taskReferences.length
          ? 'wallpaper-image-generation'
          : 'wallpaper-image-edit'
    const outputSize = resolveT2iOutputSize(aspectRatio.value, resolutionScale.value)
    const publicModelKey = String(
      outputType.value === 'video' ? videoDispatchModel.value : imageDispatchModel.value || '',
    ).trim()
    const publicModel = publicModelOptions.value.find((item) => item.id === publicModelKey)
    const activeSkills = resolveActiveWallpaperSkills({
      outputType: outputType.value,
      resolutionScale: resolutionScale.value,
      superResolutionEnabled: superResolutionFeatureEnabled.value,
      selectedSkillIds: _selectedSkillIds.value,
      customSkills: _customSkills.value,
    })
    const skillPrompt = buildWallpaperSkillPrompt(activeSkills)
    localTaskSequence += 1
    const taskId = overrides.id || `${now}-${localTaskSequence}`
    sessionTaskIds.add(String(taskId))
    return {
      id: taskId,
      // 每次点击生成一个幂等键，经适配层映射为服务端 idempotencyKey
      clientRequestId: crypto.randomUUID(),
      batchId: String(overrides.batchId || ''),
      batchIndex: Math.max(0, Number(overrides.batchIndex || 0)),
      batchSize: Math.max(1, Number(overrides.batchSize || 1)),
      batchCreatedAt: overrides.batchCreatedAt || new Date(now).toISOString(),
      kind,
      status: 'queued',
      type: outputType.value,
      executionMode: 'server',
      model: publicModel?.label || publicModel?.name || publicModelKey || '未知模型',
      publicModelKey,
      sourceMode: 'text',
      sourcePreview: '',
      sourceRemoteUrl: '',
      sourceFile: null,
      styleReferenceFiles: taskReferences.map((item) => item.file).filter(Boolean),
      styleReferenceUrls: taskReferences.map((item) => item.url).filter(Boolean),
      styleReferencePreviews: taskReferences.map((item) => item.preview).filter(Boolean),
      sourceLabel: taskReferences.length ? `${taskReferences.length} 张参考图` : '纯提示词生成',
      userPrompt,
      prompt: [composePrompt(), skillPrompt].filter(Boolean).join('\n\n'),
      promptPolishEnabled: promptPolishEnabled.value,
      autoTranslateEnabled: autoTranslateEnabled.value,
      transparentPngEnabled: outputType.value === 'image' && transparentPngEnabled.value,
      aspectRatio: aspectRatio.value,
      outputSize,
      upstreamOutputSize: outputSize,
      upscaleTargetSize: '',
      originalOutputSize: '',
      actualOutputSize: '',
      resolutionScale: resolutionScale.value,
      upscaleOutputFormat: transparentPngEnabled.value === true ? 'png' : upscaleOutputFormat.value,
      quality: imageQuality.value,
      count: Math.max(
        1,
        Number(overrides.count ?? (outputType.value === 'image' ? imageCount.value : 1)),
      ),
      duration: outputType.value === 'video' ? duration.value : null,
      creativity: creativity.value,
      styleStrength: styleStrength.value,
      detailBoost: detailBoost.value,
      privacyMode: privacyMode.value,
      motionStrength: outputType.value === 'video' ? videoMotion.value : null,
      skills: activeSkills,
      skillIds: activeSkills.map((skill) => skill.id),
      mcpServers: [],
      outputs: [],
      logs: ['正在思考'],
      createdAt: new Date(now).toISOString(),
      startedAt: 0,
      finishedAt: 0,
    }
  }

  async function createTask() {
    if (!canCreateTask.value) return
    if (autoSaveConfig.value) saveStudioConfig()
    const batchSize =
      outputType.value === 'image' ? Math.min(4, Math.max(1, Number(imageCount.value) || 1)) : 1
    const batchCreatedAt = new Date().toISOString()
    const batchId = batchSize > 1 ? `batch-${Date.now()}-${localTaskSequence + 1}` : ''
    const batchTasks = Array.from({ length: batchSize }, (_, batchIndex) =>
      createTaskRecord({
        batchId,
        batchIndex,
        batchSize,
        batchCreatedAt,
        // One local child equals one server job and one upstream request.
        count: 1,
      }),
    )
    tasks.value = [...batchTasks, ...tasks.value].slice(0, 30)
    taskMutationVersion += 1
    activeTaskId.value = batchTasks[0].id
    selectedOutputIndex.value = 0
    canvasMode.value = 'result'
    resetCanvasView({ keepFit: true })
    persistTasks({ immediate: true })

    // All children await the same upload promise, so references are uploaded once
    // and then each slot independently submits a count=1 server job.
    const preparedSourceUrls = batchSize > 1 ? ensureInputUrlsForTask(batchTasks[0]) : null
    await Promise.allSettled(
      batchTasks.map((task) =>
        runServerTask(task.id, {
          preparedSourceUrls,
          silentNotifications: batchSize > 1,
        }),
      ),
    )

    if (batchSize > 1 && !disposed) {
      const submittedCount = batchTasks.reduce((total, batchTask) => {
        const latest = tasks.value.find((item) => item.id === batchTask.id)
        return total + (latest?.serverJobId ? 1 : 0)
      }, 0)
      if (submittedCount === batchSize) {
        notify.success(`已并发提交 ${batchSize} 张图片`)
      } else if (submittedCount > 0) {
        notify.warning(`已并发提交 ${submittedCount}/${batchSize} 张，其余任务提交失败`)
      } else {
        notify.error(`${batchSize} 张图片均未能提交，请检查模型后重试`)
      }
    }
  }

  async function createMaskedEditTask({
    sourceTask,
    sourceUrl,
    maskFile,
    prompt: editPrompt,
  } = {}) {
    const normalizedSourceUrl = String(sourceUrl || '').trim()
    const normalizedPrompt = String(editPrompt || '').trim()
    if (!sourceTask || !normalizedSourceUrl) throw new Error('没有可用于局部编辑的原图')
    if (!(maskFile instanceof File) || !maskFile.size) throw new Error('局部编辑蒙版无效')
    if (!normalizedPrompt) throw new Error('请描述蒙版区域需要修改成什么')
    if (!String(imageDispatchModel.value || '').trim())
      throw new Error('请先选择支持局部编辑的图片模型')

    const sourceBlob = await fetchAuthenticatedMediaBlob(normalizedSourceUrl, { cache: 'no-store' })
    const sourceExtension = /png/i.test(sourceBlob.type)
      ? 'png'
      : /webp/i.test(sourceBlob.type)
        ? 'webp'
        : 'jpg'
    const sourceFile = new File(
      [sourceBlob],
      `local-edit-source-${Date.now()}.${sourceExtension}`,
      { type: sourceBlob.type || 'image/jpeg' },
    )
    const [uploadedSourceUrl, maskUrl] = await Promise.all([
      uploadAiInputFile(sourceFile),
      uploadAiInputFile(maskFile),
    ])

    const task = createTaskRecord({ count: 1 })
    const outputSize =
      sourceTask.upstreamOutputSize ||
      sourceTask.outputSize ||
      resolveT2iOutputSize(
        sourceTask.aspectRatio || aspectRatio.value,
        sourceTask.resolutionScale || '2K',
      )
    Object.assign(task, {
      kind: 'wallpaper-image-mask-edit',
      type: 'image',
      sourceMode: 'mask-edit',
      sourceRemoteUrl: uploadedSourceUrl,
      sourcePreview: normalizedSourceUrl,
      sourceFile: null,
      styleReferenceFiles: [],
      styleReferenceUrls: [],
      styleReferencePreviews: [],
      sourceLabel: '局部蒙版编辑',
      maskUrl,
      maskSourceUrl: normalizedSourceUrl,
      userPrompt: normalizedPrompt,
      prompt: `${normalizedPrompt}\n\n只修改透明蒙版标记的区域，未被蒙版选中的像素、主体身份、构图、比例和光线必须保持不变。`,
      promptPolishEnabled: false,
      autoTranslateEnabled: false,
      aspectRatio: sourceTask.aspectRatio || task.aspectRatio,
      outputSize,
      upstreamOutputSize: outputSize,
      actualOutputSize: '',
      resolutionScale: sourceTask.resolutionScale || task.resolutionScale,
      quality: sourceTask.quality || task.quality,
      count: 1,
      skills: [],
      skillIds: [],
      outputs: [],
      logs: ['正在准备局部编辑任务'],
    })

    tasks.value = [task, ...tasks.value].slice(0, 30)
    taskMutationVersion += 1
    activeTaskId.value = task.id
    selectedOutputIndex.value = 0
    canvasMode.value = 'result'
    resetCanvasView({ keepFit: true })
    persistTasks({ immediate: true })
    await runServerTask(task.id, { preparedSourceUrls: [uploadedSourceUrl] })
    return task
  }

  function resolveTaskLocalUpscaleScale(task, { manual = false } = {}) {
    const configured = String(task?.resolutionScale || '')
      .trim()
      .toUpperCase()
    if (configured === '8K') return '8K'
    if (configured === '4K') return '4K'
    if (configured === '2K') return manual && task?.localUpscaleStatus === 'completed' ? '4K' : '2K'
    if (configured === '1K') return manual && task?.localUpscaleStatus === 'completed' ? '2K' : '1K'
    const sizeMatch = String(task?.outputSize || '').match(/(\d+)\s*[x×]\s*(\d+)/i)
    const longest = sizeMatch ? Math.max(Number(sizeMatch[1]), Number(sizeMatch[2])) : 0
    if (longest >= 7000) return '8K'
    if (longest >= 3500) return '4K'
    if (longest >= 1500) return '2K'
    return manual ? '2K' : '1K'
  }

  async function runLocalUpscale(
    taskId,
    sourceUrl,
    {
      manual = false,
      targetScale: requestedTargetScale = '',
      outputFormat: requestedOutputFormat = '',
    } = {},
  ) {
    const existingPromise = localUpscalePromises.get(taskId)
    if (existingPromise) return existingPromise
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task || !sourceUrl) throw new Error('没有可用于高清放大的原图')
    if (!superResolutionFeatureEnabled.value) throw new Error('高清放大功能当前已关闭')
    if (!task.serverJobId) throw new Error('当前图片尚未写入云端任务')
    const normalizedRequestedTarget = String(requestedTargetScale || '')
      .trim()
      .toUpperCase()
    const targetScale = ['2K', '4K', '8K'].includes(normalizedRequestedTarget)
      ? normalizedRequestedTarget
      : resolveTaskLocalUpscaleScale(task, { manual })
    if (!['1K', '2K', '4K', '8K'].includes(targetScale)) return null

    const controller = new AbortController()
    localUpscaleControllers.set(taskId, controller)
    runningTaskId.value = taskId
    runningTaskIds.value = [...new Set([...runningTaskIds.value, taskId])]
    updateTask(
      taskId,
      {
        localUpscaleStatus: 'running',
        localUpscaleProgress: 5,
        localUpscaleTarget: targetScale,
        localUpscaleError: '',
        localUpscaleStage: 'prepare',
        localUpscaleMessage: '正在准备本地画质重建',
        logs: [...(task.logs || []), `正在本地生成 ${targetScale} 高清图片`].slice(-12),
      },
      { persistImmediately: true },
    )

    const progressController = createUpscaleProgressController(
      ({ progress, message, stage, profile }) => {
        const current = tasks.value.find((item) => item.id === taskId)
        updateTask(taskId, {
          localUpscaleProgress: progress,
          localUpscaleStage: stage,
          localUpscaleMessage: message,
          localUpscaleProfile: profile || current?.localUpscaleProfile || '',
          logs:
            message && current?.logs?.at(-1) !== message
              ? [...(current?.logs || []), message].slice(-12)
              : current?.logs || [],
        })
      },
      { progress: 5, stage: 'prepare', message: '正在准备本地画质重建' },
    )

    const promise = (async () => {
      try {
        const result = await createLocalUpscaledImage({
          sourceUrl,
          resolutionScale: targetScale,
          transparentPng: task.transparentPngEnabled === true,
          outputFormat:
            task.transparentPngEnabled === true
              ? 'png'
              : normalizeUpscaleOutputFormat(
                  requestedOutputFormat || task.upscaleOutputFormat || upscaleOutputFormat.value,
                ),
          signal: controller.signal,
          onProgress(progress, message, details) {
            progressController.report(progress, message, details)
          },
        })
        if (result.skipped) {
          updateTask(
            taskId,
            {
              localUpscaleStatus: 'completed',
              localUpscaleProgress: 100,
              localUpscaleStage: 'completed',
              localUpscaleMessage: '当前图片已经达到目标尺寸',
              outputSize: `${result.targetWidth}x${result.targetHeight}`,
              upstreamOutputSize:
                task.upstreamOutputSize || `${result.sourceWidth}x${result.sourceHeight}`,
              upscaleTargetSize: `${result.targetWidth}x${result.targetHeight}`,
              originalOutputSize: `${result.sourceWidth}x${result.sourceHeight}`,
              actualOutputSize: `${result.targetWidth}x${result.targetHeight}`,
              logs: [
                ...(tasks.value.find((item) => item.id === taskId)?.logs || []),
                '当前图片已达到目标尺寸',
              ].slice(-12),
            },
            { persistImmediately: true },
          )
          return result
        }

        progressController.report(96, '正在上传并校验无损图片', {
          stage: 'upload',
          profile: result.enhancementProfile,
        })
        const response = await replaceServerAiJobResultWithLocalUpscale(
          task.serverJobId,
          result.file,
          {
            targetWidth: result.targetWidth,
            targetHeight: result.targetHeight,
            resolutionScale: result.resolutionScale,
            signal: controller.signal,
          },
        )
        const serverResultUrls = (
          Array.isArray(response?.job?.resultMediaUrls)
            ? response.job.resultMediaUrls
            : [response?.job?.resultMediaUrl]
        )
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        const stableResultUrl = String(serverResultUrls[0] || sourceUrl).trim()
        const originalOutputUrl = String(
          response?.job?.originalResultMediaUrl || task.originalOutputUrl || '',
        ).trim()
        const versionedResultUrl = `${stableResultUrl}${stableResultUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
        const latest = tasks.value.find((item) => item.id === taskId)
        updateTask(
          taskId,
          {
            outputs: [versionedResultUrl, ...serverResultUrls.slice(1)],
            originalOutputs: [versionedResultUrl, ...serverResultUrls.slice(1)],
            thumbnailOutputs: [versionedResultUrl, ...serverResultUrls.slice(1)],
            outputSize: `${result.targetWidth}x${result.targetHeight}`,
            upstreamOutputSize:
              task.upstreamOutputSize || `${result.sourceWidth}x${result.sourceHeight}`,
            upscaleTargetSize: `${result.targetWidth}x${result.targetHeight}`,
            resolutionScale: result.resolutionScale,
            localUpscaleStatus: 'completed',
            localUpscaleProgress: 100,
            localUpscaleTarget: result.resolutionScale,
            localUpscaleError: '',
            localUpscaleStage: 'completed',
            localUpscaleMessage: `${result.outputFormat || '无损'} 画质重建完成`,
            localUpscaleProfile: result.enhancementProfile || '',
            localUpscaleFormat: result.outputFormat || '',
            upscaleOutputFormat: String(result.outputFormat || '').toLowerCase() || 'auto',
            originalOutputUrl,
            originalOutputSize: `${result.sourceWidth}x${result.sourceHeight}`,
            actualOutputSize: `${result.targetWidth}x${result.targetHeight}`,
            logs: [...(latest?.logs || []), `${result.resolutionScale} 高清图片已保存`].slice(-12),
          },
          { persistImmediately: true },
        )
        if (activeTaskId.value === taskId) {
          selectedOutputIndex.value = 0
          canvasMode.value = 'result'
          resetCanvasView({ keepFit: true })
        }
        notify.success(`${result.resolutionScale} 高清图片已生成`)
        progressController.complete(`${result.resolutionScale} 无损画质重建完成`)
        return result
      } catch (error) {
        const aborted = error?.name === 'AbortError' || controller.signal.aborted
        const latest = tasks.value.find((item) => item.id === taskId)
        updateTask(
          taskId,
          {
            localUpscaleStatus: aborted ? 'cancelled' : 'failed',
            localUpscaleProgress: 0,
            localUpscaleError: aborted ? '' : error?.message || '高清放大失败',
            localUpscaleStage: aborted ? 'cancelled' : 'failed',
            localUpscaleMessage: aborted ? '处理已取消，原图未受影响' : '处理失败，已保留原图',
            logs: [
              ...(latest?.logs || []),
              aborted ? '高清放大已取消，已保留原图' : '高清放大失败，已保留原始图片',
            ].slice(-12),
          },
          { persistImmediately: true },
        )
        if (!aborted) notify.warning(error?.message || '高清放大失败，已保留原始图片')
        if (manual && !aborted) throw error
        return null
      } finally {
        progressController.stop()
        localUpscaleControllers.delete(taskId)
        localUpscalePromises.delete(taskId)
        runningTaskIds.value = runningTaskIds.value.filter((id) => id !== taskId)
        if (runningTaskId.value === taskId) runningTaskId.value = runningTaskIds.value[0] || ''
        if (!runningTaskIds.value.length) stopTimer()
      }
    })()
    localUpscalePromises.set(taskId, promise)
    return promise
  }

  async function createUpscaleTask(sourceTask, sourceUrl, options = {}) {
    if (!sourceTask || !sourceUrl) throw new Error('没有可用于高清放大的原图')
    const outputFormat = normalizeUpscaleOutputFormat(
      sourceTask.transparentPngEnabled === true
        ? 'png'
        : options.outputFormat || upscaleOutputFormat.value,
    )
    return runLocalUpscale(sourceTask.id, sourceUrl, {
      manual: true,
      targetScale: options.targetScale,
      outputFormat,
    })
  }

  async function runServerTask(
    taskId,
    { preparedSourceUrls = null, silentNotifications = false } = {},
  ) {
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task) return
    runningTaskId.value = taskId
    runningTaskIds.value = [...new Set([...runningTaskIds.value, taskId])]
    const startedAt = Date.now()
    elapsedSeconds.value = 0
    startTimer(startedAt)
    updateTask(taskId, { status: 'running', startedAt, logs: ['正在提交到云端处理'] })
    try {
      const dispatchModel = String(
        task.publicModelKey ||
          task.gatewayModelId ||
          (task.type === 'video' ? videoDispatchModel.value : imageDispatchModel.value),
      ).trim()
      await ensureWallpaperBudgetAvailable(dispatchModel, Math.max(1, Number(task.count || 1)))
      appendLog(taskId, '正在准备任务参数')
      const resolvedSourceUrls = preparedSourceUrls
        ? await Promise.resolve(preparedSourceUrls)
        : await ensureInputUrlsForTask(task)
      const sourceUrls = Array.from(
        new Set((Array.isArray(resolvedSourceUrls) ? resolvedSourceUrls : []).filter(Boolean)),
      ).slice(0, 4)
      const sourceUrl = sourceUrls[0] || ''
      const publicModel = publicModelOptions.value.find((item) => item.id === dispatchModel)
      const pricing = publicModel
        ? { usd: Number(publicModel.userPriceUsd || 0) }
        : getRuntimeImageModelPricing(
            dispatchModel,
            studioProvider.value || 'gptsapi',
            runtimeModelCatalog.value,
          )
      const requestCount = 1
      const estimatedCostUsd = Number(pricing.usd || 0) * requestCount
      const outputSize =
        task.outputSize || resolveT2iOutputSize(task.aspectRatio, task.resolutionScale || '2K')
      const qualityRaw = String(task.quality || imageQuality.value || 'high').toLowerCase()
      const quality =
        qualityRaw === 'hd' || qualityRaw === 'high'
          ? 'high'
          : qualityRaw === 'standard' || qualityRaw === 'medium'
            ? 'medium'
            : qualityRaw || 'high'
      if (pendingCancelTaskIds.has(taskId)) {
        pendingCancelTaskIds.delete(taskId)
        pendingRemoveTaskIds.delete(taskId)
        return
      }
      const response = await createServerAiJobRequest({
        kind: task.kind,
        clientRequestId: task.clientRequestId || crypto.randomUUID(),
        prompt: task.prompt,
        input: {
          sourceUrl,
          sourceUrls,
          maskUrl: task.maskUrl || '',
          aspectRatio: task.aspectRatio,
          outputSize,
          size: outputSize,
          resolutionScale: task.resolutionScale || '',
          quality,
          count: requestCount,
          n: requestCount,
          batchId: task.batchId || '',
          batchIndex: Number(task.batchIndex || 0),
          batchSize: Number(task.batchSize || 1),
          batchCreatedAt: task.batchCreatedAt || task.createdAt || '',
          duration: task.duration,
          sourceMode: task.sourceMode || 'text',
          userPrompt: task.userPrompt || '',
          promptPolishEnabled: task.promptPolishEnabled === true,
          autoTranslateEnabled: task.autoTranslateEnabled === true,
          transparentPngEnabled: task.transparentPngEnabled === true,
          upscaleOutputFormat: task.upscaleOutputFormat || 'auto',
          skills: task.skills || [],
          skillIds: task.skillIds || [],
        },
        params: {
          providerHint: publicModel ? '' : studioProvider.value || 'gptsapi',
          modelHint: dispatchModel,
          publicModelKey: publicModel?.id || '',
          aspectRatio: task.aspectRatio,
          outputSize,
          size: outputSize,
          resolutionScale: task.resolutionScale || '',
          quality,
          count: requestCount,
          n: requestCount,
          batchId: task.batchId || '',
          batchIndex: Number(task.batchIndex || 0),
          batchSize: Number(task.batchSize || 1),
          batchCreatedAt: task.batchCreatedAt || task.createdAt || '',
          duration: task.duration,
          sourceMode: task.sourceMode || 'text',
          sourceUrl,
          sourceUrls,
          maskUrl: task.maskUrl || '',
          userPrompt: task.userPrompt || '',
          promptPolishEnabled: task.promptPolishEnabled === true,
          autoTranslateEnabled: task.autoTranslateEnabled === true,
          transparentPngEnabled: task.transparentPngEnabled === true,
          upscaleOutputFormat: task.upscaleOutputFormat || 'auto',
          skills: task.skills || [],
          skillIds: task.skillIds || [],
          executionMode: 'server',
        },
        estimatedCostUsd,
        units: requestCount,
      })
      const serverJobId = response.job?.id || ''
      if (pendingCancelTaskIds.has(taskId)) {
        const removeRequested = pendingRemoveTaskIds.has(taskId)
        pendingCancelTaskIds.delete(taskId)
        pendingRemoveTaskIds.delete(taskId)
        let cancelResponse = null
        try {
          if (serverJobId) cancelResponse = await cancelServerAiJob(serverJobId)
        } catch (error) {
          if (!removeRequested && !disposed) {
            updateTask(
              taskId,
              {
                status: response.job?.status || 'queued',
                serverJobId,
                error: error?.message || '取消结果未确认',
                logs: ['任务已提交，但取消结果未确认；正在继续同步'].slice(-12),
              },
              { persistImmediately: true },
            )
            startServerJobPolling(taskId)
          }
          if (!disposed && !silentNotifications)
            notify.error(error?.message || '取消结果未确认，任务未标记为已取消')
          return
        }
        if (!isConfirmedServerJobCancellation(cancelResponse)) {
          if (!removeRequested && !disposed) {
            const serverStatus = String(
              cancelResponse?.job?.status || response.job?.status || 'queued',
            ).toLowerCase()
            updateTask(
              taskId,
              {
                status: serverStatus,
                serverJobId,
                error: String(cancelResponse?.job?.error || ''),
                logs: ['服务端未确认取消；正在继续同步'].slice(-12),
              },
              { persistImmediately: true },
            )
            if (!isTerminalServerJobStatus(serverStatus)) startServerJobPolling(taskId)
          }
          if (!disposed && !silentNotifications)
            notify.warning('服务端未确认取消，任务不会显示为已取消')
          return
        }
        if (removeRequested && serverJobId) {
          await deleteServerAiJob(serverJobId).catch(() => null)
          return
        }
        if (!disposed) {
          updateTask(
            taskId,
            {
              status: 'cancelled',
              serverJobId,
              finishedAt: Date.now(),
              logs: ['任务已在提交后取消'],
            },
            { persistImmediately: true },
          )
        }
        return
      }
      if (disposed) return
      appendLog(taskId, '已提交云端处理')
      updateTask(
        taskId,
        {
          status: response.job?.status || 'queued',
          serverJobId: response.job?.id || '',
          estimatedCostUsd: response.job?.estimatedCostUsd ?? estimatedCostUsd,
          sourceRemoteUrl: sourceUrl || task.sourceRemoteUrl || '',
          logs: ['已提交云端处理', '正在等待结果'],
        },
        { persistImmediately: true },
      )
      if (!silentNotifications) {
        notify.success(
          task.isSuperResolution ? '已提交 2 倍超分任务，原图会继续保留' : 'AI 任务已提交云端处理',
        )
      }
      // 创建响应和当前任务轮询已经包含所需状态。此处若全量刷新任务列表，
      // 服务端会为历史图片生成新签名 URL，导致所有已显示图片释放缓存并闪黑。
    } catch (error) {
      const cancelRequested = pendingCancelTaskIds.delete(taskId)
      const removeRequested = pendingRemoveTaskIds.delete(taskId)
      if (!disposed && !removeRequested) {
        if (cancelRequested) {
          // 用户已经取消时，提交异常不能把取消终态回写成失败。
          updateTask(
            taskId,
            {
              status: 'cancelled',
              error: '',
              finishedAt: Date.now(),
              logs: ['任务已取消；云端提交未完成'],
            },
            { persistImmediately: true },
          )
        } else {
          updateTask(taskId, {
            status: 'failed',
            error: error?.message || '云端 AI 任务创建失败',
            finishedAt: Date.now(),
          })
          appendLog(taskId, '提交失败')
          const creditHandled = typeof onCreditError === 'function' && onCreditError(error)
          if (!creditHandled && !silentNotifications) {
            notify.error(error?.message || '云端 AI 任务创建失败')
          }
        }
      }
    } finally {
      const latest = tasks.value.find((item) => item.id === taskId)
      if (latest?.serverJobId && !isTerminalServerJobStatus(latest.status)) {
        startServerJobPolling(taskId)
      } else {
        runningTaskIds.value = runningTaskIds.value.filter((id) => id !== taskId)
        if (runningTaskId.value === taskId) runningTaskId.value = ''
        if (!runningTaskIds.value.length) stopTimer()
      }
    }
  }

  function startServerJobPolling(taskId) {
    if (disposed || typeof window === 'undefined') return
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task?.serverJobId || !authStore.isAuthenticated) return
    if (serverJobPollers.has(taskId)) return
    runningTaskId.value = taskId
    runningTaskIds.value = [...new Set([...runningTaskIds.value, taskId])]
    if (!timer) startTimer(task.startedAt || Date.now())
    pollServerTask(taskId)
    const poller = window.setInterval(() => {
      pollServerTask(taskId)
    }, pollIntervalMs)
    serverJobPollers.set(taskId, poller)
  }

  function pollServerTask(taskId) {
    const inFlight = serverJobPollsInFlight.get(taskId)
    if (inFlight) return inFlight
    const request = pollServerTaskOnce(taskId).finally(() => {
      if (serverJobPollsInFlight.get(taskId) === request) {
        serverJobPollsInFlight.delete(taskId)
      }
    })
    serverJobPollsInFlight.set(taskId, request)
    return request
  }

  async function pollServerTaskOnce(taskId) {
    if (disposed) return
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task?.serverJobId || !authStore.isAuthenticated) {
      stopServerJobPolling(taskId)
      return
    }
    const controller = new AbortController()
    serverJobPollControllers.get(taskId)?.abort()
    serverJobPollControllers.set(taskId, controller)
    try {
      const response = await getServerAiJob(task.serverJobId, { signal: controller.signal })
      if (disposed || controller.signal.aborted) return
      const job = response.job || {}
      const status = job.status || task.status
      const nextLog =
        status === 'running'
          ? '云端正在执行'
          : status === 'queued'
            ? '云端等待中'
            : status === 'completed'
              ? '云端任务完成，正在读取结果'
              : status === 'failed'
                ? '云端任务失败'
                : `云端状态：${taskStatusLabel(status)}`
      const baseLogs = task.logs || []
      const patch = {
        status,
        error: job.error || '',
        estimatedCostUsd: job.estimatedCostUsd ?? task.estimatedCostUsd,
        logs: (baseLogs.at(-1) === nextLog ? baseLogs : [...baseLogs, nextLog]).slice(-12),
      }

      if (status === 'completed' || status === 'paused') {
        const jobThumbnailUrls = (
          Array.isArray(job.resultMediaUrls) ? job.resultMediaUrls : [job.resultMediaUrl]
        )
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        const jobOriginalUrls = (
          Array.isArray(job.originalMediaUrls)
            ? job.originalMediaUrls
            : [job.originalMediaUrl || job.originalResultMediaUrl]
        )
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        const existingOutputs = [...(Array.isArray(task.outputs) ? task.outputs : [])]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        const existingOriginalOutputs = [
          ...(Array.isArray(task.originalOutputs) ? task.originalOutputs : existingOutputs),
        ]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        const existingThumbnailOutputs = [
          ...(Array.isArray(task.thumbnailOutputs) ? task.thumbnailOutputs : existingOutputs),
        ]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        let outputs = jobOriginalUrls.length ? [...jobOriginalUrls] : [...existingOriginalOutputs]
        try {
          const resultResponse = await getServerAiJobResult(task.serverJobId, {
            signal: controller.signal,
          })
          if (disposed || controller.signal.aborted) return
          const extractedOutputs = extractServerJobOutputs(resultResponse.result)
          const stableOutputCount = jobOriginalUrls.length
          outputs = [
            ...outputs,
            ...extractedOutputs.slice(stableOutputCount),
            ...existingOriginalOutputs.slice(Math.max(stableOutputCount, extractedOutputs.length)),
          ]
        } catch (error) {
          if (error?.name === 'AbortError') throw error
          // completed 与结果对象写入之间可能存在极短可见性延迟；保留媒体直链并继续短暂轮询。
        }
        outputs = Array.from(
          new Set(outputs.map((item) => String(item || '').trim()).filter(Boolean)),
        )
        const thumbnailOutputs = Array.from(
          new Set(
            (jobThumbnailUrls.length ? jobThumbnailUrls : existingThumbnailOutputs)
              .map((item) => String(item || '').trim())
              .filter(Boolean),
          ),
        )
        const displayOutputs = outputs.length ? outputs : thumbnailOutputs
        patch.outputs = displayOutputs.length ? displayOutputs : task.outputs
        patch.originalOutputs = displayOutputs.length
          ? displayOutputs
          : task.originalOutputs || task.outputs
        patch.thumbnailOutputs = thumbnailOutputs.length
          ? thumbnailOutputs
          : task.thumbnailOutputs || displayOutputs
        patch.finishedAt =
          Date.parse(String(job.finishedAt || '')) ||
          (Number(job.durationMs || 0) > 0 && task.startedAt
            ? Number(task.startedAt) + Number(job.durationMs)
            : Date.now())
        if (status === 'completed') {
          patch.logs = [
            ...(task.logs || []),
            outputs.length ? '云端结果已同步' : '任务已完成，结果文件正在同步',
          ].slice(-12)
          if (outputs.length) completedResultMisses.delete(taskId)
          else completedResultMisses.set(taskId, (completedResultMisses.get(taskId) || 0) + 1)
          if (outputs.length && activeTaskId.value === taskId) {
            selectedOutputIndex.value = 0
            canvasMode.value = 'result'
          }
          if (!task.usageRecorded) {
            patch.usageRecorded = true
            const dispatchModel =
              task.publicModelKey ||
              task.gatewayModelId ||
              (task.type === 'video' ? videoDispatchModel.value : imageDispatchModel.value)
            const snapshot = studioBudgetGuard?.getCostSnapshot?.(
              dispatchModel,
              Math.max(1, Number(task.count || 1)),
            )
            if (snapshot?.billingMode === 'credits' && snapshot.unitCost > 0) {
              recordAiUsage({
                settingsStore,
                featureKey: 'wallpaper',
                model: dispatchModel,
                status: 'success',
                billingMode: 'credits',
                unitCost: snapshot.unitCost,
              })
            }
          }
        } else {
          patch.logs = [
            ...(task.logs || []),
            outputs.length
              ? '上游已结束，结果已尽量同步；任务处于暂停（不会重复扣费）'
              : '上游可能已结束，但本地结果未就绪，任务已暂停',
          ].slice(-12)
          if (outputs.length && activeTaskId.value === taskId) {
            selectedOutputIndex.value = 0
            canvasMode.value = 'result'
          }
        }
      }

      updateTask(taskId, patch, {
        persistImmediately: isTerminalServerJobStatus(status) || !!patch.outputs?.length,
      })

      const waitingForCompletedResult =
        status === 'completed' &&
        !(patch.outputs || []).length &&
        (completedResultMisses.get(taskId) || 0) < 10
      if (isTerminalServerJobStatus(status) && !waitingForCompletedResult) {
        stopServerJobPolling(taskId)
        runningTaskIds.value = runningTaskIds.value.filter((id) => id !== taskId)
        if (runningTaskId.value === taskId) runningTaskId.value = ''
        if (!runningTaskIds.value.length) stopTimer()
        if (status === 'completed' && patch.outputs?.length) {
          notify.success('云端 AI 任务已完成')
        } else if (status === 'completed') {
          notify.error('任务已完成，但结果文件暂时无法读取，请稍后刷新任务')
        } else if (status === 'paused') {
          notify.warning(
            patch.outputs?.length
              ? '上游已出图，任务已暂停（结果已尽量同步，不会重复扣费）'
              : '任务已暂停：上游可能已结束，但本地结果未就绪',
          )
        }
      }
    } catch (error) {
      if (error?.name !== 'AbortError' && !disposed) {
        appendLog(taskId, error?.message || '云端状态同步失败')
      }
    } finally {
      if (serverJobPollControllers.get(taskId) === controller) {
        serverJobPollControllers.delete(taskId)
      }
    }
  }

  async function cancelTask(taskId = runningTaskId.value, { silent = false } = {}) {
    const task = tasks.value.find((item) => item.id === taskId)
    const localUpscaleController = localUpscaleControllers.get(taskId)
    if (localUpscaleController) {
      localUpscaleController.abort()
      return true
    }
    const taskStatus = String(task?.status || '')
      .trim()
      .toLowerCase()
    if (
      task?.serverJobId &&
      ['queued', 'running', 'waiting_provider', 'paused'].includes(taskStatus)
    ) {
      try {
        const response = await cancelServerAiJob(task.serverJobId)
        if (disposed) return false
        const serverStatus = String(response?.job?.status || taskStatus)
          .trim()
          .toLowerCase()
        if (!isConfirmedServerJobCancellation(response)) {
          updateTask(
            taskId,
            {
              status: serverStatus || taskStatus,
              error: String(response?.job?.error || ''),
              finishedAt: isTerminalServerJobStatus(serverStatus) ? Date.now() : task.finishedAt,
              logs: [...(task.logs || []), '服务端未确认取消，继续同步状态'].slice(-12),
            },
            { persistImmediately: true },
          )
          if (!isTerminalServerJobStatus(serverStatus)) startServerJobPolling(taskId)
          void refreshServerAiJobs()
          if (!silent) {
            notify.warning(
              serverStatus === 'paused'
                ? '任务仍处于暂停状态，取消未生效，可再试一次或直接删除'
                : '服务端未确认取消，任务不会显示为已取消',
            )
          }
          return false
        }

        stopServerJobPolling(taskId)
        runningTaskIds.value = runningTaskIds.value.filter((id) => id !== taskId)
        if (runningTaskId.value === taskId) runningTaskId.value = ''
        if (!runningTaskIds.value.length) stopTimer()
        updateTask(
          taskId,
          {
            status: serverStatus === 'canceled' ? 'canceled' : 'cancelled',
            error: String(response?.job?.error || ''),
            finishedAt: Date.now(),
            logs: [...(task.logs || []), '云端任务已取消'].slice(-12),
          },
          { persistImmediately: true },
        )
        if (!silent) notify.success('云端任务已取消')
        void refreshServerAiJobs()
        return true
      } catch (error) {
        if (!disposed && !silent) notify.error(error?.message || '云端任务取消失败')
        return false
      }
    }
    if (task && ['queued', 'running', 'waiting_provider', 'paused'].includes(taskStatus)) {
      pendingCancelTaskIds.add(taskId)
      runningTaskIds.value = runningTaskIds.value.filter((id) => id !== taskId)
      if (runningTaskId.value === taskId) runningTaskId.value = ''
      if (!runningTaskIds.value.length) stopTimer()
      updateTask(taskId, {
        status: 'cancelled',
        finishedAt: Date.now(),
        logs: [...(task.logs || []), '已请求取消任务'].slice(-12),
      })
      if (!silent) notify.success('已请求取消任务')
      return true
    }
    const controller = taskAbortControllers.get(taskId)
    controller?.abort()
    return false
  }

  function refreshServerAiJobs() {
    if (disposed || !authStore.isAuthenticated) return Promise.resolve()
    if (refreshJobsPromise) {
      refreshRequested = true
      return refreshJobsPromise
    }
    const request = refreshServerAiJobsOnce({ append: false }).finally(() => {
      if (refreshJobsPromise === request) refreshJobsPromise = null
      if (refreshRequested && !disposed) {
        refreshRequested = false
        void refreshServerAiJobs()
      }
    })
    refreshJobsPromise = request
    return request
  }

  async function loadMoreServerJobs() {
    if (
      disposed ||
      !authStore.isAuthenticated ||
      serverJobsLoadingMore.value ||
      !serverJobsHasMore.value ||
      !serverJobsNextCursor.value
    ) {
      return
    }
    serverJobsLoadingMore.value = true
    try {
      await refreshServerAiJobsOnce({ append: true })
    } finally {
      serverJobsLoadingMore.value = false
    }
  }

  async function refreshServerAiJobsOnce({ append = false } = {}) {
    try {
      const response = await listServerAiJobs(12, {
        cursor: append ? serverJobsNextCursor.value : '',
      })
      if (disposed) return
      serverJobsNextCursor.value = String(response?.pagination?.nextCursor || '')
      serverJobsHasMore.value = response?.pagination?.hasMore === true
      const remoteJobs = (Array.isArray(response.jobs) ? response.jobs : []).filter((job) =>
        isWallpaperJobKind(job?.kind),
      )
      const localByServerId = new Map(
        tasks.value.filter((task) => task.serverJobId).map((task) => [task.serverJobId, task]),
      )
      const mergedByServerId = new Map()
      remoteJobs.forEach((job) => {
        const existing = localByServerId.get(job.id)
        const mapped = mapServerJobToTask(job, {
          resolveModelLabel: resolveJobDisplayModel,
          existingTask: existing,
        })
        mergedByServerId.set(
          job.id,
          existing && shouldKeepExistingTaskSnapshot(existing.status, mapped.status)
            ? existing
            : mapped,
        )
      })
      const orphanLocalTasks = tasks.value.filter((task) => {
        if (looksLikeIllustrationColoringTask(task)) return false
        if (task.kind && !isWallpaperJobKind(task.kind)) return false
        // 已按 serverJobId 合并进远程列表的本地任务不能再当孤儿追加，否则会出现同任务双卡片
        if (task.serverJobId && mergedByServerId.has(task.serverJobId)) return false
        if (!task.serverJobId) return true
        const remote = (Array.isArray(response.jobs) ? response.jobs : []).find(
          (job) => job.id === task.serverJobId,
        )
        if (remote && !isWallpaperJobKind(remote.kind)) return false
        return true
      })
      const seenIds = new Set()
      const mergedTasks = [...mergedByServerId.values(), ...orphanLocalTasks]
        .filter((task) => !looksLikeIllustrationColoringTask(task))
        .filter((task) => {
          const key = String(task.serverJobId || task.id || '')
          if (!key || seenIds.has(key)) return false
          seenIds.add(key)
          return true
        })
        .sort(
          (left, right) =>
            Date.parse(String(right.createdAt || '')) - Date.parse(String(left.createdAt || '')),
        )
        .slice(0, 120)
      const hydrationBaseVersion = taskMutationVersion
      const hydratedTasks = await Promise.all(
        mergedTasks.map(async (task) => {
          const job = task.serverJobId
            ? remoteJobs.find((item) => item.id === task.serverJobId)
            : null
          if (!job) return task
          return hydrateServerJobTaskOutputs(task, job)
        }),
      )
      if (disposed) return
      if (taskMutationVersion !== hydrationBaseVersion) {
        refreshRequested = true
        return
      }
      tasks.value = hydratedTasks
      taskMutationVersion += 1
      if (activeTaskId.value && !tasks.value.some((task) => task.id === activeTaskId.value)) {
        activeTaskId.value = tasks.value[0]?.id || ''
      }
      persistTasks({ immediate: true })
      restoreRunningTaskUi()
      resumeServerJobPolling()
    } catch {
      /* 云端任务列表失败不影响本地创作 */
    }
  }

  async function ensureUploadUrlForTask(task) {
    if (task.sourceMode !== 'upload') return task.sourceRemoteUrl || sourceRemoteUrl.value
    if (task.sourceRemoteUrl) return task.sourceRemoteUrl
    if (task.sourceFile) {
      const url = await uploadAiInputFile(task.sourceFile)
      updateTask(task.id, { sourceRemoteUrl: url })
      return url
    }
    return _ensureUploadUrl()
  }

  async function ensureInputUrlsForTask(task) {
    const mainUrl = await ensureUploadUrlForTask(task)
    const referenceFiles = Array.isArray(task.styleReferenceFiles) ? task.styleReferenceFiles : []
    const referenceUrls = []
    for (const file of referenceFiles) {
      if (file) referenceUrls.push(await uploadAiInputFile(file))
    }
    const storedReferenceUrls = Array.isArray(task.styleReferenceUrls)
      ? task.styleReferenceUrls.filter(Boolean)
      : []
    for (const url of storedReferenceUrls) {
      const blob = await fetchAuthenticatedMediaBlob(url, { cache: 'no-store' })
      const extension = /png/i.test(blob.type) ? 'png' : /webp/i.test(blob.type) ? 'webp' : 'jpg'
      referenceUrls.push(
        await uploadAiInputFile(
          new File([blob], `reference-${crypto.randomUUID()}.${extension}`, {
            type: blob.type || 'image/jpeg',
          }),
        ),
      )
    }
    return Array.from(new Set([mainUrl, ...referenceUrls].filter(Boolean))).slice(0, 4)
  }

  async function removeTask(taskId, { silent = false, requireCloudDelete = false } = {}) {
    const task = tasks.value.find((item) => item.id === taskId)
    if (!task) return false
    const awaitingServerJob =
      !task.serverJobId && ['queued', 'running', 'waiting_provider', 'paused'].includes(task.status)
    if (awaitingServerJob) {
      pendingCancelTaskIds.add(taskId)
      pendingRemoveTaskIds.add(taskId)
    }
    if (task.serverJobId) {
      try {
        if (['queued', 'running', 'waiting_provider', 'paused'].includes(task.status)) {
          const cancelResponse = await cancelServerAiJob(task.serverJobId)
          if (!isConfirmedServerJobCancellation(cancelResponse)) {
            // 终态任务仍允许本地删除；进行中未确认取消则阻断。
            if (!isTerminalServerJobStatus(task.status)) {
              notify.warning('服务端未确认取消，任务暂不能删除')
              return false
            }
          }
        }
        const deleteResponse = await deleteServerAiJob(task.serverJobId)
        if (deleteResponse?.deleted === false) {
          throw new Error('云端任务未删除，请刷新后重试')
        }
      } catch (error) {
        // 已结束的任务：云端删除失败时仍清掉本地，避免页面卡死。
        if (!isTerminalServerJobStatus(task.status) || requireCloudDelete) {
          if (!silent) notify.error(error?.message || '云端任务删除失败')
          return false
        }
        if (!silent) notify.warning(error?.message || '云端删除未完成，已从本地历史移除')
      }
    }
    stopServerJobPolling(taskId)
    localUpscaleControllers.get(taskId)?.abort()
    localUpscaleControllers.delete(taskId)
    localUpscalePromises.delete(taskId)
    taskAbortControllers.get(taskId)?.abort()
    taskAbortControllers.delete(taskId)
    if (!awaitingServerJob) pendingCancelTaskIds.delete(taskId)
    pendingRemoveTaskIds.delete(taskId)
    runningTaskIds.value = runningTaskIds.value.filter((id) => id !== taskId)
    if (runningTaskId.value === taskId) runningTaskId.value = ''
    if (!runningTaskIds.value.length) stopTimer()
    tasks.value = tasks.value.filter((item) => item.id !== taskId)
    taskMutationVersion += 1
    if (activeTaskId.value === taskId) activeTaskId.value = tasks.value[0]?.id || ''
    resetCanvasView({ keepFit: true })
    persistTasks({ immediate: true })
    if (!silent) notify.success('任务已删除')
    return true
  }

  async function clearFailedAndPausedTasks() {
    const clearableTaskIds = tasks.value
      .filter((task) => ['failed', 'paused'].includes(String(task?.status || '').toLowerCase()))
      .map((task) => task.id)
      .filter(Boolean)
    if (!clearableTaskIds.length) return { total: 0, removed: 0, failed: 0 }

    let cursor = 0
    let removed = 0
    const worker = async () => {
      while (cursor < clearableTaskIds.length) {
        const taskId = clearableTaskIds[cursor]
        cursor += 1
        if (await removeTask(taskId, { silent: true, requireCloudDelete: true })) removed += 1
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, clearableTaskIds.length) }, () => worker()))
    const failed = clearableTaskIds.length - removed
    if (removed > 0) notify.success(`已清除 ${removed} 个失败/暂停任务`)
    if (failed > 0) notify.warning(`${failed} 个失败/暂停任务未能清除，请稍后重试`)
    return { total: clearableTaskIds.length, removed, failed }
  }

  function viewTask(task) {
    if (!task) return
    activeTaskId.value = task.id
    selectedOutputIndex.value = 0
    canvasMode.value = task.outputs?.length ? 'result' : 'source'
    resetCanvasView({ keepFit: true })
    if (task.serverJobId && !isTerminalServerJobStatus(task.status)) startServerJobPolling(task.id)
  }

  function downloadOutput(url, index = 1, taskOverride = null) {
    const task = taskOverride || activeTask.value
    const targetUrl = String(url || '').trim()
    if (!targetUrl) return
    if (task && activeTaskId.value !== task.id) {
      activeTaskId.value = task.id
    }
    ;(async () => {
      try {
        if (task?.type !== 'video') {
          await downloadAuthenticatedMedia(
            targetUrl,
            `ai-wallpaper-${task?.id || Date.now()}-${index}`,
          )
          notify.success('已开始下载')
          return
        }
        const response = await fetch(targetUrl, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`下载失败（${response.status}）`)
        const blob = await response.blob()
        if (!blob.size) throw new Error('下载内容为空')
        const objectUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = objectUrl
        const ext =
          task?.type === 'video'
            ? '.mp4'
            : String(blob.type || '').includes('jpeg')
              ? '.jpg'
              : '.png'
        link.download = `ai-wallpaper-${task?.id || Date.now()}-${index}${ext}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
        notify.success('已开始下载')
      } catch (error) {
        notify.error(error?.message || '下载失败')
      }
    })()
  }

  function reuseTask(task, { silent = false } = {}) {
    if (!task) return
    outputType.value = task.type === 'video' ? 'video' : 'image'
    inputMode.value = 'text'
    const rawPrompt = String(task.userPrompt || task.prompt || '').trim()
    if (rawPrompt) prompt.value = rawPrompt
    if (typeof task.promptPolishEnabled === 'boolean') {
      promptPolishEnabled.value = task.promptPolishEnabled
    }
    if (typeof task.autoTranslateEnabled === 'boolean') {
      autoTranslateEnabled.value = task.autoTranslateEnabled
    }
    if (typeof task.transparentPngEnabled === 'boolean') {
      transparentPngEnabled.value = task.transparentPngEnabled
    }
    if (['auto', 'png', 'webp', 'jpeg', 'jpg'].includes(String(task.upscaleOutputFormat || ''))) {
      upscaleOutputFormat.value = task.upscaleOutputFormat
    }
    aspectRatio.value = task.aspectRatio || aspectRatio.value
    if (task.resolutionScale) resolutionScale.value = task.resolutionScale
    if (task.quality) imageQuality.value = task.quality
    // 故意不回填「张数」：老任务可能带着 count=2/4，会悄悄覆盖用户当前选择，
    // 导致"选了 1 张却生成 2 张"。生成数量永远以当前选择器为准。
    const modelKey = String(task.publicModelKey || task.gatewayModelId || '').trim()
    if (modelKey && publicModelOptions.value.some((item) => item.id === modelKey)) {
      selectedPublicModel.value = modelKey
    }
    inspectorTab.value = 'params'
    if (!silent) notify.success('已填回提示词')
  }

  function setOutputView(index) {
    selectedOutputIndex.value = index
    canvasMode.value = 'result'
    resetCanvasView({ keepFit: true })
  }

  function resolveJobDisplayModel(job) {
    const recordedModel = String(job?.model || '').trim()
    const recordedOption = publicModelOptions.value.find((item) => item.id === recordedModel)
    if (recordedOption) return recordedOption.label
    if (recordedModel) return recordedModel
    const gatewayModelId = String(job?.gatewayModelId || '').trim()
    const model = publicModelOptions.value.find((item) => item.id === gatewayModelId)
    if (model) return model.label
    if (gatewayModelId && !gatewayModelId.includes(':')) return gatewayModelId
    return ''
  }

  function clearTaskTimers() {
    disposed = true
    stopTimer()
    stopAllServerJobPolling()
    taskAbortControllers.forEach((controller) => controller.abort())
    taskAbortControllers.clear()
    localUpscaleControllers.forEach((controller) => controller.abort())
    localUpscaleControllers.clear()
    localUpscalePromises.clear()
    serverJobPollsInFlight.clear()
    completedResultMisses.clear()
    if (persistTasksTimer && typeof window !== 'undefined') window.clearTimeout(persistTasksTimer)
    persistTasksTimer = null
  }

  return {
    tasks,
    activeTaskId,
    runningTaskId,
    runningTaskIds,
    elapsedSeconds,
    activeTask,
    isRunning,
    activeOutputs,
    latestOutput,
    elapsedLabel,
    statusHeroText,
    formatDuration,
    formatTaskElapsed,
    taskKindLabel,
    sourceModeLabel,
    taskStatusLabel,
    persistTasks,
    loadTasks,
    restoreRunningTaskUi,
    updateTask,
    appendLog,
    isTerminalServerJobStatus,
    stopServerJobPolling,
    stopAllServerJobPolling,
    resumeServerJobPolling,
    startTimer,
    stopTimer,
    createTaskRecord,
    createTask,
    createMaskedEditTask,
    createUpscaleTask,
    runServerTask,
    startServerJobPolling,
    pollServerTask,
    cancelTask,
    refreshServerAiJobs,
    loadMoreServerJobs,
    serverJobsHasMore,
    serverJobsLoadingMore,
    ensureUploadUrlForTask,
    ensureInputUrlsForTask,
    removeTask,
    clearFailedAndPausedTasks,
    viewTask,
    downloadOutput,
    reuseTask,
    setOutputView,
    resolveJobDisplayModel,
    clearTaskTimers,
  }
}
