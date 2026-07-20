import { computed, ref } from 'vue'
import {
  BACKGROUND_PRESETS,
  COLLAGE_TEMPLATES,
  getBackgroundPresetById,
  getTemplateById,
  recommendTemplate,
  resolveBoardRatio,
} from '@/features/ai-puzzle/domain/collageTemplates'

const HISTORY_LIMIT = 60

function createCellState(src = '') {
  return { src, scale: 1, offsetX: 0, offsetY: 0, filterId: 'none' }
}

function cloneCells(cells) {
  return cells.map((cell) => ({ ...cell }))
}

/**
 * 拼图编辑器状态：模板 / 画布 / 富格子（取景 + 滤镜）/ 文字 / 撤销重做。
 */
export function useCollageEditor() {
  const templateId = ref(COLLAGE_TEMPLATES[0].id)
  const ratioId = ref('auto')
  const cells = ref([])
  const uploads = ref([])
  const selectedCell = ref(0)
  const gap = ref(8)
  const radius = ref(6)
  const padding = ref(0)
  const backgroundId = ref('white')
  const customBgColor = ref('')
  const caption = ref({
    enabled: false,
    content: '',
    position: 'bottom',
    color: '#ffffff',
    size: 5,
    shadow: true,
  })
  const zoom = ref(85)
  const exporting = ref(false)

  const undoStack = ref([])
  const redoStack = ref([])

  const template = computed(() => getTemplateById(templateId.value))
  const boardRatio = computed(() => resolveBoardRatio(template.value, ratioId.value))
  const background = computed(() => {
    if (customBgColor.value) return { type: 'solid', color: customBgColor.value }
    return getBackgroundPresetById(backgroundId.value)
  })
  const filledCount = computed(() => cells.value.filter((cell) => cell.src).length)
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  // ---- 历史快照（仅记录影响作品结果的状态） ----
  function snapshot() {
    return {
      templateId: templateId.value,
      ratioId: ratioId.value,
      cells: cloneCells(cells.value),
      gap: gap.value,
      radius: radius.value,
      padding: padding.value,
      backgroundId: backgroundId.value,
      customBgColor: customBgColor.value,
      caption: { ...caption.value },
    }
  }

  function restore(state) {
    templateId.value = state.templateId
    ratioId.value = state.ratioId
    cells.value = cloneCells(state.cells)
    gap.value = state.gap
    radius.value = state.radius
    padding.value = state.padding
    backgroundId.value = state.backgroundId
    customBgColor.value = state.customBgColor
    caption.value = { ...state.caption }
    syncCellSlots()
  }

  function pushHistory() {
    undoStack.value.push(snapshot())
    if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
    redoStack.value = []
  }

  function undo() {
    const prev = undoStack.value.pop()
    if (!prev) return
    redoStack.value.push(snapshot())
    restore(prev)
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(snapshot())
    restore(next)
  }

  // ---- 基础操作 ----
  function syncCellSlots() {
    const count = template.value.cells.length
    const next = cloneCells(cells.value)
    while (next.length < count) next.push(createCellState())
    cells.value = next.slice(0, count)
    if (selectedCell.value >= count) selectedCell.value = 0
  }

  function setTemplate(id) {
    if (templateId.value === id) return
    pushHistory()
    templateId.value = id
    syncCellSlots()
  }

  function setRatio(id) {
    if (ratioId.value === id) return
    pushHistory()
    ratioId.value = id
  }

  function setBackground(id) {
    pushHistory()
    backgroundId.value = id
    customBgColor.value = ''
  }

  function setCustomBgColor(color) {
    pushHistory()
    customBgColor.value = color
  }

  function addUpload(src, label = '') {
    if (!src) return null
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, src, label }
    uploads.value.unshift(item)
    return item
  }

  function removeUpload(id) {
    const removed = uploads.value.find((item) => item.id === id)
    uploads.value = uploads.value.filter((item) => item.id !== id)
    if (removed?.src && cells.value.some((cell) => cell.src === removed.src)) {
      pushHistory()
      cells.value = cells.value.map((cell) =>
        cell.src === removed.src ? createCellState() : cell,
      )
    }
    if (removed?.src?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.src)
    }
  }

  function collectImageSources() {
    const seen = new Set()
    const sources = []
    const push = (src) => {
      const value = String(src || '').trim()
      if (!value || seen.has(value)) return
      seen.add(value)
      sources.push(value)
    }
    uploads.value.forEach((item) => push(item.src))
    cells.value.forEach((cell) => push(cell.src))
    return sources
  }

  function findNextEmptyCell(start = 0) {
    const count = cells.value.length
    if (!count) return 0
    for (let offset = 0; offset < count; offset += 1) {
      const index = (start + offset) % count
      if (!cells.value[index]?.src) return index
    }
    return start % count
  }

  function assignImageToCell(cellIndex, src) {
    if (cellIndex < 0 || cellIndex >= template.value.cells.length || !src) return
    const current = cells.value[cellIndex]
    if (current?.src === src) return
    pushHistory()
    syncCellSlots()
    const next = cloneCells(cells.value)
    next[cellIndex] = createCellState(src)
    cells.value = next
    selectedCell.value = cellIndex
  }

  function assignImageSmart(src, preferIndex = selectedCell.value) {
    if (!src) return -1
    syncCellSlots()
    const count = cells.value.length
    const preferred = Math.max(0, Math.min(preferIndex, count - 1))
    const target = cells.value[preferred]?.src
      ? findNextEmptyCell((preferred + 1) % count)
      : preferred
    assignImageToCell(target, src)
    selectedCell.value = findNextEmptyCell((target + 1) % count)
    return target
  }

  function clearCell(cellIndex) {
    if (!cells.value[cellIndex]?.src) return
    pushHistory()
    const next = cloneCells(cells.value)
    next[cellIndex] = createCellState()
    cells.value = next
  }

  function clearAllCells() {
    if (!filledCount.value) return
    pushHistory()
    cells.value = template.value.cells.map(() => createCellState())
  }

  function updateCell(cellIndex, patch, { recordHistory = false } = {}) {
    if (cellIndex < 0 || cellIndex >= cells.value.length) return
    if (recordHistory) pushHistory()
    const next = cloneCells(cells.value)
    next[cellIndex] = { ...next[cellIndex], ...patch }
    cells.value = next
  }

  function resetCellFraming(cellIndex) {
    updateCell(cellIndex, { scale: 1, offsetX: 0, offsetY: 0 }, { recordHistory: true })
  }

  function setCellFilter(cellIndex, filterId) {
    if (cells.value[cellIndex]?.filterId === filterId) return
    updateCell(cellIndex, { filterId }, { recordHistory: true })
  }

  function applyFilterToAll(filterId) {
    pushHistory()
    cells.value = cells.value.map((cell) => ({ ...cell, filterId }))
  }

  function autoFillFromUploads() {
    if (!uploads.value.length) return
    pushHistory()
    syncCellSlots()
    const next = cloneCells(cells.value)
    const sources = uploads.value.map((item) => item.src)
    let sourceIndex = 0
    for (let i = 0; i < next.length && sourceIndex < sources.length; i += 1) {
      if (!next[i].src) {
        next[i] = createCellState(sources[sourceIndex])
        sourceIndex += 1
      }
    }
    cells.value = next
  }

  function shuffleCells() {
    const filled = cells.value.filter((cell) => cell.src)
    if (filled.length < 2) return
    pushHistory()
    const shuffledSrcs = filled.map((cell) => ({ ...cell }))
    for (let i = shuffledSrcs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffledSrcs[i], shuffledSrcs[j]] = [shuffledSrcs[j], shuffledSrcs[i]]
    }
    let cursor = 0
    cells.value = cells.value.map((cell) => (cell.src ? { ...shuffledSrcs[cursor++] } : cell))
  }

  function aiRecommendTemplate() {
    const sources = collectImageSources()
    const count = Math.max(sources.length, 2)
    const recommended = recommendTemplate(count)
    pushHistory()
    templateId.value = recommended.id
    syncCellSlots()
    cells.value = template.value.cells.map((_, index) =>
      createCellState(sources[index] || ''),
    )
    selectedCell.value = findNextEmptyCell(0)
    return recommended
  }

  function swapCells(a, b) {
    if (a === b || a < 0 || b < 0 || a >= cells.value.length || b >= cells.value.length) return
    pushHistory()
    const next = cloneCells(cells.value)
    ;[next[a], next[b]] = [next[b], next[a]]
    cells.value = next
  }

  function recordAdjustStart() {
    pushHistory()
  }

  syncCellSlots()

  return {
    // 状态
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
    // 动作
    setTemplate,
    setRatio,
    setBackground,
    setCustomBgColor,
    addUpload,
    removeUpload,
    assignImageToCell,
    assignImageSmart,
    findNextEmptyCell,
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
    pushHistory,
    recordAdjustStart,
    syncCellSlots,
  }
}
