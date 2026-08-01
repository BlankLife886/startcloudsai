<script setup>
import AiCostConfirmDialog from '@/features/ai-shared/AiCostConfirmDialog.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import { getModelAspectRatiosForResolution } from '@/features/ai-shared/modelImageCapabilities'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import ProgressiveAuthenticatedImage from '@/components/common/ProgressiveAuthenticatedImage.vue'
import SharePublishDialog from '@/features/share/components/SharePublishDialog.vue'
import AspectRatioSelect from './components/AspectRatioSelect.vue'
import DeleteHistoryConfirmDialog from './components/DeleteHistoryConfirmDialog.vue'
import UpscaleProcessingOverlay from './components/UpscaleProcessingOverlay.vue'
import '@/features/ai-wallpaper/styles/t2i-page.css'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAiWallpaperStudioState } from './composables/useAiWallpaperStudioState'
import { useWallpaperStudioMotion } from './composables/useWallpaperStudioMotion'
import {
  T2I_ASPECT_OPTIONS,
  T2I_COUNT_OPTIONS,
  T2I_MODERATION_OPTIONS,
  T2I_OUTPUT_FORMAT_OPTIONS,
  T2I_PROMPT_LIBRARY,
  T2I_QUALITY_OPTIONS,
  T2I_RESOLUTION_OPTIONS,
} from './composables/wallpaperStudioConstants'
import notificationService from '@/services/notification'
import { listMyShareAssets, submitShareItem } from '@/services/shareGallery'
import { listPromptLibrary, recordPromptEngagement } from '@/services/promptLibrary'
import { getAuthenticatedMediaMetadata } from '@/services/authenticatedMedia'
import {
  normalizeVisibleDisplayPositions,
  uniqueTaskOutputs,
  uniqueTaskThumbnailOutputs,
} from '@/features/ai-wallpaper/domain/galleryDisplay'
import {
  galleryFocusForItem,
  galleryGroupKey,
  galleryGroupTasks,
  resolveGalleryFocus,
} from '@/features/ai-wallpaper/domain/galleryFocus'
import { formatOutputSize } from '@/features/ai-wallpaper/domain/outputSizeMetadata'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { useAppearanceStore } from '@/stores/appearance'
const loadLocalMaskEditorDialog = () => import('./components/LocalMaskEditorDialog.vue')
const LocalMaskEditorDialog = defineAsyncComponent(loadLocalMaskEditorDialog)

const appearanceStore = useAppearanceStore()
const studioShellRef = ref(null)

const {
  tasks,
  activeTaskId,
  outputType,
  prompt,
  promptPolishEnabled,
  autoTranslateEnabled,
  transparentPngEnabled,
  referenceImages,
  aspectRatio,
  imageCount,
  imageQuality,
  resolutionScale,
  upscaleOutputFormat,
  moderationLevel,
  maxReferenceImages,
  generationCostLabel,
  inputMode,
  isRunning,
  isPageLoading,
  resultRevealing,
  clearResultReveal,
  requestCreateTask,
  canCreateTask,
  skillOptions,
  selectedSkills,
  selectedSkillIds,
  toggleSkill,
  addCustomSkill,
  removeCustomSkill,
  createMaskedEditTask,
  createHint,
  taskStatusLabel,
  elapsedLabel,
  formatTaskElapsed,
  clearPrompt,
  addReferenceFiles,
  addReferenceImageFromUrl,
  removeReferenceImage,
  removeTask,
  clearFailedAndPausedTasks,
  loadMoreServerJobs,
  serverJobsHasMore,
  serverJobsLoadingMore,
  viewTask,
  reuseTask,
  updateTask,
  cancelTask,
  downloadOutput,
  costConfirmVisible,
  costConfirmPayload,
  confirmCostAndCreate,
  cancelCostConfirm,
  creditsDialogOpen,
  requiredCredits,
  availableCredits,
  closeCreditsDialog,
  activePublicModelOptions,
  selectedPublicModel,
  currentPublicModel,
  isAuthenticated,
} = useAiWallpaperStudioState()

const modelSelectOptions = computed(() =>
  activePublicModelOptions.value.map((model) => ({
    value: model.id,
    label: model.label,
    pricePoints: model.pricePoints,
    standardPricePoints: model.standardPricePoints,
    discountPricePoints: model.discountPricePoints,
  })),
)
const resolutionSelectOptions = computed(() => {
  const supported = Array.isArray(currentPublicModel.value?.resolutions)
    ? currentPublicModel.value.resolutions.map((item) => String(item || '').toUpperCase())
    : []
  if (!supported.length) return T2I_RESOLUTION_OPTIONS
  return T2I_RESOLUTION_OPTIONS.filter((option) => supported.includes(option.value))
})
const aspectSelectOptions = computed(() => {
  const supported = getModelAspectRatiosForResolution(
    currentPublicModel.value || {},
    resolutionScale.value,
  )
  if (!Array.isArray(supported) || !supported.length) return T2I_ASPECT_OPTIONS
  return T2I_ASPECT_OPTIONS.filter((option) => supported.includes(option.value))
})
const qualitySelectOptions = computed(() => {
  const supported = currentPublicModel.value?.qualities || []
  return T2I_QUALITY_OPTIONS.filter((option) => supported.includes(option.value))
})
const outputFormatSelectOptions = computed(() => {
  const supported = currentPublicModel.value?.outputFormats || []
  return T2I_OUTPUT_FORMAT_OPTIONS.filter((option) => supported.includes(option.value))
})
const moderationSelectOptions = computed(() => {
  const supported = currentPublicModel.value?.moderationLevels || []
  return T2I_MODERATION_OPTIONS.filter((option) => supported.includes(option.value))
})
const frameParameterSummary = computed(() => {
  const aspectLabel =
    aspectSelectOptions.value.find((option) => option.value === aspectRatio.value)?.value ||
    aspectRatio.value
  const resolutionLabel =
    resolutionSelectOptions.value.find((option) => option.value === resolutionScale.value)?.label ||
    resolutionScale.value
  const qualityLabel =
    qualitySelectOptions.value.find((option) => option.value === imageQuality.value)?.label ||
    imageQuality.value
  const countLabel =
    T2I_COUNT_OPTIONS.find((option) => option.value === imageCount.value)?.label ||
    `${imageCount.value}张`
  return [aspectLabel, resolutionLabel, qualityLabel, countLabel].filter(Boolean).join(' · ')
})

watch(
  resolutionSelectOptions,
  (options) => {
    if (!options.some((option) => option.value === resolutionScale.value)) {
      resolutionScale.value = options[0]?.value || '1K'
    }
  },
  { immediate: true },
)

watch(
  [currentPublicModel, aspectSelectOptions, qualitySelectOptions, outputFormatSelectOptions],
  ([model, aspectOptions, qualityOptions, formatOptions]) => {
    if (
      aspectOptions.length &&
      !aspectOptions.some((option) => option.value === aspectRatio.value)
    ) {
      aspectRatio.value = aspectOptions[0].value
    }
    if (
      qualityOptions.length &&
      !qualityOptions.some((option) => option.value === imageQuality.value)
    ) {
      imageQuality.value = qualityOptions[0].value
    }
    if (!model?.transparentBackground) transparentPngEnabled.value = false
    if (!formatOptions.length) upscaleOutputFormat.value = 'auto'
    else if (!formatOptions.some((option) => option.value === upscaleOutputFormat.value)) {
      upscaleOutputFormat.value = formatOptions[0].value
    }
    const moderationOptions = moderationSelectOptions.value
    if (!moderationOptions.length) moderationLevel.value = ''
    else if (!moderationOptions.some((option) => option.value === moderationLevel.value)) {
      moderationLevel.value = moderationOptions[0].value
    }
    const referenceLimit = Math.max(0, Number(model?.maxReferenceImages) || 0)
    if (referenceImages.value.length > referenceLimit) {
      referenceImages.value = referenceImages.value.slice(0, referenceLimit)
    }
  },
  { immediate: true },
)

const referenceInputRef = ref(null)
const openParameterLayer = ref('')
const skillPanelOpen = ref(false)
const skillTriggerRef = ref(null)
const skillPanelStyle = ref({})
const customSkillDialogOpen = ref(false)
const customSkillName = ref('')
const customSkillPrompt = ref('')
const customSkillDescription = ref('')
const lightboxOpen = ref(false)
const lightboxUrl = ref('')
const lightboxTask = ref(null)
const lightboxIndex = ref(0)
const lightboxFrameRef = ref(null)
const lightboxZoom = ref(1)
const lightboxPanX = ref(0)
const lightboxPanY = ref(0)
const lightboxPanning = ref(false)
const lightboxNaturalSize = ref({ width: 0, height: 0 })
const lightboxCompareEnabled = ref(false)
const lightboxComparePosition = ref(50)
const lightboxCompareDragging = ref(false)
const lightboxFlipping = ref(false)
const lightboxClosing = ref(false)
const lightboxPlainOpen = ref(false)
const lightboxChromeVisible = ref(true)
const lightboxImageLoading = ref(false)
const stageSharedTransition = ref(false)
const MAIN_TAB_STORAGE_KEY = 'ai-wallpaper-studio-main-tab-v1'
const VALID_MAIN_TABS = new Set(['prompts', 'images', 'history', 'assets'])
const storedMainTab = getScopedLocalItem(MAIN_TAB_STORAGE_KEY)
const mainTab = ref(VALID_MAIN_TABS.has(storedMainTab) ? storedMainTab : 'images')
const promptBoxRef = ref(null)
const stageFrameRef = ref(null)
const stageCanvasRef = ref(null)
const stageCanvasAspect = ref(16 / 9)

useWallpaperStudioMotion({
  shellRef: studioShellRef,
  stageRef: stageFrameRef,
  isRunning,
  resultRevealing,
  onRevealComplete: clearResultReveal,
})
let stageCanvasResizeObserver = null
const actionBusyId = ref('')
const localMaskEditorOpen = ref(false)
const localMaskEditorMounted = ref(false)
const localMaskEditorBusy = ref(false)
const localMaskEditorTask = ref(null)
const localMaskEditorUrl = ref('')
const deleteConfirmOpen = ref(false)
const deleteRequest = ref(null)
const regenerateConfirmOpen = ref(false)
const regenerateTargetTask = ref(null)
const regeneratingTaskId = ref('')
const clearFailedConfirmOpen = ref(false)
const clearingFailedTasks = ref(false)
const clearFailedTargetCount = ref(0)
const publishOpen = ref(false)
const publishTarget = ref(null)
const submittingShareId = ref('')
const unavailableImageKeys = ref({})
const managedPromptLibrary = ref([])
const promptLibraryLoading = ref(false)
const promptLibraryLoadingMore = ref(false)
const promptPage = ref(1)
const promptTotal = ref(0)
const promptHasMore = ref(false)
const myAssets = ref([])
const assetsLoading = ref(false)
const assetsLoadingMore = ref(false)
const assetsCursor = ref('')
const assetsTotal = ref(0)
const assetsHasMore = ref(false)
const failedAssetIds = ref({})
const PROMPT_CATEGORY_STORAGE_KEY = 'ai-wallpaper-prompt-category-v1'
const storedPromptCategory = getScopedLocalItem(PROMPT_CATEGORY_STORAGE_KEY)
const VALID_PROMPT_CATEGORIES = new Set([
  'today',
  'my-favorites',
  'portrait',
  'photography',
  'product',
  'illustration',
  'scene',
  'design',
  'game',
  'typography',
  'other',
  'all',
])
const promptCategoryFilter = ref(
  storedPromptCategory === 'latest'
    ? 'today'
    : VALID_PROMPT_CATEGORIES.has(storedPromptCategory)
      ? storedPromptCategory
      : 'today',
)
const promptSort = ref('recommended')
const promptViewportRef = ref(null)
const promptSentinelRef = ref(null)
const assetSentinelRef = ref(null)
let promptLoadObserver = null
let assetLoadObserver = null
let promptLibraryRequestId = 0

const PROMPT_CATEGORY_PRIMARY = [
  { value: 'today', label: '今日最新' },
  { value: 'my-favorites', label: '我的收藏' },
  { value: 'all', label: '全部' },
]
const PROMPT_CATEGORY_MORE = [
  { value: 'portrait', label: '人像人物' },
  { value: 'photography', label: '摄影写实' },
  { value: 'product', label: '产品商业' },
  { value: 'illustration', label: '插画动漫' },
  { value: 'scene', label: '场景建筑' },
  { value: 'design', label: '视觉设计' },
  { value: 'game', label: '游戏美术' },
  { value: 'typography', label: '文字排版' },
  { value: 'other', label: '其他' },
]
const PROMPT_CATEGORY_META = [...PROMPT_CATEGORY_PRIMARY, ...PROMPT_CATEGORY_MORE]

const LIGHTBOX_MIN_ZOOM = 0.5
const LIGHTBOX_MAX_ZOOM = 5
const LIGHTBOX_ZOOM_STEP = 0.25
const FILMSTRIP_THUMBNAIL_DIMENSION = 240
const HISTORY_THUMBNAIL_DIMENSION = 720
let lightboxPanStart = null
let lightboxComparePointerId = null
let lightboxFlipClone = null
let lightboxFlipSafetyTimer = null
let lightboxFlipFadeTimer = null
let lightboxChromeHideTimer = null
let stageFlipClone = null
let stageFlipSafetyTimer = null
let stageFlipFadeTimer = null
let stageFlipAnimationDone = false
let stageFlipImageReady = false

const PROMPT_MAX = 20_000
const effectiveOutputFormat = computed({
  get: () =>
    transparentPngEnabled.value &&
    outputFormatSelectOptions.value.some((item) => item.value === 'png')
      ? 'png'
      : upscaleOutputFormat.value,
  set: (value) => {
    if (!transparentPngEnabled.value) upscaleOutputFormat.value = value
  },
})
const effectiveOutputFormatOptions = computed(() =>
  transparentPngEnabled.value
    ? outputFormatSelectOptions.value.filter((option) => option.value === 'png')
    : outputFormatSelectOptions.value,
)
const hasOutputControls = computed(
  () => effectiveOutputFormatOptions.value.length > 0 || moderationSelectOptions.value.length > 0,
)
const outputParameterSummary = computed(() => {
  if (!hasOutputControls.value) return '当前模型不支持'
  const formatLabel = effectiveOutputFormatOptions.value.find(
    (option) => option.value === effectiveOutputFormat.value,
  )?.label
  const moderationLabel = moderationSelectOptions.value.find(
    (option) => option.value === moderationLevel.value,
  )?.label
  return [formatLabel || '格式不可用', moderationLabel || '审核不可用'].join(' · ')
})
const enhanceParameterSummary = computed(() => {
  const transparentLabel = currentPublicModel.value?.transparentBackground
    ? `透明${transparentPngEnabled.value ? '开' : '关'}`
    : '透明禁用'
  return [
    `润色${promptPolishEnabled.value ? '开' : '关'}`,
    `翻译${autoTranslateEnabled.value ? '开' : '关'}`,
    transparentLabel,
  ].join(' · ')
})

watch(hasOutputControls, (available) => {
  if (!available && openParameterLayer.value === 'output') openParameterLayer.value = ''
})

const sortedTasks = computed(() =>
  (tasks.value || [])
    .map((task, index) => ({
      task,
      index,
      time: timestamp(task?.batchCreatedAt) || taskCreatedTime(task),
    }))
    .sort((left, right) => {
      const leftBatchId = String(left.task?.batchId || '')
      const rightBatchId = String(right.task?.batchId || '')
      if (leftBatchId && leftBatchId === rightBatchId) {
        return Number(left.task?.batchIndex || 0) - Number(right.task?.batchIndex || 0)
      }
      return right.time - left.time || left.index - right.index
    })
    .map((item) => item.task),
)
const publishedJobIds = computed(
  () => new Set(myAssets.value.map((item) => String(item.jobId || '')).filter(Boolean)),
)
function startOfLocalDayMs(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function isTaskFromToday(task) {
  const created = taskCreatedTime(task)
  if (!created) return false
  const start = startOfLocalDayMs()
  return created >= start && created < start + 24 * 60 * 60 * 1000
}

const historyTasks = computed(() =>
  sortedTasks.value.filter(
    (task) =>
      isTaskFromToday(task) &&
      task.shareSubmitted !== true &&
      !publishedJobIds.value.has(String(task.serverJobId || task.id || '').replace(/^server-/, '')),
  ),
)
const historyCount = computed(() => historyTasks.value.length)
/** 列表按创建时间倒序；已出现早于今天的任务时，更旧分页无需再拉 */
const historyReachedPastToday = computed(() => {
  const start = startOfLocalDayMs()
  return sortedTasks.value.some((task) => {
    const created = taskCreatedTime(task)
    return created > 0 && created < start
  })
})
const assetCount = computed(() => Math.max(assetsTotal.value, myAssets.value.length))
const promptCategoryPrimaryOptions = PROMPT_CATEGORY_PRIMARY
const promptCategoryMoreOptions = PROMPT_CATEGORY_MORE
const promptCategoryMoreOpen = ref(false)
const promptCategoryMoreActive = computed(() =>
  promptCategoryMoreOptions.some((item) => item.value === promptCategoryFilter.value),
)
const promptCategoryMoreLabel = computed(() => {
  if (!promptCategoryMoreActive.value) return '更多'
  return (
    promptCategoryMoreOptions.find((item) => item.value === promptCategoryFilter.value)?.label ||
    '更多'
  )
})
const filteredPromptLibrary = computed(() => managedPromptLibrary.value)
const promptLibraryEmptyTitle = computed(() => {
  if (promptCategoryFilter.value === 'today') return '今日暂无新增提示词'
  if (promptCategoryFilter.value === 'my-favorites') return '还没有收藏提示词'
  return '该分类暂时没有提示词'
})
const promptLibraryEmptyDescription = computed(() =>
  promptCategoryFilter.value === 'my-favorites'
    ? '点击提示词卡片下方的心形按钮，收藏后可以在这里快速找到。'
    : '选择其他分类继续浏览。',
)
const failedOrPausedTaskCount = computed(
  () =>
    historyTasks.value.filter((task) =>
      ['failed', 'paused'].includes(String(task?.status || '').toLowerCase()),
    ).length,
)
const lightboxZoomLabel = computed(() => `${Math.round(lightboxZoom.value * 100)}%`)
const lightboxImageStyle = computed(() => ({
  transform: `translate3d(${lightboxPanX.value}px, ${lightboxPanY.value}px, 0) scale(${lightboxZoom.value})`,
}))
const lightboxOriginalUrl = computed(() =>
  String(lightboxTask.value?.originalOutputUrl || '').trim(),
)
const lightboxCanCompare = computed(
  () =>
    Boolean(lightboxOriginalUrl.value) &&
    Boolean(lightboxUrl.value) &&
    lightboxOriginalUrl.value !== lightboxUrl.value,
)
const lightboxPreviewUrl = computed(
  () => taskThumbnailOutputs(lightboxTask.value)[lightboxIndex.value] || '',
)
const lightboxLiveTask = computed(() => {
  const taskId = String(lightboxTask.value?.id || '')
  return tasks.value.find((task) => String(task.id || '') === taskId) || lightboxTask.value
})
const lightboxOriginalLabel = computed(() => {
  const size = String(lightboxTask.value?.originalOutputSize || '').replace(/x/i, '×')
  return size ? `原图 ${size}` : '原图'
})
const lightboxProcessedLabel = computed(() => {
  const size = String(
    lightboxTask.value?.actualOutputSize || lightboxTask.value?.outputSize || '',
  ).replace(/x/i, '×')
  return size ? `处理后 ${size}` : '处理后'
})
const lightboxOriginalClipStyle = computed(() => ({
  clipPath: `inset(0 ${100 - lightboxComparePosition.value}% 0 0)`,
}))
const lightboxCompareDividerStyle = computed(() => ({
  left: `${lightboxComparePosition.value}%`,
}))
const publishDialogTitle = computed(() => {
  if (!publishTarget.value) return ''
  const prompt = String(taskPrompt(publishTarget.value.task) || '').trim()
  if (!prompt) return 'AI 壁纸创作'
  // 标题默认取前半句，避免整段提示词塞进输入框
  const firstClause = prompt.split(/[，,。.!！？?\n]/)[0]?.trim() || prompt
  return firstClause.slice(0, 36)
})
const publishDialogStyleLabel = computed(() => {
  const model = String(publishTarget.value?.task?.model || '').trim()
  return model && model !== '未知模型' ? model : 'AI 壁纸'
})
const deleteTarget = computed(() => deleteRequest.value?.tasks?.[0] || null)
const deleteConfirmTitle = computed(() => taskPrompt(deleteTarget.value).slice(0, 72))
const deleteConfirmIsGroup = computed(() => deleteRequest.value?.scope === 'group')
const deleteConfirmIsBatchItem = computed(
  () => !deleteConfirmIsGroup.value && Math.max(1, Number(deleteTarget.value?.batchSize || 1)) > 1,
)
const deleteConfirmHeading = computed(() =>
  deleteConfirmIsGroup.value
    ? '删除这一组图片？'
    : deleteConfirmIsBatchItem.value
      ? '删除这张图片？'
      : '删除这条历史记录？',
)
const deleteConfirmDescription = computed(() => {
  if (deleteConfirmIsGroup.value) {
    const count = Math.max(1, Number(deleteRequest.value?.itemCount || 1))
    return `将删除当前组的 ${count} 张图片，删除后无法恢复。`
  }
  return deleteConfirmIsBatchItem.value
    ? '只会删除当前这一张，不影响同批次的其他图片。删除后无法恢复。'
    : ''
})
const deleteConfirmLabel = computed(() => (deleteConfirmIsGroup.value ? '删除整组' : '确认删除'))
const deleteBusyLabel = computed(() => (deleteConfirmIsGroup.value ? '整组删除中…' : '删除中…'))
const runningProgress = computed(() => {
  const running = sortedTasks.value.filter((task) => isBusy(task) || isLocalUpscaling(task))
  if (!running.length) return ''
  return `处理中 ${elapsedLabel.value} · ${running.length} 个任务`
})

function outputImageKey(task, index, url) {
  return `${String(task?.id || task?.serverJobId || 'task')}::${Number(index) || 0}::${String(url || '')}`
}

function isImageUnavailable(task, index, url) {
  return Boolean(unavailableImageKeys.value[outputImageKey(task, index, url)])
}

function markImageUnavailable(task, index, url) {
  const key = outputImageKey(task, index, url)
  if (unavailableImageKeys.value[key]) return
  unavailableImageKeys.value = { ...unavailableImageKeys.value, [key]: true }
}

const imageGallery = computed(() => {
  const items = []
  // 舞台大图与底部胶片仅展示当天作品（与历史记录 Tab 一致）
  for (const task of sortedTasks.value.slice(0, 120)) {
    if (!isTaskFromToday(task)) continue
    const outputs = taskOutputs(task)
    const thumbnailOutputs = taskThumbnailOutputs(task)
    // 原地重新生成：继续展示当前图，不新开 pending 卡片
    if (isRegenerating(task) && outputs.length) {
      outputs.forEach((url, index) => {
        if (isImageUnavailable(task, index, url)) return
        items.push({
          key: `${task.id}-${index}`,
          kind: 'image',
          task,
          url,
          thumbnailUrl: thumbnailOutputs[index] || '',
          index,
          batchIndex: Number(task.batchSize || 1) > 1 ? Number(task.batchIndex || 0) : index,
          total: Number(task.batchSize || 1) > 1 ? Number(task.batchSize) : outputs.length,
          title: taskPrompt(task),
          regenerating: true,
        })
      })
      continue
    }
    if (isBusy(task)) {
      const batchSize = Math.max(1, Number(task.batchSize || 1))
      const slots =
        batchSize > 1
          ? 1
          : Math.min(4, Math.max(1, Number(task.count) || Number(imageCount.value) || 1))
      for (let index = 0; index < slots; index += 1) {
        items.push({
          key: `pending-${task.id}-${index}`,
          kind: 'pending',
          task,
          index,
          batchIndex: batchSize > 1 ? Number(task.batchIndex || 0) : index,
          total: batchSize > 1 ? batchSize : slots,
          title: taskPrompt(task),
        })
      }
      continue
    }
    if (!isDone(task)) continue
    outputs.forEach((url, index) => {
      if (isImageUnavailable(task, index, url)) return
      items.push({
        key: `${task.id}-${index}`,
        kind: 'image',
        task,
        url,
        thumbnailUrl: thumbnailOutputs[index] || '',
        index,
        batchIndex: Number(task.batchSize || 1) > 1 ? Number(task.batchIndex || 0) : index,
        total: Number(task.batchSize || 1) > 1 ? Number(task.batchSize) : outputs.length,
        title: taskPrompt(task),
      })
    })
  }
  return normalizeVisibleDisplayPositions(items)
})
const completedImageCount = computed(
  () => imageGallery.value.filter((item) => item.kind === 'image').length,
)
const focusKey = ref('')
const focusGroupKey = ref('')
const featuredImageAspects = ref({})
const featuredItem = computed(() => {
  return resolveGalleryFocus(imageGallery.value, {
    key: focusKey.value,
    groupKey: focusGroupKey.value,
  }).item
})
// 同批次（batchId）或同任务多图归为一组：底部胶片一组一格，主画布整组同屏展示。
const filmstripGroups = computed(() => {
  const groups = []
  const byKey = new Map()
  for (const item of imageGallery.value) {
    const key = galleryGroupKey(item)
    let group = byKey.get(key)
    if (!group) {
      group = { key, kind: item.kind, cover: item, items: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups.map((group) => {
    const imageCover = group.items.find((item) => item.kind === 'image')
    const pendingCount = group.items.filter((item) => item.kind === 'pending').length
    return {
      ...group,
      kind: imageCover ? (pendingCount ? 'mixed' : 'image') : 'pending',
      cover: imageCover || group.cover,
      pendingCount,
    }
  })
})
const FILMSTRIP_DOM_WINDOW = 30
const visibleFilmstripGroups = computed(() => {
  const groups = filmstripGroups.value
  if (groups.length <= FILMSTRIP_DOM_WINDOW) return groups
  const focusedIndex = Math.max(
    0,
    groups.findIndex((group) => group.key === focusGroupKey.value),
  )
  const half = Math.floor(FILMSTRIP_DOM_WINDOW / 2)
  const start = Math.min(Math.max(0, focusedIndex - half), groups.length - FILMSTRIP_DOM_WINDOW)
  return groups.slice(start, start + FILMSTRIP_DOM_WINDOW)
})
const featuredGroup = computed(() => {
  const item = featuredItem.value
  if (!item) return null
  const key = galleryGroupKey(item)
  return filmstripGroups.value.find((group) => group.key === key) || null
})
const stageGridItems = computed(() => {
  const group = featuredGroup.value
  if (!group || group.items.length < 2) return []
  return group.items
})
// 按内容区宽高比挑选行列组合，尽量占满画布：只取无空槽的组合，3 张另备“左一右二”拼贴
const stageGridLayout = computed(() => {
  const count = stageGridItems.value.length
  if (count < 2) return null
  const [w, h] = String(featuredAspect.value).split('/').map(Number)
  const imageRatio = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : 1
  const canvasRatio = stageCanvasAspect.value > 0 ? stageCanvasAspect.value : 16 / 9
  const candidates = []
  for (let cols = 1; cols <= count; cols += 1) {
    if (count % cols !== 0) continue
    candidates.push({ cols, rows: count / cols, collage: false })
  }
  if (count === 3) candidates.push({ cols: 2, rows: 2, collage: true })
  let best = candidates[0]
  let bestScore = Infinity
  for (const candidate of candidates) {
    const frameRatio = (imageRatio * candidate.cols) / candidate.rows
    const score = Math.abs(Math.log(frameRatio / canvasRatio))
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
})

watch(stageCanvasRef, (el) => {
  stageCanvasResizeObserver?.disconnect()
  stageCanvasResizeObserver = null
  if (!el || typeof ResizeObserver === 'undefined') return
  stageCanvasResizeObserver = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (rect?.width && rect?.height) stageCanvasAspect.value = rect.width / rect.height
  })
  stageCanvasResizeObserver.observe(el)
})
const featuredAspect = computed(() => {
  const item = featuredItem.value
  const measuredAspect = featuredImageAspects.value[item?.key]
  if (measuredAspect) return measuredAspect

  const actualSize = String(item?.task?.actualOutputSize || '')
  const sizeMatch = actualSize.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (sizeMatch && Number(sizeMatch[1]) > 0 && Number(sizeMatch[2]) > 0) {
    return `${Number(sizeMatch[1])} / ${Number(sizeMatch[2])}`
  }

  const ratio = String(item?.task?.aspectRatio || aspectRatio.value || '16:9')
  const [w, h] = ratio.split(':').map(Number)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `${w} / ${h}`
  return '16 / 9'
})
const featuredAspectStyle = computed(() => {
  const [width, height] = String(featuredAspect.value).split('/').map(Number)
  let ratio =
    Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : 16 / 9
  let aspect = featuredAspect.value
  const layout = stageGridLayout.value
  if (layout) {
    ratio = (ratio * layout.cols) / layout.rows
    aspect = String(ratio)
  }
  return {
    aspectRatio: aspect,
    '--t2i-stage-fit-width': `${ratio * 100}cqh`,
    '--t2i-stage-max-width': layout ? '1600px' : ratio > 1 ? '1280px' : '920px',
  }
})
const featuredPromptSummary = computed(() => {
  const promptText = String(featuredItem.value?.title || '').trim()
  const maxLength = 64
  return promptText.length > maxLength ? `${promptText.slice(0, maxLength)}…` : promptText
})

const HISTORY_BATCH = 12
const historyVisibleCount = ref(HISTORY_BATCH)
const historySentinelRef = ref(null)
const historyViewportRef = ref(null)
const historyViewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
const historyMeasuredAspects = ref({})
const historyImageMetadata = ref({})
const promptMeasuredAspects = ref({})
const promptImageMetadata = ref({})
const assetMeasuredAspects = ref({})
const assetImageMetadata = ref({})
let historyLoadObserver = null
let historyResizeObserver = null

function timestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value || '').trim()
  if (!text) return 0
  const numeric = Number(text)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function taskCreatedTime(task) {
  return (
    timestamp(task?.createdAt || task?.created_at) ||
    timestamp(task?.startedAt || task?.started_at) ||
    timestamp(task?.finishedAt || task?.finished_at) ||
    timestamp(task?.updatedAt || task?.updated_at)
  )
}

function taskAspectCss(task) {
  const raw = String(task?.aspectRatio || '')
  const [w, h] = raw.split(':').map(Number)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `${w} / ${h}`
  const size = String(task?.outputSize || '')
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (match) {
    const sw = Number(match[1])
    const sh = Number(match[2])
    if (sw > 0 && sh > 0) return `${sw} / ${sh}`
  }
  const fallback = String(aspectRatio.value || '16:9')
  const [fw, fh] = fallback.split(':').map(Number)
  if (Number.isFinite(fw) && Number.isFinite(fh) && fw > 0 && fh > 0) {
    return `${fw} / ${fh}`
  }
  return '16 / 9'
}

function aspectScore(css) {
  const [w, h] = css.split('/').map((part) => Number(String(part).trim()))
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return 1 / Math.max(0.35, Math.min(w / h, 3.2))
  }
  return 1
}

function buildBalancedMasonryColumns(items, count) {
  const columnCount = Math.max(1, Number(count || 1))
  const columns = Array.from({ length: columnCount }, () => [])
  const heights = Array.from({ length: columnCount }, () => 0)
  items.forEach((item) => {
    let target = 0
    for (let index = 1; index < heights.length; index += 1) {
      if (heights[index] < heights[target]) target = index
    }
    columns[target].push(item)
    heights[target] += Number(item.score) || 1
  })
  return columns
}

const promptLibraryFeedItems = computed(() =>
  filteredPromptLibrary.value.map((item) => {
    const key = `prompt-${item.id}`
    const aspect = promptMeasuredAspects.value[key] || '16 / 10'
    return {
      key,
      item,
      aspect,
      metadata: promptImageMetadata.value[key] || {},
      score: aspectScore(aspect),
    }
  }),
)

const promptLibraryMasonryColumns = computed(() =>
  buildBalancedMasonryColumns(promptLibraryFeedItems.value, libraryColumnCount.value),
)

const assetFeedItems = computed(() =>
  [...myAssets.value]
    .sort(
      (left, right) =>
        timestamp(right.updatedAt || right.createdAt) - timestamp(left.updatedAt || left.createdAt),
    )
    .map((asset) => {
      const key = `asset-${asset.id}`
      const task = assetTask(asset)
      const aspect = assetMeasuredAspects.value[key] || taskAspectCss(task)
      return {
        key,
        asset,
        task,
        aspect,
        metadata: assetImageMetadata.value[key] || {},
        score: aspectScore(aspect),
      }
    }),
)

const assetMasonryColumns = computed(() =>
  buildBalancedMasonryColumns(assetFeedItems.value, assetColumnCount.value),
)

const historyFeedItems = computed(() => {
  const items = []
  for (const task of historyTasks.value) {
    const outputs = taskOutputs(task)
    const thumbnailOutputs = taskThumbnailOutputs(task)
    if (outputs.length) {
      let visibleOutputCount = 0
      outputs.forEach((url, index) => {
        if (isImageUnavailable(task, index, url)) return
        visibleOutputCount += 1
        const key = `${task.id}-img-${index}`
        const aspect = historyMeasuredAspects.value[key] || taskAspectCss(task)
        const metadata = historyImageMetadata.value[key] || {}
        items.push({
          key,
          kind: 'image',
          task,
          url,
          thumbnailUrl: thumbnailOutputs[index] || '',
          index,
          batchIndex: Number(task.batchSize || 1) > 1 ? Number(task.batchIndex || 0) : index,
          total: Number(task.batchSize || 1) > 1 ? Number(task.batchSize) : outputs.length,
          aspect,
          metadata,
          score: aspectScore(aspect),
        })
      })
      if (!visibleOutputCount) continue
      continue
    }
    const aspect = taskAspectCss(task)
    items.push({
      key: `${task.id}-status`,
      kind: 'status',
      task,
      aspect,
      score: aspectScore(aspect),
    })
  }
  return normalizeVisibleDisplayPositions(items)
})

function measureHistoryImage(item, event) {
  const image = event?.target
  const authenticatedMetadata = getAuthenticatedMediaMetadata(item.url)
  const width = Number(authenticatedMetadata?.width || image?.naturalWidth || 0)
  const height = Number(authenticatedMetadata?.height || image?.naturalHeight || 0)
  if (!item?.key || width <= 0 || height <= 0) return
  syncTaskImageDimensions(item.task, width, height, {
    exact: Number(authenticatedMetadata?.width || 0) > 0,
  })
  const aspect = `${width} / ${height}`
  if (historyMeasuredAspects.value[item.key] !== aspect) {
    historyMeasuredAspects.value = {
      ...historyMeasuredAspects.value,
      [item.key]: aspect,
    }
  }

  const authenticatedBytes = Number(authenticatedMetadata?.bytes || 0)
  const bytes = authenticatedBytes || dataUrlBytes(item.url) || performanceImageBytes(image)
  const previous = historyImageMetadata.value[item.key] || {}
  if (
    previous.width === width &&
    previous.height === height &&
    previous.bytes === bytes &&
    previous.loaded
  ) {
    return
  }
  historyImageMetadata.value = {
    ...historyImageMetadata.value,
    [item.key]: { width, height, bytes, loaded: true },
  }
}

function nearestTaskAspect(width, height) {
  const ratio = Number(width || 0) / Number(height || 0)
  if (!Number.isFinite(ratio) || ratio <= 0) return ''
  let best = null
  for (const option of T2I_ASPECT_OPTIONS) {
    const [w, h] = String(option.value || '')
      .split(':')
      .map(Number)
    if (!w || !h) continue
    const distance = Math.abs(Math.log(ratio / (w / h)))
    if (!best || distance < best.distance) best = { value: option.value, distance }
  }
  return best?.distance <= 0.08 ? best.value : ''
}

function syncTaskImageDimensions(task, width, height, { exact = false } = {}) {
  if (!task?.id || width <= 0 || height <= 0) return
  const patch = {}
  const inferredAspect = nearestTaskAspect(width, height)
  if (inferredAspect && inferredAspect !== task.aspectRatio) patch.aspectRatio = inferredAspect
  if (exact) {
    const actualOutputSize = `${Math.round(width)}x${Math.round(height)}`
    if (task.actualOutputSize !== actualOutputSize) patch.actualOutputSize = actualOutputSize
    if (task.outputSize !== actualOutputSize) patch.outputSize = actualOutputSize
    if (!task.upstreamOutputSize && task.localUpscaleStatus !== 'completed') {
      patch.upstreamOutputSize = actualOutputSize
    }
  }
  if (Object.keys(patch).length) updateTask(task.id, patch)
}

function measureFeaturedImage(item, event) {
  const image = event?.target
  const metadata = getAuthenticatedMediaMetadata(item?.url || '')
  const width = Number(metadata?.width || image?.naturalWidth || 0)
  const height = Number(metadata?.height || image?.naturalHeight || 0)
  if (item?.key && width > 0 && height > 0) {
    const nextAspect = `${width} / ${height}`
    if (featuredImageAspects.value[item.key] !== nextAspect) {
      featuredImageAspects.value = {
        ...featuredImageAspects.value,
        [item.key]: nextAspect,
      }
    }
  }
  syncTaskImageDimensions(item?.task, width, height, {
    exact: Number(metadata?.width || 0) > 0,
  })
}

function measureCollectionImage(item, event, aspectState, metadataState) {
  const image = event?.target
  const authenticatedMetadata = getAuthenticatedMediaMetadata(
    item?.item?.imageUrl || item?.asset?.coverUrl || item?.asset?.resultUrl || '',
    { maxDimension: HISTORY_THUMBNAIL_DIMENSION },
  )
  const width = Number(authenticatedMetadata?.width || image?.naturalWidth || 0)
  const height = Number(authenticatedMetadata?.height || image?.naturalHeight || 0)
  if (!item?.key || width <= 0 || height <= 0) return
  const bytes = Number(authenticatedMetadata?.bytes || 0) || performanceImageBytes(image)
  aspectState.value = { ...aspectState.value, [item.key]: `${width} / ${height}` }
  metadataState.value = {
    ...metadataState.value,
    [item.key]: { width, height, bytes, loaded: true },
  }
}

function measurePromptLibraryImage(item, event) {
  measureCollectionImage(item, event, promptMeasuredAspects, promptImageMetadata)
}

function measureAssetImage(item, event) {
  measureCollectionImage(item, event, assetMeasuredAspects, assetImageMetadata)
}

function dataUrlBytes(value) {
  const match = String(value || '').match(/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/i)
  if (!match) return 0
  const payload = match[1]
  const padding = (payload.match(/=*$/)?.[0] || '').length
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

function performanceImageBytes(image) {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') {
    return 0
  }
  const sources = [image?.currentSrc, image?.src].filter(Boolean)
  for (const source of sources) {
    const entries = performance.getEntriesByName(source)
    const entry = entries.at(-1)
    const bytes = Number(entry?.encodedBodySize || entry?.transferSize || 0)
    if (bytes > 0) return bytes
  }
  return 0
}

function historyImageResolution(item) {
  const width = Number(item?.metadata?.width || 0)
  const height = Number(item?.metadata?.height || 0)
  if (width > 0 && height > 0) return `${width} × ${height}`
  return (
    formatOutputSize(
      item?.task?.actualOutputSize ||
        item?.task?.outputSize ||
        item?.task?.upstreamOutputSize ||
        item?.task?.originalOutputSize,
    ).replace('×', ' × ') || '尺寸读取中'
  )
}

function historyImageFileSize(item) {
  const bytes = Number(item?.metadata?.bytes || 0)
  if (bytes > 0) return formatImageBytes(bytes)
  return item?.metadata?.loaded ? '大小未知' : '大小读取中'
}

function collectionImageResolution(item) {
  const width = Number(item?.metadata?.width || 0)
  const height = Number(item?.metadata?.height || 0)
  return width > 0 && height > 0 ? `${width} × ${height}` : '尺寸读取中'
}

function collectionImageFileSize(item) {
  const bytes = Number(item?.metadata?.bytes || 0)
  if (bytes > 0) return formatImageBytes(bytes)
  return item?.metadata?.loaded ? '大小未知' : '大小读取中'
}

function formatImageBytes(bytes) {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const lightboxGalleryItems = computed(() =>
  historyFeedItems.value.filter((item) => item.kind === 'image' && item.url),
)
const lightboxGalleryIndex = computed(() => {
  const taskId = String(lightboxTask.value?.id || '')
  return lightboxGalleryItems.value.findIndex(
    (item) => String(item.task?.id || '') === taskId && item.index === lightboxIndex.value,
  )
})
const lightboxPositionLabel = computed(() => {
  const index = lightboxGalleryIndex.value
  return index >= 0 && lightboxGalleryItems.value.length > 1
    ? `${index + 1} / ${lightboxGalleryItems.value.length}`
    : ''
})

const visibleHistoryItems = computed(() =>
  historyFeedItems.value.slice(0, historyVisibleCount.value),
)
const historyHasMore = computed(
  () =>
    historyVisibleCount.value < historyFeedItems.value.length ||
    (serverJobsHasMore.value === true && !historyReachedPastToday.value),
)
function responsiveGalleryColumnCount(width) {
  if (width <= 480) return 1
  if (width <= 700) return 2
  if (width <= 920) return 3
  if (width <= 1160) return 4
  return 5
}
const historyColumnCount = computed(() => responsiveGalleryColumnCount(historyViewportWidth.value))
const libraryColumnCount = computed(() => {
  const width = historyViewportWidth.value
  if (width <= 640) return 1
  if (width <= 960) return 2
  return 3
})
const assetColumnCount = computed(() => responsiveGalleryColumnCount(historyViewportWidth.value))

const historyMasonryColumns = computed(() =>
  buildBalancedMasonryColumns(visibleHistoryItems.value, historyColumnCount.value),
)

function normalizePromptCategory(value) {
  const key = String(value || 'other')
    .trim()
    .toLowerCase()
  return PROMPT_CATEGORY_META.some((item) => item.value === key) ? key : 'other'
}

function promptCategoryLabel(value) {
  const key = normalizePromptCategory(value)
  return PROMPT_CATEGORY_META.find((item) => item.value === key)?.label || '其他'
}

function selectPromptCategory(value) {
  if (promptViewportRef.value) promptViewportRef.value.scrollTop = 0
  promptCategoryFilter.value = value
  promptCategoryMoreOpen.value = false
}

function togglePromptCategoryMore() {
  promptCategoryMoreOpen.value = !promptCategoryMoreOpen.value
}

async function loadMoreHistory() {
  if (!historyHasMore.value || serverJobsLoadingMore.value) return
  if (historyVisibleCount.value < historyFeedItems.value.length) {
    historyVisibleCount.value = Math.min(
      historyFeedItems.value.length,
      historyVisibleCount.value + HISTORY_BATCH,
    )
    await nextTick()
    if (historyHasMore.value) setupHistoryObserver()
    return
  }
  const loaded = await loadMoreServerJobs()
  historyVisibleCount.value = Math.min(
    historyFeedItems.value.length,
    historyVisibleCount.value + HISTORY_BATCH,
  )
  await nextTick()
  if (loaded !== false && historyHasMore.value) setupHistoryObserver()
}

function resetHistoryWindow() {
  historyVisibleCount.value = Math.min(
    HISTORY_BATCH,
    historyFeedItems.value.length || HISTORY_BATCH,
  )
}

function onHistoryViewportResize() {
  historyViewportWidth.value = historyViewportRef.value?.clientWidth || window.innerWidth
  if (lightboxOpen.value) nextTick(clampLightboxPan)
}

function disconnectHistoryObserver() {
  historyLoadObserver?.disconnect()
  historyLoadObserver = null
}

function disconnectPromptObserver() {
  promptLoadObserver?.disconnect()
  promptLoadObserver = null
}

function disconnectAssetObserver() {
  assetLoadObserver?.disconnect()
  assetLoadObserver = null
}

function setupPromptObserver() {
  disconnectPromptObserver()
  if (typeof IntersectionObserver === 'undefined') return
  const sentinel = promptSentinelRef.value
  if (!sentinel) return
  promptLoadObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMorePrompts()
    },
    { root: sentinel.closest('.t2i-panel') || null, rootMargin: '520px 0px', threshold: 0.01 },
  )
  promptLoadObserver.observe(sentinel)
}

function setupAssetObserver() {
  disconnectAssetObserver()
  if (typeof IntersectionObserver === 'undefined') return
  const sentinel = assetSentinelRef.value
  if (!sentinel) return
  assetLoadObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreAssets()
    },
    { root: sentinel.closest('.t2i-panel') || null, rootMargin: '520px 0px', threshold: 0.01 },
  )
  assetLoadObserver.observe(sentinel)
}

function setupHistoryObserver() {
  disconnectHistoryObserver()
  if (typeof IntersectionObserver === 'undefined') return
  const sentinel = historySentinelRef.value
  if (!sentinel) return
  historyLoadObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreHistory()
    },
    { root: sentinel.closest('.t2i-panel') || null, rootMargin: '480px 0px', threshold: 0.01 },
  )
  historyLoadObserver.observe(sentinel)
}

async function loadManagedPromptLibrary({ reset = false } = {}) {
  if (!reset && (promptLibraryLoading.value || promptLibraryLoadingMore.value)) return
  const nextPage = reset ? 1 : promptPage.value + 1
  if (!reset && !promptHasMore.value) return
  const requestId = reset ? ++promptLibraryRequestId : promptLibraryRequestId
  const requestCategory = promptCategoryFilter.value
  const requestSort = requestCategory === 'today' ? 'latest' : promptSort.value
  if (reset) {
    promptLibraryLoading.value = true
    promptLibraryLoadingMore.value = false
  } else {
    promptLibraryLoadingMore.value = true
  }
  try {
    const response = await listPromptLibrary('t2i', {
      pageNumber: nextPage,
      pageSize: 24,
      category: ['today', 'my-favorites'].includes(requestCategory) ? 'all' : requestCategory,
      scope:
        requestCategory === 'my-favorites'
          ? 'favorites'
          : requestCategory === 'today'
            ? 'today'
            : '',
      sort: requestSort,
      fallbackItems: T2I_PROMPT_LIBRARY,
    })
    if (requestId !== promptLibraryRequestId) return
    const incoming = Array.isArray(response?.items) ? response.items : []
    managedPromptLibrary.value = reset
      ? incoming
      : Array.from(
          new Map(
            [...managedPromptLibrary.value, ...incoming].map((item) => [item.id, item]),
          ).values(),
        )
    promptPage.value = Number(response?.page || nextPage)
    promptTotal.value = Number(response?.total || managedPromptLibrary.value.length)
    promptHasMore.value = response?.hasMore === true
  } catch {
    if (requestId !== promptLibraryRequestId) return
    if (reset) {
      managedPromptLibrary.value = []
      promptTotal.value = 0
      promptHasMore.value = false
    }
  } finally {
    if (requestId === promptLibraryRequestId) {
      promptLibraryLoading.value = false
      promptLibraryLoadingMore.value = false
    }
  }
}

function loadMorePrompts() {
  return loadManagedPromptLibrary()
}

async function loadMyAssets({ reset = false } = {}) {
  if (assetsLoading.value || assetsLoadingMore.value) return
  if (!reset && !assetsHasMore.value) return
  if (reset) assetsLoading.value = true
  else assetsLoadingMore.value = true
  try {
    const response = await listMyShareAssets({
      pageSize: 12,
      cursor: reset ? '' : assetsCursor.value,
    })
    const incoming = Array.isArray(response?.items) ? response.items : []
    if (reset) failedAssetIds.value = {}
    myAssets.value = reset
      ? incoming
      : Array.from(
          new Map([...myAssets.value, ...incoming].map((item) => [item.id, item])).values(),
        )
    assetsCursor.value = String(response?.nextCursor || '')
    assetsTotal.value = myAssets.value.length
    assetsHasMore.value = Boolean(assetsCursor.value)
  } catch (error) {
    notificationService.warning(error?.message || '我的资产读取失败')
  } finally {
    assetsLoading.value = false
    assetsLoadingMore.value = false
  }
}

function loadMoreAssets() {
  return loadMyAssets()
}

async function handleReferenceFileInput(event) {
  await addReferenceFiles(event.target?.files || [])
  if (event.target) event.target.value = ''
}

async function handleReferenceDrop(event) {
  await addReferenceFiles(event?.dataTransfer?.files || [])
}

async function handlePromptPaste(event) {
  const clipboard = event?.clipboardData
  if (!clipboard) return
  const itemFiles = Array.from(clipboard.items || [])
    .filter((item) => item.kind === 'file' && item.type?.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  const files = itemFiles.length
    ? itemFiles
    : Array.from(clipboard.files || []).filter((file) => file?.type?.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  await addReferenceFiles(files)
}

function useGeneratedAsReference(task, index = 0) {
  const url = taskOutputs(task)[index]
  addReferenceImageFromUrl(url, taskPrompt(task).slice(0, 80))
}

function applyPromptEngagementResult(item, result = {}) {
  item.likeCount = Math.max(0, Number(result.likeCount) || 0)
  item.favoriteCount = Math.max(0, Number(result.favoriteCount) || 0)
  item.useCount = Math.max(0, Number(result.useCount) || 0)
}

async function togglePromptEngagement(item, action) {
  if (!item?.id) return
  const field = action === 'like' ? 'liked' : 'favorited'
  const countField = action === 'like' ? 'likeCount' : 'favoriteCount'
  const previous = item[field] === true
  item[field] = !previous
  item[countField] = Math.max(0, Number(item[countField] || 0) + (previous ? -1 : 1))
  try {
    const result = await recordPromptEngagement(item.id, action, !previous)
    applyPromptEngagementResult(item, result)
    if (action === 'favorite' && previous && promptCategoryFilter.value === 'my-favorites') {
      managedPromptLibrary.value = managedPromptLibrary.value.filter(
        (entry) => entry.id !== item.id,
      )
      promptTotal.value = Math.max(0, promptTotal.value - 1)
    }
  } catch (caught) {
    item[field] = previous
    item[countField] = Math.max(0, Number(item[countField] || 0) + (previous ? 1 : -1))
    notificationService.error(caught?.message || '操作失败，请稍后重试')
  }
}

function usePromptLibraryEntry(item) {
  if (!item?.prompt) return
  prompt.value = item.prompt
  item.useCount = Math.max(0, Number(item.useCount || 0) + 1)
  void recordPromptEngagement(item.id, 'use')
    .then((result) => applyPromptEngagementResult(item, result))
    .catch(() => undefined)
  nextTick(() => promptBoxRef.value?.querySelector?.('textarea')?.focus?.())
}

function assetTask(asset) {
  return (
    tasks.value.find(
      (task) =>
        String(task.serverJobId || task.id || '').replace(/^server-/, '') ===
        String(asset.jobId || ''),
    ) || {
      id: `asset-${asset.id}`,
      serverJobId: asset.jobId,
      status: 'completed',
      outputs: [asset.resultUrl],
      prompt: asset.title || '已发布资产',
      createdAt: asset.createdAt,
    }
  )
}

function openAsset(asset, event) {
  openLightbox(assetTask(asset), 0, event)
}

function markAssetUnavailable(asset) {
  failedAssetIds.value = { ...failedAssetIds.value, [asset.id]: true }
}

function retryAssetImage(asset) {
  const next = { ...failedAssetIds.value }
  delete next[asset.id]
  failedAssetIds.value = next
}

onMounted(() => {
  inputMode.value = 'text'
  outputType.value = 'image'
  if (!Number(imageCount.value) || Number(imageCount.value) < 1) imageCount.value = 1
  setScopedLocalItem(MAIN_TAB_STORAGE_KEY, mainTab.value)
  window.addEventListener('keydown', handleLightboxKeydown)
  window.addEventListener('resize', onHistoryViewportResize, { passive: true })
  if (typeof ResizeObserver !== 'undefined' && historyViewportRef.value) {
    historyResizeObserver = new ResizeObserver(onHistoryViewportResize)
    historyResizeObserver.observe(historyViewportRef.value)
  }
  onHistoryViewportResize()
  loadManagedPromptLibrary({ reset: true })
  void activateMainTab(mainTab.value)
})

onUnmounted(() => {
  cancelLightboxFlip()
  cancelStageFlip()
  stageCanvasResizeObserver?.disconnect()
  stageCanvasResizeObserver = null
  window.removeEventListener('keydown', handleLightboxKeydown)
  clearLightboxChromeHideTimer()
  window.removeEventListener('resize', onHistoryViewportResize)
  window.removeEventListener('resize', syncSkillPanelPosition)
  window.removeEventListener('scroll', syncSkillPanelPosition, true)
  historyResizeObserver?.disconnect()
  historyResizeObserver = null
  disconnectHistoryObserver()
  disconnectPromptObserver()
  disconnectAssetObserver()
})

async function activateMainTab(tab) {
  if (tab === 'assets') {
    if (!myAssets.value.length) await loadMyAssets({ reset: true })
    await nextTick()
    setupAssetObserver()
  } else {
    disconnectAssetObserver()
  }
  if (tab === 'prompts') {
    await nextTick()
    setupPromptObserver()
  } else {
    disconnectPromptObserver()
  }
  if (tab !== 'history') {
    disconnectHistoryObserver()
    return
  }
  resetHistoryWindow()
  await nextTick()
  setupHistoryObserver()
}

watch(mainTab, async (tab) => {
  setScopedLocalItem(MAIN_TAB_STORAGE_KEY, tab)
  await activateMainTab(tab)
})

watch([promptCategoryFilter, promptSort], async () => {
  setScopedLocalItem(PROMPT_CATEGORY_STORAGE_KEY, promptCategoryFilter.value)
  await loadManagedPromptLibrary({ reset: true })
  if (mainTab.value !== 'prompts') return
  await nextTick()
  setupPromptObserver()
})

watch(promptHasMore, async (hasMore) => {
  if (mainTab.value !== 'prompts') return
  await nextTick()
  if (hasMore) setupPromptObserver()
  else disconnectPromptObserver()
})

watch(assetsHasMore, async (hasMore) => {
  if (mainTab.value !== 'assets') return
  await nextTick()
  if (hasMore) setupAssetObserver()
  else disconnectAssetObserver()
})

watch(historyFeedItems, (items) => {
  if (historyVisibleCount.value > items.length) {
    historyVisibleCount.value = items.length
  }
  if (
    mainTab.value === 'history' &&
    historyVisibleCount.value < Math.min(HISTORY_BATCH, items.length)
  ) {
    historyVisibleCount.value = Math.min(HISTORY_BATCH, items.length)
  }
})

watch(historyHasMore, async (hasMore) => {
  if (mainTab.value !== 'history') return
  await nextTick()
  if (hasMore) setupHistoryObserver()
  else disconnectHistoryObserver()
})

watch(
  imageGallery,
  (items, prevItems) => {
    // 用户新提交的任务：立刻聚焦到「生成中」卡片，让进度看得见（首次加载不触发）
    if (Array.isArray(prevItems)) {
      const prevKeys = new Set(prevItems.map((item) => item.key))
      const freshPending = items.find((item) => item.kind === 'pending' && !prevKeys.has(item.key))
      if (freshPending) {
        const nextFocus = galleryFocusForItem(freshPending)
        focusKey.value = nextFocus.key
        focusGroupKey.value = nextFocus.groupKey
        return
      }
    }
    const nextFocus = resolveGalleryFocus(items, {
      key: focusKey.value,
      groupKey: focusGroupKey.value,
    })
    focusKey.value = nextFocus.key
    focusGroupKey.value = nextFocus.groupKey
  },
  { immediate: true },
)

function applyFocusedGalleryItem(item) {
  if (!item?.key) return
  const nextFocus = galleryFocusForItem(item)
  focusKey.value = nextFocus.key
  focusGroupKey.value = nextFocus.groupKey
  if (item.task) viewTask(item.task)
}

function scrollFilmstripItemIntoComfortZone(event) {
  const itemElement = event?.currentTarget
  const filmstrip = itemElement?.closest?.('.t2i-filmstrip')
  if (!(itemElement instanceof HTMLElement) || !(filmstrip instanceof HTMLElement)) return
  const allItems = Array.from(filmstrip.querySelectorAll('.t2i-film-item'))
  const itemRect = itemElement.getBoundingClientRect()
  const stripRect = filmstrip.getBoundingClientRect()
  const visibleItems = allItems.filter((element) => {
    const rect = element.getBoundingClientRect()
    return rect.right > stripRect.left && rect.left < stripRect.right
  })
  const visibleIndex = visibleItems.indexOf(itemElement)
  const itemCenter = itemRect.left + itemRect.width / 2
  const nearLeftEdge = visibleIndex >= 0 && visibleIndex < 3
  const nearRightEdge = visibleIndex >= Math.max(0, visibleItems.length - 3)
  const maxScrollLeft = Math.max(0, filmstrip.scrollWidth - filmstrip.clientWidth)
  const canScrollLeft = filmstrip.scrollLeft > 1
  const canScrollRight = filmstrip.scrollLeft < maxScrollLeft - 1
  const shouldScrollLeft = nearLeftEdge && canScrollLeft
  const shouldScrollRight = nearRightEdge && canScrollRight
  if (!shouldScrollLeft && !shouldScrollRight) return

  const targetScrollLeft = Math.max(
    0,
    Math.min(
      maxScrollLeft,
      filmstrip.scrollLeft + itemCenter - (stripRect.left + stripRect.width / 2),
    ),
  )

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  window.requestAnimationFrame(() => {
    if (!filmstrip.isConnected) return
    filmstrip.scrollTo({
      left: targetScrollLeft,
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  })
}

function focusGalleryItem(item, event) {
  scrollFilmstripItemIntoComfortZone(event)
  if (!item?.key || item.key === featuredItem.value?.key) return
  if (galleryGroupKey(item) === (featuredGroup.value?.key ?? '')) {
    applyFocusedGalleryItem(item)
    return
  }
  const animate =
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
    !document.documentElement.classList.contains('settings-no-animations')
  const source = event?.currentTarget?.querySelector?.('.authenticated-image-media')
  // 多图组直接整组上屏；原图已在缓存时立即显示原图，飞行动画只会徒增闪烁
  const targetIsGrid =
    (filmstripGroups.value.find((group) => group.key === galleryGroupKey(item))?.items.length ||
      1) > 1
  const originalReady = item.kind === 'image' && Boolean(getAuthenticatedMediaMetadata(item.url))
  const canFlip =
    animate &&
    !targetIsGrid &&
    !originalReady &&
    item.kind === 'image' &&
    source instanceof HTMLImageElement &&
    Boolean(source.currentSrc || source.src) &&
    typeof source.animate === 'function' &&
    !lightboxOpen.value

  if (!canFlip) {
    cancelStageFlip()
    applyFocusedGalleryItem(item)
    return
  }
  void startStageFlip(source, item)
}

function cancelStageFlip() {
  if (stageFlipSafetyTimer) {
    window.clearTimeout(stageFlipSafetyTimer)
    stageFlipSafetyTimer = null
  }
  if (stageFlipFadeTimer) {
    window.clearTimeout(stageFlipFadeTimer)
    stageFlipFadeTimer = null
  }
  if (stageFlipClone) {
    stageFlipClone.remove()
    stageFlipClone = null
  }
  stageFlipAnimationDone = false
  stageFlipImageReady = false
  stageSharedTransition.value = false
}

function markStageImageReady() {
  stageFlipImageReady = true
  maybeHandoverStageFlip()
}

function handleFeaturedImageLoad(item, event) {
  markStageImageReady()
  measureFeaturedImage(item, event)
}

function maybeHandoverStageFlip() {
  if (!stageFlipClone || !stageFlipAnimationDone || !stageFlipImageReady) return
  handoverStageFlip()
}

function handoverStageFlip() {
  const clone = stageFlipClone
  if (!clone) return
  if (stageFlipSafetyTimer) {
    window.clearTimeout(stageFlipSafetyTimer)
    stageFlipSafetyTimer = null
  }
  stageSharedTransition.value = false
  clone.style.transition = 'opacity 160ms ease'
  clone.style.opacity = '0'
  stageFlipFadeTimer = window.setTimeout(() => {
    stageFlipFadeTimer = null
    if (stageFlipClone === clone) stageFlipClone = null
    clone.remove()
  }, 180)
}

async function startStageFlip(source, item) {
  cancelStageFlip()
  const startRect = source.getBoundingClientRect()
  const naturalWidth = Number(source.naturalWidth || 0) || startRect.width
  const naturalHeight = Number(source.naturalHeight || 0) || startRect.height
  if (!startRect.width || !startRect.height || !naturalWidth || !naturalHeight) {
    applyFocusedGalleryItem(item)
    return
  }

  const cloneSrc = source.currentSrc || source.src
  stageSharedTransition.value = true
  applyFocusedGalleryItem(item)
  await nextTick()

  const frameRect = stageFrameRef.value?.getBoundingClientRect()
  if (!frameRect?.width || !frameRect?.height) {
    cancelStageFlip()
    return
  }

  const fitScale = Math.min(frameRect.width / naturalWidth, frameRect.height / naturalHeight)
  const targetWidth = Math.max(1, naturalWidth * fitScale)
  const targetHeight = Math.max(1, naturalHeight * fitScale)
  const targetLeft = frameRect.left + (frameRect.width - targetWidth) / 2
  const targetTop = frameRect.top + (frameRect.height - targetHeight) / 2

  const clone = document.createElement('img')
  clone.className = 't2i-stage-flip-clone'
  clone.alt = ''
  clone.decoding = 'async'
  clone.setAttribute('aria-hidden', 'true')
  clone.src = cloneSrc
  clone.style.left = `${targetLeft}px`
  clone.style.top = `${targetTop}px`
  clone.style.width = `${targetWidth}px`
  clone.style.height = `${targetHeight}px`
  clone.addEventListener('error', cancelStageFlip, { once: true })
  stageFlipClone = clone
  document.body.appendChild(clone)
  // 兜底：即使大图迟迟未就绪也按时交接，避免克隆图长期悬停
  stageFlipSafetyTimer = window.setTimeout(() => {
    stageFlipSafetyTimer = null
    if (stageFlipClone === clone) handoverStageFlip()
  }, 1200)

  const deltaX = startRect.left - targetLeft
  const deltaY = startRect.top - targetTop
  const scaleX = startRect.width / targetWidth
  const scaleY = startRect.height / targetHeight
  try {
    const animation = clone.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})` },
        { transform: 'translate(0px, 0px) scale(1, 1)' },
      ],
      { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    )
    await animation.finished
    if (stageFlipClone !== clone) return
    stageFlipAnimationDone = true
    maybeHandoverStageFlip()
  } catch {
    if (stageFlipClone === clone) cancelStageFlip()
  }
}

function stepFeatured(delta) {
  const groups = filmstripGroups.value
  if (groups.length < 2) return
  const currentKey = featuredGroup.value?.key
  const index = Math.max(
    0,
    groups.findIndex((group) => group.key === currentKey),
  )
  const next = groups[(index + delta + groups.length) % groups.length]
  applyFocusedGalleryItem(next.cover)
}

function resetLightboxView() {
  lightboxZoom.value = 1
  lightboxPanX.value = 0
  lightboxPanY.value = 0
  lightboxPanning.value = false
  lightboxPanStart = null
}

function clampLightboxPan() {
  const frame = lightboxFrameRef.value
  if (!frame || lightboxZoom.value <= 1) {
    lightboxPanX.value = 0
    lightboxPanY.value = 0
    return
  }
  const rect = frame.getBoundingClientRect()
  const naturalWidth = Number(lightboxNaturalSize.value.width || rect.width)
  const naturalHeight = Number(lightboxNaturalSize.value.height || rect.height)
  const fitScale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const scaledWidth = naturalWidth * fitScale * lightboxZoom.value
  const scaledHeight = naturalHeight * fitScale * lightboxZoom.value
  const maxX = Math.max(0, (scaledWidth - rect.width) / 2)
  const maxY = Math.max(0, (scaledHeight - rect.height) / 2)
  lightboxPanX.value = Math.min(maxX, Math.max(-maxX, lightboxPanX.value))
  lightboxPanY.value = Math.min(maxY, Math.max(-maxY, lightboxPanY.value))
}

function setLightboxZoom(value) {
  lightboxZoom.value = Math.min(
    LIGHTBOX_MAX_ZOOM,
    Math.max(LIGHTBOX_MIN_ZOOM, Math.round(Number(value || 1) * 100) / 100),
  )
  nextTick(clampLightboxPan)
}

function zoomLightbox(delta) {
  setLightboxZoom(lightboxZoom.value + delta)
}

function handleLightboxWheel(event) {
  zoomLightbox(event.deltaY < 0 ? LIGHTBOX_ZOOM_STEP : -LIGHTBOX_ZOOM_STEP)
}

function toggleLightboxZoom() {
  setLightboxZoom(lightboxZoom.value === 1 ? 2 : 1)
}

function handleLightboxImageLoad(event) {
  lightboxImageLoading.value = false
  lightboxNaturalSize.value = {
    width: Number(event?.target?.naturalWidth || 0),
    height: Number(event?.target?.naturalHeight || 0),
  }
  clampLightboxPan()
}

function startLightboxPan(event) {
  if (event.button !== 0 || lightboxZoom.value <= 1) return
  event.preventDefault()
  lightboxPanning.value = true
  lightboxPanStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: lightboxPanX.value,
    panY: lightboxPanY.value,
  }
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function moveLightboxPan(event) {
  if (!lightboxPanning.value || lightboxPanStart?.pointerId !== event.pointerId) return
  lightboxPanX.value = lightboxPanStart.panX + event.clientX - lightboxPanStart.x
  lightboxPanY.value = lightboxPanStart.panY + event.clientY - lightboxPanStart.y
  clampLightboxPan()
}

function endLightboxPan(event) {
  if (lightboxPanStart?.pointerId !== event.pointerId) return
  event.currentTarget?.releasePointerCapture?.(event.pointerId)
  lightboxPanning.value = false
  lightboxPanStart = null
}

function updateLightboxComparePosition(event) {
  const frame = lightboxFrameRef.value
  if (!frame) return
  const rect = frame.getBoundingClientRect()
  if (!rect.width) return
  const position = ((event.clientX - rect.left) / rect.width) * 100
  lightboxComparePosition.value = Math.round(Math.min(100, Math.max(0, position)) * 10) / 10
}

function startLightboxCompareDrag(event) {
  if (event.button !== 0 || !lightboxCompareEnabled.value || !lightboxCanCompare.value) return
  event.preventDefault()
  event.stopPropagation()
  lightboxCompareDragging.value = true
  lightboxComparePointerId = event.pointerId
  updateLightboxComparePosition(event)
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function moveLightboxCompareDrag(event) {
  if (!lightboxCompareDragging.value || lightboxComparePointerId !== event.pointerId) return
  event.preventDefault()
  event.stopPropagation()
  updateLightboxComparePosition(event)
}

function endLightboxCompareDrag(event) {
  if (lightboxComparePointerId !== event.pointerId) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget?.releasePointerCapture?.(event.pointerId)
  lightboxCompareDragging.value = false
  lightboxComparePointerId = null
}

function nudgeLightboxCompare(delta) {
  lightboxComparePosition.value = Math.min(
    100,
    Math.max(0, Number(lightboxComparePosition.value || 0) + delta),
  )
}

function stepLightbox(delta) {
  const items = lightboxGalleryItems.value
  if (items.length < 2) return
  const currentIndex = lightboxGalleryIndex.value >= 0 ? lightboxGalleryIndex.value : 0
  const next = items[(currentIndex + delta + items.length) % items.length]
  lightboxTask.value = next.task
  lightboxIndex.value = next.index
  lightboxUrl.value = next.url
  lightboxImageLoading.value = Boolean(next.url)
  lightboxCompareEnabled.value = false
  lightboxComparePosition.value = 50
  viewTask(next.task)
  lightboxNaturalSize.value = { width: 0, height: 0 }
  resetLightboxView()
}

function handleLightboxKeydown(event) {
  if (customSkillDialogOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCustomSkillDialog()
    }
    return
  }
  if (skillPanelOpen.value && event.key === 'Escape') {
    event.preventDefault()
    skillPanelOpen.value = false
    return
  }
  if (promptCategoryMoreOpen.value && event.key === 'Escape') {
    event.preventDefault()
    promptCategoryMoreOpen.value = false
    return
  }
  if (openParameterLayer.value && event.key === 'Escape') {
    event.preventDefault()
    openParameterLayer.value = ''
    return
  }
  if (deleteConfirmOpen.value || regenerateConfirmOpen.value) return
  if (!lightboxOpen.value) return
  if (localMaskEditorOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeLocalMaskEditor()
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeLightbox()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    stepLightbox(-1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    stepLightbox(1)
    return
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomLightbox(LIGHTBOX_ZOOM_STEP)
    return
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    zoomLightbox(-LIGHTBOX_ZOOM_STEP)
    return
  }
  if (event.key === '0') {
    event.preventDefault()
    resetLightboxView()
  }
}

function taskPrompt(task) {
  const candidates = [task?.userPrompt, task?.prompt, task?.input?.prompt, task?.params?.prompt]
  for (const value of candidates) {
    const text = String(value || '')
      .split('\n')
      .map((line) => line.trim())
      .find(
        (line) =>
          line &&
          !/^避免：/.test(line) &&
          !/^创作参数/.test(line) &&
          !/^输出比例/.test(line) &&
          !/^已装配/.test(line),
      )
    if (text) return text
  }
  if (isFailed(task)) return '生成失败的任务'
  if (isCancelled(task)) return '已取消的任务'
  return '未命名任务'
}

function taskOutputs(task) {
  return uniqueTaskOutputs(task)
}

function taskThumbnailOutputs(task) {
  return uniqueTaskThumbnailOutputs(task)
}

function taskMeta(task) {
  const upstreamSize = formatOutputSize(task?.upstreamOutputSize || task?.outputSize)
  const actualSize = formatOutputSize(task?.actualOutputSize)
  const sizeMeta = actualSize
    ? upstreamSize && upstreamSize !== actualSize
      ? `上游 ${upstreamSize} · 实际 ${actualSize}`
      : `实际 ${actualSize}`
    : upstreamSize
      ? `上游 ${upstreamSize}`
      : ''
  return [
    task?.model || '未知模型',
    task?.resolutionScale || resolutionScale.value,
    task?.aspectRatio || aspectRatio.value,
    task?.transparentPngEnabled ? (isDone(task) ? '透明 PNG 已验收' : '透明 PNG 质量门') : '',
    sizeMeta,
    formatTaskTime(task),
    taskGenerationTime(task),
  ]
    .filter(Boolean)
    .filter(Boolean)
    .join(' · ')
}

function taskGenerationTime(task) {
  const elapsed = formatTaskElapsed(task)
  return elapsed ? `生成耗时 ${elapsed}` : ''
}

function formatTaskTime(task) {
  const raw = task?.createdAt || task?.finishedAt || task?.startedAt
  const date = raw ? new Date(typeof raw === 'number' ? raw : raw) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isBusy(task) {
  // paused = 上游可能已结束，本地停住了；不能再当成「生成中」
  return ['running', 'queued', 'waiting_provider'].includes(String(task?.status || ''))
}

function isRegenerating(task) {
  return String(task?.regenerateStatus || '') === 'running'
}

function isLocalUpscaling(task) {
  return String(task?.localUpscaleStatus || '') === 'running'
}

function isPaused(task) {
  return String(task?.status || '') === 'paused'
}

function canCancel(task) {
  return isBusy(task) || isPaused(task) || isLocalUpscaling(task) || isRegenerating(task)
}

function isFailed(task) {
  return String(task?.status || '') === 'failed'
}

function isCancelled(task) {
  return ['cancelled', 'canceled'].includes(String(task?.status || ''))
}

function isDone(task) {
  return ['done', 'completed'].includes(String(task?.status || '')) && taskOutputs(task).length > 0
}

function friendlyError(task) {
  const localUpscaleError = String(task?.localUpscaleError || '')
  if (localUpscaleError) return `${localUpscaleError}，已保留原始图片。`
  const raw = String(task?.error || '')
  if (!raw) return ''
  if (/network connection lost|连接中断|provider_network_lost/i.test(raw)) {
    return '上游连接中断，请稍后重试。'
  }
  if (/未能写入 R2|结果持久化|本地结果持久化|result_media_missing|图片未能写入/i.test(raw)) {
    return '上游已出图，但结果保存失败，任务已暂停（不会重复扣费）。'
  }
  if (/timeout|超时/i.test(raw)) return '生成超时，请稍后重试。'
  if (/insufficient|积分不足|余额不足/i.test(raw)) return '积分不足，请先充值。'
  if (/unauthorized|未登录|login/i.test(raw)) return '登录失效，请重新登录。'
  return raw
}

function statusTitle(task) {
  if (isLocalUpscaling(task)) {
    return (
      String(task?.localUpscaleMessage || '').trim() ||
      `正在生成 ${task?.localUpscaleTarget || '高清'} · ${Math.round(Number(task?.localUpscaleProgress || 0))}%`
    )
  }
  if (task?.localUpscaleStatus === 'completed')
    return `${task?.localUpscaleTarget || '高清'} 已完成`
  if (isFailed(task)) return '生成失败'
  if (isPaused(task)) return '已暂停'
  if (isCancelled(task)) return '已取消'
  return taskStatusLabel(task.status) || '排队中…'
}

/** 生成中卡片的阶段文案：优先取任务最新日志（提交/排队/云端处理），否则回退状态标签 */
function pendingStageText(task) {
  const logs = Array.isArray(task?.logs) ? task.logs : []
  const lastLog = String(logs[logs.length - 1] || '').trim()
  return lastLog || statusTitle(task)
}

function pendingElapsedText(task) {
  const label = formatTaskElapsed(task)
  return label ? `已用时 ${label}` : '排队等待中'
}

function normalizedShareStatus(task) {
  const status = String(task?.shareSubmissionStatus || '')
    .trim()
    .toLowerCase()
  return status || (task?.shareSubmitted ? 'pending' : '')
}

function shareStatusLabel(task) {
  const status = normalizedShareStatus(task)
  if (status === 'approved') return '已发布'
  if (status === 'rejected') return '未通过'
  if (status === 'pending') return '审核中'
  return '发布'
}

function shareStatusNotice(task) {
  const status = normalizedShareStatus(task)
  if (status === 'approved') return '该作品已经发布，无需重复提交'
  if (status === 'rejected') return '该作品审核未通过，请联系管理员处理'
  return '该作品已经提交，正在审核中'
}

function closePublishDialog() {
  if (submittingShareId.value) return
  publishOpen.value = false
  publishTarget.value = null
}

function openPublish(item) {
  const task = item?.task
  if (isLocalUpscaling(task)) {
    notificationService.info('高清图片仍在生成，请完成后再发布')
    return
  }
  if (!item?.url || !taskOutputs(task).length) {
    notificationService.warning('请等待图片生成完成后再发布')
    return
  }
  if (task?.shareSubmitted) {
    notificationService.info(shareStatusNotice(task))
    return
  }
  if (!task?.serverJobId && !task?.id) {
    notificationService.warning('该作品缺少云端任务信息，暂时无法发布')
    return
  }
  publishTarget.value = item
  publishOpen.value = true
}

async function submitHistoryToShare(options = {}) {
  const item = publishTarget.value
  const task = item?.task
  if (!task || submittingShareId.value) return
  const taskId = String(task.id || task.serverJobId || '')
  const jobId = String(task.serverJobId || task.id || '')
  submittingShareId.value = taskId
  try {
    const styleLabel = publishDialogStyleLabel.value
    const response = await submitShareItem({
      jobId,
      title: publishDialogTitle.value || 'AI 壁纸创作',
      styleLabel,
      category: 'other',
      tags: [styleLabel, 'AI 壁纸'],
      ...options,
    })
    const shareSubmissionStatus = String(response?.item?.status || 'pending').toLowerCase()
    updateTask(task.id, { shareSubmitted: true, shareSubmissionStatus })
    notificationService.success(
      shareSubmissionStatus === 'approved' ? '作品已经发布' : '作品已提交发布审核',
    )
    publishOpen.value = false
    publishTarget.value = null
    void loadMyAssets({ reset: true })
  } catch (error) {
    notificationService.error(error?.message || '作品发布失败')
  } finally {
    submittingShareId.value = ''
  }
}

function applyLightboxContent(task, index, url) {
  const outputs = taskOutputs(task)
  viewTask(task)
  lightboxTask.value = task
  lightboxIndex.value = index
  lightboxUrl.value = url || outputs[index]
  lightboxImageLoading.value = Boolean(lightboxUrl.value)
  lightboxCompareEnabled.value = false
  lightboxComparePosition.value = 50
  lightboxNaturalSize.value = { width: 0, height: 0 }
  resetLightboxView()
  lightboxOpen.value = true
  wakeLightboxChrome()
}

function openLightbox(task, index = 0, event) {
  const url = taskOutputs(task)[index]
  if (!url) return

  const animate =
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
    !document.documentElement.classList.contains('settings-no-animations')
  const source = event?.currentTarget?.querySelector?.('.authenticated-image-media')
  const canFlip =
    animate &&
    source instanceof HTMLImageElement &&
    Boolean(source.currentSrc || source.src) &&
    typeof source.animate === 'function' &&
    !lightboxFlipClone

  if (!canFlip) {
    lightboxPlainOpen.value = animate
    applyLightboxContent(task, index, url)
    if (animate) {
      window.setTimeout(() => {
        lightboxPlainOpen.value = false
      }, 640)
    }
    return
  }

  void startLightboxFlip(source, task, index, url)
}

function cancelLightboxFlip() {
  if (lightboxFlipSafetyTimer) {
    window.clearTimeout(lightboxFlipSafetyTimer)
    lightboxFlipSafetyTimer = null
  }
  if (lightboxFlipFadeTimer) {
    window.clearTimeout(lightboxFlipFadeTimer)
    lightboxFlipFadeTimer = null
  }
  if (lightboxFlipClone) {
    lightboxFlipClone.remove()
    lightboxFlipClone = null
  }
  lightboxFlipping.value = false
}

function handoverLightboxFlip() {
  const clone = lightboxFlipClone
  if (!clone) return
  if (lightboxFlipSafetyTimer) {
    window.clearTimeout(lightboxFlipSafetyTimer)
    lightboxFlipSafetyTimer = null
  }
  lightboxFlipping.value = false
  clone.style.transition = 'opacity 120ms ease'
  clone.style.opacity = '0'
  lightboxFlipFadeTimer = window.setTimeout(() => {
    lightboxFlipFadeTimer = null
    if (lightboxFlipClone === clone) lightboxFlipClone = null
    clone.remove()
  }, 140)
}

async function startLightboxFlip(source, task, index, url) {
  const startRect = source.getBoundingClientRect()
  const naturalWidth = Number(source.naturalWidth || 0) || startRect.width
  const naturalHeight = Number(source.naturalHeight || 0) || startRect.height
  if (!startRect.width || !startRect.height || !naturalWidth || !naturalHeight) {
    lightboxPlainOpen.value = true
    applyLightboxContent(task, index, url)
    window.setTimeout(() => {
      lightboxPlainOpen.value = false
    }, 640)
    return
  }

  const cloneSrc = source.currentSrc || source.src
  lightboxFlipping.value = true
  applyLightboxContent(task, index, url)
  await nextTick()

  const frameRect = lightboxFrameRef.value?.getBoundingClientRect()
  const boxWidth = frameRect?.width || window.innerWidth
  const boxHeight = frameRect?.height || window.innerHeight
  const boxLeft = frameRect?.left || 0
  const boxTop = frameRect?.top || 0
  const fitScale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight)
  const targetWidth = Math.max(1, naturalWidth * fitScale)
  const targetHeight = Math.max(1, naturalHeight * fitScale)
  const targetLeft = boxLeft + (boxWidth - targetWidth) / 2
  const targetTop = boxTop + (boxHeight - targetHeight) / 2

  const clone = document.createElement('img')
  clone.className = 't2i-lightbox-flip-clone'
  clone.alt = ''
  clone.decoding = 'async'
  clone.setAttribute('aria-hidden', 'true')
  clone.src = cloneSrc
  clone.style.left = `${targetLeft}px`
  clone.style.top = `${targetTop}px`
  clone.style.width = `${targetWidth}px`
  clone.style.height = `${targetHeight}px`
  clone.addEventListener('error', cancelLightboxFlip, { once: true })
  lightboxFlipClone = clone
  document.body.appendChild(clone)
  lightboxFlipSafetyTimer = window.setTimeout(cancelLightboxFlip, 500)

  const deltaX = startRect.left - targetLeft
  const deltaY = startRect.top - targetTop
  const scaleX = startRect.width / targetWidth
  const scaleY = startRect.height / targetHeight
  try {
    const animation = clone.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})` },
        { transform: 'translate(0px, 0px) scale(1, 1)' },
      ],
      { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    )
    await animation.finished
    if (lightboxFlipClone === clone) handoverLightboxFlip()
  } catch {
    if (lightboxFlipClone === clone) cancelLightboxFlip()
  }
}

function prefetchLocalMaskEditor() {
  void loadLocalMaskEditorDialog()
}

function openLocalMaskEditor() {
  if (!lightboxTask.value || !lightboxUrl.value) {
    notificationService.warning('当前图片无法进行局部编辑')
    return
  }
  localMaskEditorTask.value = lightboxTask.value
  localMaskEditorUrl.value = lightboxUrl.value
  localMaskEditorMounted.value = true
  localMaskEditorOpen.value = true
}

function closeLocalMaskEditor() {
  if (localMaskEditorBusy.value) return
  localMaskEditorOpen.value = false
  localMaskEditorTask.value = null
  localMaskEditorUrl.value = ''
}

async function submitLocalMaskEdit(payload) {
  if (localMaskEditorBusy.value || !localMaskEditorTask.value) return
  localMaskEditorBusy.value = true
  try {
    await createMaskedEditTask({
      sourceTask: localMaskEditorTask.value,
      sourceUrl: localMaskEditorUrl.value,
      maskFile: payload?.maskFile,
      prompt: payload?.prompt,
    })
    localMaskEditorOpen.value = false
    localMaskEditorTask.value = null
    localMaskEditorUrl.value = ''
    closeLightbox()
    notificationService.success('局部编辑任务已提交，未选区域将要求保持不变')
  } catch (error) {
    notificationService.error(error?.message || '局部编辑提交失败，请更换支持蒙版的模型重试')
  } finally {
    localMaskEditorBusy.value = false
  }
}

function clearLightboxChromeHideTimer() {
  if (lightboxChromeHideTimer) {
    window.clearTimeout(lightboxChromeHideTimer)
    lightboxChromeHideTimer = null
  }
}

function wakeLightboxChrome() {
  lightboxChromeVisible.value = true
  clearLightboxChromeHideTimer()
  lightboxChromeHideTimer = window.setTimeout(() => {
    lightboxChromeVisible.value = false
    lightboxChromeHideTimer = null
  }, 2500)
}

function closeLightbox() {
  if (lightboxClosing.value) return
  cancelLightboxFlip()
  const animate =
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
    !document.documentElement.classList.contains('settings-no-animations')
  if (!animate) {
    finishCloseLightbox()
    return
  }
  lightboxClosing.value = true
  window.setTimeout(() => {
    lightboxClosing.value = false
    finishCloseLightbox()
  }, 220)
}

function finishCloseLightbox() {
  clearLightboxChromeHideTimer()
  lightboxChromeVisible.value = true
  resetLightboxView()
  lightboxOpen.value = false
  lightboxUrl.value = ''
  lightboxTask.value = null
  lightboxIndex.value = 0
  lightboxImageLoading.value = false
  lightboxCompareEnabled.value = false
  lightboxComparePosition.value = 50
  lightboxCompareDragging.value = false
  lightboxComparePointerId = null
}

function toggleLightboxCompare() {
  if (!lightboxCanCompare.value) return
  lightboxCompareEnabled.value = !lightboxCompareEnabled.value
  lightboxComparePosition.value = 50
  resetLightboxView()
  if (lightboxCompareEnabled.value) nextTick(() => setLightboxZoom(2))
}

function downloadTaskOutput(task, index = 0) {
  const url = taskOutputs(task)[index]
  if (!url) return
  downloadOutput(url, index + 1, task)
}

function downloadLightbox() {
  if (!lightboxUrl.value) return
  downloadOutput(lightboxUrl.value, lightboxIndex.value + 1, lightboxTask.value)
}

function handleLightboxImageError() {
  const failedTask = lightboxTask.value
  const failedIndex = lightboxIndex.value
  const failedUrl = lightboxUrl.value
  closeLightbox()
  markImageUnavailable(failedTask, failedIndex, failedUrl)
  notificationService.warning('这张图片暂时无法读取，已自动切换到其他可用作品')
}

function handleLightboxOriginalImageError() {
  lightboxCompareEnabled.value = false
  notificationService.info('原始图片暂时无法读取，已退出前后对比')
}

async function editTask(task) {
  if (!task) return
  try {
    reuseTask(task, { silent: true })
    await nextTick()
    const textarea = promptBoxRef.value?.querySelector?.('textarea')
    textarea?.focus?.()
    textarea?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    notificationService.success('已填回左侧，可修改后重新生成')
  } catch (error) {
    notificationService.error(error?.message || '无法编辑该任务')
  }
}

function openRegenerateConfirm(task) {
  if (!task || actionBusyId.value || regeneratingTaskId.value || isRegenerating(task)) return
  regenerateTargetTask.value = task
  regenerateConfirmOpen.value = true
}

function closeRegenerateConfirm() {
  if (regeneratingTaskId.value) return
  regenerateConfirmOpen.value = false
  regenerateTargetTask.value = null
}

async function confirmRegenerateTask() {
  const task = regenerateTargetTask.value
  if (!task || regeneratingTaskId.value || isRegenerating(task)) return
  regeneratingTaskId.value = String(task.id)
  actionBusyId.value = String(task.id)
  try {
    reuseTask(task, { silent: true })
    await nextTick()
    if (!canCreateTask.value) {
      notificationService.warning(createHint.value || '当前无法重新生成')
      return
    }
    regenerateConfirmOpen.value = false
    await requestCreateTask({ count: 1, regenerateTaskId: task.id })
  } catch (error) {
    notificationService.error(error?.message || '重新生成失败')
  } finally {
    regeneratingTaskId.value = ''
    actionBusyId.value = ''
    regenerateTargetTask.value = null
  }
}

async function regenerateTask(task) {
  openRegenerateConfirm(task)
}

async function handleGenerate() {
  closeMenus()
  await requestCreateTask()
}

async function handleCancelTask(task) {
  if (!task?.id || actionBusyId.value) return
  if (!canCancel(task)) {
    notificationService.info('只有进行中或已暂停的任务可以取消')
    return
  }
  actionBusyId.value = String(task.id)
  try {
    const batchId = String(task.batchId || '')
    const batchTasks =
      batchId && Number(task.batchSize || 1) > 1
        ? tasks.value.filter((item) => String(item.batchId || '') === batchId && canCancel(item))
        : [task]
    if (batchTasks.length > 1) {
      const results = await Promise.allSettled(
        batchTasks.map((item) => cancelTask(item.id, { silent: true })),
      )
      const cancelledCount = results.filter(
        (result) => result.status === 'fulfilled' && result.value === true,
      ).length
      if (cancelledCount === batchTasks.length) {
        notificationService.success(`已取消本批 ${cancelledCount} 个任务`)
      } else {
        notificationService.warning(`本批已取消 ${cancelledCount}/${batchTasks.length} 个任务`)
      }
    } else {
      await cancelTask(task.id)
    }
  } catch (error) {
    notificationService.error(error?.message || '取消失败')
  } finally {
    actionBusyId.value = ''
  }
}

function openDeleteRequest(tasksToDelete, { scope = 'item', groupKey = '', itemCount = 1 } = {}) {
  if (actionBusyId.value) return
  const uniqueTasks = [
    ...new Map(tasksToDelete.map((task) => [String(task?.id || ''), task])).values(),
  ].filter((task) => task?.id)
  if (!uniqueTasks.length) return
  deleteRequest.value = {
    scope,
    tasks: uniqueTasks,
    groupKey,
    itemCount: Math.max(1, Number(itemCount || uniqueTasks.length)),
  }
  deleteConfirmOpen.value = true
}

function handleRemoveTask(task) {
  openDeleteRequest([task])
}

function handleRemoveGroup(group) {
  const groupTasks = galleryGroupTasks(group)
  openDeleteRequest(groupTasks, {
    scope: 'group',
    groupKey: group?.key || '',
    itemCount: group?.items?.length || groupTasks.length,
  })
}

function closeDeleteConfirm() {
  if (actionBusyId.value) return
  deleteConfirmOpen.value = false
  deleteRequest.value = null
}

async function confirmRemoveTask() {
  const request = deleteRequest.value
  const tasksToDelete = request?.tasks || []
  if (!tasksToDelete.length || actionBusyId.value) return
  actionBusyId.value =
    request.scope === 'group'
      ? `group:${request.groupKey || tasksToDelete[0].id}`
      : String(tasksToDelete[0].id)
  try {
    if (request.scope === 'group') {
      const results = await Promise.all(
        tasksToDelete.map(async (task) => {
          try {
            return await removeTask(task.id, { silent: true })
          } catch {
            return false
          }
        }),
      )
      const removedCount = results.filter(Boolean).length
      if (!removedCount) {
        notificationService.error('整组图片删除失败，请稍后重试')
        return
      }
      if (removedCount === tasksToDelete.length) {
        notificationService.success(`已删除本组 ${request.itemCount} 张图片`)
      } else {
        notificationService.warning(
          `本组已删除 ${removedCount}/${tasksToDelete.length} 个任务，剩余任务请重试`,
        )
      }
    } else {
      const removed = await removeTask(tasksToDelete[0].id)
      if (!removed) return
    }
    if (tasksToDelete.some((task) => lightboxTask.value?.id === task.id)) closeLightbox()
    deleteConfirmOpen.value = false
    deleteRequest.value = null
  } catch (error) {
    notificationService.error(error?.message || '删除失败')
  } finally {
    actionBusyId.value = ''
  }
}

function openClearFailedConfirm() {
  if (!failedOrPausedTaskCount.value || clearingFailedTasks.value) return
  clearFailedTargetCount.value = failedOrPausedTaskCount.value
  clearFailedConfirmOpen.value = true
}

function closeClearFailedConfirm() {
  if (clearingFailedTasks.value) return
  clearFailedConfirmOpen.value = false
  clearFailedTargetCount.value = 0
}

async function confirmClearFailedTasks() {
  if (clearingFailedTasks.value || !failedOrPausedTaskCount.value) return
  clearingFailedTasks.value = true
  try {
    await clearFailedAndPausedTasks()
    clearFailedConfirmOpen.value = false
    clearFailedTargetCount.value = 0
  } catch (error) {
    notificationService.error(error?.message || '清除失败/暂停任务时发生错误')
  } finally {
    clearingFailedTasks.value = false
  }
}

function syncSkillPanelPosition() {
  const trigger = skillTriggerRef.value
  if (!trigger || typeof window === 'undefined') return
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 280), Math.min(360, window.innerWidth - 16))
  const gap = 8
  const maxHeight = Math.min(420, Math.max(240, window.innerHeight - 24))
  let left = rect.left
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
  if (left < 8) left = 8
  const spaceAbove = rect.top - gap - 8
  const spaceBelow = window.innerHeight - rect.bottom - gap - 8
  const openUp = spaceAbove >= 220 || spaceAbove >= spaceBelow
  const height = Math.min(maxHeight, openUp ? spaceAbove : spaceBelow)
  skillPanelStyle.value = openUp
    ? {
        position: 'fixed',
        left: `${left}px`,
        width: `${width}px`,
        bottom: `${window.innerHeight - rect.top + gap}px`,
        top: 'auto',
        maxHeight: `${Math.max(200, height)}px`,
      }
    : {
        position: 'fixed',
        left: `${left}px`,
        width: `${width}px`,
        top: `${rect.bottom + gap}px`,
        bottom: 'auto',
        maxHeight: `${Math.max(200, height)}px`,
      }
}

function toggleSkillPanel() {
  skillPanelOpen.value = !skillPanelOpen.value
  if (skillPanelOpen.value) {
    nextTick(() => {
      syncSkillPanelPosition()
    })
  }
}

function closeMenus() {
  skillPanelOpen.value = false
  openParameterLayer.value = ''
  promptCategoryMoreOpen.value = false
}

function toggleParameterLayer(layer) {
  skillPanelOpen.value = false
  openParameterLayer.value = openParameterLayer.value === layer ? '' : layer
}

watch(skillPanelOpen, (open) => {
  if (typeof window === 'undefined') return
  if (open) {
    nextTick(syncSkillPanelPosition)
    window.addEventListener('resize', syncSkillPanelPosition)
    window.addEventListener('scroll', syncSkillPanelPosition, true)
  } else {
    window.removeEventListener('resize', syncSkillPanelPosition)
    window.removeEventListener('scroll', syncSkillPanelPosition, true)
  }
})

function compactRatioPreviewClass(value) {
  if (value === 'auto') return 'is-auto'
  const [width, height] = String(value || '')
    .split(':')
    .map(Number)
  if (width === height) return 'is-square'
  return width > height ? 'is-landscape' : 'is-portrait'
}

function compactRatioPreviewStyle(value) {
  const [width, height] = String(value || '')
    .split(':')
    .map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {}
  return { aspectRatio: `${width} / ${height}` }
}

function resetCustomSkillDraft() {
  customSkillName.value = ''
  customSkillPrompt.value = ''
  customSkillDescription.value = ''
}

function openCustomSkillDialog() {
  resetCustomSkillDraft()
  customSkillDialogOpen.value = true
}

function closeCustomSkillDialog() {
  customSkillDialogOpen.value = false
  resetCustomSkillDraft()
}

function submitCustomSkill() {
  const skill = addCustomSkill({
    name: customSkillName.value,
    prompt: customSkillPrompt.value,
    description: customSkillDescription.value,
  })
  if (!skill) return
  customSkillDialogOpen.value = false
  resetCustomSkillDraft()
  notificationService.success(`已添加 Skill：${skill.name}`)
}

function setMainTab(tab) {
  mainTab.value = tab
  closeMenus()
}
</script>

<template>
  <div
    ref="studioShellRef"
    class="t2i-page"
    :class="{ 'is-light': !appearanceStore.isDark }"
    @click="closeMenus"
  >
    <aside class="t2i-sidebar" aria-label="生成设置" @click.stop>
      <div class="t2i-model" data-motion>
        <div class="t2i-model-badge" :class="{ 'is-loading': isPageLoading }" aria-label="生成模型">
          <span class="t2i-model-icon"><i class="bi bi-stars"></i></span>
          <span v-if="isPageLoading" class="t2i-model-copy t2i-model-skeleton" aria-hidden="true">
            <span></span>
          </span>
          <AspectRatioSelect
            v-else
            v-model="selectedPublicModel"
            class="t2i-model-select"
            :options="modelSelectOptions"
            :show-ratio-icons="false"
            use-option-label
            compact-menu
            glass-menu
            menu-placement="bottom"
            aria-label="生成模型"
            :placeholder="currentPublicModel?.label || '选择生成模型'"
          />
        </div>
      </div>

      <div class="t2i-side-scroll">
        <div ref="promptBoxRef" class="t2i-prompt-box" data-motion>
          <textarea
            v-model="prompt"
            :maxlength="PROMPT_MAX"
            placeholder="描述主体、场景、光线与风格…"
            @paste="handlePromptPaste"
            @keydown.meta.enter.prevent="handleGenerate"
            @keydown.ctrl.enter.prevent="handleGenerate"
          ></textarea>
          <div class="t2i-prompt-foot">
            <div
              class="t2i-prompt-refs"
              aria-label="参考图片"
              @dragover.prevent
              @drop.prevent="handleReferenceDrop"
            >
              <figure v-for="item in referenceImages" :key="item.id" class="t2i-prompt-ref">
                <AuthenticatedImage :src="item.preview" :alt="item.label" :max-dimension="160" />
                <button type="button" title="移除参考图" @click="removeReferenceImage(item.id)">
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </figure>
              <button
                v-if="maxReferenceImages > 0 && referenceImages.length < maxReferenceImages"
                type="button"
                class="t2i-prompt-ref-add"
                aria-label="添加参考图"
                :title="`参考图：点击选择或拖入图片，最多 ${maxReferenceImages} 张`"
                @click="referenceInputRef?.click()"
              >
                <i class="bi bi-plus-lg" aria-hidden="true"></i>
              </button>
              <input
                ref="referenceInputRef"
                type="file"
                accept="image/*"
                multiple
                hidden
                @change="handleReferenceFileInput"
              />
            </div>
            <div class="t2i-prompt-tools">
              <button type="button" class="t2i-icon-btn" title="清空提示词" @click="clearPrompt">
                <i class="bi bi-trash"></i>
              </button>
            </div>
            <div class="t2i-skill-tools">
              <button
                ref="skillTriggerRef"
                type="button"
                class="t2i-skill-trigger"
                :class="{ 'is-open': skillPanelOpen, 'has-items': selectedSkills.length }"
                :aria-expanded="skillPanelOpen"
                @click.stop="toggleSkillPanel"
              >
                <i class="bi bi-lightning-charge" aria-hidden="true"></i>
                <span>Skills</span>
                <em>{{ selectedSkills.length }}</em>
                <i class="bi bi-chevron-down" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="t2i-control-layers" data-motion>
          <div class="t2i-control-layer-bar" aria-label="生成参数分类">
            <button
              type="button"
              :class="{ 'is-open': openParameterLayer === 'frame' }"
              :aria-expanded="openParameterLayer === 'frame'"
              @click.stop="toggleParameterLayer('frame')"
            >
              <i class="bi bi-aspect-ratio" aria-hidden="true"></i>
              <span class="t2i-layer-trigger-copy">
                <strong>画面</strong>
                <small>{{ frameParameterSummary }}</small>
              </span>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              :class="{ 'is-open': openParameterLayer === 'output' }"
              :aria-expanded="openParameterLayer === 'output'"
              :disabled="!hasOutputControls"
              :title="hasOutputControls ? '输出设置' : '当前模型不支持输出设置'"
              @click.stop="toggleParameterLayer('output')"
            >
              <i class="bi bi-file-earmark-image" aria-hidden="true"></i>
              <span class="t2i-layer-trigger-copy">
                <strong>输出</strong>
                <small>{{ outputParameterSummary }}</small>
              </span>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              :class="{ 'is-open': openParameterLayer === 'enhance' }"
              :aria-expanded="openParameterLayer === 'enhance'"
              @click.stop="toggleParameterLayer('enhance')"
            >
              <i class="bi bi-stars" aria-hidden="true"></i>
              <span class="t2i-layer-trigger-copy">
                <strong>增强</strong>
                <small>{{ enhanceParameterSummary }}</small>
              </span>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </button>
          </div>

          <Transition name="t2i-control-popover" mode="out-in">
            <section
              v-if="openParameterLayer === 'frame'"
              key="frame"
              class="t2i-control-layer-panel is-frame"
              aria-label="画面参数"
              @click.stop
            >
              <div v-if="aspectSelectOptions.length" class="t2i-compact-field is-ratio-field">
                <span>比例</span>
                <div class="t2i-compact-ratio-grid">
                  <button
                    v-for="option in aspectSelectOptions"
                    :key="option.value"
                    type="button"
                    :class="{ 'is-selected': aspectRatio === option.value }"
                    :aria-pressed="aspectRatio === option.value"
                    :title="option.label"
                    @click="aspectRatio = option.value"
                  >
                    <i
                      :class="compactRatioPreviewClass(option.value)"
                      :style="compactRatioPreviewStyle(option.value)"
                      aria-hidden="true"
                    ></i>
                    <small>{{ option.value === 'auto' ? '自动' : option.value }}</small>
                  </button>
                </div>
              </div>

              <div class="t2i-compact-field-row">
                <div v-if="resolutionSelectOptions.length" class="t2i-compact-field">
                  <span>分辨率</span>
                  <div class="t2i-compact-segments">
                    <button
                      v-for="option in resolutionSelectOptions"
                      :key="option.value"
                      type="button"
                      :class="{ 'is-selected': resolutionScale === option.value }"
                      :aria-pressed="resolutionScale === option.value"
                      @click="resolutionScale = option.value"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>

                <div v-if="qualitySelectOptions.length" class="t2i-compact-field">
                  <span>质量</span>
                  <div class="t2i-compact-segments">
                    <button
                      v-for="option in qualitySelectOptions"
                      :key="option.value"
                      type="button"
                      :class="{ 'is-selected': imageQuality === option.value }"
                      :aria-pressed="imageQuality === option.value"
                      @click="imageQuality = option.value"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="t2i-compact-field">
                <span>张数</span>
                <div class="t2i-compact-segments">
                  <button
                    v-for="option in T2I_COUNT_OPTIONS"
                    :key="option.value"
                    type="button"
                    :class="{ 'is-selected': imageCount === option.value }"
                    :aria-pressed="imageCount === option.value"
                    @click="imageCount = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </section>

            <section
              v-else-if="openParameterLayer === 'output' && hasOutputControls"
              key="output"
              class="t2i-control-layer-panel is-output"
              aria-label="输出参数"
              @click.stop
            >
              <div class="t2i-compact-field">
                <span>格式</span>
                <div v-if="effectiveOutputFormatOptions.length" class="t2i-compact-segments">
                  <button
                    v-for="option in effectiveOutputFormatOptions"
                    :key="option.value"
                    type="button"
                    :class="{ 'is-selected': effectiveOutputFormat === option.value }"
                    :aria-pressed="effectiveOutputFormat === option.value"
                    :disabled="transparentPngEnabled"
                    @click="effectiveOutputFormat = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>
                <div v-else class="t2i-compact-segments is-disabled">
                  <button type="button" disabled>当前模型不支持</button>
                </div>
              </div>

              <div class="t2i-compact-field">
                <span>内容审核</span>
                <div v-if="moderationSelectOptions.length" class="t2i-compact-segments">
                  <button
                    v-for="option in moderationSelectOptions"
                    :key="option.value"
                    type="button"
                    :class="{ 'is-selected': moderationLevel === option.value }"
                    :aria-pressed="moderationLevel === option.value"
                    @click="moderationLevel = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>
                <div v-else class="t2i-compact-segments is-disabled">
                  <button type="button" disabled>当前模型不支持</button>
                </div>
              </div>
            </section>

            <section
              v-else-if="openParameterLayer === 'enhance'"
              key="enhance"
              class="t2i-control-layer-panel is-enhance"
              aria-label="增强参数"
              @click.stop
            >
              <div class="t2i-prompt-enhancers" aria-label="提示词智能处理">
                <button
                  type="button"
                  class="t2i-prompt-toggle"
                  :class="{ 'is-on': promptPolishEnabled }"
                  role="switch"
                  :aria-checked="promptPolishEnabled"
                  title="AI 润色：生成前扩写画面细节，不修改输入框原文"
                  @click="promptPolishEnabled = !promptPolishEnabled"
                >
                  <span class="t2i-prompt-toggle-copy">
                    <i class="bi bi-stars" aria-hidden="true"></i>
                    润色
                  </span>
                  <span class="t2i-mini-switch" aria-hidden="true"><span></span></span>
                </button>
                <button
                  type="button"
                  class="t2i-prompt-toggle"
                  :class="{ 'is-on': autoTranslateEnabled }"
                  role="switch"
                  :aria-checked="autoTranslateEnabled"
                  title="自动翻译：生成前转换为自然英文，不修改输入框原文"
                  @click="autoTranslateEnabled = !autoTranslateEnabled"
                >
                  <span class="t2i-prompt-toggle-copy">
                    <i class="bi bi-translate" aria-hidden="true"></i>
                    翻译
                  </span>
                  <span class="t2i-mini-switch" aria-hidden="true"><span></span></span>
                </button>
                <button
                  type="button"
                  class="t2i-prompt-toggle"
                  :class="{ 'is-on': transparentPngEnabled }"
                  role="switch"
                  :aria-checked="transparentPngEnabled"
                  :disabled="outputType !== 'image' || !currentPublicModel?.transparentBackground"
                  :title="
                    currentPublicModel?.transparentBackground
                      ? '透明 PNG：要求真实 Alpha 并执行质量门'
                      : '当前模型不支持透明背景'
                  "
                  @click="transparentPngEnabled = !transparentPngEnabled"
                >
                  <span class="t2i-prompt-toggle-copy">
                    <i class="bi bi-transparency" aria-hidden="true"></i>
                    透明
                  </span>
                  <span class="t2i-mini-switch" aria-hidden="true"><span></span></span>
                </button>
              </div>
            </section>
          </Transition>
        </div>
      </div>

      <button
        type="button"
        class="t2i-generate"
        data-motion
        :disabled="!canCreateTask"
        @click="handleGenerate"
      >
        <span>{{ isRunning ? '再生成一张' : '立即生成' }}</span>
        <small v-if="generationCostLabel">{{ generationCostLabel }}</small>
        <i class="bi" :class="isRunning ? 'bi-plus-lg' : 'bi-stars'"></i>
      </button>
    </aside>

    <main ref="historyViewportRef" class="t2i-main" aria-label="创作结果">
      <header class="t2i-main-head" data-motion>
        <div class="t2i-center-tabs" role="tablist" aria-label="主视图切换">
          <button
            type="button"
            role="tab"
            :aria-selected="mainTab === 'prompts'"
            :class="{ 'is-active': mainTab === 'prompts' }"
            @click="setMainTab('prompts')"
          >
            提示词库
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mainTab === 'images'"
            :class="{ 'is-active': mainTab === 'images' }"
            @click="setMainTab('images')"
          >
            图片生成
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mainTab === 'history'"
            :class="{ 'is-active': mainTab === 'history' }"
            @click="setMainTab('history')"
          >
            历史记录
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mainTab === 'assets'"
            :class="{ 'is-active': mainTab === 'assets' }"
            @click="setMainTab('assets')"
          >
            我的资产
          </button>
        </div>
        <div class="t2i-main-status">
          <button
            v-if="mainTab === 'history' && failedOrPausedTaskCount"
            type="button"
            class="t2i-clear-failed"
            :disabled="clearingFailedTasks"
            @click="openClearFailedConfirm"
          >
            <i
              class="bi"
              :class="clearingFailedTasks ? 'bi-arrow-repeat spin' : 'bi-trash3'"
              aria-hidden="true"
            ></i>
            清除失败/暂停
            <em>{{ failedOrPausedTaskCount }}</em>
          </button>
          <span v-if="isPageLoading" class="t2i-status-skeleton" aria-label="数据加载中"></span>
          <span v-else-if="runningProgress">{{ runningProgress }}</span>
          <span v-else-if="mainTab === 'images'">{{
            completedImageCount ? `今日 ${completedImageCount} 张` : '今日暂无作品'
          }}</span>
          <span v-else-if="mainTab === 'history'">{{
            !isAuthenticated
              ? '登录后查看'
              : historyCount
                ? `今日 ${historyCount} 条`
                : '今日暂无记录'
          }}</span>
          <span v-else-if="mainTab === 'assets'">{{
            assetCount ? `${assetCount} 项资产` : '暂无资产'
          }}</span>
          <span v-else>{{ promptTotal ? `${promptTotal} 条提示词` : '暂无提示词' }}</span>
        </div>
      </header>

      <section v-if="mainTab === 'images'" class="t2i-panel t2i-panel--stage">
        <div class="t2i-stage-workspace" data-motion>
          <div
            v-if="isPageLoading"
            class="t2i-page-skeleton t2i-stage-page-skeleton"
            aria-label="作品加载中"
          >
            <div class="t2i-page-skeleton-canvas">
              <div class="t2i-page-skeleton-media" :style="featuredAspectStyle">
                <div class="t2i-skeleton-shine"></div>
              </div>
            </div>
            <div class="t2i-page-skeleton-bar">
              <div class="t2i-page-skeleton-copy">
                <div class="t2i-page-skeleton-line is-wide"></div>
                <div class="t2i-page-skeleton-line"></div>
              </div>
              <div class="t2i-page-skeleton-actions" aria-hidden="true">
                <span v-for="index in 4" :key="index"></span>
              </div>
            </div>
            <div class="t2i-page-skeleton-film">
              <span v-for="index in 16" :key="index"></span>
            </div>
          </div>
          <div v-else-if="!imageGallery.length" class="t2i-empty">
            <div class="t2i-empty-icon" aria-hidden="true">
              <i class="bi bi-image"></i>
            </div>
            <strong>今日还没有作品</strong>
            <span>点左侧「立即生成」，当天作品会显示在这里和底部栏。</span>
          </div>
          <div
            v-else-if="featuredItem"
            class="t2i-stage"
            :class="{ 'is-image-transitioning': stageSharedTransition }"
          >
            <div ref="stageCanvasRef" class="t2i-stage-canvas">
              <div ref="stageFrameRef" class="t2i-stage-frame" :style="featuredAspectStyle">
                <div
                  v-if="stageGridItems.length"
                  class="t2i-stage-grid"
                  :class="{ 'is-collage': stageGridLayout.collage }"
                  :style="{ '--t2i-grid-cols': stageGridLayout.cols }"
                  aria-label="同批次生成结果"
                >
                  <div
                    v-for="cell in stageGridItems"
                    :key="cell.key"
                    class="t2i-stage-cell"
                    :class="{
                      'is-pending': cell.kind === 'pending',
                      'is-regenerating': cell.kind !== 'pending' && isRegenerating(cell.task),
                    }"
                  >
                    <div
                      v-if="cell.kind === 'pending'"
                      class="t2i-stage-cell-pending"
                      role="status"
                      :aria-label="`第 ${cell.batchIndex + 1} 张，${pendingStageText(cell.task)}`"
                    >
                      <span class="t2i-pending-orb" aria-hidden="true">
                        <i class="bi bi-stars"></i>
                      </span>
                      <strong>第 {{ cell.batchIndex + 1 }} 张</strong>
                      <em class="t2i-pending-stage">{{ pendingStageText(cell.task) }}</em>
                      <span class="t2i-pending-bar" aria-hidden="true"><i></i></span>
                      <em class="t2i-pending-elapsed">{{ pendingElapsedText(cell.task) }}</em>
                    </div>
                    <template v-else>
                      <button
                        type="button"
                        class="t2i-stage-cell-media"
                        @click="openLightbox(cell.task, cell.index, $event)"
                      >
                        <ProgressiveAuthenticatedImage
                          :src="cell.url"
                          :preview-src="cell.thumbnailUrl"
                          load-original
                          hide-status
                          alt=""
                          loading="eager"
                          @error="markImageUnavailable(cell.task, cell.index, cell.url)"
                        />
                      </button>
                      <div
                        v-if="isRegenerating(cell.task)"
                        class="t2i-regenerate-overlay is-cell"
                        role="status"
                        aria-live="polite"
                        :aria-label="`重新生成中，${pendingStageText(cell.task)}`"
                      >
                        <span class="t2i-pending-orb" aria-hidden="true">
                          <i class="bi bi-arrow-repeat"></i>
                        </span>
                        <strong>重新生成中</strong>
                        <em class="t2i-pending-stage">{{ pendingStageText(cell.task) }}</em>
                        <span class="t2i-pending-bar" aria-hidden="true"><i></i></span>
                        <em class="t2i-pending-elapsed">{{ pendingElapsedText(cell.task) }}</em>
                        <button
                          type="button"
                          :disabled="actionBusyId === String(cell.task.id)"
                          @click.stop="handleCancelTask(cell.task)"
                        >
                          取消
                        </button>
                      </div>
                      <button
                        type="button"
                        class="t2i-stage-cell-delete"
                        :disabled="actionBusyId === String(cell.task.id) || isRegenerating(cell.task)"
                        aria-label="删除这张图片"
                        title="删除这张图片"
                        @click.stop="handleRemoveTask(cell.task)"
                      >
                        <i
                          v-if="actionBusyId === String(cell.task.id)"
                          class="bi bi-arrow-repeat spin"
                          aria-hidden="true"
                        ></i>
                        <span v-else class="t2i-icon-delete" aria-hidden="true"></span>
                      </button>
                      <div class="t2i-stage-quick-actions is-cell" aria-label="图片快捷操作">
                        <button
                          type="button"
                          aria-label="编辑图片"
                          title="编辑"
                          @click.stop="editTask(cell.task)"
                        >
                          <span class="t2i-icon-edit-image" aria-hidden="true"></span>
                        </button>
                        <button
                          type="button"
                          aria-label="重新生成"
                          title="重新生成"
                          :disabled="
                            actionBusyId === String(cell.task.id) ||
                            regeneratingTaskId === String(cell.task.id)
                          "
                          @click.stop="openRegenerateConfirm(cell.task)"
                        >
                          <span class="t2i-icon-regenerate" aria-hidden="true"></span>
                        </button>
                        <button
                          type="button"
                          aria-label="下载图片"
                          title="下载"
                          @click.stop="downloadTaskOutput(cell.task, cell.index)"
                        >
                          <span class="t2i-icon-download" aria-hidden="true"></span>
                        </button>
                        <button
                          type="button"
                          aria-label="设为参考图"
                          title="设为参考图"
                          @click.stop="useGeneratedAsReference(cell.task, cell.index)"
                        >
                          <span class="t2i-icon-reference" aria-hidden="true"></span>
                        </button>
                        <button
                          type="button"
                          :aria-label="shareStatusLabel(cell.task)"
                          :title="shareStatusLabel(cell.task)"
                          :disabled="
                            submittingShareId === String(cell.task.id) ||
                            cell.task.shareSubmitted ||
                            isLocalUpscaling(cell.task)
                          "
                          @click.stop="openPublish(cell)"
                        >
                          <i
                            v-if="submittingShareId === String(cell.task.id)"
                            class="bi bi-arrow-repeat spin"
                            aria-hidden="true"
                          ></i>
                          <i
                            v-else-if="cell.task.shareSubmitted"
                            class="bi bi-patch-check"
                            aria-hidden="true"
                          ></i>
                          <span v-else class="t2i-icon-publish" aria-hidden="true"></span>
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
                <div
                  v-else-if="featuredItem.kind === 'pending'"
                  class="t2i-stage-media is-skeleton"
                  role="status"
                  aria-live="polite"
                >
                  <div class="t2i-skeleton-shine"></div>
                  <div class="t2i-stage-pending">
                    <span class="t2i-pending-orb" aria-hidden="true">
                      <i class="bi bi-stars"></i>
                    </span>
                    <strong>正在生成</strong>
                    <em class="t2i-pending-stage">{{ pendingStageText(featuredItem.task) }}</em>
                    <span class="t2i-pending-bar" aria-hidden="true"><i></i></span>
                    <em class="t2i-pending-elapsed">{{ pendingElapsedText(featuredItem.task) }}</em>
                    <span class="t2i-pending-prompt">{{ featuredItem.title }}</span>
                  </div>
                </div>
                <button
                  v-else
                  type="button"
                  class="t2i-stage-media"
                  @click="openLightbox(featuredItem.task, featuredItem.index, $event)"
                >
                  <ProgressiveAuthenticatedImage
                    :src="featuredItem.url"
                    :preview-src="featuredItem.thumbnailUrl"
                    load-original
                    hide-status
                    alt=""
                    loading="eager"
                    @preview-load="markStageImageReady"
                    @load="handleFeaturedImageLoad(featuredItem, $event)"
                    @error="
                      markImageUnavailable(featuredItem.task, featuredItem.index, featuredItem.url)
                    "
                  />
                </button>
                <div
                  v-if="featuredItem.kind === 'image' && !stageGridItems.length"
                  class="t2i-stage-quick-actions"
                  aria-label="图片快捷操作"
                >
                  <button
                    type="button"
                    aria-label="编辑图片"
                    title="编辑"
                    @click.stop="editTask(featuredItem.task)"
                  >
                    <span class="t2i-icon-edit-image" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    aria-label="重新生成"
                    title="重新生成"
                    :disabled="
                      actionBusyId === String(featuredItem.task.id) ||
                      regeneratingTaskId === String(featuredItem.task.id)
                    "
                    @click.stop="openRegenerateConfirm(featuredItem.task)"
                  >
                    <span class="t2i-icon-regenerate" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    aria-label="下载图片"
                    title="下载"
                    @click.stop="downloadTaskOutput(featuredItem.task, featuredItem.index)"
                  >
                    <span class="t2i-icon-download" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    aria-label="设为参考图"
                    title="设为参考图"
                    @click.stop="useGeneratedAsReference(featuredItem.task, featuredItem.index)"
                  >
                    <span class="t2i-icon-reference" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    :aria-label="shareStatusLabel(featuredItem.task)"
                    :title="shareStatusLabel(featuredItem.task)"
                    :disabled="
                      submittingShareId === String(featuredItem.task.id) ||
                      featuredItem.task.shareSubmitted ||
                      isLocalUpscaling(featuredItem.task)
                    "
                    @click.stop="openPublish(featuredItem)"
                  >
                    <i
                      v-if="submittingShareId === String(featuredItem.task.id)"
                      class="bi bi-arrow-repeat spin"
                      aria-hidden="true"
                    ></i>
                    <i
                      v-else-if="featuredItem.task.shareSubmitted"
                      class="bi bi-patch-check"
                      aria-hidden="true"
                    ></i>
                    <span v-else class="t2i-icon-publish" aria-hidden="true"></span>
                  </button>
                </div>
                <div
                  v-if="
                    featuredItem.task &&
                    !stageGridItems.length &&
                    isRegenerating(featuredItem.task)
                  "
                  class="t2i-regenerate-overlay"
                  role="status"
                  aria-live="polite"
                  :aria-label="`正在重新生成，${pendingStageText(featuredItem.task)}`"
                >
                  <span class="t2i-pending-orb" aria-hidden="true">
                    <i class="bi bi-arrow-repeat"></i>
                  </span>
                  <strong>正在重新生成</strong>
                  <em class="t2i-pending-stage">{{ pendingStageText(featuredItem.task) }}</em>
                  <span class="t2i-pending-bar" aria-hidden="true"><i></i></span>
                  <em class="t2i-pending-elapsed">{{ pendingElapsedText(featuredItem.task) }}</em>
                  <button
                    type="button"
                    :disabled="actionBusyId === String(featuredItem.task.id)"
                    @click.stop="handleCancelTask(featuredItem.task)"
                  >
                    取消并恢复原图
                  </button>
                </div>
                <UpscaleProcessingOverlay
                  v-if="featuredItem.task && isLocalUpscaling(featuredItem.task)"
                  :task="featuredItem.task"
                  :cancelling="actionBusyId === String(featuredItem.task.id)"
                  @cancel="handleCancelTask(featuredItem.task)"
                />
              </div>
            </div>

            <div class="t2i-stage-bar">
              <div class="t2i-stage-copy">
                <strong :title="featuredItem.title">{{ featuredPromptSummary }}</strong>
                <small>{{
                  featuredItem.kind === 'pending'
                    ? `${pendingStageText(featuredItem.task)} · ${pendingElapsedText(featuredItem.task)}`
                    : isRegenerating(featuredItem.task)
                      ? `重新生成中 · ${pendingElapsedText(featuredItem.task)}`
                      : isLocalUpscaling(featuredItem.task)
                        ? featuredItem.task.localUpscaleMessage || statusTitle(featuredItem.task)
                        : taskMeta(featuredItem.task)
                }}</small>
              </div>
              <div class="t2i-image-actions">
                <template v-if="featuredItem.kind === 'image'">
                  <button
                    type="button"
                    class="is-icon"
                    aria-label="重新生成"
                    title="重新生成"
                    :disabled="isRegenerating(featuredItem.task)"
                    @click.stop="regenerateTask(featuredItem.task)"
                  >
                    <span class="t2i-icon-regenerate" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    class="is-danger is-icon"
                    aria-label="删除"
                    title="删除"
                    @click.stop="handleRemoveGroup(featuredGroup)"
                  >
                    <span class="t2i-icon-delete" aria-hidden="true"></span>
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    :disabled="actionBusyId === String(featuredItem.task.id)"
                    @click.stop="handleCancelTask(featuredItem.task)"
                  >
                    取消生成
                  </button>
                  <button
                    type="button"
                    class="is-primary"
                    :disabled="!canCreateTask"
                    @click.stop="handleGenerate"
                  >
                    生成下一张
                  </button>
                </template>
                <button
                  v-if="imageGallery.length > 1"
                  type="button"
                  class="t2i-nav-btn"
                  @click.stop="stepFeatured(-1)"
                >
                  上一张
                </button>
                <button
                  v-if="imageGallery.length > 1"
                  type="button"
                  class="t2i-nav-btn"
                  @click.stop="stepFeatured(1)"
                >
                  下一张
                </button>
              </div>
            </div>

			<div v-if="filmstripGroups.length > 1" class="t2i-filmstrip" aria-label="作品列表">
			  <button
				v-for="(group, groupIndex) in visibleFilmstripGroups"
                :key="group.key"
                type="button"
                class="t2i-film-item"
                :class="{
                  'is-on': group.key === featuredGroup?.key,
                  'is-pending': group.kind !== 'image',
                  'is-upscaling': isLocalUpscaling(group.cover.task),
                }"
                :title="
                  group.kind === 'pending'
                    ? '任务处理中'
                    : group.kind === 'mixed'
                      ? `已完成 ${group.items.length - group.pendingCount}/${group.items.length} 张`
                      : group.items.length > 1
                        ? '单击查看这组图片'
                        : '单击查看，双击设为参考图'
                "
                @click="focusGalleryItem(group.cover, $event)"
                @dblclick.stop="
                  group.kind === 'image' &&
                  group.items.length === 1 &&
                  useGeneratedAsReference(group.cover.task, group.cover.index)
                "
              >
                <span
                  v-if="group.kind === 'pending'"
                  class="t2i-film-pending"
                  role="status"
                  aria-label="任务处理中"
                >
                  <span class="t2i-film-pending-spinner" aria-hidden="true"></span>
                  <em>{{ formatTaskElapsed(group.cover.task) || '即将开始' }}</em>
                </span>
                <AuthenticatedImage
                  v-else
                  :src="group.cover.thumbnailUrl || group.cover.url"
                  alt=""
                  :loading="groupIndex < 12 ? 'eager' : 'lazy'"
                  root-margin="180px 240px"
                  :max-dimension="FILMSTRIP_THUMBNAIL_DIMENSION"
                  @error="
                    markImageUnavailable(group.cover.task, group.cover.index, group.cover.url)
                  "
                />
                <span v-if="isLocalUpscaling(group.cover.task)" class="t2i-film-upscale-progress">
                  {{ Math.round(Number(group.cover.task.localUpscaleProgress || 0)) }}%
                </span>
                <span v-if="group.items.length > 1" class="t2i-film-batch-index">
                  {{ group.items.length }} 张
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="mainTab === 'history'" class="t2i-panel t2i-panel--history">
        <div v-if="isPageLoading" class="t2i-history-skeleton" aria-label="历史记录加载中">
          <div v-for="column in 3" :key="column" class="t2i-history-skeleton-col">
            <article v-for="row in 3" :key="row" class="t2i-history-skeleton-card">
              <div class="t2i-skeleton-shine"></div>
            </article>
          </div>
        </div>
        <div v-else-if="!isAuthenticated" class="t2i-empty">
          <div class="t2i-empty-icon" aria-hidden="true">
            <i class="bi bi-person-lock"></i>
          </div>
          <strong>登录后查看历史记录</strong>
          <span>未登录不会保存生成历史，登录后可同步并浏览云端作品。</span>
          <RouterLink class="t2i-empty-link" :to="{ name: 'auth', query: { mode: 'login' } }"
            >去登录</RouterLink
          >
        </div>
        <div v-else-if="!historyFeedItems.length" class="t2i-empty">
          <div class="t2i-empty-icon" aria-hidden="true">
            <i class="bi bi-clock-history"></i>
          </div>
          <strong>今日还没有历史记录</strong>
          <span>历史记录仅展示当天作品，提交生成后会显示在这里。</span>
        </div>
        <div v-else class="t2i-masonry-wrap">
          <div class="t2i-masonry" :style="{ '--t2i-masonry-cols': historyColumnCount }">
            <div
              v-for="(column, columnIndex) in historyMasonryColumns"
              :key="`history-col-${columnIndex}`"
              class="t2i-masonry-col"
            >
              <article
                v-for="item in column"
                :key="item.key"
                class="t2i-masonry-card t2i-history-card"
                :class="{ 'is-active': item.task.id === activeTaskId }"
                :data-status="item.task.status"
              >
                <button
                  v-if="item.kind === 'image'"
                  type="button"
                  class="t2i-masonry-cover"
                  :style="{ aspectRatio: item.aspect }"
                  @click="openLightbox(item.task, item.index, $event)"
                >
                  <ProgressiveAuthenticatedImage
                    :src="item.url"
                    :preview-src="item.thumbnailUrl"
                    alt=""
                    loading="lazy"
                    root-margin="180px 0px"
                    @load="measureHistoryImage(item, $event)"
                  />
                  <UpscaleProcessingOverlay
                    v-if="isLocalUpscaling(item.task)"
                    :task="item.task"
                    compact
                  />
                  <span v-if="item.total > 1" class="t2i-history-batch-index">
                    {{ Number(item.batchIndex ?? item.index) + 1 }}/{{ item.total }}
                  </span>
                  <span class="t2i-history-image-overlay">
                    <span v-if="isDone(item.task)" class="t2i-history-image-prompt">
                      {{ taskPrompt(item.task) }}
                    </span>
                    <span class="t2i-history-image-specs">
                      <span>
                        <i class="bi bi-aspect-ratio" aria-hidden="true"></i>
                        {{ historyImageResolution(item) }}
                      </span>
                      <span>
                        <i class="bi bi-hdd" aria-hidden="true"></i>
                        {{ historyImageFileSize(item) }}
                      </span>
                    </span>
                  </span>
                </button>
                <div
                  v-else
                  class="t2i-masonry-cover t2i-masonry-placeholder"
                  :style="{ aspectRatio: item.aspect }"
                  :data-status="item.task.status"
                >
                  <i
                    class="bi"
                    :class="
                      isBusy(item.task)
                        ? 'bi-arrow-repeat spin'
                        : isFailed(item.task) || isPaused(item.task)
                          ? 'bi-exclamation-triangle'
                          : 'bi-image'
                    "
                  ></i>
                  <span>{{ statusTitle(item.task) }}</span>
                </div>

                <div v-if="item.kind !== 'image'" class="t2i-masonry-body">
                  <small v-if="friendlyError(item.task)" class="t2i-history-error">{{
                    friendlyError(item.task)
                  }}</small>
                  <div
                    v-if="isBusy(item.task) || isLocalUpscaling(item.task)"
                    class="t2i-entry-progress"
                  >
                    <div class="t2i-progress" aria-hidden="true"></div>
                    <span>
                      {{
                        isLocalUpscaling(item.task)
                          ? item.task.localUpscaleMessage ||
                            `正在本地生成 ${item.task.localUpscaleTarget || '高清'} · ${Math.round(Number(item.task.localUpscaleProgress || 0))}%`
                          : '正在云端处理…'
                      }}
                    </span>
                  </div>
                </div>

                <footer class="t2i-entry-actions t2i-history-actions">
                  <button
                    v-if="item.kind === 'image'"
                    type="button"
                    aria-label="设为参考图"
                    title="设为参考图"
                    @click.stop="useGeneratedAsReference(item.task, item.index)"
                  >
                    <span class="t2i-icon-reference" aria-hidden="true"></span>
                  </button>
                  <button
                    v-if="item.kind === 'image'"
                    type="button"
                    class="is-share"
                    :aria-label="shareStatusLabel(item.task)"
                    :title="shareStatusLabel(item.task)"
                    :disabled="
                      submittingShareId === String(item.task.id) ||
                      item.task.shareSubmitted ||
                      isLocalUpscaling(item.task)
                    "
                    @click.stop="openPublish(item)"
                  >
                    <i
                      v-if="submittingShareId === String(item.task.id)"
                      class="bi bi-arrow-repeat spin"
                      aria-hidden="true"
                    ></i>
                    <i
                      v-else-if="item.task.shareSubmitted"
                      class="bi bi-patch-check"
                      aria-hidden="true"
                    ></i>
                    <span v-else class="t2i-icon-publish" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    aria-label="编辑任务"
                    title="编辑"
                    :disabled="actionBusyId === String(item.task.id)"
                    @click.stop="editTask(item.task)"
                  >
                    <span class="t2i-icon-edit-image" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    aria-label="重新生成"
                    title="重新生成"
                    :disabled="actionBusyId === String(item.task.id)"
                    @click.stop="regenerateTask(item.task)"
                  >
                    <span class="t2i-icon-regenerate" aria-hidden="true"></span>
                  </button>
                  <button
                    v-if="canCancel(item.task)"
                    type="button"
                    aria-label="取消任务"
                    title="取消"
                    :disabled="actionBusyId === String(item.task.id)"
                    @click.stop="handleCancelTask(item.task)"
                  >
                    <i class="bi bi-stop-circle" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="is-danger"
                    aria-label="删除任务"
                    title="删除"
                    :disabled="actionBusyId === String(item.task.id)"
                    @click.stop="handleRemoveTask(item.task)"
                  >
                    <span class="t2i-icon-delete" aria-hidden="true"></span>
                  </button>
                </footer>
              </article>
            </div>
          </div>

          <div
            v-if="historyHasMore"
            ref="historySentinelRef"
            class="t2i-masonry-sentinel"
            aria-hidden="true"
          ></div>
          <p v-if="serverJobsLoadingMore" class="t2i-feed-loading">
            <i class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
            正在加载更多历史记录…
          </p>
          <button
            v-else-if="historyHasMore"
            type="button"
            class="t2i-feed-more"
            @click="loadMoreHistory"
          >
            加载更多
          </button>
          <p v-else-if="!historyHasMore" class="t2i-feed-end">今日记录已全部加载</p>
        </div>
      </section>

      <section
        v-else-if="mainTab === 'prompts'"
        ref="promptViewportRef"
        class="t2i-panel t2i-library-view"
      >
        <div class="t2i-masonry-wrap">
          <div class="t2i-library-toolbar">
            <nav class="t2i-library-categories" aria-label="提示词分类" @click.stop>
              <button
                v-for="category in promptCategoryPrimaryOptions"
                :key="category.value"
                type="button"
                :class="{ 'is-active': promptCategoryFilter === category.value }"
                @click="selectPromptCategory(category.value)"
              >
                {{ category.label }}
              </button>
              <div class="t2i-library-more">
                <button
                  type="button"
                  class="t2i-library-more-trigger"
                  :class="{
                    'is-active': promptCategoryMoreActive,
                    'is-open': promptCategoryMoreOpen,
                  }"
                  :aria-expanded="promptCategoryMoreOpen"
                  aria-haspopup="listbox"
                  @click.stop="togglePromptCategoryMore"
                >
                  <span>{{ promptCategoryMoreLabel }}</span>
                  <i class="bi bi-chevron-down" aria-hidden="true"></i>
                </button>
                <Transition name="t2i-library-more">
                  <div
                    v-if="promptCategoryMoreOpen"
                    class="t2i-library-more-menu"
                    role="listbox"
                    aria-label="更多分类"
                    @click.stop
                  >
                    <button
                      v-for="category in promptCategoryMoreOptions"
                      :key="category.value"
                      type="button"
                      role="option"
                      :aria-selected="promptCategoryFilter === category.value"
                      :class="{ 'is-active': promptCategoryFilter === category.value }"
                      @click="selectPromptCategory(category.value)"
                    >
                      {{ category.label }}
                    </button>
                  </div>
                </Transition>
              </div>
            </nav>
            <label v-if="promptCategoryFilter !== 'today'" class="t2i-library-sort">
              <i class="bi bi-sort-down" aria-hidden="true"></i>
              <select v-model="promptSort" aria-label="提示词排序">
                <option value="recommended">智能推荐</option>
                <option value="favorites">收藏最多</option>
                <option value="likes">点赞最多</option>
                <option value="usage">使用最多</option>
              </select>
            </label>
          </div>

          <div
            v-if="promptLibraryLoading && !promptLibraryFeedItems.length"
            class="t2i-history-skeleton"
            aria-label="提示词库加载中"
          >
            <div v-for="column in 3" :key="column" class="t2i-history-skeleton-col">
              <article v-for="row in 3" :key="row" class="t2i-history-skeleton-card">
                <div class="t2i-skeleton-shine"></div>
              </article>
            </div>
          </div>

          <div v-else-if="!promptLibraryFeedItems.length" class="t2i-empty t2i-collection-empty">
            <div class="t2i-empty-icon"><i class="bi bi-filter"></i></div>
            <strong>{{ promptLibraryEmptyTitle }}</strong>
            <span>{{ promptLibraryEmptyDescription }}</span>
          </div>

          <div v-else class="t2i-masonry" :style="{ '--t2i-masonry-cols': libraryColumnCount }">
            <div
              v-for="(column, columnIndex) in promptLibraryMasonryColumns"
              :key="`prompt-col-${columnIndex}`"
              class="t2i-masonry-col"
            >
              <article
                v-for="entry in column"
                :key="entry.key"
                class="t2i-masonry-card t2i-collection-card"
              >
                <button
                  type="button"
                  class="t2i-masonry-cover"
                  :class="{ 't2i-masonry-placeholder': !entry.item.imageUrl }"
                  :style="{ aspectRatio: entry.aspect }"
                  @click="usePromptLibraryEntry(entry.item)"
                >
                  <AuthenticatedImage
                    v-if="entry.item.imageUrl"
                    :src="entry.item.imageUrl"
                    :alt="entry.item.label"
                    loading="lazy"
                    :max-dimension="HISTORY_THUMBNAIL_DIMENSION"
                    @load="measurePromptLibraryImage(entry, $event)"
                  />
                  <span v-else class="t2i-collection-placeholder">
                    <i class="bi bi-stars"></i>
                    <small>点击使用提示词</small>
                  </span>
                  <span class="t2i-history-image-overlay">
                    <span class="t2i-history-image-prompt">{{ entry.item.prompt }}</span>
                    <span class="t2i-history-image-specs">
                      <span
                        ><i class="bi bi-grid" aria-hidden="true"></i
                        >{{ promptCategoryLabel(entry.item.categoryKey) }}</span
                      >
                      <span v-if="entry.item.tags?.length"
                        ><i class="bi bi-tags" aria-hidden="true"></i
                        >{{ entry.item.tags.slice(0, 2).join(' · ') }}</span
                      >
                    </span>
                  </span>
                </button>
                <div class="t2i-masonry-body">
                  <header class="t2i-history-meta">
                    <strong>{{ entry.item.label }}</strong>
                    <small
                      >{{ promptCategoryLabel(entry.item.categoryKey) }} · 使用
                      {{ entry.item.useCount || 0 }} 次</small
                    >
                  </header>
                </div>
                <footer class="t2i-entry-actions">
                  <button
                    type="button"
                    :class="{ 'is-active': entry.item.liked }"
                    @click="togglePromptEngagement(entry.item, 'like')"
                  >
                    <i
                      :class="
                        entry.item.liked ? 'bi bi-hand-thumbs-up-fill' : 'bi bi-hand-thumbs-up'
                      "
                    ></i>
                    {{ entry.item.likeCount || 0 }}
                  </button>
                  <button
                    type="button"
                    :class="{ 'is-active': entry.item.favorited }"
                    @click="togglePromptEngagement(entry.item, 'favorite')"
                  >
                    <i :class="entry.item.favorited ? 'bi bi-heart-fill' : 'bi bi-heart'"></i>
                    {{ entry.item.favoriteCount || 0 }}
                  </button>
                  <button type="button" @click="usePromptLibraryEntry(entry.item)">
                    <i class="bi bi-magic" aria-hidden="true"></i>
                    使用提示词
                  </button>
                </footer>
              </article>
            </div>
          </div>
          <div
            v-if="promptHasMore"
            ref="promptSentinelRef"
            class="t2i-masonry-sentinel"
            aria-hidden="true"
          ></div>
          <p v-if="promptLibraryLoadingMore" class="t2i-feed-loading">
            <i class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
            正在加载更多提示词…
          </p>
          <p v-else-if="promptLibraryFeedItems.length && !promptHasMore" class="t2i-feed-end">
            没有更多数据了
          </p>
        </div>
      </section>

      <section v-else class="t2i-panel t2i-assets-view">
        <div v-if="assetsLoading" class="t2i-history-skeleton" aria-label="我的资产加载中">
          <div v-for="column in 3" :key="column" class="t2i-history-skeleton-col">
            <article v-for="row in 3" :key="row" class="t2i-history-skeleton-card">
              <div class="t2i-skeleton-shine"></div>
            </article>
          </div>
        </div>
        <div v-else-if="!myAssets.length" class="t2i-empty">
          <div class="t2i-empty-icon"><i class="bi bi-collection"></i></div>
          <strong>还没有已发布资产</strong>
          <span>从历史记录发布作品后，投稿与审核状态会集中显示在这里。</span>
        </div>
        <div v-else class="t2i-masonry-wrap">
          <div class="t2i-masonry" :style="{ '--t2i-masonry-cols': assetColumnCount }">
            <div
              v-for="(column, columnIndex) in assetMasonryColumns"
              :key="`asset-col-${columnIndex}`"
              class="t2i-masonry-col"
            >
              <article
                v-for="entry in column"
                :key="entry.key"
                class="t2i-masonry-card t2i-collection-card"
              >
                <button
                  v-if="!failedAssetIds[entry.asset.id]"
                  type="button"
                  class="t2i-masonry-cover"
                  :style="{ aspectRatio: entry.aspect }"
                  @click="openAsset(entry.asset, $event)"
                >
                  <AuthenticatedImage
                    :src="entry.asset.coverUrl || entry.asset.resultUrl"
                    :alt="entry.asset.title"
                    loading="lazy"
                    :max-dimension="HISTORY_THUMBNAIL_DIMENSION"
                    @load="measureAssetImage(entry, $event)"
                    @error="markAssetUnavailable(entry.asset)"
                  />
                  <span class="t2i-asset-status" :data-status="entry.asset.status">
                    {{
                      entry.asset.status === 'approved'
                        ? '已发布'
                        : entry.asset.status === 'rejected'
                          ? '未通过'
                          : '审核中'
                    }}
                  </span>
                  <span class="t2i-history-image-overlay">
                    <span class="t2i-history-image-prompt">{{ entry.asset.title }}</span>
                    <span class="t2i-history-image-specs">
                      <span
                        ><i class="bi bi-aspect-ratio" aria-hidden="true"></i
                        >{{ collectionImageResolution(entry) }}</span
                      >
                      <span
                        ><i class="bi bi-hdd" aria-hidden="true"></i
                        >{{ collectionImageFileSize(entry) }}</span
                      >
                    </span>
                  </span>
                </button>
                <button
                  v-else
                  type="button"
                  class="t2i-masonry-cover t2i-masonry-placeholder t2i-asset-unavailable"
                  :style="{ aspectRatio: entry.aspect }"
                  @click="retryAssetImage(entry.asset)"
                >
                  <i class="bi bi-arrow-clockwise"></i>
                  <span>图片暂时无法读取，点击重试</span>
                </button>
                <footer class="t2i-entry-actions">
                  <button type="button" @click="useGeneratedAsReference(entry.task, 0)">
                    参考图
                  </button>
                </footer>
              </article>
            </div>
          </div>
          <div
            v-if="assetsHasMore"
            ref="assetSentinelRef"
            class="t2i-masonry-sentinel"
            aria-hidden="true"
          ></div>
          <p v-if="assetsLoadingMore" class="t2i-feed-loading">
            <i class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
            正在加载更多资产…
          </p>
          <p v-else-if="myAssets.length && !assetsHasMore" class="t2i-feed-end">没有更多数据了</p>
        </div>
      </section>
    </main>

    <Teleport to="body">
      <Transition name="t2i-skill-popover">
        <section
          v-if="skillPanelOpen"
          class="t2i-skill-panel is-floating"
          :class="{ 'is-light': !appearanceStore.isDark }"
          :style="skillPanelStyle"
          aria-label="生成 Skills"
          @click.stop
        >
          <header>
            <div>
              <strong>生成 Skills</strong>
              <small>仅将已选择的 Skill 注入当前任务</small>
            </div>
            <button type="button" title="关闭 Skills" @click="skillPanelOpen = false">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </header>
          <div class="t2i-skill-list">
            <label v-for="skill in skillOptions" :key="skill.id" class="t2i-skill-item">
              <input
                type="checkbox"
                :checked="selectedSkillIds.includes(skill.id)"
                @change="toggleSkill(skill.id)"
              />
              <span class="t2i-skill-item-copy">
                <strong>{{ skill.name }}</strong>
                <small>{{ skill.description }}</small>
              </span>
              <button
                v-if="skill.custom"
                type="button"
                class="t2i-skill-remove"
                title="删除自定义 Skill"
                @click.prevent="removeCustomSkill(skill.id)"
              >
                <i class="bi bi-trash3" aria-hidden="true"></i>
              </button>
            </label>
          </div>
          <button type="button" class="t2i-skill-create" @click="openCustomSkillDialog">
            <span>
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
              <strong>添加 Skill</strong>
            </span>
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </section>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="t2i-skill-dialog">
        <div
          v-if="customSkillDialogOpen"
          class="t2i-skill-dialog-backdrop"
          :class="{ 'is-light': !appearanceStore.isDark }"
          @click.self="closeCustomSkillDialog"
        >
          <section
            class="t2i-skill-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="t2i-skill-dialog-title"
            @click.stop
          >
            <header>
              <div class="t2i-skill-dialog-heading">
                <span aria-hidden="true"><i class="bi bi-lightning-charge"></i></span>
                <div>
                  <small>CUSTOM SKILL</small>
                  <h2 id="t2i-skill-dialog-title">添加 Skill</h2>
                </div>
              </div>
              <button type="button" aria-label="关闭添加 Skill" @click="closeCustomSkillDialog">
                <i class="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            </header>

            <form class="t2i-skill-dialog-form" @submit.prevent="submitCustomSkill">
              <label>
                <span>
                  <strong>名称</strong>
                  <small>{{ customSkillName.length }} / 80</small>
                </span>
                <input
                  v-model="customSkillName"
                  type="text"
                  maxlength="80"
                  autocomplete="off"
                  autofocus
                  placeholder="例如：品牌视觉守卫"
                />
              </label>

              <label>
                <span>
                  <strong>简介</strong>
                  <small>可选 · {{ customSkillDescription.length }} / 180</small>
                </span>
                <input
                  v-model="customSkillDescription"
                  type="text"
                  maxlength="180"
                  autocomplete="off"
                  placeholder="一句话说明这个 Skill 的用途"
                />
              </label>

              <label>
                <span>
                  <strong>Skill 指令</strong>
                  <small>{{ customSkillPrompt.length }} / 12000</small>
                </span>
                <textarea
                  v-model="customSkillPrompt"
                  maxlength="12000"
                  rows="6"
                  placeholder="例如：保持商品 Logo、品牌色和主体构图不变，仅优化材质与光线…"
                ></textarea>
              </label>

              <footer>
                <button type="button" class="is-secondary" @click="closeCustomSkillDialog">
                  取消
                </button>
                <button
                  type="submit"
                  class="is-primary"
                  :disabled="!customSkillName.trim() || !customSkillPrompt.trim()"
                >
                  <i class="bi bi-plus-lg" aria-hidden="true"></i>
                  添加 Skill
                </button>
              </footer>
            </form>
          </section>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="lightboxOpen"
        class="t2i-lightbox"
        :class="{
          'is-flip-open': lightboxFlipping,
          'is-closing': lightboxClosing,
          'is-plain-open': lightboxPlainOpen,
          'is-chrome-hidden': !lightboxChromeVisible,
        }"
        role="dialog"
        aria-modal="true"
        aria-label="全屏预览"
        @click.self="closeLightbox"
        @mousemove="wakeLightboxChrome"
        @touchstart.passive="wakeLightboxChrome"
      >
        <div class="t2i-lightbox-stage">
          <div
            ref="lightboxFrameRef"
            class="t2i-lightbox-frame"
            :class="{
              'is-zoomed': lightboxZoom > 1,
              'is-panning': lightboxPanning,
              'is-comparing': lightboxCompareDragging,
            }"
            @wheel.prevent="handleLightboxWheel"
            @dblclick.prevent="toggleLightboxZoom"
            @pointerdown="startLightboxPan"
            @pointermove="moveLightboxPan"
            @pointerup="endLightboxPan"
            @pointercancel="endLightboxPan"
          >
            <div class="t2i-lightbox-image-layer" :style="lightboxImageStyle">
              <ProgressiveAuthenticatedImage
                :src="lightboxUrl"
                :preview-src="lightboxPreviewUrl"
                load-original
                hide-status
                alt=""
                class="is-processed"
                loading="eager"
                draggable="false"
                @load="handleLightboxImageLoad"
                @error="handleLightboxImageError"
                @original-error="lightboxImageLoading = false"
                @dragstart.prevent
              />
            </div>
            <div
              v-if="lightboxCompareEnabled && lightboxOriginalUrl"
              class="t2i-lightbox-original-clip"
              :style="lightboxOriginalClipStyle"
            >
              <div class="t2i-lightbox-image-layer" :style="lightboxImageStyle">
                <AuthenticatedImage
                  :src="lightboxOriginalUrl"
                  alt=""
                  class="is-original"
                  loading="eager"
                  draggable="false"
                  @error="handleLightboxOriginalImageError"
                  @dragstart.prevent
                />
              </div>
            </div>
            <template v-if="lightboxCompareEnabled && lightboxCanCompare">
              <span class="t2i-lightbox-compare-badge is-original">{{
                lightboxOriginalLabel
              }}</span>
              <span class="t2i-lightbox-compare-badge is-processed">{{
                lightboxProcessedLabel
              }}</span>
              <button
                type="button"
                class="t2i-lightbox-compare-divider"
                :style="lightboxCompareDividerStyle"
                role="slider"
                aria-label="拖动比较原图与处理后图片"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="Math.round(lightboxComparePosition)"
                @pointerdown="startLightboxCompareDrag"
                @pointermove="moveLightboxCompareDrag"
                @pointerup="endLightboxCompareDrag"
                @pointercancel="endLightboxCompareDrag"
                @keydown.left.prevent="nudgeLightboxCompare(-2)"
                @keydown.right.prevent="nudgeLightboxCompare(2)"
              >
                <i class="bi bi-arrows"></i>
              </button>
            </template>
          </div>
        </div>

        <UpscaleProcessingOverlay
          v-if="lightboxLiveTask && isLocalUpscaling(lightboxLiveTask)"
          :task="lightboxLiveTask"
          fullscreen
          :cancelling="actionBusyId === String(lightboxLiveTask.id)"
          @cancel="handleCancelTask(lightboxLiveTask)"
        />

        <template v-if="lightboxGalleryItems.length > 1">
          <button
            type="button"
            class="t2i-lightbox-hotzone is-prev"
            aria-label="上一张"
            title="上一张"
            @click.stop="stepLightbox(-1)"
          >
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="t2i-lightbox-hotzone is-next"
            aria-label="下一张"
            title="下一张"
            @click.stop="stepLightbox(1)"
          >
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </template>

        <div
          class="t2i-lightbox-load-chip"
          :class="{ 'is-visible': lightboxImageLoading }"
          aria-hidden="true"
        >
          <span class="t2i-lightbox-load-chip-dot"></span>
          <span>图片加载中</span>
        </div>

        <div class="t2i-lightbox-controls" aria-label="预览操作" @click.stop>
          <div class="t2i-lightbox-controls-info">
            <strong
              class="t2i-lightbox-controls-title"
              :title="lightboxTask ? taskPrompt(lightboxTask) : ''"
            >
              {{ (lightboxTask && taskPrompt(lightboxTask)) || '图片预览' }}
            </strong>
            <span v-if="lightboxPositionLabel" class="t2i-lightbox-controls-count">{{
              lightboxPositionLabel
            }}</span>
            <span v-if="lightboxProcessedLabel" class="t2i-lightbox-controls-size">{{
              lightboxProcessedLabel
            }}</span>
          </div>
          <div v-if="lightboxGalleryItems.length > 1" class="t2i-lightbox-controls-nav">
            <button type="button" aria-label="上一张" title="上一张" @click="stepLightbox(-1)">
              <i class="bi bi-chevron-left" aria-hidden="true"></i>
            </button>
            <button type="button" aria-label="下一张" title="下一张" @click="stepLightbox(1)">
              <i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
          </div>
          <div class="t2i-lightbox-controls-tools">
            <button
              type="button"
              :disabled="lightboxZoom <= LIGHTBOX_MIN_ZOOM"
              aria-label="缩小图片"
              @click="zoomLightbox(-LIGHTBOX_ZOOM_STEP)"
            >
              <i class="bi bi-zoom-out" aria-hidden="true"></i>
            </button>
            <output class="t2i-lightbox-controls-zoom">{{ lightboxZoomLabel }}</output>
            <button
              type="button"
              :disabled="lightboxZoom >= LIGHTBOX_MAX_ZOOM"
              aria-label="放大图片"
              @click="zoomLightbox(LIGHTBOX_ZOOM_STEP)"
            >
              <i class="bi bi-zoom-in" aria-hidden="true"></i>
            </button>
            <button type="button" class="is-fit" aria-label="适应屏幕" @click="resetLightboxView">
              <i class="bi bi-arrows-angle-contract" aria-hidden="true"></i>
              <span>适应</span>
            </button>
            <button
              v-if="lightboxCanCompare"
              type="button"
              :class="{ 'is-on': lightboxCompareEnabled }"
              :aria-pressed="lightboxCompareEnabled"
              aria-label="对比原图和处理后图片"
              :title="lightboxCompareEnabled ? '退出前后对比' : '前后对比'"
              @click="toggleLightboxCompare"
            >
              <i class="bi bi-layout-split" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              aria-label="局部编辑图片"
              title="局部编辑"
              @pointerenter="prefetchLocalMaskEditor"
              @focus="prefetchLocalMaskEditor"
              @click="openLocalMaskEditor"
            >
              <i class="bi bi-brush" aria-hidden="true"></i>
            </button>
            <button type="button" aria-label="下载图片" title="下载" @click="downloadLightbox">
              <span class="t2i-icon-download" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="is-danger"
              aria-label="删除图片"
              title="删除"
              @click="handleRemoveTask(lightboxTask)"
            >
              <span class="t2i-icon-delete" aria-hidden="true"></span>
            </button>
            <span class="t2i-lightbox-controls-divider" aria-hidden="true"></span>
            <button type="button" aria-label="关闭预览" title="关闭" @click="closeLightbox">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <LocalMaskEditorDialog
      v-if="localMaskEditorMounted"
      :open="localMaskEditorOpen"
      :source-url="localMaskEditorUrl"
      :source-title="localMaskEditorTask ? taskPrompt(localMaskEditorTask) : ''"
      :busy="localMaskEditorBusy"
      @close="closeLocalMaskEditor"
      @submit="submitLocalMaskEdit"
    />

    <SharePublishDialog
      :open="publishOpen"
      :title="publishDialogTitle"
      :style-label="publishDialogStyleLabel"
      :submitting="Boolean(publishTarget && submittingShareId)"
      :light="!appearanceStore.isDark"
      @close="closePublishDialog"
      @submit="submitHistoryToShare"
    />

    <DeleteHistoryConfirmDialog
      :open="deleteConfirmOpen"
      :title="deleteConfirmTitle"
      :heading="deleteConfirmHeading"
      :description="deleteConfirmDescription"
      :confirm-label="deleteConfirmLabel"
      :busy-label="deleteBusyLabel"
      :busy="Boolean(deleteRequest && actionBusyId)"
      @close="closeDeleteConfirm"
      @confirm="confirmRemoveTask"
    />

    <DeleteHistoryConfirmDialog
      :open="regenerateConfirmOpen"
      heading="重新生成这张图片？"
      description="确认后将在当前图片上加载并重新生成；成功后覆盖原图，失败则自动恢复原图。"
      confirm-label="重新生成"
      busy-label="提交中…"
      icon="bi-arrow-clockwise"
      tone="accent"
      :busy="Boolean(regeneratingTaskId)"
      @close="closeRegenerateConfirm"
      @confirm="confirmRegenerateTask"
    />

    <DeleteHistoryConfirmDialog
      :open="clearFailedConfirmOpen"
      heading="清除全部失败/暂停任务？"
      :description="`将同时清理 ${clearFailedTargetCount} 个失败或暂停任务的云端记录和本地历史；已完成及已取消任务不会受到影响。暂停任务会先取消，再执行删除。`"
      confirm-label="全部清除"
      busy-label="清除中…"
      :busy="clearingFailedTasks"
      @close="closeClearFailedConfirm"
      @confirm="confirmClearFailedTasks"
    />

    <AiCostConfirmDialog
      :show="costConfirmVisible"
      :cost="costConfirmPayload"
      @confirm="confirmCostAndCreate"
      @cancel="cancelCostConfirm"
    />
    <InsufficientCreditsDialog
      :show="creditsDialogOpen"
      :required="requiredCredits"
      :available="availableCredits"
      @close="closeCreditsDialog"
    />
  </div>
</template>
