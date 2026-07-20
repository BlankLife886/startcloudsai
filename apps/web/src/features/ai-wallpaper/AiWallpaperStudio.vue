<script setup>
import AiCostConfirmDialog from '@/features/ai-shared/AiCostConfirmDialog.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import SharePublishDialog from '@/features/share/components/SharePublishDialog.vue'
import AspectRatioSelect from './components/AspectRatioSelect.vue'
import DeleteHistoryConfirmDialog from './components/DeleteHistoryConfirmDialog.vue'
import UpscaleProcessingOverlay from './components/UpscaleProcessingOverlay.vue'
import '@/features/ai-wallpaper/styles/t2i-page.css'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAiWallpaperStudioState } from './composables/useAiWallpaperStudioState'
import {
  T2I_ASPECT_OPTIONS,
  T2I_COUNT_OPTIONS,
  T2I_OUTPUT_FORMAT_OPTIONS,
  T2I_PROMPT_LIBRARY,
  T2I_QUALITY_OPTIONS,
  T2I_RESOLUTION_OPTIONS,
} from './composables/wallpaperStudioConstants'
import notificationService from '@/services/notification'
import { listMyShareAssets, submitShareItem } from '@/services/shareGallery'
import { listPromptLibrary } from '@/services/promptLibrary'
import { getAuthenticatedMediaMetadata } from '@/services/authenticatedMedia'
import {
  normalizeVisibleDisplayPositions,
  uniqueTaskOutputs,
} from '@/features/ai-wallpaper/domain/galleryDisplay'
import { formatOutputSize } from '@/features/ai-wallpaper/domain/outputSizeMetadata'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import {
  createServerAiUpscaleExperiment,
  listCloudUpscaleProviders,
  listServerAiUpscaleExperiments,
} from '@/services/aiWallpaper'

const CloudUpscaleExperimentPanel = defineAsyncComponent(
  () => import('./components/CloudUpscaleExperimentPanel.vue'),
)
const loadLocalMaskEditorDialog = () => import('./components/LocalMaskEditorDialog.vue')
const LocalMaskEditorDialog = defineAsyncComponent(loadLocalMaskEditorDialog)

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
  inputMode,
  isRunning,
  isPageLoading,
  requestCreateTask,
  canCreateTask,
  activePublicModelOptions,
  selectedPublicModel,
  currentPublicModel,
  superResolutionFeatureEnabled,
  skillOptions,
  selectedSkills,
  selectedSkillIds,
  toggleSkill,
  addCustomSkill,
  removeCustomSkill,
  createUpscaleTask,
  createMaskedEditTask,
  createHint,
  formatPublicModelCost,
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
} = useAiWallpaperStudioState()

const referenceInputRef = ref(null)
const modelMenuOpen = ref(false)
const skillPanelOpen = ref(false)
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
const lightboxUpscaleMenuOpen = ref(false)
const lightboxUpscaleScale = ref('2K')
const lightboxBaseUrl = ref('')
const cloudUpscalePanelOpen = ref(false)
const cloudUpscaleProviders = ref([])
const cloudUpscaleExperiments = ref([])
const cloudUpscaleProviderId = ref('cloudflare-images')
const cloudUpscaleTarget = ref('4K')
const cloudUpscaleLoading = ref(false)
const cloudUpscaleRunningProviderId = ref('')
const cloudUpscaleError = ref('')
const selectedCloudExperimentKey = ref('')
const MAIN_TAB_STORAGE_KEY = 'ai-wallpaper-studio-main-tab-v1'
const VALID_MAIN_TABS = new Set(['prompts', 'images', 'history', 'assets'])
const storedMainTab = getScopedLocalItem(MAIN_TAB_STORAGE_KEY)
const mainTab = ref(VALID_MAIN_TABS.has(storedMainTab) ? storedMainTab : 'images')
const promptBoxRef = ref(null)
const actionBusyId = ref('')
const upscaleBusyId = ref('')
const localMaskEditorOpen = ref(false)
const localMaskEditorMounted = ref(false)
const localMaskEditorBusy = ref(false)
const localMaskEditorTask = ref(null)
const localMaskEditorUrl = ref('')
const deleteConfirmOpen = ref(false)
const deleteTarget = ref(null)
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
const promptCategoryCounts = ref({ all: 0 })
const myAssets = ref([])
const assetsLoading = ref(false)
const assetsLoadingMore = ref(false)
const assetsPage = ref(1)
const assetsTotal = ref(0)
const assetsHasMore = ref(false)
const failedAssetIds = ref({})
const promptCategoryFilter = ref('all')
const promptSentinelRef = ref(null)
const assetSentinelRef = ref(null)
let promptLoadObserver = null
let assetLoadObserver = null

const PROMPT_CATEGORY_META = [
  { value: 'all', label: '全部' },
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

const LIGHTBOX_MIN_ZOOM = 0.5
const LIGHTBOX_MAX_ZOOM = 5
const LIGHTBOX_ZOOM_STEP = 0.25
const LIGHTBOX_UPSCALE_OPTIONS = ['2K', '4K', '8K']
const STAGE_PREVIEW_DIMENSION = 1200
const FILMSTRIP_THUMBNAIL_DIMENSION = 240
const HISTORY_THUMBNAIL_DIMENSION = 720
let lightboxPanStart = null
let lightboxComparePointerId = null
let cloudUpscaleLoadController = null
let cloudUpscaleRunController = null

const PROMPT_MAX = 6000
const effectiveOutputFormat = computed({
  get: () => (transparentPngEnabled.value ? 'png' : upscaleOutputFormat.value),
  set: (value) => {
    if (!transparentPngEnabled.value) upscaleOutputFormat.value = value
  },
})
const effectiveOutputFormatOptions = computed(() =>
  transparentPngEnabled.value
    ? T2I_OUTPUT_FORMAT_OPTIONS.filter((option) => option.value === 'png')
    : T2I_OUTPUT_FORMAT_OPTIONS,
)

const modelOptions = computed(() => activePublicModelOptions.value || [])
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
const historyTasks = computed(() =>
  sortedTasks.value.filter(
    (task) =>
      task.shareSubmitted !== true &&
      !publishedJobIds.value.has(String(task.serverJobId || task.id || '').replace(/^server-/, '')),
  ),
)
const historyCount = computed(() => historyTasks.value.length)
const assetCount = computed(() => Math.max(assetsTotal.value, myAssets.value.length))
const promptCategoryOptions = computed(() => {
  return PROMPT_CATEGORY_META.filter(
    (category) =>
      category.value === 'all' || Number(promptCategoryCounts.value[category.value] || 0) > 0,
  ).map((category) => ({
    ...category,
    count: Number(promptCategoryCounts.value[category.value] || 0),
  }))
})
const filteredPromptLibrary = computed(() => managedPromptLibrary.value)
const failedOrPausedTaskCount = computed(
  () =>
    historyTasks.value.filter((task) =>
      ['failed', 'paused'].includes(String(task?.status || '').toLowerCase()),
    ).length,
)
const promptLength = computed(() => String(prompt.value || '').length)
const currentModelLabel = computed(() => {
  const model = currentPublicModel.value
  if (!model) return '选择模型'
  return model.label || model.name || model.id
})
const currentModelCost = computed(() =>
  currentPublicModel.value ? formatPublicModelCost(currentPublicModel.value) : '',
)
const lightboxZoomLabel = computed(() => `${Math.round(lightboxZoom.value * 100)}%`)
const lightboxImageStyle = computed(() => ({
  transform: `translate3d(${lightboxPanX.value}px, ${lightboxPanY.value}px, 0) scale(${lightboxZoom.value})`,
}))
const lightboxOriginalUrl = computed(() => {
  if (selectedCloudExperimentKey.value) return String(lightboxBaseUrl.value || '').trim()
  return String(lightboxTask.value?.originalOutputUrl || '').trim()
})
const lightboxCanCompare = computed(
  () =>
    Boolean(lightboxOriginalUrl.value) &&
    Boolean(lightboxUrl.value) &&
    lightboxOriginalUrl.value !== lightboxUrl.value,
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
  const experiment = cloudUpscaleExperiments.value.find(
    (item) => cloudExperimentKey(item) === selectedCloudExperimentKey.value,
  )
  if (experiment) {
    const dimensions =
      Number(experiment.width) && Number(experiment.height)
        ? ` ${experiment.width}×${experiment.height}`
        : ''
    return `${experiment.providerLabel} ${experiment.target}${dimensions}`
  }
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
const publishDialogTitle = computed(() =>
  publishTarget.value ? taskPrompt(publishTarget.value.task).slice(0, 120) : '',
)
const publishDialogStyleLabel = computed(() => {
  const model = String(publishTarget.value?.task?.model || '').trim()
  return model && model !== '未知模型' ? model : 'AI 壁纸'
})
const deleteConfirmTitle = computed(() => taskPrompt(deleteTarget.value).slice(0, 72))
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
  for (const task of sortedTasks.value) {
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
    const outputs = taskOutputs(task)
    outputs.forEach((url, index) => {
      if (isImageUnavailable(task, index, url)) return
      items.push({
        key: `${task.id}-${index}`,
        kind: 'image',
        task,
        url,
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
const featuredImageAspects = ref({})
const featuredItem = computed(() => {
  const items = imageGallery.value
  if (!items.length) return null
  return items.find((item) => item.key === focusKey.value) || items[0]
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
  const ratio = Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : 16 / 9
  return {
    aspectRatio: featuredAspect.value,
    '--t2i-stage-fit-width': `${ratio * 100}cqh`,
    '--t2i-stage-max-width': ratio > 1 ? '1280px' : '920px',
  }
})
const featuredPromptSummary = computed(() => {
  const promptText = String(featuredItem.value?.title || '').trim()
  const maxLength = 64
  return promptText.length > maxLength ? `${promptText.slice(0, maxLength)}…` : promptText
})

function galleryItemBatchLabel(item) {
  return Number(item?.total) > 1 ? `${Number(item.batchIndex ?? item.index) + 1}/${item.total}` : ''
}

const HISTORY_BATCH = 12
const historyVisibleCount = ref(HISTORY_BATCH)
const historySentinelRef = ref(null)
const historyViewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
const historyMeasuredAspects = ref({})
const historyImageMetadata = ref({})
const promptMeasuredAspects = ref({})
const promptImageMetadata = ref({})
const assetMeasuredAspects = ref({})
const assetImageMetadata = ref({})
let historyLoadObserver = null

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
  buildBalancedMasonryColumns(promptLibraryFeedItems.value, historyColumnCount.value),
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
  buildBalancedMasonryColumns(assetFeedItems.value, historyColumnCount.value),
)

const historyFeedItems = computed(() => {
  const items = []
  for (const task of historyTasks.value) {
    const outputs = taskOutputs(task)
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
  const authenticatedMetadata = getAuthenticatedMediaMetadata(item.url, {
    maxDimension: HISTORY_THUMBNAIL_DIMENSION,
  })
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
    const [w, h] = String(option.value || '').split(':').map(Number)
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
  const metadata = getAuthenticatedMediaMetadata(item?.url || '', {
    maxDimension: STAGE_PREVIEW_DIMENSION,
  })
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
    item?.item?.imageUrl || item?.asset?.resultUrl || '',
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
    historyVisibleCount.value < historyFeedItems.value.length || serverJobsHasMore.value === true,
)
const historyColumnCount = computed(() => {
  const width = historyViewportWidth.value
  if (width <= 640) return 1
  if (width <= 960) return 2
  return 3
})

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

async function loadMoreHistory() {
  if (!historyHasMore.value || serverJobsLoadingMore.value) return
  if (historyVisibleCount.value < historyFeedItems.value.length) {
    historyVisibleCount.value = Math.min(
      historyFeedItems.value.length,
      historyVisibleCount.value + HISTORY_BATCH,
    )
    return
  }
  await loadMoreServerJobs()
  historyVisibleCount.value = Math.min(
    historyFeedItems.value.length,
    historyVisibleCount.value + HISTORY_BATCH,
  )
}

function resetHistoryWindow() {
  historyVisibleCount.value = Math.min(
    HISTORY_BATCH,
    historyFeedItems.value.length || HISTORY_BATCH,
  )
}

function onHistoryViewportResize() {
  historyViewportWidth.value = window.innerWidth
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
  if (promptLibraryLoading.value || promptLibraryLoadingMore.value) return
  const nextPage = reset ? 1 : promptPage.value + 1
  if (!reset && !promptHasMore.value) return
  if (reset) promptLibraryLoading.value = true
  else promptLibraryLoadingMore.value = true
  try {
    const response = await listPromptLibrary('t2i', {
      pageNumber: nextPage,
      pageSize: 24,
      category: promptCategoryFilter.value,
      fallbackItems: T2I_PROMPT_LIBRARY,
    })
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
    promptCategoryCounts.value = response?.categoryCounts || { all: promptTotal.value }
  } catch {
    if (reset) {
      managedPromptLibrary.value = []
      promptTotal.value = 0
      promptHasMore.value = false
      promptCategoryCounts.value = { all: 0 }
    }
  } finally {
    promptLibraryLoading.value = false
    promptLibraryLoadingMore.value = false
  }
}

function loadMorePrompts() {
  return loadManagedPromptLibrary()
}

async function loadMyAssets({ reset = false } = {}) {
  if (assetsLoading.value || assetsLoadingMore.value) return
  const nextPage = reset ? 1 : assetsPage.value + 1
  if (!reset && !assetsHasMore.value) return
  if (reset) assetsLoading.value = true
  else assetsLoadingMore.value = true
  try {
    const response = await listMyShareAssets({ page: nextPage, pageSize: 12 })
    const incoming = Array.isArray(response?.items) ? response.items : []
    myAssets.value = reset
      ? incoming
      : Array.from(
          new Map([...myAssets.value, ...incoming].map((item) => [item.id, item])).values(),
        )
    assetsPage.value = Number(response?.page || nextPage)
    assetsTotal.value = Number(response?.total || myAssets.value.length)
    assetsHasMore.value = assetsPage.value < Number(response?.totalPages || 1)
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

function useGeneratedAsReference(task, index = 0) {
  const url = taskOutputs(task)[index]
  addReferenceImageFromUrl(url, taskPrompt(task).slice(0, 80))
}

function usePromptLibraryEntry(item) {
  if (!item?.prompt) return
  prompt.value = item.prompt
  mainTab.value = 'images'
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

function openAsset(asset) {
  openLightbox(assetTask(asset), 0)
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
  loadManagedPromptLibrary({ reset: true })
  void activateMainTab(mainTab.value)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleLightboxKeydown)
  window.removeEventListener('resize', onHistoryViewportResize)
  disconnectHistoryObserver()
  disconnectPromptObserver()
  disconnectAssetObserver()
  cloudUpscaleLoadController?.abort()
  cloudUpscaleRunController?.abort()
})

watch(isRunning, (running, wasRunning) => {
  if (running) mainTab.value = 'images'
  else if (wasRunning && completedImageCount.value) mainTab.value = 'images'
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

watch(promptCategoryFilter, async () => {
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
    if (!items.length) {
      focusKey.value = ''
      return
    }
    // 用户新提交的任务：立刻聚焦到「生成中」卡片，让进度看得见（首次加载不触发）
    if (Array.isArray(prevItems)) {
      const prevKeys = new Set(prevItems.map((item) => item.key))
      const freshPending = items.find((item) => item.kind === 'pending' && !prevKeys.has(item.key))
      if (freshPending) {
        focusKey.value = freshPending.key
        return
      }
    }
    if (focusKey.value && items.some((item) => item.key === focusKey.value)) return
    // pending-id-0 → id-0 完成后自动落到新图
    const pendingMatch = String(focusKey.value || '').match(/^pending-(.+)-(\d+)$/)
    if (pendingMatch) {
      const nextKey = `${pendingMatch[1]}-${pendingMatch[2]}`
      if (items.some((item) => item.key === nextKey)) {
        focusKey.value = nextKey
        return
      }
    }
    const newestImage = items.find((item) => item.kind === 'image')
    const newestPending = items.find((item) => item.kind === 'pending')
    focusKey.value = (newestImage || newestPending)?.key || items[0].key
  },
  { immediate: true },
)

function focusGalleryItem(item) {
  if (!item?.key) return
  focusKey.value = item.key
  if (item.task) viewTask(item.task)
}

function stepFeatured(delta) {
  const items = imageGallery.value
  if (items.length < 2) return
  const current = featuredItem.value
  const index = Math.max(
    0,
    items.findIndex((item) => item.key === current?.key),
  )
  const next = items[(index + delta + items.length) % items.length]
  focusGalleryItem(next)
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
  lightboxBaseUrl.value = next.url
  selectedCloudExperimentKey.value = ''
  cloudUpscaleExperiments.value = []
  cloudUpscalePanelOpen.value = false
  lightboxCompareEnabled.value = false
  lightboxComparePosition.value = 50
  lightboxUpscaleMenuOpen.value = false
  lightboxUpscaleScale.value = suggestedLightboxUpscaleScale(next.task)
  viewTask(next.task)
  lightboxNaturalSize.value = { width: 0, height: 0 }
  resetLightboxView()
}

function handleLightboxKeydown(event) {
  if (deleteConfirmOpen.value) return
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

function isLocalUpscaling(task) {
  return String(task?.localUpscaleStatus || '') === 'running'
}

function isPaused(task) {
  return String(task?.status || '') === 'paused'
}

function canCancel(task) {
  return isBusy(task) || isPaused(task) || isLocalUpscaling(task)
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
  return raw.length > 72 ? `${raw.slice(0, 72)}…` : raw
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
    await loadMyAssets({ reset: true })
    mainTab.value = 'assets'
  } catch (error) {
    notificationService.error(error?.message || '作品发布失败')
  } finally {
    submittingShareId.value = ''
  }
}

function openLightbox(task, index = 0) {
  const outputs = taskOutputs(task)
  const url = outputs[index]
  viewTask(task)
  if (!url) return
  lightboxTask.value = task
  lightboxIndex.value = index
  lightboxUrl.value = url
  lightboxBaseUrl.value = url
  selectedCloudExperimentKey.value = ''
  cloudUpscaleExperiments.value = []
  cloudUpscaleError.value = ''
  cloudUpscalePanelOpen.value = false
  lightboxCompareEnabled.value = false
  lightboxComparePosition.value = 50
  lightboxUpscaleMenuOpen.value = false
  lightboxUpscaleScale.value = suggestedLightboxUpscaleScale(task)
  lightboxNaturalSize.value = { width: 0, height: 0 }
  resetLightboxView()
  lightboxOpen.value = true
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
    mainTab.value = 'images'
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

function closeLightbox() {
  cloudUpscaleLoadController?.abort()
  cloudUpscaleRunController?.abort()
  resetLightboxView()
  lightboxOpen.value = false
  lightboxUrl.value = ''
  lightboxBaseUrl.value = ''
  lightboxTask.value = null
  lightboxIndex.value = 0
  lightboxCompareEnabled.value = false
  lightboxComparePosition.value = 50
  lightboxCompareDragging.value = false
  lightboxComparePointerId = null
  lightboxUpscaleMenuOpen.value = false
  cloudUpscalePanelOpen.value = false
  cloudUpscaleExperiments.value = []
  selectedCloudExperimentKey.value = ''
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
  if (selectedCloudExperimentKey.value) {
    const failedKey = selectedCloudExperimentKey.value
    selectedCloudExperimentKey.value = ''
    cloudUpscaleExperiments.value = cloudUpscaleExperiments.value.filter(
      (item) => cloudExperimentKey(item) !== failedKey,
    )
    lightboxUrl.value = lightboxBaseUrl.value
    lightboxCompareEnabled.value = false
    lightboxNaturalSize.value = { width: 0, height: 0 }
    resetLightboxView()
    notificationService.warning('该云端实验图片暂时无法读取，已回到原图')
    return
  }
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

function suggestedLightboxUpscaleScale(task) {
  const size = String(task?.actualOutputSize || task?.outputSize || task?.originalOutputSize || '')
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i)
  const longest = match ? Math.max(Number(match[1]), Number(match[2])) : 0
  if (longest >= 3500) return '8K'
  if (longest >= 1500) return '4K'
  return '2K'
}

function toggleLightboxUpscaleMenu() {
  if (upscaleBusyId.value) return
  lightboxUpscaleMenuOpen.value = !lightboxUpscaleMenuOpen.value
}

async function selectLightboxUpscaleScale(scale) {
  const normalized = String(scale || '')
    .trim()
    .toUpperCase()
  if (!LIGHTBOX_UPSCALE_OPTIONS.includes(normalized)) return
  lightboxUpscaleScale.value = normalized
  lightboxUpscaleMenuOpen.value = false
  await upscaleLightboxImage(normalized)
}

async function upscaleLightboxImage(targetScale = lightboxUpscaleScale.value) {
  const task = lightboxTask.value
  // Reprocess from the preserved provider image instead of sharpening an
  // already-upscaled JPEG again. This also lets existing 4K results adopt
  // newer local processing parameters without compounding artifacts.
  const url = String(task?.originalOutputUrl || lightboxUrl.value).trim()
  if (!task || !url || upscaleBusyId.value) return
  upscaleBusyId.value = String(task.id || task.serverJobId || url)
  try {
    await createUpscaleTask(task, url, { targetScale })
    const refreshed = tasks.value.find((item) => item.id === task.id)
    const processedUrl = taskOutputs(refreshed)[0]
    if (refreshed && processedUrl) {
      lightboxTask.value = refreshed
      lightboxIndex.value = 0
      lightboxUrl.value = processedUrl
      lightboxBaseUrl.value = processedUrl
      selectedCloudExperimentKey.value = ''
      lightboxNaturalSize.value = { width: 0, height: 0 }
      lightboxCompareEnabled.value = Boolean(refreshed.originalOutputUrl)
      lightboxComparePosition.value = 50
      resetLightboxView()
      if (lightboxCompareEnabled.value) nextTick(() => setLightboxZoom(2))
    }
  } catch (error) {
    notificationService.error(error?.message || '高清放大失败')
  } finally {
    upscaleBusyId.value = ''
  }
}

function cloudExperimentKey(experiment) {
  return `${String(experiment?.provider || '')}:${String(experiment?.target || '')}`
}

function lightboxServerJobId() {
  return String(lightboxTask.value?.serverJobId || lightboxTask.value?.id || '')
    .replace(/^server-/, '')
    .trim()
}

async function loadCloudUpscaleWorkspace() {
  const jobId = lightboxServerJobId()
  if (!jobId) {
    cloudUpscaleError.value = '当前作品缺少服务端任务记录，无法进行云端对照测试'
    return
  }
  cloudUpscaleLoadController?.abort()
  const controller = new AbortController()
  cloudUpscaleLoadController = controller
  cloudUpscaleLoading.value = true
  cloudUpscaleError.value = ''
  try {
    const [providerResponse, experimentResponse] = await Promise.all([
      listCloudUpscaleProviders({ signal: controller.signal }),
      listServerAiUpscaleExperiments(jobId, { signal: controller.signal }),
    ])
    if (controller.signal.aborted) return
    cloudUpscaleProviders.value = Array.isArray(providerResponse?.providers)
      ? providerResponse.providers
      : []
    cloudUpscaleExperiments.value = Array.isArray(experimentResponse?.experiments)
      ? experimentResponse.experiments
      : []
    const selected =
      cloudUpscaleProviders.value.find(
        (provider) => provider.id === cloudUpscaleProviderId.value,
      ) || cloudUpscaleProviders.value[0]
    if (selected) selectCloudUpscaleProvider(selected.id)
  } catch (error) {
    if (error?.name !== 'AbortError') {
      cloudUpscaleError.value = error?.message || '云端超清工作区加载失败'
    }
  } finally {
    if (cloudUpscaleLoadController === controller) cloudUpscaleLoadController = null
    if (!controller.signal.aborted) cloudUpscaleLoading.value = false
  }
}

function toggleCloudUpscalePanel() {
  cloudUpscalePanelOpen.value = !cloudUpscalePanelOpen.value
  if (!cloudUpscalePanelOpen.value) return
  lightboxUpscaleMenuOpen.value = false
  void loadCloudUpscaleWorkspace()
}

function selectCloudUpscaleProvider(providerId) {
  const provider = cloudUpscaleProviders.value.find((item) => item.id === providerId)
  if (!provider) return
  cloudUpscaleProviderId.value = provider.id
  if (!provider.supportedTargets?.includes(cloudUpscaleTarget.value)) {
    cloudUpscaleTarget.value = provider.supportedTargets?.includes('4K')
      ? '4K'
      : provider.supportedTargets?.[0] || '4K'
  }
  cloudUpscaleError.value = ''
}

function selectCloudUpscaleTarget(target) {
  cloudUpscaleTarget.value = String(target || '').toUpperCase()
  cloudUpscaleError.value = ''
}

function selectCloudUpscaleExperiment(experiment) {
  const url = String(experiment?.mediaUrl || '').trim()
  if (!url) return
  selectedCloudExperimentKey.value = cloudExperimentKey(experiment)
  lightboxUrl.value = url
  lightboxNaturalSize.value = { width: 0, height: 0 }
  lightboxCompareEnabled.value = Boolean(lightboxBaseUrl.value)
  lightboxComparePosition.value = 50
  resetLightboxView()
}

function selectCloudUpscaleOriginal() {
  if (!lightboxBaseUrl.value) return
  selectedCloudExperimentKey.value = ''
  lightboxUrl.value = lightboxBaseUrl.value
  lightboxCompareEnabled.value = false
  lightboxNaturalSize.value = { width: 0, height: 0 }
  resetLightboxView()
}

async function runCloudUpscaleExperiment() {
  const jobId = lightboxServerJobId()
  const provider = cloudUpscaleProviders.value.find(
    (item) => item.id === cloudUpscaleProviderId.value,
  )
  if (!jobId || !provider || !provider.available || cloudUpscaleRunningProviderId.value) return
  cloudUpscaleRunController?.abort()
  const controller = new AbortController()
  cloudUpscaleRunController = controller
  cloudUpscaleRunningProviderId.value = provider.id
  cloudUpscaleError.value = ''
  try {
    const requestInput = {
      provider: provider.id,
      target: cloudUpscaleTarget.value,
      prompt: taskPrompt(lightboxTask.value),
    }
    let response
    try {
      response = await createServerAiUpscaleExperiment(jobId, requestInput, {
        signal: controller.signal,
      })
    } catch (error) {
      if (provider.id !== 'cloudflare-images' || !isTransientUpscaleConnectionError(error)) {
        throw error
      }
      cloudUpscaleError.value = '连接暂时中断，正在自动恢复 Cloudflare Images 任务…'
      await waitForCloudUpscaleRetry(1_500, controller.signal)
      response = await createServerAiUpscaleExperiment(jobId, requestInput, {
        signal: controller.signal,
      })
    }
    const experiment = response?.experiment
    if (!experiment) throw new Error('云端方案未返回可用结果')
    cloudUpscaleExperiments.value = [
      experiment,
      ...cloudUpscaleExperiments.value.filter(
        (item) => cloudExperimentKey(item) !== cloudExperimentKey(experiment),
      ),
    ]
    selectCloudUpscaleExperiment(experiment)
    notificationService.success(`${provider.label} ${cloudUpscaleTarget.value} 对照结果已生成`)
  } catch (error) {
    if (error?.name !== 'AbortError') {
      cloudUpscaleError.value = isTransientUpscaleConnectionError(error)
        ? `Cloudflare Images 连接不稳定，自动重试仍未成功。${cloudUpscaleTarget.value === '2K' ? '请稍后再试。' : '建议先测试 2K，网络恢复后再生成高分辨率。'}`
        : error?.message || '云端超清实验失败'
      notificationService.error(cloudUpscaleError.value)
    }
  } finally {
    if (cloudUpscaleRunController === controller) cloudUpscaleRunController = null
    if (!controller.signal.aborted) cloudUpscaleRunningProviderId.value = ''
  }
}

function isTransientUpscaleConnectionError(error) {
  const message = String(error?.message || error || '')
  return /network connection lost|connection (?:lost|reset|closed)|fetch failed|network error|连接中断|连接不稳定|传输中断/i.test(
    message,
  )
}

function waitForCloudUpscaleRetry(ms, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('云端超清已取消', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('云端超清已取消', 'AbortError'))
      },
      { once: true },
    )
  })
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

async function regenerateTask(task) {
  if (!task || actionBusyId.value) return
  actionBusyId.value = String(task.id)
  try {
    reuseTask(task, { silent: true })
    await nextTick()
    if (!canCreateTask.value) {
      notificationService.warning(createHint.value || '当前无法重新生成')
      return
    }
    mainTab.value = 'images'
    await requestCreateTask()
  } catch (error) {
    notificationService.error(error?.message || '重新生成失败')
  } finally {
    actionBusyId.value = ''
  }
}

async function handleGenerate() {
  mainTab.value = 'images'
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

function handleRemoveTask(task) {
  if (!task?.id || actionBusyId.value) return
  deleteTarget.value = task
  deleteConfirmOpen.value = true
}

function closeDeleteConfirm() {
  if (actionBusyId.value) return
  deleteConfirmOpen.value = false
  deleteTarget.value = null
}

async function confirmRemoveTask() {
  const task = deleteTarget.value
  if (!task?.id || actionBusyId.value) return
  actionBusyId.value = String(task.id)
  try {
    await removeTask(task.id)
    if (lightboxTask.value?.id === task.id) closeLightbox()
    deleteConfirmOpen.value = false
    deleteTarget.value = null
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

function selectModel(modelId) {
  const nextId = String(modelId || '').trim()
  if (!nextId) return
  selectedPublicModel.value = nextId
  modelMenuOpen.value = false
  const model = modelOptions.value.find((item) => item.id === nextId)
  notificationService.success(`已切换模型：${model?.label || model?.name || nextId}`)
}

function modelOptionLabel(model) {
  const name = model.label || model.name || model.id
  const cost = formatPublicModelCost(model)
  return cost ? `${name} · ${cost}` : name
}

function closeMenus() {
  modelMenuOpen.value = false
  skillPanelOpen.value = false
  lightboxUpscaleMenuOpen.value = false
}

function submitCustomSkill() {
  const skill = addCustomSkill({
    name: customSkillName.value,
    prompt: customSkillPrompt.value,
    description: customSkillDescription.value,
  })
  if (!skill) return
  customSkillName.value = ''
  customSkillPrompt.value = ''
  customSkillDescription.value = ''
  notificationService.success(`已添加 Skill：${skill.name}`)
}

function setMainTab(tab) {
  mainTab.value = tab
  closeMenus()
}
</script>

<template>
  <div class="t2i-page" @click="closeMenus">
    <aside class="t2i-sidebar" aria-label="生成设置" @click.stop>
      <div class="t2i-side-tabs">
        <button type="button" class="is-active">图片生成</button>
        <button type="button" class="is-disabled" disabled title="即将支持">视频创作</button>
      </div>

      <div class="t2i-model">
        <button
          type="button"
          class="t2i-model-trigger"
          :class="{ 'is-open': modelMenuOpen, 'is-loading': isPageLoading }"
          :disabled="isPageLoading"
          @click="modelMenuOpen = !modelMenuOpen"
        >
          <span class="t2i-model-icon"><i class="bi bi-stars"></i></span>
          <span v-if="isPageLoading" class="t2i-model-copy t2i-model-skeleton" aria-hidden="true">
            <span></span>
            <span></span>
          </span>
          <span v-else class="t2i-model-copy">
            <strong>{{ currentModelLabel }}</strong>
            <small>{{ currentModelCost || '点击切换模型' }}</small>
          </span>
          <i class="bi bi-chevron-down"></i>
        </button>
        <div v-if="modelMenuOpen && modelOptions.length" class="t2i-model-menu">
          <button
            v-for="model in modelOptions"
            :key="model.id"
            type="button"
            :class="{ 'is-on': model.id === selectedPublicModel }"
            @click="selectModel(model.id)"
          >
            {{ modelOptionLabel(model) }}
          </button>
        </div>
      </div>

      <div class="t2i-side-scroll">
        <div ref="promptBoxRef" class="t2i-prompt-box">
          <textarea
            v-model="prompt"
            :maxlength="PROMPT_MAX"
            placeholder="描述主体、场景、光线与风格…"
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
              v-if="referenceImages.length < 4"
              type="button"
              class="t2i-prompt-ref-add"
              aria-label="添加参考图"
              title="参考图：点击选择或拖入图片，最多 4 张"
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
              <span>{{ promptLength }}/{{ PROMPT_MAX }}</span>
            </div>
          </div>
        </div>

        <div class="t2i-params">
          <AspectRatioSelect v-model="aspectRatio" :options="T2I_ASPECT_OPTIONS" />
          <AspectRatioSelect
            v-model="resolutionScale"
            :options="T2I_RESOLUTION_OPTIONS"
            aria-label="分辨率"
            :show-ratio-icons="false"
            use-option-label
          />
          <AspectRatioSelect
            v-model="imageQuality"
            :options="T2I_QUALITY_OPTIONS"
            aria-label="精细度"
            :show-ratio-icons="false"
            use-option-label
          />
          <AspectRatioSelect
            v-model="imageCount"
            :options="T2I_COUNT_OPTIONS"
            aria-label="张数"
            :show-ratio-icons="false"
            use-option-label
          />
        </div>

        <div class="t2i-output-options">
          <div class="t2i-format-tools-row">
            <div
              class="t2i-format-select"
              :title="
                transparentPngEnabled
                  ? '透明 PNG 已开启，处理格式固定为 PNG'
                  : '选择本地高清处理后的保存格式'
              "
            >
              <AspectRatioSelect
                v-model="effectiveOutputFormat"
                :options="effectiveOutputFormatOptions"
                aria-label="处理格式"
                :show-ratio-icons="false"
                use-option-label
              />
            </div>
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
                v-if="outputType === 'image'"
                type="button"
                class="t2i-prompt-toggle"
                :class="{ 'is-on': transparentPngEnabled }"
                role="switch"
                :aria-checked="transparentPngEnabled"
                title="透明 PNG：要求真实 Alpha 并执行质量门"
                @click="transparentPngEnabled = !transparentPngEnabled"
              >
                <span class="t2i-prompt-toggle-copy">
                  <i class="bi bi-transparency" aria-hidden="true"></i>
                  透明
                </span>
                <span class="t2i-mini-switch" aria-hidden="true"><span></span></span>
              </button>
            </div>
          </div>
        </div>

        <div class="t2i-skill-tools">
          <button
            type="button"
            class="t2i-skill-trigger"
            :class="{ 'is-open': skillPanelOpen, 'has-items': selectedSkills.length }"
            :aria-expanded="skillPanelOpen"
            @click.stop="skillPanelOpen = !skillPanelOpen"
          >
            <i class="bi bi-lightning-charge" aria-hidden="true"></i>
            <span>Skills</span>
            <em>{{ selectedSkills.length }}</em>
            <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
          <Transition name="t2i-skill-popover">
            <section v-if="skillPanelOpen" class="t2i-skill-panel" @click.stop>
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
              <div class="t2i-skill-form">
                <input v-model="customSkillName" type="text" maxlength="80" placeholder="Skill 名称" />
                <input
                  v-model="customSkillDescription"
                  type="text"
                  maxlength="180"
                  placeholder="一句话说明（可选）"
                />
                <textarea
                  v-model="customSkillPrompt"
                  maxlength="12000"
                  placeholder="写入 Skill 指令，例如：保持商品 Logo、颜色和构图不变…"
                ></textarea>
                <button type="button" class="t2i-skill-add" @click="submitCustomSkill">
                  <i class="bi bi-plus-lg" aria-hidden="true"></i>
                  添加自定义 Skill
                </button>
              </div>
            </section>
          </Transition>
        </div>
      </div>

      <button type="button" class="t2i-generate" :disabled="!canCreateTask" @click="handleGenerate">
        <span>{{ isRunning ? '再生成一张' : '立即生成' }}</span>
        <i class="bi" :class="isRunning ? 'bi-plus-lg' : 'bi-stars'"></i>
      </button>
    </aside>

    <main class="t2i-main" aria-label="创作结果">
      <header class="t2i-main-head">
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
            completedImageCount ? `${completedImageCount} 张作品` : '暂无作品'
          }}</span>
          <span v-else-if="mainTab === 'history'">{{
            historyCount ? `${historyCount} 条记录` : '暂无记录'
          }}</span>
          <span v-else-if="mainTab === 'assets'">{{
            assetCount ? `${assetCount} 项资产` : '暂无资产'
          }}</span>
          <span v-else>{{ promptTotal ? `${promptTotal} 条提示词` : '暂无提示词' }}</span>
        </div>
      </header>

      <section v-if="mainTab === 'images'" class="t2i-panel t2i-panel--stage">
        <div class="t2i-stage-workspace">
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
            <strong>创建您的第一个创作~</strong>
            <span>点左侧「立即生成」，大图会在这里展示；历史任务可在「历史记录」查看。</span>
          </div>
          <div v-else-if="featuredItem" class="t2i-stage">
            <div class="t2i-stage-canvas">
              <div class="t2i-stage-frame" :style="featuredAspectStyle">
                <div
                  v-if="featuredItem.kind === 'pending'"
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
                  @click="openLightbox(featuredItem.task, featuredItem.index)"
                >
                  <AuthenticatedImage
                    :src="featuredItem.url"
                    alt=""
                    loading="eager"
                    :max-dimension="STAGE_PREVIEW_DIMENSION"
                    @load="measureFeaturedImage(featuredItem, $event)"
                    @error="
                      markImageUnavailable(featuredItem.task, featuredItem.index, featuredItem.url)
                    "
                  />
                </button>
                <div
                  v-if="featuredItem.kind === 'image'"
                  class="t2i-stage-quick-actions"
                  aria-label="图片快捷操作"
                >
                  <button
                    type="button"
                    aria-label="编辑图片"
                    title="编辑"
                    @click.stop="editTask(featuredItem.task)"
                  >
                    <i class="bi bi-pencil-square" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    aria-label="下载图片"
                    title="下载"
                    @click.stop="downloadTaskOutput(featuredItem.task, featuredItem.index)"
                  >
                    <i class="bi bi-download" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    aria-label="设为参考图"
                    title="设为参考图"
                    @click.stop="useGeneratedAsReference(featuredItem.task, featuredItem.index)"
                  >
                    <i class="bi bi-images" aria-hidden="true"></i>
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
                    : isLocalUpscaling(featuredItem.task)
                      ? featuredItem.task.localUpscaleMessage || statusTitle(featuredItem.task)
                      : taskMeta(featuredItem.task)
                }}</small>
              </div>
              <div class="t2i-image-actions">
                <template v-if="featuredItem.kind === 'image'">
                  <button type="button" @click.stop="regenerateTask(featuredItem.task)">
                    重新生成
                  </button>
                  <button
                    type="button"
                    class="is-danger"
                    @click.stop="handleRemoveTask(featuredItem.task)"
                  >
                    删除
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

            <div v-if="imageGallery.length > 1" class="t2i-filmstrip" aria-label="作品列表">
              <button
                v-for="item in imageGallery"
                :key="item.key"
                type="button"
                class="t2i-film-item"
                :class="{
                  'is-on': item.key === featuredItem.key,
                  'is-pending': item.kind === 'pending',
                  'is-upscaling': isLocalUpscaling(item.task),
                }"
                :title="item.kind === 'image' ? '单击查看，双击设为参考图' : '任务处理中'"
                @click="focusGalleryItem(item)"
                @dblclick.stop="
                  item.kind === 'image' && useGeneratedAsReference(item.task, item.index)
                "
              >
                <span v-if="item.kind === 'pending'" class="t2i-film-pending">
                  <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
                  <em>{{ formatTaskElapsed(item.task) || '排队' }}</em>
                </span>
                <AuthenticatedImage
                  v-else
                  :src="item.url"
                  alt=""
                  loading="lazy"
                  root-margin="180px 240px"
                  :max-dimension="FILMSTRIP_THUMBNAIL_DIMENSION"
                  @error="markImageUnavailable(item.task, item.index, item.url)"
                />
                <span v-if="isLocalUpscaling(item.task)" class="t2i-film-upscale-progress">
                  {{ Math.round(Number(item.task.localUpscaleProgress || 0)) }}%
                </span>
                <span v-if="galleryItemBatchLabel(item)" class="t2i-film-batch-index">
                  {{ galleryItemBatchLabel(item) }}
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
        <div v-else-if="!historyFeedItems.length" class="t2i-empty">
          <div class="t2i-empty-icon" aria-hidden="true">
            <i class="bi bi-clock-history"></i>
          </div>
          <strong>还没有历史记录</strong>
          <span>提交生成后，这里会以瀑布流展示你的作品。</span>
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
                class="t2i-masonry-card"
                :class="{ 'is-active': item.task.id === activeTaskId }"
                :data-status="item.task.status"
              >
                <button
                  v-if="item.kind === 'image'"
                  type="button"
                  class="t2i-masonry-cover"
                  :style="{ aspectRatio: item.aspect }"
                  @click="openLightbox(item.task, item.index)"
                >
                  <AuthenticatedImage
                    :src="item.url"
                    alt=""
                    loading="lazy"
                    :max-dimension="HISTORY_THUMBNAIL_DIMENSION"
                    @load="measureHistoryImage(item, $event)"
                    @error="markImageUnavailable(item.task, item.index, item.url)"
                  />
                  <UpscaleProcessingOverlay
                    v-if="isLocalUpscaling(item.task)"
                    :task="item.task"
                    compact
                  />
                  <span v-if="item.total > 1" class="t2i-history-batch-index">
                    第 {{ Number(item.batchIndex ?? item.index) + 1 }}/{{ item.total }} 张
                  </span>
                  <span class="t2i-history-image-overlay">
                    <span class="t2i-history-image-prompt">{{ taskPrompt(item.task) }}</span>
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

                <div class="t2i-masonry-body">
                  <header class="t2i-history-meta">
                    <strong>{{ statusTitle(item.task) }}</strong>
                    <small>{{ taskMeta(item.task) }}</small>
                  </header>
                  <p v-if="item.kind !== 'image'" class="t2i-history-prompt">
                    {{ taskPrompt(item.task) }}
                  </p>
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

                <footer class="t2i-entry-actions">
                  <button
                    v-if="item.kind === 'image'"
                    type="button"
                    @click.stop="useGeneratedAsReference(item.task, item.index)"
                  >
                    参考图
                  </button>
                  <button
                    v-if="item.kind === 'image'"
                    type="button"
                    class="is-share"
                    :disabled="
                      submittingShareId === String(item.task.id) ||
                      item.task.shareSubmitted ||
                      isLocalUpscaling(item.task)
                    "
                    @click.stop="openPublish(item)"
                  >
                    <i
                      class="bi"
                      :class="
                        submittingShareId === String(item.task.id)
                          ? 'bi-arrow-repeat spin'
                          : item.task.shareSubmitted
                            ? 'bi-patch-check'
                            : 'bi-send-check'
                      "
                    ></i>
                    {{
                      submittingShareId === String(item.task.id)
                        ? '提交中…'
                        : shareStatusLabel(item.task)
                    }}
                  </button>
                  <button
                    type="button"
                    :disabled="actionBusyId === String(item.task.id)"
                    @click.stop="editTask(item.task)"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    :disabled="actionBusyId === String(item.task.id)"
                    @click.stop="regenerateTask(item.task)"
                  >
                    重新生成
                  </button>
                  <button
                    v-if="canCancel(item.task)"
                    type="button"
                    :disabled="actionBusyId === String(item.task.id)"
                    @click.stop="handleCancelTask(item.task)"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    class="is-danger"
                    :disabled="actionBusyId === String(item.task.id)"
                    @click.stop="handleRemoveTask(item.task)"
                  >
                    删除
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
          <p v-else-if="!historyHasMore" class="t2i-feed-end">没有更多数据了</p>
        </div>
      </section>

      <section v-else-if="mainTab === 'prompts'" class="t2i-panel t2i-library-view">
        <div v-if="promptLibraryLoading" class="t2i-history-skeleton" aria-label="提示词库加载中">
          <div v-for="column in 3" :key="column" class="t2i-history-skeleton-col">
            <article v-for="row in 3" :key="row" class="t2i-history-skeleton-card">
              <div class="t2i-skeleton-shine"></div>
            </article>
          </div>
        </div>
        <div v-else-if="!managedPromptLibrary.length" class="t2i-empty">
          <div class="t2i-empty-icon"><i class="bi bi-journal-text"></i></div>
          <strong>提示词库暂时为空</strong>
          <span>管理员添加并分配到“图片生成”后会显示在这里。</span>
        </div>
        <div v-else class="t2i-masonry-wrap">
          <nav class="t2i-library-categories" aria-label="提示词分类">
            <button
              v-for="category in promptCategoryOptions"
              :key="category.value"
              type="button"
              :class="{ 'is-active': promptCategoryFilter === category.value }"
              @click="promptCategoryFilter = category.value"
            >
              {{ category.label }}
              <em>{{ category.count }}</em>
            </button>
          </nav>

          <div v-if="!promptLibraryFeedItems.length" class="t2i-empty t2i-collection-empty">
            <div class="t2i-empty-icon"><i class="bi bi-filter"></i></div>
            <strong>该分类暂时没有提示词</strong>
            <span>选择其他分类继续浏览。</span>
          </div>

          <div v-else class="t2i-masonry" :style="{ '--t2i-masonry-cols': historyColumnCount }">
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
                      >{{ promptCategoryLabel(entry.item.categoryKey) }} · 点击即可填入创作区</small
                    >
                  </header>
                </div>
                <footer class="t2i-entry-actions">
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
          <div class="t2i-masonry" :style="{ '--t2i-masonry-cols': historyColumnCount }">
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
                  @click="openAsset(entry.asset)"
                >
                  <AuthenticatedImage
                    :src="entry.asset.resultUrl"
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
                <div class="t2i-masonry-body">
                  <header class="t2i-history-meta">
                    <strong>{{ entry.asset.title }}</strong>
                    <small
                      >{{ entry.asset.categoryLabel }} ·
                      {{
                        new Date(entry.asset.updatedAt || entry.asset.createdAt).toLocaleString()
                      }}</small
                    >
                  </header>
                </div>
                <footer class="t2i-entry-actions">
                  <button type="button" @click="useGeneratedAsReference(entry.task, 0)">
                    参考图
                  </button>
                  <button type="button" @click="openAsset(entry.asset)">预览</button>
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
      <div
        v-if="lightboxOpen"
        class="t2i-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label="全屏预览"
        @click.self="closeLightbox"
      >
        <div class="t2i-lightbox-actions" aria-label="预览操作" @click.stop>
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
          <div
            v-if="superResolutionFeatureEnabled"
            class="t2i-lightbox-upscale-picker"
            :class="{ 'is-open': lightboxUpscaleMenuOpen, 'is-busy': Boolean(upscaleBusyId) }"
          >
            <button
              type="button"
              class="t2i-lightbox-upscale-trigger"
              :disabled="Boolean(upscaleBusyId)"
              aria-haspopup="menu"
              :aria-expanded="lightboxUpscaleMenuOpen"
              :aria-label="`选择并生成 ${lightboxUpscaleScale} 图片`"
              :title="
                lightboxTask?.originalOutputUrl
                  ? '从原图重新优化（不调用模型）'
                  : '本地高清放大（不调用模型）'
              "
              @click="toggleLightboxUpscaleMenu"
            >
              <i
                class="bi"
                :class="upscaleBusyId ? 'bi-arrow-repeat spin' : 'bi-arrows-angle-expand'"
                aria-hidden="true"
              ></i>
              <span>{{ upscaleBusyId ? '处理中' : lightboxUpscaleScale }}</span>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </button>
            <Transition name="t2i-upscale-menu">
              <div
                v-if="lightboxUpscaleMenuOpen"
                class="t2i-lightbox-upscale-menu"
                role="menu"
                aria-label="选择高清尺寸"
              >
                <button
                  v-for="scale in LIGHTBOX_UPSCALE_OPTIONS"
                  :key="scale"
                  type="button"
                  role="menuitem"
                  :class="{ 'is-on': lightboxUpscaleScale === scale }"
                  @click="selectLightboxUpscaleScale(scale)"
                >
                  <span>{{ scale }}</span>
                  <small>{{ scale === '2K' ? '快速' : scale === '4K' ? '高清' : '极致' }}</small>
                </button>
              </div>
            </Transition>
          </div>
          <button
            type="button"
            :class="{ 'is-on': cloudUpscalePanelOpen }"
            aria-label="打开云端超清对照实验"
            title="云端超清对照实验"
            @click="toggleCloudUpscalePanel"
          >
            <i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>
          </button>
          <button type="button" aria-label="下载图片" title="下载" @click="downloadLightbox">
            <i class="bi bi-download" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="is-danger"
            aria-label="删除图片"
            title="删除"
            @click="handleRemoveTask(lightboxTask)"
          >
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
          <button type="button" aria-label="关闭预览" title="关闭" @click="closeLightbox">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>

        <CloudUpscaleExperimentPanel
          :open="cloudUpscalePanelOpen"
          :providers="cloudUpscaleProviders"
          :experiments="cloudUpscaleExperiments"
          :provider-id="cloudUpscaleProviderId"
          :target="cloudUpscaleTarget"
          :running-provider-id="cloudUpscaleRunningProviderId"
          :loading="cloudUpscaleLoading"
          :error="cloudUpscaleError"
          :selected-experiment-key="selectedCloudExperimentKey"
          @close="cloudUpscalePanelOpen = false"
          @select-provider="selectCloudUpscaleProvider"
          @select-target="selectCloudUpscaleTarget"
          @run="runCloudUpscaleExperiment"
          @select-experiment="selectCloudUpscaleExperiment"
          @select-original="selectCloudUpscaleOriginal"
        />

        <UpscaleProcessingOverlay
          v-if="lightboxLiveTask && isLocalUpscaling(lightboxLiveTask)"
          :task="lightboxLiveTask"
          fullscreen
          :cancelling="actionBusyId === String(lightboxLiveTask.id)"
          @cancel="handleCancelTask(lightboxLiveTask)"
        />

        <header class="t2i-lightbox-head">
          <div class="t2i-lightbox-title">
            <strong>全屏预览</strong>
            <small v-if="lightboxPositionLabel">{{ lightboxPositionLabel }}</small>
            <small v-else-if="lightboxTask">{{ taskPrompt(lightboxTask) }}</small>
            <small v-if="lightboxTask" class="is-size">{{ lightboxProcessedLabel }}</small>
          </div>
        </header>

        <div class="t2i-lightbox-stage">
          <button
            v-if="lightboxGalleryItems.length > 1"
            type="button"
            class="t2i-lightbox-nav is-prev"
            aria-label="上一张"
            @click.stop="stepLightbox(-1)"
          >
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
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
              <AuthenticatedImage
                :src="lightboxUrl"
                alt=""
                class="is-processed"
                loading="eager"
                draggable="false"
                @load="handleLightboxImageLoad"
                @error="handleLightboxImageError"
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
          <button
            v-if="lightboxGalleryItems.length > 1"
            type="button"
            class="t2i-lightbox-nav is-next"
            aria-label="下一张"
            @click.stop="stepLightbox(1)"
          >
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </div>

        <div class="t2i-lightbox-zoom-tools" aria-label="图片缩放工具" @click.stop>
          <button
            type="button"
            :disabled="lightboxZoom <= LIGHTBOX_MIN_ZOOM"
            aria-label="缩小图片"
            @click="zoomLightbox(-LIGHTBOX_ZOOM_STEP)"
          >
            <i class="bi bi-zoom-out"></i>
            <span>缩小</span>
          </button>
          <output>{{ lightboxZoomLabel }}</output>
          <button
            type="button"
            :disabled="lightboxZoom >= LIGHTBOX_MAX_ZOOM"
            aria-label="放大图片"
            @click="zoomLightbox(LIGHTBOX_ZOOM_STEP)"
          >
            <i class="bi bi-zoom-in"></i>
            <span>放大</span>
          </button>
          <button type="button" aria-label="适应屏幕" @click="resetLightboxView">
            <i class="bi bi-arrows-angle-contract"></i>
            <span>适应屏幕</span>
          </button>
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
      default-category="other"
      :suggested-tags="['AI 壁纸']"
      :submitting="Boolean(publishTarget && submittingShareId)"
      @close="closePublishDialog"
      @submit="submitHistoryToShare"
    />

    <DeleteHistoryConfirmDialog
      :open="deleteConfirmOpen"
      :title="deleteConfirmTitle"
      :busy="Boolean(deleteTarget && actionBusyId === String(deleteTarget.id))"
      @close="closeDeleteConfirm"
      @confirm="confirmRemoveTask"
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
