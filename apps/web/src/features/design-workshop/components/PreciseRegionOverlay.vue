<script setup>
import { App, DragEvent, Rect } from 'leafer-ui'
import { EditorEvent, EditorMoveEvent, EditorScaleEvent } from '@leafer-in/editor'
import '@leafer-in/resize'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clampBounds } from '@/features/design-workshop/regionGeometry'

const props = defineProps({
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  zoom: { type: Number, default: 1 },
  nodes: { type: Array, default: () => [] },
  selectedId: { type: String, default: '' },
  hoveredId: { type: String, default: '' },
  drawMode: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'hover', 'update-bounds', 'create-region', 'draw-complete'])

const host = ref(null)
const canvasHoveredId = ref('')
let app = null
let drawingRect = null
let syncingFromProps = false
let syncFrame = 0
const regionRects = new Map()

const viewport = computed(() => ({ width: props.width, height: props.height }))
const uiScale = computed(() => 1 / Math.max(0.04, props.zoom))
const overlayStyle = computed(() => ({ '--overlay-ui-scale': uiScale.value }))
const hoveredNode = computed(() => {
  const id = props.hoveredId || canvasHoveredId.value
  return props.nodes.find((node) => !node.hidden && node.id === id) || null
})
const hoverLabelStyle = computed(() => {
  const node = hoveredNode.value
  if (!node || node.id === props.selectedId || props.drawMode) return { display: 'none' }
  return {
    left: `${Math.max(4, node.x)}px`,
    top: `${Math.max(4, node.y - 25)}px`,
  }
})

function regionStyle(node) {
  const canvasArea = Math.max(1, props.width * props.height)
  const regionArea = Math.max(1, node.width * node.height)
  const areaPriority = Math.round((1 - Math.min(1, regionArea / canvasArea)) * 100000)
  const leafPriority = ['icon', 'image', 'divider'].includes(node.type)
    ? 30000
    : ['button', 'input', 'text'].includes(node.type)
      ? 20000
      : node.type === 'frame'
        ? 0
        : 10000
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fill: 'rgba(91, 140, 255, 0.001)',
    hitFill: 'all',
    stroke: node.id === props.hoveredId ? '#7aa2ff' : 'rgba(91, 140, 255, 0)',
    strokeWidth: node.id === props.hoveredId ? 1.5 * uiScale.value : 1,
    // Small leaf layers must stay above their enclosing frames for pointer hit-testing.
    zIndex:
      node.id === props.selectedId
        ? 1000000
        : node.id === props.hoveredId
          ? 900000
          : areaPriority + leafPriority,
    editable: true,
    editConfig: {
      rotateable: false,
      skewable: false,
      lockRatio: false,
      editSize: 'size',
    },
  }
}

function syncNodes() {
  if (!app) return
  syncingFromProps = true
  const liveIds = new Set()
  props.nodes
    .filter((node) => !node.hidden)
    .forEach((node) => {
      liveIds.add(node.id)
      let rect = regionRects.get(node.id)
      if (!rect) {
        rect = new Rect(regionStyle(node))
        rect.regionId = node.id
        regionRects.set(node.id, rect)
        app.tree.add(rect)
      } else {
        rect.set(regionStyle(node))
      }
    })
  regionRects.forEach((rect, id) => {
    if (liveIds.has(id)) return
    if (app.editor?.target === rect) app.editor.target = null
    rect.remove()
    regionRects.delete(id)
  })
  const target = regionRects.get(props.selectedId) || null
  if (app.editor?.target !== target) app.editor.target = target
  syncingFromProps = false
}

function emitSelectedBounds() {
  if (!app || syncingFromProps) return
  const rect = regionRects.get(props.selectedId)
  if (!rect) return
  const bounds = clampBounds(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport.value,
  )
  rect.set(bounds)
  emit('update-bounds', { id: props.selectedId, bounds })
}

function scheduleBoundsSync() {
  if (syncFrame) cancelAnimationFrame(syncFrame)
  syncFrame = requestAnimationFrame(() => {
    syncFrame = 0
    emitSelectedBounds()
  })
}

function drawingBounds(event) {
  const bounds = event.getPageBounds()
  return clampBounds(bounds, viewport.value)
}

function beginDrawing(event) {
  if (!props.drawMode || props.disabled) return
  drawingRect?.remove()
  drawingRect = new Rect({
    ...drawingBounds(event),
    fill: 'rgba(91, 140, 255, 0.14)',
    stroke: '#7aa2ff',
    strokeWidth: 2,
    dashPattern: [8, 5],
    hittable: false,
  })
  app.tree.add(drawingRect)
}

function moveDrawing(event) {
  if (!props.drawMode || !drawingRect) return
  drawingRect.set(drawingBounds(event))
}

function endDrawing(event) {
  if (!props.drawMode || !drawingRect) return
  const bounds = drawingBounds(event)
  drawingRect.remove()
  drawingRect = null
  if (bounds.width >= 4 && bounds.height >= 4) emit('create-region', bounds)
  emit('draw-complete')
}

function updateMode() {
  if (!app) return
  app.mode = props.drawMode ? 'draw' : 'normal'
  app.editor.visible = !props.drawMode && !props.disabled
  app.editor.hittable = !props.drawMode && !props.disabled
  if (!props.drawMode) drawingRect?.remove()
}

function editorConfig() {
  const scale = uiScale.value
  return {
    strokeWidth: 1.5 * scale,
    hoverStyle: { stroke: '#7aa2ff', strokeWidth: scale },
    point: {
      width: 10 * scale,
      height: 10 * scale,
      fill: '#ffffff',
      stroke: '#5b8cff',
      strokeWidth: 1.5 * scale,
    },
    middlePoint: {
      width: 8 * scale,
      height: 8 * scale,
      fill: '#ffffff',
      stroke: '#5b8cff',
      strokeWidth: 1.5 * scale,
    },
  }
}

function updateEditorScale() {
  if (!app?.editor) return
  Object.assign(app.editor.config, editorConfig())
  app.editor.updateEditTool()
}

function createApp() {
  if (!host.value || app) return
  app = new App({
    view: host.value,
    width: props.width,
    height: props.height,
    fill: null,
    pointer: { snap: false, hitRadius: 0 },
    editor: {
      select: 'press',
      multipleSelect: false,
      boxSelect: false,
      rotateable: false,
      skewable: false,
      lockRatio: false,
      editSize: 'size',
      hideOnSmall: false,
      ignorePixelSnap: true,
      stroke: '#5b8cff',
      ...editorConfig(),
    },
  })
  app.editor.on(EditorEvent.SELECT, (event) => {
    if (syncingFromProps || props.drawMode) return
    const target = Array.isArray(event.value) ? event.value[0] : event.value
    emit('select', target?.regionId || '')
  })
  app.editor.on(EditorEvent.HOVER, (event) => {
    const target = Array.isArray(event.value) ? event.value[0] : event.value
    canvasHoveredId.value = target?.regionId || ''
    emit('hover', canvasHoveredId.value)
  })
  app.editor.on(EditorMoveEvent.MOVE, scheduleBoundsSync)
  app.editor.on(EditorScaleEvent.SCALE, scheduleBoundsSync)
  app.on(DragEvent.START, beginDrawing)
  app.on(DragEvent.DRAG, moveDrawing)
  app.on(DragEvent.END, endDrawing)
  syncNodes()
  updateMode()
}

onMounted(() => void nextTick(createApp))

watch(() => props.nodes, syncNodes, { deep: true })
watch(() => props.selectedId, syncNodes)
watch(() => props.hoveredId, syncNodes)
watch(() => [props.drawMode, props.disabled], updateMode)
watch(() => props.zoom, updateEditorScale)
watch(
  () => [props.width, props.height],
  ([width, height]) => {
    app?.resize({ width, height })
    syncNodes()
  },
)

onBeforeUnmount(() => {
  if (syncFrame) cancelAnimationFrame(syncFrame)
  drawingRect = null
  regionRects.clear()
  app?.destroy()
  app = null
})
</script>

<template>
  <div
    ref="host"
    class="precise-region-overlay"
    :class="{ 'is-drawing': drawMode }"
    :style="overlayStyle"
  >
    <span v-if="hoveredNode" class="precise-region-label" :style="hoverLabelStyle">
      {{ hoveredNode.name }}
    </span>
    <span v-if="drawMode" class="precise-region-hint">
      <i class="bi bi-bounding-box"></i>拖拽框选需要的设计区域
    </span>
  </div>
</template>

<style scoped>
.precise-region-overlay {
  position: absolute;
  z-index: 5;
  inset: 0;
  overflow: hidden;
  background: transparent;
  touch-action: none;
}
.precise-region-overlay :deep(canvas) {
  position: absolute !important;
  inset: 0;
}
.precise-region-overlay.is-drawing {
  cursor: crosshair;
}
.precise-region-label {
  position: absolute;
  z-index: 20;
  max-width: 220px;
  overflow: hidden;
  padding: 5px 7px;
  border-radius: 5px;
  background: rgba(18, 21, 29, 0.92);
  color: #f4f7ff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  font-size: 10px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  transform: scale(var(--overlay-ui-scale));
  transform-origin: left bottom;
}
.precise-region-hint {
  position: absolute;
  z-index: 20;
  top: 16px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(17, 20, 27, 0.88);
  color: #edf2ff;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
  font-size: 11px;
  pointer-events: none;
  transform: translateX(-50%) scale(var(--overlay-ui-scale));
  transform-origin: top center;
}
</style>
