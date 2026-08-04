<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  fetchAuthenticatedMediaBlob,
  getCachedAuthenticatedMediaBlob,
} from '@/services/authenticatedMedia'

const props = defineProps({
  open: { type: Boolean, default: false },
  sourceUrl: { type: String, default: '' },
  sourceTitle: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  submitted: { type: Boolean, default: false },
  costPending: { type: Boolean, default: false },
  costLabel: { type: String, default: '' },
  resultUrl: { type: String, default: '' },
  resultStatus: { type: String, default: '' },
  resultError: { type: String, default: '' },
  light: { type: Boolean, default: false },
  embedded: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'submit'])

const QUICK_PROMPTS = [
  { label: '移除内容', text: '移除选中区域的内容，并自然补全背景' },
  { label: '替换为…', text: '把选中区域替换为：' },
  { label: '重绘细节', text: '在保持构图与光影不变的前提下重绘选中区域，让细节更清晰' },
  { label: '更换颜色', text: '把选中区域改为新的颜色，保持材质、纹理和光影不变' },
]
const MAX_MASK_WORK_EDGE = 1600

const IS_MAC = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
const MOD_KEY_LABEL = IS_MAC ? '⌘' : 'Ctrl'

const canvasRef = ref(null)
const stageViewportRef = ref(null)
const textareaRef = ref(null)
const objectUrl = ref('')
const sourceBlob = ref(null)
const resultObjectUrl = ref('')
const loading = ref(false)
const resultLoading = ref(false)
const resultLoadError = ref('')
const error = ref('')
const editPrompt = ref('')
const brushSize = ref(100)
const brushMode = ref('paint')
const maskVisible = ref(true)
const sourceWidth = ref(0)
const sourceHeight = ref(0)
const workingWidth = ref(0)
const workingHeight = ref(0)
const strokes = ref([])
const redoStrokes = ref([])
const maskCoverage = ref(0)
const drawing = ref(false)
const cursor = ref({ visible: false, x: 0, y: 0, size: 0 })
const zoom = ref(1)
const comparisonEnabled = ref(false)
const comparisonPosition = ref(50)
const panelCollapsed = ref(false)
const viewportWidth = ref(0)
const viewportHeight = ref(0)
const fitWidth = ref(0)
const fitHeight = ref(0)
let activeStroke = null
let loadSequence = 0
let resultLoadSequence = 0
let maskWorkCanvas = null
let coverageCanvas = null
let previousBodyOverflow = ''

const artboardStyle = computed(() => ({
  width: fitWidth.value ? `${fitWidth.value * zoom.value}px` : 'min(72vw, 860px)',
  height: fitHeight.value ? `${fitHeight.value * zoom.value}px` : 'min(72vh, 640px)',
  aspectRatio:
    sourceWidth.value > 0 && sourceHeight.value > 0
      ? `${sourceWidth.value} / ${sourceHeight.value}`
      : '1 / 1',
}))
const viewportContentStyle = computed(() => ({
  width: `${Math.max(viewportWidth.value, fitWidth.value * zoom.value + 64)}px`,
  height: `${Math.max(viewportHeight.value, fitHeight.value * zoom.value + 64)}px`,
}))
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
const canZoomOut = computed(() => zoom.value > 0.5)
const canZoomIn = computed(() => zoom.value < 3)
const resultReady = computed(() => Boolean(resultObjectUrl.value))
const resultFailed = computed(() =>
  ['failed', 'cancelled', 'canceled'].includes(props.resultStatus),
)
const showGenerationComparison = computed(() => props.busy || props.submitted)
const resultPendingLabel = computed(() =>
  props.busy
    ? '正在提交局部编辑…'
    : resultLoading.value
      ? '正在加载编辑结果…'
      : '正在生成编辑结果…',
)
const resultComparisonStyle = computed(() => ({
  clipPath: `inset(0 0 0 ${comparisonPosition.value}%)`,
}))
const comparisonDividerStyle = computed(() => ({ left: `${comparisonPosition.value}%` }))
const hasMask = computed(() => maskCoverage.value > 0)
const coverageLabel = computed(() => {
  if (!hasMask.value) return ''
  const percent = maskCoverage.value * 100
  return percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`
})
const sourceSizeLabel = computed(() =>
  sourceWidth.value > 0 && sourceHeight.value > 0
    ? `${sourceWidth.value}×${sourceHeight.value}`
    : '',
)
const cursorStyle = computed(() => ({
  left: `${cursor.value.x}px`,
  top: `${cursor.value.y}px`,
  width: `${cursor.value.size}px`,
  height: `${cursor.value.size}px`,
}))
const submitHint = computed(() => {
  if (props.submitted) return '局部编辑任务已提交'
  if (props.busy) return '正在提交局部编辑…'
  if (props.costPending) return '正在读取本次局部编辑费用…'
  if (loading.value || !objectUrl.value) return '等待原图加载完成'
  if (!hasMask.value) return '请先在图片上涂抹需要修改的区域'
  if (!editPrompt.value.trim()) return '请填写修改要求'
  return `生成局部编辑结果（${MOD_KEY_LABEL}Enter）`
})
const shortcutTip = computed(
  () => `B 涂抹 · E 擦除 · [ ] 画笔 · + - 缩放 · 0 适应 · ${MOD_KEY_LABEL}Z 撤销`,
)

watch(
  () => [props.open, props.sourceUrl],
  ([open]) => {
    if (open) {
      if (!props.embedded) lockBodyScroll()
      void loadSource()
    } else {
      if (!props.embedded) unlockBodyScroll()
      resetEditor()
    }
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', handleKeydown, true)
      window.addEventListener('resize', handleViewportResize)
      void nextTick(updateFitSize)
    } else {
      window.removeEventListener('keydown', handleKeydown, true)
      window.removeEventListener('resize', handleViewportResize)
    }
  },
  { immediate: true },
)

watch(
  () => [props.open, props.resultUrl],
  ([open, resultUrl]) => {
    if (open && resultUrl) void loadResult(resultUrl)
    else releaseResultObjectUrl()
  },
  { immediate: true },
)

watch(panelCollapsed, () => {
  if (!props.open || !props.embedded) return
  void nextTick(() => {
    updateFitSize()
    centerViewport()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('resize', handleViewportResize)
  if (!props.embedded) unlockBodyScroll()
  releaseObjectUrl()
  releaseResultObjectUrl()
})

function lockBodyScroll() {
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  if (document.body.style.overflow === 'hidden') {
    document.body.style.overflow = previousBodyOverflow
  }
  previousBodyOverflow = ''
}

function releaseObjectUrl() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = ''
}

function releaseResultObjectUrl() {
  resultLoadSequence += 1
  if (resultObjectUrl.value) URL.revokeObjectURL(resultObjectUrl.value)
  resultObjectUrl.value = ''
  resultLoading.value = false
  resultLoadError.value = ''
  comparisonEnabled.value = false
}

function resetEditor() {
  loadSequence += 1
  releaseObjectUrl()
  releaseResultObjectUrl()
  sourceBlob.value = null
  if (canvasRef.value) {
    canvasRef.value.width = 1
    canvasRef.value.height = 1
  }
  if (maskWorkCanvas) {
    maskWorkCanvas.width = 1
    maskWorkCanvas.height = 1
  }
  if (coverageCanvas) {
    coverageCanvas.width = 1
    coverageCanvas.height = 1
  }
  loading.value = false
  error.value = ''
  editPrompt.value = ''
  strokes.value = []
  redoStrokes.value = []
  maskCoverage.value = 0
  maskVisible.value = true
  sourceWidth.value = 0
  sourceHeight.value = 0
  workingWidth.value = 0
  workingHeight.value = 0
  drawing.value = false
  cursor.value = { visible: false, x: 0, y: 0, size: 0 }
  zoom.value = 1
  comparisonEnabled.value = false
  comparisonPosition.value = 50
  panelCollapsed.value = false
  viewportWidth.value = 0
  viewportHeight.value = 0
  fitWidth.value = 0
  fitHeight.value = 0
  activeStroke = null
  maskWorkCanvas = null
  coverageCanvas = null
}

async function loadSource() {
  const sequence = ++loadSequence
  releaseObjectUrl()
  loading.value = true
  error.value = ''
  strokes.value = []
  redoStrokes.value = []
  maskCoverage.value = 0
  try {
    if (!props.sourceUrl) throw new Error('当前图片地址不可用')
    const blob =
      getCachedAuthenticatedMediaBlob(props.sourceUrl) ||
      (await fetchAuthenticatedMediaBlob(props.sourceUrl, { cache: 'default' }))
    if (sequence !== loadSequence) return
    const url = URL.createObjectURL(blob)
    const image = await loadImage(url)
    if (sequence !== loadSequence) {
      URL.revokeObjectURL(url)
      return
    }
    objectUrl.value = url
    sourceBlob.value = blob
    sourceWidth.value = image.naturalWidth
    sourceHeight.value = image.naturalHeight
    const workScale = Math.min(
      1,
      MAX_MASK_WORK_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
    )
    workingWidth.value = Math.max(1, Math.round(image.naturalWidth * workScale))
    workingHeight.value = Math.max(1, Math.round(image.naturalHeight * workScale))
    await nextTick()
    prepareCanvas()
    updateFitSize()
    resetView()
    focusPromptIfDesktop()
  } catch (caught) {
    if (sequence === loadSequence) error.value = caught?.message || '原图加载失败'
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

async function loadResult(url) {
  const sequence = ++resultLoadSequence
  if (resultObjectUrl.value) URL.revokeObjectURL(resultObjectUrl.value)
  resultObjectUrl.value = ''
  resultLoading.value = true
  resultLoadError.value = ''
  comparisonEnabled.value = false
  try {
    const blob = await fetchAuthenticatedMediaBlob(url, { cache: 'no-store' })
    if (sequence !== resultLoadSequence) return
    const objectUrl = URL.createObjectURL(blob)
    await loadImage(objectUrl)
    if (sequence !== resultLoadSequence) {
      URL.revokeObjectURL(objectUrl)
      return
    }
    resultObjectUrl.value = objectUrl
  } catch (caught) {
    if (sequence === resultLoadSequence) {
      resultLoadError.value = caught?.message || '编辑结果加载失败'
    }
  } finally {
    if (sequence === resultLoadSequence) resultLoading.value = false
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法读取当前图片'))
    image.src = url
  })
}

function focusPromptIfDesktop() {
  if (window.matchMedia?.('(pointer: fine)')?.matches) textareaRef.value?.focus?.()
}

function prepareCanvas() {
  const canvas = canvasRef.value
  if (!canvas || !workingWidth.value || !workingHeight.value) return
  canvas.width = workingWidth.value
  canvas.height = workingHeight.value
  maskWorkCanvas = null
  renderMaskPreview()
}

function handleViewportResize() {
  updateFitSize()
  void nextTick(centerViewport)
}

function updateFitSize() {
  const viewport = stageViewportRef.value
  if (!viewport || !sourceWidth.value || !sourceHeight.value) return
  const rect = viewport.getBoundingClientRect()
  const viewportInset = props.embedded ? 0 : 64
  const verticalChromeReserve = props.embedded ? 96 : viewportInset
  const panelReserve =
    props.embedded &&
    !panelCollapsed.value &&
    !showGenerationComparison.value &&
    window.matchMedia?.('(min-width: 861px)')?.matches
      ? 352
      : 0
  const availableWidth = Math.max(1, rect.width - viewportInset - panelReserve)
  const availableHeight = Math.max(1, rect.height - verticalChromeReserve)
  const scale = Math.min(availableWidth / sourceWidth.value, availableHeight / sourceHeight.value)
  viewportWidth.value = rect.width
  viewportHeight.value = rect.height
  fitWidth.value = Math.max(1, Math.round(sourceWidth.value * scale))
  fitHeight.value = Math.max(1, Math.round(sourceHeight.value * scale))
}

function centerViewport() {
  const viewport = stageViewportRef.value
  if (!viewport) return
  viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
  viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
}

function setZoom(nextZoom) {
  const next = Math.min(3, Math.max(0.5, Math.round(Number(nextZoom) * 100) / 100))
  if (next === zoom.value) return
  const viewport = stageViewportRef.value
  const oldWidth = fitWidth.value * zoom.value
  const oldHeight = fitHeight.value * zoom.value
  zoom.value = next
  void nextTick(() => {
    if (!viewport) return
    const nextWidth = fitWidth.value * zoom.value
    const nextHeight = fitHeight.value * zoom.value
    viewport.scrollLeft += (nextWidth - oldWidth) / 2
    viewport.scrollTop += (nextHeight - oldHeight) / 2
  })
}

function resetView() {
  zoom.value = 1
  comparisonEnabled.value = false
  void nextTick(centerViewport)
}

function handleZoomWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  setZoom(zoom.value + (event.deltaY < 0 ? 0.1 : -0.1))
}

function toggleResultComparison() {
  if (!resultObjectUrl.value) return
  comparisonEnabled.value = !comparisonEnabled.value
  comparisonPosition.value = 50
  cursor.value = { ...cursor.value, visible: false }
}

function ensureMaskWorkCanvas() {
  if (
    !maskWorkCanvas ||
    maskWorkCanvas.width !== workingWidth.value ||
    maskWorkCanvas.height !== workingHeight.value
  ) {
    maskWorkCanvas = document.createElement('canvas')
    maskWorkCanvas.width = Math.max(1, workingWidth.value)
    maskWorkCanvas.height = Math.max(1, workingHeight.value)
  }
  return maskWorkCanvas
}

function canvasPoint(event) {
  const canvas = canvasRef.value
  const rect = canvas?.getBoundingClientRect?.()
  if (!canvas || !rect?.width || !rect?.height) return null
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  }
}

function trackCursor(event) {
  const canvas = canvasRef.value
  const rect = canvas?.getBoundingClientRect?.()
  const board = event.currentTarget?.getBoundingClientRect?.()
  if (!canvas?.width || !rect?.width || !board) return
  const displayScale = rect.width / canvas.width
  cursor.value = {
    visible: true,
    x: event.clientX - board.left,
    y: event.clientY - board.top,
    size: Math.max(8, brushSize.value * displayScale),
  }
}

function hideCursor() {
  if (!drawing.value) cursor.value = { ...cursor.value, visible: false }
}

function beginStroke(event) {
  if (props.busy || props.submitted || props.costPending || loading.value || !objectUrl.value) {
    return
  }
  const point = canvasPoint(event)
  if (!point) return
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  drawing.value = true
  maskVisible.value = true
  redoStrokes.value = []
  const invertMode = Boolean(event.altKey)
  const baseMode = brushMode.value
  activeStroke = {
    mode: invertMode ? (baseMode === 'paint' ? 'erase' : 'paint') : baseMode,
    size: Number(brushSize.value),
    points: [point],
  }
  strokes.value = [...strokes.value, activeStroke]
  drawStrokeIncrement(activeStroke, point, point)
}

function extendStroke(event) {
  if (!drawing.value || !activeStroke) return
  const point = canvasPoint(event)
  if (!point) return
  const previous = activeStroke.points.at(-1)
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return
  activeStroke.points.push(point)
  drawStrokeIncrement(activeStroke, previous || point, point)
}

function endStroke(event) {
  event?.currentTarget?.releasePointerCapture?.(event.pointerId)
  if (!drawing.value) return
  drawing.value = false
  activeStroke = null
  updateMaskCoverage()
}

function drawStrokeSegment(context, from, to, size) {
  if (from.x === to.x && from.y === to.y) {
    context.beginPath()
    context.arc(to.x, to.y, size / 2, 0, Math.PI * 2)
    context.fill()
    return
  }
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
}

function configureStrokeContext(context, stroke, scale, variant) {
  const painting = stroke.mode === 'paint'
  context.globalCompositeOperation = painting ? 'source-over' : 'destination-out'
  if (variant === 'mask') {
    context.globalCompositeOperation = painting ? 'destination-out' : 'source-over'
    context.strokeStyle = '#fff'
  } else if (variant === 'preview') {
    context.strokeStyle = 'rgba(139, 123, 255, 0.52)'
  } else {
    context.strokeStyle = '#000'
  }
  context.fillStyle = context.strokeStyle
  context.lineWidth = Math.max(1, stroke.size * scale)
  context.lineCap = 'round'
  context.lineJoin = 'round'
}

function replayStrokes(context, scale = 1, variant = 'preview') {
  for (const stroke of strokes.value) {
    context.save()
    configureStrokeContext(context, stroke, scale, variant)
    const points = stroke.points || []
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const previous = points[index - 1] || point
      drawStrokeSegment(
        context,
        { x: previous.x * scale, y: previous.y * scale },
        { x: point.x * scale, y: point.y * scale },
        Math.max(1, stroke.size * scale),
      )
    }
    context.restore()
  }
}

function drawStrokeIncrement(stroke, from, to) {
  const previewContext = canvasRef.value?.getContext?.('2d')
  const workContext = ensureMaskWorkCanvas().getContext('2d')
  if (!previewContext || !workContext) return
  for (const [context, variant] of [
    [workContext, 'coverage'],
    [previewContext, 'preview'],
  ]) {
    context.save()
    configureStrokeContext(context, stroke, 1, variant)
    drawStrokeSegment(context, from, to, Math.max(1, stroke.size))
    context.restore()
  }
}

function renderMaskPreview() {
  const canvas = canvasRef.value
  const context = canvas?.getContext?.('2d')
  if (!canvas || !context) return
  const work = ensureMaskWorkCanvas()
  const workContext = work.getContext('2d')
  if (!workContext) return
  workContext.clearRect(0, 0, work.width, work.height)
  context.clearRect(0, 0, canvas.width, canvas.height)
  replayStrokes(workContext, 1, 'coverage')
  replayStrokes(context, 1, 'preview')
}

function updateMaskCoverage() {
  const work = maskWorkCanvas
  if (!work || !strokes.value.length) {
    maskCoverage.value = 0
    return
  }
  const sampleWidth = 128
  const sampleHeight = Math.max(1, Math.round((sampleWidth * work.height) / work.width))
  if (
    !coverageCanvas ||
    coverageCanvas.width !== sampleWidth ||
    coverageCanvas.height !== sampleHeight
  ) {
    coverageCanvas = document.createElement('canvas')
    coverageCanvas.width = sampleWidth
    coverageCanvas.height = sampleHeight
  }
  const context = coverageCanvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  context.clearRect(0, 0, sampleWidth, sampleHeight)
  context.drawImage(work, 0, 0, sampleWidth, sampleHeight)
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data
  let covered = 0
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 16) covered += 1
  }
  maskCoverage.value = covered / (sampleWidth * sampleHeight)
}

function undoStroke() {
  if (!strokes.value.length || props.busy || props.submitted) return
  const stroke = strokes.value.at(-1)
  strokes.value = strokes.value.slice(0, -1)
  redoStrokes.value = [...redoStrokes.value, stroke]
  renderMaskPreview()
  updateMaskCoverage()
}

function redoStroke() {
  if (!redoStrokes.value.length || props.busy || props.submitted) return
  const stroke = redoStrokes.value.at(-1)
  redoStrokes.value = redoStrokes.value.slice(0, -1)
  strokes.value = [...strokes.value, stroke]
  renderMaskPreview()
  updateMaskCoverage()
}

function clearMask() {
  if (props.busy || props.submitted || !strokes.value.length) return
  redoStrokes.value = [...redoStrokes.value, ...strokes.value.slice().reverse()]
  strokes.value = []
  renderMaskPreview()
  updateMaskCoverage()
}

function adjustBrushSize(delta) {
  brushSize.value = Math.min(160, Math.max(12, Number(brushSize.value) + delta))
}

function applyQuickPrompt(text) {
  if (props.busy || props.submitted) return
  const current = editPrompt.value.trim()
  if (!current) editPrompt.value = text
  else if (!current.includes(text)) editPrompt.value = `${current}\n${text}`
  textareaRef.value?.focus?.()
}

function handleKeydown(event) {
  if (!props.open) return
  const target = event.target
  const editable =
    target &&
    (target.tagName === 'TEXTAREA' ||
      target.tagName === 'INPUT' ||
      target.isContentEditable === true)
  const modifier = event.metaKey || event.ctrlKey
  if (modifier && event.key === 'Enter') {
    event.preventDefault()
    void submitEdit()
    return
  }
  if (editable) return
  if (modifier && (event.key === 'z' || event.key === 'Z')) {
    event.preventDefault()
    if (event.shiftKey) redoStroke()
    else undoStroke()
    return
  }
  if (modifier && (event.key === 'y' || event.key === 'Y')) {
    event.preventDefault()
    redoStroke()
    return
  }
  if (!modifier && (event.key === '+' || event.key === '=')) {
    event.preventDefault()
    setZoom(zoom.value + 0.25)
    return
  }
  if (!modifier && (event.key === '-' || event.key === '_')) {
    event.preventDefault()
    setZoom(zoom.value - 0.25)
    return
  }
  if (!modifier && event.key === '0') {
    event.preventDefault()
    resetView()
    return
  }
  if (modifier) return
  if (event.key === 'b' || event.key === 'B') brushMode.value = 'paint'
  else if (event.key === 'e' || event.key === 'E') brushMode.value = 'erase'
  else if (event.key === '[') adjustBrushSize(-8)
  else if (event.key === ']') adjustBrushSize(8)
}

async function submitEdit() {
  if (props.busy || props.submitted || loading.value || !objectUrl.value) return
  const prompt = editPrompt.value.trim()
  if (!prompt) {
    error.value = '请描述蒙版区域需要修改成什么'
    textareaRef.value?.focus?.()
    return
  }
  if (!hasMask.value) {
    error.value = '请先在图片上涂抹需要修改的区域'
    return
  }
  error.value = ''
  try {
    const maskFile = await buildMaskFile()
    emit('submit', {
      prompt,
      maskFile,
      sourceBlob: sourceBlob.value,
      width: sourceWidth.value,
      height: sourceHeight.value,
    })
  } catch (caught) {
    error.value = caught?.message || '蒙版生成失败'
  }
}

async function buildMaskFile() {
  const canvas = document.createElement('canvas')
  canvas.width = sourceWidth.value
  canvas.height = sourceHeight.value
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('当前浏览器无法创建蒙版')
  // Match the canvas editor contract: opaque white means keep, transparent means edit.
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const scale = canvas.width / Math.max(1, workingWidth.value)
  replayStrokes(context, scale, 'mask')
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = 1
  canvas.height = 1
  if (!blob) throw new Error('蒙版 PNG 生成失败')
  return new File([blob], `local-edit-mask-${Date.now()}.png`, { type: 'image/png' })
}
</script>

<template>
  <Teleport to="body" :disabled="embedded">
    <Transition name="local-mask-dialog" appear>
      <div
        v-if="open"
        class="local-mask-backdrop"
        :class="{ 'is-embedded': embedded }"
        @click.self="emit('close')"
      >
        <section
          class="local-mask-dialog"
          :class="{ 'is-light': light, 'is-embedded': embedded }"
          :role="embedded ? 'region' : 'dialog'"
          :aria-modal="embedded ? undefined : 'true'"
          aria-label="局部编辑"
        >
          <header class="local-mask-header">
            <div class="local-mask-heading">
              <span class="local-mask-heading-icon" aria-hidden="true">
                <i class="bi bi-bounding-box-circles"></i>
              </span>
              <div>
                <strong>局部编辑</strong>
                <small>{{ sourceTitle || '未命名图片' }}</small>
              </div>
            </div>
            <div class="local-mask-header-meta">
              <span v-if="sourceSizeLabel" class="local-mask-source-size">
                <i class="bi bi-aspect-ratio" aria-hidden="true"></i>{{ sourceSizeLabel }}
              </span>
              <span v-if="coverageLabel" class="local-mask-header-coverage">
                已选择 {{ coverageLabel }}
              </span>
            </div>
            <button
              type="button"
              class="local-mask-close"
              aria-label="关闭局部编辑"
              @click="emit('close')"
            >
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div
            class="local-mask-workspace"
            :class="{
              'is-generation': showGenerationComparison,
              'is-panel-collapsed': panelCollapsed,
            }"
          >
            <button
              v-if="embedded"
              type="button"
              class="local-mask-inline-close"
              title="退出局部编辑"
              aria-label="退出局部编辑，返回全屏预览"
              @click="emit('close')"
            >
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
            <button
              v-if="embedded && panelCollapsed && !showGenerationComparison"
              type="button"
              class="local-mask-panel-reopen"
              title="显示编辑要求面板"
              aria-label="显示编辑要求面板"
              @click="panelCollapsed = false"
            >
              <i class="bi bi-layout-sidebar-inset-reverse" aria-hidden="true"></i>
              <span>编辑要求</span>
            </button>
            <div class="local-mask-stage">
              <div
                class="local-mask-toolbar"
                role="toolbar"
                aria-label="蒙版工具"
                @pointermove.stop
                @pointerenter.stop="hideCursor"
              >
                <div class="local-mask-seg" role="group">
                  <button
                    type="button"
                    :class="{ 'is-on': brushMode === 'paint' }"
                    :aria-pressed="brushMode === 'paint'"
                    :disabled="busy || submitted"
                    title="涂抹区域（B）"
                    @click="brushMode = 'paint'"
                  >
                    <i class="bi bi-brush"></i><span>画笔</span>
                  </button>
                  <button
                    type="button"
                    :class="{ 'is-on': brushMode === 'erase' }"
                    :aria-pressed="brushMode === 'erase'"
                    :disabled="busy || submitted"
                    title="擦除蒙版（E）"
                    @click="brushMode = 'erase'"
                  >
                    <i class="bi bi-eraser"></i><span>擦除</span>
                  </button>
                </div>
                <i class="local-mask-divider" aria-hidden="true"></i>
                <div class="local-mask-sizer" title="画笔大小（[ 缩小 / ] 放大）">
                  <i class="bi bi-circle-fill is-min" aria-hidden="true"></i>
                  <input
                    v-model.number="brushSize"
                    type="range"
                    min="12"
                    max="160"
                    step="2"
                    :disabled="busy || submitted"
                    aria-label="画笔大小"
                  />
                  <output>{{ brushSize }} px</output>
                </div>
                <i class="local-mask-divider" aria-hidden="true"></i>
                <div class="local-mask-icons" role="group" aria-label="蒙版历史">
                  <button
                    type="button"
                    :disabled="!strokes.length || busy"
                    aria-label="撤销蒙版"
                    :title="`撤销（${MOD_KEY_LABEL}Z）`"
                    @click="undoStroke"
                  >
                    <i class="bi bi-arrow-counterclockwise"></i>
                  </button>
                  <button
                    type="button"
                    :disabled="!redoStrokes.length || busy"
                    aria-label="重做蒙版"
                    :title="`重做（${MOD_KEY_LABEL}⇧Z）`"
                    @click="redoStroke"
                  >
                    <i class="bi bi-arrow-clockwise"></i>
                  </button>
                  <button
                    type="button"
                    :disabled="!strokes.length || busy || submitted"
                    aria-label="重置蒙版"
                    title="重置蒙版"
                    @click="clearMask"
                  >
                    <i class="bi bi-arrow-repeat"></i>
                  </button>
                </div>
                <span class="local-mask-toolbar-spacer"></span>
                <div class="local-mask-view-tools" role="group" aria-label="视图控制">
                  <button
                    type="button"
                    :disabled="!canZoomOut"
                    aria-label="缩小画布"
                    title="缩小（-）"
                    @click="setZoom(zoom - 0.25)"
                  >
                    <i class="bi bi-zoom-out"></i>
                  </button>
                  <output>{{ zoomLabel }}</output>
                  <button
                    type="button"
                    :disabled="!canZoomIn"
                    aria-label="放大画布"
                    title="放大（+）"
                    @click="setZoom(zoom + 0.25)"
                  >
                    <i class="bi bi-zoom-in"></i>
                  </button>
                  <button
                    type="button"
                    aria-label="适应画布"
                    title="适应画布（0）"
                    @click="resetView"
                  >
                    <i class="bi bi-arrows-fullscreen"></i>
                  </button>
                  <i class="local-mask-divider" aria-hidden="true"></i>
                  <button
                    type="button"
                    class="local-mask-compare"
                    :class="{ 'is-on': comparisonEnabled }"
                    :disabled="!resultReady"
                    :title="resultReady ? '对比原图与编辑结果' : '编辑完成后可进行对比'"
                    @click="toggleResultComparison"
                  >
                    <i class="bi bi-layout-split"></i>
                    <span>
                      {{
                        resultReady
                          ? comparisonEnabled
                            ? '退出对比'
                            : '结果对比'
                          : resultLoading
                            ? '加载结果'
                            : '等待结果'
                      }}
                    </span>
                  </button>
                </div>
              </div>

              <div
                v-if="showGenerationComparison"
                class="local-mask-generation-compare"
                :style="{
                  '--mask-ratio':
                    sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1,
                }"
                aria-label="局部编辑前后对比"
              >
                <section class="local-mask-generation-pane is-source">
                  <header>
                    <span class="local-mask-generation-index">01</span>
                    <div><strong>原图</strong><small>本次局部编辑来源</small></div>
                  </header>
                  <div class="local-mask-generation-media">
                    <img v-if="objectUrl" :src="objectUrl" alt="局部编辑原图" draggable="false" />
                    <span class="local-mask-generation-badge is-source">
                      <i class="bi bi-image" aria-hidden="true"></i>编辑来源
                    </span>
                  </div>
                </section>

                <span class="local-mask-generation-arrow" aria-hidden="true">
                  <i class="bi bi-arrow-right"></i>
                </span>

                <section class="local-mask-generation-pane is-result">
                  <header>
                    <span class="local-mask-generation-index">02</span>
                    <div>
                      <strong>编辑结果</strong>
                      <small>{{
                        resultReady ? '已完成' : resultFailed ? '生成失败' : '处理中'
                      }}</small>
                    </div>
                  </header>
                  <div class="local-mask-generation-media">
                    <img
                      v-if="resultReady"
                      :src="resultObjectUrl"
                      alt="局部编辑结果"
                      draggable="false"
                    />
                    <div
                      v-else-if="resultFailed || resultLoadError"
                      class="local-mask-generation-failed"
                      role="alert"
                    >
                      <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
                      <strong>生成失败</strong>
                      <span>{{ resultLoadError || resultError || '本次局部编辑未生成结果' }}</span>
                    </div>
                    <div
                      v-else
                      class="local-mask-generation-pending"
                      role="status"
                      aria-live="polite"
                    >
                      <span class="local-mask-pending-orb" aria-hidden="true">
                        <i class="bi bi-stars"></i>
                      </span>
                      <strong>局部编辑生成中</strong>
                      <em>{{ resultPendingLabel }}</em>
                      <span class="local-mask-pending-bar" aria-hidden="true"><i></i></span>
                      <small>完成后会自动显示在这里</small>
                    </div>
                    <span v-if="resultReady" class="local-mask-generation-badge is-result">
                      <i class="bi bi-brush" aria-hidden="true"></i>由左侧原图局部编辑
                    </span>
                  </div>
                </section>
              </div>

              <div
                v-else
                ref="stageViewportRef"
                class="local-mask-stage-viewport"
                @wheel="handleZoomWheel"
              >
                <div class="local-mask-viewport-content" :style="viewportContentStyle">
                  <div
                    class="local-mask-artboard"
                    :class="{
                      'is-erasing': brushMode === 'erase',
                      'is-comparing': comparisonEnabled,
                      'has-result': resultReady,
                    }"
                    :style="artboardStyle"
                    @pointermove="trackCursor"
                    @pointerenter="trackCursor"
                    @pointerleave="hideCursor"
                  >
                    <img
                      v-if="objectUrl"
                      class="local-mask-source-image"
                      :src="objectUrl"
                      alt="局部编辑原图"
                      draggable="false"
                    />
                    <img
                      v-if="resultReady && !comparisonEnabled"
                      class="local-mask-result-image"
                      :src="resultObjectUrl"
                      alt="局部编辑结果"
                      draggable="false"
                    />
                    <div
                      v-if="resultReady && comparisonEnabled"
                      class="local-mask-result-clip"
                      :style="resultComparisonStyle"
                      aria-hidden="true"
                    >
                      <img :src="resultObjectUrl" alt="" draggable="false" />
                    </div>
                    <template v-if="resultReady && comparisonEnabled">
                      <span class="local-mask-compare-label is-source">原图</span>
                      <span class="local-mask-compare-label is-result">编辑后</span>
                      <span
                        class="local-mask-compare-divider-line"
                        :style="comparisonDividerStyle"
                        aria-hidden="true"
                      >
                        <i class="bi bi-chevron-left"></i><i class="bi bi-chevron-right"></i>
                      </span>
                      <input
                        v-model.number="comparisonPosition"
                        class="local-mask-compare-range"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        aria-label="调整原图和编辑结果对比位置"
                      />
                    </template>
                    <canvas
                      v-show="objectUrl && maskVisible && !resultReady"
                      ref="canvasRef"
                      aria-label="局部编辑蒙版画布"
                      @pointerdown.prevent="beginStroke"
                      @pointermove.prevent="extendStroke"
                      @pointerup.prevent="endStroke"
                      @pointercancel.prevent="endStroke"
                    ></canvas>
                    <div
                      v-if="
                        cursor.visible &&
                        objectUrl &&
                        !busy &&
                        !submitted &&
                        !loading &&
                        !resultReady
                      "
                      class="local-mask-cursor"
                      :class="{ 'is-erase': brushMode === 'erase' }"
                      :style="cursorStyle"
                      aria-hidden="true"
                    ></div>
                    <div v-if="loading" class="local-mask-loading">
                      <span class="local-mask-skeleton" aria-hidden="true"></span>
                      <i class="bi bi-arrow-repeat spin"></i><span>正在读取原图…</span>
                    </div>
                    <div v-else-if="error && !objectUrl" class="local-mask-loading is-error">
                      <i class="bi bi-exclamation-triangle"></i>
                      <span>{{ error }}</span>
                      <button type="button" class="local-mask-retry" @click="loadSource">
                        <i class="bi bi-arrow-clockwise"></i>重新加载
                      </button>
                    </div>
                    <div v-if="busy" class="local-mask-busy" aria-live="polite">
                      <span class="local-mask-busy-bar" aria-hidden="true"><i></i></span>
                      <i class="bi bi-stars"></i>
                      <strong>正在提交局部编辑</strong>
                      <span>窗口不会自动关闭</span>
                    </div>
                    <div
                      v-else-if="submitted && resultLoadError"
                      class="local-mask-result-state is-error"
                      role="alert"
                    >
                      <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
                      <span>{{ resultLoadError }}</span>
                    </div>
                    <div
                      v-else-if="submitted && resultFailed"
                      class="local-mask-result-state is-error"
                      role="alert"
                    >
                      <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
                      <span>{{ resultError || '局部编辑生成失败' }}</span>
                    </div>
                    <div
                      v-else-if="submitted && !resultReady"
                      class="local-mask-result-state"
                      role="status"
                    >
                      <i class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
                      <span>{{ resultLoading ? '正在加载编辑结果…' : '正在生成编辑结果…' }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="local-mask-stage-footer">
                <span>
                  <i class="local-mask-dot" aria-hidden="true"></i>
                  {{
                    resultReady ? (comparisonEnabled ? '原图 / 编辑后' : '编辑结果') : '蒙版区域'
                  }}
                </span>
                <span><i class="bi bi-mouse" aria-hidden="true"></i>{{ shortcutTip }}</span>
              </div>
            </div>

            <aside
              v-show="!embedded || !panelCollapsed"
              :class="{ 'is-busy': busy, 'is-generation': showGenerationComparison }"
            >
              <div class="local-mask-aside-heading">
                <span class="local-mask-step">01</span>
                <div>
                  <strong>描述修改内容</strong>
                  <small>仅对选中的区域生效</small>
                </div>
                <button
                  v-if="embedded"
                  type="button"
                  class="local-mask-panel-collapse"
                  title="收起面板，编辑被遮挡区域"
                  aria-label="收起编辑要求面板"
                  @click="panelCollapsed = true"
                >
                  <i class="bi bi-chevron-right" aria-hidden="true"></i>
                </button>
              </div>
              <div class="local-mask-prompt-field">
                <textarea
                  ref="textareaRef"
                  v-model="editPrompt"
                  class="local-mask-textarea"
                  rows="8"
                  maxlength="2000"
                  :disabled="busy || submitted"
                  placeholder="例如：把选中区域的衣服改为深蓝色皮夹克"
                ></textarea>
                <span>{{ editPrompt.length }}/2000</span>
              </div>
              <div class="local-mask-quick" role="group" aria-label="快捷修改要求">
                <button
                  v-for="quick in QUICK_PROMPTS"
                  :key="quick.label"
                  type="button"
                  :disabled="busy || submitted"
                  @click="applyQuickPrompt(quick.text)"
                >
                  {{ quick.label }}
                </button>
              </div>

              <div class="local-mask-preserve-note">
                <i class="bi bi-shield-check" aria-hidden="true"></i>
                <div>
                  <strong>默认保持原图视觉</strong>
                  <p>不会主动改变整图风格、颜色、光影与构图，除非你的要求中明确提出。</p>
                </div>
              </div>
              <p v-if="error && objectUrl" class="local-mask-error" role="alert">
                <i class="bi bi-exclamation-circle" aria-hidden="true"></i>{{ error }}
              </p>
              <div v-if="submitted" class="local-mask-submitted" role="status">
                <i
                  class="bi"
                  :class="resultFailed ? 'bi-exclamation-circle' : 'bi-check2-circle'"
                  aria-hidden="true"
                ></i>
                <div>
                  <strong>{{
                    resultReady ? '局部编辑已完成' : resultFailed ? '生成失败' : '任务已提交'
                  }}</strong>
                  <span>
                    {{
                      resultReady
                        ? '编辑结果已显示在画布中，可使用“结果对比”查看变化。'
                        : resultFailed
                          ? resultError || '本次局部编辑未生成结果，请关闭后重试。'
                          : '正在等待生成结果，窗口会保持打开。'
                    }}
                  </span>
                </div>
              </div>
              <div class="local-mask-footer">
                <span v-if="coverageLabel" class="local-mask-coverage">
                  <i class="bi bi-bounding-box" aria-hidden="true"></i>选中区域 {{ coverageLabel }}
                </span>
                <span v-else class="local-mask-coverage is-empty">尚未涂抹区域</span>
                <button
                  type="button"
                  class="local-mask-submit"
                  :class="{ 'is-submitted': submitted }"
                  :disabled="
                    busy ||
                    submitted ||
                    costPending ||
                    loading ||
                    !objectUrl ||
                    !hasMask ||
                    !editPrompt.trim()
                  "
                  :title="submitHint"
                  @click="submitEdit"
                >
                  <i
                    class="bi"
                    :class="submitted ? 'bi-check2' : busy ? 'bi-arrow-repeat spin' : 'bi-stars'"
                  ></i>
                  {{
                    submitted
                      ? resultReady
                        ? '编辑完成'
                        : resultFailed
                          ? '生成失败'
                          : '任务已提交'
                      : busy
                        ? '正在提交…'
                        : costPending
                          ? '正在计算费用…'
                          : '生成局部编辑'
                  }}
                  <span v-if="costLabel && !busy && !submitted" class="local-mask-submit-cost">
                    {{ costLabel }}
                  </span>
                  <kbd v-if="!busy && !submitted && !costPending">{{ MOD_KEY_LABEL }}↵</kbd>
                </button>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.local-mask-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 4, 9, 0.82);
  backdrop-filter: blur(20px) saturate(1.2);
}

.local-mask-dialog {
  --lm-panel: #131318;
  --lm-field: #0e0e13;
  --lm-line: #ffffff12;
  --lm-line-2: #ffffff1f;
  --lm-ink: #f5f5f8;
  --lm-muted: #9c9cab;
  --lm-dim: #64646f;
  --lm-accent: #7c6cff;
  --lm-accent-soft: rgba(124, 108, 255, 0.14);
  display: flex;
  flex-direction: column;
  width: min(1220px, 96vw);
  max-height: 94vh;
  overflow: hidden;
  border: 1px solid var(--lm-line-2);
  border-radius: 18px;
  background: var(--lm-panel);
  color: var(--lm-ink);
  box-shadow:
    0 40px 120px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

/* ---------- 头部 ---------- */
.local-mask-dialog > header {
  flex: none;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px 0 18px;
  border-bottom: 1px solid var(--lm-line);
}

.local-mask-dialog > header > div {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.local-mask-dialog > header strong {
  flex: none;
  font-size: 0.94rem;
  letter-spacing: 0.01em;
}

.local-mask-dialog > header small {
  overflow: hidden;
  color: var(--lm-dim);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.local-mask-source-size {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--lm-line-2);
  border-radius: 999px;
  color: var(--lm-muted);
  font:
    600 0.7rem/1 ui-monospace,
    monospace;
}

.local-mask-close {
  flex: none;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--lm-muted);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.local-mask-close:hover {
  background: #ffffff10;
  color: #fff;
}

.local-mask-close:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ---------- 主区 ---------- */
.local-mask-workspace {
  flex: 1;
  min-height: min(620px, calc(94vh - 76px));
  display: grid;
  grid-template-columns: minmax(0, 1fr) 296px;
}

.local-mask-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 0;
  padding: 58px 18px 12px;
  background:
    radial-gradient(640px 300px at 50% 0%, rgba(124, 108, 255, 0.05), transparent 70%), #0d0d12;
}

/* 悬浮工具条 */
.local-mask-toolbar {
  position: absolute;
  z-index: 6;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 24px);
  padding: 5px 10px 5px 5px;
  border: 1px solid var(--lm-line-2);
  border-radius: 12px;
  background: #17171df2;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
}

.local-mask-seg {
  display: flex;
  padding: 2px;
  border-radius: 9px;
  background: var(--lm-field);
}

.local-mask-seg button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 11px;
  white-space: nowrap;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--lm-muted);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.local-mask-seg button:hover:not(.is-on) {
  color: var(--lm-ink);
}

.local-mask-seg button.is-on {
  background: var(--lm-accent);
  color: #fff;
  box-shadow: 0 2px 10px rgba(124, 108, 255, 0.45);
}

.local-mask-divider {
  width: 1px;
  height: 20px;
  background: var(--lm-line-2);
}

.local-mask-sizer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.local-mask-sizer .is-min {
  color: var(--lm-dim);
  font-size: 5px;
}

.local-mask-sizer .is-max {
  color: var(--lm-dim);
  font-size: 10px;
}

.local-mask-sizer input {
  width: 104px;
  accent-color: var(--lm-accent);
}

.local-mask-sizer output {
  min-width: 26px;
  color: var(--lm-accent);
  font:
    700 0.72rem/1 ui-monospace,
    monospace;
  text-align: right;
}

.local-mask-icons {
  display: flex;
  gap: 3px;
}

.local-mask-icons button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--lm-muted);
  font-size: 0.82rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.local-mask-icons button:hover:not(:disabled) {
  background: #ffffff10;
  color: #fff;
}

.local-mask-icons button.is-on {
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
}

.local-mask-icons button:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}

/* 画板 */
.local-mask-artboard {
  position: relative;
  align-self: center;
  width: min(100%, calc((94vh - 210px) * var(--mask-ratio, 1)));
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
  border: 1px solid var(--lm-line-2);
  border-radius: 12px;
  background: repeating-conic-gradient(#0a0a0e 0% 25%, #101016 0% 50%) 0 0 / 18px 18px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
}

.local-mask-artboard img,
.local-mask-artboard canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.local-mask-artboard img {
  object-fit: contain;
  user-select: none;
}

.local-mask-artboard canvas {
  z-index: 2;
  cursor: none;
  touch-action: none;
}

.local-mask-cursor {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  transform: translate(-50%, -50%);
  border: 1.5px solid rgba(139, 123, 255, 0.95);
  border-radius: 50%;
  background: rgba(139, 123, 255, 0.14);
  box-shadow:
    0 0 14px rgba(124, 108, 255, 0.35),
    0 0 0 1px rgba(0, 0, 0, 0.45),
    inset 0 0 0 1px rgba(0, 0, 0, 0.35);
}

.local-mask-cursor.is-erase {
  border-color: rgba(255, 148, 148, 0.95);
  background: rgba(255, 148, 148, 0.08);
  box-shadow:
    0 0 14px rgba(255, 120, 120, 0.3),
    0 0 0 1px rgba(0, 0, 0, 0.45),
    inset 0 0 0 1px rgba(0, 0, 0, 0.35);
}

.local-mask-hint {
  margin: 0;
  color: var(--lm-dim);
  font:
    600 0.64rem/1.5 ui-monospace,
    monospace;
  letter-spacing: 0.02em;
}

/* 载入 / 错误 / 提交中 */
.local-mask-loading {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  color: var(--lm-muted);
}

.local-mask-loading.is-error {
  color: #ff9d9d;
}

.local-mask-loading i {
  position: relative;
  font-size: 1.4rem;
}

.local-mask-loading span {
  position: relative;
  font-size: 0.78rem;
}

.local-mask-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    110deg,
    rgba(255, 255, 255, 0.03) 30%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.03) 70%
  );
  background-size: 220% 100%;
  animation: local-mask-shimmer 1.6s ease-in-out infinite;
}

.local-mask-retry {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 4px;
  padding: 9px 18px;
  border: 1px solid rgba(255, 157, 157, 0.4);
  border-radius: 999px;
  background: rgba(255, 157, 157, 0.1);
  color: #ffbdbd;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.local-mask-retry:hover {
  background: rgba(255, 157, 157, 0.2);
}

.local-mask-busy {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  background: rgba(8, 8, 12, 0.7);
  color: #d8d2ff;
  backdrop-filter: blur(3px);
}

.local-mask-busy i {
  font-size: 1.6rem;
  animation: local-mask-pulse 1.4s ease-in-out infinite;
}

.local-mask-busy span:last-child {
  font-size: 0.78rem;
}

.local-mask-busy-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  overflow: hidden;
  background: #ffffff14;
}

.local-mask-busy-bar i {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: linear-gradient(
    90deg,
    transparent,
    var(--lm-accent),
    #cfc5ff,
    var(--lm-accent),
    transparent
  );
  animation: local-mask-bar 1.3s ease-in-out infinite;
}

/* ---------- 右栏 ---------- */
.local-mask-workspace > aside {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  border-left: 1px solid var(--lm-line);
  background: var(--lm-panel);
  scrollbar-width: thin;
  transition: opacity 0.2s ease;
}

.local-mask-workspace > aside.is-busy {
  opacity: 0.7;
  pointer-events: none;
}

.local-mask-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 9px;
}

.local-mask-panel-head span {
  color: var(--lm-ink);
  font-size: 0.8rem;
  font-weight: 600;
}

.local-mask-panel-head em {
  color: var(--lm-dim);
  font-size: 0.66rem;
  font-style: normal;
}

.local-mask-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 12px;
  border: 1px solid var(--lm-line-2);
  border-radius: 12px;
  background: var(--lm-field);
  color: var(--lm-ink);
  font: inherit;
  font-size: 0.8rem;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.local-mask-textarea:focus {
  border-color: var(--lm-accent);
  box-shadow: 0 0 0 3px rgba(124, 108, 255, 0.16);
}

.local-mask-textarea:disabled {
  opacity: 0.6;
}

.local-mask-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.local-mask-quick button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border: 1px solid var(--lm-line-2);
  border-radius: 999px;
  background: transparent;
  color: var(--lm-muted);
  font-size: 0.7rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.local-mask-quick button i {
  font-size: 0.62rem;
  color: var(--lm-accent);
}

.local-mask-quick button:hover:not(:disabled) {
  border-color: rgba(124, 108, 255, 0.55);
  background: var(--lm-accent-soft);
  color: #e6e1ff;
}

.local-mask-quick button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.local-mask-legend {
  display: grid;
  gap: 7px;
  margin-top: 14px;
  padding: 11px 12px;
  border: 1px dashed var(--lm-line-2);
  border-radius: 12px;
}

.local-mask-legend p {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--lm-dim);
  font-size: 0.68rem;
  line-height: 1.5;
}

.local-mask-dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: rgba(139, 123, 255, 0.85);
}

.local-mask-dot.is-keep {
  background: transparent;
  border: 1.5px solid var(--lm-dim);
}

.local-mask-dot.is-alt {
  background: rgba(255, 148, 148, 0.8);
}

.local-mask-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 12px 0 0;
  padding: 9px 11px;
  border: 1px solid rgba(255, 125, 110, 0.3);
  border-radius: 10px;
  background: rgba(255, 125, 110, 0.08);
  color: #ffb3a5;
  font-size: 0.72rem;
  line-height: 1.5;
}

/* 底部：覆盖率 + 提交 */
.local-mask-footer {
  margin-top: auto;
  padding-top: 14px;
}

.local-mask-coverage {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 9px;
  color: var(--lm-accent);
  font:
    700 0.7rem/1 ui-monospace,
    monospace;
}

.local-mask-coverage.is-empty {
  color: var(--lm-dim);
  font-weight: 600;
}

.local-mask-submit {
  position: relative;
  width: 100%;
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(92deg, #6d5cff, #8f7bff);
  color: #fff;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 0 10px 26px rgba(109, 92, 255, 0.35);
  transition:
    filter 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.local-mask-submit::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);
  transform: translateX(-130%);
  animation: local-mask-beam 3.6s ease-in-out infinite;
}

.local-mask-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.07);
  box-shadow: 0 14px 32px rgba(109, 92, 255, 0.45);
}

.local-mask-submit:active:not(:disabled) {
  transform: translateY(1px) scale(0.99);
}

.local-mask-submit:disabled {
  cursor: not-allowed;
  filter: saturate(0.4) brightness(0.75);
  box-shadow: none;
}

.local-mask-submit:disabled::after {
  animation: none;
}

.local-mask-submit kbd {
  padding: 3px 6px;
  border: 1px solid #ffffff3a;
  border-radius: 6px;
  background: #ffffff1f;
  font:
    700 0.6rem/1 ui-monospace,
    monospace;
}

/* ---------- 动效 ---------- */
.local-mask-dialog-enter-active,
.local-mask-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.local-mask-dialog-enter-active .local-mask-dialog,
.local-mask-dialog-leave-active .local-mask-dialog {
  transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}

.local-mask-dialog-enter-from,
.local-mask-dialog-leave-to {
  opacity: 0;
}

.local-mask-dialog-enter-from .local-mask-dialog,
.local-mask-dialog-leave-to .local-mask-dialog {
  transform: translateY(14px) scale(0.98);
}

.spin {
  animation: local-mask-spin 1s linear infinite;
}

@keyframes local-mask-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes local-mask-shimmer {
  to {
    background-position: -120% 0;
  }
}

@keyframes local-mask-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.72;
  }
}

@keyframes local-mask-bar {
  0% {
    left: -42%;
  }
  100% {
    left: 104%;
  }
}

@keyframes local-mask-beam {
  58%,
  100% {
    transform: translateX(130%);
  }
}

@media (pointer: coarse) {
  .local-mask-cursor {
    display: none;
  }

  .local-mask-artboard canvas {
    cursor: crosshair;
  }
}

@media (prefers-reduced-motion: reduce) {
  .local-mask-skeleton,
  .local-mask-busy i,
  .local-mask-busy-bar i,
  .local-mask-submit::after {
    animation: none;
  }

  .local-mask-dialog-enter-active,
  .local-mask-dialog-leave-active,
  .local-mask-dialog-enter-active .local-mask-dialog,
  .local-mask-dialog-leave-active .local-mask-dialog {
    transition: none;
  }
}

@media (max-width: 860px) {
  .local-mask-backdrop {
    padding: 8px;
  }

  .local-mask-workspace {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .local-mask-stage {
    padding: 62px 10px 10px;
  }

  .local-mask-artboard {
    width: 100%;
    min-height: 42vh;
  }

  .local-mask-workspace > aside {
    border-left: 0;
    border-top: 1px solid var(--lm-line);
    overflow: visible;
  }

  .local-mask-toolbar {
    flex-wrap: wrap;
    justify-content: center;
  }

  .local-mask-source-size {
    display: none;
  }
}

/* Full-screen editor shell */
.local-mask-backdrop {
  padding: 0;
  background: rgba(7, 10, 18, 0.76);
  backdrop-filter: blur(12px);
}

.local-mask-dialog {
  --lm-panel: #121720;
  --lm-field: #0c1119;
  --lm-stage: #090d13;
  --lm-stage-grid: rgba(255, 255, 255, 0.025);
  --lm-elevated: #181e29;
  --lm-line: rgba(255, 255, 255, 0.075);
  --lm-line-2: rgba(255, 255, 255, 0.13);
  --lm-ink: #f4f7fb;
  --lm-muted: #a7b0bf;
  --lm-dim: #717b8c;
  --lm-accent: #5b7cff;
  --lm-accent-strong: #4567ed;
  --lm-accent-soft: rgba(91, 124, 255, 0.14);
  --lm-good: #43c98b;
  width: 100vw;
  height: 100dvh;
  max-height: none;
  border: 0;
  border-radius: 0;
  background: var(--lm-panel);
  box-shadow: none;
}

.local-mask-dialog.is-light {
  --lm-panel: #ffffff;
  --lm-field: #f7f9fc;
  --lm-stage: #eef2f7;
  --lm-stage-grid: rgba(41, 56, 78, 0.04);
  --lm-elevated: #ffffff;
  --lm-line: rgba(24, 35, 52, 0.08);
  --lm-line-2: rgba(24, 35, 52, 0.14);
  --lm-ink: #172033;
  --lm-muted: #657086;
  --lm-dim: #8b94a6;
  --lm-accent: #4169e1;
  --lm-accent-strong: #3157cb;
  --lm-accent-soft: rgba(65, 105, 225, 0.1);
  --lm-good: #168a59;
}

.local-mask-dialog > .local-mask-header {
  height: 64px;
  gap: 18px;
  padding: 0 18px 0 20px;
  border-bottom: 1px solid var(--lm-line);
  background: var(--lm-panel);
}

.local-mask-heading {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.local-mask-heading-icon {
  flex: none;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--lm-accent) 28%, transparent);
  border-radius: 8px;
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
  font-size: 0.92rem;
}

.local-mask-heading > div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.local-mask-dialog > header .local-mask-heading strong {
  font-size: 0.92rem;
  line-height: 1.2;
  letter-spacing: 0;
}

.local-mask-dialog > header .local-mask-heading small {
  max-width: min(48vw, 680px);
  color: var(--lm-dim);
  font-size: 0.68rem;
  line-height: 1.2;
}

.local-mask-header-meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.local-mask-source-size,
.local-mask-header-coverage {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--lm-line);
  border-radius: 7px;
  background: var(--lm-field);
  color: var(--lm-muted);
  font-size: 0.68rem;
}

.local-mask-header-coverage {
  color: var(--lm-accent);
  font-weight: 700;
}

.local-mask-close {
  width: 36px;
  height: 36px;
  border-radius: 8px;
}

.local-mask-close:hover {
  background: var(--lm-field);
  color: var(--lm-ink);
}

.local-mask-workspace {
  min-height: 0;
  height: calc(100dvh - 64px);
  grid-template-columns: minmax(0, 1fr) 340px;
}

.local-mask-stage {
  display: grid;
  grid-template-rows: 54px minmax(0, 1fr) 34px;
  align-items: stretch;
  justify-content: stretch;
  gap: 0;
  padding: 0;
  background-color: var(--lm-stage);
  background-image:
    linear-gradient(var(--lm-stage-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--lm-stage-grid) 1px, transparent 1px);
  background-size: 24px 24px;
}

.local-mask-toolbar {
  position: relative;
  top: auto;
  left: auto;
  z-index: 8;
  width: auto;
  max-width: none;
  transform: none;
  gap: 8px;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--lm-line);
  border-radius: 0;
  background: color-mix(in srgb, var(--lm-panel) 92%, transparent);
  box-shadow: none;
  backdrop-filter: blur(14px);
}

.local-mask-seg {
  padding: 2px;
  border: 1px solid var(--lm-line);
  border-radius: 8px;
  background: var(--lm-field);
}

.local-mask-seg button {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  color: var(--lm-muted);
  font-size: 0.72rem;
}

.local-mask-seg button.is-on {
  background: var(--lm-elevated);
  color: var(--lm-accent);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.14);
}

.local-mask-seg button:disabled,
.local-mask-sizer input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.local-mask-sizer {
  min-width: 176px;
  gap: 9px;
  padding: 0 4px;
}

.local-mask-sizer::before {
  content: '笔刷';
  color: var(--lm-dim);
  font-size: 0.68rem;
  font-weight: 600;
}

.local-mask-sizer input {
  width: 92px;
}

.local-mask-sizer output {
  min-width: 38px;
  color: var(--lm-muted);
  font:
    700 0.66rem/1 ui-monospace,
    monospace;
}

.local-mask-icons,
.local-mask-view-tools {
  display: flex;
  align-items: center;
  gap: 3px;
}

.local-mask-toolbar-spacer {
  flex: 1;
}

.local-mask-icons button,
.local-mask-view-tools button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--lm-muted);
  font-size: 0.8rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.local-mask-icons button:hover:not(:disabled),
.local-mask-view-tools button:hover:not(:disabled) {
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
}

.local-mask-icons button:disabled,
.local-mask-view-tools button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.local-mask-view-tools > output {
  width: 45px;
  color: var(--lm-muted);
  font:
    700 0.65rem/1 ui-monospace,
    monospace;
  text-align: center;
}

.local-mask-view-tools button.local-mask-compare {
  width: auto;
  display: inline-flex;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--lm-line);
  background: var(--lm-field);
  font-size: 0.68rem;
  font-weight: 700;
}

.local-mask-view-tools button.local-mask-compare.is-on {
  border-color: color-mix(in srgb, var(--lm-accent) 38%, transparent);
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
}

.local-mask-stage-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--lm-dim) 38%, transparent) transparent;
  scrollbar-width: thin;
}

.local-mask-viewport-content {
  min-width: 100%;
  min-height: 100%;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: 32px;
}

.local-mask-artboard {
  align-self: auto;
  flex: none;
  max-width: none;
  max-height: none;
  border: 1px solid color-mix(in srgb, var(--lm-ink) 16%, transparent);
  border-radius: 6px;
  background: repeating-conic-gradient(#dfe4ec 0% 25%, #f3f5f8 0% 50%) 0 0 / 18px 18px;
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(0, 0, 0, 0.08);
  transition:
    width 0.14s ease,
    height 0.14s ease;
}

.local-mask-dialog:not(.is-light) .local-mask-artboard {
  background: repeating-conic-gradient(#171d27 0% 25%, #202733 0% 50%) 0 0 / 18px 18px;
}

.local-mask-artboard.is-comparing {
  box-shadow:
    0 0 0 2px var(--lm-accent),
    0 24px 70px rgba(0, 0, 0, 0.28);
}

.local-mask-source-image {
  z-index: 0;
}

.local-mask-result-image {
  z-index: 1;
}

.local-mask-result-clip {
  position: absolute;
  inset: 0;
  z-index: 3;
  overflow: hidden;
  pointer-events: none;
}

.local-mask-result-clip img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.local-mask-compare-label {
  position: absolute;
  top: 12px;
  z-index: 6;
  padding: 5px 9px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 6px;
  background: rgba(10, 14, 22, 0.7);
  color: #ffffff;
  font-size: 0.64rem;
  font-weight: 700;
  line-height: 1;
  backdrop-filter: blur(8px);
  pointer-events: none;
}

.local-mask-compare-label.is-source {
  left: 12px;
}

.local-mask-compare-label.is-result {
  right: 12px;
}

.local-mask-compare-divider-line {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 6;
  width: 2px;
  transform: translateX(-1px);
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.94);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.16),
    0 0 18px rgba(0, 0, 0, 0.35);
  color: #25314a;
  pointer-events: none;
}

.local-mask-compare-divider-line::before {
  content: '';
  position: absolute;
  width: 30px;
  height: 30px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.28);
}

.local-mask-compare-divider-line i {
  position: relative;
  z-index: 1;
  font-size: 0.58rem;
}

.local-mask-compare-range {
  position: absolute;
  inset: 0;
  z-index: 7;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: ew-resize;
}

.local-mask-result-state {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 6;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 28px);
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--lm-accent) 34%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--lm-panel) 88%, transparent);
  color: var(--lm-accent);
  font-size: 0.66rem;
  font-weight: 700;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}

.local-mask-result-state.is-error {
  border-color: rgba(239, 91, 91, 0.35);
  color: #ef6b6b;
}

.local-mask-stage-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 14px;
  border-top: 1px solid var(--lm-line);
  background: color-mix(in srgb, var(--lm-panel) 90%, transparent);
  color: var(--lm-dim);
  font-size: 0.62rem;
}

.local-mask-stage-footer span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}

.local-mask-stage-footer .local-mask-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.local-mask-workspace > aside {
  box-sizing: border-box;
  padding: 24px 22px 20px;
  border-left: 1px solid var(--lm-line);
  background: var(--lm-panel);
}

.local-mask-workspace > aside.is-busy {
  opacity: 1;
  pointer-events: auto;
}

.local-mask-aside-heading {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 14px;
}

.local-mask-step {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
  font:
    800 0.66rem/1 ui-monospace,
    monospace;
}

.local-mask-aside-heading > div {
  display: grid;
  gap: 3px;
}

.local-mask-aside-heading strong {
  color: var(--lm-ink);
  font-size: 0.8rem;
}

.local-mask-aside-heading small {
  color: var(--lm-dim);
  font-size: 0.65rem;
}

.local-mask-prompt-field {
  position: relative;
}

.local-mask-textarea {
  min-height: 156px;
  padding: 13px 13px 30px;
  border-color: var(--lm-line-2);
  border-radius: 8px;
  background: var(--lm-field);
  color: var(--lm-ink);
  font-size: 0.78rem;
  resize: none;
}

.local-mask-textarea:focus {
  border-color: var(--lm-accent);
  box-shadow: 0 0 0 3px var(--lm-accent-soft);
}

.local-mask-prompt-field > span {
  position: absolute;
  right: 11px;
  bottom: 9px;
  color: var(--lm-dim);
  font:
    600 0.6rem/1 ui-monospace,
    monospace;
}

.local-mask-quick {
  gap: 6px;
  margin-top: 9px;
}

.local-mask-quick button {
  min-height: 29px;
  padding: 0 10px;
  border-color: var(--lm-line);
  border-radius: 7px;
  background: var(--lm-field);
  color: var(--lm-muted);
  font-size: 0.66rem;
}

.local-mask-quick button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--lm-accent) 42%, transparent);
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
}

.local-mask-preserve-note,
.local-mask-submitted {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 18px;
  padding: 12px;
  border-left: 2px solid var(--lm-accent);
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
}

.local-mask-preserve-note > i,
.local-mask-submitted > i {
  flex: none;
  margin-top: 1px;
  font-size: 0.9rem;
}

.local-mask-preserve-note > div,
.local-mask-submitted > div {
  display: grid;
  gap: 4px;
}

.local-mask-preserve-note strong,
.local-mask-submitted strong {
  color: var(--lm-ink);
  font-size: 0.7rem;
}

.local-mask-preserve-note p,
.local-mask-submitted span {
  margin: 0;
  color: var(--lm-muted);
  font-size: 0.64rem;
  line-height: 1.55;
}

.local-mask-submitted {
  border-left-color: var(--lm-good);
  background: color-mix(in srgb, var(--lm-good) 11%, transparent);
  color: var(--lm-good);
}

.local-mask-footer {
  margin-top: auto;
  padding-top: 18px;
}

.local-mask-coverage {
  margin-bottom: 10px;
  color: var(--lm-accent);
  font-size: 0.66rem;
}

.local-mask-submit {
  min-height: 44px;
  border-radius: 8px;
  background: var(--lm-accent-strong);
  box-shadow: 0 8px 22px color-mix(in srgb, var(--lm-accent) 28%, transparent);
}

.local-mask-submit::after {
  display: none;
}

.local-mask-submit:hover:not(:disabled) {
  filter: brightness(1.06);
  box-shadow: 0 10px 26px color-mix(in srgb, var(--lm-accent) 36%, transparent);
}

.local-mask-submit.is-submitted {
  background: var(--lm-good);
}

.local-mask-submit:disabled {
  opacity: 0.52;
  filter: none;
}

.local-mask-submit.is-submitted:disabled {
  opacity: 0.86;
}

.local-mask-submit-cost {
  padding: 3px 7px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1;
}

.local-mask-busy {
  background: color-mix(in srgb, var(--lm-stage) 72%, transparent);
  color: #ffffff;
  backdrop-filter: blur(5px);
}

.local-mask-busy strong {
  font-size: 0.8rem;
}

.local-mask-busy span:last-child {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.66rem;
}

.local-mask-dialog.is-light .local-mask-busy {
  color: #ffffff;
}

.local-mask-backdrop.is-embedded {
  position: absolute;
  z-index: 8;
  padding: 0;
  background: transparent;
  backdrop-filter: none;
}

.local-mask-dialog.is-embedded {
  width: 100%;
  height: 100%;
  max-height: none;
  background: transparent;
}

.local-mask-dialog.is-embedded > .local-mask-header {
  display: none;
}

.local-mask-dialog.is-embedded .local-mask-workspace {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}

.local-mask-dialog.is-embedded .local-mask-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  padding: 0;
  background: #050508;
  background-image: none;
}

.local-mask-dialog.is-embedded .local-mask-toolbar {
  position: absolute;
  z-index: 12;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: 50%;
  width: auto;
  max-width: calc(100% - 40px);
  transform: translateX(-50%);
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: rgba(13, 13, 19, 0.94);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
  color: #fff;
}

.local-mask-dialog.is-embedded .local-mask-toolbar-spacer {
  display: none;
}

.local-mask-dialog.is-embedded .local-mask-stage-viewport {
  position: absolute;
  inset: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.local-mask-dialog.is-embedded .local-mask-viewport-content {
  box-sizing: border-box;
  padding: 76px 0 20px;
  transition: padding 160ms ease;
}

@media (min-width: 861px) {
  .local-mask-dialog.is-embedded
    .local-mask-workspace:not(.is-panel-collapsed):not(.is-generation)
    .local-mask-viewport-content {
    box-sizing: border-box;
    padding-right: 352px;
  }
}

.local-mask-dialog.is-embedded .local-mask-artboard {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.local-mask-dialog.is-embedded .local-mask-stage-footer {
  display: none;
}

.local-mask-dialog.is-embedded .local-mask-workspace > aside {
  position: absolute;
  z-index: 11;
  top: calc(76px + env(safe-area-inset-top, 0px));
  right: 16px;
  bottom: calc(86px + env(safe-area-inset-bottom, 0px));
  width: 320px;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 18px;
  border: 1px solid var(--lm-line-2);
  border-radius: 10px;
  background: color-mix(in srgb, var(--lm-panel) 94%, transparent);
  box-shadow: 0 18px 52px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(16px);
}

.local-mask-dialog.is-embedded .local-mask-workspace > aside.is-generation {
  display: none;
}

.local-mask-dialog.is-embedded .local-mask-aside-heading > div {
  min-width: 0;
  flex: 1;
}

.local-mask-panel-collapse {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--lm-line);
  border-radius: 7px;
  background: var(--lm-field);
  color: var(--lm-muted);
  cursor: pointer;
}

.local-mask-panel-collapse:hover {
  border-color: color-mix(in srgb, var(--lm-accent) 38%, transparent);
  color: var(--lm-accent);
}

.local-mask-panel-reopen {
  position: absolute;
  z-index: 13;
  top: calc(76px + env(safe-area-inset-top, 0px));
  right: 16px;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9px;
  background: rgba(13, 13, 19, 0.94);
  color: rgba(255, 255, 255, 0.86);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.38);
  font-size: 0.68rem;
  font-weight: 700;
  cursor: pointer;
}

.local-mask-panel-reopen:hover {
  background: rgba(42, 42, 52, 0.96);
  color: #fff;
}

.local-mask-dialog.is-embedded .local-mask-generation-compare {
  padding: 80px 28px 28px;
  background: #050508;
}

.local-mask-inline-close {
  position: absolute;
  z-index: 14;
  top: calc(16px + env(safe-area-inset-top, 0px));
  right: 16px;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(13, 13, 19, 0.94);
  color: rgba(255, 255, 255, 0.82);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.38);
  cursor: pointer;
}

.local-mask-inline-close:hover {
  background: rgba(42, 42, 52, 0.96);
  color: #fff;
}

.local-mask-generation-compare {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 28px;
  overflow: auto;
}

.local-mask-generation-pane {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
}

.local-mask-generation-pane > header {
  display: flex;
  align-items: center;
  gap: 9px;
}

.local-mask-generation-pane > header > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.local-mask-generation-pane > header strong {
  color: var(--lm-ink);
  font-size: 0.75rem;
}

.local-mask-generation-pane > header small {
  color: var(--lm-dim);
  font-size: 0.62rem;
}

.local-mask-generation-index {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid var(--lm-line-2);
  border-radius: 6px;
  background: var(--lm-field);
  color: var(--lm-muted);
  font:
    800 0.6rem/1 ui-monospace,
    monospace;
}

.local-mask-generation-pane.is-result .local-mask-generation-index {
  border-color: color-mix(in srgb, var(--lm-accent) 36%, transparent);
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
}

.local-mask-generation-media {
  position: relative;
  min-height: 260px;
  aspect-ratio: var(--mask-ratio, 1);
  overflow: hidden;
  display: grid;
  place-items: center;
  border: 1px solid var(--lm-line-2);
  border-radius: 7px;
  background: repeating-conic-gradient(#171d27 0% 25%, #202733 0% 50%) 0 0 / 18px 18px;
  box-shadow: 0 18px 52px rgba(0, 0, 0, 0.24);
}

.local-mask-dialog.is-light .local-mask-generation-media {
  background: repeating-conic-gradient(#dfe4ec 0% 25%, #f3f5f8 0% 50%) 0 0 / 18px 18px;
}

.local-mask-generation-media > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}

.local-mask-generation-arrow {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--lm-line-2);
  border-radius: 50%;
  background: var(--lm-panel);
  color: var(--lm-accent);
}

.local-mask-generation-badge {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: rgba(9, 12, 19, 0.78);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 700;
  backdrop-filter: blur(8px);
}

.local-mask-generation-badge.is-result {
  left: auto;
  right: 10px;
  color: #d9d4ff;
}

.local-mask-generation-pending,
.local-mask-generation-failed {
  width: min(280px, calc(100% - 32px));
  display: grid;
  justify-items: center;
  gap: 9px;
  padding: 24px;
  box-sizing: border-box;
  text-align: center;
}

.local-mask-pending-orb {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--lm-accent) 42%, transparent);
  border-radius: 50%;
  background: var(--lm-accent-soft);
  color: var(--lm-accent);
  animation: local-mask-pending-pulse 1.8s ease-in-out infinite;
}

.local-mask-pending-orb i {
  animation: local-mask-pending-spin 2.4s linear infinite;
}

.local-mask-generation-pending strong,
.local-mask-generation-failed strong {
  color: var(--lm-ink);
  font-size: 0.78rem;
}

.local-mask-generation-pending em,
.local-mask-generation-pending small,
.local-mask-generation-failed span {
  color: var(--lm-muted);
  font-size: 0.64rem;
  font-style: normal;
  line-height: 1.5;
}

.local-mask-pending-bar {
  width: 100%;
  height: 3px;
  overflow: hidden;
  border-radius: 99px;
  background: color-mix(in srgb, var(--lm-accent) 14%, transparent);
}

.local-mask-pending-bar i {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: var(--lm-accent);
  animation: local-mask-pending-slide 1.25s ease-in-out infinite;
}

.local-mask-generation-failed {
  color: #ef6b6b;
}

@keyframes local-mask-pending-pulse {
  0%,
  100% {
    transform: scale(0.94);
    box-shadow: 0 0 0 0 rgba(124, 108, 255, 0);
  }
  50% {
    transform: scale(1);
    box-shadow: 0 0 0 10px rgba(124, 108, 255, 0.08);
  }
}

@keyframes local-mask-pending-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes local-mask-pending-slide {
  0% {
    transform: translateX(-110%);
  }
  50% {
    transform: translateX(75%);
  }
  100% {
    transform: translateX(240%);
  }
}

@media (max-width: 860px) {
  .local-mask-backdrop {
    padding: 0;
  }

  .local-mask-dialog {
    box-sizing: border-box;
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }

  .local-mask-workspace {
    display: block;
    height: calc(100dvh - 64px);
    overflow-y: auto;
  }

  .local-mask-workspace.is-generation {
    overflow: hidden;
  }

  .local-mask-workspace > aside.is-generation {
    display: none;
  }

  .local-mask-stage {
    width: 100%;
    height: max(360px, 48dvh);
    min-width: 0;
    grid-template-columns: minmax(0, 1fr);
    overflow: hidden;
  }

  .local-mask-workspace.is-generation .local-mask-stage {
    height: 100%;
  }

  .local-mask-toolbar {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .local-mask-generation-compare {
    width: auto;
    max-width: 100%;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    box-sizing: border-box;
    padding: 14px 18px 24px;
    overflow-x: hidden;
  }

  .local-mask-generation-arrow {
    margin: -2px auto;
    transform: rotate(90deg);
  }

  .local-mask-generation-media {
    width: 100%;
    box-sizing: border-box;
    min-height: 220px;
  }

  .local-mask-dialog.is-embedded .local-mask-workspace {
    height: 100%;
    overflow: hidden;
  }

  .local-mask-dialog.is-embedded .local-mask-viewport-content {
    padding: 64px 0 12px;
  }

  .local-mask-dialog.is-embedded .local-mask-stage,
  .local-mask-dialog.is-embedded .local-mask-workspace.is-generation .local-mask-stage {
    height: 100%;
  }

  .local-mask-dialog.is-embedded .local-mask-toolbar {
    top: calc(10px + env(safe-area-inset-top, 0px));
    left: 10px;
    width: calc(100% - 68px);
    max-width: none;
    transform: none;
    justify-content: flex-start;
    flex-wrap: nowrap;
  }

  .local-mask-dialog.is-embedded .local-mask-workspace > aside {
    top: auto;
    right: 10px;
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    left: 10px;
    width: auto;
    height: min(39dvh, 380px);
    padding: 16px;
  }

  .local-mask-dialog.is-embedded .local-mask-generation-compare {
    padding: 72px 14px 20px;
    overflow-y: auto;
  }

  .local-mask-inline-close {
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: 10px;
  }

  .local-mask-panel-reopen {
    top: calc(62px + env(safe-area-inset-top, 0px));
    right: 10px;
  }
}

.local-mask-dialog-enter-active .local-mask-dialog,
.local-mask-dialog-leave-active .local-mask-dialog {
  transition: opacity 0.18s ease;
}

.local-mask-dialog-enter-from .local-mask-dialog,
.local-mask-dialog-leave-to .local-mask-dialog {
  transform: none;
}
</style>
