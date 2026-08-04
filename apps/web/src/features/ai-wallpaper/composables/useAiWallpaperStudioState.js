import { createStudioBudgetGuard } from '@/features/ai-shared/studioBudgetGuard'
import { enrichStudioCreditCostSnapshot } from '@/features/ai-shared/studioUsage'
import { isWallpaperStudioJobKind } from '@/features/ai-shared/aiJobKinds'
import { useInsufficientCreditsPrompt } from '@/composables/useInsufficientCreditsPrompt'
import { useStudioLayout } from '@/features/ai-wallpaper/composables/useStudioLayout'
import { useWallpaperCanvas } from '@/features/ai-wallpaper/composables/useWallpaperCanvas'
import { useWallpaperInputs } from '@/features/ai-wallpaper/composables/useWallpaperInputs'
import { useWallpaperModels } from '@/features/ai-wallpaper/composables/useWallpaperModels'
import { useWallpaperTasks } from '@/features/ai-wallpaper/composables/useWallpaperTasks'
import { WALLPAPER_INSPECTOR_TABS } from '@/features/ai-wallpaper/composables/wallpaperStudioConstants'
import { takePendingPrompt } from '@/features/creator-hub/studioTools'
import { getDisplayImageUrl } from '@/services/aiWallpaper'
import { resolveAiFeatureRuntimeConfig } from '@/config/aiFeatureSettings'
import notificationService from '@/services/notification'
import { getFeatureUnitPriceCents } from '@/services/pricing'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { AI_WALLPAPER_STUDIO_DRAFT_KEY } from '@/services/aiWallpaperState'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const FILMSTRIP_HISTORY_TASK_LIMIT = 120
const FILMSTRIP_HISTORY_MAX_PREFETCH_PAGES = 9

/**
 * 壁纸工坊薄编排层：组装 canvas / inputs / models / tasks，保留对外 API。
 */
export function useAiWallpaperStudioState() {
  const settingsStore = useSettingsStore()
  const runtimeConfigStore = useRuntimeConfigStore()
  // Wallhaven 收藏/历史/关注作者来源已下线；inputs 组合式函数对空 store 优雅降级。
  const favoritesStore = null
  const historyStore = null
  const authStore = useAuthStore()
  const userStore = null
  const { isMobile } = useStudioLayout()

  const autoSaveConfig = ref(true)
  const executionMode = ref('server')
  const outputType = ref('image')
  const privacyMode = ref(settingsStore.getSetting('ai_enable_privacy_mode', true))
  const inspectorTab = ref('params')
  const inspectorTabs = WALLPAPER_INSPECTOR_TABS
  const mobileInspectorOpen = ref(false)
  const leftCollapsed = ref(false)
  const rightCollapsed = ref(false)
  const costConfirmVisible = ref(false)
  const costConfirmPayload = ref(null)
  const generationUnitPriceCents = ref(null)
  const isPageLoading = ref(true)

  let persistDraftTimer = null
  let previousBodyOverflow = ''
  let siteWallpapersBridge = null

  const previewBridge = {
    sourcePreview: null,
    latestOutput: null,
  }

  const models = useWallpaperModels({
    settingsStore,
    runtimeConfigStore,
    outputType,
    privacyMode,
  })

  const canvas = useWallpaperCanvas({
    sourcePreview: computed(() => previewBridge.sourcePreview?.value || ''),
    latestOutput: computed(() => previewBridge.latestOutput?.value || ''),
    fallbackPreview: () => {
      const list = siteWallpapersBridge?.value
      return list?.[0] ? getDisplayImageUrl(list[0]) : ''
    },
  })

  const inputs = useWallpaperInputs({
    favoritesStore,
    historyStore,
    userStore,
    selectedSkills: models.selectedSkills,
    customSkills: models.customSkills,
    selectedMcpServers: models.selectedMcpServers,
    selectedOutputIndex: canvas.selectedOutputIndex,
    canvasMode: canvas.canvasMode,
    resetCanvasView: canvas.resetCanvasView,
    persistStudioDraft: (...args) => persistStudioDraft(...args),
    outputType,
    privacyMode,
    maxReferenceImages: computed(() => models.currentPublicModel.value?.maxReferenceImages ?? 4),
  })

  previewBridge.sourcePreview = inputs.sourcePreview
  siteWallpapersBridge = inputs.siteWallpapers

  const studioBudgetGuard = createStudioBudgetGuard({
    settingsStore,
    getRuntimeModelCatalog: () => models.runtimeModelCatalog.value,
    getProvider: () => models.studioProvider.value || 'gptsapi',
    getPublicModels: () => models.publicModelOptions.value,
    getFeatureConfig: () => models.aiOptimizeRuntimeConfig.value || {},
    featureKey: 'wallpaper',
  })
  const creditsPrompt = useInsufficientCreditsPrompt()

  const canUseServerAi = computed(() => Boolean(authStore.isAuthenticated))
  const canCreateTask = computed(() => {
    if (!models.canUseAiWallpaper.value) return false
    if (outputType.value === 'image' && !models.imageDispatchModel.value) return false
    if (outputType.value === 'video' && !models.videoDispatchModel.value) return false
    return canUseServerAi.value && !!inputs.prompt.value.trim()
  })
  const backgroundRemovalModels = computed(() => {
    const models = runtimeConfigStore.getFeaturePayload('ai.imageTools')?.backgroundRemovalModels
    return Array.isArray(models) ? models.filter((model) => model?.id) : []
  })
  const backgroundRemovalModel = computed(
    () =>
      backgroundRemovalModels.value.find((model) => model.default === true) ||
      backgroundRemovalModels.value[0] ||
      null,
  )
  const autoBackgroundRemovalEnabled = ref(false)
  const backgroundRemovalUnitPrice = computed(() =>
    Math.max(0, Number(backgroundRemovalModel.value?.pricePoints || 0)),
  )

  function includeAutomaticBackgroundRemovalCost(snapshot, count) {
    const units = Math.max(1, Number(count || 1))
    if (
      outputType.value !== 'image' ||
      autoBackgroundRemovalEnabled.value !== true ||
      !backgroundRemovalModel.value?.id
    ) {
      return snapshot
    }
    const backgroundTotal = backgroundRemovalUnitPrice.value * units
    return {
      ...snapshot,
      unitCost: Math.max(0, Number(snapshot?.unitCost || 0)) + backgroundTotal,
      unitCostPerUnit:
        Math.max(0, Number(snapshot?.unitCostPerUnit || 0)) + backgroundRemovalUnitPrice.value,
      featureLabel: '文生图（含自动背景移除）',
    }
  }

  async function ensureWallpaperBudgetAvailable(model, count = 1, options = {}) {
    const snapshot = studioBudgetGuard.getCostSnapshot(model, count)
    if (snapshot.billingMode === 'credits' && snapshot.unitCost > 0) {
      const available = Number(options.creditAvailable)
      await creditsPrompt.ensureCreditsAvailable(snapshot.unitCost, {
        ...(Number.isFinite(available) ? { available } : {}),
      })
      studioBudgetGuard.ensureBudgetAvailable(model, count, {
        creditAvailable: Number.isFinite(available) ? available : undefined,
      })
      return snapshot
    }
    studioBudgetGuard.ensureBudgetAvailable(model, count)
    return snapshot
  }

  const tasks = useWallpaperTasks({
    authStore,
    settingsStore,
    runtimeModelCatalog: models.runtimeModelCatalog,
    outputType,
    inputMode: inputs.inputMode,
    prompt: inputs.prompt,
    promptPolishEnabled: inputs.promptPolishEnabled,
    autoTranslateEnabled: inputs.autoTranslateEnabled,
    transparentPngEnabled: inputs.transparentPngEnabled,
    autoBackgroundRemovalEnabled,
    backgroundRemovalModel,
    sourcePreview: inputs.sourcePreview,
    sourceRemoteUrl: inputs.sourceRemoteUrl,
    selectedFile: inputs.selectedFile,
    pastedFiles: inputs.pastedFiles,
    styleReferencePreviews: inputs.styleReferencePreviews,
    referenceImages: inputs.referenceImages,
    sourceLabel: inputs.sourceLabel,
    composePrompt: inputs.composePrompt,
    aspectRatio: inputs.aspectRatio,
    imageCount: inputs.imageCount,
    imageQuality: inputs.imageQuality,
    resolutionScale: inputs.resolutionScale,
    upscaleOutputFormat: inputs.upscaleOutputFormat,
    moderationLevel: inputs.moderationLevel,
    duration: inputs.duration,
    creativity: inputs.creativity,
    styleStrength: inputs.styleStrength,
    detailBoost: inputs.detailBoost,
    privacyMode,
    videoMotion: inputs.videoMotion,
    selectedSkills: models.selectedSkills,
    customSkills: models.customSkills,
    selectedMcpServers: models.selectedMcpServers,
    selectedSkillIds: models.selectedSkillIds,
    selectedMcpIds: models.selectedMcpIds,
    imageDispatchModel: models.imageDispatchModel,
    videoDispatchModel: models.videoDispatchModel,
    selectedPublicModel: models.selectedPublicModel,
    publicModelOptions: models.publicModelOptions,
    superResolutionFeatureEnabled: models.superResolutionFeatureEnabled,
    studioProvider: models.studioProvider,
    studioBudgetGuard,
    ensureWallpaperBudgetAvailable,
    onCreditError: creditsPrompt.handleCreditError,
    ensureUploadUrl: inputs.ensureUploadUrl,
    canCreateTask,
    autoSaveConfig,
    saveStudioConfig: models.saveStudioConfig,
    persistCapabilityKit: models.persistCapabilityKit,
    selectedOutputIndex: canvas.selectedOutputIndex,
    canvasMode: canvas.canvasMode,
    resetCanvasView: canvas.resetCanvasView,
    inspectorTab,
  })

  previewBridge.latestOutput = tasks.latestOutput

  const comparisonSourceImage = computed(
    () => tasks.activeTask.value?.sourcePreview || inputs.sourcePreview.value || '',
  )
  const activeStyleReferences = computed(
    () =>
      tasks.activeTask.value?.styleReferencePreviews ||
      inputs.styleReferencePreviews.value.slice(1),
  )
  const createHint = computed(() => {
    if (!models.canUseAiWallpaper.value) return '当前账号未开通文生图'
    if (!authStore.isAuthenticated) return '登录后可提交云端任务'
    if (!inputs.prompt.value.trim()) return '先写一句提示词'
    if (outputType.value === 'image' && !models.imageDispatchModel.value) return '请选择图片模型'
    if (outputType.value === 'video' && !models.videoDispatchModel.value) return '请选择视频模型'
    return '可生成图片'
  })
  const tuningSummary = computed(() => {
    const parts = [
      `创意 ${inputs.creativity.value}`,
      `风格 ${inputs.styleStrength.value}`,
      inputs.detailBoost.value ? '细节增强' : '',
      privacyMode.value ? '隐私' : '',
      models.selectedSkills.value.length ? `Skill ${models.selectedSkills.value.length}` : '',
      models.selectedMcpServers.value.length ? `MCP ${models.selectedMcpServers.value.length}` : '',
    ].filter(Boolean)
    return parts.join(' · ')
  })
  const ambientBackgroundImage = computed(() => {
    const image =
      (inputs.inputMode.value === 'site' && inputs.selectedWallpaper.value
        ? getDisplayImageUrl(inputs.selectedWallpaper.value)
        : '') ||
      (inputs.siteWallpapers.value[0] ? getDisplayImageUrl(inputs.siteWallpapers.value[0]) : '')
    return image
  })
  const pageBackgroundStyle = computed(() =>
    ambientBackgroundImage.value
      ? { '--ai-ambient-image': `url("${ambientBackgroundImage.value}")` }
      : {},
  )
  const generationCostLabel = computed(() => {
    const count = outputType.value === 'image' ? Math.max(1, Number(inputs.imageCount.value)) : 1
    const selectedUnitPrice = Number(models.currentPublicModel.value?.creditCost)
    if (
      outputType.value === 'image' &&
      models.currentPublicModel.value &&
      Number.isFinite(selectedUnitPrice) &&
      selectedUnitPrice >= 0
    ) {
      const total =
        selectedUnitPrice * count +
        (autoBackgroundRemovalEnabled.value ? backgroundRemovalUnitPrice.value * count : 0)
      if (total === 0) return '免费'
      return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(total)} 积分`
    }
    if (generationUnitPriceCents.value != null) {
      const total =
        Math.max(0, Number(generationUnitPriceCents.value)) * count +
        (autoBackgroundRemovalEnabled.value ? backgroundRemovalUnitPrice.value * count : 0)
      if (total === 0) return '免费'
      return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(total)} 积分`
    }
    const dispatchModel =
      outputType.value === 'video'
        ? models.videoDispatchModel.value
        : models.imageDispatchModel.value
    if (!dispatchModel) return ''
    const snapshot = includeAutomaticBackgroundRemovalCost(
      studioBudgetGuard.getCostSnapshot(dispatchModel, count),
      count,
    )
    const total = Math.max(0, Number(snapshot?.unitCost || 0))
    if (!total) return ''
    if (snapshot?.billingMode === 'credits') {
      return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(total)} 积分`
    }
    return `$${total.toFixed(4)}`
  })

  const localMaskEditCostLabel = computed(() => {
    const dispatchModel = String(models.imageDispatchModel.value || '').trim()
    if (!dispatchModel) return ''
    const snapshot = studioBudgetGuard.getCostSnapshot(dispatchModel, 1)
    const amount = Math.max(0, Number(snapshot?.unitCost || 0))
    if (snapshot?.billingMode === 'credits') {
      if (amount === 0) return '免费'
      return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(amount)} 积分`
    }
    return amount > 0 ? `$${amount.toFixed(4)}` : '按实际用量结算'
  })

  async function getLocalMaskEditCostSnapshot() {
    const dispatchModel = String(models.imageDispatchModel.value || '').trim()
    if (!dispatchModel) throw new Error('请先选择支持局部编辑的图片模型')
    void runtimeConfigStore.refreshRuntimeConfigInBackground()
    const costSnapshot = await enrichStudioCreditCostSnapshot({
      ...studioBudgetGuard.getCostSnapshot(dispatchModel, 1),
      featureLabel: '图片局部编辑',
    })
    try {
      if (costSnapshot.billingMode === 'credits') {
        const required = Math.max(
          0,
          Number(costSnapshot.totalPriceCents ?? costSnapshot.unitCost ?? 0),
        )
        await creditsPrompt.ensureCreditsAvailable(required, {
          available: costSnapshot.creditAvailable,
        })
      } else {
        await ensureWallpaperBudgetAvailable(dispatchModel, 1, {
          creditAvailable: costSnapshot.creditAvailable,
        })
      }
    } catch (error) {
      if (creditsPrompt.handleCreditError(error)) return null
      throw error
    }
    return costSnapshot
  }

  async function loadGenerationUnitPrice() {
    const unitPriceCents = await getFeatureUnitPriceCents('wallpaper')
    if (unitPriceCents != null) generationUnitPriceCents.value = unitPriceCents
  }

  const pendingCreateOptions = ref(null)

  async function dispatchCreateOrRegenerate(createOptions = {}) {
    const regenerateTaskId = String(createOptions.regenerateTaskId || '').trim()
    if (regenerateTaskId) {
      await tasks.regenerateTaskInPlace(regenerateTaskId, {
        skipClientBudgetCheck: createOptions.skipClientBudgetCheck === true,
      })
      return
    }
    await tasks.createTask(createOptions)
  }

  async function requestCreateTask(options = {}) {
    if (!canCreateTask.value) return
    void runtimeConfigStore.refreshRuntimeConfigInBackground()
    const dispatchModel =
      outputType.value === 'video'
        ? models.videoDispatchModel.value
        : models.imageDispatchModel.value
    const regenerateTaskId = String(options.regenerateTaskId || '').trim()
    const count =
      outputType.value === 'image'
        ? Math.min(
            4,
            Math.max(
              1,
              Number(regenerateTaskId ? 1 : (options.count ?? inputs.imageCount.value)) || 1,
            ),
          )
        : 1
    const createOptions = {
      ...options,
      regenerateTaskId,
      count: outputType.value === 'image' ? count : 1,
      skipClientBudgetCheck: true,
      autoBackgroundRemovalEnabled:
        outputType.value === 'image' &&
        autoBackgroundRemovalEnabled.value === true &&
        Boolean(backgroundRemovalModel.value?.id),
      autoBackgroundRemovalModelKey:
        outputType.value === 'image' && autoBackgroundRemovalEnabled.value === true
          ? String(backgroundRemovalModel.value?.id || '').trim()
          : '',
    }
    if (authStore.user?.requireCostConfirm === false) {
      if (createOptions.autoBackgroundRemovalEnabled) {
        const uncheckedSnapshot = await enrichStudioCreditCostSnapshot(
          includeAutomaticBackgroundRemovalCost(
            studioBudgetGuard.getCostSnapshot(dispatchModel, count),
            count,
          ),
        )
        try {
          await creditsPrompt.ensureCreditsAvailable(uncheckedSnapshot.unitCost, {
            available: uncheckedSnapshot.creditAvailable,
          })
        } catch (error) {
          if (creditsPrompt.handleCreditError(error)) return
          notificationService.error(error?.message || '预算不足')
          return
        }
      }
      pendingCreateOptions.value = null
      await dispatchCreateOrRegenerate(createOptions)
      return
    }

    const costSnapshot = await enrichStudioCreditCostSnapshot(
      includeAutomaticBackgroundRemovalCost(
        studioBudgetGuard.getCostSnapshot(dispatchModel, count),
        count,
      ),
    )
    try {
      if (costSnapshot.billingMode === 'credits') {
        await creditsPrompt.ensureCreditsAvailable(costSnapshot.unitCost, {
          available: costSnapshot.creditAvailable,
        })
      } else {
        await ensureWallpaperBudgetAvailable(dispatchModel, count, {
          creditAvailable: costSnapshot.creditAvailable,
        })
      }
    } catch (error) {
      if (creditsPrompt.handleCreditError(error)) return
      notificationService.error(error?.message || '预算不足')
      return
    }
    pendingCreateOptions.value = createOptions
    costConfirmPayload.value = costSnapshot
    costConfirmVisible.value = true
  }

  function confirmCostAndCreate() {
    if (!costConfirmVisible.value) return
    const createOptions = pendingCreateOptions.value || { skipClientBudgetCheck: true }
    pendingCreateOptions.value = null
    costConfirmVisible.value = false
    costConfirmPayload.value = null
    void dispatchCreateOrRegenerate(createOptions)
  }

  function cancelCostConfirm() {
    costConfirmVisible.value = false
    costConfirmPayload.value = null
    pendingCreateOptions.value = null
  }

  function readPersistableSourcePreview() {
    const preview = String(inputs.sourcePreview.value || '').trim()
    if (!preview || preview.startsWith('blob:')) return ''
    return preview
  }

  function persistStudioDraft({ immediate = false } = {}) {
    if (persistDraftTimer) {
      window.clearTimeout(persistDraftTimer)
      persistDraftTimer = null
    }
    const write = () => {
      const draft = {
        inputMode: inputs.inputMode.value,
        outputType: outputType.value,
        prompt: inputs.prompt.value,
        promptPolishEnabled: inputs.promptPolishEnabled.value,
        autoTranslateEnabled: inputs.autoTranslateEnabled.value,
        transparentPngEnabled: inputs.transparentPngEnabled.value,
        autoBackgroundRemovalEnabled: autoBackgroundRemovalEnabled.value,
        negativePrompt: inputs.negativePrompt.value,
        aspectRatio: inputs.aspectRatio.value,
        imageCount: inputs.imageCount.value,
        imageQuality: inputs.imageQuality.value,
        resolutionScale: inputs.resolutionScale.value,
        upscaleOutputFormat: inputs.upscaleOutputFormat.value,
        moderationLevel: inputs.moderationLevel.value,
        duration: inputs.duration.value,
        creativity: inputs.creativity.value,
        styleStrength: inputs.styleStrength.value,
        detailBoost: inputs.detailBoost.value,
        privacyMode: privacyMode.value,
        videoMotion: inputs.videoMotion.value,
        selectedPublicModel: models.selectedPublicModel.value,
        activeTaskId: tasks.activeTaskId.value,
        uploadRemoteUrl: inputs.uploadRemoteUrl.value,
        sourceRemoteUrl: inputs.sourceRemoteUrl.value,
        sourcePreview: readPersistableSourcePreview(),
        updatedAt: new Date().toISOString(),
      }
      setScopedLocalItem(AI_WALLPAPER_STUDIO_DRAFT_KEY, JSON.stringify(draft))
      persistDraftTimer = null
    }
    if (immediate) {
      write()
      return
    }
    persistDraftTimer = window.setTimeout(write, 240)
  }

  function restoreStudioDraft() {
    try {
      const draft = JSON.parse(getScopedLocalItem(AI_WALLPAPER_STUDIO_DRAFT_KEY) || 'null')
      if (!draft || typeof draft !== 'object') return
      if (draft.inputMode) inputs.inputMode.value = draft.inputMode
      if (draft.outputType) outputType.value = draft.outputType
      if (typeof draft.prompt === 'string') inputs.prompt.value = draft.prompt
      if (typeof draft.promptPolishEnabled === 'boolean') {
        inputs.promptPolishEnabled.value = draft.promptPolishEnabled
      }
      if (typeof draft.autoTranslateEnabled === 'boolean') {
        inputs.autoTranslateEnabled.value = draft.autoTranslateEnabled
      }
      if (typeof draft.transparentPngEnabled === 'boolean') {
        inputs.transparentPngEnabled.value = draft.transparentPngEnabled
      }
      if (typeof draft.autoBackgroundRemovalEnabled === 'boolean') {
        autoBackgroundRemovalEnabled.value = draft.autoBackgroundRemovalEnabled
      }
      if (typeof draft.negativePrompt === 'string')
        inputs.negativePrompt.value = draft.negativePrompt
      if (draft.aspectRatio) inputs.aspectRatio.value = draft.aspectRatio
      if (Number(draft.imageCount) > 0) inputs.imageCount.value = Number(draft.imageCount)
      if (draft.imageQuality) inputs.imageQuality.value = draft.imageQuality
      if (draft.resolutionScale) inputs.resolutionScale.value = draft.resolutionScale
      if (
        ['auto', 'png', 'webp', 'jpeg', 'jpg'].includes(String(draft.upscaleOutputFormat || ''))
      ) {
        inputs.upscaleOutputFormat.value = draft.upscaleOutputFormat
      }
      if (draft.moderationLevel) inputs.moderationLevel.value = draft.moderationLevel
      if (Number(draft.duration) > 0) inputs.duration.value = Number(draft.duration)
      if (Number.isFinite(Number(draft.creativity)))
        inputs.creativity.value = Number(draft.creativity)
      if (Number.isFinite(Number(draft.styleStrength))) {
        inputs.styleStrength.value = Number(draft.styleStrength)
      }
      if (typeof draft.detailBoost === 'boolean') inputs.detailBoost.value = draft.detailBoost
      if (typeof draft.privacyMode === 'boolean') privacyMode.value = draft.privacyMode
      if (Number.isFinite(Number(draft.videoMotion))) {
        inputs.videoMotion.value = Number(draft.videoMotion)
      }
      if (draft.selectedPublicModel) models.selectedPublicModel.value = draft.selectedPublicModel
      if (draft.uploadRemoteUrl) inputs.uploadRemoteUrl.value = draft.uploadRemoteUrl
      const remote = String(draft.sourceRemoteUrl || draft.sourcePreview || '').trim()
      if (remote && !remote.startsWith('blob:')) {
        inputs.uploadRemoteUrl.value = remote
      }
    } catch {
      // ignore corrupt draft
    }
  }

  function setBodyScrollLocked(locked) {
    if (locked) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return
    }
    document.body.style.overflow = previousBodyOverflow
    previousBodyOverflow = ''
  }

  function setOutputView(index) {
    canvas.setOutputView(index)
  }

  function useOutputAsUpload(url) {
    inputs.useOutputAsUpload(url)
  }

  function hasTaskBeforeLocalToday() {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    return tasks.tasks.value.some((task) => {
      const created = Date.parse(String(task?.createdAt || task?.created_at || ''))
      return Number.isFinite(created) && created > 0 && created < startMs
    })
  }

  async function preloadFilmstripHistory() {
    let loadedPages = 0
    // 舞台/底部栏只展示当天，预取碰到更早任务即可停止
    while (
      tasks.serverJobsHasMore.value &&
      tasks.tasks.value.length < FILMSTRIP_HISTORY_TASK_LIMIT &&
      loadedPages < FILMSTRIP_HISTORY_MAX_PREFETCH_PAGES &&
      !hasTaskBeforeLocalToday()
    ) {
      const loaded = await tasks.loadMoreServerJobs()
      if (!loaded) break
      loadedPages += 1
    }
  }

  async function initPage() {
    isPageLoading.value = true
    // —— 本地数据同步恢复：草稿、能力包在首帧前就位；
    // 历史任务仅登录用户可恢复，游客不允许保留历史记录 ——
    models.loadCapabilityKit()
    restoreStudioDraft()
    const pendingPrompt = takePendingPrompt('t2i')
    if (pendingPrompt?.prompt) {
      inputs.prompt.value = pendingPrompt.prompt
    }
    inputs.inputMode.value = 'text'
    outputType.value = 'image'
    try {
      await Promise.all([
        runtimeConfigStore.loadRuntimeConfig({ force: true }).catch(() => {}),
        authStore.initAuth().catch(() => null),
      ])
      const earlyJobsSync = authStore.isAuthenticated
        ? tasks.refreshServerAiJobs().catch(() => false)
        : Promise.resolve(false)
      if (authStore.isAuthenticated) {
        tasks.loadTasks()
        // 本地已有作品时立即结束骨架屏，服务端同步在后台静默进行
        if (tasks.tasks.value.length) isPageLoading.value = false
      } else {
        tasks.clearLocalTaskHistory()
      }
      await settingsStore.initSettings()
      const config = resolveAiFeatureRuntimeConfig(settingsStore, 'wallpaper')
      if (!models.studioProvider.value) models.studioProvider.value = config.provider
      models.studioGatewayBaseUrl.value = config.baseUrl
      executionMode.value = 'server'
      privacyMode.value = settingsStore.getSetting('ai_enable_privacy_mode', privacyMode.value)
      await models.syncCapabilityKitFromServer()
      models.ensureRuntimeProviderAndModels()
      if (!authStore.isAuthenticated) return
      // refreshServerAiJobs owns the in-memory merge. Reloading local storage here races with
      // output hydration and can replace freshly restored images with an older empty snapshot.
      await earlyJobsSync
      await preloadFilmstripHistory()
      tasks.restoreRunningTaskUi()
      tasks.resumeServerJobPolling()
      const active = tasks.tasks.value.find((task) => task.id === tasks.activeTaskId.value)
      if (active?.outputs?.length) {
        canvas.canvasMode.value = 'result'
      } else if (active?.sourcePreview || active?.sourceRemoteUrl) {
        canvas.canvasMode.value = 'source'
      }
    } catch (error) {
      notificationService.warning(error?.message || '部分创作数据加载失败，请稍后刷新重试')
    } finally {
      isPageLoading.value = false
    }
  }

  // 模型选项守卫（编排层统一绑定）
  watch(
    models.imageModelOptions,
    (list) => {
      if (list.length && !list.some((model) => model.id === models.imageModel.value)) {
        models.imageModel.value = list[0].id
      }
    },
    { immediate: true },
  )
  watch(
    models.videoModelOptions,
    (list) => {
      if (list.length && !list.some((model) => model.id === models.videoModel.value)) {
        models.videoModel.value = list[0].id
      }
    },
    { immediate: true },
  )
  watch(inputs.sourcePickerOpen, (pickerOpen) => {
    setBodyScrollLocked(pickerOpen)
  })

  watch(tasks.latestOutput, (next, prev) => {
    canvas.beginResultReveal(next, prev)
  })

  // 登出后立刻清空历史；登录后再恢复本地缓存并同步云端
  watch(
    () => authStore.isAuthenticated,
    (authenticated, wasAuthenticated) => {
      if (!authenticated) {
        tasks.clearLocalTaskHistory()
        return
      }
      if (wasAuthenticated === false) {
        tasks.loadTasks()
        void tasks
          .refreshServerAiJobs()
          .then(() => preloadFilmstripHistory())
          .catch(() => false)
      }
    },
  )

  watch(
    [
      inputs.inputMode,
      outputType,
      inputs.prompt,
      inputs.promptPolishEnabled,
      inputs.autoTranslateEnabled,
      inputs.transparentPngEnabled,
      autoBackgroundRemovalEnabled,
      inputs.negativePrompt,
      inputs.aspectRatio,
      inputs.imageCount,
      inputs.imageQuality,
      inputs.resolutionScale,
      inputs.upscaleOutputFormat,
      inputs.moderationLevel,
      inputs.duration,
      inputs.creativity,
      inputs.styleStrength,
      inputs.detailBoost,
      privacyMode,
      inputs.videoMotion,
      models.selectedPublicModel,
      tasks.activeTaskId,
      inputs.uploadRemoteUrl,
    ],
    () => persistStudioDraft(),
  )

  function handlePageLifecyclePersist() {
    persistStudioDraft({ immediate: true })
    tasks.persistTasks({ immediate: true })
  }

  function handleVisibilityPersist() {
    if (document.visibilityState === 'hidden') handlePageLifecyclePersist()
  }

  function handleRealtimeAiJobUpdated(event) {
    const payload = event?.detail?.payload || {}
    const kind = String(payload.kind || payload.job?.kind || '').toLowerCase()
    if (kind && !isWallpaperStudioJobKind(kind)) return
    void tasks.refreshServerAiJobs()
  }

  onMounted(() => {
    initPage()
    void loadGenerationUnitPrice()
    window.addEventListener('pagehide', handlePageLifecyclePersist)
    document.addEventListener('visibilitychange', handleVisibilityPersist)
    window.addEventListener('walleven:ai_job-updated', handleRealtimeAiJobUpdated)
  })

  onBeforeUnmount(() => {
    handlePageLifecyclePersist()
    window.removeEventListener('pagehide', handlePageLifecyclePersist)
    document.removeEventListener('visibilitychange', handleVisibilityPersist)
    window.removeEventListener('walleven:ai_job-updated', handleRealtimeAiJobUpdated)
    tasks.stopAllServerJobPolling()
    tasks.clearTaskTimers()
    models.clearModelTimers?.()
    if (persistDraftTimer) window.clearTimeout(persistDraftTimer)
    setBodyScrollLocked(false)
  })

  return {
    ref,
    tasks: tasks.tasks,
    activeTaskId: tasks.activeTaskId,
    canvasMode: canvas.canvasMode,
    selectedOutputIndex: canvas.selectedOutputIndex,
    comparisonMode: canvas.comparisonMode,
    canvasFitMode: canvas.canvasFitMode,
    canvasZoom: canvas.canvasZoom,
    isCanvasPanning: canvas.isCanvasPanning,
    inputMode: inputs.inputMode,
    outputType,
    prompt: inputs.prompt,
    promptPolishEnabled: inputs.promptPolishEnabled,
    autoTranslateEnabled: inputs.autoTranslateEnabled,
    transparentPngEnabled: inputs.transparentPngEnabled,
    autoBackgroundRemovalEnabled,
    negativePrompt: inputs.negativePrompt,
    aspectRatio: inputs.aspectRatio,
    imageCount: inputs.imageCount,
    imageQuality: inputs.imageQuality,
    resolutionScale: inputs.resolutionScale,
    upscaleOutputFormat: inputs.upscaleOutputFormat,
    moderationLevel: inputs.moderationLevel,
    maxReferenceImages: inputs.maxReferenceImages,
    outputSizeLabel: inputs.outputSizeLabel,
    generationCostLabel,
    localMaskEditCostLabel,
    duration: inputs.duration,
    creativity: inputs.creativity,
    styleStrength: inputs.styleStrength,
    detailBoost: inputs.detailBoost,
    privacyMode,
    videoMotion: inputs.videoMotion,
    autoSaveConfig,
    styleReferencePreviews: inputs.styleReferencePreviews,
    referenceImages: inputs.referenceImages,
    siteQuery: inputs.siteQuery,
    siteWallpapers: inputs.siteWallpapers,
    sitePage: inputs.sitePage,
    siteLoading: inputs.siteLoading,
    sourcePickerOpen: inputs.sourcePickerOpen,
    sourcePickerMode: inputs.sourcePickerMode,
    siteLibraryTab: inputs.siteLibraryTab,
    pickerPageInput: inputs.pickerPageInput,
    sourcePurityFilters: inputs.sourcePurityFilters,
    authorQuery: inputs.authorQuery,
    activeAuthor: inputs.activeAuthor,
    inspectorTab,
    inspectorTabs,
    mobileInspectorOpen,
    leftCollapsed,
    rightCollapsed,
    isMobile,
    previewStageRef: canvas.previewStageRef,
    isFullscreen: canvas.isFullscreen,
    holdoverPreviewUrl: canvas.holdoverPreviewUrl,
    resultRevealing: canvas.resultRevealing,
    clearResultReveal: canvas.clearResultReveal,
    promptPresets: inputs.promptPresets,
    promptLibrary: inputs.promptLibrary,
    skillOptions: models.skillOptions,
    customSkills: models.customSkills,
    mcpOptions: models.mcpOptions,
    activeTask: tasks.activeTask,
    isRunning: tasks.isRunning,
    isPageLoading,
    requestCreateTask,
    getLocalMaskEditCostSnapshot,
    activeOutputs: tasks.activeOutputs,
    latestOutput: tasks.latestOutput,
    sourcePreview: inputs.sourcePreview,
    canCreateTask,
    backgroundRemovalModels,
    backgroundRemovalModel,
    activePublicModelOptions: models.activePublicModelOptions,
    selectedPublicModel: models.selectedPublicModel,
    currentPublicModel: models.currentPublicModel,
    superResolutionFeatureEnabled: models.superResolutionFeatureEnabled,
    supportsImageUpscale: models.supportsImageUpscale,
    selectedSkills: models.selectedSkills,
    selectedMcpServers: models.selectedMcpServers,
    selectedSkillIds: models.selectedSkillIds,
    selectedMcpIds: models.selectedMcpIds,
    customMcpName: models.customMcpName,
    customMcpEndpoint: models.customMcpEndpoint,
    mcpTestState: models.mcpTestState,
    statusHeroText: tasks.statusHeroText,
    elapsedLabel: tasks.elapsedLabel,
    formatTaskElapsed: tasks.formatTaskElapsed,
    createHint,
    tuningSummary,
    previewImage: canvas.previewImage,
    comparisonSourceImage,
    activeStyleReferences,
    favoriteSourceItems: inputs.favoriteSourceItems,
    historySourceItems: inputs.historySourceItems,
    followedAuthorItems: inputs.followedAuthorItems,
    pickerTotal: inputs.pickerTotal,
    pickerLastPage: inputs.pickerLastPage,
    pickerSiteItems: inputs.pickerSiteItems,
    pickerDisplayItems: inputs.pickerDisplayItems,
    pickerEmptyText: inputs.pickerEmptyText,
    selectedWallpaper: inputs.selectedWallpaper,
    siteCategory: inputs.siteCategory,
    siteSorting: inputs.siteSorting,
    siteOrder: inputs.siteOrder,
    siteRatio: inputs.siteRatio,
    uploadPreview: inputs.uploadPreview,
    selectedFile: inputs.selectedFile,
    uploadSize: inputs.uploadSize,
    canvasMediaStyle: canvas.canvasMediaStyle,
    pageBackgroundStyle,
    sourceLabel: inputs.sourceLabel,
    formatPublicModelCost: models.formatPublicModelCost,
    saveStudioConfig: models.saveStudioConfig,
    taskKindLabel: tasks.taskKindLabel,
    sourceModeLabel: tasks.sourceModeLabel,
    taskStatusLabel: tasks.taskStatusLabel,
    resetCanvasView: canvas.resetCanvasView,
    handleFileChange: inputs.handleFileChange,
    clearUploadSource: inputs.clearUploadSource,
    openSourcePicker: inputs.openSourcePicker,
    closeSourcePicker: inputs.closeSourcePicker,
    handleSourcePreviewError: inputs.handleSourcePreviewError,
    composePrompt: inputs.composePrompt,
    removeTask: tasks.removeTask,
    clearLocalTaskHistory: tasks.clearLocalTaskHistory,
    clearFailedAndPausedTasks: tasks.clearFailedAndPausedTasks,
    isAuthenticated: computed(() => Boolean(authStore.isAuthenticated)),
    loadMoreServerJobs: tasks.loadMoreServerJobs,
    refreshServerAiJobs: tasks.refreshServerAiJobs,
    serverJobsHasMore: tasks.serverJobsHasMore,
    serverJobsLoadingMore: tasks.serverJobsLoadingMore,
    viewTask: tasks.viewTask,
    createUpscaleTask: tasks.createUpscaleTask,
    createMaskedEditTask: tasks.createMaskedEditTask,
    regenerateTaskInPlace: tasks.regenerateTaskInPlace,
    reuseTask: tasks.reuseTask,
    updateTask: tasks.updateTask,
    cancelTask: tasks.cancelTask,
    downloadOutput: tasks.downloadOutput,
    applyPromptPreset: inputs.applyPromptPreset,
    applyPromptLibraryItem: inputs.applyPromptLibraryItem,
    randomizePrompt: inputs.randomizePrompt,
    copyText: inputs.copyText,
    clearPrompt: inputs.clearPrompt,
    handlePaste: inputs.handlePaste,
    removeStyleReference: inputs.removeStyleReference,
    addReferenceFiles: inputs.addReferenceFiles,
    addReferenceImageFromUrl: inputs.addReferenceImageFromUrl,
    removeReferenceImage: inputs.removeReferenceImage,
    useOutputAsUpload,
    setOutputView,
    toggleSkill: models.toggleSkill,
    addCustomSkill: models.addCustomSkill,
    removeCustomSkill: models.removeCustomSkill,
    toggleMcpServer: models.toggleMcpServer,
    addCustomMcpServer: models.addCustomMcpServer,
    removeCustomMcpServer: models.removeCustomMcpServer,
    testMcpServer: models.testMcpServer,
    searchSiteWallpapers: inputs.searchSiteWallpapers,
    resetSitePageAndSearch: inputs.resetSitePageAndSearch,
    changeSitePage: inputs.changeSitePage,
    jumpPickerPage: inputs.jumpPickerPage,
    toggleSourcePurity: inputs.toggleSourcePurity,
    pickSiteSource: inputs.pickSiteSource,
    searchAuthorWallpapers: inputs.searchAuthorWallpapers,
    confirmTextSource: inputs.confirmTextSource,
    handleCanvasPointerDown: canvas.handleCanvasPointerDown,
    handleCanvasPointerMove: canvas.handleCanvasPointerMove,
    handleCanvasPointerUp: canvas.handleCanvasPointerUp,
    togglePreviewFullscreen: canvas.togglePreviewFullscreen,
    costConfirmVisible,
    costConfirmPayload,
    confirmCostAndCreate,
    cancelCostConfirm,
    creditsDialogOpen: creditsPrompt.dialogOpen,
    requiredCredits: creditsPrompt.requiredCredits,
    availableCredits: creditsPrompt.availableCredits,
    closeCreditsDialog: creditsPrompt.closePrompt,
  }
}
