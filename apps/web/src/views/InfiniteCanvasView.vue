<script setup>
import {
  App,
  Box,
  Frame,
  Image as LeaferImage,
  PropertyEvent,
  Rect,
  Text,
} from 'leafer-ui'
import {
  EditorEvent,
  EditorMoveEvent,
  EditorRotateEvent,
  EditorScaleEvent,
} from '@leafer-in/editor'
import '@leafer-in/resize'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  clearInfiniteCanvasDocument,
  loadInfiniteCanvasDocument,
  saveInfiniteCanvasDocument,
} from '@/features/infinite-canvas/infiniteCanvasStorage'

const DOCUMENT_VERSION = 1
const MAX_HISTORY = 50
const SAVE_DELAY = 450

const root = ref(null)
const canvasHost = ref(null)
const fileInput = ref(null)
const documentName = ref('未命名画布')
const activeTool = ref('select')
const selectedNode = ref(null)
const nodeCount = ref(0)
const zoomPercent = ref(100)
const saveState = ref('ready')
const exporting = ref(false)
const historyPast = ref([])
const historyFuture = ref([])

let app = null
let resizeObserver = null
let saveTimer = 0
let historyTimer = 0
let applyingSnapshot = false
let lastSnapshot = ''
let placementIndex = 0
let mounted = false

const canUndo = computed(() => historyPast.value.length > 0)
const canRedo = computed(() => historyFuture.value.length > 0)
const hasSelection = computed(() => Boolean(selectedNode.value))
const selectionKind = computed(() => selectedNode.value?.data?.kind || '')
const selectedText = computed({
  get: () => {
    const node = selectedNode.value
    if (!node) return ''
    if (selectionKind.value === 'note') return String(node.children?.[0]?.text || '')
    return String(node.text || '')
  },
  set: (value) => {
    const node = selectedNode.value
    if (!node) return
    if (selectionKind.value === 'note' && node.children?.[0]) node.children[0].text = value
    else if ('text' in node) node.text = value
    scheduleDocumentChange()
  },
})
const selectedFill = computed({
  get: () => {
    const fill = selectedNode.value?.fill
    return typeof fill === 'string' && fill.startsWith('#') ? fill : '#ffffff'
  },
  set: (value) => {
    if (!selectedNode.value || selectionKind.value === 'image') return
    selectedNode.value.fill = value
    scheduleDocumentChange()
  },
})
const selectionSupportsText = computed(() => ['text', 'note'].includes(selectionKind.value))
const selectionSupportsFill = computed(() => ['text', 'note', 'shape', 'frame'].includes(selectionKind.value))
const saveLabel = computed(() => {
  if (saveState.value === 'saving') return '保存中'
  if (saveState.value === 'error') return '仅本次会话'
  if (saveState.value === 'saved') return '已保存'
  return '就绪'
})

function selectedList() {
  const target = app?.editor?.target
  if (!target) return []
  return Array.isArray(target) ? target : [target]
}

function updateSelection(target = app?.editor?.target) {
  const list = Array.isArray(target) ? target : target ? [target] : []
  selectedNode.value = list.length === 1 ? list[0] : null
}

function updateNodeCount() {
  nodeCount.value = app?.tree?.children?.length || 0
}

function viewState() {
  const layer = app?.tree?.zoomLayer
  return layer
    ? { x: layer.x || 0, y: layer.y || 0, scaleX: layer.scaleX || 1, scaleY: layer.scaleY || 1 }
    : { x: 0, y: 0, scaleX: 1, scaleY: 1 }
}

function documentData() {
  return {
    version: DOCUMENT_VERSION,
    name: documentName.value,
    nodes: (app?.tree?.children || []).map((node) => node.toJSON()),
    view: viewState(),
  }
}

function snapshot() {
  return JSON.stringify(documentData())
}

function applyView(view) {
  const layer = app?.tree?.zoomLayer
  if (!layer || !view) return
  layer.set({
    x: Number(view.x) || 0,
    y: Number(view.y) || 0,
    scaleX: Number(view.scaleX) || 1,
    scaleY: Number(view.scaleY) || 1,
  })
  updateZoomLabel()
}

function restoreDocument(document, { remember = true } = {}) {
  if (!app || document?.version !== DOCUMENT_VERSION || !Array.isArray(document.nodes)) return false
  applyingSnapshot = true
  app.editor.target = null
  app.tree.clear()
  if (document.nodes.length) app.tree.add(document.nodes)
  documentName.value = String(document.name || '未命名画布')
  applyView(document.view)
  updateSelection(null)
  updateNodeCount()
  applyingSnapshot = false
  if (remember) {
    lastSnapshot = snapshot()
    historyPast.value = []
    historyFuture.value = []
  }
  return true
}

async function persistDocument() {
  if (!app || applyingSnapshot) return
  saveTimer = 0
  saveState.value = 'saving'
  try {
    await saveInfiniteCanvasDocument(documentData())
    saveState.value = 'saved'
  } catch {
    saveState.value = 'error'
  }
}

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveState.value = 'saving'
  saveTimer = window.setTimeout(persistDocument, SAVE_DELAY)
}

function recordHistory() {
  historyTimer = 0
  if (!app || applyingSnapshot) return
  const current = snapshot()
  if (!lastSnapshot) {
    lastSnapshot = current
    scheduleSave()
    return
  }
  if (current === lastSnapshot) return
  historyPast.value = [...historyPast.value.slice(-(MAX_HISTORY - 1)), lastSnapshot]
  historyFuture.value = []
  lastSnapshot = current
  updateNodeCount()
  scheduleSave()
}

function scheduleDocumentChange() {
  if (!app || applyingSnapshot) return
  if (historyTimer) window.clearTimeout(historyTimer)
  historyTimer = window.setTimeout(recordHistory, 180)
}

function flushHistory() {
  if (!historyTimer) return
  window.clearTimeout(historyTimer)
  recordHistory()
}

function applySnapshot(raw) {
  try {
    applyingSnapshot = true
    const document = JSON.parse(raw)
    app.editor.target = null
    app.tree.clear()
    if (document.nodes?.length) app.tree.add(document.nodes)
    documentName.value = String(document.name || '未命名画布')
    applyView(document.view)
    updateSelection(null)
    updateNodeCount()
    lastSnapshot = raw
    applyingSnapshot = false
    scheduleSave()
  } catch {
    applyingSnapshot = false
  }
}

function undo() {
  flushHistory()
  const previous = historyPast.value.at(-1)
  if (!previous) return
  historyPast.value = historyPast.value.slice(0, -1)
  historyFuture.value = [...historyFuture.value, lastSnapshot]
  applySnapshot(previous)
}

function redo() {
  flushHistory()
  const next = historyFuture.value.at(-1)
  if (!next) return
  historyFuture.value = historyFuture.value.slice(0, -1)
  historyPast.value = [...historyPast.value, lastSnapshot]
  applySnapshot(next)
}

function updateZoomLabel() {
  zoomPercent.value = Math.round((app?.tree?.zoomLayer?.scaleX || 1) * 100)
}

function setZoom(scale) {
  const host = canvasHost.value
  const layer = app?.tree?.zoomLayer
  if (!host || !layer) return
  const current = Number(layer.scaleX) || 1
  const next = Math.min(8, Math.max(0.08, Number(scale) || 1))
  const center = {
    x: (host.clientWidth / 2 - (Number(layer.x) || 0)) / current,
    y: (host.clientHeight / 2 - (Number(layer.y) || 0)) / current,
  }
  layer.set({
    x: host.clientWidth / 2 - center.x * next,
    y: host.clientHeight / 2 - center.y * next,
    scaleX: next,
    scaleY: next,
  })
  updateZoomLabel()
  scheduleSave()
}

function fitView() {
  const host = canvasHost.value
  const layer = app?.tree?.zoomLayer
  if (!app || !host || !layer) return
  if (!app.tree.children.length) {
    layer.set({ x: 0, y: 0, scaleX: 1, scaleY: 1 })
    updateZoomLabel()
    scheduleSave()
    return
  }
  const bounds = app.tree.getBounds('render', 'local')
  const padding = 100
  const scale = Math.min(
    8,
    Math.max(
      0.08,
      Math.min(
        Math.max(1, host.clientWidth - padding * 2) / Math.max(1, bounds.width),
        Math.max(1, host.clientHeight - padding * 2) / Math.max(1, bounds.height),
      ),
    ),
  )
  layer.set({
    x: (host.clientWidth - bounds.width * scale) / 2 - bounds.x * scale,
    y: (host.clientHeight - bounds.height * scale) / 2 - bounds.y * scale,
    scaleX: scale,
    scaleY: scale,
  })
  updateZoomLabel()
  scheduleSave()
}

function zoomIn() {
  setZoom((app?.tree?.zoomLayer?.scaleX || 1) * 1.15)
}

function zoomOut() {
  setZoom((app?.tree?.zoomLayer?.scaleX || 1) / 1.15)
}

function setTool(tool) {
  activeTool.value = tool
  if (!app) return
  const selecting = tool === 'select'
  app.editor.visible = selecting
  app.editor.hittable = selecting
  app.tree.hittable = selecting
  if (!selecting) app.editor.target = null
  updateSelection()
}

function nextPosition(width, height) {
  const host = canvasHost.value
  const fallback = { x: placementIndex * 28, y: placementIndex * 28 }
  placementIndex = (placementIndex + 1) % 8
  if (!host || !app) return fallback
  try {
    const layer = app.tree.zoomLayer
    const scaleX = Number(layer.scaleX) || 1
    const scaleY = Number(layer.scaleY) || 1
    const point = {
      x: (host.clientWidth / 2 - (Number(layer.x) || 0)) / scaleX,
      y: (host.clientHeight / 2 - (Number(layer.y) || 0)) / scaleY,
    }
    return { x: point.x - width / 2 + fallback.x, y: point.y - height / 2 + fallback.y }
  } catch {
    return fallback
  }
}

function addNode(node) {
  if (!app) return
  app.tree.add(node)
  app.editor.target = node
  updateSelection(node)
  setTool('select')
  scheduleDocumentChange()
}

function addText() {
  const size = { width: 320, height: 72 }
  addNode(
    new Text({
      ...nextPosition(size.width, size.height),
      ...size,
      text: '输入文本',
      fill: '#20232c',
      fontSize: 36,
      fontWeight: 600,
      lineHeight: 1.25,
      textWrap: 'normal',
      editable: true,
      data: { kind: 'text', name: '文本' },
    }),
  )
}

function addNote() {
  const size = { width: 300, height: 220 }
  const note = new Box({
    ...nextPosition(size.width, size.height),
    ...size,
    fill: '#fff1a8',
    cornerRadius: 10,
    shadow: { x: 0, y: 10, blur: 24, color: 'rgba(40, 44, 58, 0.16)' },
    editable: true,
    data: { kind: 'note', name: '便签' },
  })
  note.add(
    new Text({
      x: 20,
      y: 18,
      width: size.width - 40,
      height: size.height - 36,
      text: '便签',
      fill: '#4d4324',
      fontSize: 22,
      lineHeight: 1.45,
      textWrap: 'normal',
      hittable: false,
    }),
  )
  addNode(note)
}

function addShape() {
  const size = { width: 280, height: 180 }
  addNode(
    new Rect({
      ...nextPosition(size.width, size.height),
      ...size,
      fill: '#dce7ff',
      stroke: '#7b9cff',
      strokeWidth: 2,
      cornerRadius: 12,
      editable: true,
      data: { kind: 'shape', name: '矩形' },
    }),
  )
}

function addFrame() {
  const size = { width: 640, height: 420 }
  addNode(
    new Frame({
      ...nextPosition(size.width, size.height),
      ...size,
      fill: '#ffffff',
      stroke: '#dfe3eb',
      strokeWidth: 1,
      cornerRadius: 4,
      shadow: { x: 0, y: 12, blur: 32, color: 'rgba(31, 36, 50, 0.12)' },
      editable: true,
      data: { kind: 'frame', name: '画板' },
    }),
  )
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'))
    reader.readAsDataURL(file)
  })
}

async function imageDimensions(file) {
  if (typeof createImageBitmap !== 'function') return { width: 480, height: 360 }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const dimensions = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return dimensions
}

async function importImageFile(file) {
  if (!file?.type?.startsWith('image/')) return
  const [url, dimensions] = await Promise.all([readFileAsDataURL(file), imageDimensions(file)])
  const scale = Math.min(1, 560 / dimensions.width, 480 / dimensions.height)
  const width = Math.max(80, Math.round(dimensions.width * scale))
  const height = Math.max(80, Math.round(dimensions.height * scale))
  addNode(
    new LeaferImage({
      ...nextPosition(width, height),
      width,
      height,
      url,
      cornerRadius: 6,
      editable: true,
      data: { kind: 'image', name: file.name || '图片' },
    }),
  )
}

async function importFiles(files) {
  for (const file of Array.from(files || []).filter((entry) => entry.type?.startsWith('image/'))) {
    await importImageFile(file)
  }
}

async function onFileChange(event) {
  await importFiles(event.target.files)
  event.target.value = ''
}

async function onDrop(event) {
  event.preventDefault()
  await importFiles(event.dataTransfer?.files)
}

function onDragOver(event) {
  if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault()
}

async function onPaste(event) {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
  const images = Array.from(event.clipboardData?.files || []).filter((file) =>
    file.type?.startsWith('image/'),
  )
  if (!images.length) return
  event.preventDefault()
  await importFiles(images)
}

function deleteSelection() {
  const list = selectedList()
  if (!list.length) return
  app.editor.target = null
  list.forEach((node) => node.remove())
  updateSelection(null)
  scheduleDocumentChange()
}

function duplicateSelection() {
  const list = selectedList()
  if (!list.length) return
  const clones = list.map((node) => node.clone({ x: (node.x || 0) + 28, y: (node.y || 0) + 28 }))
  app.tree.add(clones)
  app.editor.target = clones.length === 1 ? clones[0] : clones
  updateSelection(app.editor.target)
  scheduleDocumentChange()
}

function moveLayer(direction) {
  const node = selectedNode.value
  if (!node?.parent) return
  const siblings = node.parent.children
  const index = siblings.indexOf(node)
  const target = direction === 'front' ? siblings.length - 1 : 0
  if (index === target) return
  node.parent.add(node, target)
  scheduleDocumentChange()
}

function updateNumber(attribute, value) {
  const node = selectedNode.value
  const number = Number(value)
  if (!node || !Number.isFinite(number)) return
  node.set({ [attribute]: number })
  scheduleDocumentChange()
}

async function exportCanvas() {
  if (!app?.tree?.children?.length || exporting.value) return
  exporting.value = true
  try {
    const result = await app.tree.export('png', {
      blob: true,
      trim: true,
      padding: 32,
      fill: '#f3f4f7',
      pixelRatio: 1,
    })
    if (!(result?.data instanceof Blob)) return
    const url = URL.createObjectURL(result.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${documentName.value.trim() || '无限画布'}.png`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    exporting.value = false
  }
}

async function clearCanvas() {
  if (app?.tree?.children?.length && !window.confirm('清空当前画布？此操作可以撤销。')) return
  app.editor.target = null
  app.tree.clear()
  updateSelection(null)
  updateNodeCount()
  scheduleDocumentChange()
  await clearInfiniteCanvasDocument().catch(() => null)
}

function onKeydown(event) {
  const target = event.target
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (mod && event.key.toLowerCase() === 'd' && !editing) {
    event.preventDefault()
    duplicateSelection()
    return
  }
  if (editing) return
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
  } else if (event.key === 'Escape') {
    app.editor.target = null
    updateSelection(null)
  } else if (event.key === '0') {
    fitView()
  } else if (event.key === '+' || event.key === '=') {
    zoomIn()
  } else if (event.key === '-') {
    zoomOut()
  }
}

function createApp() {
  const host = canvasHost.value
  if (!host || app) return
  app = new App({
    view: host,
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    fill: null,
    type: 'design',
    wheel: { zoomMode: 'mouse', zoomSpeed: 0.08, preventDefault: true },
    zoom: { min: 0.08, max: 8 },
    move: {
      drag: 'auto',
      dragEmpty: true,
      dragAnimate: true,
      holdSpaceKey: true,
      holdMiddleKey: true,
    },
    pointer: { snap: false, hitRadius: 2 },
    editor: {
      select: 'press',
      multipleSelect: true,
      boxSelect: true,
      rotateable: true,
      skewable: false,
      lockRatio: false,
      editSize: 'scale',
      stroke: '#5b4dff',
      strokeWidth: 1.5,
      point: { width: 10, height: 10, fill: '#ffffff', stroke: '#5b4dff', strokeWidth: 1.5 },
      middlePoint: { width: 8, height: 8, fill: '#ffffff', stroke: '#5b4dff', strokeWidth: 1.5 },
    },
  })
  app.editor.on(EditorEvent.SELECT, (event) => updateSelection(event.value))
  app.editor.on(EditorMoveEvent.MOVE, scheduleDocumentChange)
  app.editor.on(EditorScaleEvent.SCALE, scheduleDocumentChange)
  app.editor.on(EditorRotateEvent.ROTATE, scheduleDocumentChange)
  app.tree.on(PropertyEvent.CHANGE, scheduleDocumentChange)
  app.tree.zoomLayer.on(PropertyEvent.CHANGE, () => {
    updateZoomLabel()
    scheduleSave()
  })
  resizeObserver = new ResizeObserver(() => {
    if (!app || !canvasHost.value) return
    app.resize({
      width: Math.max(1, canvasHost.value.clientWidth),
      height: Math.max(1, canvasHost.value.clientHeight),
    })
  })
  resizeObserver.observe(host)
}

onMounted(async () => {
  mounted = true
  await nextTick()
  createApp()
  const cached = await loadInfiniteCanvasDocument().catch(() => null)
  if (!mounted || !app) return
  if (!restoreDocument(cached)) {
    lastSnapshot = snapshot()
    saveState.value = 'ready'
  } else {
    saveState.value = 'saved'
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('paste', onPaste)
})

onBeforeUnmount(() => {
  flushHistory()
  mounted = false
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    void persistDocument()
  }
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('paste', onPaste)
  resizeObserver?.disconnect()
  resizeObserver = null
  app?.destroy()
  app = null
})
</script>

<template>
  <main ref="root" class="infinite-canvas-page">
    <header class="canvas-topbar">
      <div class="canvas-brand">
        <i class="bi bi-bounding-box-circles" aria-hidden="true"></i>
        <input
          v-model="documentName"
          aria-label="画布名称"
          maxlength="60"
          @change="scheduleDocumentChange"
        />
        <span :class="{ 'is-error': saveState === 'error' }">{{ saveLabel }}</span>
      </div>

      <div class="canvas-command-group" aria-label="编辑操作">
        <button type="button" title="撤销" :disabled="!canUndo" @click="undo">
          <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
        </button>
        <button type="button" title="重做" :disabled="!canRedo" @click="redo">
          <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
        </button>
        <span class="canvas-divider"></span>
        <button type="button" title="缩小" @click="zoomOut">
          <i class="bi bi-dash-lg" aria-hidden="true"></i>
        </button>
        <button type="button" class="zoom-value" title="适配视图" @click="fitView">
          {{ zoomPercent }}%
        </button>
        <button type="button" title="放大" @click="zoomIn">
          <i class="bi bi-plus-lg" aria-hidden="true"></i>
        </button>
        <button type="button" title="适配视图" @click="fitView">
          <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>
        </button>
      </div>

      <div class="canvas-topbar-actions">
        <button type="button" class="text-command" @click="fileInput?.click()">
          <i class="bi bi-image" aria-hidden="true"></i><span>导入</span>
        </button>
        <button type="button" class="text-command" :disabled="!nodeCount" @click="exportCanvas">
          <i class="bi bi-download" aria-hidden="true"></i>
          <span>{{ exporting ? '导出中' : '导出' }}</span>
        </button>
        <button type="button" title="清空画布" :disabled="!nodeCount" @click="clearCanvas">
          <i class="bi bi-trash3" aria-hidden="true"></i>
        </button>
      </div>
      <input
        ref="fileInput"
        hidden
        multiple
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        @change="onFileChange"
      />
    </header>

    <section class="canvas-workbench">
      <aside class="canvas-toolrail" aria-label="画布工具">
        <button
          type="button"
          title="选择"
          :class="{ 'is-active': activeTool === 'select' }"
          @click="setTool('select')"
        >
          <i class="bi bi-cursor-fill" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          title="抓手"
          :class="{ 'is-active': activeTool === 'hand' }"
          @click="setTool('hand')"
        >
          <i class="bi bi-hand-index-thumb" aria-hidden="true"></i>
        </button>
        <span class="toolrail-divider"></span>
        <button type="button" title="文本" @click="addText">
          <i class="bi bi-fonts" aria-hidden="true"></i>
        </button>
        <button type="button" title="便签" @click="addNote">
          <i class="bi bi-sticky" aria-hidden="true"></i>
        </button>
        <button type="button" title="矩形" @click="addShape">
          <i class="bi bi-square" aria-hidden="true"></i>
        </button>
        <button type="button" title="画板" @click="addFrame">
          <i class="bi bi-window" aria-hidden="true"></i>
        </button>
        <button type="button" title="图片" @click="fileInput?.click()">
          <i class="bi bi-card-image" aria-hidden="true"></i>
        </button>
      </aside>

      <div
        ref="canvasHost"
        class="canvas-stage"
        :class="{ 'is-hand': activeTool === 'hand', 'is-empty': !nodeCount }"
        @drop="onDrop"
        @dragover="onDragOver"
      >
        <div v-if="!nodeCount" class="canvas-empty-state" aria-hidden="true">
          <i class="bi bi-bounding-box-circles"></i>
          <span>空白画布</span>
        </div>
      </div>

      <aside class="canvas-inspector" :class="{ 'has-selection': hasSelection }">
        <template v-if="hasSelection">
          <div class="inspector-heading">
            <div>
              <strong>{{ selectedNode.data?.name || selectedNode.name || '图层' }}</strong>
              <span>{{ selectionKind || selectedNode.__tag }}</span>
            </div>
            <button type="button" title="删除" @click="deleteSelection">
              <i class="bi bi-trash3" aria-hidden="true"></i>
            </button>
          </div>

          <div class="inspector-section inspector-geometry">
            <label>
              <span>X</span>
              <input
                type="number"
                :value="Math.round(selectedNode.x || 0)"
                @change="updateNumber('x', $event.target.value)"
              />
            </label>
            <label>
              <span>Y</span>
              <input
                type="number"
                :value="Math.round(selectedNode.y || 0)"
                @change="updateNumber('y', $event.target.value)"
              />
            </label>
            <label>
              <span>W</span>
              <input
                type="number"
                min="1"
                :value="Math.round(selectedNode.width || 1)"
                @change="updateNumber('width', $event.target.value)"
              />
            </label>
            <label>
              <span>H</span>
              <input
                type="number"
                min="1"
                :value="Math.round(selectedNode.height || 1)"
                @change="updateNumber('height', $event.target.value)"
              />
            </label>
          </div>

          <label v-if="selectionSupportsText" class="inspector-section inspector-text">
            <span>内容</span>
            <textarea v-model="selectedText" rows="5"></textarea>
          </label>

          <label v-if="selectionSupportsFill" class="inspector-section inspector-color">
            <span>填充</span>
            <div>
              <input v-model="selectedFill" type="color" />
              <code>{{ selectedFill }}</code>
            </div>
          </label>

          <div class="inspector-section inspector-actions">
            <button type="button" @click="duplicateSelection">
              <i class="bi bi-copy" aria-hidden="true"></i><span>复制</span>
            </button>
            <button type="button" @click="moveLayer('back')">
              <i class="bi bi-send-backward" aria-hidden="true"></i><span>置底</span>
            </button>
            <button type="button" @click="moveLayer('front')">
              <i class="bi bi-bring-front" aria-hidden="true"></i><span>置顶</span>
            </button>
          </div>
        </template>
        <div v-else class="inspector-empty">
          <i class="bi bi-layers" aria-hidden="true"></i>
          <span>{{ nodeCount }} 个图层</span>
        </div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.infinite-canvas-page {
  --canvas-line: rgba(25, 28, 38, 0.1);
  --canvas-muted: #858b99;
  --canvas-ink: #20232c;
  --canvas-surface: rgba(255, 255, 255, 0.96);
  --canvas-accent: #5b4dff;
  display: grid;
  height: calc(100dvh - var(--app-header-offset, 82px));
  min-height: 560px;
  grid-template-rows: 58px minmax(0, 1fr);
  overflow: hidden;
  color: var(--canvas-ink);
  background: #e8eaef;
}

html.color-scheme-dark .infinite-canvas-page {
  --canvas-line: rgba(255, 255, 255, 0.1);
  --canvas-muted: rgba(255, 255, 255, 0.48);
  --canvas-ink: rgba(255, 255, 255, 0.9);
  --canvas-surface: rgba(20, 22, 29, 0.97);
  background: #181a21;
}

.canvas-topbar {
  position: relative;
  z-index: 20;
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 1fr);
  align-items: center;
  gap: 16px;
  padding: 0 14px;
  border-bottom: 1px solid var(--canvas-line);
  background: var(--canvas-surface);
  backdrop-filter: blur(18px);
}

.canvas-brand,
.canvas-command-group,
.canvas-topbar-actions,
.canvas-toolrail {
  display: flex;
  align-items: center;
}

.canvas-brand {
  min-width: 0;
  gap: 9px;
}

.canvas-brand > i {
  color: var(--canvas-accent);
  font-size: 19px;
}

.canvas-brand input {
  width: min(240px, 55%);
  min-width: 110px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--canvas-ink);
  font-size: 14px;
  font-weight: 700;
}

.canvas-brand span {
  color: var(--canvas-muted);
  font-size: 10px;
  white-space: nowrap;
}

.canvas-brand span.is-error {
  color: #d64545;
}

.canvas-command-group,
.canvas-topbar-actions {
  gap: 4px;
}

.canvas-topbar-actions {
  justify-content: flex-end;
}

.canvas-topbar button,
.canvas-toolrail button,
.canvas-inspector button {
  display: inline-grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--canvas-ink);
  cursor: pointer;
}

.canvas-topbar button:hover,
.canvas-toolrail button:hover,
.canvas-inspector button:hover,
.canvas-toolrail button.is-active {
  border-color: var(--canvas-line);
  background: rgba(91, 77, 255, 0.08);
  color: var(--canvas-accent);
}

.canvas-topbar button:disabled,
.canvas-inspector button:disabled {
  opacity: 0.35;
  cursor: default;
}

.canvas-topbar button.text-command {
  display: inline-flex;
  width: auto;
  min-width: 68px;
  padding: 0 10px;
  gap: 7px;
}

.canvas-topbar button.zoom-value {
  width: 58px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.canvas-divider {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--canvas-line);
}

.canvas-workbench {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: 52px minmax(0, 1fr) 264px;
}

.canvas-toolrail {
  z-index: 12;
  flex-direction: column;
  gap: 6px;
  padding: 10px 8px;
  border-right: 1px solid var(--canvas-line);
  background: var(--canvas-surface);
}

.toolrail-divider {
  width: 26px;
  height: 1px;
  margin: 2px 0;
  background: var(--canvas-line);
}

.canvas-stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: #eef0f4;
  background-image: radial-gradient(circle, rgba(61, 67, 83, 0.22) 1px, transparent 1px);
  background-position: 0 0;
  background-size: 20px 20px;
  touch-action: none;
}

html.color-scheme-dark .canvas-stage {
  background-color: #191b22;
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.16) 1px, transparent 1px);
}

.canvas-stage.is-hand :deep(canvas) {
  cursor: grab !important;
}

.canvas-stage.is-hand:active :deep(canvas) {
  cursor: grabbing !important;
}

.canvas-stage :deep(canvas) {
  position: absolute !important;
  inset: 0;
}

.canvas-empty-state {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  gap: 8px;
  color: rgba(89, 95, 112, 0.36);
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.canvas-empty-state i {
  font-size: 34px;
}

.canvas-empty-state span {
  font-size: 12px;
}

.canvas-inspector {
  z-index: 12;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  border-left: 1px solid var(--canvas-line);
  background: var(--canvas-surface);
}

.inspector-heading {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--canvas-line);
}

.inspector-heading > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.inspector-heading strong,
.inspector-heading span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspector-heading strong {
  font-size: 12px;
}

.inspector-heading span,
.inspector-empty span,
.inspector-section > span,
.inspector-section label > span {
  color: var(--canvas-muted);
  font-size: 10px;
}

.inspector-section {
  padding: 12px;
  border-bottom: 1px solid var(--canvas-line);
}

.inspector-geometry {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.inspector-geometry label,
.inspector-text,
.inspector-color {
  display: grid;
  gap: 5px;
}

.inspector-geometry input,
.inspector-text textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--canvas-line);
  border-radius: 5px;
  outline: 0;
  background: rgba(127, 132, 146, 0.06);
  color: var(--canvas-ink);
  font: inherit;
}

.inspector-geometry input {
  height: 32px;
  padding: 0 8px;
  font-size: 11px;
}

.inspector-text textarea {
  padding: 8px;
  resize: vertical;
  font-size: 11px;
  line-height: 1.45;
}

.inspector-color > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inspector-color input {
  width: 34px;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--canvas-line);
  border-radius: 5px;
  background: transparent;
}

.inspector-color code {
  color: var(--canvas-muted);
  font-size: 10px;
}

.inspector-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.canvas-inspector .inspector-actions button {
  display: inline-flex;
  width: auto;
  min-width: 0;
  padding: 0 6px;
  gap: 5px;
  font-size: 10px;
}

.inspector-empty {
  display: grid;
  min-height: 180px;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--canvas-muted);
}

.inspector-empty i {
  font-size: 24px;
}

@media (max-width: 900px) {
  .infinite-canvas-page {
    grid-template-rows: 52px minmax(0, 1fr);
  }
  .canvas-topbar {
    grid-template-columns: minmax(120px, 1fr) auto;
    gap: 8px;
    padding-inline: 10px;
  }
  .canvas-command-group {
    position: absolute;
    right: 12px;
    bottom: -44px;
    z-index: 20;
    padding: 4px;
    border: 1px solid var(--canvas-line);
    border-radius: 7px;
    background: var(--canvas-surface);
    box-shadow: 0 8px 24px rgba(24, 28, 38, 0.12);
  }
  .canvas-topbar-actions .text-command span,
  .canvas-brand > span {
    display: none;
  }
  .canvas-topbar button.text-command {
    width: 34px;
    min-width: 34px;
    padding: 0;
    justify-content: center;
  }
  .canvas-workbench {
    grid-template-columns: 48px minmax(0, 1fr);
  }
  .canvas-inspector {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: min(300px, calc(100% - 64px));
    max-height: 42%;
    border: 1px solid var(--canvas-line);
    border-radius: 8px;
    box-shadow: 0 14px 34px rgba(24, 28, 38, 0.18);
  }
  .canvas-inspector:not(.has-selection) {
    display: none;
  }
}

@media (max-width: 560px) {
  .canvas-brand input {
    width: 100%;
  }
  .canvas-topbar-actions button:last-of-type {
    display: none;
  }
}
</style>
