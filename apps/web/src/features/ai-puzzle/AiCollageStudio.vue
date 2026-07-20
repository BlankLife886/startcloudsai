<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { proxyWallhavenImageUrl, wallpaperApi } from '@/services/api'
import { getDisplayImageUrl } from '@/services/aiWallpaper'
import notificationService from '@/services/notification'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useCollageEditor } from '@/features/ai-puzzle/composables/useCollageEditor'
import {
  BASE_BOARD_WIDTH,
  COLLAGE_CATEGORIES,
  FILTER_PRESETS,
  RATIO_PRESETS,
  TEXT_POSITIONS,
  buildBackgroundCss,
  buildFilterCss,
  computeCellRect,
  computeImageDrawRect,
  exportCollage,
  filterTemplates,
  getFilterPresetById,
  preloadImageSize,
} from '@/features/ai-puzzle/domain/collageTemplates'
import '@/features/ai-puzzle/styles/collage-studio.css'

const runtimeConfigStore = useRuntimeConfigStore()
const canUseAiPuzzle = computed(() => runtimeConfigStore.canUse('ai.puzzle'))

const {
  templateId,
  template,
  ratioId,
  boardRatio,
  cells,
  uploads,
  selectedCell,
  gap,
  radius,
  padding,
  backgroundId,
  customBgColor,
  background,
  caption,
  zoom,
  exporting,
  filledCount,
  canUndo,
  canRedo,
  BACKGROUND_PRESETS,
  setTemplate,
  setRatio,
  setBackground,
  setCustomBgColor,
  addUpload,
  removeUpload,
  assignImageToCell,
  assignImageSmart,
  clearCell,
  clearAllCells,
  updateCell,
  resetCellFraming,
  setCellFilter,
  applyFilterToAll,
  autoFillFromUploads,
  shuffleCells,
  aiRecommendTemplate,
  swapCells,
  undo,
  redo,
  recordAdjustStart,
} = useCollageEditor()

// ---------------- 界面局部状态 ----------------
const sideTab = ref('templates')
const inspectorTab = ref('canvas')
const categoryId = ref('all')
const searchQuery = ref('')
const wallpaperQuery = ref('')
const fileInput = ref(null)
const dragOverCell = ref(-1)
const draggingImageSrc = ref('')
const wallpapers = ref([])
const wallpaperLoading = ref(false)
const uploadDragOver = ref(false)
const exportMenuOpen = ref(false)
const exportFormat = ref('png')
const exportWidth = ref(2400)
const stageEl = ref(null)
let stageResizeObserver = null

/** 图片自然尺寸缓存（src -> {w, h}），用于精确取景预览 */
const imageSizes = reactive(new Map())

const EXPORT_SIZES = [
  { label: '标准 1600px', value: 1600 },
  { label: '高清 2400px', value: 2400 },
  { label: '超清 3600px', value: 3600 },
]

const filteredTemplates = computed(() => filterTemplates(categoryId.value, searchQuery.value))
const fillProgress = computed(() => {
  const total = template.value.cells.length
  if (!total) return 0
  return Math.round((filledCount.value / total) * 100)
})

function cacheImageSize(src, size) {
  if (!src || !size) return
  imageSizes.set(src, size)
}

function warmImageSize(src) {
  preloadImageSize(src, (size) => cacheImageSize(src, size))
}

// ---------------- 画布几何（与导出共用同一套计算） ----------------
const boardHeight = computed(() => BASE_BOARD_WIDTH / boardRatio.value)
const boardScale = computed(() => zoom.value / 100)

const boardOuterStyle = computed(() => ({
  width: `${BASE_BOARD_WIDTH * boardScale.value}px`,
  height: `${boardHeight.value * boardScale.value}px`,
}))

const boardStyle = computed(() => ({
  width: `${BASE_BOARD_WIDTH}px`,
  height: `${boardHeight.value}px`,
  background: buildBackgroundCss(background.value),
  transform: `scale(${boardScale.value})`,
}))

function cellRect(cell) {
  return computeCellRect(cell, BASE_BOARD_WIDTH, boardHeight.value, gap.value, padding.value)
}

function cellStyle(cell) {
  const rect = cellRect(cell)
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    borderRadius: `${radius.value}px`,
  }
}

function cellImageStyle(cell, index) {
  const state = cells.value[index]
  if (!state?.src) return {}
  const meta = imageSizes.get(state.src)
  const rect = cellRect(cell)
  const filterCss = buildFilterCss(getFilterPresetById(state.filterId).params)
  if (!meta) {
    // 尺寸未知时先用 cover 撑满，onload 后立即换成精确取景
    return {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      filter: filterCss,
    }
  }
  const draw = computeImageDrawRect(meta.w, meta.h, { x: 0, y: 0, w: rect.w, h: rect.h }, state)
  return {
    position: 'absolute',
    left: `${draw.x}px`,
    top: `${draw.y}px`,
    width: `${draw.w}px`,
    height: `${draw.h}px`,
    maxWidth: 'none',
    filter: filterCss,
  }
}

function onCellImageLoad(event, src) {
  const img = event?.target
  if (!img || !src) return
  cacheImageSize(src, { w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
}

function miniCellStyle(cell) {
  return {
    left: `${cell.x * 100}%`,
    top: `${cell.y * 100}%`,
    width: `${cell.w * 100}%`,
    height: `${cell.h * 100}%`,
  }
}

const captionStyle = computed(() => {
  const size = Math.max(12, ((Number(caption.value.size) || 5) / 100) * BASE_BOARD_WIDTH)
  const base = {
    fontSize: `${size}px`,
    color: caption.value.color || '#ffffff',
    textShadow: caption.value.shadow ? '0 2px 12px rgba(0, 0, 0, 0.55)' : 'none',
  }
  if (caption.value.position === 'top') return { ...base, top: '5%', bottom: 'auto' }
  if (caption.value.position === 'center') {
    return { ...base, top: '50%', bottom: 'auto', transform: 'translateY(-50%)' }
  }
  return { ...base, bottom: '5%', top: 'auto' }
})

const selectedCellState = computed(() => cells.value[selectedCell.value] || null)

// ---------------- 上传与素材 ----------------
function triggerUpload() {
  fileInput.value?.click()
}

function applyFiles(files) {
  let added = 0
  for (const file of files) {
    if (!file?.type?.startsWith('image/')) continue
    const src = URL.createObjectURL(file)
    addUpload(src, file.name || '本地图片')
    warmImageSize(src)
    added += 1
  }
  if (added) {
    sideTab.value = 'uploads'
    if (added === 1) {
      const last = uploads.value[0]
      if (last?.src) assignImageSmart(last.src)
    }
    notificationService.success(`已添加 ${added} 张图片`)
  }
  return added
}

function handleFileInput(event) {
  applyFiles(Array.from(event?.target?.files || []))
  if (event?.target) event.target.value = ''
}

function handleUploadDrop(event) {
  event.preventDefault()
  uploadDragOver.value = false
  applyFiles(Array.from(event.dataTransfer?.files || []))
}

// ---------------- 拖拽（素材 → 格子） ----------------
function onDragStartUpload(event, src) {
  draggingImageSrc.value = src
  event.dataTransfer.setData('text/plain', src)
  event.dataTransfer.setData('application/x-walleven-collage-src', src)
  event.dataTransfer.effectAllowed = 'copy'
}

function onDragEndUpload() {
  draggingImageSrc.value = ''
}

function onCellDragEnter(event, index) {
  event.preventDefault()
  dragOverCell.value = index
}

function onCellDragOver(event) {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
}

function onCellDragLeave(event, index) {
  const related = event.relatedTarget
  if (related && event.currentTarget.contains(related)) return
  if (dragOverCell.value === index) dragOverCell.value = -1
}

function resolveDropSrc(event) {
  const fromCustom = event.dataTransfer.getData('application/x-walleven-collage-src')
  const fromText = event.dataTransfer.getData('text/plain')
  return fromCustom || fromText || draggingImageSrc.value || ''
}

function onCellDrop(event, index) {
  event.preventDefault()
  event.stopPropagation()
  dragOverCell.value = -1

  let src = resolveDropSrc(event)
  if (!src) {
    const file = event.dataTransfer.files?.[0]
    if (file?.type?.startsWith('image/')) {
      src = URL.createObjectURL(file)
      addUpload(src, file.name || '本地图片')
    }
  }

  if (src) {
    assignImageToCell(index, src)
    inspectorTab.value = 'cell'
    warmImageSize(src)
  }
  draggingImageSrc.value = ''
}

// ---------------- 格子内取景（按住拖动重新构图） ----------------
const panState = ref(null)

function onCellPointerDown(event, index) {
  selectedCell.value = index
  const state = cells.value[index]
  if (!state?.src) {
    panState.value = { index, moved: false, empty: true }
    return
  }
  inspectorTab.value = 'cell'
  const meta = imageSizes.get(state.src)
  if (!meta) return
  const rect = cellRect(template.value.cells[index])
  const draw = computeImageDrawRect(meta.w, meta.h, { x: 0, y: 0, w: rect.w, h: rect.h }, state)
  const maxShiftX = Math.max(0, (draw.w - rect.w) / 2)
  const maxShiftY = Math.max(0, (draw.h - rect.h) / 2)
  if (maxShiftX < 1 && maxShiftY < 1) return

  panState.value = {
    index,
    moved: false,
    startX: event.clientX,
    startY: event.clientY,
    baseOffsetX: state.offsetX || 0,
    baseOffsetY: state.offsetY || 0,
    maxShiftX,
    maxShiftY,
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function onCellPointerMove(event) {
  const pan = panState.value
  if (!pan) return
  event.preventDefault()
  const scale = boardScale.value || 1
  const dx = (event.clientX - pan.startX) / scale
  const dy = (event.clientY - pan.startY) / scale
  if (!pan.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 3) return
    // 首次真实移动时才记录历史，避免单纯点击选中污染撤销栈
    recordAdjustStart()
    pan.moved = true
  }
  const patch = {}
  if (pan.maxShiftX >= 1) {
    patch.offsetX = Math.max(-1, Math.min(1, pan.baseOffsetX + dx / pan.maxShiftX))
  }
  if (pan.maxShiftY >= 1) {
    patch.offsetY = Math.max(-1, Math.min(1, pan.baseOffsetY + dy / pan.maxShiftY))
  }
  updateCell(pan.index, patch)
}

function onCellPointerUp() {
  const pan = panState.value
  if (pan?.empty && !pan.moved) {
    sideTab.value = 'uploads'
    inspectorTab.value = 'cell'
  }
  panState.value = null
}

function onCellDoubleClick(index) {
  if (cells.value[index]?.src) {
    resetCellFraming(index)
  }
}

function onCellScaleInput(value) {
  updateCell(selectedCell.value, { scale: Number(value) || 1 })
}

function onUploadItemClick(src) {
  assignImageSmart(src, selectedCell.value)
  inspectorTab.value = 'cell'
}

// ---------------- 壁纸库 ----------------
async function loadWallpapers({ random = true } = {}) {
  wallpaperLoading.value = true
  try {
    const q = wallpaperQuery.value.trim()
    const response = await wallpaperApi.search({
      q,
      sorting: q ? 'relevance' : 'random',
      purity: '100',
      page: random && !q ? Math.floor(Math.random() * 12) + 1 : 1,
    })
    wallpapers.value = (response?.images || []).slice(0, 12)
  } catch {
    wallpapers.value = []
    notificationService.warning('壁纸加载失败，可稍后重试')
  } finally {
    wallpaperLoading.value = false
  }
}

function wallpaperSrc(wallpaper) {
  return proxyWallhavenImageUrl(wallpaper.path || wallpaper.thumbs?.large || wallpaper.thumbnail)
}

function addWallpaperToUploads(wallpaper) {
  const src = wallpaperSrc(wallpaper)
  addUpload(src, wallpaper.id ? `#${wallpaper.id}` : '壁纸')
  warmImageSize(src)
  assignImageSmart(src)
  sideTab.value = 'uploads'
}

// ---------------- AI 布局 / 导出 ----------------
function handleAiLayout() {
  if (!canUseAiPuzzle.value) {
    notificationService.warning('AI 拼图当前未启用，请联系管理员检查功能配置')
    return
  }
  if (!uploads.value.length && !filledCount.value) {
    notificationService.info('先上传或挑选几张图片，AI 会按数量推荐最合适的布局')
    sideTab.value = 'uploads'
    return
  }
  const recommended = aiRecommendTemplate()
  requestAnimationFrame(() => fitZoom())
  notificationService.success(`已切换到「${recommended.name}」`)
}

async function handleExport() {
  if (!filledCount.value) {
    notificationService.warning('画布还是空的，先拖几张图进格子吧')
    return
  }
  exportMenuOpen.value = false
  exporting.value = true
  try {
    const blob = await exportCollage({
      template: template.value,
      ratioId: ratioId.value,
      cells: cells.value,
      gap: gap.value,
      radius: radius.value,
      padding: padding.value,
      background: background.value,
      text: caption.value,
      exportWidth: exportWidth.value,
      format: exportFormat.value,
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `walleven-collage-${Date.now()}.${exportFormat.value === 'jpeg' ? 'jpg' : 'png'}`
    link.click()
    URL.revokeObjectURL(url)
    notificationService.success('拼图已导出')
  } catch (err) {
    notificationService.error(err?.message || '导出失败，请重试')
  } finally {
    exporting.value = false
  }
}

function onStageWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const delta = event.deltaY > 0 ? -5 : 5
  zoom.value = Math.max(30, Math.min(150, zoom.value + delta))
}

async function onPaste(event) {
  const items = event.clipboardData?.items
  if (!items?.length) return
  const files = []
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (!files.length) return
  event.preventDefault()
  applyFiles(files)
}

function fitZoom() {
  const el = stageEl.value
  if (!el) {
    zoom.value = 85
    return
  }
  const availW = el.clientWidth - 48
  const availH = el.clientHeight - 48
  const scale = Math.min(availW / BASE_BOARD_WIDTH, availH / boardHeight.value)
  zoom.value = Math.max(30, Math.min(150, Math.round(scale * 100)))
}

// ---------------- 快捷键 ----------------
function isEditableTarget(target) {
  const tag = target?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable
}

function onKeydown(event) {
  if (isEditableTarget(event.target)) return
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
    return
  }
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault()
    handleExport()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedCellState.value?.src) {
      event.preventDefault()
      clearCell(selectedCell.value)
    }
    return
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const count = template.value.cells.length
    const delta = event.key === 'ArrowLeft' ? -1 : 1
    selectedCell.value = (selectedCell.value + delta + count) % count
  }
}

function onDocumentClick(event) {
  if (!event.target.closest?.('.collage-export-group')) {
    exportMenuOpen.value = false
  }
}

onMounted(async () => {
  await runtimeConfigStore.loadRuntimeConfig().catch(() => null)
  loadWallpapers()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('paste', onPaste)
  document.addEventListener('click', onDocumentClick, true)
  if (typeof ResizeObserver !== 'undefined' && stageEl.value) {
    stageResizeObserver = new ResizeObserver(() => fitZoom())
    stageResizeObserver.observe(stageEl.value)
  }
  requestAnimationFrame(() => fitZoom())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('paste', onPaste)
  document.removeEventListener('click', onDocumentClick, true)
  stageResizeObserver?.disconnect()
  stageResizeObserver = null
  uploads.value.forEach((item) => {
    if (item.src?.startsWith('blob:')) URL.revokeObjectURL(item.src)
  })
})

watch(selectedCell, () => {
  if (selectedCellState.value?.src) inspectorTab.value = 'cell'
})

watch(ratioId, () => {
  requestAnimationFrame(() => fitZoom())
})
</script>

<template>
  <div class="collage-studio">
    <!-- 顶栏 -->
    <header class="collage-topbar">
      <div class="collage-topbar-left">
        <div class="collage-brand">
          <span class="collage-brand-badge">
            <i class="bi bi-puzzle-fill"></i>
          </span>
          <div>
            <strong>AI 拼图工坊</strong>
            <small>选模板 · 调布局 · 一键导出</small>
          </div>
        </div>
        <div class="collage-top-status">
          <span>{{ filledCount }}/{{ template.cells.length }} 格</span>
          <span>{{ fillProgress }}%</span>
          <span>{{ exportWidth }}px</span>
        </div>
        <div class="collage-history-btns">
          <button type="button" title="撤销 (Ctrl+Z)" :disabled="!canUndo" @click="undo">
            <i class="bi bi-arrow-counterclockwise"></i>
          </button>
          <button type="button" title="重做 (Ctrl+Shift+Z)" :disabled="!canRedo" @click="redo">
            <i class="bi bi-arrow-clockwise"></i>
          </button>
        </div>
      </div>

      <div class="collage-topbar-right">
        <button
          type="button"
          class="collage-top-btn"
          :disabled="!canUseAiPuzzle"
          @click="handleAiLayout"
        >
          <i class="bi bi-stars"></i>
          <span>AI 布局</span>
        </button>
        <button
          type="button"
          class="collage-top-btn"
          :disabled="!uploads.length"
          @click="autoFillFromUploads()"
        >
          <i class="bi bi-grid-3x3-gap"></i>
          <span>自动填充</span>
        </button>
        <button
          type="button"
          class="collage-top-btn"
          :disabled="filledCount < 2"
          @click="shuffleCells()"
        >
          <i class="bi bi-shuffle"></i>
          <span>打乱</span>
        </button>

        <div class="collage-export-group">
          <button
            type="button"
            class="collage-top-btn primary"
            :disabled="exporting"
            @click="handleExport"
          >
            <i class="bi" :class="exporting ? 'bi-arrow-repeat spin' : 'bi-download'"></i>
            <span>{{ exporting ? '导出中…' : '导出' }}</span>
          </button>
          <button
            type="button"
            class="collage-top-btn primary collage-export-caret"
            :disabled="exporting"
            @click.stop="exportMenuOpen = !exportMenuOpen"
          >
            <i class="bi bi-chevron-down"></i>
          </button>

          <div v-if="exportMenuOpen" class="collage-export-menu" @click.stop>
            <div class="collage-export-menu__title">格式</div>
            <div class="collage-export-menu__row">
              <button
                type="button"
                :class="{ active: exportFormat === 'png' }"
                @click="exportFormat = 'png'"
              >
                PNG
              </button>
              <button
                type="button"
                :class="{ active: exportFormat === 'jpeg' }"
                @click="exportFormat = 'jpeg'"
              >
                JPG
              </button>
            </div>
            <div class="collage-export-menu__title">尺寸（长边）</div>
            <div class="collage-export-menu__col">
              <button
                v-for="size in EXPORT_SIZES"
                :key="size.value"
                type="button"
                :class="{ active: exportWidth === size.value }"
                @click="exportWidth = size.value"
              >
                {{ size.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="collage-workspace">
      <!-- 左侧素材栏 -->
      <aside class="collage-sidebar">
        <div class="collage-side-tabs">
          <button
            type="button"
            :class="{ active: sideTab === 'templates' }"
            @click="sideTab = 'templates'"
          >
            <i class="bi bi-grid-1x2"></i>
            模板
          </button>
          <button
            type="button"
            :class="{ active: sideTab === 'uploads' }"
            @click="sideTab = 'uploads'"
          >
            <i class="bi bi-images"></i>
            素材
            <em v-if="uploads.length">{{ uploads.length }}</em>
          </button>
          <button
            type="button"
            :class="{ active: sideTab === 'wallpapers' }"
            @click="sideTab = 'wallpapers'"
          >
            <i class="bi bi-image"></i>
            壁纸
          </button>
        </div>

        <div class="collage-side-body">
          <!-- 模板 -->
          <template v-if="sideTab === 'templates'">
            <input
              v-model="searchQuery"
              class="collage-search"
              type="search"
              placeholder="搜索模板…"
            />
            <div class="collage-category-pills">
              <button
                v-for="cat in COLLAGE_CATEGORIES"
                :key="cat.id"
                type="button"
                :class="{ active: categoryId === cat.id }"
                @click="categoryId = cat.id"
              >
                {{ cat.label }}
              </button>
            </div>
            <div class="collage-template-grid">
              <button
                v-for="item in filteredTemplates"
                :key="item.id"
                type="button"
                class="collage-template-card"
                :class="{ active: templateId === item.id }"
                @click="setTemplate(item.id)"
              >
                <div class="collage-template-preview" :style="{ aspectRatio: item.ratio || 1 }">
                  <span
                    v-for="cell in item.cells"
                    :key="cell.id"
                    :style="miniCellStyle(cell)"
                  ></span>
                </div>
                <em>{{ item.name }}</em>
                <small>{{ item.cells.length }} 格</small>
              </button>
            </div>
          </template>

          <!-- 素材 -->
          <template v-else-if="sideTab === 'uploads'">
            <div
              class="collage-upload-zone"
              :class="{ 'is-dragover': uploadDragOver }"
              @click="triggerUpload"
              @dragover.prevent="uploadDragOver = true"
              @dragleave="uploadDragOver = false"
              @drop="handleUploadDrop"
            >
              <i class="bi bi-cloud-arrow-up"></i>
              <span>点击或拖拽上传图片</span>
              <small>支持多选，图片仅在本机处理不会上传服务器</small>
            </div>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              multiple
              hidden
              @change="handleFileInput"
            />
            <p v-if="uploads.length" class="collage-hero-hint">
              点击素材填入当前格，或拖到画布；支持 Ctrl+V 粘贴图片。
            </p>
            <div v-if="uploads.length" class="collage-upload-grid">
              <div
                v-for="item in uploads"
                :key="item.id"
                class="collage-upload-item"
                draggable="true"
                @dragstart="onDragStartUpload($event, item.src)"
                @dragend="onDragEndUpload"
                @click="onUploadItemClick(item.src)"
              >
                <img :src="item.src" alt="" draggable="false" />
                <button type="button" title="移除" @click.stop="removeUpload(item.id)">
                  <i class="bi bi-x"></i>
                </button>
              </div>
            </div>
            <div v-else class="collage-side-empty">
              <i class="bi bi-images"></i>
              <span>还没有素材，先上传几张图片吧</span>
            </div>
          </template>

          <!-- 壁纸库 -->
          <template v-else>
            <div class="collage-wallpaper-toolbar">
              <input
                v-model="wallpaperQuery"
                class="collage-search"
                type="search"
                placeholder="搜索壁纸，如 landscape…"
                @keydown.enter="loadWallpapers({ random: false })"
              />
              <button
                type="button"
                class="collage-top-btn"
                :disabled="wallpaperLoading"
                @click="loadWallpapers()"
              >
                <i class="bi bi-arrow-clockwise" :class="{ spin: wallpaperLoading }"></i>
                换一批
              </button>
            </div>
            <div v-if="wallpaperLoading" class="collage-side-empty">
              <i class="bi bi-hourglass-split"></i>
              <span>加载中…</span>
            </div>
            <div v-else-if="wallpapers.length" class="collage-wallpaper-grid">
              <button
                v-for="item in wallpapers"
                :key="item.id"
                type="button"
                class="collage-wallpaper-item"
                draggable="true"
                @dragstart="onDragStartUpload($event, wallpaperSrc(item))"
                @dragend="onDragEndUpload"
                @click="addWallpaperToUploads(item)"
              >
                <img :src="getDisplayImageUrl(item)" alt="" loading="lazy" draggable="false" />
              </button>
            </div>
            <div v-else class="collage-side-empty">
              <i class="bi bi-image"></i>
              <span>没有找到壁纸，换个关键词试试</span>
            </div>
          </template>
        </div>
      </aside>

      <!-- 中央画布 -->
      <section class="collage-stage-wrap">
        <div class="collage-stage-toolbar">
          <span class="collage-stage-chip">{{ template.name }}</span>
          <span class="collage-stage-chip">{{ filledCount }}/{{ template.cells.length }} 格</span>
          <div class="collage-fill-progress" :title="`已填充 ${fillProgress}%`">
            <span :style="{ width: `${fillProgress}%` }"></span>
          </div>
          <span class="collage-stage-hint">拖入 · 粘贴 · 双击重置取景 · Ctrl+S 导出</span>
        </div>

        <div ref="stageEl" class="collage-stage" @wheel="onStageWheel">
          <div class="collage-stage-sizer">
            <div class="collage-board-outer" :style="boardOuterStyle">
              <div class="collage-board" :style="boardStyle" @dragover.prevent @drop.prevent>
              <div
                v-for="(cell, index) in template.cells"
                :key="cell.id"
                class="collage-cell"
                :class="{
                  selected: selectedCell === index,
                  'is-drop-target': dragOverCell === index,
                  'is-panning': panState?.index === index,
                }"
                :style="cellStyle(cell)"
                @pointerdown="onCellPointerDown($event, index)"
                @pointermove="onCellPointerMove"
                @pointerup="onCellPointerUp"
                @pointercancel="onCellPointerUp"
                @dblclick="onCellDoubleClick(index)"
                @dragenter="onCellDragEnter($event, index)"
                @dragover="onCellDragOver"
                @dragleave="onCellDragLeave($event, index)"
                @drop="onCellDrop($event, index)"
              >
                <span class="collage-cell-badge">{{ index + 1 }}</span>
                <img
                  v-if="cells[index]?.src"
                  :src="cells[index].src"
                  :style="cellImageStyle(cell, index)"
                  alt=""
                  draggable="false"
                  @load="onCellImageLoad($event, cells[index].src)"
                />
                <div v-else class="collage-cell-empty">
                  <i class="bi bi-plus-lg"></i>
                  <span>拖入图片</span>
                </div>
              </div>

              <div v-if="!filledCount" class="collage-board-empty" @click="sideTab = 'uploads'">
                <i class="bi bi-cloud-arrow-up"></i>
                <strong>开始创作</strong>
                <span>上传、粘贴或从壁纸库挑选图片</span>
                <button type="button" @click.stop="triggerUpload">选择图片</button>
              </div>

              <div
                v-if="caption.enabled && caption.content.trim()"
                class="collage-caption"
                :style="captionStyle"
              >
                {{ caption.content }}
              </div>
              </div>
            </div>
          </div>
        </div>

        <div class="collage-stage-footer">
          <button type="button" class="collage-zoom-btn" title="适应窗口" @click="fitZoom">
            <i class="bi bi-aspect-ratio"></i>
          </button>
          <input v-model.number="zoom" type="range" min="30" max="150" step="5" />
          <output>{{ zoom }}%</output>
        </div>
      </section>

      <!-- 右侧属性 -->
      <aside class="collage-inspector">
        <div class="collage-inspector-tabs">
          <button
            type="button"
            :class="{ active: inspectorTab === 'canvas' }"
            @click="inspectorTab = 'canvas'"
          >
            画布
          </button>
          <button
            type="button"
            :class="{ active: inspectorTab === 'cell' }"
            @click="inspectorTab = 'cell'"
          >
            格子
          </button>
        </div>

        <div class="collage-inspector-body">
          <!-- 画布设置 -->
          <template v-if="inspectorTab === 'canvas'">
            <div class="collage-field">
              <span>画布比例</span>
              <div class="collage-ratio-grid">
                <button
                  v-for="preset in RATIO_PRESETS"
                  :key="preset.id"
                  type="button"
                  :class="{ active: ratioId === preset.id }"
                  @click="setRatio(preset.id)"
                >
                  {{ preset.label }}
                </button>
              </div>
            </div>

            <div class="collage-field">
              <span>格子间距</span>
              <div class="collage-field-row">
                <input
                  v-model.number="gap"
                  type="range"
                  min="0"
                  max="28"
                  step="1"
                  @pointerdown="recordAdjustStart"
                />
                <output>{{ gap }}px</output>
              </div>
            </div>
            <div class="collage-field">
              <span>圆角</span>
              <div class="collage-field-row">
                <input
                  v-model.number="radius"
                  type="range"
                  min="0"
                  max="36"
                  step="1"
                  @pointerdown="recordAdjustStart"
                />
                <output>{{ radius }}px</output>
              </div>
            </div>
            <div class="collage-field">
              <span>画布边距</span>
              <div class="collage-field-row">
                <input
                  v-model.number="padding"
                  type="range"
                  min="0"
                  max="48"
                  step="2"
                  @pointerdown="recordAdjustStart"
                />
                <output>{{ padding }}px</output>
              </div>
            </div>

            <div class="collage-field">
              <span>背景</span>
              <div class="collage-bg-grid">
                <button
                  v-for="preset in BACKGROUND_PRESETS"
                  :key="preset.id"
                  type="button"
                  :title="preset.label"
                  :class="{ active: !customBgColor && backgroundId === preset.id }"
                  :style="{ background: buildBackgroundCss(preset) }"
                  @click="setBackground(preset.id)"
                ></button>
                <label
                  class="collage-bg-custom"
                  :class="{ active: !!customBgColor }"
                  title="自定义颜色"
                >
                  <i class="bi bi-eyedropper"></i>
                  <input
                    type="color"
                    :value="customBgColor || '#ffffff'"
                    @input="setCustomBgColor($event.target.value)"
                  />
                </label>
              </div>
            </div>

            <div class="collage-field">
              <span class="collage-field-toggle">
                标题文字
                <button
                  type="button"
                  class="collage-switch"
                  :class="{ on: caption.enabled }"
                  @click="caption.enabled = !caption.enabled"
                >
                  <i></i>
                </button>
              </span>
              <template v-if="caption.enabled">
                <input
                  v-model="caption.content"
                  class="collage-search"
                  type="text"
                  maxlength="40"
                  placeholder="输入标题文字…"
                />
                <div class="collage-text-row">
                  <div class="collage-ratio-grid collage-text-pos">
                    <button
                      v-for="pos in TEXT_POSITIONS"
                      :key="pos.id"
                      type="button"
                      :class="{ active: caption.position === pos.id }"
                      @click="caption.position = pos.id"
                    >
                      {{ pos.label }}
                    </button>
                  </div>
                  <input
                    v-model="caption.color"
                    class="collage-text-color"
                    type="color"
                    title="文字颜色"
                  />
                </div>
                <div class="collage-field-row">
                  <input v-model.number="caption.size" type="range" min="3" max="10" step="0.5" />
                  <output>字号</output>
                </div>
              </template>
            </div>

            <div class="collage-field">
              <span>整体操作</span>
              <div class="collage-quick-actions">
                <button type="button" :disabled="!filledCount" @click="clearAllCells()">
                  <i class="bi bi-eraser"></i>
                  清空所有格子
                </button>
              </div>
            </div>
          </template>

          <!-- 格子设置 -->
          <template v-else>
            <div class="collage-cell-indicator">
              <span>第 {{ selectedCell + 1 }} 格</span>
              <small>{{ selectedCellState?.src ? '已填充' : '空白' }}</small>
            </div>

            <template v-if="selectedCellState?.src">
              <div class="collage-field">
                <span>取景缩放</span>
                <div class="collage-field-row">
                  <input
                    :value="selectedCellState.scale"
                    type="range"
                    min="1"
                    max="3"
                    step="0.05"
                    @pointerdown="recordAdjustStart"
                    @input="onCellScaleInput($event.target.value)"
                  />
                  <output>{{ Math.round(selectedCellState.scale * 100) }}%</output>
                </div>
                <p class="collage-field-note">放大后直接在画布上拖动图片调整构图</p>
              </div>

              <div class="collage-field">
                <span>滤镜</span>
                <div class="collage-filter-grid">
                  <button
                    v-for="preset in FILTER_PRESETS"
                    :key="preset.id"
                    type="button"
                    :class="{ active: selectedCellState.filterId === preset.id }"
                    @click="setCellFilter(selectedCell, preset.id)"
                  >
                    <img
                      :src="selectedCellState.src"
                      :style="{ filter: buildFilterCss(preset.params) }"
                      alt=""
                      draggable="false"
                    />
                    <em>{{ preset.label }}</em>
                  </button>
                </div>
                <div class="collage-quick-actions" style="margin-top: 8px">
                  <button type="button" @click="applyFilterToAll(selectedCellState.filterId)">
                    <i class="bi bi-magic"></i>
                    应用到全部格子
                  </button>
                </div>
              </div>
            </template>

            <div class="collage-field">
              <span>格子操作</span>
              <div class="collage-quick-actions">
                <button
                  type="button"
                  :disabled="!selectedCellState?.src"
                  @click="resetCellFraming(selectedCell)"
                >
                  <i class="bi bi-arrows-angle-contract"></i>
                  重置取景
                </button>
                <button
                  type="button"
                  :disabled="selectedCell <= 0"
                  @click="swapCells(selectedCell, selectedCell - 1)"
                >
                  <i class="bi bi-arrow-left-right"></i>
                  与上一格交换
                </button>
                <button
                  type="button"
                  :disabled="selectedCell >= template.cells.length - 1"
                  @click="swapCells(selectedCell, selectedCell + 1)"
                >
                  <i class="bi bi-arrow-left-right"></i>
                  与下一格交换
                </button>
                <button
                  type="button"
                  :disabled="!selectedCellState?.src"
                  @click="clearCell(selectedCell)"
                >
                  <i class="bi bi-trash3"></i>
                  清空当前格
                </button>
              </div>
            </div>

            <p class="collage-hero-hint">
              快捷键：← → 切换格子，Delete 清空，Ctrl+Z 撤销，Ctrl+S 导出
            </p>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>
