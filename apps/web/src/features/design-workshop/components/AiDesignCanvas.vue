<script setup>
import { gsap } from 'gsap'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import { uploadAiTempBlob } from '@/features/ai-shared/aiImageIO'
import { cancelAssistantRun } from '@/services/assistantApi'
import {
  getScopedLocalItem,
  removeScopedLocalItem,
  setScopedLocalItem,
} from '@/services/scopedLocalStorage'
import {
  ACTIVE_DESIGN_ANALYSIS_KEY,
  ACTIVE_DESIGN_ANALYSIS_VERSION,
  extractDesignDocumentProgress,
  generateAiDesignDocument,
  generateDesignAssetDescription,
  generateDesignRegionCode,
  generateDesignRegionImage,
  generateDesignRegionSvg,
  generateDesignWebsite,
} from '@/features/design-workshop/aiDesignDocument'
import {
  hasTransparency,
  sanitizeGeneratedSvg,
  svgBlob,
} from '@/features/design-workshop/regionAssetExtraction'
import {
  attachNaturalBounds,
  fitAnalysisViewport,
  naturalBoundsForNode,
  projectBounds,
  referenceNeedsRasterization,
} from '@/features/design-workshop/regionGeometry'

const PreciseRegionOverlay = defineAsyncComponent(() => import('./PreciseRegionOverlay.vue'))

const props = defineProps({
  open: { type: Boolean, default: false },
  prompt: { type: String, default: '' },
  referenceImage: { type: String, default: '' },
  documentId: { type: String, default: '' },
  resumeSession: { type: Object, default: null },
  generationNonce: { type: Number, default: 0 },
  viewport: {
    type: Object,
    default: () => ({ width: 1440, height: 900, background: '#ffffff' }),
  },
})

const emit = defineEmits(['close', 'document-saved', 'analysis-session'])

const CACHE_VERSION = 7
const HISTORY_KEY = 'ui-editable-document-history-v1'

const root = ref(null)
const canvasViewport = ref(null)
const artboard = ref(null)
const aiCursor = ref(null)
const documentName = ref('设计稿元素分析')
const nodes = ref([])
const tokens = ref({ colors: [], spacing: [], typography: [] })
const documentViewport = ref({ ...props.viewport })
const sourceViewport = ref({ ...props.viewport })
const selectedId = ref('')
const hoveredId = ref('')
const showLayerPanel = ref(true)
const selectedPreviewUrl = ref('')
const regionCode = ref('')
const regionCodeError = ref('')
const regionCodeFramework = ref('vue')
const generatingRegionCode = ref(false)
const regionCodeStage = ref('')
const generatedAssetUrl = ref('')
const generatedAssetStatus = ref('')
const generatedSvg = ref('')
const generatedSvgUrl = ref('')
const generatingAsset = ref(false)
const vectorizingSvg = ref(false)
const assetStage = ref('')
const assetError = ref('')
const generatedAssetTransparent = ref(false)
const assetGenerationMode = ref('strict')
const generatedAssetMode = ref('strict')
const generatedAssetRegionId = ref('')
const assetDescription = ref('')
const describingAsset = ref(false)
const approvingAsset = ref(false)
const assetLibrary = ref([])
const inspectorMode = ref('')
const websiteCode = ref('')
const websiteStage = ref('')
const websiteError = ref('')
const generatingWebsite = ref(false)
const regionInspectorTab = ref('code')
const copyFeedback = ref('')
const zoom = ref(0.7)
const generating = ref(false)
const stage = ref('idle')
const error = ref('')
const layerSearch = ref('')
const cursorLabel = ref('AI 正在规划画布')
const showReference = ref(false)
const preciseDrawMode = ref(false)
const editingTextId = ref('')
const historyPast = ref([])
const historyFuture = ref([])
let controller = null
let runId = ''
let regionCodeController = null
let regionCodeRunId = ''
let assetController = null
let assetRunId = ''
let assetDescriptionController = null
let assetDescriptionRunId = ''
let websiteController = null
let websiteRunId = ''
let generatedAssetBlob = null
let selectedPreviewBlob = null
let previewSequence = 0
let selectedPreviewTimer = null
let referenceBlobKey = ''
let referenceBlobPromise = null
let generatedPrompt = ''
let handledGenerationNonce = props.generationNonce
let activeAnalysisSession =
  props.resumeSession?.version === ACTIVE_DESIGN_ANALYSIS_VERSION
    ? { ...props.resumeSession }
    : null
let preserveAnalysisSession = false
let animationContext = null
let dragState = null
let resizeState = null
let previousBodyOverflow = ''
let resizeObserver = null
let suppressCanvasFit = false
let preserveZoomFrame = 0
let preserveZoomTimer = null
let preservedCanvasZoom = 0
let historyTimer = null
let copyFeedbackTimer = null
let historyReady = false
let applyingHistory = false
let lastHistorySnapshot = ''
const streamNodeCounts = { draft: 0, refine: 0 }
const animatedNodeIds = new Set()

const NODE_ICONS = {
  frame: 'bi-bounding-box',
  text: 'bi-fonts',
  rectangle: 'bi-square',
  button: 'bi-ui-checks',
  input: 'bi-input-cursor-text',
  icon: 'bi-star',
  image: 'bi-image',
  divider: 'bi-dash-lg',
}

const STAGE_LABELS = {
  preparing: '正在建立 AI 设计会话',
  queued: 'AI 设计师正在排队',
  routing: '正在选择设计模型',
  thinking: '正在理解页面结构',
  drawing: 'AI 正在识别页面元素',
  answering: 'AI 正在建立可点击区域',
  auditing: '正在校准元素边界',
  complete: '元素分析已完成',
}

const stageLabel = computed(() => {
  if (props.referenceImage) {
    if (['preparing', 'queued', 'routing', 'thinking'].includes(stage.value)) {
      return 'AI 正在分析当前成稿'
    }
    if (stage.value === 'auditing') return '正在对照原稿校准布局与样式'
    if (['drawing', 'answering'].includes(stage.value)) return '正在识别按钮、图标与页面模块'
  }
  return STAGE_LABELS[stage.value] || 'AI 正在处理设计文档'
})
const generationKey = computed(() => `${props.prompt}\n@reference:${props.referenceImage}`)
const selectedNode = computed(
  () => nodes.value.find((item) => item.id === selectedId.value) || null,
)
const selectedNaturalBounds = computed(() => {
  const node = selectedNode.value
  return node ? naturalBoundsForNode(node, documentViewport.value, sourceViewport.value) : null
})
function nodeSupportsAsset(node) {
  return Boolean(
    node &&
      (node.manualSelection ||
        ['icon', 'image'].includes(node.category) ||
        ['icon', 'image'].includes(node.type)),
  )
}

const selectedSupportsAsset = computed(() => nodeSupportsAsset(selectedNode.value))
const selectedApprovedAsset = computed(() => {
  const assetId = selectedNode.value?.approvedAssetId
  return assetId ? assetLibrary.value.find((asset) => asset.id === assetId) || null : null
})
const assetCoverage = computed(() => {
  const targets = nodes.value.filter((node) => !node.hidden && nodeSupportsAsset(node))
  const approved = new Set(assetLibrary.value.map((asset) => asset.sourceRegionId))
  return {
    approved: targets.filter((node) => approved.has(node.id)).length,
    total: targets.length,
  }
})
const fidelityPatches = computed(() =>
  props.referenceImage && showReference.value
    ? nodes.value.filter((node) => (node.detached || node.hidden) && node.sourceBounds)
    : [],
)
const layerEntries = computed(() => {
  const query = layerSearch.value.trim().toLowerCase()
  if (query) {
    return nodes.value
      .filter((item) => `${item.name} ${item.type}`.toLowerCase().includes(query))
      .slice()
      .reverse()
      .map((node) => ({ node, depth: layerDepth(node) }))
  }
  const knownIds = new Set(nodes.value.map((node) => node.id))
  const children = new Map()
  for (const node of nodes.value) {
    const parentId = knownIds.has(node.parentId) && node.parentId !== node.id ? node.parentId : ''
    const siblings = children.get(parentId) || []
    siblings.push(node)
    children.set(parentId, siblings)
  }
  const entries = []
  const visited = new Set()
  const append = (node, depth) => {
    if (visited.has(node.id)) return
    visited.add(node.id)
    entries.push({ node, depth })
    const descendants = (children.get(node.id) || []).slice().reverse()
    descendants.forEach((child) => append(child, Math.min(3, depth + 1)))
  }
  ;(children.get('') || [])
    .slice()
    .reverse()
    .forEach((node) => append(node, 0))
  nodes.value
    .slice()
    .reverse()
    .forEach((node) => append(node, 0))
  return entries
})
const viewportFrameStyle = computed(() => ({
  width: `${documentViewport.value.width * zoom.value}px`,
  height: `${documentViewport.value.height * zoom.value}px`,
}))
const artboardStyle = computed(() => ({
  width: `${documentViewport.value.width}px`,
  height: `${documentViewport.value.height}px`,
  background: documentViewport.value.background,
  transform: `scale(${zoom.value})`,
}))
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)

function documentSnapshot() {
  return JSON.stringify({
    name: documentName.value,
    viewport: documentViewport.value,
    sourceViewport: sourceViewport.value,
    nodes: nodes.value,
    tokens: tokens.value,
    assetLibrary: assetLibrary.value,
  })
}

function cacheKey() {
  if (props.documentId) return props.documentId
  const source = props.referenceImage
    ? `reference:${props.referenceImage}`
    : `prompt:${props.prompt}`
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `ui-editable-document-v${CACHE_VERSION}-${(hash >>> 0).toString(36)}`
}

function persistActiveAnalysisSession(session = {}) {
  if (!props.referenceImage) return
  const previous =
    activeAnalysisSession ||
    (props.resumeSession?.version === ACTIVE_DESIGN_ANALYSIS_VERSION ? props.resumeSession : {})
  const now = new Date().toISOString()
  activeAnalysisSession = {
    ...previous,
    ...session,
    version: ACTIVE_DESIGN_ANALYSIS_VERSION,
    prompt: props.prompt,
    referenceImage: props.referenceImage,
    viewport: { ...documentViewport.value },
    sourceViewport: { ...sourceViewport.value },
    startedAt: previous.startedAt || now,
    updatedAt: now,
  }
  setScopedLocalItem(ACTIVE_DESIGN_ANALYSIS_KEY, JSON.stringify(activeAnalysisSession))
  emit('analysis-session', activeAnalysisSession)
}

function clearActiveAnalysisSession() {
  activeAnalysisSession = null
  removeScopedLocalItem(ACTIVE_DESIGN_ANALYSIS_KEY)
  emit('analysis-session', null)
}

function persistCachedDocument() {
  if (!nodes.value.length) return
  try {
    const updatedAt = new Date().toISOString()
    setScopedLocalItem(
      cacheKey(),
      JSON.stringify({
        version: CACHE_VERSION,
        prompt: props.prompt,
        referenceImage: props.referenceImage,
        name: documentName.value,
        viewport: documentViewport.value,
        sourceViewport: sourceViewport.value,
        nodes: nodes.value,
        tokens: tokens.value,
        assetLibrary: assetLibrary.value,
        websiteCode: websiteCode.value,
        updatedAt,
      }),
    )
    const entry = {
      id: cacheKey(),
      name: documentName.value,
      referenceImage: props.referenceImage,
      prompt: props.prompt,
      nodeCount: nodes.value.length,
      assetCount: assetLibrary.value.length,
      viewport: documentViewport.value,
      sourceViewport: sourceViewport.value,
      updatedAt,
    }
    const cachedHistory = JSON.parse(getScopedLocalItem(HISTORY_KEY) || '[]')
    const history = Array.isArray(cachedHistory) ? cachedHistory : []
    setScopedLocalItem(
      HISTORY_KEY,
      JSON.stringify([entry, ...history.filter((item) => item?.id !== entry.id)].slice(0, 12)),
    )
    emit('document-saved', entry)
  } catch {
    // Large embedded replacement assets may exceed local storage; the live document remains usable.
  }
}

function restoreCachedDocument() {
  try {
    const cached = JSON.parse(getScopedLocalItem(cacheKey()) || 'null')
    const sameSource = props.documentId
      ? true
      : props.referenceImage
        ? cached?.referenceImage === props.referenceImage
        : cached?.prompt === props.prompt && !cached?.referenceImage
    if (
      cached?.version !== CACHE_VERSION ||
      !sameSource ||
      !Array.isArray(cached?.nodes) ||
      !cached.nodes.length
    ) {
      return false
    }
    documentName.value = String(cached.name || '设计稿元素分析')
    documentViewport.value = cached.viewport || { ...props.viewport }
    sourceViewport.value = cached.sourceViewport || cached.viewport || { ...props.viewport }
    nodes.value = cached.nodes
    tokens.value = cached.tokens || { colors: [], spacing: [], typography: [] }
    assetLibrary.value = Array.isArray(cached.assetLibrary) ? cached.assetLibrary : []
    websiteCode.value = String(cached.websiteCode || '')
    generatedPrompt = generationKey.value
    showReference.value = Boolean(props.referenceImage)
    selectedId.value = ''
    stage.value = 'complete'
    error.value = ''
    resetHistory()
    void nextTick(fitCanvas)
    return true
  } catch {
    return false
  }
}

function resetHistory() {
  if (historyTimer) window.clearTimeout(historyTimer)
  historyTimer = null
  historyPast.value = []
  historyFuture.value = []
  lastHistorySnapshot = documentSnapshot()
  historyReady = true
}

function recordHistory() {
  historyTimer = null
  if (!historyReady || applyingHistory || generating.value) return
  const current = documentSnapshot()
  if (current === lastHistorySnapshot) return
  if (lastHistorySnapshot) {
    historyPast.value = [...historyPast.value.slice(-49), lastHistorySnapshot]
  }
  historyFuture.value = []
  lastHistorySnapshot = current
  persistCachedDocument()
}

function scheduleHistory() {
  if (!historyReady || applyingHistory || generating.value) return
  if (historyTimer) window.clearTimeout(historyTimer)
  historyTimer = window.setTimeout(recordHistory, 260)
}

function flushHistory() {
  if (!historyTimer) return
  window.clearTimeout(historyTimer)
  recordHistory()
}

function restoreHistorySnapshot(snapshot) {
  const restored = JSON.parse(snapshot)
  applyingHistory = true
  documentName.value = restored.name
  documentViewport.value = restored.viewport
  sourceViewport.value = restored.sourceViewport || restored.viewport
  nodes.value = restored.nodes
  tokens.value = restored.tokens
  assetLibrary.value = Array.isArray(restored.assetLibrary) ? restored.assetLibrary : []
  selectedId.value = ''
  editingTextId.value = ''
  lastHistorySnapshot = snapshot
  void nextTick(() => {
    applyingHistory = false
  })
}

function undo() {
  flushHistory()
  const previous = historyPast.value.at(-1)
  if (!previous) return
  historyPast.value = historyPast.value.slice(0, -1)
  historyFuture.value = [...historyFuture.value, lastHistorySnapshot]
  restoreHistorySnapshot(previous)
}

function redo() {
  const next = historyFuture.value.at(-1)
  if (!next) return
  historyFuture.value = historyFuture.value.slice(0, -1)
  historyPast.value = [...historyPast.value, lastHistorySnapshot]
  restoreHistorySnapshot(next)
}

function layerDepth(node) {
  let depth = 0
  let parentId = node.parentId
  const visited = new Set([node.id])
  while (parentId && depth < 3 && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes.value.find((item) => item.id === parentId)
    if (!parent) break
    depth += 1
    parentId = parent.parentId
  }
  return depth
}

function nodeStyle(node) {
  const justifyContent =
    node.align === 'center' ? 'center' : node.align === 'right' ? 'flex-end' : 'flex-start'
  const viewportArea = Math.max(1, documentViewport.value.width * documentViewport.value.height)
  const areaRatio = Math.min(1, (node.width * node.height) / viewportArea)
  const hitSlopX = props.referenceImage ? Math.max(0, (26 - node.width) / 2) : 0
  const hitSlopY = props.referenceImage ? Math.max(0, (26 - node.height) / 2) : 0
  return {
    left: `${node.x - hitSlopX}px`,
    top: `${node.y - hitSlopY}px`,
    width: `${node.width + hitSlopX * 2}px`,
    height: `${node.height + hitSlopY * 2}px`,
    background: node.fill,
    color: node.color,
    border: `${node.strokeWidth}px solid ${node.stroke}`,
    borderRadius: `${node.radius}px`,
    opacity: node.opacity,
    boxShadow: node.shadow,
    fontSize: `${node.fontSize}px`,
    fontWeight: node.fontWeight,
    lineHeight: node.lineHeight,
    textAlign: node.align,
    '--node-justify': justifyContent,
    '--region-visual-x': `${hitSlopX}px`,
    '--region-visual-y': `${hitSlopY}px`,
    '--region-visual-width': `${node.width}px`,
    '--region-visual-height': `${node.height}px`,
    zIndex: props.referenceImage ? Math.round(10 + (1 - areaRatio) * 1000) : 2,
    display: node.hidden ? 'none' : undefined,
  }
}

function nodePatchStyle(node) {
  const bounds = node.sourceBounds
  if (!bounds) return { display: 'none' }
  const parent = nodes.value.find((item) => item.id === node.parentId)
  const parentFill = String(parent?.fill || '').trim()
  const background =
    parentFill && parentFill !== 'transparent' ? parentFill : documentViewport.value.background
  return {
    left: `${bounds.x}px`,
    top: `${bounds.y}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    background,
  }
}

function markNodeEdited(node) {
  if (!node || node.detached) return
  node.sourceBounds ||= { x: node.x, y: node.y, width: node.width, height: node.height }
  node.detached = true
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function fitCanvas() {
  const host = canvasViewport.value
  if (!host) return
  const availableWidth = Math.max(280, host.clientWidth - 96)
  const availableHeight = Math.max(280, host.clientHeight - 96)
  zoom.value = clamp(
    Math.min(
      availableWidth / documentViewport.value.width,
      availableHeight / documentViewport.value.height,
    ),
    0.2,
    1,
  )
}

function selectNode(node) {
  if (node.locked) return
  inspectorMode.value = ''
  if (!node.naturalBounds) {
    node.naturalBounds = naturalBoundsForNode(node, documentViewport.value, sourceViewport.value)
  }
  selectedId.value = node.id
}

function selectPreciseRegion(id) {
  if (!id) {
    selectedId.value = ''
    return
  }
  const node = nodes.value.find((item) => item.id === id)
  if (node) selectNode(node)
}

function sourceRegion(node) {
  if (!node) return null
  const bounds = naturalBoundsForNode(node, documentViewport.value, sourceViewport.value)
  return {
    ...node,
    ...bounds,
    naturalBounds: bounds,
    coordinateSpace: 'source-pixels',
  }
}

function updatePreciseRegionBounds({ id, bounds }) {
  const node = nodes.value.find((item) => item.id === id)
  if (!node) return
  node.x = bounds.x
  node.y = bounds.y
  node.width = bounds.width
  node.height = bounds.height
  node.naturalBounds = projectBounds(bounds, documentViewport.value, sourceViewport.value, {
    integer: true,
  })
  node.manuallyAdjusted = true
  node.selectionConfirmed = false
}

function createPreciseRegion(bounds) {
  const index = nodes.value.filter((node) => node.manualSelection).length + 1
  const node = {
    id: `manual-region-${Date.now()}-${index}`,
    name: `自定义选区 ${index}`,
    type: 'frame',
    parentId: '',
    ...bounds,
    fill: 'transparent',
    color: '#18181f',
    stroke: 'transparent',
    strokeWidth: 0,
    radius: 0,
    opacity: 1,
    text: '',
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.4,
    align: 'left',
    icon: '',
    src: '',
    objectFit: 'contain',
    shadow: 'none',
    category: 'component',
    description: '用户在原始设计稿上手动框选的精确区域',
    confidence: 1,
    sourceBounds: { ...bounds },
    naturalBounds: projectBounds(bounds, documentViewport.value, sourceViewport.value, {
      integer: true,
    }),
    coordinateSpace: 'source-pixels',
    manualSelection: true,
    manuallyAdjusted: true,
    selectionConfirmed: false,
    detached: false,
    hidden: false,
    locked: false,
  }
  nodes.value = [...nodes.value, node]
  selectedId.value = node.id
  preciseDrawMode.value = false
}

function confirmPreciseRegion() {
  const node = selectedNode.value
  if (!node) return
  node.naturalBounds = naturalBoundsForNode(node, documentViewport.value, sourceViewport.value)
  node.selectionConfirmed = true
  assetError.value = ''
  regionCodeError.value = ''
}

function requireConfirmedRegion() {
  if (selectedNode.value?.selectionConfirmed) return true
  const message = '请先调整边界并确认选区，再生成可交付内容'
  assetError.value = message
  regionCodeError.value = message
  return false
}

function hoverNode(id) {
  hoveredId.value = id
}

function clearHoveredNode(id) {
  if (hoveredId.value === id) hoveredId.value = ''
}

function toggleLayerPanel() {
  preserveCanvasZoom()
  showLayerPanel.value = !showLayerPanel.value
}

function preserveCanvasZoom({ centerSelection = false } = {}) {
  if (!props.referenceImage || !nodes.value.length) return
  const currentZoom = zoom.value
  preservedCanvasZoom = currentZoom
  suppressCanvasFit = true
  if (preserveZoomFrame) window.cancelAnimationFrame(preserveZoomFrame)
  if (preserveZoomTimer) window.clearTimeout(preserveZoomTimer)
  void nextTick(() => {
    zoom.value = currentZoom
    preserveZoomFrame = window.requestAnimationFrame(() => {
      zoom.value = currentZoom
      preserveZoomFrame = 0
      preserveZoomTimer = window.setTimeout(() => {
        zoom.value = currentZoom
        suppressCanvasFit = false
        preserveZoomTimer = null
        if (centerSelection) centerSelectedNode()
      }, 160)
    })
  })
}

function centerSelectedNode() {
  const id = selectedId.value
  if (!id) return
  const element = artboard.value?.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
  element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
}

function beginNodeDrag(event, node) {
  if (props.referenceImage) return
  if (generating.value || node.locked || editingTextId.value === node.id || event.button !== 0)
    return
  event.preventDefault()
  event.stopPropagation()
  selectNode(node)
  dragState = {
    id: node.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    nodeX: node.x,
    nodeY: node.y,
  }
  window.addEventListener('pointermove', moveNode)
  window.addEventListener('pointerup', endNodeDrag, { once: true })
  window.addEventListener('pointercancel', endNodeDrag, { once: true })
}

function moveNode(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  const node = nodes.value.find((item) => item.id === dragState.id)
  if (!node) return
  markNodeEdited(node)
  node.x = Math.round(
    clamp(
      dragState.nodeX + (event.clientX - dragState.startX) / zoom.value,
      0,
      documentViewport.value.width - node.width,
    ),
  )
  node.y = Math.round(
    clamp(
      dragState.nodeY + (event.clientY - dragState.startY) / zoom.value,
      0,
      documentViewport.value.height - node.height,
    ),
  )
}

function endNodeDrag() {
  dragState = null
  window.removeEventListener('pointermove', moveNode)
  window.removeEventListener('pointerup', endNodeDrag)
  window.removeEventListener('pointercancel', endNodeDrag)
}

function beginNodeResize(event, node, handle) {
  if (props.referenceImage) return
  if (generating.value || node.locked || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  selectedId.value = node.id
  resizeState = {
    id: node.id,
    pointerId: event.pointerId,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    nodeX: node.x,
    nodeY: node.y,
    width: node.width,
    height: node.height,
  }
  window.addEventListener('pointermove', resizeNode)
  window.addEventListener('pointerup', endNodeResize, { once: true })
  window.addEventListener('pointercancel', endNodeResize, { once: true })
}

function resizeNode(event) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return
  const node = nodes.value.find((item) => item.id === resizeState.id)
  if (!node) return
  markNodeEdited(node)
  const deltaX = (event.clientX - resizeState.startX) / zoom.value
  const deltaY = (event.clientY - resizeState.startY) / zoom.value
  const minSize = 8

  if (resizeState.handle.includes('e')) {
    node.width = Math.round(
      clamp(resizeState.width + deltaX, minSize, documentViewport.value.width - node.x),
    )
  }
  if (resizeState.handle.includes('s')) {
    node.height = Math.round(
      clamp(resizeState.height + deltaY, minSize, documentViewport.value.height - node.y),
    )
  }
  if (resizeState.handle.includes('w')) {
    const nextX = clamp(
      resizeState.nodeX + deltaX,
      0,
      resizeState.nodeX + resizeState.width - minSize,
    )
    node.x = Math.round(nextX)
    node.width = Math.round(resizeState.width + resizeState.nodeX - nextX)
  }
  if (resizeState.handle.includes('n')) {
    const nextY = clamp(
      resizeState.nodeY + deltaY,
      0,
      resizeState.nodeY + resizeState.height - minSize,
    )
    node.y = Math.round(nextY)
    node.height = Math.round(resizeState.height + resizeState.nodeY - nextY)
  }
}

function endNodeResize() {
  resizeState = null
  window.removeEventListener('pointermove', resizeNode)
  window.removeEventListener('pointerup', endNodeResize)
  window.removeEventListener('pointercancel', endNodeResize)
}

function toggleNodeVisibility(node) {
  node.hidden = !node.hidden
}

function toggleNodeLock(node) {
  node.locked = !node.locked
  if (node.locked && selectedId.value === node.id) selectedId.value = ''
}

function addNode(type) {
  const index = nodes.value.length + 1
  const node = {
    id: `manual-${Date.now()}-${index}`,
    name: type === 'text' ? '文本' : type === 'button' ? '按钮' : '矩形',
    type,
    x: Math.round(documentViewport.value.width / 2 - 80),
    y: Math.round(documentViewport.value.height / 2 - 24),
    width: type === 'text' ? 200 : type === 'button' ? 128 : 160,
    height: type === 'text' ? 40 : type === 'button' ? 44 : 100,
    fill: type === 'text' ? 'transparent' : type === 'button' ? '#6d5cff' : '#e9e7ff',
    color: type === 'button' ? '#ffffff' : '#18181f',
    stroke: 'transparent',
    strokeWidth: 0,
    radius: type === 'button' ? 9 : 8,
    opacity: 1,
    text: type === 'text' ? '双击编辑文本' : type === 'button' ? '按钮' : '',
    fontSize: type === 'text' ? 20 : 14,
    fontWeight: type === 'text' ? 600 : 500,
    lineHeight: 1.4,
    align: type === 'button' ? 'center' : 'left',
    icon: '',
    parentId: '',
    src: '',
    objectFit: 'contain',
    shadow: 'none',
    sourceBounds: null,
    detached: true,
    hidden: false,
    locked: false,
  }
  nodes.value.push(node)
  selectedId.value = node.id
  void animateNewNodes([node])
}

function deleteSelected() {
  if (!selectedNode.value || selectedNode.value.locked) return
  if (props.referenceImage && selectedNode.value.sourceBounds) {
    selectedNode.value.hidden = true
    selectedId.value = ''
    return
  }
  nodes.value = nodes.value.filter((item) => item.id !== selectedNode.value.id)
  selectedId.value = ''
}

function duplicateSelected() {
  if (!selectedNode.value) return
  const source = selectedNode.value
  const copy = {
    ...source,
    id: `copy-${Date.now()}-${nodes.value.length + 1}`,
    name: `${source.name} 副本`,
    x: Math.min(source.x + 16, documentViewport.value.width - source.width),
    y: Math.min(source.y + 16, documentViewport.value.height - source.height),
    sourceBounds: null,
    detached: true,
    locked: false,
  }
  nodes.value.push(copy)
  selectedId.value = copy.id
  void animateNewNodes([copy])
}

async function beginInlineTextEdit(event, node) {
  if (props.referenceImage) return
  if (!['text', 'button', 'input'].includes(node.type) || node.locked || generating.value) return
  event.preventDefault()
  event.stopPropagation()
  selectedId.value = node.id
  editingTextId.value = node.id
  await nextTick()
  const element = artboard.value?.querySelector(
    `[data-node-id="${CSS.escape(node.id)}"] .adc-node-text`,
  )
  if (!element) return
  element.focus()
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(element)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function updateInlineText(event, node) {
  markNodeEdited(node)
  node.text = event.currentTarget.innerText.replace(/\n$/, '')
}

function finishInlineTextEdit(event, node) {
  updateInlineText(event, node)
  editingTextId.value = ''
}

function handleInlineTextKeydown(event) {
  event.stopPropagation()
  if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) {
    event.preventDefault()
    event.currentTarget.blur()
  }
}

function alignmentBounds(node) {
  const parent = nodes.value.find((item) => item.id === node.parentId)
  return parent
    ? { x: parent.x, y: parent.y, width: parent.width, height: parent.height }
    : { x: 0, y: 0, width: documentViewport.value.width, height: documentViewport.value.height }
}

function alignSelected(alignment) {
  const node = selectedNode.value
  if (!node || node.locked) return
  markNodeEdited(node)
  const bounds = alignmentBounds(node)
  if (alignment === 'left') node.x = bounds.x
  if (alignment === 'center') node.x = Math.round(bounds.x + (bounds.width - node.width) / 2)
  if (alignment === 'right') node.x = Math.round(bounds.x + bounds.width - node.width)
  if (alignment === 'top') node.y = bounds.y
  if (alignment === 'middle') node.y = Math.round(bounds.y + (bounds.height - node.height) / 2)
  if (alignment === 'bottom') node.y = Math.round(bounds.y + bounds.height - node.height)
}

function moveSelectedLayer(direction) {
  const node = selectedNode.value
  if (!node) return
  const index = nodes.value.findIndex((item) => item.id === node.id)
  if (index < 0) return
  const nextNodes = [...nodes.value]
  const [moved] = nextNodes.splice(index, 1)
  nextNodes.splice(direction === 'front' ? nextNodes.length : 0, 0, moved)
  nodes.value = nextNodes
}

function updateSelected(key, value) {
  if (!selectedNode.value) return
  if (key !== 'name') markNodeEdited(selectedNode.value)
  if (
    ['x', 'y', 'width', 'height', 'radius', 'strokeWidth', 'fontSize', 'fontWeight'].includes(key)
  ) {
    selectedNode.value[key] = numberInput(value, selectedNode.value[key])
  } else {
    selectedNode.value[key] = value
  }
}

function replaceSelectedAsset(event) {
  const file = event.target.files?.[0]
  if (!file || !selectedNode.value || selectedNode.value.type !== 'image') return
  const reader = new FileReader()
  reader.addEventListener(
    'load',
    () => {
      if (selectedNode.value?.type === 'image') {
        markNodeEdited(selectedNode.value)
        selectedNode.value.src = String(reader.result || '')
      }
    },
    { once: true },
  )
  reader.readAsDataURL(file)
  event.target.value = ''
}

function numberInput(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function documentHtml(referenceDataUrl = '') {
  const fidelityExport = Boolean(referenceDataUrl)
  const layers = nodes.value
    .filter((node) => !node.hidden && (!fidelityExport || node.detached))
    .map((node) => {
      const style = [
        'position:absolute;z-index:2',
        `left:${node.x}px`,
        `top:${node.y}px`,
        `width:${node.width}px`,
        `height:${node.height}px`,
        `background:${node.fill}`,
        `color:${node.color}`,
        `border:${node.strokeWidth}px solid ${node.stroke}`,
        `border-radius:${node.radius}px`,
        `opacity:${node.opacity}`,
        `box-shadow:${node.shadow}`,
        `font-size:${node.fontSize}px`,
        `font-weight:${node.fontWeight}`,
        `line-height:${node.lineHeight}`,
        `text-align:${node.align}`,
        'box-sizing:border-box',
        'display:flex',
        node.type === 'text' ? 'align-items:flex-start' : 'align-items:center',
        node.align === 'center'
          ? 'justify-content:center'
          : node.align === 'right'
            ? 'justify-content:flex-end'
            : 'justify-content:flex-start',
        node.type === 'text' ? 'white-space:pre-wrap' : '',
      ]
        .filter(Boolean)
        .join(';')
      const content =
        node.type === 'image' && node.src
          ? `<img src="${escapeHtml(node.src)}" alt="" style="width:100%;height:100%;object-fit:${node.objectFit}">`
          : node.type === 'icon'
            ? `<i>${escapeHtml(node.icon)}</i>`
            : escapeHtml(node.text)
      return `<div data-node-id="${escapeHtml(node.id)}" data-node-type="${node.type}" style="${escapeHtml(style)}">${content}</div>`
    })
    .join('\n')
  const patches = fidelityExport
    ? nodes.value
        .filter((node) => (node.detached || node.hidden) && node.sourceBounds)
        .map((node) => {
          const style = nodePatchStyle(node)
          return `<span style="position:absolute;z-index:1;left:${style.left};top:${style.top};width:${style.width};height:${style.height};background:${escapeHtml(style.background)}"></span>`
        })
        .join('\n')
    : ''
  const reference = fidelityExport
    ? `<img src="${escapeHtml(referenceDataUrl)}" alt="" style="position:absolute;z-index:0;inset:0;width:100%;height:100%;object-fit:fill">`
    : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(documentName.value)}</title></head><body style="margin:0;background:#ececf2"><main style="position:relative;width:${documentViewport.value.width}px;height:${documentViewport.value.height}px;margin:0 auto;overflow:hidden;background:${documentViewport.value.background}">${reference}${patches}${layers}</main></body></html>`
}

async function referenceAsDataUrl() {
  const source = String(props.referenceImage || '').trim()
  if (!source || source.startsWith('data:image/')) return source
  const response = await fetch(new URL(source, window.location.origin), { credentials: 'include' })
  if (!response.ok) throw new Error('原始成稿读取失败，无法完成一致性导出')
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true })
    reader.addEventListener('error', () => reject(new Error('原始成稿读取失败')), { once: true })
    reader.readAsDataURL(blob)
  })
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function exportDocument(format) {
  const safeName = documentName.value.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'ai-design'
  if (format === 'json') {
    const payload = {
      name: documentName.value,
      viewport: documentViewport.value,
      nodes: nodes.value,
      tokens: tokens.value,
      referenceImage: props.referenceImage,
    }
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `${safeName}.json`,
    )
  } else {
    try {
      const referenceDataUrl = await referenceAsDataUrl()
      downloadBlob(
        new Blob([documentHtml(referenceDataUrl)], { type: 'text/html' }),
        `${safeName}.html`,
      )
    } catch (caught) {
      error.value = caught?.message || '设计稿导出失败'
    }
  }
}

async function animateNewNodes(items) {
  await nextTick()
  const board = artboard.value
  const cursor = aiCursor.value
  if (!board || !animationContext) return
  const entries = items
    .filter((item) => !animatedNodeIds.has(item.id))
    .map((item) => ({
      item,
      element: board.querySelector(`[data-node-id="${CSS.escape(item.id)}"]`),
    }))
    .filter((entry) => entry.element)
  if (!entries.length) return
  const boardRect = board.getBoundingClientRect()
  const measurements = entries.map((entry) => {
    const rect = entry.element.getBoundingClientRect()
    return {
      ...entry,
      cursorX: (rect.left - boardRect.left + Math.min(rect.width / 2, 28)) / zoom.value,
      cursorY: (rect.top - boardRect.top + Math.min(rect.height / 2, 24)) / zoom.value,
    }
  })
  entries.forEach((entry) => animatedNodeIds.add(entry.item.id))
  cursorLabel.value = measurements.at(-1)?.item.name || '正在创建图层'
  animationContext.add(() => {
    const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } })
    const target = measurements.at(-1)
    if (cursor && target) {
      timeline.to(cursor, { x: target.cursorX, y: target.cursorY, duration: 0.24 })
    }
    const stagger = measurements.length > 1 ? Math.min(0.035, 0.45 / measurements.length) : 0
    timeline.fromTo(
      measurements.map((entry) => entry.element),
      {
        autoAlpha: 0,
        y: 8,
        scaleX: 0.985,
        scaleY: 0.985,
        transformOrigin: '50% 50%',
      },
      { autoAlpha: 1, y: 0, scaleX: 1, scaleY: 1, duration: 0.26, stagger },
      cursor ? '-=0.1' : 0,
    )
  })
}

async function animateRefinedNodes(items) {
  await nextTick()
  const board = artboard.value
  if (!board || !animationContext || !items.length) return
  const elements = items
    .map((item) => board.querySelector(`[data-node-id="${CSS.escape(item.id)}"]`))
    .filter(Boolean)
  if (!elements.length) return
  const target = elements.at(-1)
  cursorLabel.value = `校准 ${items.at(-1)?.name || '图层'}`
  animationContext.add(() => {
    const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } })
    if (aiCursor.value && target) {
      const boardRect = board.getBoundingClientRect()
      const rect = target.getBoundingClientRect()
      timeline.to(aiCursor.value, {
        x: (rect.left - boardRect.left + Math.min(rect.width / 2, 28)) / zoom.value,
        y: (rect.top - boardRect.top + Math.min(rect.height / 2, 24)) / zoom.value,
        duration: 0.2,
      })
    }
    timeline.fromTo(
      elements,
      { filter: 'brightness(1.35)' },
      {
        filter: 'brightness(1)',
        duration: 0.3,
        stagger: elements.length > 1 ? Math.min(0.025, 0.3 / elements.length) : 0,
      },
      '-=0.08',
    )
  })
}

async function referenceBlob(signal) {
  const source = String(props.referenceImage || '').trim()
  if (!source) throw new Error('缺少原始设计图')
  if (referenceBlobKey !== source || !referenceBlobPromise) {
    referenceBlobKey = source
    referenceBlobPromise = fetch(new URL(source, window.location.origin), {
      credentials: 'include',
      signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('原始设计图读取失败')
        return response.blob()
      })
      .catch((caught) => {
        if (referenceBlobKey === source) referenceBlobPromise = null
        throw caught
      })
  }
  return referenceBlobPromise
}

async function prepareAnalysisReference(viewport, signal) {
  const original = await referenceBlob(signal)
  const bitmap = await createImageBitmap(original)
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))
  if (
    !referenceNeedsRasterization({ width: bitmap.width, height: bitmap.height }, { width, height })
  ) {
    bitmap.close?.()
    return props.referenceImage
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close?.()
    throw new Error('当前浏览器无法建立分析坐标图')
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const analysisBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('分析坐标图生成失败'))),
      'image/png',
    )
  })
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return uploadAiTempBlob(analysisBlob, { signal })
}

async function cropRegion(node) {
  if (!node || !props.referenceImage) return null
  const bitmap = await createImageBitmap(await referenceBlob())
  const bounds = naturalBoundsForNode(node, documentViewport.value, {
    width: bitmap.width,
    height: bitmap.height,
  })
  const sourceX = clamp(bounds.x, 0, bitmap.width - 1)
  const sourceY = clamp(bounds.y, 0, bitmap.height - 1)
  const sourceWidth = clamp(bounds.width, 1, bitmap.width - sourceX)
  const sourceHeight = clamp(bounds.height, 1, bitmap.height - sourceY)
  const canvas = document.createElement('canvas')
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  canvas
    .getContext('2d')
    ?.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    )
  bitmap.close?.()
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('区域素材提取失败'))),
      'image/png',
    )
  })
}

async function removeFlatBackground(blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context?.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  if (!context) return blob
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const indexes = [
    0,
    (canvas.width - 1) * 4,
    (canvas.height - 1) * canvas.width * 4,
    (canvas.width * canvas.height - 1) * 4,
  ]
  const background = [0, 1, 2].map(
    (channel) => indexes.reduce((sum, index) => sum + image.data[index + channel], 0) / 4,
  )
  const cornerSpread = Math.max(
    ...indexes.map((index) =>
      Math.hypot(
        image.data[index] - background[0],
        image.data[index + 1] - background[1],
        image.data[index + 2] - background[2],
      ),
    ),
  )
  if (cornerSpread > 42) return blob
  for (let index = 0; index < image.data.length; index += 4) {
    const distance = Math.hypot(
      image.data[index] - background[0],
      image.data[index + 1] - background[1],
      image.data[index + 2] - background[2],
    )
    const alphaFactor = clamp((distance - 10) / 34, 0, 1)
    image.data[index + 3] = Math.round(image.data[index + 3] * alphaFactor)
  }
  context.putImageData(image, 0, 0)
  return new Promise((resolve) => canvas.toBlob((result) => resolve(result || blob), 'image/png'))
}

async function refreshSelectedPreview() {
  const sequence = ++previewSequence
  const node = selectedNode.value
  if (selectedPreviewUrl.value) URL.revokeObjectURL(selectedPreviewUrl.value)
  selectedPreviewUrl.value = ''
  selectedPreviewBlob = null
  regionCode.value = ''
  regionCodeError.value = ''
  assetError.value = ''
  assetStage.value = ''
  generatedAssetStatus.value = ''
  assetDescription.value = ''
  generatedAssetRegionId.value = ''
  generatedAssetBlob = null
  if (generatedAssetUrl.value?.startsWith('blob:')) URL.revokeObjectURL(generatedAssetUrl.value)
  generatedAssetUrl.value = ''
  generatedSvg.value = ''
  if (generatedSvgUrl.value) URL.revokeObjectURL(generatedSvgUrl.value)
  generatedSvgUrl.value = ''
  assetDescriptionController?.abort()
  describingAsset.value = false
  if (!node || !props.referenceImage) return
  try {
    const blob = await cropRegion(node)
    if (sequence !== previewSequence || !blob) return
    selectedPreviewBlob = blob
    selectedPreviewUrl.value = URL.createObjectURL(blob)
  } catch (caught) {
    if (sequence === previewSequence) regionCodeError.value = caught?.message || '区域预览生成失败'
  }
}

function scheduleSelectedPreview() {
  if (selectedPreviewTimer) window.clearTimeout(selectedPreviewTimer)
  selectedPreviewTimer = window.setTimeout(() => {
    selectedPreviewTimer = null
    void refreshSelectedPreview()
  }, 160)
}

async function fetchMediaBlob(source) {
  const response = await fetch(new URL(source, window.location.origin), { credentials: 'include' })
  if (!response.ok) throw new Error('生成素材读取失败')
  return response.blob()
}

async function generateSelectedSvg() {
  if (!selectedNode.value || vectorizingSvg.value || !requireConfirmedRegion()) return
  assetController?.abort()
  assetController = new AbortController()
  const currentController = assetController
  assetRunId = ''
  vectorizingSvg.value = true
  assetError.value = ''
  assetStage.value = '正在读取精确选区'
  generatedAssetBlob = null
  if (generatedAssetUrl.value?.startsWith('blob:')) URL.revokeObjectURL(generatedAssetUrl.value)
  generatedAssetUrl.value = ''
  assetDescription.value = ''
  try {
    const region = sourceRegion(selectedNode.value)
    const source = selectedPreviewBlob || (await cropRegion(selectedNode.value))
    const regionReferenceDataUrl = await uploadAiTempBlob(source, {
      signal: currentController.signal,
    })
    const rawSvg = await generateDesignRegionSvg({
      referenceImage: props.referenceImage,
      regionReferenceDataUrl,
      viewport: sourceViewport.value,
      region,
      signal: currentController.signal,
      onStage(value) {
        assetStage.value = value === 'complete' ? 'SVG 重建完成' : 'AI 正在重建可编辑矢量图形'
      },
      onRun(value) {
        assetRunId = value
      },
    })
    const svg = sanitizeGeneratedSvg(rawSvg, { title: selectedNode.value.name })
    generatedSvg.value = svg
    generatedAssetRegionId.value = selectedNode.value.id
    generatedAssetMode.value = 'strict'
    assetDescription.value = selectedNode.value.description || selectedNode.value.name
    if (generatedSvgUrl.value) URL.revokeObjectURL(generatedSvgUrl.value)
    generatedSvgUrl.value = URL.createObjectURL(svgBlob(svg))
  } catch (caught) {
    if (caught?.name !== 'AbortError') assetError.value = caught?.message || 'SVG 矢量重建失败'
  } finally {
    vectorizingSvg.value = false
    if (assetController === currentController) assetController = null
    assetRunId = ''
  }
}

function downloadGeneratedSvg() {
  if (!generatedSvg.value || !selectedNode.value) return
  const safeName = selectedNode.value.name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'ui-icon'
  downloadBlob(svgBlob(generatedSvg.value), `${safeName}.svg`)
}

async function copyGeneratedSvg() {
  await copyText(generatedSvg.value, 'SVG 已复制')
}

async function generateSelectedAsset(transparent) {
  if (!selectedNode.value || generatingAsset.value || generating.value || !requireConfirmedRegion())
    return
  const regionId = selectedId.value
  const region = sourceRegion(selectedNode.value)
  assetController?.abort()
  assetController = new AbortController()
  assetRunId = ''
  assetError.value = ''
  assetStage.value = '正在准备选区参考'
  generatedAssetStatus.value = ''
  generatedAssetBlob = null
  if (generatedAssetUrl.value?.startsWith('blob:')) URL.revokeObjectURL(generatedAssetUrl.value)
  generatedAssetUrl.value = ''
  generatedSvg.value = ''
  if (generatedSvgUrl.value) URL.revokeObjectURL(generatedSvgUrl.value)
  generatedSvgUrl.value = ''
  generatedAssetTransparent.value = transparent
  generatedAssetMode.value = assetGenerationMode.value
  generatedAssetRegionId.value = regionId
  assetDescription.value = ''
  generatingAsset.value = true
  try {
    const source = selectedPreviewBlob || (await cropRegion(region))
    const regionReferenceDataUrl = await uploadAiTempBlob(source, {
      signal: assetController.signal,
    })
    const image = await generateDesignRegionImage({
      referenceImage: props.referenceImage,
      regionReferenceDataUrl,
      region,
      transparent,
      generationMode: generatedAssetMode.value,
      signal: assetController.signal,
      onRun(value) {
        assetRunId = value
      },
      onStage(value) {
        assetStage.value =
          value === 'complete'
            ? 'PNG 重建完成'
            : value === 'preparing'
              ? '正在创建重建任务'
              : '图片模型正在重建素材'
      },
      onImage(value) {
        if (selectedId.value === regionId && value?.dataUrl) generatedAssetUrl.value = value.dataUrl
      },
    })
    if (selectedId.value !== regionId) return
    let blob = await fetchMediaBlob(image.dataUrl)
    if (transparent) {
      if (await hasTransparency(blob)) {
        generatedAssetStatus.value = '已验证真实 Alpha 通道'
      } else {
        blob = await removeFlatBackground(blob)
        generatedAssetStatus.value = (await hasTransparency(blob))
          ? '模型未返回 Alpha，已自动去背'
          : '未检测到透明通道，请重新生成'
      }
    } else {
      generatedAssetStatus.value = '普通 PNG · 保留背景'
    }
    generatedAssetBlob = blob
    if (generatedAssetUrl.value?.startsWith('blob:')) URL.revokeObjectURL(generatedAssetUrl.value)
    generatedAssetUrl.value = URL.createObjectURL(blob)
  } catch (caught) {
    if (caught?.name !== 'AbortError') assetError.value = caught?.message || 'PNG 素材重建失败'
  } finally {
    generatingAsset.value = false
    assetController = null
    assetRunId = ''
  }
}

async function stopAssetGeneration() {
  assetController?.abort()
  if (assetRunId) await cancelAssistantRun(assetRunId).catch(() => null)
  assetDescriptionController?.abort()
  if (assetDescriptionRunId) await cancelAssistantRun(assetDescriptionRunId).catch(() => null)
  generatingAsset.value = false
  vectorizingSvg.value = false
  describingAsset.value = false
}

function downloadGeneratedAsset() {
  if (!generatedAssetBlob || !selectedNode.value) return
  const safeName = selectedNode.value.name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'ui-asset'
  const suffix = generatedAssetTransparent.value ? '-transparent' : ''
  downloadBlob(generatedAssetBlob, `${safeName}${suffix}.png`)
}

function assetId(regionId, format) {
  return `${regionId}-${format}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function assetPreviewSource(asset) {
  if (asset?.url) return asset.url
  if (!asset?.svgSource) return ''
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svgSource)}`
}

async function rasterizeGeneratedSvg() {
  if (!generatedSvg.value) throw new Error('请先生成 SVG')
  const source = URL.createObjectURL(svgBlob(generatedSvg.value))
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true })
      image.addEventListener('error', () => reject(new Error('SVG 预览读取失败')), { once: true })
      image.src = source
    })
    const bounds = selectedNaturalBounds.value || { width: 512, height: 512 }
    const scale = Math.min(1, 1024 / Math.max(bounds.width, bounds.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bounds.width * scale))
    canvas.height = Math.max(1, Math.round(bounds.height * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('SVG 描述预览生成失败'))),
        'image/png',
      )
    })
  } finally {
    URL.revokeObjectURL(source)
  }
}

async function describeGeneratedAsset(format) {
  const node = selectedNode.value
  if (
    !node ||
    describingAsset.value ||
    generatedAssetRegionId.value !== node.id ||
    (format === 'svg' ? !generatedSvg.value : !generatedAssetBlob)
  ) {
    return
  }
  assetDescriptionController?.abort()
  assetDescriptionController = new AbortController()
  const currentController = assetDescriptionController
  assetDescriptionRunId = ''
  describingAsset.value = true
  assetError.value = ''
  assetStage.value = 'AI 正在理解素材细节'
  try {
    const blob = format === 'svg' ? await rasterizeGeneratedSvg() : generatedAssetBlob
    const reference = await uploadAiTempBlob(blob, { signal: currentController.signal })
    assetDescription.value = await generateDesignAssetDescription({
      assetImage: reference,
      region: sourceRegion(node),
      transparent: format === 'svg' || generatedAssetTransparent.value,
      format,
      generationMode: generatedAssetMode.value,
      signal: currentController.signal,
      onRun(value) {
        assetDescriptionRunId = value
      },
      onStage(value) {
        assetStage.value = value === 'complete' ? '素材描述已生成' : 'AI 正在理解素材细节'
      },
    })
  } catch (caught) {
    if (caught?.name !== 'AbortError') assetError.value = caught?.message || '素材描述生成失败'
  } finally {
    describingAsset.value = false
    if (assetDescriptionController === currentController) assetDescriptionController = null
    assetDescriptionRunId = ''
  }
}

async function approveGeneratedAsset(format) {
  const node = selectedNode.value
  if (
    !node ||
    approvingAsset.value ||
    generatedAssetRegionId.value !== node.id ||
    (format === 'svg' ? !generatedSvg.value : !generatedAssetBlob)
  ) {
    return
  }
  approvingAsset.value = true
  assetError.value = ''
  assetStage.value = '正在保存到当前设计稿'
  try {
    const persistentUrl = format === 'png' ? await uploadAiTempBlob(generatedAssetBlob, {}) : ''
    const record = {
      id: assetId(node.id, format),
      sourceRegionId: node.id,
      name: node.name,
      format,
      url: persistentUrl,
      svgSource: format === 'svg' ? generatedSvg.value : '',
      description: assetDescription.value.trim() || node.description || node.name,
      transparent: format === 'svg' || generatedAssetTransparent.value,
      generationMode: generatedAssetMode.value,
      naturalBounds: {
        ...naturalBoundsForNode(node, documentViewport.value, sourceViewport.value),
      },
      createdAt: new Date().toISOString(),
    }
    assetLibrary.value = [
      record,
      ...assetLibrary.value.filter(
        (asset) => asset.sourceRegionId !== node.id || asset.format !== format,
      ),
    ]
    node.approvedAssetId = record.id
    assetStage.value = '已加入当前设计稿素材库'
    persistCachedDocument()
  } catch (caught) {
    assetError.value = caught?.message || '素材保存失败'
  } finally {
    approvingAsset.value = false
  }
}

function openInspector(mode) {
  preserveCanvasZoom()
  selectedId.value = ''
  inspectorMode.value = inspectorMode.value === mode ? '' : mode
}

function selectAssetRegion(asset) {
  const node = nodes.value.find((item) => item.id === asset.sourceRegionId)
  if (node) selectNode(node)
}

function removeLibraryAsset(asset) {
  assetLibrary.value = assetLibrary.value.filter((item) => item.id !== asset.id)
  nodes.value.forEach((node) => {
    if (node.approvedAssetId !== asset.id) return
    const fallback = assetLibrary.value.find((item) => item.sourceRegionId === node.id)
    node.approvedAssetId = fallback?.id || ''
  })
  persistCachedDocument()
}

async function generateWebsiteRestoration() {
  if (generatingWebsite.value || !props.referenceImage) return
  if (!assetLibrary.value.length) {
    websiteError.value = '请先确认至少一个素材并加入素材库'
    return
  }
  websiteController?.abort()
  websiteController = new AbortController()
  const currentController = websiteController
  websiteRunId = ''
  websiteCode.value = ''
  websiteError.value = ''
  websiteStage.value = '正在整理图层与素材'
  generatingWebsite.value = true
  try {
    websiteCode.value = await generateDesignWebsite({
      name: documentName.value,
      referenceImage: props.referenceImage,
      viewport: sourceViewport.value,
      nodes: nodes.value.filter((node) => !node.hidden).map(sourceRegion),
      assets: assetLibrary.value,
      signal: currentController.signal,
      onRun(value) {
        websiteRunId = value
      },
      onStage(value) {
        websiteStage.value = value === 'complete' ? '网站还原完成' : 'AI 正在构建页面'
      },
      onStream(value) {
        websiteCode.value = value
      },
    })
    persistCachedDocument()
  } catch (caught) {
    if (caught?.name !== 'AbortError') websiteError.value = caught?.message || '网站还原失败'
  } finally {
    generatingWebsite.value = false
    if (websiteController === currentController) websiteController = null
    websiteRunId = ''
  }
}

async function stopWebsiteRestoration() {
  websiteController?.abort()
  if (websiteRunId) await cancelAssistantRun(websiteRunId).catch(() => null)
  generatingWebsite.value = false
}

async function copyWebsiteCode() {
  await copyText(websiteCode.value, '完整网站代码已复制')
}

function downloadWebsiteCode() {
  if (!websiteCode.value) return
  const safeName = documentName.value.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'restored-design'
  downloadBlob(new Blob([websiteCode.value], { type: 'text/html' }), `${safeName}.html`)
}

async function copySelectedRegionSpec() {
  if (!selectedNode.value) return
  const node = sourceRegion(selectedNode.value)
  const payload = {
    name: node.name,
    type: node.type,
    category: node.category,
    description: node.description,
    bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
    style: {
      fill: node.fill,
      color: node.color,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      radius: node.radius,
      shadow: node.shadow,
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      lineHeight: node.lineHeight,
    },
  }
  await copyText(JSON.stringify(payload, null, 2), '尺寸与样式已复制')
}

async function generateSelectedRegionCode() {
  if (
    !selectedNode.value ||
    generatingRegionCode.value ||
    generating.value ||
    !requireConfirmedRegion()
  )
    return
  const regionId = selectedId.value
  const region = sourceRegion(selectedNode.value)
  regionCodeController?.abort()
  regionCodeController = new AbortController()
  regionCodeRunId = ''
  regionCode.value = ''
  regionCodeError.value = ''
  regionCodeStage.value = '正在读取选中区域'
  generatingRegionCode.value = true
  try {
    const generatedCode = await generateDesignRegionCode({
      referenceImage: props.referenceImage,
      viewport: sourceViewport.value,
      region,
      framework: regionCodeFramework.value,
      signal: regionCodeController.signal,
      onRun(value) {
        regionCodeRunId = value
      },
      onStage(value) {
        regionCodeStage.value = value === 'complete' ? '代码已生成' : 'AI 正在生成区域代码'
      },
      onStream(value) {
        if (selectedId.value === regionId) regionCode.value = value
      },
    })
    if (selectedId.value === regionId) regionCode.value = generatedCode
  } catch (caught) {
    if (caught?.name !== 'AbortError') {
      regionCodeError.value = caught?.message || '区域代码生成失败'
    }
  } finally {
    generatingRegionCode.value = false
    regionCodeController = null
    regionCodeRunId = ''
  }
}

async function stopRegionCodeGeneration() {
  regionCodeController?.abort()
  if (regionCodeRunId) await cancelAssistantRun(regionCodeRunId).catch(() => null)
  generatingRegionCode.value = false
}

async function copyRegionCode() {
  await copyText(regionCode.value, '代码已复制')
}

async function copyText(value, successMessage) {
  if (!value) return
  if (copyFeedbackTimer) window.clearTimeout(copyFeedbackTimer)
  try {
    await navigator.clipboard.writeText(value)
    copyFeedback.value = successMessage
  } catch {
    copyFeedback.value = '复制失败，请重试'
  }
  copyFeedbackTimer = window.setTimeout(() => {
    copyFeedback.value = ''
    copyFeedbackTimer = null
  }, 1600)
}

async function measureReferenceViewport(source, fallback, signal) {
  const reference = String(source || '').trim()
  if (!reference || typeof createImageBitmap !== 'function') {
    return { viewport: { ...fallback }, sourceViewport: { ...fallback } }
  }
  try {
    const bitmap = await createImageBitmap(await referenceBlob(signal))
    const naturalWidth = Math.max(1, bitmap.width)
    const naturalHeight = Math.max(1, bitmap.height)
    bitmap.close?.()
    return {
      viewport: fitAnalysisViewport(
        { width: naturalWidth, height: naturalHeight },
        { maxDimension: 1920, minDimension: 320, background: fallback.background },
      ),
      sourceViewport: {
        width: naturalWidth,
        height: naturalHeight,
        background: fallback.background,
      },
    }
  } catch (caught) {
    if (caught?.name === 'AbortError') throw caught
    return { viewport: { ...fallback }, sourceViewport: { ...fallback } }
  }
}

async function generate({ force = false } = {}) {
  if (generating.value || !props.prompt.trim()) return
  const currentGenerationKey = generationKey.value
  if (!force && generatedPrompt === currentGenerationKey && nodes.value.length) return
  if (generatedPrompt && generatedPrompt !== currentGenerationKey) {
    assetLibrary.value = []
    websiteCode.value = ''
  }
  const resumeSession =
    props.referenceImage &&
    props.resumeSession?.version === ACTIVE_DESIGN_ANALYSIS_VERSION &&
    props.resumeSession?.referenceImage === props.referenceImage
      ? { ...props.resumeSession }
      : null
  activeAnalysisSession = resumeSession
  preserveAnalysisSession = false
  controller?.abort()
  controller = new AbortController()
  generating.value = true
  historyReady = false
  if (historyTimer) window.clearTimeout(historyTimer)
  historyTimer = null
  historyPast.value = []
  historyFuture.value = []
  error.value = ''
  stage.value = 'preparing'
  streamNodeCounts.draft = 0
  streamNodeCounts.refine = 0
  selectedId.value = ''
  preciseDrawMode.value = false
  nodes.value = []
  animatedNodeIds.clear()
  showReference.value = Boolean(props.referenceImage)
  cursorLabel.value = props.referenceImage ? '正在分析当前成稿' : '正在规划画布'
  try {
    if (resumeSession?.viewport) {
      documentViewport.value = { ...resumeSession.viewport }
      sourceViewport.value = {
        ...(resumeSession.sourceViewport || resumeSession.viewport),
      }
    } else if (props.referenceImage) {
      const geometry = await measureReferenceViewport(
        props.referenceImage,
        props.viewport,
        controller.signal,
      )
      documentViewport.value = geometry.viewport
      sourceViewport.value = geometry.sourceViewport
    } else {
      documentViewport.value = { ...props.viewport }
      sourceViewport.value = { ...props.viewport }
    }
    const analysisReferenceImage = props.referenceImage
      ? await prepareAnalysisReference(documentViewport.value, controller.signal)
      : ''
    const document = await generateAiDesignDocument({
      prompt: props.prompt,
      viewport: documentViewport.value,
      referenceImage: analysisReferenceImage,
      resumeSession,
      signal: controller.signal,
      onRun(value) {
        runId = value
      },
      onSession(value) {
        persistActiveAnalysisSession(value)
      },
      onStage(value) {
        stage.value = value
      },
      shouldPreserveSession() {
        return preserveAnalysisSession
      },
      onStream(content, phase = 'draft') {
        const streamPhase = phase === 'refine' ? 'refine' : 'draft'
        const progress = extractDesignDocumentProgress(content, documentViewport.value)
        documentViewport.value = progress.viewport
        const progressNodes = props.referenceImage
          ? attachNaturalBounds(progress.nodes, documentViewport.value, sourceViewport.value)
          : progress.nodes
        if (progressNodes.length <= streamNodeCounts[streamPhase]) return
        const added = progressNodes.slice(streamNodeCounts[streamPhase])
        streamNodeCounts[streamPhase] = progressNodes.length
        if (streamPhase === 'draft') {
          nodes.value = progressNodes
          if (added.length) void animateNewNodes(added)
          return
        }
        const nextNodes = [...nodes.value]
        added.forEach((node, offset) => {
          const progressIndex = streamNodeCounts.refine - added.length + offset
          const currentIndex = nextNodes.findIndex((item) => item.id === node.id)
          if (currentIndex >= 0) nextNodes[currentIndex] = node
          else if (progressIndex < nextNodes.length) nextNodes[progressIndex] = node
          else nextNodes.push(node)
        })
        nodes.value = nextNodes
        void animateRefinedNodes(added)
      },
    })
    documentName.value = document.name
    documentViewport.value = document.viewport
    nodes.value = props.referenceImage
      ? attachNaturalBounds(document.nodes, documentViewport.value, sourceViewport.value)
      : document.nodes
    tokens.value = document.tokens
    generatedPrompt = currentGenerationKey
    stage.value = 'complete'
    await nextTick()
    fitCanvas()
    showReference.value = Boolean(props.referenceImage)
    persistCachedDocument()
    clearActiveAnalysisSession()
  } catch (caught) {
    if (caught?.name === 'AbortError') {
      if (!preserveAnalysisSession) clearActiveAnalysisSession()
    } else {
      error.value = caught?.message || 'AI 设计生成失败'
      if (caught?.runTerminal || stage.value === 'complete' || !runId) {
        clearActiveAnalysisSession()
      } else {
        persistActiveAnalysisSession({ runId })
      }
    }
  } finally {
    resetHistory()
    generating.value = false
    controller = null
    runId = ''
  }
}

function stopGeneration() {
  preserveAnalysisSession = false
  controller?.abort()
  clearActiveAnalysisSession()
  generating.value = false
  stage.value = 'idle'
}

function handleKeydown(event) {
  if (!props.open) return
  if (props.referenceImage) {
    if (event.key === 'Escape') {
      if (selectedId.value) selectedId.value = ''
      else close()
    }
    return
  }
  const isEditingField =
    ['INPUT', 'TEXTAREA'].includes(event.target?.tagName) || event.target?.isContentEditable
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !isEditingField) {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && !isEditingField) {
    event.preventDefault()
    duplicateSelected()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !isEditingField) {
    event.preventDefault()
    deleteSelected()
    return
  }
  if (selectedNode.value && !selectedNode.value.locked && !isEditingField) {
    const distance = event.shiftKey ? 10 : 1
    const movement = {
      ArrowLeft: [-distance, 0],
      ArrowRight: [distance, 0],
      ArrowUp: [0, -distance],
      ArrowDown: [0, distance],
    }[event.key]
    if (movement) {
      event.preventDefault()
      markNodeEdited(selectedNode.value)
      selectedNode.value.x = Math.round(
        clamp(
          selectedNode.value.x + movement[0],
          0,
          documentViewport.value.width - selectedNode.value.width,
        ),
      )
      selectedNode.value.y = Math.round(
        clamp(
          selectedNode.value.y + movement[1],
          0,
          documentViewport.value.height - selectedNode.value.height,
        ),
      )
      return
    }
  }
  if (event.key === 'Escape') selectedId.value = ''
}

function close() {
  persistCachedDocument()
  emit('close')
}

function preserveAnalysisOnPageExit() {
  if (generating.value && props.referenceImage) preserveAnalysisSession = true
}

onMounted(() => {
  window.addEventListener('beforeunload', preserveAnalysisOnPageExit)
  window.addEventListener('pagehide', preserveAnalysisOnPageExit)
})

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      document.body.style.overflow = previousBodyOverflow
      if (preserveZoomFrame) window.cancelAnimationFrame(preserveZoomFrame)
      if (preserveZoomTimer) window.clearTimeout(preserveZoomTimer)
      preserveZoomFrame = 0
      preserveZoomTimer = null
      suppressCanvasFit = false
      if (generatingRegionCode.value) void stopRegionCodeGeneration()
      if (generatingAsset.value || vectorizingSvg.value || describingAsset.value) {
        void stopAssetGeneration()
      }
      if (generatingWebsite.value) void stopWebsiteRestoration()
      preciseDrawMode.value = false
      endNodeDrag()
      endNodeResize()
      window.removeEventListener('keydown', handleKeydown)
      resizeObserver?.disconnect()
      resizeObserver = null
      animationContext?.revert()
      animationContext = null
      return
    }
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    showReference.value = Boolean(props.referenceImage)
    selectedId.value = ''
    window.addEventListener('keydown', handleKeydown)
    await nextTick()
    animationContext = root.value ? gsap.context(() => {}, root.value) : null
    resizeObserver = new ResizeObserver(() => {
      if (suppressCanvasFit) {
        zoom.value = preservedCanvasZoom
        return
      }
      fitCanvas()
    })
    if (canvasViewport.value) resizeObserver.observe(canvasViewport.value)
    fitCanvas()
  },
  { immediate: true },
)

watch(
  () => [props.open, props.generationNonce],
  ([isOpen, nonce]) => {
    if (!isOpen || nonce === handledGenerationNonce) return
    handledGenerationNonce = nonce
    if (
      props.resumeSession?.version === ACTIVE_DESIGN_ANALYSIS_VERSION &&
      props.resumeSession?.conversationId
    ) {
      activeAnalysisSession = { ...props.resumeSession }
      void generate({ force: true })
      return
    }
    if (restoreCachedDocument()) return
    void generate({ force: true })
  },
  { flush: 'post' },
)

watch(
  [documentName, documentViewport, sourceViewport, nodes, tokens, assetLibrary],
  scheduleHistory,
  {
    deep: true,
  },
)
watch(selectedId, () => {
  preserveCanvasZoom({ centerSelection: Boolean(selectedId.value) })
  if (generatingRegionCode.value) void stopRegionCodeGeneration()
  if (generatingAsset.value || vectorizingSvg.value || describingAsset.value) {
    void stopAssetGeneration()
  }
  copyFeedback.value = ''
  regionInspectorTab.value = selectedNode.value?.manualSelection
    ? 'code'
    : selectedSupportsAsset.value
      ? 'asset'
      : 'code'
})
watch(() => {
  const node = selectedNode.value
  return node ? `${node.id}:${node.x}:${node.y}:${node.width}:${node.height}` : ''
}, scheduleSelectedPreview)
watch(
  () => props.referenceImage,
  () => {
    referenceBlobKey = ''
    referenceBlobPromise = null
    void refreshSelectedPreview()
  },
)

onBeforeUnmount(() => {
  preserveAnalysisOnPageExit()
  if (!preserveAnalysisSession) controller?.abort()
  regionCodeController?.abort()
  assetController?.abort()
  assetDescriptionController?.abort()
  websiteController?.abort()
  if (selectedPreviewUrl.value) URL.revokeObjectURL(selectedPreviewUrl.value)
  if (generatedAssetUrl.value?.startsWith('blob:')) URL.revokeObjectURL(generatedAssetUrl.value)
  if (generatedSvgUrl.value) URL.revokeObjectURL(generatedSvgUrl.value)
  if (historyTimer) window.clearTimeout(historyTimer)
  if (copyFeedbackTimer) window.clearTimeout(copyFeedbackTimer)
  if (selectedPreviewTimer) window.clearTimeout(selectedPreviewTimer)
  if (preserveZoomFrame) window.cancelAnimationFrame(preserveZoomFrame)
  if (preserveZoomTimer) window.clearTimeout(preserveZoomTimer)
  endNodeDrag()
  endNodeResize()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('beforeunload', preserveAnalysisOnPageExit)
  window.removeEventListener('pagehide', preserveAnalysisOnPageExit)
  resizeObserver?.disconnect()
  animationContext?.revert()
  document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="root"
      class="adc"
      :class="{
        'is-region-analyzer': referenceImage,
        'has-region-selection': referenceImage && (selectedNode || inspectorMode),
        'is-inspector-wide': referenceImage && inspectorMode,
        'is-layers-collapsed': referenceImage && !showLayerPanel,
      }"
      role="dialog"
      aria-modal="true"
      :aria-label="referenceImage ? '设计稿元素分析器' : 'AI 设计画布'"
    >
      <header class="adc-topbar">
        <div class="adc-brand">
          <span
            ><i
              class="bi"
              :class="referenceImage ? 'bi-bounding-box' : 'bi-bezier2'"
              aria-hidden="true"
            ></i
          ></span>
          <strong v-if="referenceImage">设计稿元素分析</strong>
          <input v-else v-model="documentName" aria-label="设计稿名称" />
          <template v-if="referenceImage">
            <em class="adc-region-total">{{ nodes.length }}</em>
            <button
              type="button"
              class="adc-layer-toggle"
              :title="showLayerPanel ? '收起元素列表' : '展开元素列表'"
              :aria-pressed="showLayerPanel"
              @click="toggleLayerPanel"
            >
              <i
                class="bi"
                :class="showLayerPanel ? 'bi-layout-sidebar-inset' : 'bi-layout-sidebar'"
              ></i>
            </button>
          </template>
          <div v-if="!referenceImage" class="adc-history" aria-label="历史操作">
            <button type="button" title="撤销 ⌘Z" :disabled="!historyPast.length" @click="undo">
              <i class="bi bi-arrow-counterclockwise"></i>
            </button>
            <button type="button" title="重做 ⇧⌘Z" :disabled="!historyFuture.length" @click="redo">
              <i class="bi bi-arrow-clockwise"></i>
            </button>
          </div>
        </div>
        <div v-if="!referenceImage" class="adc-tools" role="toolbar" aria-label="设计工具">
          <button type="button" title="选择"><i class="bi bi-cursor"></i></button>
          <button type="button" title="矩形" @click="addNode('rectangle')">
            <i class="bi bi-square"></i>
          </button>
          <button type="button" title="文本" @click="addNode('text')">
            <i class="bi bi-fonts"></i>
          </button>
          <button type="button" title="按钮" @click="addNode('button')">
            <i class="bi bi-ui-checks"></i>
          </button>
        </div>
        <div class="adc-actions">
          <button
            v-if="referenceImage"
            type="button"
            class="is-panel-action"
            :class="{ 'is-on': inspectorMode === 'library' }"
            @click="openInspector('library')"
          >
            <i class="bi bi-collection"></i>素材 {{ assetLibrary.length }}
          </button>
          <button
            v-if="referenceImage"
            type="button"
            class="is-panel-action"
            :class="{ 'is-on': inspectorMode === 'website' }"
            @click="openInspector('website')"
          >
            <i class="bi bi-window"></i>还原网站
          </button>
          <span v-if="generating" class="adc-ai-status"><i></i>{{ stageLabel }}</span>
          <button v-if="generating" type="button" @click="stopGeneration">
            <i class="bi bi-stop-fill"></i>停止
          </button>
          <button v-else type="button" @click="generate({ force: true })">
            <i class="bi bi-stars"></i>{{ referenceImage ? '重新分析' : '重新设计' }}
          </button>
          <button v-if="!referenceImage" type="button" @click="exportDocument('json')">
            <i class="bi bi-filetype-json"></i>
          </button>
          <button
            v-if="!referenceImage"
            type="button"
            class="is-primary"
            @click="exportDocument('html')"
          >
            <i class="bi bi-download"></i>导出
          </button>
          <button type="button" class="is-icon" aria-label="关闭" @click="close">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </header>

      <main class="adc-workspace">
        <aside class="adc-layers">
          <header>
            <strong>{{ referenceImage ? '识别元素' : '图层' }}</strong
            ><em>{{ nodes.length }}</em>
          </header>
          <label class="adc-layer-search"
            ><i class="bi bi-search"></i><input v-model="layerSearch" placeholder="搜索图层"
          /></label>
          <div class="adc-layer-list" :class="{ 'is-region-list': referenceImage }">
            <button
              v-for="entry in layerEntries"
              :key="entry.node.id"
              type="button"
              :class="{
                'is-on': selectedId === entry.node.id,
                'is-hovered': hoveredId === entry.node.id,
                'is-hidden': entry.node.hidden,
              }"
              :style="{ paddingLeft: `${6 + entry.depth * 9}px` }"
              :aria-pressed="selectedId === entry.node.id"
              @pointerenter="hoverNode(entry.node.id)"
              @pointerleave="clearHoveredNode(entry.node.id)"
              @click="selectNode(entry.node)"
            >
              <i class="bi" :class="NODE_ICONS[entry.node.type]"></i>
              <span
                ><strong>{{ entry.node.name }}</strong
                ><small>{{ entry.node.type }}</small></span
              >
              <i
                v-if="!referenceImage"
                class="bi"
                :class="entry.node.hidden ? 'bi-eye-slash' : 'bi-eye'"
                @click.stop="toggleNodeVisibility(entry.node)"
              ></i>
              <i
                v-if="!referenceImage"
                class="bi"
                :class="entry.node.locked ? 'bi-lock-fill' : 'bi-unlock'"
                @click.stop="toggleNodeLock(entry.node)"
              ></i>
            </button>
          </div>
          <div v-if="generating && !nodes.length" class="adc-layers-loading">
            <i class="bi bi-stars"></i><span>AI 正在识别页面区域</span>
          </div>
        </aside>

        <section ref="canvasViewport" class="adc-canvas" @pointerdown.self="selectedId = ''">
          <div class="adc-canvas-toolbar">
            <button type="button" @click="zoom = clamp(zoom - 0.1, 0.2, 2)">
              <i class="bi bi-dash"></i>
            </button>
            <span>{{ zoomLabel }}</span>
            <button type="button" @click="zoom = clamp(zoom + 0.1, 0.2, 2)">
              <i class="bi bi-plus"></i>
            </button>
            <button type="button" @click="fitCanvas">
              <i class="bi bi-arrows-angle-contract"></i>
            </button>
            <button
              v-if="referenceImage"
              type="button"
              :class="{ 'is-on': preciseDrawMode }"
              :disabled="generating"
              :title="preciseDrawMode ? '退出手动画选区' : '手动画精确选区'"
              @click="preciseDrawMode = !preciseDrawMode"
            >
              <i class="bi bi-bounding-box-circles"></i>
            </button>
          </div>
          <div class="adc-artboard-frame" :style="viewportFrameStyle">
            <div
              ref="artboard"
              class="adc-artboard"
              :class="{
                'is-tracing': showReference && generating,
                'is-fidelity-view': showReference,
                'is-structure-view': !showReference,
              }"
              :style="artboardStyle"
            >
              <AuthenticatedImage
                v-if="referenceImage && showReference"
                class="adc-reference"
                :src="referenceImage"
                alt="原始 UI 成稿参考"
                loading="eager"
              />
              <PreciseRegionOverlay
                v-if="referenceImage && showReference"
                :width="documentViewport.width"
                :height="documentViewport.height"
                :zoom="zoom"
                :nodes="nodes"
                :selected-id="selectedId"
                :draw-mode="preciseDrawMode"
                :disabled="generating"
                @select="selectPreciseRegion"
                @hover="hoverNode"
                @update-bounds="updatePreciseRegionBounds"
                @create-region="createPreciseRegion"
                @draw-complete="preciseDrawMode = false"
              />
              <template v-if="!referenceImage">
                <span
                  v-for="node in fidelityPatches"
                  :key="`patch-${node.id}`"
                  class="adc-node-patch"
                  :style="nodePatchStyle(node)"
                  aria-hidden="true"
                ></span>
              </template>
              <template v-if="!referenceImage">
                <button
                  v-for="node in nodes"
                  :key="node.id"
                  type="button"
                  class="adc-node"
                  :class="[
                    `is-${node.type}`,
                    {
                      'is-selected': selectedId === node.id,
                      'is-hovered': hoveredId === node.id,
                      'is-locked': node.locked,
                      'is-detached': node.detached,
                    },
                  ]"
                  :data-node-id="node.id"
                  :data-region-name="referenceImage ? node.name : undefined"
                  :aria-label="referenceImage ? `选择 ${node.name}` : node.name"
                  :aria-pressed="selectedId === node.id"
                  :style="nodeStyle(node)"
                  @pointerenter="hoverNode(node.id)"
                  @pointerleave="clearHoveredNode(node.id)"
                  @pointerdown="beginNodeDrag($event, node)"
                  @click.stop="selectNode(node)"
                  @dblclick="beginInlineTextEdit($event, node)"
                >
                  <i v-if="node.type === 'icon'" class="bi" :class="node.icon || 'bi-star'"></i>
                  <img
                    v-else-if="node.type === 'image' && node.src"
                    :src="node.src"
                    alt=""
                    :style="{ objectFit: node.objectFit }"
                    draggable="false"
                  />
                  <span
                    v-else-if="
                      node.type !== 'rectangle' &&
                      node.type !== 'frame' &&
                      node.type !== 'image' &&
                      node.type !== 'divider'
                    "
                    class="adc-node-text"
                    :contenteditable="editingTextId === node.id"
                    :spellcheck="editingTextId === node.id"
                    @input="updateInlineText($event, node)"
                    @blur="finishInlineTextEdit($event, node)"
                    @keydown="handleInlineTextKeydown"
                    >{{ node.text }}</span
                  >
                  <span
                    v-if="selectedId === node.id && !referenceImage"
                    class="adc-selection"
                    aria-hidden="true"
                  >
                    <i @pointerdown.stop="beginNodeResize($event, node, 'nw')"></i>
                    <i @pointerdown.stop="beginNodeResize($event, node, 'ne')"></i>
                    <i @pointerdown.stop="beginNodeResize($event, node, 'se')"></i>
                    <i @pointerdown.stop="beginNodeResize($event, node, 'sw')"></i>
                  </span>
                </button>
              </template>
              <div v-if="generating" ref="aiCursor" class="adc-ai-cursor" aria-hidden="true">
                <i class="bi bi-cursor-fill"></i><span>{{ cursorLabel }}</span>
              </div>
            </div>
          </div>
          <footer v-if="generating" class="adc-stream-status">
            <span><i></i>{{ stageLabel }}</span
            ><em>已标记 {{ nodes.length }} 个可点击区域</em>
          </footer>
          <p v-if="error" class="adc-error"><i class="bi bi-exclamation-circle"></i>{{ error }}</p>
        </section>

        <aside class="adc-inspector" :class="{ 'has-selection': selectedNode || inspectorMode }">
          <template v-if="referenceImage">
            <template v-if="inspectorMode === 'library'">
              <header class="adc-library-head">
                <span>
                  <small>DESIGN ASSETS</small>
                  <strong>当前设计稿素材</strong>
                </span>
                <button type="button" title="关闭素材库" @click="inspectorMode = ''">
                  <i class="bi bi-x-lg"></i>
                </button>
              </header>
              <section class="adc-library-summary">
                <span>
                  <strong>{{ assetCoverage.approved }} / {{ assetCoverage.total }}</strong>
                  <small>素材区域已确认</small>
                </span>
                <i class="bi bi-check2-circle"></i>
              </section>
              <div v-if="assetLibrary.length" class="adc-library-list">
                <article v-for="asset in assetLibrary" :key="asset.id" class="adc-library-item">
                  <button type="button" @click="selectAssetRegion(asset)">
                    <span
                      class="adc-library-thumb"
                      :class="{ 'is-transparent': asset.transparent }"
                    >
                      <AuthenticatedImage
                        :src="assetPreviewSource(asset)"
                        :alt="asset.name"
                        loading="eager"
                      />
                    </span>
                    <span>
                      <strong>{{ asset.name }}</strong>
                      <small
                        >{{ asset.format.toUpperCase() }} ·
                        {{ asset.generationMode === 'replace' ? '创意替换' : '严格还原' }}</small
                      >
                      <em>{{ asset.description }}</em>
                    </span>
                  </button>
                  <button type="button" title="从素材库移除" @click="removeLibraryAsset(asset)">
                    <i class="bi bi-trash3"></i>
                  </button>
                </article>
              </div>
              <div v-else class="adc-inspector-empty">
                <i class="bi bi-collection"></i>
                <strong>还没有确认素材</strong>
                <span>选择图层并校准边界，生成满意后再加入</span>
              </div>
            </template>

            <template v-else-if="inspectorMode === 'website'">
              <header class="adc-library-head">
                <span>
                  <small>RESTORE WEBSITE</small>
                  <strong>一键还原设计稿</strong>
                </span>
                <button type="button" title="关闭网站还原" @click="inspectorMode = ''">
                  <i class="bi bi-x-lg"></i>
                </button>
              </header>
              <section class="adc-website-summary">
                <strong>{{ assetLibrary.length }} 个已确认素材</strong>
                <span>使用原图、精确图层和素材映射构建真实 HTML/CSS</span>
                <button
                  v-if="!generatingWebsite"
                  type="button"
                  :disabled="!assetLibrary.length"
                  @click="generateWebsiteRestoration"
                >
                  <i class="bi bi-stars"></i>{{ websiteCode ? '重新还原' : '开始还原网站' }}
                </button>
                <button v-else type="button" class="is-stop" @click="stopWebsiteRestoration">
                  <i class="bi bi-stop-fill"></i>{{ websiteStage }}
                </button>
              </section>
              <section v-if="websiteCode" class="adc-website-result">
                <div>
                  <strong>实时页面预览</strong>
                  <span>
                    <button type="button" title="复制 HTML" @click="copyWebsiteCode">
                      <i class="bi bi-copy"></i>
                    </button>
                    <button type="button" title="下载 HTML" @click="downloadWebsiteCode">
                      <i class="bi bi-download"></i>
                    </button>
                  </span>
                </div>
                <iframe title="还原网站预览" sandbox="allow-scripts" :srcdoc="websiteCode"></iframe>
              </section>
              <p v-if="websiteError" class="adc-region-error">{{ websiteError }}</p>
            </template>

            <template v-else-if="selectedNode">
              <header class="adc-region-head">
                <span>
                  <small>{{
                    selectedNode.manualSelection ? 'MANUAL REGION' : 'AI CANDIDATE'
                  }}</small>
                  <strong>{{ selectedNode.name }}</strong>
                </span>
                <div class="adc-region-head-actions">
                  <em>{{ selectedNode.selectionConfirmed ? '已确认' : '候选' }}</em>
                  <button type="button" title="复制尺寸与样式" @click="copySelectedRegionSpec">
                    <i class="bi bi-braces"></i>
                  </button>
                  <button type="button" title="取消选择" @click="selectedId = ''">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
              </header>

              <section class="adc-region-preview">
                <h3>定位预览</h3>
                <div>
                  <img
                    v-if="selectedPreviewUrl"
                    :src="selectedPreviewUrl"
                    :alt="selectedNode.name"
                  />
                  <span v-else><i class="bi bi-arrow-repeat spin"></i>正在提取预览</span>
                </div>
                <p>仅用于确认选区位置，不会作为最终素材交付。</p>
              </section>

              <section class="adc-region-meta">
                <dl>
                  <div>
                    <dt>类型</dt>
                    <dd>{{ selectedNode.type }}</dd>
                  </div>
                  <div>
                    <dt>原图尺寸</dt>
                    <dd>{{ selectedNaturalBounds.width }} × {{ selectedNaturalBounds.height }}</dd>
                  </div>
                  <div>
                    <dt>原图位置</dt>
                    <dd>{{ selectedNaturalBounds.x }}, {{ selectedNaturalBounds.y }}</dd>
                  </div>
                </dl>
                <div
                  class="adc-region-confirm"
                  :class="{ 'is-confirmed': selectedNode.selectionConfirmed }"
                >
                  <span>
                    <i
                      class="bi"
                      :class="
                        selectedNode.selectionConfirmed ? 'bi-check2-circle' : 'bi-bounding-box'
                      "
                    ></i>
                    <strong>{{
                      selectedNode.selectionConfirmed ? '精确选区已确认' : '请校准选区边界'
                    }}</strong>
                    <small>{{
                      selectedNode.selectionConfirmed
                        ? '后续输出使用原图像素坐标'
                        : '可拖动选框或八个控制点调整'
                    }}</small>
                  </span>
                  <button
                    v-if="!selectedNode.selectionConfirmed"
                    type="button"
                    @click="confirmPreciseRegion"
                  >
                    确认选区
                  </button>
                </div>
              </section>

              <nav class="adc-region-tabs" aria-label="选区操作">
                <button
                  v-if="selectedSupportsAsset"
                  type="button"
                  :class="{ 'is-on': regionInspectorTab === 'asset' }"
                  :aria-pressed="regionInspectorTab === 'asset'"
                  @click="regionInspectorTab = 'asset'"
                >
                  <i class="bi bi-image"></i>素材
                </button>
                <button
                  type="button"
                  :class="{ 'is-on': regionInspectorTab === 'code' }"
                  :aria-pressed="regionInspectorTab === 'code'"
                  @click="regionInspectorTab = 'code'"
                >
                  <i class="bi bi-code-slash"></i>代码
                </button>
              </nav>

              <Transition name="adc-inspector-panel" mode="out-in">
                <section
                  v-if="regionInspectorTab === 'asset' && selectedSupportsAsset"
                  key="asset"
                  class="adc-region-assets"
                >
                  <h3>素材输出</h3>
                  <div class="adc-asset-mode" role="group" aria-label="素材生成策略">
                    <button
                      type="button"
                      :class="{ 'is-on': assetGenerationMode === 'strict' }"
                      @click="assetGenerationMode = 'strict'"
                    >
                      严格还原
                    </button>
                    <button
                      type="button"
                      :class="{ 'is-on': assetGenerationMode === 'replace' }"
                      @click="assetGenerationMode = 'replace'"
                    >
                      创意替换
                    </button>
                  </div>
                  <p v-if="selectedApprovedAsset" class="adc-asset-approved">
                    <i class="bi bi-check2-circle"></i>当前图层已绑定素材库中的
                    {{ selectedApprovedAsset.format.toUpperCase() }}
                  </p>
                  <button
                    v-if="selectedNode.category === 'icon' || selectedNode.type === 'icon'"
                    type="button"
                    class="is-primary"
                    :disabled="
                      generatingAsset || vectorizingSvg || !selectedNode.selectionConfirmed
                    "
                    @click="generateSelectedSvg"
                  >
                    <i class="bi bi-bezier2"></i>
                    <span
                      ><strong>{{ vectorizingSvg ? '正在矢量化' : '生成 SVG' }}</strong
                      ><small>纯路径轮廓，不嵌入截图</small></span
                    >
                  </button>
                  <button
                    type="button"
                    :class="{ 'is-primary': selectedNode.category !== 'icon' }"
                    :disabled="
                      generatingAsset || vectorizingSvg || !selectedNode.selectionConfirmed
                    "
                    @click="generateSelectedAsset(true)"
                  >
                    <i class="bi bi-filetype-png"></i>
                    <span><strong>重建透明 PNG</strong><small>校验 Alpha 通道</small></span>
                  </button>
                  <button
                    type="button"
                    :disabled="
                      generatingAsset || vectorizingSvg || !selectedNode.selectionConfirmed
                    "
                    @click="generateSelectedAsset(false)"
                  >
                    <i class="bi bi-image"></i>
                    <span><strong>重建普通 PNG</strong><small>保留原始背景</small></span>
                  </button>

                  <button
                    v-if="generatingAsset || vectorizingSvg"
                    type="button"
                    class="adc-asset-stop"
                    @click="stopAssetGeneration"
                  >
                    <i class="bi bi-stop-fill"></i>
                    <span
                      ><strong>{{ assetStage }}</strong
                      ><small>点击停止重建任务</small></span
                    >
                  </button>

                  <div v-if="generatedSvgUrl" class="adc-asset-result">
                    <div class="adc-asset-preview is-svg">
                      <img :src="generatedSvgUrl" :alt="`${selectedNode.name} SVG`" />
                    </div>
                    <span><strong>SVG 已生成</strong><small>纯路径 · 无嵌入位图</small></span>
                    <div>
                      <button
                        type="button"
                        title="AI 生成素材描述"
                        :disabled="describingAsset || approvingAsset"
                        @click="describeGeneratedAsset('svg')"
                      >
                        <i class="bi bi-text-paragraph"></i>
                      </button>
                      <button type="button" title="复制 SVG" @click="copyGeneratedSvg">
                        <i class="bi bi-copy"></i>
                      </button>
                      <button type="button" title="下载 SVG" @click="downloadGeneratedSvg">
                        <i class="bi bi-download"></i>
                      </button>
                    </div>
                  </div>

                  <div v-if="generatedAssetUrl" class="adc-asset-result">
                    <div
                      class="adc-asset-preview"
                      :class="{ 'is-transparent': generatedAssetTransparent }"
                    >
                      <AuthenticatedImage
                        :src="generatedAssetUrl"
                        :alt="`${selectedNode.name} PNG`"
                        loading="eager"
                      />
                    </div>
                    <span
                      ><strong>PNG 已重建</strong
                      ><small>{{ generatedAssetStatus || assetStage }}</small></span
                    >
                    <div>
                      <button
                        type="button"
                        title="AI 生成素材描述"
                        :disabled="describingAsset || approvingAsset"
                        @click="describeGeneratedAsset('png')"
                      >
                        <i class="bi bi-text-paragraph"></i>
                      </button>
                      <button
                        type="button"
                        title="下载 PNG"
                        :disabled="!generatedAssetBlob"
                        @click="downloadGeneratedAsset"
                      >
                        <i class="bi bi-download"></i>
                      </button>
                    </div>
                  </div>
                  <div v-if="generatedSvgUrl || generatedAssetUrl" class="adc-asset-approval">
                    <label>
                      <span>素材描述</span>
                      <textarea
                        v-model="assetDescription"
                        :placeholder="
                          describingAsset ? 'AI 正在分析素材…' : '描述主体、颜色、材质和用途'
                        "
                      ></textarea>
                    </label>
                    <button
                      type="button"
                      :disabled="approvingAsset || describingAsset"
                      @click="approveGeneratedAsset(generatedSvgUrl ? 'svg' : 'png')"
                    >
                      <i
                        class="bi"
                        :class="approvingAsset ? 'bi-arrow-repeat spin' : 'bi-plus-lg'"
                      ></i>
                      {{ approvingAsset ? '正在保存' : '确认并加入素材库' }}
                    </button>
                    <small>生成结果仅在确认后才会进入当前设计稿素材库</small>
                  </div>
                </section>

                <section v-else key="code" class="adc-region-code">
                  <div class="adc-region-code-head">
                    <h3>区域代码</h3>
                    <div role="group" aria-label="代码类型">
                      <button
                        type="button"
                        :class="{ 'is-on': regionCodeFramework === 'vue' }"
                        @click="regionCodeFramework = 'vue'"
                      >
                        Vue
                      </button>
                      <button
                        type="button"
                        :class="{ 'is-on': regionCodeFramework === 'html' }"
                        @click="regionCodeFramework = 'html'"
                      >
                        HTML
                      </button>
                    </div>
                  </div>
                  <button
                    v-if="!generatingRegionCode"
                    type="button"
                    class="adc-region-generate"
                    :disabled="generating || !selectedNode.selectionConfirmed"
                    @click="generateSelectedRegionCode"
                  >
                    <i class="bi bi-stars"></i>
                    <span
                      ><strong>AI 生成区域代码</strong><small>只实现当前选中的这一块</small></span
                    >
                  </button>
                  <button
                    v-else
                    type="button"
                    class="adc-region-generate is-running"
                    @click="stopRegionCodeGeneration"
                  >
                    <i class="bi bi-stop-fill"></i>
                    <span
                      ><strong>{{ regionCodeStage }}</strong
                      ><small>点击停止生成</small></span
                    >
                  </button>
                  <div v-if="regionCode" class="adc-code-result">
                    <button type="button" title="复制代码" @click="copyRegionCode">
                      <i class="bi bi-copy"></i>
                    </button>
                    <pre><code>{{ regionCode }}</code></pre>
                  </div>
                </section>
              </Transition>

              <p v-if="copyFeedback" class="adc-copy-feedback" role="status">
                <i class="bi bi-check2"></i>{{ copyFeedback }}
              </p>

              <p v-if="assetError || regionCodeError" class="adc-region-error">
                {{ assetError || regionCodeError }}
              </p>
            </template>
            <div v-else class="adc-inspector-empty is-region-empty">
              <i class="bi bi-cursor"></i>
              <strong>点击候选区域，或手动画选区</strong>
              <span>选中后可拖动边框与控制点进行像素级校准</span>
            </div>
          </template>
          <template v-else-if="selectedNode">
            <header>
              <span>
                <small>{{ selectedNode.type.toUpperCase() }}</small>
                <input
                  class="adc-node-name"
                  :value="selectedNode.name"
                  aria-label="图层名称"
                  @input="updateSelected('name', $event.target.value)"
                />
              </span>
              <button type="button" @click="deleteSelected"><i class="bi bi-trash3"></i></button>
            </header>
            <section>
              <h3>位置与尺寸</h3>
              <div class="adc-field-grid">
                <label
                  ><span>X</span
                  ><input
                    type="number"
                    :value="selectedNode.x"
                    @input="updateSelected('x', $event.target.value)"
                /></label>
                <label
                  ><span>Y</span
                  ><input
                    type="number"
                    :value="selectedNode.y"
                    @input="updateSelected('y', $event.target.value)"
                /></label>
                <label
                  ><span>W</span
                  ><input
                    type="number"
                    :value="selectedNode.width"
                    @input="updateSelected('width', $event.target.value)"
                /></label>
                <label
                  ><span>H</span
                  ><input
                    type="number"
                    :value="selectedNode.height"
                    @input="updateSelected('height', $event.target.value)"
                /></label>
              </div>
            </section>
            <section>
              <h3>对齐与层级</h3>
              <div class="adc-align-grid">
                <button type="button" title="左对齐" @click="alignSelected('left')">
                  <i class="bi bi-align-start"></i>
                </button>
                <button type="button" title="水平居中" @click="alignSelected('center')">
                  <i class="bi bi-align-center"></i>
                </button>
                <button type="button" title="右对齐" @click="alignSelected('right')">
                  <i class="bi bi-align-end"></i>
                </button>
                <button type="button" title="顶部对齐" @click="alignSelected('top')">
                  <i class="bi bi-align-top"></i>
                </button>
                <button type="button" title="垂直居中" @click="alignSelected('middle')">
                  <i class="bi bi-align-middle"></i>
                </button>
                <button type="button" title="底部对齐" @click="alignSelected('bottom')">
                  <i class="bi bi-align-bottom"></i>
                </button>
              </div>
              <div class="adc-layer-actions">
                <button type="button" @click="duplicateSelected">
                  <i class="bi bi-copy"></i>复制
                </button>
                <button type="button" @click="moveSelectedLayer('back')">
                  <i class="bi bi-layer-backward"></i>置底
                </button>
                <button type="button" @click="moveSelectedLayer('front')">
                  <i class="bi bi-layer-forward"></i>置顶
                </button>
              </div>
            </section>
            <section>
              <h3>外观</h3>
              <label class="adc-color-field"
                ><span>填充</span
                ><input
                  type="color"
                  :value="selectedNode.fill.startsWith('#') ? selectedNode.fill : '#ffffff'"
                  @input="updateSelected('fill', $event.target.value)"
                /><code>{{ selectedNode.fill }}</code></label
              >
              <label class="adc-color-field"
                ><span>文字</span
                ><input
                  type="color"
                  :value="selectedNode.color.startsWith('#') ? selectedNode.color : '#18181f'"
                  @input="updateSelected('color', $event.target.value)"
                /><code>{{ selectedNode.color }}</code></label
              >
              <div class="adc-field-grid">
                <label
                  ><span>圆角</span
                  ><input
                    type="number"
                    :value="selectedNode.radius"
                    @input="updateSelected('radius', $event.target.value)"
                /></label>
                <label
                  ><span>描边</span
                  ><input
                    type="number"
                    :value="selectedNode.strokeWidth"
                    @input="updateSelected('strokeWidth', $event.target.value)"
                /></label>
              </div>
            </section>
            <section v-if="['text', 'button', 'input'].includes(selectedNode.type)">
              <h3>文字</h3>
              <textarea
                :value="selectedNode.text"
                @input="updateSelected('text', $event.target.value)"
              ></textarea>
              <div class="adc-field-grid">
                <label
                  ><span>字号</span
                  ><input
                    type="number"
                    :value="selectedNode.fontSize"
                    @input="updateSelected('fontSize', $event.target.value)"
                /></label>
                <label
                  ><span>字重</span
                  ><input
                    type="number"
                    step="100"
                    :value="selectedNode.fontWeight"
                    @input="updateSelected('fontWeight', $event.target.value)"
                /></label>
              </div>
            </section>
            <section v-if="selectedNode.type === 'image'">
              <h3>图片素材</h3>
              <label class="adc-asset-upload">
                <i class="bi bi-image"></i>
                <span>{{ selectedNode.src ? '替换素材' : '选择原始素材' }}</span>
                <input type="file" accept="image/*" @change="replaceSelectedAsset" />
              </label>
              <div class="adc-fit-control">
                <button
                  type="button"
                  :class="{ 'is-on': selectedNode.objectFit === 'contain' }"
                  @click="updateSelected('objectFit', 'contain')"
                >
                  完整显示
                </button>
                <button
                  type="button"
                  :class="{ 'is-on': selectedNode.objectFit === 'cover' }"
                  @click="updateSelected('objectFit', 'cover')"
                >
                  填满容器
                </button>
              </div>
            </section>
          </template>
          <div v-else class="adc-inspector-empty">
            <i class="bi bi-cursor"></i><strong>选择一个图层</strong
            ><span>查看并编辑位置、尺寸和样式</span>
          </div>
        </aside>
      </main>
    </div>
  </Teleport>
</template>

<style scoped>
.adc {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: grid;
  grid-template-rows: 54px minmax(0, 1fr);
  color: #ececf3;
  background: #111217;
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
.adc.is-region-analyzer {
  --adc-layer-width: 214px;
  --adc-inspector-width: 0px;
  inset: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  box-shadow:
    0 0 0 100vmax rgba(4, 5, 8, 0.62),
    0 28px 90px rgba(0, 0, 0, 0.48);
}
.adc.is-region-analyzer.has-region-selection {
  --adc-inspector-width: 310px;
}
.adc.is-region-analyzer.is-inspector-wide {
  --adc-inspector-width: 390px;
}
.adc.is-region-analyzer.is-layers-collapsed {
  --adc-layer-width: 0px;
}
.adc * {
  box-sizing: border-box;
}
.adc button,
.adc input,
.adc textarea {
  font: inherit;
}
.adc-topbar {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) auto minmax(200px, 1fr);
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #18191f;
}
.adc.is-region-analyzer .adc-topbar {
  grid-template-columns: minmax(0, 1fr) auto;
}
.adc-brand,
.adc-actions,
.adc-tools {
  display: flex;
  align-items: center;
}
.adc-brand {
  gap: 8px;
}
.adc-brand > span {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 7px;
  background: #6d5cff;
}
.adc-brand input {
  width: 190px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #fff;
  font-size: 0.76rem;
  font-weight: 650;
}
.adc-brand > strong {
  color: #fff;
  font-size: 0.75rem;
  font-weight: 650;
}
.adc-region-total {
  display: grid;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  place-items: center;
  border-radius: 5px;
  background: rgba(109, 92, 255, 0.14);
  color: #bdb5ff;
  font: 700 0.54rem/1 monospace;
  font-style: normal;
}
.adc-layer-toggle {
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.42);
  cursor: pointer;
}
.adc-layer-toggle:hover,
.adc-layer-toggle:focus-visible {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
  outline: 0;
}
.adc-history {
  display: flex;
  gap: 2px;
  margin-left: 2px;
}
.adc-history button {
  display: grid;
  width: 27px;
  height: 27px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.44);
  cursor: pointer;
}
.adc-history button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}
.adc-history button:disabled {
  opacity: 0.2;
  cursor: default;
}
.adc-tools {
  gap: 3px;
  padding: 3px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
}
.adc-tools button,
.adc-actions button,
.adc-canvas-toolbar button {
  display: grid;
  width: 31px;
  height: 31px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
}
.adc-tools button:hover,
.adc-tools button.is-on,
.adc-actions button:hover,
.adc-canvas-toolbar button:hover,
.adc-canvas-toolbar button.is-on {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.adc-canvas-toolbar button.is-on {
  background: rgba(91, 140, 255, 0.2);
  color: #a9c2ff;
}
.adc-canvas-toolbar button:disabled {
  opacity: 0.3;
  cursor: default;
}
.adc-actions {
  justify-content: flex-end;
  gap: 5px;
}
.adc-actions button {
  display: flex;
  width: auto;
  padding: 0 9px;
  gap: 6px;
  font-size: 0.64rem;
}
.adc-actions button.is-primary {
  background: #6d5cff;
  color: #fff;
}
.adc-actions button.is-on {
  background: rgba(109, 92, 255, 0.18);
  color: #d4cfff;
}
.adc-actions button.is-icon {
  width: 31px;
  padding: 0;
}
.adc-ai-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 5px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 0.62rem;
}
.adc-ai-status i,
.adc-stream-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7d6cff;
  box-shadow: 0 0 0 4px rgba(109, 92, 255, 0.12);
  animation: adc-pulse 1.2s ease-in-out infinite;
}
.adc-workspace {
  display: grid;
  grid-template-columns: 214px minmax(0, 1fr) 310px;
  min-width: 0;
  min-height: 0;
}
.adc.is-region-analyzer .adc-workspace {
  grid-template-columns: var(--adc-layer-width) minmax(0, 1fr) var(--adc-inspector-width);
}
.adc-layers,
.adc-inspector {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: #17181e;
}
.adc-layers {
  padding: 10px 8px;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
}
.adc.is-region-analyzer.is-layers-collapsed .adc-layers,
.adc.is-region-analyzer:not(.has-region-selection) .adc-inspector {
  padding: 0;
  overflow: hidden;
  border: 0;
}
.adc-layers > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 7px 9px;
  font-size: 0.68rem;
}
.adc-layers > header em {
  display: grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 5px;
  background: rgba(109, 92, 255, 0.18);
  color: #b8afff;
  font-size: 0.55rem;
  font-style: normal;
}
.adc-layer-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 0 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.3);
}
.adc-layer-search input {
  width: 100%;
  height: 32px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #fff;
  font-size: 0.63rem;
}
.adc-layer-list {
  display: grid;
  gap: 2px;
}
.adc-layer-list button {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 20px 20px;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  text-align: left;
  cursor: pointer;
}
.adc-layer-list.is-region-list button {
  grid-template-columns: 22px minmax(0, 1fr);
  min-height: 38px;
}
.adc-layer-list button:hover,
.adc-layer-list button.is-hovered,
.adc-layer-list button.is-on {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.adc-layer-list button.is-on {
  box-shadow: inset 2px 0 #6d5cff;
}
.adc-layer-list button.is-hidden {
  opacity: 0.42;
}
.adc-layer-list button > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.adc-layer-list strong,
.adc-layer-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adc-layer-list strong {
  font-size: 0.62rem;
}
.adc-layer-list small {
  color: rgba(255, 255, 255, 0.28);
  font-size: 0.53rem;
}
.adc-layer-list button > i:nth-last-child(-n + 2) {
  font-size: 0.6rem;
}
.adc-layer-list button.adc-source-layer {
  margin-top: 8px;
  padding-top: 9px;
  padding-bottom: 9px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 0 0 6px 6px;
}
.adc-layer-list button.adc-source-layer strong {
  color: rgba(255, 255, 255, 0.72);
}
.adc-layer-list button.adc-source-layer:disabled {
  opacity: 1;
  cursor: default;
}
.adc-layers-loading {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 50px 0;
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.61rem;
}
.adc-canvas {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background-color: #292a31;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 16px 16px;
}
.adc-canvas-toolbar {
  position: sticky;
  z-index: 10;
  top: 12px;
  left: 50%;
  display: flex;
  width: max-content;
  align-items: center;
  gap: 2px;
  margin: 12px auto 0;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(18, 19, 24, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}
.adc-canvas-toolbar span {
  min-width: 45px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.58rem;
  text-align: center;
}
.adc-artboard-frame {
  position: relative;
  margin: 48px auto;
}
.adc-artboard {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  transform-origin: top left;
  box-shadow: 0 16px 52px rgba(0, 0, 0, 0.34);
}
.adc-reference {
  position: absolute;
  z-index: 0;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}
.adc-reference :deep(.authenticated-image-media) {
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.adc-artboard.is-tracing .adc-reference {
  opacity: 1;
}
.adc-artboard.is-fidelity-view .adc-reference {
  opacity: 1;
}
.adc-node-patch {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}
.adc-artboard.is-fidelity-view .adc-node:not(.is-detached) {
  background: transparent !important;
  color: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
}
.adc-artboard.is-fidelity-view .adc-node:not(.is-detached) > img {
  opacity: 0;
}
.adc-artboard.is-fidelity-view .adc-node:not(.is-detached):hover,
.adc-artboard.is-fidelity-view .adc-node:not(.is-detached):focus-visible,
.adc-artboard.is-fidelity-view .adc-node.is-selected {
  outline: 1px solid rgba(91, 140, 255, 0.72);
}
.adc.is-region-analyzer .adc-artboard.is-fidelity-view .adc-node:hover,
.adc.is-region-analyzer .adc-artboard.is-fidelity-view .adc-node.is-hovered,
.adc.is-region-analyzer .adc-artboard.is-fidelity-view .adc-node:focus-visible {
  background: transparent !important;
  outline: 0;
}
.adc.is-region-analyzer .adc-artboard.is-fidelity-view .adc-node.is-selected {
  background: transparent !important;
  outline: 0;
}
.adc-artboard.is-tracing .adc-node:not(.is-detached) {
  outline: 1px solid rgba(109, 92, 255, 0.2);
}
.adc.is-region-analyzer .adc-artboard.is-tracing .adc-node:not(.is-detached) {
  outline: 0;
}
.adc-node {
  position: absolute;
  z-index: 2;
  overflow: hidden;
  padding: 0;
  appearance: none;
  outline: 0;
  cursor: move;
  touch-action: none;
  user-select: none;
  transition: opacity 0.16s ease;
  will-change: transform, opacity;
}
.adc.is-region-analyzer .adc-node {
  overflow: visible;
  cursor: pointer;
}
.adc.is-region-analyzer .adc-node::before {
  position: absolute;
  top: var(--region-visual-y);
  left: var(--region-visual-x);
  width: var(--region-visual-width);
  height: var(--region-visual-height);
  content: '';
  pointer-events: none;
}
.adc.is-region-analyzer .adc-artboard.is-fidelity-view .adc-node:hover::before,
.adc.is-region-analyzer .adc-artboard.is-fidelity-view .adc-node.is-hovered::before,
.adc.is-region-analyzer .adc-artboard.is-fidelity-view .adc-node:focus-visible::before {
  background: rgba(91, 140, 255, 0.12);
  outline: 1px solid rgba(91, 140, 255, 0.88);
}
.adc.is-region-analyzer .adc-artboard.is-fidelity-view .adc-node.is-selected::before {
  background: rgba(91, 140, 255, 0.16);
  outline: 2px solid #5b8cff;
  outline-offset: -1px;
}
.adc.is-region-analyzer .adc-artboard.is-tracing .adc-node::before {
  outline: 1px solid rgba(109, 92, 255, 0.2);
}
.adc.is-region-analyzer .adc-node::after {
  position: absolute;
  top: calc(var(--region-visual-y) - 22px);
  left: var(--region-visual-x);
  max-width: 180px;
  overflow: hidden;
  padding: 4px 6px;
  border-radius: 5px;
  background: #191c24;
  color: #e9edff;
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.28);
  content: attr(data-region-name);
  font-size: 9px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateY(3px);
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}
.adc.is-region-analyzer .adc-node:hover::after,
.adc.is-region-analyzer .adc-node:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}
.adc-node > img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.adc-node > span:not(.adc-selection) {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  padding: 0 12px;
  justify-content: var(--node-justify, flex-start);
  pointer-events: none;
}
.adc-node.is-text > span:not(.adc-selection) {
  align-items: flex-start;
  padding: 0;
  white-space: pre-wrap;
}
.adc-node-text[contenteditable='true'] {
  cursor: text;
  user-select: text;
  outline: 1px solid #5b8cff;
  outline-offset: 2px;
}
.adc-node.is-icon {
  display: grid;
  place-items: center;
}
.adc-node.is-selected {
  overflow: visible;
}
.adc-node.is-locked {
  cursor: not-allowed;
}
.adc-selection {
  position: absolute;
  z-index: 5;
  inset: -2px;
  border: 2px solid #5b8cff;
  pointer-events: none;
}
.adc-selection i {
  position: absolute;
  width: 7px;
  height: 7px;
  border: 1px solid #5b8cff;
  background: #fff;
  pointer-events: auto;
}
.adc-selection i:nth-child(1) {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}
.adc-selection i:nth-child(2) {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}
.adc-selection i:nth-child(3) {
  right: -5px;
  bottom: -5px;
  cursor: nwse-resize;
}
.adc-selection i:nth-child(4) {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}
.adc-ai-cursor {
  position: absolute;
  z-index: 20;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  pointer-events: none;
  will-change: transform;
}
.adc-ai-cursor > i {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border-radius: 7px 7px 7px 2px;
  background: #6d5cff;
  color: #fff;
  box-shadow: 0 6px 16px rgba(70, 54, 190, 0.32);
  font-size: 0.64rem;
}
.adc-ai-cursor > span {
  max-width: 120px;
  overflow: hidden;
  padding: 5px 7px;
  border-radius: 6px;
  background: #16141f;
  color: #fff;
  font-size: 0.54rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adc-stream-status {
  position: sticky;
  bottom: 12px;
  left: 50%;
  display: flex;
  width: max-content;
  align-items: center;
  gap: 16px;
  margin: 0 auto 12px;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(18, 19, 24, 0.92);
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.58rem;
}
.adc-stream-status span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.adc-stream-status em {
  color: rgba(255, 255, 255, 0.3);
  font-style: normal;
}
.adc-error {
  position: sticky;
  bottom: 12px;
  width: max-content;
  margin: 0 auto 12px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #442126;
  color: #ffb4b4;
  font-size: 0.62rem;
}
.adc-inspector {
  padding: 11px;
  border-left: 1px solid rgba(255, 255, 255, 0.07);
}
.adc-inspector > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 2px 12px;
}
.adc-inspector > header span {
  display: grid;
  gap: 4px;
}
.adc-inspector > header small {
  color: #9183ef;
  font-size: 0.52rem;
}
.adc-inspector > header strong {
  font-size: 0.7rem;
}
.adc-node-name {
  width: 190px;
  height: 24px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 650;
}
.adc-node-name:focus {
  box-shadow: inset 0 -1px #6d5cff;
}
.adc-inspector > header button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}
.adc-inspector section {
  margin-bottom: 8px;
  padding: 11px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
}
.adc-inspector h3 {
  margin: 0 0 9px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 0.6rem;
  font-weight: 600;
}
.adc-field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.adc-field-grid label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
}
.adc-field-grid label span {
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.55rem;
}
.adc-field-grid input {
  width: 100%;
  height: 32px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #fff;
  font-size: 0.62rem;
}
.adc-align-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}
.adc-align-grid button {
  display: grid;
  height: 30px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.48);
  cursor: pointer;
}
.adc-align-grid button:hover {
  background: rgba(109, 92, 255, 0.18);
  color: #c9c2ff;
}
.adc-layer-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 6px;
}
.adc-layer-actions button {
  display: flex;
  min-width: 0;
  height: 30px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 5px;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.46);
  font-size: 0.55rem;
  cursor: pointer;
}
.adc-layer-actions button:hover {
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
}
.adc-color-field {
  display: grid;
  grid-template-columns: 44px 24px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 6px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
}
.adc-color-field span {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.58rem;
}
.adc-color-field input {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
}
.adc-color-field code {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.57rem;
  text-overflow: ellipsis;
}
.adc-inspector textarea {
  width: 100%;
  min-height: 58px;
  margin-bottom: 7px;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  outline: 0;
  resize: vertical;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 0.62rem;
  line-height: 1.5;
}
.adc-asset-upload {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  border-radius: 6px;
  background: rgba(109, 92, 255, 0.16);
  color: #c9c2ff;
  font-size: 0.61rem;
  cursor: pointer;
}
.adc-asset-upload input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}
.adc-fit-control {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  margin-top: 7px;
}
.adc-fit-control button {
  min-height: 31px;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.42);
  font-size: 0.57rem;
  cursor: pointer;
}
.adc-fit-control button.is-on {
  background: rgba(109, 92, 255, 0.18);
  color: #c9c2ff;
}
.adc-inspector-empty {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 7px;
  min-height: 240px;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
}
.adc-inspector-empty i {
  font-size: 1rem;
}
.adc-inspector-empty strong {
  font-size: 0.68rem;
}
.adc-inspector-empty span {
  font-size: 0.57rem;
}
.adc-region-head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.adc-region-head-actions em {
  padding: 4px 7px;
  border-radius: 6px;
  background: rgba(109, 92, 255, 0.16);
  color: #bcb3ff;
  font: 700 0.55rem/1 monospace;
  font-style: normal;
}
.adc-region-head-actions button {
  display: grid;
  width: 27px;
  height: 27px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.48);
  cursor: pointer;
}
.adc-region-head-actions button:hover,
.adc-region-head-actions button:focus-visible {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  outline: 0;
}
.adc-region-preview > div {
  display: grid;
  width: 100%;
  min-height: 104px;
  max-height: 180px;
  place-items: center;
  border-radius: 7px;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%) 0 0 / 14px 14px,
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.035) 75%) 0 0 / 14px 14px,
    #101116;
  overflow: hidden;
}
.adc-region-preview img {
  display: block;
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
}
.adc-region-preview > div > span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 0.58rem;
}
.adc-region-preview p {
  margin: 8px 0 0;
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.61rem;
  line-height: 1.55;
}
.adc-region-meta dl {
  display: grid;
  gap: 5px;
  margin: 0;
}
.adc-region-meta dl > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 25px;
  padding: 0 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}
.adc-region-meta dt {
  color: rgba(255, 255, 255, 0.34);
  font-size: 0.55rem;
}
.adc-region-meta dd {
  margin: 0;
  color: rgba(255, 255, 255, 0.72);
  font: 600 0.56rem/1 monospace;
}
.adc-region-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px;
  border-radius: 7px;
  background: rgba(91, 140, 255, 0.1);
}
.adc-region-confirm > span {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
}
.adc-region-confirm > span i {
  grid-row: 1 / span 2;
  color: #8fb0ff;
  font-size: 0.78rem;
}
.adc-region-confirm strong {
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.58rem;
  font-weight: 650;
}
.adc-region-confirm small {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.5rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adc-region-confirm > button {
  height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: #5b8cff;
  color: #fff;
  font-size: 0.55rem;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
}
.adc-region-confirm.is-confirmed {
  background: rgba(65, 190, 125, 0.1);
}
.adc-region-confirm.is-confirmed i {
  color: #65d79a;
}
.adc-region-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  margin: 0 0 8px;
  padding: 3px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
}
.adc-region-tabs button {
  display: flex;
  min-width: 0;
  height: 31px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.58rem;
  cursor: pointer;
}
.adc-region-tabs button:only-child {
  grid-column: 1 / -1;
}
.adc-region-tabs button:hover,
.adc-region-tabs button:focus-visible {
  color: rgba(255, 255, 255, 0.72);
  outline: 0;
}
.adc-region-tabs button.is-on {
  background: rgba(255, 255, 255, 0.075);
  color: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
.adc-region-assets {
  display: grid;
  gap: 6px;
}
.adc-region-assets h3 {
  margin-bottom: 3px;
}
.adc-asset-mode {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.035);
}
.adc-asset-mode button {
  height: 28px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.55rem;
  cursor: pointer;
}
.adc-asset-mode button.is-on {
  background: rgba(109, 92, 255, 0.2);
  color: #d8d3ff;
}
.adc-asset-approved {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 7px 8px;
  border-radius: 7px;
  background: rgba(65, 190, 125, 0.09);
  color: #8ee1b5;
  font-size: 0.54rem;
  line-height: 1.4;
}
.adc-region-assets > button,
.adc-region-generate {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 5px 9px;
  border: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.055);
  color: rgba(255, 255, 255, 0.72);
  text-align: left;
  cursor: pointer;
}
.adc-region-assets > button.is-primary {
  background: rgba(109, 92, 255, 0.2);
  color: #d5d0ff;
}
.adc-region-assets > button:disabled {
  opacity: 0.42;
  cursor: wait;
}
.adc-region-assets > button.adc-asset-stop {
  background: rgba(255, 92, 92, 0.1);
  color: #ffb0b0;
}
.adc-region-assets > button > i,
.adc-region-generate > i {
  font-size: 0.85rem;
  text-align: center;
}
.adc-region-assets > button > span,
.adc-region-generate > span {
  display: grid;
  gap: 3px;
}
.adc-region-assets strong,
.adc-region-generate strong {
  font-size: 0.62rem;
}
.adc-region-assets small,
.adc-region-generate small {
  color: rgba(255, 255, 255, 0.34);
  font-size: 0.53rem;
}
.adc-asset-result {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
}
.adc-asset-result > span {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.adc-asset-result > span strong,
.adc-asset-result > span small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adc-asset-result > div:last-child {
  display: flex;
  gap: 3px;
}
.adc-asset-result > div:last-child button {
  display: grid;
  width: 27px;
  height: 27px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
}
.adc-asset-result > div:last-child button:disabled {
  opacity: 0.32;
  cursor: wait;
}
.adc-asset-preview {
  display: grid;
  width: 62px;
  height: 52px;
  place-items: center;
  border-radius: 6px;
  background: #0f1015;
  overflow: hidden;
}
.adc-asset-preview.is-transparent,
.adc-asset-preview.is-svg {
  background-color: #f3f4f6;
  background-image:
    linear-gradient(45deg, #d8dbe1 25%, transparent 25%),
    linear-gradient(-45deg, #d8dbe1 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d8dbe1 75%),
    linear-gradient(-45deg, transparent 75%, #d8dbe1 75%);
  background-position:
    0 0,
    0 6px,
    6px -6px,
    -6px 0;
  background-size: 12px 12px;
}
.adc-asset-preview img,
.adc-asset-preview :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.adc-asset-approval {
  display: grid;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(109, 92, 255, 0.08);
}
.adc-asset-approval label {
  display: grid;
  gap: 5px;
}
.adc-asset-approval label > span {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.54rem;
}
.adc-asset-approval textarea {
  min-height: 68px;
  margin: 0;
  resize: vertical;
  background: rgba(5, 6, 9, 0.32);
  line-height: 1.55;
}
.adc-asset-approval > button {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  border-radius: 6px;
  background: #6d5cff;
  color: #fff;
  font-size: 0.58rem;
  font-weight: 650;
  cursor: pointer;
}
.adc-asset-approval > button:disabled {
  opacity: 0.45;
  cursor: wait;
}
.adc-asset-approval > small {
  color: rgba(255, 255, 255, 0.32);
  font-size: 0.5rem;
  line-height: 1.45;
  text-align: center;
}
.adc-library-summary,
.adc-website-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.adc-library-summary > span {
  display: grid;
  gap: 3px;
}
.adc-library-summary strong {
  color: #fff;
  font-size: 0.86rem;
}
.adc-library-summary small,
.adc-website-summary > span {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.55rem;
  line-height: 1.5;
}
.adc-library-summary > i {
  color: #75dba5;
  font-size: 1rem;
}
.adc-library-list {
  display: grid;
  gap: 6px;
}
.adc-library-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}
.adc-library-item > button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.adc-library-item > button:first-child {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0;
  text-align: left;
}
.adc-library-item > button:first-child > span:last-child {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.adc-library-item strong,
.adc-library-item small,
.adc-library-item em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adc-library-item strong {
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.61rem;
}
.adc-library-item small {
  color: #a9a0ee;
  font-size: 0.5rem;
}
.adc-library-item em {
  color: rgba(255, 255, 255, 0.34);
  font-size: 0.51rem;
  font-style: normal;
}
.adc-library-item > button:last-child {
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.35);
}
.adc-library-item > button:last-child:hover {
  background: rgba(255, 92, 92, 0.1);
  color: #ffaaaa;
}
.adc-library-thumb {
  display: grid;
  width: 64px;
  height: 54px;
  place-items: center;
  border-radius: 6px;
  background: #0f1015;
  overflow: hidden;
}
.adc-library-thumb.is-transparent {
  background-color: #f3f4f6;
  background-image:
    linear-gradient(45deg, #d8dbe1 25%, transparent 25%),
    linear-gradient(-45deg, #d8dbe1 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d8dbe1 75%),
    linear-gradient(-45deg, transparent 75%, #d8dbe1 75%);
  background-position:
    0 0,
    0 6px,
    6px -6px,
    -6px 0;
  background-size: 12px 12px;
}
.adc-library-thumb :deep(.authenticated-image),
.adc-library-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.adc-website-summary {
  display: grid;
  justify-content: stretch;
}
.adc-website-summary > strong {
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.67rem;
}
.adc-website-summary > button {
  display: flex;
  min-height: 35px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  border-radius: 7px;
  background: #6d5cff;
  color: #fff;
  font-size: 0.59rem;
  font-weight: 650;
  cursor: pointer;
}
.adc-website-summary > button:disabled {
  opacity: 0.36;
  cursor: default;
}
.adc-website-summary > button.is-stop {
  background: rgba(255, 92, 92, 0.12);
  color: #ffb0b0;
}
.adc-website-result > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}
.adc-website-result > div > strong {
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.58rem;
}
.adc-website-result > div > span {
  display: flex;
  gap: 3px;
}
.adc-website-result button {
  display: grid;
  width: 27px;
  height: 27px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.58);
  cursor: pointer;
}
.adc-website-result iframe {
  display: block;
  width: 100%;
  height: 300px;
  border: 0;
  border-radius: 7px;
  background: #fff;
}
.adc-region-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.adc-region-code-head h3 {
  margin: 0;
}
.adc-region-code-head > div {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}
.adc-region-code-head button {
  min-width: 40px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.53rem;
  cursor: pointer;
}
.adc-region-code-head button.is-on {
  background: rgba(109, 92, 255, 0.2);
  color: #c9c2ff;
}
.adc-region-generate {
  width: 100%;
}
.adc-region-generate:disabled {
  opacity: 0.42;
  cursor: wait;
}
.adc-region-generate.is-running {
  background: rgba(255, 111, 111, 0.1);
  color: #ffb0b0;
}
.adc-code-result {
  position: relative;
  margin-top: 8px;
  border-radius: 7px;
  background: #0e0f13;
  overflow: hidden;
}
.adc-code-result > button {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  display: grid;
  width: 25px;
  height: 25px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
}
.adc-code-result pre {
  max-height: 260px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  color: #cbd5e1;
  font: 500 0.56rem/1.55 monospace;
  white-space: pre-wrap;
}
.adc-region-error {
  margin: 0 0 8px;
  padding: 8px;
  border-radius: 7px;
  background: rgba(255, 88, 88, 0.1);
  color: #ffaaaa;
  font-size: 0.58rem;
}
.adc-copy-feedback {
  position: sticky;
  z-index: 4;
  bottom: 4px;
  display: flex;
  width: max-content;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  margin: 8px auto 0;
  padding: 7px 10px;
  border: 1px solid rgba(125, 225, 176, 0.18);
  border-radius: 7px;
  background: rgba(17, 46, 34, 0.96);
  color: #a8efc9;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  font-size: 0.58rem;
}
.adc-inspector-panel-enter-active,
.adc-inspector-panel-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}
.adc-inspector-panel-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.adc-inspector-panel-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
.adc-inspector-empty.is-region-empty {
  min-height: 360px;
  padding: 20px;
}
@keyframes adc-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
.adc .spin {
  animation: adc-spin 0.8s linear infinite;
}
@keyframes adc-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .adc-ai-status i,
  .adc-stream-status i {
    animation: none;
  }
}
</style>
