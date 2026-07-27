<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import WallpaperPreviewComparisonStage from '@/components/wallpaper/fullscreen-preview/features/compare/WallpaperPreviewComparisonStage.vue'
import WallpaperDecomposePanel from '@/components/wallpaper/fullscreen-preview/features/decompose/WallpaperDecomposePanel.vue'
import WallpaperPreviewFilterPanel from '@/components/wallpaper/fullscreen-preview/features/filters/WallpaperPreviewFilterPanel.vue'
import { usePreviewEffects } from '@/components/wallpaper/fullscreen-preview/features/filters/usePreviewEffects'
import WallpaperPreviewInfoPanel from '@/components/wallpaper/fullscreen-preview/features/info/WallpaperPreviewInfoPanel.vue'
import { buildProcessedPreviewImageData } from '@/components/wallpaper/fullscreen-preview/features/loader/previewProcessedImageBuilder'
import WallpaperPreviewMockupStage from '@/components/wallpaper/fullscreen-preview/features/mockup/WallpaperPreviewMockupStage.vue'
import { useDesktopMockupSettings } from '@/components/wallpaper/fullscreen-preview/features/mockup/useDesktopMockupSettings'
import { usePreviewMockup } from '@/components/wallpaper/fullscreen-preview/features/mockup/usePreviewMockup'
import WallpaperPreviewTopBar from '@/components/wallpaper/fullscreen-preview/features/toolbar/WallpaperPreviewTopBar.vue'
import { usePreviewViewport } from '@/components/wallpaper/fullscreen-preview/features/viewport/usePreviewViewport'
import WallpaperPreviewZoomHint from '@/components/wallpaper/fullscreen-preview/features/viewport/WallpaperPreviewZoomHint.vue'
import { loadCanvasSafeImageFromSrc } from '@/components/wallpaper/fullscreen-preview/composables/useCanvasSafeImage'
import { usePreviewCrop } from '@/components/wallpaper/fullscreen-preview/features/crop/usePreviewCrop'
import { useImageDecompose } from '@/components/wallpaper/fullscreen-preview/features/decompose/useImageDecompose'
import { getPreviewImageCrossorigin } from '@/components/wallpaper/fullscreen-preview/composables/useCanvasSafeImage'
import { hasColorGradeAdjustment } from '@/features/filters/filterEngine'
import {
  releaseAuthenticatedMediaUrl,
  resolveAuthenticatedMediaUrl,
} from '@/services/authenticatedMedia'
import notificationService from '@/services/notification'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps({
  open: { type: Boolean, default: false },
  images: { type: Array, default: () => [] },
  currentSrc: { type: String, default: '' },
  title: { type: String, default: '图片预览' },
  filename: { type: String, default: 'image.png' },
  favorite: { type: Boolean, default: false },
  metadata: { type: Object, default: () => ({}) },
  enabledActions: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['close', 'select', 'download', 'toggle-favorite', 'processed'])
const settingsStore = useSettingsStore()
const fullscreenPreview = ref(null)
const mockupStageRef = ref(null)
const resolvedSrc = ref('')
const resolvedFrom = ref('')
const isLoading = ref(true)
const error = ref('')
const showControls = ref(true)
const controlsHovered = ref(false)
const showInfo = ref(false)
const showMockupSettings = ref(false)
const favoriteState = ref(props.favorite)
const processedResultUrl = ref('')
const canvasPreviewUrl = ref('')
const aspectBackdropUrl = ref('')
const processingToken = ref(0)
const dummyAiPanel = ref(false)
let controlsTimer = 0
let processTimer = 0
let previousBodyOverflow = ''

const gallery = computed(() => {
  const values = Array.isArray(props.images) ? props.images : []
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
})
const currentIndex = computed(() => gallery.value.indexOf(props.currentSrc))
const inCollection = computed(() => gallery.value.length > 1)
const previewDisplayUrl = computed(
  () => processedResultUrl.value || canvasPreviewUrl.value || resolvedSrc.value,
)

const previewEnabledActions = computed(() => ({
  favorite: true,
  mockup: true,
  rotate: true,
  fit: true,
  info: true,
  compare: true,
  crop: true,
  decompose: true,
  filters: true,
  download: true,
  fullscreen: true,
  ...props.enabledActions,
  ai: false,
}))

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
} = usePreviewEffects({ settingsStore })

const {
  isZoomed,
  zoomLevel,
  isFullscreen,
  previewContainer,
  imageElement,
  isDragging,
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
  startMinimapDrag,
  applyConstraints,
  exitFullscreenIfActive,
  applyPreferredFitMode,
  handleFullscreenChange,
  cleanupViewport,
} = usePreviewViewport({
  getPreferredFitMode: () => settingsStore.getSetting('fullscreen_preview_fit_mode', 'contain'),
  onControlsActivity: showControlsOnMouseMove,
})

const {
  mockupMode,
  clearMockupMode,
  toggleDesktopMockup: toggleDesktopMockupBase,
  togglePhoneMockup: togglePhoneMockupBase,
} = usePreviewMockup()
const { desktopMockupConfig, updateDesktopMockupConfig } = useDesktopMockupSettings({ settingsStore })

const processedImageStyle = computed(() => {
  const style = [
    transformStyle.value,
    { cursor: cursorStyle.value, objectFit: imageObjectFit.value },
    imageSizingStyle.value,
  ]
  if (!canvasPreviewUrl.value) style.push(filterStyle.value)
  return style
})
const originalImageCrossorigin = computed(() => getPreviewImageCrossorigin(resolvedSrc.value))
const previewImageCrossorigin = computed(() => getPreviewImageCrossorigin(previewDisplayUrl.value))
const processedLabel = computed(() => activeArtStyle.value !== 'none' ? '风格化' : activeFilter.value === 'none' ? '处理后' : activeFilter.value)
const showAspectBackdrop = computed(() => fitMode.value === 'contain' && !!resolvedSrc.value)
const aspectBackdropStyle = computed(() => ({
  backgroundImage: aspectBackdropUrl.value
    ? `url("${aspectBackdropUrl.value}")`
    : 'radial-gradient(circle at center, rgba(255, 255, 255, 0.1), rgba(0, 0, 0, 0.92))',
}))
const mockupFilterCss = computed(() => canvasPreviewUrl.value ? '' : filterStyle.value?.filter || '')
const formattedResolution = computed(() => {
  const width = imageElement.value?.naturalWidth || Number(props.metadata?.width) || 0
  const height = imageElement.value?.naturalHeight || Number(props.metadata?.height) || 0
  return width && height ? `${width} × ${height}` : '未知分辨率'
})
const formattedFileSize = computed(() => String(props.metadata?.size || '未知大小'))
const wallpaperInfo = computed(() => ({
  id: props.metadata?.id || props.filename || props.currentSrc,
  title: props.title,
  name: props.title,
  path: resolvedSrc.value,
  url: resolvedSrc.value,
  ...props.metadata,
}))

function applyProcessedResult(url) {
  processedResultUrl.value = String(url || '')
  canvasPreviewUrl.value = ''
  emit('processed', { dataUrl: processedResultUrl.value })
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
  loadImageFromSrc: loadCanvasSafeImageFromSrc,
  applyProcessedResult,
  notificationService,
})

const {
  decomposedTiles,
  transitionTiles,
  decomposeGridSize,
  decomposeImage,
  downloadDecomposedTiles,
  isDecomposeSwitching,
  decomposeLayoutMode,
  sourceAspectRatio,
  resetDecompose,
  setDecomposeGridSize,
  showDecomposePanel,
  toggleDecomposedTile,
} = useImageDecompose({
  previewDisplayUrl,
  loadImageFromSrc: loadCanvasSafeImageFromSrc,
  notificationService,
  getFilenamePrefix: () => props.filename.replace(/\.[^.]+$/, ''),
})

function showControlsOnMouseMove() {
  showControls.value = true
  startControlsTimer()
}

function startControlsTimer() {
  window.clearTimeout(controlsTimer)
  if (controlsHovered.value || showFilters.value || showInfo.value || showDecomposePanel.value || cropMode.value) return
  controlsTimer = window.setTimeout(() => {
    if (!controlsHovered.value) showControls.value = false
  }, 3000)
}

function setControlsHovered(value) {
  controlsHovered.value = value
  if (value) {
    showControls.value = true
    window.clearTimeout(controlsTimer)
  } else {
    startControlsTimer()
  }
}

function buildAspectBackdrop(img) {
  if (!img?.naturalWidth || !img?.naturalHeight) return
  try {
    const canvas = document.createElement('canvas')
    const ratio = Math.min(64 / img.naturalWidth, 64 / img.naturalHeight, 1)
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio))
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    aspectBackdropUrl.value = canvas.toDataURL('image/jpeg', 0.52)
  } catch {
    aspectBackdropUrl.value = ''
  }
}

function onPreviewImageLoaded(event) {
  imageElement.value = event?.target || imageElement.value
  isLoading.value = false
  error.value = ''
  buildAspectBackdrop(imageElement.value)
  resetZoom()
  applyConstraints()
}

function bindComparisonProcessedImage(el) {
  imageElement.value = el || null
}

function handleImageError() {
  isLoading.value = false
  error.value = '图片加载失败'
}

async function resolveCurrentImage() {
  const source = String(props.currentSrc || '').trim()
  if (!source) return
  isLoading.value = true
  error.value = ''
  if (resolvedSrc.value && resolvedFrom.value) {
    releaseAuthenticatedMediaUrl(resolvedFrom.value, resolvedSrc.value)
  }
  resolvedSrc.value = ''
  resolvedFrom.value = source
  try {
    resolvedSrc.value = await resolveAuthenticatedMediaUrl(source)
  } catch (caught) {
    error.value = caught?.message || '图片加载失败'
    isLoading.value = false
  }
}

function retryLoadCurrentImage() {
  void resolveCurrentImage()
}

function resetPreviewState() {
  processedResultUrl.value = ''
  canvasPreviewUrl.value = ''
  aspectBackdropUrl.value = ''
  resetEffectsState()
  resetDecompose()
  cancelCropMode()
  clearMockupMode()
  showMockupSettings.value = false
  showInfo.value = false
  resetViewportState()
}

function toggleFavorite() {
  favoriteState.value = !favoriteState.value
  emit('toggle-favorite', favoriteState.value)
}

function toggleDesktopMockup() {
  cancelCropMode()
  setComparisonMode('none')
  resetDecompose()
  toggleDesktopMockupBase()
}

function togglePhoneMockup() {
  cancelCropMode()
  setComparisonMode('none')
  resetDecompose()
  togglePhoneMockupBase()
}

function toggleComparison() {
  cancelCropMode()
  clearMockupMode()
  resetDecompose()
  resetZoom()
  toggleComparisonMode('side-by-side')
}

function toggleCrop() {
  if (cropMode.value) {
    cancelCropMode()
    return
  }
  clearMockupMode()
  setComparisonMode('none')
  resetDecompose()
  if (currentFitMode.value !== 'contain') {
    settingsStore.setSetting('fullscreen_preview_fit_mode', 'contain')
    applyPreferredFitMode()
  }
  resetZoom()
  enterCropMode()
}

function startCropSelection(event) {
  startCropSelectionBase(event, {
    comparisonMode: comparisonMode.value,
    mockupMode: mockupMode.value,
  })
}

async function openDecompose() {
  cancelCropMode()
  clearMockupMode()
  setComparisonMode('none')
  await decomposeImage()
}

function handleToggleFitMode() {
  toggleFitMode()
  settingsStore.setSetting('fullscreen_preview_fit_mode', currentFitMode.value)
}

function handleRotatePreview() {
  rotateImage()
  scheduleProcessedPreview()
}

function toggleFiltersPanel() {
  showFilters.value = !showFilters.value
  showControls.value = true
  if (!showFilters.value) startControlsTimer()
}

function scheduleProcessedPreview() {
  window.clearTimeout(processTimer)
  processTimer = window.setTimeout(() => void rebuildProcessedPreview(), 80)
}

async function rebuildProcessedPreview() {
  if (!resolvedSrc.value || processedResultUrl.value) return
  const needsCanvas = activeArtStyle.value !== 'none' || hasColorGradeAdjustment(filterParams)
  if (!needsCanvas) {
    canvasPreviewUrl.value = ''
    return
  }
  const token = ++processingToken.value
  const sourceImage = await loadCanvasSafeImageFromSrc(resolvedSrc.value)
  if (!sourceImage || token !== processingToken.value) return
  const result = await buildProcessedPreviewImageData({
    sourceImage,
    rotation,
    activeFilter,
    filterIntensity,
    filterParams,
    showFilters,
    activeArtStyle,
    artStyleIntensity,
    artStyleParams,
    forPreview: true,
    previewMode: 'full',
  })
  if (token === processingToken.value) canvasPreviewUrl.value = result || ''
}

async function downloadCurrent() {
  if (mockupMode.value !== 'none') {
    const mockupImageData = await mockupStageRef.value?.exportMockupImage?.()
    if (!mockupImageData) {
      notificationService.error('当前样机取景生成失败，请稍后重试')
      return
    }
    const link = document.createElement('a')
    link.href = mockupImageData
    link.download = `${props.filename.replace(/\.[^.]+$/, '')}_${mockupMode.value}_wallpaper.jpg`
    document.body.appendChild(link)
    link.click()
    link.remove()
    emit('download', { dataUrl: mockupImageData, mode: mockupMode.value, src: props.currentSrc })
    return
  }

  const image = await loadCanvasSafeImageFromSrc(previewDisplayUrl.value)
  if (!image) {
    notificationService.error('图片下载失败')
    return
  }
  const canvas = document.createElement('canvas')
  const quarterTurn = rotation.value % 180 !== 0
  canvas.width = quarterTurn ? image.naturalHeight : image.naturalWidth
  canvas.height = quarterTurn ? image.naturalWidth : image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) return
  if (!canvasPreviewUrl.value) context.filter = filterStyle.value?.filter || 'none'
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate((rotation.value * Math.PI) / 180)
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = props.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    emit('download', { blob, src: props.currentSrc })
  }, 'image/png')
}

function step(direction) {
  const next = currentIndex.value + direction
  if (next < 0 || next >= gallery.value.length) return
  emit('select', gallery.value[next])
}

function closePreview() {
  emit('close')
}

function handleKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') closePreview()
  else if (event.key === 'ArrowLeft') step(-1)
  else if (event.key === 'ArrowRight') step(1)
  else return
  event.preventDefault()
}

watch(() => props.favorite, (value) => { favoriteState.value = value })
watch(() => props.currentSrc, () => {
  resetPreviewState()
  if (props.open) void resolveCurrentImage()
})
watch(
  [activeFilter, filterIntensity, activeArtStyle, artStyleIntensity, rotation, showFilters],
  scheduleProcessedPreview,
)
watch(filterParams, scheduleProcessedPreview, { deep: true })
watch(artStyleParams, scheduleProcessedPreview, { deep: true })
watch(mockupMode, (mode) => {
  if (mode !== 'desktop') showMockupSettings.value = false
})
watch(
  () => props.open,
  (open) => {
    window.clearTimeout(controlsTimer)
    if (open) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      resetPreviewState()
      void resolveCurrentImage()
      window.addEventListener('keydown', handleKeydown)
      document.addEventListener('fullscreenchange', handleFullscreenChange)
      nextTick(() => {
        fullscreenPreview.value?.focus()
        showControls.value = true
        startControlsTimer()
      })
      return
    }
    document.body.style.overflow = previousBodyOverflow
    exitFullscreenIfActive()
    window.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.clearTimeout(controlsTimer)
  window.clearTimeout(processTimer)
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  cleanupViewport()
  if (resolvedSrc.value && resolvedFrom.value) {
    releaseAuthenticatedMediaUrl(resolvedFrom.value, resolvedSrc.value)
  }
  if (props.open) document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="fullscreenPreview"
      class="wallpaper-fullscreen-preview"
      role="dialog"
      aria-modal="true"
      :aria-label="`${title}全屏预览`"
      tabindex="-1"
      @mousemove="showControlsOnMouseMove"
    >
      <div ref="previewContainer" class="preview-container">
        <WallpaperPreviewTopBar
          :show-controls="showControls"
          :is-fullscreen="isFullscreen"
          :is-favorite="favoriteState"
          :mockup-mode="mockupMode"
          :show-mockup-settings="showMockupSettings"
          :fit-mode="currentFitMode"
          :show-filters="showFilters"
          :active-filter="activeFilter"
          :active-art-style="activeArtStyle"
          :comparison-mode="comparisonMode"
          :in-collection="inCollection"
          :show-info="showInfo"
          :collection-index="currentIndex"
          :collection-total="gallery.length"
          :crop-mode="cropMode"
          :crop-ready="cropReady"
          :show-ai-panel="dummyAiPanel"
          download-status="idle"
          :enabled-actions="previewEnabledActions"
          @close="closePreview"
          @toggle-fullscreen="toggleFullscreen"
          @toggle-favorite="toggleFavorite"
          @toggle-desktop-mockup="toggleDesktopMockup"
          @toggle-mockup-settings="showMockupSettings = !showMockupSettings"
          @toggle-phone-mockup="togglePhoneMockup"
          @toggle-fit-mode="handleToggleFitMode"
          @open-download="downloadCurrent"
          @rotate="handleRotatePreview"
          @toggle-filters="toggleFiltersPanel"
          @toggle-compare="toggleComparison"
          @toggle-info="showInfo = !showInfo"
          @toggle-crop="toggleCrop"
          @apply-crop="applyCropSelection"
          @cancel-crop="cancelCropMode"
          @decompose-image="openDecompose"
          @previous="step(-1)"
          @next="step(1)"
          @controls-enter="setControlsHovered(true)"
          @controls-leave="setControlsHovered(false)"
        />

        <WallpaperPreviewZoomHint
          :show-controls="showControls"
          :zoom-level="zoomLevel"
          @zoom-in="handleZoomIn"
          @zoom-out="handleZoomOut"
          @reset-zoom="resetViewportState"
        />

        <div v-if="error" class="preview-error">
          <div class="alert alert-danger">
            <i class="bi bi-exclamation-triangle-fill me-2"></i>{{ error }}
            <button class="retry-load-btn" @click="retryLoadCurrentImage">重试</button>
          </div>
        </div>

        <WallpaperPreviewFilterPanel
          :show-filters="showFilters"
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
          @apply-preset="applyPresetById"
          @save-custom-preset="saveCurrentAsCustomPreset"
          @remove-custom-preset="removeCustomPresetById"
          @filter-intensity-change="setFilterIntensity"
          @apply-art-style="applyArtStyle"
          @art-style-intensity-change="setArtStyleIntensity"
          @art-style-param-change="({ key, value }) => setArtStyleParam(key, value)"
          @filter-change="handleFilterChange"
        />

        <WallpaperPreviewInfoPanel
          :show-info="showInfo"
          :show-controls="showControls"
          :wallpaper="wallpaperInfo"
          :image-info="wallpaperInfo"
          :formatted-resolution="formattedResolution"
          :formatted-file-size="formattedFileSize"
          @close="showInfo = false"
        />

        <div
          class="preview-image-container"
          :class="{ 'zoomed-container': isZoomed }"
          @wheel="handleWheel"
          @mousedown="startCropSelection"
          @mousemove.capture="moveCropSelection"
          @mouseup="endCropSelection"
          @mouseleave="endCropSelection"
        >
          <div v-if="showAspectBackdrop && comparisonMode === 'none'" class="aspect-backdrop-layer" :style="aspectBackdropStyle"></div>

          <WallpaperPreviewMockupStage
            v-if="mockupMode !== 'none'"
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
            @update-desktop-config="updateDesktopMockupConfig"
          />

          <WallpaperPreviewComparisonStage
            v-else-if="comparisonMode !== 'none'"
            :comparison-mode="comparisonMode"
            :image-url="resolvedSrc"
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
            <div v-if="isLoading" class="preview-pane-loading" aria-hidden="true"><div class="preview-pane-loading-shimmer"></div></div>
            <div class="preview-image-stage" :class="{ 'is-loading': isLoading }">
              <img
                v-if="resolvedSrc"
                ref="imageElement"
                referrerpolicy="no-referrer"
                :crossorigin="previewImageCrossorigin"
                :src="previewDisplayUrl"
                :alt="title"
                class="preview-image"
                :class="{ zoomed: isZoomed, 'is-revealing': isLoading }"
                :style="processedImageStyle"
                :draggable="false"
                @dblclick="toggleZoom"
                @mousedown="startDrag"
                @load="onPreviewImageLoaded"
                @error="handleImageError"
              />
            </div>
            <div v-if="isLoading" class="preview-pane-loading-status" aria-live="polite"><span class="preview-pane-loading-dot"></span>正在加载高清图片</div>
          </div>

          <div
            v-if="cropMode && cropRect && comparisonMode === 'none' && mockupMode === 'none'"
            class="crop-selection-box"
            :style="{ left: `${cropRect.left}px`, top: `${cropRect.top}px`, width: `${cropRect.width}px`, height: `${cropRect.height}px` }"
          ></div>

          <div
            v-if="showMinimap && comparisonMode === 'none' && mockupMode === 'none' && !cropMode && !showDecomposePanel"
            class="preview-minimap"
            :style="minimapStyle"
            @mousedown="startMinimapDrag"
          >
            <img v-if="previewDisplayUrl" class="preview-minimap-image" :src="previewDisplayUrl" alt="当前预览范围" draggable="false" />
            <div class="preview-minimap-viewport" :style="minimapViewportStyle"></div>
          </div>
        </div>

        <WallpaperDecomposePanel
          :show="showDecomposePanel"
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

.wallpaper-fullscreen-preview:focus-visible { outline: 2px solid rgba(76, 175, 80, 0.8); outline-offset: -2px; }
.preview-container { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.preview-image-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; box-sizing: border-box; }
.preview-image-container.zoomed-container { overflow: hidden; }
.preview-minimap { position:absolute; right:20px; bottom:20px; z-index:70; overflow:hidden; border-radius:10px; border:1px solid rgba(255,255,255,.18); background:rgba(0,0,0,.62); box-shadow:0 10px 24px rgba(0,0,0,.28); cursor:grab; user-select:none; }
.preview-minimap:active { cursor:grabbing; }
.preview-minimap-image { width:100%; height:100%; display:block; object-fit:cover; opacity:.88; pointer-events:none; }
.preview-minimap-viewport { position:absolute; border:2px solid rgba(255,255,255,.92); border-radius:10px; background:rgba(255,255,255,.08); pointer-events:none; }
.aspect-backdrop-layer { position: absolute; inset: 0; background-position: center; background-size: cover; filter: blur(28px) brightness(0.62) saturate(0.95); transform: scale(1.12); opacity: 0.92; z-index: 0; }
.preview-main-pane { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; z-index: 1; }
.preview-image { width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; object-fit: contain; will-change: transform; box-shadow: 0 0 30px rgba(0, 0, 0, 0.5); }
.preview-image-stage { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; transition: filter .9s cubic-bezier(.16,1,.3,1), opacity .82s ease-out, transform .9s cubic-bezier(.16,1,.3,1); }
.preview-image-stage.is-loading { opacity: .82; transform: scale(1.012); filter: blur(34px) saturate(1.04) brightness(1.02); }
.preview-image.is-revealing { position: relative; z-index: 1; opacity: .82; transform: scale(1.012); filter: blur(34px) saturate(1.04) brightness(1.02); transition: filter .9s cubic-bezier(.16,1,.3,1), opacity .82s ease-out, transform .9s cubic-bezier(.16,1,.3,1); }
.preview-pane-loading { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; }
.preview-pane-loading-shimmer { position: absolute; inset: -35% -55%; background: linear-gradient(105deg, transparent 34%, rgba(255,255,255,.03) 42%, rgba(255,255,255,.09) 50%, rgba(255,255,255,.03) 58%, transparent 66%); animation: preview-pane-shimmer 3.6s ease-in-out infinite; }
.preview-pane-loading-status { position: absolute; left: 50%; bottom: 34px; z-index: 4; display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.1); background: rgba(8,10,14,.46); color: rgba(255,255,255,.72); font-size: .76rem; font-weight: 500; transform: translateX(-50%); backdrop-filter: blur(10px); pointer-events: none; }
.preview-pane-loading-dot { width: 6px; height: 6px; border-radius: 999px; background: rgba(186,230,253,.92); box-shadow: 0 0 10px rgba(186,230,253,.45); animation: preview-pane-loading-dot 1.35s ease-in-out infinite; }
.preview-error { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 80; text-align: center; }
.retry-load-btn { margin-left: 10px; border: 0; border-radius: 6px; background: rgba(255,255,255,.2); color: #fff; padding: 4px 10px; cursor: pointer; }
.preview-error .alert { background-color: rgba(220,53,69,.8); color: #fff; border: 0; backdrop-filter: blur(5px); box-shadow: 0 0 20px rgba(0,0,0,.5); }
.crop-selection-box { position: fixed; border: 2px solid #4caf50; background: rgba(76,175,80,.15); box-shadow: inset 0 0 0 1px rgba(255,255,255,.8); z-index: 60; pointer-events: none; }
@keyframes preview-pane-shimmer { 0%,100% { transform: translate3d(-16%,0,0); opacity:.28; } 50% { transform: translate3d(16%,0,0); opacity:.72; } }
@keyframes preview-pane-loading-dot { 0%,100% { opacity:.45; transform:scale(.88); } 50% { opacity:1; transform:scale(1); } }
@media (prefers-reduced-motion: reduce) { .preview-image-stage,.preview-pane-loading-shimmer,.preview-pane-loading-dot { animation:none !important; transition:none !important; } .preview-image-stage.is-loading { filter:none !important; opacity:1 !important; transform:none !important; } }
</style>
