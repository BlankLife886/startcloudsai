<script setup>
import AiCostConfirmDialog from '@/components/wallpaper/fullscreen-preview/features/ai/AiCostConfirmDialog.vue'
import InsufficientCreditsDialog from '@/components/profile/InsufficientCreditsDialog.vue'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import ColoringFavoritePicker from './components/ColoringFavoritePicker.vue'
import ColoringFrameMedia from './components/ColoringFrameMedia.vue'
import ColoringSettingsDialog from './components/ColoringSettingsDialog.vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import SharePublishDialog from '@/features/share/components/SharePublishDialog.vue'
import { useColoringCanvasPan } from './composables/useColoringCanvasPan'
import { useIllustrationColoringState } from './composables/useIllustrationColoringState'
import { formatColoringErrorText } from './domain/coloringStability'
import '@/features/ai-illustration-coloring/styles/illustration-coloring.css'

const fileInput = ref(null)
const referenceInput = ref(null)
const studioRoot = ref(null)
const stageShell = ref(null)
const fitMode = ref('contain')
const isFullscreen = ref(false)
const boardTransition = ref(false)
const holdoverResultUrl = ref('')
const resultRevealing = ref(false)
const pendingDeleteHistoryItem = ref(null)
const batchGridMode = ref(true)
const selectedStyleCategoryId = ref('base')
const sharePublishOpen = ref(false)
const revealedBatchCardIds = ref(new Set())
const revealingBatchCardIds = ref(new Set())
const awaitingBatchRevealIds = ref(new Set())
let celebratedBatchKey = ''
const REFERENCE_PANEL_KEY = 'walleven.coloring.referencePanelCollapsed'
const referencePanelCollapsed = ref(
  (() => {
    if (typeof localStorage === 'undefined') return false
    const stored = localStorage.getItem(REFERENCE_PANEL_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
    // 小屏上浮层会盖住画布，未设置偏好时默认收起
    return typeof window !== 'undefined' && window.innerWidth < 760
  })(),
)
const showDebugTools = import.meta.env.DEV
const ColoringDebugPanel = showDebugTools
  ? defineAsyncComponent(() => import('./components/ColoringDebugPanel.vue'))
  : null
let boardTransitionTimer = 0
let lastActiveBatchKey = ''
let studioMotion = null
let stageMotion = null

const {
  COLORING_STYLE_PRESETS,
  COLORING_STYLE_CATEGORIES,
  MAX_REFERENCE_IMAGES,
  styleId,
  workTitle,
  customPrompt,
  customPromptLength,
  sourcePreview,
  sourceInfoText,
  referenceImages,
  sourceMeta,
  imageOrientation,
  frameAspectStyle,
  resultUrl,
  statusText,
  coloringElapsedText,
  stageHint,
  loading,
  submitting,
  controlsLocked,
  sourceUploading,
  hasRunningJobs,
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
  disabledMessage,
  creditCost,
  generationCount,
  totalCreditCost,
  canSubmit,
  newTaskMode,
  beginNewColoringTask,
  activeStyle,
  authStore,
  settings,
  settingsOpen,
  debugOpen,
  debugInfo,
  submittingShare,
  publicModels,
  openSettings,
  closeSettings,
  saveSettings,
  toggleDebugPanel,
  closeDebugPanel,
  handleFileInput,
  handleReferenceInput,
  removeReferenceImage,
  clearReferenceImages,
  handleDrop,
  triggerUpload,
  startColoring,
  downloadResult,
  submitActiveToShare,
  useResultAsSource,
  retryFailedJob,
  resumePausedJob,
  cancelActiveJob,
  saveActiveResultThumbnailFromImage,
  selectHistoryItem,
  removeHistoryItems,
  historyStatusLabel,
  historyThumb,
  historyTimeLabel,
  isRunningStatus,
  goLogin,
  resolveCostConfirm,
  creditsDialogOpen,
  requiredCredits,
  availableCredits,
  closeCreditsDialog,
} = useIllustrationColoringState()

const canPan = () => fitMode.value === 'cover'

function openSharePublish() {
  if (!resultUrl.value || activeHistoryItem.value?.shareSubmitted) return
  sharePublishOpen.value = true
}

async function confirmSharePublish(options) {
  const submitted = await submitActiveToShare(options)
  if (submitted) sharePublishOpen.value = false
}

const {
  isPanning,
  resetPan,
  bindFrameResize,
  registerTransformEl,
  refreshLayout,
  zoom,
  resetView,
  onZoomWheel,
  onZoomDoubleClick,
  onPanStart,
  onPanMove,
  onPanEnd,
} = useColoringCanvasPan({
  getNaturalSize: (frameKey) => {
    const active = activeHistoryItem.value
    const resultWidth = Number(active?.resultWidth || active?.requestedOutputWidth || 0)
    const resultHeight = Number(active?.resultHeight || active?.requestedOutputHeight || 0)
    if (frameKey === 'result' && resultWidth > 0 && resultHeight > 0) {
      return { width: resultWidth, height: resultHeight }
    }
    return {
      width: Math.max(1, Number(sourceMeta.value?.width || 1)),
      height: Math.max(1, Number(sourceMeta.value?.height || 1)),
    }
  },
  canPan,
  syncFrames: () =>
    compareMode.value === 'split' && Boolean(sourcePreview.value && resultUrl.value),
})

const historyTrack = ref(null)
const historyMoreButton = ref(null)
const historyPanelMode = ref('')
const historyPanelGroup = ref(null)
const historyPanelPage = ref(1)
const historyPickerLeft = ref(16)
const showExecutionTrace = ref(false)
const HISTORY_RAIL_LIMIT = 5
const HISTORY_PAGE_SIZE = 6
const HISTORY_PICKER_CARD_WIDTH = 220
const HISTORY_PICKER_GAP = 10
const HISTORY_PICKER_EDGE = 16

const selectedStyleCategory = computed(
  () =>
    COLORING_STYLE_CATEGORIES.value.find((item) => item.id === selectedStyleCategoryId.value) ||
    COLORING_STYLE_CATEGORIES.value[0] || {
      id: '',
      label: '暂无可用分类',
      icon: 'bi-palette2',
      hint: '',
    },
)

const hasReferenceStyle = computed(() => referenceImages.value.length > 0)

const visibleStylePresets = computed(() => {
  const rows = COLORING_STYLE_PRESETS.value.filter(
    (item) => item.categoryId === selectedStyleCategoryId.value,
  )
  return rows.length
    ? rows
    : COLORING_STYLE_PRESETS.value.filter((item) => item.categoryId === 'base')
})

const styleCategoryMenuOpen = ref(false)
let styleCategoryCloseTimer = 0

const clearStyleCategoryCloseTimer = () => {
  if (styleCategoryCloseTimer) {
    window.clearTimeout(styleCategoryCloseTimer)
    styleCategoryCloseTimer = 0
  }
}

const openStyleCategoryMenu = () => {
  if (hasReferenceStyle.value || controlsLocked.value) return
  clearStyleCategoryCloseTimer()
  styleCategoryMenuOpen.value = true
}

const scheduleCloseStyleCategoryMenu = () => {
  clearStyleCategoryCloseTimer()
  styleCategoryCloseTimer = window.setTimeout(() => {
    styleCategoryMenuOpen.value = false
    styleCategoryCloseTimer = 0
  }, 220)
}

const selectStyleCategory = (categoryId) => {
  selectedStyleCategoryId.value = categoryId
  const rows = COLORING_STYLE_PRESETS.value.filter((item) => item.categoryId === categoryId)
  if (!rows.some((item) => item.id === styleId.value)) {
    styleId.value = rows[0]?.id || 'watercolor'
  }
  clearStyleCategoryCloseTimer()
  styleCategoryMenuOpen.value = false
}

// 点击始终展开：hover 设备上 mouseenter 已先打开菜单，若此处做 toggle 会立刻又关闭；
// 触屏设备 tap 会依次触发 mouseenter 与 click，toggle 会导致菜单永远打不开。
const toggleStyleCategoryMenu = () => {
  if (hasReferenceStyle.value || controlsLocked.value) return
  clearStyleCategoryCloseTimer()
  styleCategoryMenuOpen.value = true
}

const onDocumentPointerDown = (event) => {
  if (!styleCategoryMenuOpen.value) return
  if (event.target?.closest?.('.coloring-style-menu')) return
  clearStyleCategoryCloseTimer()
  styleCategoryMenuOpen.value = false
}

const onDocumentKeydown = (event) => {
  if (event.key === 'Escape' && styleCategoryMenuOpen.value) {
    clearStyleCategoryCloseTimer()
    styleCategoryMenuOpen.value = false
  }
}

const showFailedResult = () =>
  activeHistoryItem.value?.status === 'failed' && !resultUrl.value && !loading.value
const failedResultMessage = computed(() =>
  formatColoringErrorText(statusText.value || activeHistoryItem.value?.error || '染色失败'),
)

function formatExecutionTime(value) {
  const date = new Date(value || 0)
  if (!Number.isFinite(date.getTime())) return '—'
  const pad = (part) => String(part).padStart(2, '0')
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}`
}

function formatExecutionDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000))
  if (!seconds) return '进行中'
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`
}

function executionDurationMs(item = {}) {
  const recorded = Number(item.durationMs || 0)
  if (Number.isFinite(recorded) && recorded > 0) return recorded
  const toTimestamp = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const text = String(value || '')
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const started = toTimestamp(item.startedAt || item.createdAt)
  const finished = toTimestamp(item.finishedAt)
  return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : 0
}

function executionStatusLabel(status) {
  return ({ completed: '已完成', done: '已完成', queued: '排队中', running: '处理中', waiting_provider: '等待服务商', paused: '已暂停', failed: '失败', cancelled: '已取消', canceled: '已取消' })[String(status || '').toLowerCase()] || '处理中'
}

function executionStageLabel(stage) {
  return ({ job_created: 'API 已创建任务', queue_dispatch_started: '正在投递任务队列', queue_dispatched: '任务已进入队列', queue_dispatch_failed: '队列投递失败，启用兜底', worker_claimed: 'Worker 已领取', provider_request_started: '已发送上游请求', provider_polling: '等待并查询上游任务', provider_response_received: '已收到上游响应', provider_receipt_saved: '已保全原始回包', result_media_saved: '图片已写入存储', result_media_missing: '图片写入失败', job_finalizing: '正在完成任务', job_completed: '任务状态已完成', usage_settled: '用量与资源已结算', client_notification_sent: '已通知用户端取图', execution_interrupted: '任务执行中断' })[String(stage || '').toLowerCase()] || '执行步骤'
}

const EXECUTION_DETAIL_LABELS = {
  taskType: '任务类型', provider: '服务商', model: '模型', publicModel: '公开模型',
  sourceFileCount: '源图数量', estimatedCostUsd: '预计成本（美元）', endpoint: '请求接口',
  profile: '适配配置', requestMode: '请求模式', resultMode: '结果模式', outputType: '输出类型',
  asynchronous: '异步任务', requestBody: '发送给上游的请求数据', providerStatus: '上游状态',
  providerTaskId: '上游任务编号', hasResultUrl: '是否提供结果地址', responseSummary: '上游响应摘要',
  receiptSaved: '原始回包已保全', contentType: '图片格式', bytes: '图片字节数',
  width: '图片宽度（像素）', height: '图片高度（像素）', resultPath: '结果读取地址', storageSaved: '图片已写入存储',
}

function executionDetailRows(details = {}) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return []
  return Object.entries(details).map(([key, value]) => ({
    key,
    label: EXECUTION_DETAIL_LABELS[key] || '详细字段',
    value:
      typeof value === 'object' && value !== null
        ? JSON.stringify(value, null, 2)
        : typeof value === 'boolean'
          ? value ? '是' : '否'
          : key === 'bytes' ? `${Number(value || 0).toLocaleString('zh-CN')} 字节` : String(value ?? ''),
  })).filter((item) => item.value !== '')
}

function uniqueExecutionTrace(entries = []) {
  const seen = new Set()
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const key = `${entry?.stage || ''}|${entry?.at || ''}|${entry?.message || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return entry?.stage && entry?.at
  })
}

function executionAttempts(entries = []) {
  const attempts = []
  let current = []
  for (const entry of uniqueExecutionTrace(entries)) {
    if (entry.stage === 'worker_claimed' && current.some((item) => item.stage === 'worker_claimed')) {
      attempts.push(current)
      current = []
    }
    current.push(entry)
  }
  if (current.length) attempts.push(current)
  return attempts
}

const executionAttemptGroups = computed(() => executionAttempts(activeHistoryItem.value?.executionTrace))
const currentExecutionTrace = computed(() => executionAttemptGroups.value.at(-1) || [])

function executionElapsedMs(entries = [], index = 0) {
  const current = Date.parse(String(entries?.[index]?.at || ''))
  const previous = index > 0 ? Date.parse(String(entries?.[index - 1]?.at || '')) : current
  return Number.isFinite(current) && Number.isFinite(previous) ? Math.max(0, current - previous) : 0
}

function formatPreciseElapsed(milliseconds) {
  const value = Math.max(0, Number(milliseconds || 0))
  if (!Number.isFinite(value)) return '—'
  return `${(value / 1000).toFixed(value < 10_000 ? 3 : 1)} 秒`
}

function executionTotalMs(entries = [], index = 0) {
  const current = Date.parse(String(entries?.[index]?.at || ''))
  const first = Date.parse(String(entries?.[0]?.at || ''))
  return Number.isFinite(current) && Number.isFinite(first) ? Math.max(0, current - first) : 0
}

const canvasMediaKey = computed(() => String(activeHistoryId.value || 'draft'))
const displayResultUrl = computed(() => String(resultUrl.value || '').trim())
const activeBatchItems = computed(() => {
  const active = activeHistoryItem.value
  if (!active) return []
  const batchId = String(active.batchId || '').trim()
  const items = batchId
    ? historyItems.value.filter((item) => String(item.batchId || '') === batchId)
    : [active]
  return items
    .slice()
    .sort((left, right) => Number(left.variantIndex || 1) - Number(right.variantIndex || 1))
})
const batchResultItems = computed(() =>
  activeBatchItems.value.filter((item) => String(item.resultUrl || item.outputs?.[0] || '').trim()),
)
const batchRunningCount = computed(
  () => activeBatchItems.value.filter((item) => isRunningStatus(item.status)).length,
)
const showBatchResults = computed(
  () =>
    batchGridMode.value &&
    activeBatchItems.value.length > 1 &&
    (batchResultItems.value.length || loading.value),
)

function isBatchCardRevealing(itemId) {
  return revealingBatchCardIds.value.has(String(itemId || ''))
}

function markBatchCardReveal(itemId) {
  const id = String(itemId || '').trim()
  if (!id || revealedBatchCardIds.value.has(id) || shouldReduceMotion()) {
    if (id) revealedBatchCardIds.value.add(id)
    return
  }
  const nextRevealing = new Set(revealingBatchCardIds.value)
  nextRevealing.add(id)
  revealingBatchCardIds.value = nextRevealing
  window.setTimeout(() => {
    const clearing = new Set(revealingBatchCardIds.value)
    clearing.delete(id)
    revealingBatchCardIds.value = clearing
    const nextRevealed = new Set(revealedBatchCardIds.value)
    nextRevealed.add(id)
    revealedBatchCardIds.value = nextRevealed
  }, 620)
}

function pulseBatchGridComplete() {
  if (!stageShell.value || shouldReduceMotion()) return
  const grid = stageShell.value.querySelector('.coloring-batch-grid')
  if (!grid) return
  stageMotion?.kill()
  stageMotion = gsap.fromTo(
    grid,
    { scale: 0.985, autoAlpha: 0.88 },
    {
      scale: 1,
      autoAlpha: 1,
      duration: 0.36,
      ease: 'power2.out',
      overwrite: 'auto',
    },
  )
  pulseBoardTransition()
}

/** 正式对比：用户偏好 split 且线稿+结果都在；生成中可临时并排，不改写偏好 */
const boardIsSplit = () => {
  if (showBatchResults.value) return false
  if (compareMode.value === 'split' && sourcePreview.value && resultUrl.value) return true
  return loading.value && !resultUrl.value && !!sourcePreview.value
}

const showSourceFrame = () => {
  if (showBatchResults.value) return false
  if (showFailedResult() && compareMode.value === 'result') return false
  return (
    boardIsSplit() ||
    (!resultUrl.value && !loading.value) ||
    (loading.value && !!sourcePreview.value)
  )
}

const showResultFrame = () =>
  boardIsSplit() || !!resultUrl.value || loading.value || showFailedResult()

const canCompare = computed(() => Boolean(sourcePreview.value && resultUrl.value))
const compareGestureHint = computed(() => {
  if (boardIsSplit()) {
    return zoom.value > 1
      ? `${Math.round(zoom.value * 100)}% · 同步拖动对齐 · 双击复位`
      : '同步缩放 · 拖动对齐查看'
  }
  return zoom.value > 1
    ? `${Math.round(zoom.value * 100)}% · 拖动查看 · 双击复位`
    : '滚轮或双击放大'
})
const historyMediaUrl = (...candidates) =>
  candidates
    .map((value) => String(value || '').trim())
    .find((value) => value && !value.startsWith('blob:')) || ''
const historyGroups = computed(() => {
  const groups = new Map()
  historyItems.value.forEach((item) => {
    const groupId = String(item.batchId || item.id)
    const group = groups.get(groupId) || { id: groupId, items: [] }
    group.items.push(item)
    groups.set(groupId, group)
  })
  return Array.from(groups.values())
    .map((group) => {
      const items = group.items
        .slice()
        .sort((left, right) => Number(left.variantIndex || 1) - Number(right.variantIndex || 1))
      const active = items.find((item) => item.id === activeHistoryId.value)
      const completed = items.find((item) => item.resultUrl || item.outputs?.[0])
      const representative = active || completed || items[0]
      const sourceThumb = historyMediaUrl(
        representative?.sourceThumbUrl,
        representative?.sourcePreview,
        representative?.sourceRemoteUrl,
      )
      const resultThumb = historyMediaUrl(
        completed?.resultThumbUrl,
        completed?.resultUrl,
        completed?.outputs?.[0],
      )
      const runningCount = items.filter((item) => isRunningStatus(item.status)).length
      const completedCount = items.filter((item) => item.resultUrl || item.outputs?.[0]).length
      return {
        ...group,
        items,
        representative,
        title: String(representative?.title || representative?.styleLabel || '插画染色').replace(
          /\s#\d+$/,
          '',
        ),
        sourceThumb,
        resultThumb,
        running: runningCount > 0,
        runningCount,
        completedCount,
        variantCount: items.length,
        active: items.some((item) => item.id === activeHistoryId.value),
        status: representative?.status || 'queued',
        statusLabel:
          items.length > 1
            ? runningCount
              ? `生成中 ${completedCount}/${items.length}`
              : `已生成 ${completedCount}/${items.length}`
            : historyStatusLabel(representative),
        timeLabel: historyTimeLabel(representative),
      }
    })
    .sort((left, right) => {
      // 轮询会持续更新 updatedAt；展示顺序只能基于创建时间，否则并发任务会交替跳位。
      const leftTime = Math.max(
        ...left.items.map(
          (item) => Date.parse(String(item.createdAt || '')) || Number(item.startedAt || 0),
        ),
      )
      const rightTime = Math.max(
        ...right.items.map(
          (item) => Date.parse(String(item.createdAt || '')) || Number(item.startedAt || 0),
        ),
      )
      return rightTime - leftTime
    })
})
const historyViewItems = computed(() => historyGroups.value.slice(0, HISTORY_RAIL_LIMIT))
const historyPanelItems = computed(() => {
  if (historyPanelMode.value === 'variants') return historyPanelGroup.value?.items || []
  const start = (historyPanelPage.value - 1) * HISTORY_PAGE_SIZE
  return historyGroups.value.slice(start, start + HISTORY_PAGE_SIZE)
})
const historyPanelPages = computed(() =>
  Math.max(1, Math.ceil(historyGroups.value.length / HISTORY_PAGE_SIZE)),
)
watch(historyPanelPages, (pages) => {
  if (historyPanelPage.value > pages) historyPanelPage.value = pages
})
const historyPickerStyle = computed(() => {
  const itemCount = Math.max(1, historyPanelItems.value.length)
  const columns = historyPanelMode.value === 'variants' ? Math.min(itemCount, 5) : 3
  const width =
    HISTORY_PICKER_EDGE * 2 +
    columns * HISTORY_PICKER_CARD_WIDTH +
    Math.max(0, columns - 1) * HISTORY_PICKER_GAP
  return {
    '--history-picker-columns': String(columns),
    '--history-picker-left': `${historyPickerLeft.value}px`,
    width: `min(calc(100% - 24px), ${width}px)`,
  }
})
const resultFrameAspectStyle = computed(() => {
  const active = activeHistoryItem.value
  const width = Number(active?.resultWidth || active?.requestedOutputWidth || 0)
  const height = Number(active?.resultHeight || active?.requestedOutputHeight || 0)
  if (!width || !height) return frameAspectStyle.value
  return {
    '--frame-aspect': `${width} / ${height}`,
    '--frame-ratio': String(width / height),
  }
})
const sharedCompareAspectStyle = computed(() => {
  if (!boardIsSplit()) return frameAspectStyle.value
  return resultUrl.value ? resultFrameAspectStyle.value : frameAspectStyle.value
})
const displayOrientation = computed(() => {
  if (!resultUrl.value) return imageOrientation.value
  const active = activeHistoryItem.value
  const width = Number(active?.resultWidth || active?.requestedOutputWidth || 0)
  const height = Number(active?.resultHeight || active?.requestedOutputHeight || 0)
  if (!width || !height) return imageOrientation.value
  const ratio = width / height
  if (ratio < 0.92) return 'portrait'
  if (ratio > 1.08) return 'landscape'
  return 'square'
})

function onFrameBodyMount({ el, frameKey }) {
  bindFrameResize(el || null, frameKey)
}

function onRegisterTransform({ el, frameKey }) {
  registerTransformEl(frameKey, el)
}

function onResultImageLoaded(event) {
  resultRevealing.value = false
  holdoverResultUrl.value = ''
  saveActiveResultThumbnailFromImage(event?.target)
}

function onResultImageError() {
  resultRevealing.value = false
  holdoverResultUrl.value = ''
  if (resultUrl.value) {
    statusText.value = '结果图片加载失败，请稍后重试或重新生成'
  }
}

function pulseBoardTransition() {
  boardTransition.value = true
  if (boardTransitionTimer) window.clearTimeout(boardTransitionTimer)
  boardTransitionTimer = window.setTimeout(() => {
    boardTransition.value = false
    boardTransitionTimer = 0
  }, 320)
}

function toggleFitMode() {
  fitMode.value = fitMode.value === 'contain' ? 'cover' : 'contain'
  resetView()
}

function setFitMode(mode) {
  fitMode.value = mode === 'cover' ? 'cover' : 'contain'
  resetView()
}

function toggleReferencePanel() {
  referencePanelCollapsed.value = !referencePanelCollapsed.value
  try {
    localStorage.setItem(REFERENCE_PANEL_KEY, referencePanelCollapsed.value ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}

async function toggleFullscreen() {
  const el = stageShell.value
  if (!el) return
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen?.()
      isFullscreen.value = true
    } else {
      await document.exitFullscreen?.()
      isFullscreen.value = false
    }
  } catch {
    isFullscreen.value = Boolean(document.fullscreenElement)
  }
  resetPan()
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement)
  resetPan()
}

function shouldReduceMotion() {
  return (
    typeof window === 'undefined' ||
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function animateStageUpdate() {
  if (!stageShell.value || shouldReduceMotion()) return
  const board = stageShell.value.querySelector('.coloring-board')
  if (!board) return
  stageMotion?.kill()
  stageMotion = gsap.fromTo(
    board,
    { autoAlpha: 0.82, y: 4, scale: 0.997 },
    {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.28,
      ease: 'power3.out',
      overwrite: 'auto',
      clearProps: 'transform,visibility,opacity',
    },
  )
}

function requestRemoveHistoryItem(item) {
  if (!item || item.running || isRunningStatus(item.status)) return
  if (settings.value.confirmBeforeDelete) {
    pendingDeleteHistoryItem.value = item
    return
  }
  void removeHistoryItems(item.items ? item.items.map((entry) => entry.id) : [item.id])
}

function openBatchItem(item) {
  batchGridMode.value = false
  selectHistoryItem(item)
  closeHistoryPanel()
}

function closeHistoryPanel() {
  historyPanelMode.value = ''
  historyPanelGroup.value = null
  historyPickerLeft.value = HISTORY_PICKER_EDGE
}

function alignHistoryPicker(group) {
  const stage = stageShell.value
  const track = historyTrack.value
  if (!stage || !track || !group) {
    historyPickerLeft.value = HISTORY_PICKER_EDGE
    return
  }
  const card = Array.from(track.querySelectorAll('[data-history-group]')).find(
    (element) => element.dataset.historyGroup === String(group.id),
  )
  if (!card) {
    historyPickerLeft.value = HISTORY_PICKER_EDGE
    return
  }
  const cardRect = card.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const columns = Math.min(Math.max(1, Number(group.variantCount || 1)), 5)
  const panelWidth =
    HISTORY_PICKER_EDGE * 2 +
    columns * HISTORY_PICKER_CARD_WIDTH +
    Math.max(0, columns - 1) * HISTORY_PICKER_GAP
  const preferredLeft = cardRect.left - stageRect.left
  const maxLeft = Math.max(HISTORY_PICKER_EDGE, stageRect.width - panelWidth - HISTORY_PICKER_EDGE)
  historyPickerLeft.value = Math.round(
    Math.min(Math.max(HISTORY_PICKER_EDGE, preferredLeft), maxLeft),
  )
}

function openHistoryGroup(group) {
  if (!group) return
  if (group.variantCount > 1) {
    historyPanelMode.value = 'variants'
    historyPanelGroup.value = group
    alignHistoryPicker(group)
    return
  }
  openBatchItem(group.representative)
}

function openHistoryBrowser() {
  historyPanelMode.value = 'history'
  historyPanelGroup.value = null
  const stage = stageShell.value
  const card = historyMoreButton.value
  if (stage && card) {
    const cardRect = card.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const panelWidth =
      HISTORY_PICKER_EDGE * 2 + 3 * HISTORY_PICKER_CARD_WIDTH + 2 * HISTORY_PICKER_GAP
    const preferredLeft = cardRect.right - stageRect.left - panelWidth
    const maxLeft = Math.max(
      HISTORY_PICKER_EDGE,
      stageRect.width - panelWidth - HISTORY_PICKER_EDGE,
    )
    historyPickerLeft.value = Math.round(
      Math.min(Math.max(HISTORY_PICKER_EDGE, preferredLeft), maxLeft),
    )
  } else {
    historyPickerLeft.value = HISTORY_PICKER_EDGE
  }
}

function selectHistoryPanelItem(item) {
  if (historyPanelMode.value === 'variants') {
    openBatchItem(item)
    return
  }
  openHistoryGroup(item)
}

function setHistoryPanelPage(page) {
  historyPanelPage.value = Math.min(Math.max(1, page), historyPanelPages.value)
}

function onWindowResize() {
  if (historyPanelMode.value === 'variants' && historyPanelGroup.value) {
    alignHistoryPicker(historyPanelGroup.value)
  }
}

function showBatchGrid() {
  batchGridMode.value = true
  resetPan()
  pulseBoardTransition()
}

function closeDeleteHistoryDialog() {
  pendingDeleteHistoryItem.value = null
}

async function confirmRemoveHistoryItem() {
  const item = pendingDeleteHistoryItem.value
  if (!item) return
  pendingDeleteHistoryItem.value = null
  await removeHistoryItems(item.items ? item.items.map((entry) => entry.id) : [item.id])
}

onMounted(async () => {
  await nextTick()
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onDocumentKeydown)
  if (!studioRoot.value || shouldReduceMotion()) return
  studioMotion = gsap.context(() => {
    const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
    timeline
      .from('.coloring-sidebar', { autoAlpha: 0, x: -16, duration: 0.46 })
      .from('.coloring-stage-toolbar', { autoAlpha: 0, y: -10, duration: 0.38 }, '<0.08')
      .from('.coloring-canvas-area', { autoAlpha: 0, scale: 0.992, duration: 0.48 }, '<0.04')
  }, studioRoot.value)
})

onUnmounted(() => {
  clearStyleCategoryCloseTimer()
  resetPan()
  stageMotion?.kill()
  stageMotion = null
  studioMotion?.revert()
  studioMotion = null
  if (boardTransitionTimer) window.clearTimeout(boardTransitionTimer)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onDocumentKeydown)
})

watch(fitMode, async () => {
  resetPan()
  await nextTick()
  refreshLayout()
})

watch(
  styleId,
  (nextStyleId) => {
    const preset = COLORING_STYLE_PRESETS.value.find((item) => item.id === nextStyleId)
    if (preset?.categoryId && preset.categoryId !== selectedStyleCategoryId.value) {
      selectedStyleCategoryId.value = preset.categoryId
    }
  },
  { immediate: true },
)

watch(
  [COLORING_STYLE_CATEGORIES, COLORING_STYLE_PRESETS],
  ([categories, presets]) => {
    if (!categories.length || !presets.length) return
    const currentPreset = presets.find((item) => item.id === styleId.value)
    if (currentPreset) {
      selectedStyleCategoryId.value = currentPreset.categoryId
      return
    }
    const selectedCategory = categories.find((item) => item.id === selectedStyleCategoryId.value)
    const fallbackCategory = selectedCategory || categories[0]
    const fallbackStyle =
      presets.find((item) => item.categoryId === fallbackCategory.id) || presets[0]
    selectedStyleCategoryId.value = fallbackStyle.categoryId
    styleId.value = fallbackStyle.id
  },
  { immediate: true },
)

watch(displayResultUrl, (nextUrl, prevUrl) => {
  const next = String(nextUrl || '').trim()
  const prev = String(prevUrl || '').trim()
  if (next && prev && next !== prev) {
    holdoverResultUrl.value = prev
    resultRevealing.value = true
    return
  }
  if (next && !prev) {
    holdoverResultUrl.value = ''
    resultRevealing.value = true
    return
  }
  if (!next) {
    holdoverResultUrl.value = ''
    resultRevealing.value = false
  }
})

watch(
  activeBatchItems,
  (items) => {
    const nextAwaiting = new Set(awaitingBatchRevealIds.value)
    items.forEach((item) => {
      const id = String(item.id || '').trim()
      if (!id) return
      const hasResult = Boolean(item.resultUrl || item.resultThumbUrl)
      if (!hasResult) nextAwaiting.add(id)
    })
    awaitingBatchRevealIds.value = nextAwaiting
  },
  { deep: true },
)

watch(
  batchResultItems,
  (items) => {
    const completedIds = items.map((item) => String(item.id || '')).filter(Boolean)
    completedIds.forEach((id) => {
      if (revealedBatchCardIds.value.has(id) || revealingBatchCardIds.value.has(id)) return
      if (awaitingBatchRevealIds.value.has(id)) {
        markBatchCardReveal(id)
        const nextAwaiting = new Set(awaitingBatchRevealIds.value)
        nextAwaiting.delete(id)
        awaitingBatchRevealIds.value = nextAwaiting
        return
      }
      // Already complete when first seen (history restore) — skip reveal animation.
      const nextRevealed = new Set(revealedBatchCardIds.value)
      nextRevealed.add(id)
      revealedBatchCardIds.value = nextRevealed
    })
    const batchTotal = activeBatchItems.value.length
    const active = activeHistoryItem.value
    const batchKey = String(active?.batchId || active?.id || '')
    if (
      batchKey &&
      batchTotal > 1 &&
      completedIds.length >= batchTotal &&
      celebratedBatchKey !== batchKey &&
      completedIds.some((id) => revealingBatchCardIds.value.has(id))
    ) {
      celebratedBatchKey = batchKey
      pulseBatchGridComplete()
    }
  },
  { deep: true },
)

watch(
  () => String(activeHistoryItem.value?.batchId || activeHistoryItem.value?.id || ''),
  (batchKey, prevKey) => {
    if (!batchKey || batchKey === prevKey) return
    const nextRevealed = new Set()
    const nextAwaiting = new Set()
    activeBatchItems.value.forEach((item) => {
      const id = String(item.id || '')
      if (!id) return
      if (item.resultUrl || item.resultThumbUrl) nextRevealed.add(id)
      else nextAwaiting.add(id)
    })
    revealedBatchCardIds.value = nextRevealed
    revealingBatchCardIds.value = new Set()
    awaitingBatchRevealIds.value = nextAwaiting
    celebratedBatchKey =
      nextRevealed.size >= activeBatchItems.value.length && activeBatchItems.value.length > 1
        ? batchKey
        : ''
  },
)

watch(activeHistoryId, async (id, prev) => {
  if (id && id !== prev) {
    const active = activeHistoryItem.value
    const batchKey = String(active?.batchId || active?.id || id)
    if (batchKey && batchKey !== lastActiveBatchKey) {
      batchGridMode.value = true
      lastActiveBatchKey = batchKey
    }
    resetPan()
    pulseBoardTransition()
  }
  await nextTick()
  const track = historyTrack.value
  if (!track) return
  const active = track.querySelector('.coloring-history-card.active')
  active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
})

watch(compareMode, async () => {
  resetView()
  await nextTick()
  refreshLayout()
  pulseBoardTransition()
})

watch([sourcePreview, displayResultUrl], async () => {
  await nextTick()
  refreshLayout()
  animateStageUpdate()
})
</script>

<template>
  <div ref="studioRoot" class="coloring-studio">
    <div class="coloring-workspace">
      <aside class="coloring-sidebar">
        <div class="coloring-side-scroll">
          <div v-if="disabledMessage" class="coloring-disabled-banner">
            {{ disabledMessage }}
          </div>

          <div v-if="!authStore.isAuthenticated" class="coloring-login-card">
            <div class="coloring-login-mark" aria-hidden="true">
              <i class="bi bi-person-lock"></i>
            </div>
            <div>
              <strong>登录后开始染色</strong>
              <p>上传线稿、选择风格，一键 AI 上色</p>
            </div>
            <button type="button" class="coloring-login-btn" @click="goLogin">去登录</button>
          </div>

          <section class="coloring-block coloring-block--title">
            <input
              v-model="workTitle"
              class="coloring-input"
              type="text"
              maxlength="80"
              :disabled="controlsLocked"
              aria-label="作品名称"
              placeholder="作品名称，例如：赛博机甲头像"
            />
          </section>

          <section class="coloring-block coloring-block--source">
            <div
              class="coloring-source-card"
              :class="{
                'is-empty': !sourcePreview,
                'is-dragover': uploadDragOver,
              }"
              @dragover.prevent="uploadDragOver = true"
              @dragleave="uploadDragOver = false"
              @drop.prevent="handleDrop"
            >
              <button
                v-if="!sourcePreview"
                type="button"
                class="coloring-source-main"
                :disabled="controlsLocked || sourceUploading"
                @click="triggerUpload(fileInput)"
              >
                <span class="coloring-upload-icon" aria-hidden="true">
                  <i class="bi bi-cloud-arrow-up"></i>
                </span>
                <span class="coloring-source-copy">
                  <strong>上传线稿</strong>
                  <small>拖拽或点击 · PNG / JPG / WEBP</small>
                </span>
              </button>

              <div v-else class="coloring-source-main coloring-source-main--preview">
                <div class="coloring-source-thumb" :data-orientation="imageOrientation">
                  <AuthenticatedImage :src="sourcePreview" alt="线稿预览" />
                  <div v-if="sourceUploading" class="coloring-source-uploading">
                    <i class="bi bi-arrow-repeat spin"></i>
                  </div>
                </div>
                <div class="coloring-source-copy">
                  <strong v-if="sourceInfoText">{{ sourceInfoText }}</strong>
                  <small v-else>读取图片信息中…</small>
                </div>
              </div>

              <div class="coloring-source-tools" role="group" aria-label="更换线稿">
                <button
                  type="button"
                  class="coloring-source-tool"
                  :disabled="controlsLocked || sourceUploading"
                  title="本地上传"
                  aria-label="本地上传"
                  @click="triggerUpload(fileInput)"
                >
                  <i class="bi bi-upload"></i>
                </button>
                <button
                  type="button"
                  class="coloring-source-tool"
                  :disabled="controlsLocked || sourceUploading"
                  title="从收藏选择"
                  aria-label="从收藏选择"
                  @click="openFavoritePicker"
                >
                  <i class="bi bi-heart"></i>
                </button>
              </div>
            </div>

            <input ref="fileInput" type="file" accept="image/*" hidden @change="handleFileInput" />
          </section>

          <section class="coloring-block coloring-block--style">
            <header class="coloring-block-head">
              <span>风格分类</span>
              <small v-if="hasReferenceStyle">已由参考图接管</small>
              <small v-else-if="activeHistoryItem"
                >来自历史 · {{ activeStyle.categoryLabel }}</small
              >
              <small v-else>{{ selectedStyleCategory.label }}</small>
            </header>
            <div
              class="coloring-style-menu"
              :class="{
                'is-open': styleCategoryMenuOpen,
                'is-disabled': hasReferenceStyle || controlsLocked,
              }"
              @mouseenter="openStyleCategoryMenu"
              @mouseleave="scheduleCloseStyleCategoryMenu"
            >
              <button
                type="button"
                class="coloring-style-menu-trigger"
                :disabled="hasReferenceStyle || controlsLocked"
                :aria-expanded="styleCategoryMenuOpen"
                aria-haspopup="listbox"
                aria-label="选择风格分类"
                @click="toggleStyleCategoryMenu"
              >
                <i class="bi" :class="selectedStyleCategory.icon || 'bi-palette2'"></i>
                <span>{{ selectedStyleCategory.label }}</span>
                <i class="bi bi-chevron-down coloring-style-menu-arrow"></i>
              </button>
              <div class="coloring-style-menu-panel" role="listbox" aria-label="风格分类列表">
                <div class="coloring-style-menu-panel-inner">
                  <button
                    v-for="category in COLORING_STYLE_CATEGORIES"
                    :key="category.id"
                    type="button"
                    class="coloring-style-menu-option"
                    role="option"
                    :aria-selected="selectedStyleCategoryId === category.id"
                    :class="{ active: selectedStyleCategoryId === category.id }"
                    :disabled="hasReferenceStyle || controlsLocked"
                    @click="selectStyleCategory(category.id)"
                  >
                    <i class="bi" :class="category.icon || 'bi-palette2'"></i>
                    <span>{{ category.label }}</span>
                  </button>
                </div>
              </div>
            </div>

            <header class="coloring-block-head coloring-block-head--sub">
              <span>具体风格</span>
              <small>{{ hasReferenceStyle ? '参考图风格' : activeStyle.label }}</small>
            </header>
            <div class="coloring-style-grid">
              <button
                v-for="preset in visibleStylePresets"
                :key="preset.id"
                type="button"
                class="coloring-style-chip"
                :class="{ active: styleId === preset.id, 'has-preview': preset.previewUrl }"
                :title="`${preset.label}：${preset.hint}`"
                :disabled="hasReferenceStyle || controlsLocked"
                @click="styleId = preset.id"
              >
                <span v-if="preset.previewUrl" class="coloring-style-chip-preview">
                  <img :src="preset.previewUrl" alt="" loading="lazy" />
                </span>
                <i v-else class="bi" :class="preset.icon || 'bi-palette2'"></i>
                <span>
                  <strong>{{ preset.label }}</strong>
                </span>
              </button>
            </div>
            <p class="coloring-style-summary">
              {{
                hasReferenceStyle
                  ? '参考图模式 · 只从参考图提取配色、材质、光影和氛围，不叠加预设风格'
                  : `${activeStyle.categoryLabel} · ${activeStyle.hint}`
              }}
            </p>
          </section>

          <section v-if="styleId === 'custom' && !hasReferenceStyle" class="coloring-block">
            <header class="coloring-block-head">
              <span>自定义描述</span>
              <small>{{ customPromptLength }} 字</small>
            </header>
            <textarea
              v-model="customPrompt"
              class="coloring-textarea"
              :disabled="controlsLocked"
              placeholder="描述主色、阴影倾向、材质或氛围，例如：薄荷绿与珊瑚粉，暖色阴影，线稿保持清晰…"
            ></textarea>
          </section>
        </div>

        <div class="coloring-side-footer">
          <div v-if="creditCost > 0" class="coloring-footer-meta">
            <span>本次约消耗</span>
            <strong>{{ totalCreditCost }} 积分</strong>
          </div>
          <button
            v-if="hasRunningJobs && !newTaskMode"
            type="button"
            class="coloring-secondary-btn coloring-new-task-btn"
            :disabled="submitting"
            @click="beginNewColoringTask"
          >
            <i class="bi bi-plus-circle"></i>
            新建染色任务
          </button>
          <button
            type="button"
            class="coloring-primary-btn"
            v-if="!loading || newTaskMode"
            :disabled="!canSubmit"
            @click="startColoring"
          >
            <i class="bi" :class="submitting ? 'bi-arrow-repeat spin' : 'bi-palette-fill'"></i>
            {{
              submitting
                ? '正在提交…'
                : generationCount > 1
                  ? `开始 AI 染色 · ${generationCount} 张`
                  : '开始 AI 染色'
            }}
          </button>
          <button
            v-if="['failed', 'cancelled', 'canceled'].includes(activeHistoryItem?.status)"
            type="button"
            class="coloring-retry-btn"
            :disabled="controlsLocked || loading"
            @click="retryFailedJob"
          >
            <i class="bi bi-arrow-clockwise"></i>
            重试失败任务
          </button>
          <button
            v-if="activeHistoryItem?.status === 'paused'"
            type="button"
            class="coloring-retry-btn"
            :disabled="submitting"
            @click="resumePausedJob"
          >
            <i class="bi bi-play-circle"></i>
            恢复原任务
          </button>
          <button
            v-if="
              ['queued', 'running', 'waiting_provider', 'paused'].includes(
                activeHistoryItem?.status,
              )
            "
            type="button"
            class="coloring-secondary-btn"
            :disabled="submitting"
            @click="cancelActiveJob"
          >
            <i class="bi bi-x-circle"></i>
            取消任务
          </button>
          <p v-if="hasRunningJobs && !submitting" class="coloring-hint-text">
            已有任务在后台处理，可继续配置并开始新任务（最多同时 5 个）。
          </p>
          <Teleport to="body">
          <details v-if="activeHistoryItem?.serverJobId && showExecutionTrace" class="coloring-execution-trace" open role="dialog" aria-modal="true">
            <summary>
              <span>执行时间线 · {{ executionStatusLabel(activeHistoryItem.status) }}</span>
              <button type="button" class="coloring-execution-close" aria-label="关闭执行日志" @click.stop.prevent="showExecutionTrace = false">
                <i class="bi bi-x-lg" aria-hidden="true"></i>
                关闭
              </button>
            </summary>
            <ol>
              <li><b>任务创建</b><time>{{ formatExecutionTime(activeHistoryItem.createdAt) }}</time></li>
              <li><b>Worker 开始处理</b><time>{{ formatExecutionTime(activeHistoryItem.startedAt) }}</time></li>
              <li><b>服务端最后更新</b><time>{{ formatExecutionTime(activeHistoryItem.updatedAt) }}</time></li>
              <li v-if="activeHistoryItem.finishedAt"><b>任务结束</b><time>{{ formatExecutionTime(activeHistoryItem.finishedAt) }}</time></li>
              <li><b>服务端执行耗时</b><time>{{ formatExecutionDuration(executionDurationMs(activeHistoryItem)) }}</time></li>
            </ol>
            <div v-if="currentExecutionTrace.length" class="coloring-execution-events">
              <p>本次服务端真实事件 · 第 {{ executionAttemptGroups.length }} 次执行</p>
              <ol>
                <li v-for="(entry, index) in currentExecutionTrace" :key="`${entry.stage}-${entry.at}`">
                  <time>{{ formatExecutionTime(entry.at) }}</time>
                  <span>
                    <b>{{ executionStageLabel(entry.stage) }}</b>
                    <em>本步 +{{ formatPreciseElapsed(executionElapsedMs(currentExecutionTrace, index)) }} · 本次累计 {{ formatPreciseElapsed(executionTotalMs(currentExecutionTrace, index)) }}</em>
                    {{ entry.message ? `：${entry.message}` : '' }}
                    <details v-if="executionDetailRows(entry.details).length" class="coloring-execution-detail">
                      <summary>查看发送／接收详细数据</summary>
                      <dl>
                        <template v-for="row in executionDetailRows(entry.details)" :key="`${entry.stage}-${row.key}`">
                          <dt>{{ row.label }}</dt>
                          <dd><pre>{{ row.value }}</pre></dd>
                        </template>
                      </dl>
                    </details>
                  </span>
                </li>
              </ol>
              <small v-if="executionAttemptGroups.length > 1">此前 {{ executionAttemptGroups.length - 1 }} 次执行已分开，不计入本次累计耗时。</small>
            </div>
            <small v-else-if="['completed', 'done', 'failed', 'cancelled', 'canceled', 'paused'].includes(activeHistoryItem.status)">该任务创建于详细日志上线前，当前显示数据库记录的时间与自动计算耗时。</small>
            <small v-else>任务尚未被 Worker 领取；当前仅显示数据库时间。</small>
          </details>
          </Teleport>
        </div>
      </aside>

      <section class="coloring-stage">
        <div
          ref="stageShell"
          class="coloring-stage-shell"
          :class="{ 'is-fullscreen': isFullscreen }"
        >
          <div class="coloring-stage-toolbar">
            <div class="coloring-stage-toolbar-main">
              <div class="coloring-view-toggle" aria-label="视图模式">
                <button
                  type="button"
                  :class="{ active: compareMode === 'result' }"
                  :aria-pressed="compareMode === 'result'"
                  :title="resultUrl ? '仅显示染色结果' : '显示线稿预览'"
                  @click="setCompareMode('result')"
                >
                  <i class="bi bi-image"></i>
                  <span>{{ resultUrl ? '结果' : '预览' }}</span>
                </button>
                <button
                  type="button"
                  class="coloring-compare-toggle"
                  :class="{ active: compareMode === 'split', ready: canCompare }"
                  :disabled="!canCompare"
                  :aria-pressed="compareMode === 'split'"
                  title="并排对比原线稿与染色结果"
                  @click="setCompareMode('split')"
                >
                  <i class="bi bi-layout-split"></i>
                  <span>对比</span>
                </button>
              </div>

              <div class="coloring-fit-toggle" aria-label="画面适配">
                <button
                  type="button"
                  :class="{ active: fitMode === 'contain' }"
                  :aria-pressed="fitMode === 'contain'"
                  title="完整适配画面"
                  @click="setFitMode('contain')"
                >
                  <i class="bi bi-aspect-ratio"></i>
                  <span>适配</span>
                </button>
                <button
                  type="button"
                  :class="{ active: fitMode === 'cover' }"
                  :aria-pressed="fitMode === 'cover'"
                  title="铺满裁切，可拖动画面查看"
                  @click="setFitMode('cover')"
                >
                  <i class="bi bi-arrows-fullscreen"></i>
                  <span>铺满</span>
                </button>
              </div>
            </div>

            <div class="coloring-tool-strip">
              <button
                v-if="activeBatchItems.length > 1"
                type="button"
                class="coloring-tool-btn"
                :class="{ active: batchGridMode }"
                title="批量结果对比"
                @click="showBatchGrid"
              >
                <i class="bi bi-grid-3x3-gap"></i>
                <span>批量对比</span>
              </button>
              <button
                type="button"
                class="coloring-tool-btn"
                :class="{ active: isFullscreen }"
                :title="
                  isFullscreen ? '退出全屏' : compareMode === 'split' ? '全屏对比预览' : '全屏预览'
                "
                @click="toggleFullscreen"
              >
                <i class="bi" :class="isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'"></i>
                <span>{{ isFullscreen ? '退出' : '全屏' }}</span>
              </button>
              <button
                type="button"
                class="coloring-tool-btn"
                :disabled="!resultUrl"
                title="下载结果"
                @click="downloadResult"
              >
                <i class="bi bi-download"></i>
                <span>下载</span>
              </button>
              <button
                type="button"
                class="coloring-tool-btn"
                :disabled="!resultUrl || submittingShare || activeHistoryItem?.shareSubmitted"
                title="提交到 Share 审核"
                @click="openSharePublish"
              >
                <i
                  class="bi"
                  :class="submittingShare ? 'bi-arrow-repeat spin' : 'bi-send-check'"
                ></i>
                <span>{{ activeHistoryItem?.shareSubmitted ? '已提交' : 'Share' }}</span>
              </button>
              <button
                type="button"
                class="coloring-tool-btn"
                :disabled="!resultUrl || controlsLocked || loading"
                title="继续二次染色"
                @click="useResultAsSource"
              >
                <i class="bi bi-layers"></i>
                <span>二次染色</span>
              </button>
              <button
                v-if="showDebugTools"
                type="button"
                class="coloring-tool-btn"
                title="调试信息"
                @click="toggleDebugPanel"
              >
                <i class="bi bi-info-circle"></i>
                <span>信息</span>
              </button>
              <div class="coloring-tool-meta" aria-label="状态与设置">
                <span class="coloring-status-chip" :class="{ running: loading || submitting }">
                  <i
                    class="bi"
                    :class="loading || submitting ? 'bi-arrow-repeat spin' : 'bi-magic'"
                  ></i>
                  {{ stageHint }}
                </span>
                <span v-if="creditCost > 0" class="coloring-credit-chip">
                  <i class="bi bi-coin"></i>
                  {{ totalCreditCost }} 积分
                </span>
                <button
                  v-if="showDebugTools"
                  type="button"
                  class="coloring-icon-btn"
                  title="调试"
                  @click="toggleDebugPanel"
                >
                  <i class="bi bi-bug"></i>
                </button>
                <button type="button" class="coloring-icon-btn" title="设置" @click="openSettings">
                  <i class="bi bi-gear"></i>
                </button>
              </div>
            </div>
          </div>

          <ColoringDebugPanel
            v-if="showDebugTools"
            :open="debugOpen"
            :info="debugInfo"
            @close="closeDebugPanel"
          />

          <div class="coloring-canvas-area" :data-orientation="imageOrientation">
            <aside
              class="coloring-ref-float"
              :class="{ 'is-collapsed': referencePanelCollapsed }"
              aria-label="风格参考图"
            >
              <button
                v-if="referencePanelCollapsed"
                type="button"
                class="coloring-ref-float-chip"
                title="展开参考图"
                aria-expanded="false"
                @click="toggleReferencePanel"
              >
                <i class="bi bi-images"></i>
                <span>参考</span>
                <em>{{ referenceImages.length }}/{{ MAX_REFERENCE_IMAGES }}</em>
              </button>

              <div v-else class="coloring-ref-float-panel">
                <header class="coloring-ref-float-head">
                  <div class="coloring-ref-float-title">
                    <strong>参考图</strong>
                    <small>可选 · {{ MAX_REFERENCE_IMAGES }} 张</small>
                  </div>
                  <div class="coloring-ref-float-actions">
                    <button
                      v-if="referenceImages.length"
                      type="button"
                      class="coloring-text-btn"
                      :disabled="controlsLocked"
                      @click="clearReferenceImages"
                    >
                      清空
                    </button>
                    <button
                      type="button"
                      class="coloring-ref-float-collapse"
                      title="收起参考图"
                      aria-expanded="true"
                      @click="toggleReferencePanel"
                    >
                      <i class="bi bi-chevron-left"></i>
                    </button>
                  </div>
                </header>

                <div v-if="referenceImages.length" class="coloring-reference-strip">
                  <div
                    v-for="item in referenceImages"
                    :key="item.id"
                    class="coloring-reference-card"
                    :title="item.name"
                  >
                    <AuthenticatedImage
                      :src="item.thumbUrl || item.previewUrl"
                      alt="参考图"
                      loading="lazy"
                    />
                    <button
                      type="button"
                      class="coloring-reference-remove"
                      :disabled="controlsLocked"
                      title="移除参考图"
                      @click="removeReferenceImage(item.id)"
                    >
                      <i class="bi bi-x"></i>
                    </button>
                  </div>
                  <button
                    v-if="referenceImages.length < MAX_REFERENCE_IMAGES"
                    type="button"
                    class="coloring-reference-add"
                    :disabled="controlsLocked"
                    title="添加参考图"
                    @click="triggerUpload(referenceInput)"
                  >
                    <i class="bi bi-plus-lg"></i>
                  </button>
                </div>

                <button
                  v-else
                  type="button"
                  class="coloring-reference-empty"
                  :disabled="controlsLocked"
                  @click="triggerUpload(referenceInput)"
                >
                  <i class="bi bi-images"></i>
                  <span>添加风格参考图</span>
                </button>
              </div>

              <input
                ref="referenceInput"
                type="file"
                accept="image/*"
                multiple
                hidden
                @change="handleReferenceInput"
              />
            </aside>

            <div
              v-if="sourcePreview || resultUrl || loading || showFailedResult()"
              class="coloring-board"
              :class="{
                'is-split': boardIsSplit(),
                'is-single': !boardIsSplit(),
                'is-panning': isPanning,
                'is-cover': fitMode === 'cover',
                'is-transitioning': boardTransition,
                'is-batch-results': showBatchResults,
                'is-grab': (canPan() || zoom > 1) && !isPanning,
                'is-grabbing': (canPan() || zoom > 1) && isPanning,
                [`is-${displayOrientation}`]: true,
              }"
              :style="
                boardIsSplit()
                  ? sharedCompareAspectStyle
                  : !boardIsSplit() && resultUrl
                    ? resultFrameAspectStyle
                    : frameAspectStyle
              "
            >
              <article
                v-if="showSourceFrame()"
                class="coloring-frame is-source"
                :style="boardIsSplit() ? sharedCompareAspectStyle : frameAspectStyle"
              >
                <div class="coloring-frame-chrome">
                  <span class="coloring-frame-badge">原线稿</span>
                  <small v-if="sourceInfoText" class="coloring-frame-meta">{{
                    sourceInfoText
                  }}</small>
                </div>
                <ColoringFrameMedia
                  v-if="sourcePreview"
                  :key="`source-${canvasMediaKey}`"
                  :src="sourcePreview"
                  alt="原线稿"
                  frame-key="source"
                  :fit-mode="fitMode"
                  :media-key="canvasMediaKey"
                  :pannable="canPan() || zoom > 1"
                  @mount-body="onFrameBodyMount"
                  @register-transform="onRegisterTransform"
                  @pan-start="onPanStart"
                  @pan-move="onPanMove"
                  @pan-end="onPanEnd"
                  @zoom-wheel="onZoomWheel"
                  @zoom-double-click="onZoomDoubleClick"
                />
                <div v-else class="coloring-frame-body">
                  <div class="coloring-frame-empty">
                    <i class="bi bi-image"></i>
                    <p>等待上传线稿</p>
                  </div>
                </div>
              </article>

              <article
                v-if="showResultFrame()"
                class="coloring-frame is-result"
                :class="{
                  generating: loading && !resultUrl,
                  failed: showFailedResult(),
                  'is-batch': showBatchResults,
                }"
                :style="boardIsSplit() ? sharedCompareAspectStyle : resultFrameAspectStyle"
              >
                <div class="coloring-frame-chrome">
                  <span
                    class="coloring-frame-badge"
                    :class="{
                      live: loading && !resultUrl,
                      failed: showFailedResult(),
                    }"
                  >
                    {{
                      loading && !resultUrl ? '生成中' : showFailedResult() ? '失败' : '染色结果'
                    }}
                  </span>
                  <small v-if="loading && !resultUrl" class="coloring-frame-meta">
                    {{ statusText || 'AI 正在上色'
                    }}<template v-if="coloringElapsedText"> · {{ coloringElapsedText }}</template>
                  </small>
                </div>
                <template v-if="showBatchResults">
                  <div class="coloring-frame-body coloring-batch-stage">
                    <div class="coloring-batch-head">
                      <div>
                        <strong>批量结果对比</strong>
                        <small
                          >同一风格生成
                          {{ activeBatchItems.length }} 张，完成后可点选查看高清结果</small
                        >
                      </div>
                      <span> {{ batchResultItems.length }}/{{ activeBatchItems.length }} </span>
                    </div>
                    <div class="coloring-batch-grid" aria-label="批量生成结果横向列表">
                      <button
                        v-for="item in activeBatchItems"
                        :key="item.id"
                        type="button"
                        class="coloring-batch-card"
                        :class="{
                          active: activeHistoryId === item.id,
                          running: isRunningStatus(item.status),
                          empty: !item.resultThumbUrl && !item.resultUrl,
                          'is-revealing': isBatchCardRevealing(item.id),
                        }"
                        @click="openBatchItem(item)"
                      >
                        <AuthenticatedImage
                          v-if="item.resultUrl || item.resultThumbUrl"
                          :src="item.resultUrl || item.resultThumbUrl"
                          :alt="`染色结果 ${item.variantIndex || 1}`"
                          loading="lazy"
                        />
                        <span v-else class="coloring-batch-placeholder">
                          <i class="bi bi-arrow-repeat spin"></i>
                        </span>
                        <em>#{{ item.variantIndex || 1 }}</em>
                        <span class="coloring-batch-card-state">
                          {{
                            item.resultUrl || item.resultThumbUrl
                              ? '已完成'
                              : isRunningStatus(item.status)
                                ? '生成中'
                                : historyStatusLabel(item)
                          }}
                        </span>
                      </button>
                    </div>
                    <div class="coloring-batch-status">
                      <strong>
                        已完成 {{ batchResultItems.length }} / {{ activeBatchItems.length }}
                      </strong>
                      <small v-if="batchRunningCount">仍有 {{ batchRunningCount }} 张处理中</small>
                      <small v-else>点击任意结果查看高清图</small>
                    </div>
                  </div>
                </template>
                <template v-else-if="loading && !resultUrl">
                  <div class="coloring-frame-body">
                    <div class="coloring-generating">
                      <div class="coloring-gen-backdrop" aria-hidden="true"></div>
                      <div class="coloring-gen-orb" aria-hidden="true"></div>
                      <div class="coloring-gen-orbit" aria-hidden="true">
                        <div class="coloring-gen-ring"></div>
                        <div class="coloring-gen-ring-track"></div>
                        <span class="coloring-gen-ring-tip"></span>
                      </div>
                      <div class="coloring-gen-brush" aria-hidden="true">
                        <i class="bi bi-brush-fill"></i>
                      </div>
                      <div class="coloring-gen-copy">
                        <strong>{{ statusText || 'AI 正在染色…' }}</strong>
                        <p>色彩正在铺开，请稍候</p>
                        <div class="coloring-gen-dots" aria-hidden="true">
                          <span></span><span></span><span></span>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <div
                  v-else-if="resultUrl"
                  class="coloring-result-stage"
                  :class="{ 'is-revealing': resultRevealing || !!holdoverResultUrl }"
                >
                  <AuthenticatedImage
                    v-if="holdoverResultUrl"
                    :src="holdoverResultUrl"
                    alt=""
                    class="coloring-result-holdover"
                    draggable="false"
                  />
                  <ColoringFrameMedia
                    :key="`result-${canvasMediaKey}-${displayResultUrl}`"
                    :src="displayResultUrl"
                    alt="染色结果"
                    frame-key="result"
                    :fit-mode="fitMode"
                    :media-key="`${canvasMediaKey}-${displayResultUrl}`"
                    :pannable="canPan() || zoom > 1"
                    class="coloring-result-frame-media"
                    :class="{ 'is-revealing': resultRevealing || !!holdoverResultUrl }"
                    @mount-body="onFrameBodyMount"
                    @register-transform="onRegisterTransform"
                    @pan-start="onPanStart"
                    @pan-move="onPanMove"
                    @pan-end="onPanEnd"
                    @zoom-wheel="onZoomWheel"
                    @zoom-double-click="onZoomDoubleClick"
                    @load="onResultImageLoaded"
                    @error="onResultImageError"
                  />
                </div>
                <div v-else-if="showFailedResult()" class="coloring-frame-body">
                  <div class="coloring-frame-empty is-failed">
                    <i class="bi bi-exclamation-triangle"></i>
                    <p>{{ failedResultMessage }}</p>
                    <button
                      type="button"
                      class="coloring-empty-retry"
                      :disabled="controlsLocked || loading"
                      @click="retryFailedJob"
                    >
                      重试
                    </button>
                  </div>
                </div>
                <div v-else class="coloring-frame-body">
                  <div class="coloring-frame-empty">
                    <div class="coloring-empty-mark" aria-hidden="true"></div>
                    <i class="bi bi-palette2"></i>
                    <p>选择风格后开始染色</p>
                  </div>
                </div>
              </article>
            </div>

            <div v-else class="coloring-board-empty coloring-board-empty--action">
              <div class="coloring-empty-orb" aria-hidden="true"></div>
              <strong>上传线稿开始创作</strong>
              <p>竖图、横图都会按比例展示，像画廊一样并排对比</p>
              <button
                type="button"
                class="coloring-empty-upload"
                :disabled="controlsLocked || sourceUploading"
                @click="triggerUpload(fileInput)"
              >
                <i class="bi bi-cloud-arrow-up"></i>
                选择线稿
              </button>
            </div>

            <div
              v-if="sourcePreview && !showBatchResults"
              class="coloring-canvas-gesture-hint"
              :class="{ active: zoom > 1 || boardIsSplit() }"
            >
              <i
                class="bi"
                :class="
                  boardIsSplit()
                    ? zoom > 1
                      ? 'bi-arrows-move'
                      : 'bi-layout-split'
                    : zoom > 1
                      ? 'bi-arrows-move'
                      : 'bi-mouse2'
                "
              ></i>
              <span>{{ compareGestureHint }}</span>
            </div>
          </div>

          <div v-if="historyViewItems.length" class="coloring-history-rail">
            <div ref="historyTrack" class="coloring-history-track">
              <button
                v-for="item in historyViewItems"
                :key="item.id"
                type="button"
                class="coloring-history-card"
                :data-history-group="item.id"
                :class="{
                  active: item.active,
                  running: item.running,
                  failed: item.status === 'failed',
                }"
                :aria-current="item.active ? 'true' : undefined"
                @click="openHistoryGroup(item)"
              >
                <span class="coloring-history-thumb-pair" aria-hidden="true">
                  <span class="coloring-history-thumb is-source">
                    <AuthenticatedImage
                      v-if="item.sourceThumb"
                      :src="item.sourceThumb"
                      alt=""
                      loading="lazy"
                      root-margin="240px 0px"
                    />
                    <i v-else class="bi bi-file-image"></i>
                  </span>
                  <span
                    class="coloring-history-thumb is-result"
                    :class="{
                      empty: !item.resultThumb,
                      failed: item.status === 'failed',
                    }"
                  >
                    <AuthenticatedImage
                      v-if="item.resultThumb"
                      :src="item.resultThumb"
                      alt=""
                      loading="lazy"
                      root-margin="240px 0px"
                    />
                    <i
                      v-if="!item.resultThumb"
                      class="bi"
                      :class="item.status === 'failed' ? 'bi-exclamation-triangle' : 'bi-palette2'"
                    ></i>
                    <em v-if="item.running" class="coloring-history-live"></em>
                  </span>
                </span>
                <span class="coloring-history-copy">
                  <span class="coloring-history-title">{{ item.title }}</span>
                  <span class="coloring-history-meta">
                    {{ item.statusLabel }}
                    <template v-if="item.timeLabel"> · {{ item.timeLabel }}</template>
                  </span>
                </span>
                <span
                  class="coloring-history-remove"
                  :class="{ disabled: item.running }"
                  title="删除"
                  @click.stop="requestRemoveHistoryItem(item)"
                >
                  <i class="bi bi-x"></i>
                </span>
              </button>
              <button
                v-if="historyGroups.length > HISTORY_RAIL_LIMIT"
                type="button"
                class="coloring-history-more"
                ref="historyMoreButton"
                :aria-label="`查看全部历史，还有 ${historyGroups.length - HISTORY_RAIL_LIMIT} 条`"
                @click="openHistoryBrowser"
              >
                <span class="coloring-history-more-icon" aria-hidden="true">
                  <i class="bi bi-grid"></i>
                </span>
                <span class="coloring-history-more-copy">
                  <strong>查看全部</strong>
                  <small>浏览历史记录</small>
                </span>
                <span class="coloring-history-more-count">
                  +{{ historyGroups.length - HISTORY_RAIL_LIMIT }}
                </span>
                <i class="bi bi-chevron-right coloring-history-more-arrow" aria-hidden="true"></i>
              </button>
              <button
                v-if="activeHistoryItem?.serverJobId"
                type="button"
                class="coloring-history-more coloring-history-trace-toggle"
                aria-label="展开当前任务执行日志"
                aria-haspopup="dialog"
                @click.stop="showExecutionTrace = true"
              >
                <i class="bi bi-activity" aria-hidden="true"></i>
                <span>执行日志</span>
                <small>点击展开</small>
              </button>
            </div>
          </div>

          <section
            v-if="historyPanelMode"
            class="coloring-history-picker"
            :style="historyPickerStyle"
            :class="{ 'is-history': historyPanelMode === 'history' }"
            :aria-label="historyPanelMode === 'variants' ? '选择生成结果' : '选择历史记录'"
          >
            <header>
              <div>
                <strong>{{
                  historyPanelMode === 'variants' ? '选择本次生成结果' : '全部历史'
                }}</strong>
                <small>
                  {{
                    historyPanelMode === 'variants'
                      ? `共 ${historyPanelItems.length} 张，可查看原始清晰结果`
                      : `第 ${historyPanelPage} / ${historyPanelPages} 页`
                  }}
                </small>
              </div>
              <button
                type="button"
                class="coloring-icon-btn"
                title="关闭"
                @click="closeHistoryPanel"
              >
                <i class="bi bi-x-lg"></i>
              </button>
            </header>
            <div class="coloring-history-picker-grid">
              <button
                v-for="item in historyPanelItems"
                :key="historyPanelMode === 'variants' ? item.id : item.id"
                type="button"
                class="coloring-history-picker-card"
                :class="{
                  active:
                    historyPanelMode === 'variants' ? activeHistoryId === item.id : item.active,
                  running: item.running || isRunningStatus(item.status),
                }"
                @click="selectHistoryPanelItem(item)"
              >
                <span v-if="historyPanelMode === 'history'" class="coloring-history-picker-pair">
                  <span class="coloring-history-picker-image is-source">
                    <AuthenticatedImage
                      v-if="item.sourceThumb"
                      :src="item.sourceThumb"
                      alt=""
                      loading="lazy"
                      root-margin="220px 0px"
                    />
                    <i v-if="!item.sourceThumb" class="bi bi-pencil-square"></i>
                    <em>线稿</em>
                  </span>
                  <span class="coloring-history-picker-image is-result">
                    <AuthenticatedImage
                      v-if="item.resultThumb"
                      :src="item.resultThumb"
                      alt=""
                      loading="lazy"
                      root-margin="220px 0px"
                    />
                    <i v-if="!item.resultThumb" class="bi bi-palette2"></i>
                    <em>生成图</em>
                  </span>
                </span>
                <span v-else class="coloring-history-picker-image">
                  <AuthenticatedImage
                    v-if="item.resultUrl || item.resultThumbUrl || item.sourceThumbUrl"
                    :src="item.resultUrl || item.resultThumbUrl || item.sourceThumbUrl"
                    alt=""
                    loading="lazy"
                    root-margin="220px 0px"
                  />
                  <i
                    v-if="!(item.resultUrl || item.resultThumbUrl || item.sourceThumbUrl)"
                    class="bi bi-palette2"
                  ></i>
                </span>
                <span>
                  <strong>{{
                    historyPanelMode === 'variants' ? `结果 #${item.variantIndex || 1}` : item.title
                  }}</strong>
                  <small>{{
                    historyPanelMode === 'variants' ? historyStatusLabel(item) : item.statusLabel
                  }}</small>
                </span>
              </button>
            </div>
            <footer v-if="historyPanelMode === 'history' && historyPanelPages > 1">
              <button
                type="button"
                class="coloring-history-page-btn"
                :disabled="historyPanelPage <= 1"
                @click="setHistoryPanelPage(historyPanelPage - 1)"
              >
                <i class="bi bi-chevron-left"></i>
              </button>
              <span>{{ historyPanelPage }} / {{ historyPanelPages }}</span>
              <button
                type="button"
                class="coloring-history-page-btn"
                :disabled="historyPanelPage >= historyPanelPages"
                @click="setHistoryPanelPage(historyPanelPage + 1)"
              >
                <i class="bi bi-chevron-right"></i>
              </button>
            </footer>
          </section>
        </div>
      </section>
    </div>

    <ColoringFavoritePicker
      :open="favoritePickerOpen"
      @close="closeFavoritePicker"
      @select="applyFavoriteWallpaper"
    />

    <ColoringSettingsDialog
      :show="settingsOpen"
      :settings="settings"
      :models="publicModels"
      :source-width="sourceMeta.width"
      :source-height="sourceMeta.height"
      @close="closeSettings"
      @save="saveSettings"
    />

    <div
      v-if="pendingDeleteHistoryItem"
      class="coloring-confirm-backdrop"
      role="presentation"
      @click.self="closeDeleteHistoryDialog"
    >
      <section
        class="coloring-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="删除历史"
      >
        <header>
          <span class="coloring-confirm-mark">
            <i class="bi bi-trash3"></i>
          </span>
          <div>
            <strong>删除这条历史？</strong>
            <p>会同时从本地历史存储移除缩略图、原图地址和结果记录。</p>
          </div>
        </header>
        <div class="coloring-confirm-target">
          <span>{{
            pendingDeleteHistoryItem.title || pendingDeleteHistoryItem.styleLabel || '插画染色'
          }}</span>
          <small>{{
            pendingDeleteHistoryItem.statusLabel || historyStatusLabel(pendingDeleteHistoryItem)
          }}</small>
        </div>
        <footer>
          <button
            type="button"
            class="coloring-confirm-secondary"
            @click="closeDeleteHistoryDialog"
          >
            取消
          </button>
          <button type="button" class="coloring-confirm-danger" @click="confirmRemoveHistoryItem">
            删除
          </button>
        </footer>
      </section>
    </div>

    <AiCostConfirmDialog
      :show="costConfirmOpen"
      :cost="pendingCost"
      @confirm="resolveCostConfirm(true)"
      @cancel="resolveCostConfirm(false)"
    />

    <InsufficientCreditsDialog
      :show="creditsDialogOpen"
      :required="requiredCredits"
      :available="availableCredits"
      @close="closeCreditsDialog"
    />

    <SharePublishDialog
      :open="sharePublishOpen"
      :title="activeHistoryItem?.title || workTitle || ''"
      :style-label="activeHistoryItem?.styleLabel || activeStyle?.label || ''"
      :submitting="submittingShare"
      @close="sharePublishOpen = false"
      @submit="confirmSharePublish"
    />
  </div>
</template>
