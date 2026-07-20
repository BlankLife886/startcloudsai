<script setup>
import AiCostConfirmDialog from '@/components/wallpaper/fullscreen-preview/features/ai/AiCostConfirmDialog.vue'
import InsufficientCreditsDialog from '@/components/profile/InsufficientCreditsDialog.vue'
import { enrichStudioCreditCostSnapshot } from '@/features/ai-shared/studioUsage'
import WallpaperAiPanel from '@/components/wallpaper/fullscreen-preview/features/ai/WallpaperAiPanel.vue'
import { usePreviewAiProcessing } from '@/components/wallpaper/fullscreen-preview/features/ai/usePreviewAiProcessing'
import { usePreviewAiState } from '@/components/wallpaper/fullscreen-preview/features/ai/usePreviewAiState'
import WallpaperPreviewComparisonStage from '@/components/wallpaper/fullscreen-preview/features/compare/WallpaperPreviewComparisonStage.vue'
import WallpaperDecomposePanel from '@/components/wallpaper/fullscreen-preview/features/decompose/WallpaperDecomposePanel.vue'
import WallpaperPreviewMockupStage from '@/components/wallpaper/fullscreen-preview/features/mockup/WallpaperPreviewMockupStage.vue'
import { usePreviewEffects } from '@/components/wallpaper/fullscreen-preview/features/filters/usePreviewEffects'
import WallpaperPreviewFilterPanel from '@/components/wallpaper/fullscreen-preview/features/filters/WallpaperPreviewFilterPanel.vue'
import WallpaperPreviewInfoPanel from '@/components/wallpaper/fullscreen-preview/features/info/WallpaperPreviewInfoPanel.vue'
import WallpaperPreviewTopBar from '@/components/wallpaper/fullscreen-preview/features/toolbar/WallpaperPreviewTopBar.vue'
import WallpaperPreviewZoomHint from '@/components/wallpaper/fullscreen-preview/features/viewport/WallpaperPreviewZoomHint.vue'
import { usePreviewDisplayState } from '@/components/wallpaper/fullscreen-preview/features/display/usePreviewDisplayState'
import { usePreviewFavorite } from '@/components/wallpaper/fullscreen-preview/features/favorite/usePreviewFavorite'
import { usePreviewShell } from '@/components/wallpaper/fullscreen-preview/features/shell/usePreviewShell'
import { usePreviewSessionLifecycle } from '@/components/wallpaper/fullscreen-preview/features/shell/usePreviewSessionLifecycle'
import { usePreviewLoader } from '@/components/wallpaper/fullscreen-preview/features/loader/usePreviewLoader'
import { usePreviewModeCoordinator } from '@/components/wallpaper/fullscreen-preview/features/modes/usePreviewModeCoordinator'
import { useDesktopMockupSettings } from '@/components/wallpaper/fullscreen-preview/features/mockup/useDesktopMockupSettings'
import { usePreviewMockup } from '@/components/wallpaper/fullscreen-preview/features/mockup/usePreviewMockup'
import { usePreviewViewport } from '@/components/wallpaper/fullscreen-preview/features/viewport/usePreviewViewport'
import {
  loadCanvasSafeImageFromSrc,
} from '@/components/wallpaper/fullscreen-preview/composables/useCanvasSafeImage'
import { hasColorGradeAdjustment } from '@/features/filters/filterEngine'
import { usePreviewResult } from '@/components/wallpaper/fullscreen-preview/composables/usePreviewResult'
import { usePreviewCrop } from '@/components/wallpaper/fullscreen-preview/features/crop/usePreviewCrop'
import { useImageDecompose } from '@/components/wallpaper/fullscreen-preview/features/decompose/useImageDecompose'
import notificationService from '@/services/notification'
import { webDebugGroup } from '@/services/debugLog'
import { useAuthStore } from '@/stores/auth'
import { useDownloadsStore } from '@/stores/downloads'
import { useFavoritesStore } from '@/stores/favorites'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useSettingsStore } from '@/stores/settings'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

// 获取store
const favoritesStore = useFavoritesStore()
const downloadsStore = useDownloadsStore()
const settingsStore = useSettingsStore()
const runtimeConfigStore = useRuntimeConfigStore()
const authStore = useAuthStore()
const fullscreenPreview = ref(null)
const mockupStageRef = ref(null)
const isResettingPreview = ref(false)
const pendingResetNotice = ref(false)
const downloadStatus = ref('idle')
const activeDownloadTaskId = ref(null)
let downloadStatusResetTimer = null
const showAiPanel = ref(false)
const aiCostConfirmVisible = ref(false)
const aiCostConfirmPayload = ref(null)
const aspectBackdropUrl = ref('')
const holdoverDisplayUrl = ref('')
let aiCostConfirmResolver = null

// 定义props
const props = defineProps({
  wallpaper: {
    type: Object,
    default: null,
  },
  show: {
    type: Boolean,
    default: false,
  },
  // 新增：是否在集合中（用于显示上一张/下一张按钮）
  inCollection: {
    type: Boolean,
    default: false,
  },
  // 新增：集合中的索引
  collectionIndex: {
    type: Number,
    default: -1,
  },
  // 新增：集合总数
  collectionTotal: {
    type: Number,
    default: 0,
  },
  enabledActions: {
    type: Object,
    default: null,
  },
})

// 定义emit
const emit = defineEmits(['close', 'next', 'previous'])

const wallpaperRef = computed(() => props.wallpaper)
const aiWallpaperLayout = computed(() => runtimeConfigStore.getPageLayout('aiWallpaper') || {})
const canUsePreviewDownload = computed(() => runtimeConfigStore.canUse('download'))
const canUsePreviewFavorite = computed(() => runtimeConfigStore.canUse('favorite'))
const canUsePreviewFilters = computed(() => runtimeConfigStore.canUse('filters'))
const showPreviewAiAction = computed(() => aiWallpaperLayout.value?.optimize?.enabled !== false)
const canUsePreviewAi = computed(
  () => runtimeConfigStore.canUse('ai.optimize') && showPreviewAiAction.value,
)
function actionEnabled(key) {
  return props.enabledActions?.[key] !== false
}
const canOpenPreviewAi = computed(() => canUsePreviewAi.value && actionEnabled('ai'))
const previewEnabledActions = computed(() => ({
  favorite: canUsePreviewFavorite.value && actionEnabled('favorite'),
  download: canUsePreviewDownload.value && actionEnabled('download'),
  filters: canUsePreviewFilters.value && actionEnabled('filters'),
  ai: showPreviewAiAction.value && actionEnabled('ai'),
  mockup: actionEnabled('mockup'),
  rotate: actionEnabled('rotate'),
  fit: actionEnabled('fit'),
  info: actionEnabled('info'),
  compare: actionEnabled('compare'),
  crop: actionEnabled('crop'),
  decompose: actionEnabled('decompose'),
  fullscreen: actionEnabled('fullscreen'),
}))
const previewAiRuntimeConfig = computed(() => runtimeConfigStore.getFeaturePayload('ai.optimize') || {})
const previewAiRuntimeLimits = computed(() => ({
  dailyAiJobs:
    Number(previewAiRuntimeConfig.value.dailyAiJobs || runtimeConfigStore.config.limits?.dailyAiJobs || 0) || 0,
  maxUploadMb:
    Number(previewAiRuntimeConfig.value.maxUploadMb || runtimeConfigStore.config.limits?.maxUploadMb || 0) || 0,
}))

function getRuntimeDisabledMessage(featureKey, fallback) {
  if (runtimeConfigStore.isBlocked) return runtimeConfigStore.blockReason
  return runtimeConfigStore.getFeatureConfig(featureKey)?.message || fallback
}

async function confirmAiCost(cost) {
  if (aiCostConfirmResolver) {
    aiCostConfirmResolver(false)
    aiCostConfirmResolver = null
  }
  aiCostConfirmPayload.value = await enrichStudioCreditCostSnapshot(cost)
  aiCostConfirmVisible.value = true
  return new Promise((resolve) => {
    aiCostConfirmResolver = resolve
  })
}

function resolveAiCostConfirm(confirmed) {
  if (aiCostConfirmResolver) {
    aiCostConfirmResolver(confirmed)
    aiCostConfirmResolver = null
  }
  aiCostConfirmVisible.value = false
  aiCostConfirmPayload.value = null
}

function handleClosePreview() {
  resolveAiCostConfirm(false)
  clearDownloadStatusResetTimer()
  downloadStatus.value = 'idle'
  activeDownloadTaskId.value = null
  closePreview()
}

onBeforeUnmount(() => {
  resolveAiCostConfirm(false)
  clearDownloadStatusResetTimer()
})

const {
  isZoomed,
  zoomLevel,
  isFullscreen,
  previewContainer,
  imageElement,
  isDragging,
  offsetX,
  offsetY,
  rotation,
  fitMode,
  transformStyle,
  cursorStyle,
  imageObjectFit,
  imageSizingStyle,
  showMinimap,
  minimapStyle,
  minimapViewportStyle,
  currentFitMode,
  resetViewportState,
  toggleZoom,
  handleZoomIn,
  handleZoomOut,
  resetZoom,
  handleWheel,
  rotateImage,
  toggleFitMode,
  toggleFullscreen,
  startDrag,
  applyConstraints,
  startMinimapDrag,
  exitFullscreenIfActive,
  applyPreferredFitMode,
  handleFullscreenChange,
  cleanupViewport,
} = usePreviewViewport({
  getPreferredFitMode: () => settingsStore.getSetting('fullscreen_preview_fit_mode', 'contain'),
  onControlsActivity: () => {
    showControls.value = true
    startControlsTimer()
  },
})

const {
  showFilters,
  activeFilter,
  filterIntensity,
  activeArtStyle,
  artStyleIntensity,
  artStyleParams,
  selectedPresetId,
  customPresets,
  filterParams,
  filterHistory,
  historyIndex,
  comparisonMode,
  filterStyle,
  handleFilterChange,
  resetFilterParams,
  applyPresetById,
  applyArtStyle,
  setArtStyleIntensity,
  setArtStyleParam,
  saveCurrentAsCustomPreset,
  removeCustomPresetById,
  setFilterIntensity,
  undoFilter,
  redoFilter,
  setComparisonMode,
  toggleComparisonMode,
  resetEffectsState,
  cleanupEffectResources,
} = usePreviewEffects({ settingsStore })

function applyPresetFromPanel(presetId) {
  applyPresetById(presetId)
}

function onFilterIntensityChange(v) {
  setFilterIntensity(v)
}

function handleApplyArtStyle(styleId) {
  applyArtStyle(styleId)
}

function handleArtStyleIntensityChange(v) {
  setArtStyleIntensity(v)
}

function handleArtStyleParamChange(payload) {
  if (!payload?.key) return
  setArtStyleParam(payload.key, payload.value)
}

function handleSaveCustomPreset(label) {
  const result = saveCurrentAsCustomPreset(label)
  if (result.ok) {
    notificationService.success(`已保存预设：${result.preset.label}`, {
      duration: 2200,
      position: 'top-right',
    })
    return
  }
  if (result.reason === 'DUPLICATE_LABEL') {
    notificationService.warning('预设名称已存在，请换一个名字', {
      duration: 2600,
      position: 'top-right',
    })
    return
  }
  notificationService.warning('请输入预设名称后再保存', {
    duration: 2200,
    position: 'top-right',
  })
}

function handleRemoveCustomPreset(presetId) {
  const result = removeCustomPresetById(presetId)
  if (result.ok) {
    notificationService.info('已删除自定义预设', {
      duration: 2000,
      position: 'top-right',
    })
  }
}

function handleToggleFitMode() {
  if (!previewEnabledActions.value.fit) return
  const nextMode = toggleFitMode()
  settingsStore.setSetting('fullscreen_preview_fit_mode', nextMode)
}

function handleRotatePreview() {
  if (!previewEnabledActions.value.rotate) return
  if (cropMode.value) cancelCropMode()
  rotateImage(90)
}

const downloadProcessedPreviewUrl = ref('')

const {
  isLoading,
  error,
  imageUrl,
  previewImageUrl,
  sourceFullUrl,
  imageInfo,
  loadImage,
  loadImageInfo,
  handleDownloadSubmit,
  downloadDirectly,
  handleImageLoaded,
  handleImageError,
  retryLoadCurrentImage,
  resetLoaderState,
} = usePreviewLoader({
  wallpaperRef,
  imageElement,
  rotation,
  activeFilter,
  filterIntensity,
  filterParams,
  showFilters,
  activeArtStyle,
  artStyleIntensity,
  artStyleParams,
  selectedPresetId,
  downloadsStore,
  settingsStore,
  currentProcessedImageData: downloadProcessedPreviewUrl,
})

const basePreviewUrl = computed(() => previewImageUrl.value || imageUrl.value)
const {
  previewDisplayUrl,
  processedPreviewUrl,
  undoStack: aiUndoStack,
  applyProcessedResult,
  resetProcessedResult,
  undoProcessedResult,
} = usePreviewResult({ basePreviewUrl })

watch(
  processedPreviewUrl,
  (nextUrl) => {
    downloadProcessedPreviewUrl.value = nextUrl || ''
  },
  { immediate: true },
)

function clearDownloadStatusResetTimer() {
  if (!downloadStatusResetTimer) return
  clearTimeout(downloadStatusResetTimer)
  downloadStatusResetTimer = null
}

function scheduleDownloadStatusReset(delay = 1200) {
  clearDownloadStatusResetTimer()
  downloadStatusResetTimer = setTimeout(() => {
    downloadStatus.value = 'idle'
    activeDownloadTaskId.value = null
    downloadStatusResetTimer = null
  }, delay)
}

function setDownloadStatus(nextStatus) {
  clearDownloadStatusResetTimer()
  downloadStatus.value = nextStatus
}

async function runDownloadWithIconState(taskFactory) {
  if (downloadStatus.value === 'preparing' || downloadStatus.value === 'downloading') return

  setDownloadStatus('preparing')
  activeDownloadTaskId.value = null

  try {
    const taskId = await taskFactory()
    if (!taskId) {
      setDownloadStatus('failed')
      scheduleDownloadStatusReset(1400)
      return
    }
    activeDownloadTaskId.value = taskId
    setDownloadStatus('downloading')
  } catch (err) {
    console.error('下载触发失败:', err)
    setDownloadStatus('failed')
    scheduleDownloadStatusReset(1400)
  }
}

async function handlePreviewDownload() {
  await runtimeConfigStore.loadRuntimeConfig()
  if (!previewEnabledActions.value.download) {
    setDownloadStatus('failed')
    scheduleDownloadStatusReset(1400)
    notificationService.warning(getRuntimeDisabledMessage('download', '下载功能暂未开放'), {
      duration: 2800,
      position: 'top-right',
    })
    return
  }

  if (mockupMode.value === 'none') {
    await runDownloadWithIconState(() => downloadDirectly())
    return
  }

  await runDownloadWithIconState(async () => {
    const mockupImageData = await mockupStageRef.value?.exportMockupImage?.()
    if (!mockupImageData) {
      throw new Error('当前取景图片生成失败，请稍后重试')
    }

    return await handleDownloadSubmit({
      save_mode: settingsStore.getSetting('save_mode', 'default'),
      custom_folder: settingsStore.getSetting('custom_folder', ''),
      save_metadata: settingsStore.getSetting('save_metadata', false),
      overwrite: settingsStore.getSetting('overwrite', true),
      timeout: settingsStore.getSetting('timeout', 30),
      download_launch_delay_ms: settingsStore.getSetting('download_launch_delay_ms', 900),
      save_dir: settingsStore.getSetting('save_dir', '~/Downloads/星空云绘'),
      processedImageData: mockupImageData,
      useProcessedImage: true,
      customFilename: `${props.wallpaper?.id || 'wallpaper'}_${mockupMode.value}_wallpaper.jpg`,
      suppressNotifications: true,
    })
  })
}
const {
  cropMode,
  cropRect,
  cropReady,
  applyCropSelection,
  cancelCropMode,
  endCropSelection,
  enterCropMode,
  moveCropSelection,
  startCropSelection: startCropSelectionBase,
} = usePreviewCrop({
  imageElement,
  previewDisplayUrl,
  loadImageFromSrc,
  applyProcessedResult,
  notificationService,
})
const {
  decomposedTiles,
  transitionTiles,
  decomposeGridSize,
  decomposeImage: decomposeImageBase,
  decomposeLayoutMode,
  sourceAspectRatio,
  downloadDecomposedTiles,
  isDecomposeSwitching,
  resetDecompose,
  setDecomposeGridSize,
  showDecomposePanel,
  toggleDecomposedTile,
} = useImageDecompose({
  previewDisplayUrl,
  loadImageFromSrc,
  notificationService,
  getFilenamePrefix: () => props.wallpaper?.id || 'wallpaper',
})
const { isFavorite, syncFavoriteState, toggleFavorite } = usePreviewFavorite({
  wallpaperRef,
  favoritesStore,
})

function handleToggleFavorite() {
  if (!previewEnabledActions.value.favorite) {
    notificationService.warning(getRuntimeDisabledMessage('favorite', '收藏功能暂未开放'), {
      duration: 2600,
      position: 'top-right',
    })
    return
  }
  toggleFavorite()
}
const {
  mockupMode,
  clearMockupMode,
  toggleDesktopMockup: toggleDesktopMockupBase,
  togglePhoneMockup: togglePhoneMockupBase,
} = usePreviewMockup()
const { desktopMockupConfig, updateDesktopMockupConfig } = useDesktopMockupSettings({
  settingsStore,
})
const showMockupSettings = ref(false)

function bindComparisonProcessedImage(el) {
  imageElement.value = el || null
}

function toggleMockupSettings() {
  if (!previewEnabledActions.value.mockup) return
  showMockupSettings.value = !showMockupSettings.value
}

function handleDesktopMockupConfigUpdate(payload) {
  updateDesktopMockupConfig(payload)
}

watch(mockupMode, (mode) => {
  if (mode !== 'desktop') {
    showMockupSettings.value = false
  }
})

const {
  showInfo,
  showControls,
  formattedResolution,
  formattedFileSize,
  themeStyle,
  resetViewState,
  closePreview,
  toggleInfo: toggleInfoBase,
  showControlsOnMouseMove,
  setControlsHovered,
  startControlsTimer,
  clearControlsTimer,
} = usePreviewShell({
  props,
  emit,
  viewport: {
    isZoomed,
    zoomLevel,
    isDragging,
    offsetX,
    offsetY,
    resetViewportState,
    toggleZoom,
    handleZoomIn,
    handleZoomOut,
    resetZoom,
    rotateImage,
    toggleFullscreen,
    applyConstraints,
  },
  effects: {
    showFilters,
    comparisonMode,
    resetEffectsState,
    undoFilter,
    redoFilter,
  },
  loader: {
    showDownloadModal: ref(false),
    openDownloadModal: downloadDirectly,
    retryLoadCurrentImage,
    resetLoaderState,
  },
})

function toggleInfo() {
  if (!previewEnabledActions.value.info) return
  toggleInfoBase()
  const panelInfo = imageInfo.value || props.wallpaper
  const hasDetailedInfo = Array.isArray(panelInfo?.tags) && panelInfo.tags.length > 0
  if (showInfo.value && props.wallpaper?.id && !hasDetailedInfo) {
    loadImageInfo(props.wallpaper.id)
  }
}

const {
  aiLoading,
  aiError,
  aiStatusText,
  aiRetryable,
  aiSelectedModel,
  aiHistory,
  aiRecipeName,
  aiRecipes,
  aiCustomPrompt,
  aiOutputSize,
  aiSourceReferenceSize,
  aiModelOptions,
  aiImageProcessingConfig,
  addAiHistory,
  applyAiHistoryItem,
  applyAiRecipe,
  downloadAiHistoryItem,
  loadAiHistory,
  loadAiRecipes,
  removeAiRecipe,
  resetAiSourceReferenceSize,
  saveCurrentAiRecipe,
  selectConfiguredAiModel,
  undoLastAiOperation,
} = usePreviewAiState({
  settingsStore,
  runtimeConfigStore,
  notificationService,
  undoProcessedResult,
  applyProcessedResult,
  setComparisonMode,
  onApplyHistory: () => modeCoordinator.prepareApplyAiHistory(),
  getFilenamePrefix: () => props.wallpaper?.id || 'wallpaper',
})
const { generateAiPreview, applyAiAndDownload, creditsDialogOpen, requiredCredits, availableCredits, closeCreditsDialog } = usePreviewAiProcessing({
  props,
  imageElement,
  imageInfo,
  imageUrl,
  sourceFullUrl,
  previewDisplayUrl,
  processedPreviewUrl,
  settingsStore,
  runtimeConfigStore,
  authStore,
  notificationService,
  loadImageFromSrc,
  applyProcessedResult,
  setComparisonMode,
  downloadDirectly,
  confirmAiCost,
  aiState: {
    aiLoading,
    aiError,
    aiStatusText,
    aiRetryable,
    aiSelectedModel,
    aiCustomPrompt,
    aiOutputSize,
    aiSourceReferenceSize,
    aiImageProcessingConfig,
    addAiHistory,
  },
})
const previewAiTitle = computed(() => aiImageProcessingConfig.value.panelTitle || 'AI')

const {
  aspectBackdropStyle,
  originalImageCrossorigin,
  previewImageCrossorigin,
  processedImageStyle,
  processedLabel,
  showAspectBackdrop,
} = usePreviewDisplayState({
  activeArtStyle,
  activeFilter,
  aspectBackdropUrl,
  cursorStyle,
  filterStyle,
  filterParams,
  fitMode,
  imageObjectFit,
  imageSizingStyle,
  imageUrl,
  previewDisplayUrl,
  transformStyle,
})

const mockupFilterCss = computed(() => {
  if (activeArtStyle.value !== 'none') return ''
  if (hasColorGradeAdjustment(filterParams)) return ''
  return filterStyle.value?.filter || ''
})

function buildAspectBackdropFromImage(img) {
  if (!img?.naturalWidth || !img?.naturalHeight) {
    aspectBackdropUrl.value = ''
    return
  }

  try {
    const canvas = document.createElement('canvas')
    const maxSize = 64
    const ratio = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1)
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      aspectBackdropUrl.value = ''
      return
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    aspectBackdropUrl.value = canvas.toDataURL('image/jpeg', 0.52)
  } catch {
    // 跨域或 canvas 安全限制时，背景层降级为暗色渐变，不再额外拉取 full 图。
    aspectBackdropUrl.value = ''
  }
}

function onPreviewImageLoaded(event) {
  const loadedImg = event?.target || imageElement.value
  const loadedSrc = loadedImg?.currentSrc || loadedImg?.src || ''
  if (loadedSrc && loadedSrc === (previewDisplayUrl.value || imageUrl.value)) {
    buildAspectBackdropFromImage(loadedImg)
  }
  holdoverDisplayUrl.value = ''
  // 强制回到完整显示，避免上一张图或误触引起的缩放残留。
  resetZoom()
  applyConstraints()
  handleImageLoaded()
  if (pendingResetNotice.value) {
    setTimeout(() => {
      pendingResetNotice.value = false
      isResettingPreview.value = false
    }, 180)
  }
}

watch(previewDisplayUrl, (nextUrl, prevUrl) => {
  if (prevUrl && nextUrl && prevUrl !== nextUrl) {
    holdoverDisplayUrl.value = prevUrl
  }
})

watch(imageUrl, (url) => {
  if (!url) holdoverDisplayUrl.value = ''
  downloadStatus.value = 'idle'
  activeDownloadTaskId.value = null
  clearDownloadStatusResetTimer()
})

watch(canUsePreviewFilters, (enabled) => {
  if (!enabled) showFilters.value = false
})

watch(canOpenPreviewAi, (enabled) => {
  if (!enabled) showAiPanel.value = false
})

watch(previewEnabledActions, (actions) => {
  if (!actions.filters) showFilters.value = false
  if (!actions.ai) showAiPanel.value = false
  if (!actions.info) showInfo.value = false
  if (!actions.compare && comparisonMode.value !== 'none') setComparisonMode('none')
  if (!actions.crop && cropMode.value) cancelCropMode()
  if (!actions.decompose && showDecomposePanel.value) resetDecompose()
  if (!actions.fullscreen && isFullscreen.value) exitFullscreenIfActive()
  if (!actions.mockup) {
    clearMockupMode()
    showMockupSettings.value = false
  }
})

watch(
  () => {
    if (!activeDownloadTaskId.value) return null
    return downloadsStore.downloads.find((item) => item.id === activeDownloadTaskId.value) || null
  },
  (task) => {
    if (!task || downloadStatus.value === 'idle') return

    if (task.status === downloadsStore.DOWNLOAD_STATUS.COMPLETED) {
      setDownloadStatus('success')
      scheduleDownloadStatusReset(1300)
      return
    }

    if (
      task.status === downloadsStore.DOWNLOAD_STATUS.FAILED ||
      task.status === downloadsStore.DOWNLOAD_STATUS.CANCELED
    ) {
      setDownloadStatus('failed')
      scheduleDownloadStatusReset(1600)
      return
    }

    if (task.status === downloadsStore.DOWNLOAD_STATUS.DOWNLOADING) {
      setDownloadStatus('downloading')
    }
  },
  { deep: true },
)

function startCropSelection(event) {
  if (!previewEnabledActions.value.crop) return
  startCropSelectionBase(event, {
    comparisonMode: comparisonMode.value,
    mockupMode: mockupMode.value,
  })
}

function logAiSourceSizeCandidates() {
  const wallpaper = props.wallpaper || {}
  const thumbs = wallpaper.thumbs || {}
  const rawThumbs = wallpaper.raw_thumbs || {}

  webDebugGroup('ai', '[AI Source Debug] 三种尺寸候选', () => {
    console.log('thumbs.small:', thumbs.small || '')
    console.log('thumbs.large:', thumbs.large || '')
    console.log('thumbs.original:', thumbs.original || '')
    console.log('raw_thumbs.small:', rawThumbs.small || '')
    console.log('raw_thumbs.large:', rawThumbs.large || '')
    console.log('raw_thumbs.original:', rawThumbs.original || '')
    console.log('path/full:', wallpaper.path || wallpaper.raw_path || wallpaper.url || '')
  })
}

const modeCoordinator = usePreviewModeCoordinator({
  cropMode,
  currentFitMode,
  comparisonMode,
  mockupMode,
  showAiPanel,
  showDecomposePanel,
  settingsStore,
  applyPreferredFitMode,
  resetZoom,
  applyConstraints,
  cancelCropMode,
  enterCropMode,
  clearMockupMode,
  toggleDesktopMockup: toggleDesktopMockupBase,
  togglePhoneMockup: togglePhoneMockupBase,
  setComparisonMode,
  toggleComparisonMode,
  decomposeImage: decomposeImageBase,
  selectConfiguredAiModel,
  logAiSourceSizeCandidates,
})

async function toggleAiPanel() {
  await runtimeConfigStore.loadRuntimeConfig({ force: true }).catch(() => null)
  if (!canOpenPreviewAi.value) {
    showAiPanel.value = false
    notificationService.warning(getRuntimeDisabledMessage('ai.optimize', `${previewAiTitle.value}暂未开放`), {
      duration: 2800,
      position: 'top-right',
    })
    return
  }
  aiError.value = ''
  modeCoordinator.toggleAiPanel()
}

function toggleFiltersPanel() {
  if (!previewEnabledActions.value.filters) {
    showFilters.value = false
    notificationService.warning(getRuntimeDisabledMessage('filters', '图像滤镜暂未开放'), {
      duration: 2600,
      position: 'top-right',
    })
    return
  }
  showFilters.value = !showFilters.value
  if (showFilters.value) {
    showControls.value = true
    clearControlsTimer()
  }
}

async function resetPreviewState({ withFeedback = true, preserveMockup = false } = {}) {
  if (isResettingPreview.value) return
  isResettingPreview.value = withFeedback
  pendingResetNotice.value = withFeedback
  // 重置应回到“未裁切”状态，避免用户裁切后只能继续在裁切图上操作。
  resetProcessedResult()
  modeCoordinator.resetModesForOriginalImage({ preserveMockup })
  resetDecompose()
  resetZoom()
  applyConstraints()
  setTimeout(() => {
    if (!pendingResetNotice.value) return
    pendingResetNotice.value = false
    isResettingPreview.value = false
  }, 520)
}

async function loadImageFromSrc(src) {
  return await loadCanvasSafeImageFromSrc(src)
}

usePreviewSessionLifecycle({
  props,
  showControls,
  resetAiSourceReferenceSize,
  resetViewState,
  loadImage,
  syncFavoriteState,
  resetPreviewState,
  startControlsTimer,
  applyPreferredFitMode,
  exitFullscreenIfActive,
  clearControlsTimer,
  handleFullscreenChange,
  cleanupViewport,
  cleanupEffectResources,
  selectConfiguredAiModel,
  loadAiHistory,
  loadAiRecipes,
})
</script>

<template>
  <Teleport to="body">
  <div
    v-if="show"
    class="wallpaper-fullscreen-preview"
    role="dialog"
    aria-modal="true"
    aria-label="壁纸全屏预览"
    @mousemove="showControlsOnMouseMove"
    ref="fullscreenPreview"
    :style="themeStyle"
  >
    <div ref="previewContainer" class="preview-container">
      <WallpaperPreviewTopBar
        :show-controls="showControls"
        :is-fullscreen="isFullscreen"
        :is-favorite="isFavorite"
        :mockup-mode="mockupMode"
        :show-mockup-settings="showMockupSettings"
        :fit-mode="currentFitMode"
        :show-filters="showFilters"
        :active-filter="activeFilter"
        :active-art-style="activeArtStyle"
        :comparison-mode="comparisonMode"
        :in-collection="inCollection"
        :show-info="showInfo"
        :collection-index="collectionIndex"
        :collection-total="collectionTotal"
        :crop-mode="cropMode"
        :crop-ready="cropReady"
        :show-ai-panel="showAiPanel"
        :ai-title="previewAiTitle"
        :download-status="downloadStatus"
        :enabled-actions="previewEnabledActions"
        @close="handleClosePreview"
        @toggle-fullscreen="previewEnabledActions.fullscreen && toggleFullscreen()"
        @toggle-favorite="handleToggleFavorite"
        @toggle-desktop-mockup="previewEnabledActions.mockup && modeCoordinator.toggleDesktopMockup()"
        @toggle-mockup-settings="toggleMockupSettings"
        @toggle-phone-mockup="previewEnabledActions.mockup && modeCoordinator.togglePhoneMockup()"
        @toggle-fit-mode="handleToggleFitMode"
        @open-download="handlePreviewDownload"
        @rotate="handleRotatePreview"
        @toggle-filters="toggleFiltersPanel"
        @toggle-compare="previewEnabledActions.compare && modeCoordinator.toggleComparison()"
        @toggle-info="toggleInfo"
        @toggle-crop="previewEnabledActions.crop && modeCoordinator.toggleCrop()"
        @apply-crop="previewEnabledActions.crop && applyCropSelection()"
        @cancel-crop="cancelCropMode"
        @decompose-image="previewEnabledActions.decompose && modeCoordinator.decomposeImage()"
        @toggle-ai="toggleAiPanel"
        @previous="emit('previous')"
        @next="emit('next')"
        @controls-enter="setControlsHovered(true)"
        @controls-leave="setControlsHovered(false)"
      />

      <WallpaperPreviewZoomHint
        :show-controls="showControls"
        :zoom-level="zoomLevel"
        @zoom-in="handleZoomIn"
        @zoom-out="handleZoomOut"
        @reset-zoom="resetPreviewState"
      />

      <!-- 错误提示 -->
      <div v-if="error" class="preview-error">
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle-fill me-2"></i>
          {{ error }}
          <button class="retry-load-btn" @click="retryLoadCurrentImage">重试</button>
        </div>
      </div>

      <WallpaperPreviewFilterPanel
        :show-filters="showFilters && previewEnabledActions.filters"
        :history-index="historyIndex"
        :filter-history-length="filterHistory.length"
        :active-filter="activeFilter"
        :filter-params="filterParams"
        :filter-intensity="filterIntensity"
        :selected-preset-id="selectedPresetId"
        :custom-presets="customPresets"
        :active-art-style="activeArtStyle"
        :art-style-intensity="artStyleIntensity"
        :art-style-params="artStyleParams"
        @undo="undoFilter"
        @redo="redoFilter"
        @reset="resetFilterParams"
        @close="showFilters = false"
        @panel-enter="setControlsHovered(true)"
        @panel-leave="setControlsHovered(false)"
        @apply-preset="applyPresetFromPanel"
        @save-custom-preset="handleSaveCustomPreset"
        @remove-custom-preset="handleRemoveCustomPreset"
        @filter-intensity-change="onFilterIntensityChange"
        @apply-art-style="handleApplyArtStyle"
        @art-style-intensity-change="handleArtStyleIntensityChange"
        @art-style-param-change="handleArtStyleParamChange"
        @filter-change="handleFilterChange"
      />

      <WallpaperPreviewInfoPanel
        :show-info="showInfo && previewEnabledActions.info"
        :show-controls="showControls"
        :wallpaper="wallpaper"
        :image-info="imageInfo"
        :formatted-resolution="formattedResolution"
        :formatted-file-size="formattedFileSize"
        @close="showInfo = false"
      />

      <!-- 预览图片 -->
      <div
        class="preview-image-container"
        :class="{
          'zoomed-container': isZoomed,
          'ai-panel-open': showAiPanel,
        }"
        @wheel="handleWheel"
        @mousedown="startCropSelection"
        @mousemove.capture="moveCropSelection"
        @mouseup="endCropSelection"
        @mouseleave="endCropSelection"
      >
        <div
          v-if="showAspectBackdrop && comparisonMode === 'none'"
          class="aspect-backdrop-layer"
          :style="aspectBackdropStyle"
        ></div>

        <WallpaperPreviewMockupStage
          v-if="previewEnabledActions.mockup && mockupMode !== 'none'"
          ref="mockupStageRef"
          :mockup-mode="mockupMode"
          :image-url="previewDisplayUrl"
          :image-crossorigin="previewImageCrossorigin"
          :filter-css="mockupFilterCss"
          :show-settings="showMockupSettings"
          :desktop-config="desktopMockupConfig"
          :screen-loading="isLoading"
          @image-loaded="onPreviewImageLoaded"
          @image-error="handleImageError"
          @update-desktop-config="handleDesktopMockupConfigUpdate"
        />

        <WallpaperPreviewComparisonStage
          v-else-if="previewEnabledActions.compare && comparisonMode !== 'none'"
          :comparison-mode="comparisonMode"
          :image-url="imageUrl"
          :preview-display-url="previewDisplayUrl"
          :processed-image-ref="bindComparisonProcessedImage"
          :original-image-crossorigin="originalImageCrossorigin"
          :preview-image-crossorigin="previewImageCrossorigin"
          :is-zoomed="isZoomed"
          :transform-style="transformStyle"
          :cursor-style="cursorStyle"
          :image-object-fit="imageObjectFit"
          :image-sizing-style="imageSizingStyle"
          :processed-image-style="processedImageStyle"
          :processed-label="processedLabel"
          @toggle-zoom="toggleZoom"
          @start-drag="startDrag"
          @image-loaded="onPreviewImageLoaded"
          @image-error="handleImageError"
        />

        <div v-else class="preview-main-pane">
          <div
            v-if="isLoading && !holdoverDisplayUrl && !previewDisplayUrl"
            class="preview-pane-loading"
            aria-hidden="true"
          >
            <div class="preview-pane-loading-shimmer"></div>
          </div>

          <div
            class="preview-image-stage"
            :class="{ 'is-loading': isLoading && !holdoverDisplayUrl && !previewDisplayUrl }"
          >
            <img
              v-if="holdoverDisplayUrl"
              referrerpolicy="no-referrer"
              :crossorigin="previewImageCrossorigin"
              :src="holdoverDisplayUrl"
              alt=""
              class="preview-image preview-image--holdover"
              :class="{ zoomed: isZoomed }"
              :style="processedImageStyle"
              aria-hidden="true"
              :draggable="false"
            />

            <img
              ref="imageElement"
              referrerpolicy="no-referrer"
              :crossorigin="previewImageCrossorigin"
              v-if="imageUrl"
              :src="previewDisplayUrl"
              alt="Wallpaper Preview"
              class="preview-image"
              :class="{
                zoomed: isZoomed,
                'is-revealing': isLoading || holdoverDisplayUrl,
              }"
              :style="processedImageStyle"
              :draggable="false"
              @dblclick="toggleZoom"
              @mousedown="startDrag"
              @load="onPreviewImageLoaded"
              @error="handleImageError"
            />
          </div>

          <div
            v-if="isLoading && !holdoverDisplayUrl && !previewDisplayUrl"
            class="preview-pane-loading-status"
            aria-live="polite"
          >
            <span class="preview-pane-loading-dot" aria-hidden="true"></span>
            正在加载高清图片
          </div>
        </div>
        <div
          v-if="cropMode && cropRect && comparisonMode === 'none' && mockupMode === 'none'"
          class="crop-selection-box"
          :style="{
            left: `${cropRect.left}px`,
            top: `${cropRect.top}px`,
            width: `${cropRect.width}px`,
            height: `${cropRect.height}px`,
          }"
        ></div>

        <div
          v-if="
            showMinimap &&
            comparisonMode === 'none' &&
            mockupMode === 'none' &&
            !cropMode &&
            !showDecomposePanel
          "
          class="preview-minimap"
          :class="{ 'preview-minimap--ai-offset': showAiPanel }"
          :style="minimapStyle"
          @mousedown="startMinimapDrag"
        >
          <img
            v-if="previewDisplayUrl"
            class="preview-minimap-image"
            referrerpolicy="no-referrer"
            :crossorigin="previewImageCrossorigin"
            :src="previewDisplayUrl"
            alt="当前预览范围"
            draggable="false"
          />
          <div class="preview-minimap-viewport" :style="minimapViewportStyle"></div>
        </div>
      </div>

      <WallpaperDecomposePanel
        :show="showDecomposePanel && previewEnabledActions.decompose"
        :decomposed-tiles="decomposedTiles"
        :transition-tiles="transitionTiles"
        :decompose-grid-size="decomposeGridSize"
        :is-switching="isDecomposeSwitching"
        :layout-mode="decomposeLayoutMode"
        :source-aspect-ratio="sourceAspectRatio"
        @set-grid-size="setDecomposeGridSize"
        @toggle-tile="toggleDecomposedTile"
        @download="downloadDecomposedTiles({ selectedOnly: true })"
        @cancel="resetDecompose"
      />

      <WallpaperAiPanel
        :show="showAiPanel && canOpenPreviewAi"
        :loading="aiLoading"
        :error="aiError"
        :retryable="aiRetryable"
        :status-text="aiStatusText"
        :model-options="aiModelOptions"
        v-model:selected-model="aiSelectedModel"
        v-model:output-size="aiOutputSize"
        v-model:custom-prompt="aiCustomPrompt"
        v-model:recipe-name="aiRecipeName"
        :recipes="aiRecipes"
        :history="aiHistory"
        :undo-count="aiUndoStack.length"
        :is-authenticated="authStore.isAuthenticated"
        :runtime-limits="previewAiRuntimeLimits"
        :image-processing-config="aiImageProcessingConfig"
        @close="showAiPanel = false"
        @generate="generateAiPreview"
        @apply-download="applyAiAndDownload"
        @undo="undoLastAiOperation"
        @reset="resetPreviewState()"
        @retry="generateAiPreview"
        @save-recipe="saveCurrentAiRecipe"
        @apply-recipe="applyAiRecipe"
        @remove-recipe="removeAiRecipe"
        @apply-history="applyAiHistoryItem"
        @download-history="downloadAiHistoryItem"
      />

      <AiCostConfirmDialog
        :show="aiCostConfirmVisible"
        :cost="aiCostConfirmPayload"
        @confirm="resolveAiCostConfirm(true)"
        @cancel="resolveAiCostConfirm(false)"
      />

      <InsufficientCreditsDialog
        :show="creditsDialogOpen"
        :required="requiredCredits"
        :available="availableCredits"
        @close="closeCreditsDialog"
      />

      <div v-if="aiLoading" class="ai-generating-overlay">
        <div class="ai-generating-card">
          <div class="ai-orbit-loader" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <strong>{{ aiStatusText || 'AI 正在生成优化图片' }}</strong>
          <p>图生图通常需要几十秒，请不要关闭预览或重复点击。</p>
        </div>
      </div>

      <div v-if="isResettingPreview" class="preview-reset-overlay">
        <div class="preview-reset-card">
          <i class="bi bi-arrow-counterclockwise"></i>
          <span>正在恢复原图...</span>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.wallpaper-fullscreen-preview {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.95);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  outline: none;
}

.wallpaper-fullscreen-preview:focus-visible {
  outline: 2px solid rgba(76, 175, 80, 0.8);
  outline-offset: -2px;
}

.preview-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 图片容器 */
.preview-image-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  box-sizing: border-box;
}

.preview-image-container.ai-panel-open {
  padding-right: min(360px, calc(100vw - 40px));
}

.preview-minimap {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 70;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.62);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
  cursor: grab;
  user-select: none;
}

.preview-minimap:active {
  cursor: grabbing;
}

.preview-minimap--ai-offset {
  right: min(380px, calc(100vw - 20px));
}

.preview-minimap-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  opacity: 0.88;
  pointer-events: none;
}

.preview-minimap-viewport {
  position: absolute;
  border: 2px solid rgba(255, 255, 255, 0.92);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  pointer-events: none;
}

.ai-generating-overlay {
  position: absolute;
  inset: 0;
  z-index: 88;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.18);
}

.ai-generating-card {
  width: min(320px, calc(100vw - 48px));
  padding: 22px 20px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(18, 18, 20, 0.78);
  color: #fff;
  text-align: center;
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.32);
}

.ai-generating-card strong {
  display: block;
  margin-top: 14px;
  font-size: 0.98rem;
}

.ai-generating-card p {
  margin: 8px 0 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.8rem;
  line-height: 1.55;
}

.ai-orbit-loader {
  position: relative;
  width: 58px;
  height: 58px;
  margin: 0 auto;
}

.ai-orbit-loader span {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: rgba(152, 228, 175, 0.96);
  animation: aiOrbit 1.1s linear infinite;
}

.ai-orbit-loader span:nth-child(2) {
  inset: 8px;
  border-top-color: rgba(255, 255, 255, 0.76);
  animation-duration: 1.45s;
  animation-direction: reverse;
}

.ai-orbit-loader span:nth-child(3) {
  inset: 17px;
  border-top-color: rgba(255, 184, 108, 0.9);
  animation-duration: 0.9s;
}

.preview-reset-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 70;
  background: rgba(0, 0, 0, 0.16);
}

.preview-reset-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 999px;
  color: #fff;
  background: rgba(20, 20, 20, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(4px);
}

@keyframes aiOrbit {
  to {
    transform: rotate(360deg);
  }
}

.aspect-backdrop-layer {
  position: absolute;
  inset: 0;
  background-position: center;
  background-size: cover;
  filter: blur(28px) brightness(0.62) saturate(0.95);
  transform: scale(1.12);
  opacity: 0.92;
  z-index: 0;
}

.preview-image-container.zoomed-container {
  overflow: hidden; /* 改为hidden，防止滚动条干扰拖动 */
}

.preview-image {
  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  object-fit: contain;
  will-change: transform;
  box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
}

.preview-image--holdover {
  position: absolute;
  inset: 0;
  z-index: 0;
  margin: auto;
}

.preview-image.is-revealing {
  position: relative;
  z-index: 1;
  opacity: 0.82;
  transform: scale(1.012);
  filter: blur(34px) saturate(1.04) brightness(1.02);
  transition:
    filter 0.9s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.82s ease-out,
    transform 0.9s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 加载和错误提示 */
.preview-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 80;
  text-align: center;
}

.retry-load-btn {
  margin-left: 10px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  padding: 4px 10px;
  cursor: pointer;
}

.retry-load-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.preview-pane-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
}

.preview-pane-loading-shimmer {
  position: absolute;
  inset: -35% -55%;
  background: linear-gradient(
    105deg,
    transparent 34%,
    rgba(255, 255, 255, 0.03) 42%,
    rgba(255, 255, 255, 0.09) 50%,
    rgba(255, 255, 255, 0.03) 58%,
    transparent 66%
  );
  animation: preview-pane-shimmer 3.6s ease-in-out infinite;
}

.preview-image-stage {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  transition:
    filter 0.9s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.82s ease-out,
    transform 0.9s cubic-bezier(0.16, 1, 0.3, 1);
}

.preview-image-stage.is-loading {
  opacity: 0.82;
  transform: scale(1.012);
  filter: blur(34px) saturate(1.04) brightness(1.02);
}

.preview-pane-loading-status {
  position: absolute;
  left: 50%;
  bottom: 34px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(8, 10, 14, 0.46);
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.76rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  transform: translateX(-50%);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  pointer-events: none;
}

.preview-pane-loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(186, 230, 253, 0.92);
  box-shadow: 0 0 10px rgba(186, 230, 253, 0.45);
  animation: preview-pane-loading-dot 1.35s ease-in-out infinite;
}

@keyframes preview-pane-shimmer {
  0%,
  100% {
    transform: translate3d(-16%, 0, 0);
    opacity: 0.28;
  }

  50% {
    transform: translate3d(16%, 0, 0);
    opacity: 0.72;
  }
}

@keyframes preview-pane-loading-dot {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(0.88);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .preview-image-stage,
  .preview-pane-loading-shimmer,
  .preview-pane-loading-dot {
    animation: none !important;
    transition: none !important;
  }

  .preview-image-stage.is-loading {
    filter: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}

.preview-error .alert {
  background-color: rgba(220, 53, 69, 0.8);
  color: white;
  border: none;
  backdrop-filter: blur(5px);
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
}

.crop-selection-box {
  position: fixed;
  border: 2px solid #4caf50;
  background: rgba(76, 175, 80, 0.15);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8);
  z-index: 60;
  pointer-events: none;
}

/* 非比较模式主图容器：固定占满，确保 contain 有稳定边界 */
.preview-main-pane {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  z-index: 1;
}
</style>
