<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { fetchAuthenticatedMediaBlob } from '@/services/authenticatedMedia'

const props = defineProps({
  open: { type: Boolean, default: false },
  sourceUrl: { type: String, default: '' },
  sourceTitle: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'submit'])

const QUICK_PROMPTS = [
  { label: '移除内容', text: '移除选中区域的内容，并自然补全背景' },
  { label: '替换为…', text: '把选中区域替换为：' },
  { label: '重绘细节', text: '在保持构图与光影不变的前提下重绘选中区域，让细节更清晰' },
  { label: '更换颜色', text: '把选中区域改为新的颜色，保持材质、纹理和光影不变' },
]

const IS_MAC = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
const MOD_KEY_LABEL = IS_MAC ? '⌘' : 'Ctrl'

const canvasRef = ref(null)
const textareaRef = ref(null)
const objectUrl = ref('')
const loading = ref(false)
const error = ref('')
const editPrompt = ref('')
const brushSize = ref(54)
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
let activeStroke = null
let loadSequence = 0
let maskWorkCanvas = null
let coverageCanvas = null
let previousBodyOverflow = ''

const artboardStyle = computed(() => ({
  aspectRatio:
    sourceWidth.value > 0 && sourceHeight.value > 0
      ? `${sourceWidth.value} / ${sourceHeight.value}`
      : '1 / 1',
  '--mask-ratio': sourceHeight.value > 0 ? sourceWidth.value / sourceHeight.value : 1,
}))
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
  if (props.busy) return '正在提交局部编辑…'
  if (loading.value || !objectUrl.value) return '等待原图加载完成'
  if (!hasMask.value) return '请先在图片上涂抹需要修改的区域'
  if (!editPrompt.value.trim()) return '请填写修改要求'
  return `生成局部编辑结果（${MOD_KEY_LABEL}Enter）`
})
const shortcutTip = computed(
  () =>
    `快捷键：B 涂抹 · E 擦除 · [ ] 画笔大小 · ${MOD_KEY_LABEL}Z 撤销 · ${MOD_KEY_LABEL}⇧Z 重做 · ${MOD_KEY_LABEL}Enter 提交`,
)

watch(
  () => [props.open, props.sourceUrl],
  ([open]) => {
    if (open) {
      lockBodyScroll()
      void loadSource()
    } else {
      unlockBodyScroll()
      resetEditor()
    }
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', handleKeydown, true)
    else window.removeEventListener('keydown', handleKeydown, true)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown, true)
  unlockBodyScroll()
  releaseObjectUrl()
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

function resetEditor() {
  loadSequence += 1
  releaseObjectUrl()
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
    const blob = await fetchAuthenticatedMediaBlob(props.sourceUrl, { cache: 'no-store' })
    if (sequence !== loadSequence) return
    const url = URL.createObjectURL(blob)
    const image = await loadImage(url)
    if (sequence !== loadSequence) {
      URL.revokeObjectURL(url)
      return
    }
    objectUrl.value = url
    sourceWidth.value = image.naturalWidth
    sourceHeight.value = image.naturalHeight
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    workingWidth.value = Math.max(1, Math.round(image.naturalWidth * scale))
    workingHeight.value = Math.max(1, Math.round(image.naturalHeight * scale))
    await nextTick()
    prepareCanvas()
    focusPromptIfDesktop()
  } catch (caught) {
    if (sequence === loadSequence) error.value = caught?.message || '原图加载失败'
  } finally {
    if (sequence === loadSequence) loading.value = false
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
  if (props.busy || loading.value || !objectUrl.value) return
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
  renderMaskPreview()
}

function extendStroke(event) {
  if (!drawing.value || !activeStroke) return
  const point = canvasPoint(event)
  if (!point) return
  const previous = activeStroke.points.at(-1)
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return
  activeStroke.points.push(point)
  renderMaskPreview()
}

function endStroke(event) {
  event?.currentTarget?.releasePointerCapture?.(event.pointerId)
  if (!drawing.value) return
  drawing.value = false
  activeStroke = null
  updateMaskCoverage()
}

function strokePath(context, points, scale) {
  if (points.length === 1) {
    context.beginPath()
    context.arc(points[0].x * scale, points[0].y * scale, context.lineWidth / 2, 0, Math.PI * 2)
    context.fill()
    return
  }
  // Quadratic midpoint smoothing keeps hand-drawn strokes from looking jagged.
  context.beginPath()
  context.moveTo(points[0].x * scale, points[0].y * scale)
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const midX = ((current.x + next.x) / 2) * scale
    const midY = ((current.y + next.y) / 2) * scale
    context.quadraticCurveTo(current.x * scale, current.y * scale, midX, midY)
  }
  const last = points.at(-1)
  context.lineTo(last.x * scale, last.y * scale)
  context.stroke()
}

function replayStrokes(context, scale = 1, variant = 'preview') {
  for (const stroke of strokes.value) {
    const painting = stroke.mode === 'paint'
    context.save()
    if (variant === 'mask') {
      context.globalCompositeOperation = painting ? 'destination-out' : 'source-over'
      context.strokeStyle = '#000'
    } else {
      context.globalCompositeOperation = painting ? 'source-over' : 'destination-out'
      context.strokeStyle = '#8b7bff'
    }
    context.fillStyle = context.strokeStyle
    context.lineWidth = Math.max(1, stroke.size * scale)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    strokePath(context, stroke.points || [], scale)
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
  replayStrokes(workContext, 1, 'preview')
  context.clearRect(0, 0, canvas.width, canvas.height)
  // Composite the opaque working mask at a fixed alpha so overlapping strokes
  // read as one uniform selection instead of stacking darker.
  context.globalAlpha = 0.52
  context.drawImage(work, 0, 0)
  context.globalAlpha = 1
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
  if (!strokes.value.length || props.busy) return
  const stroke = strokes.value.at(-1)
  strokes.value = strokes.value.slice(0, -1)
  redoStrokes.value = [...redoStrokes.value, stroke]
  renderMaskPreview()
  updateMaskCoverage()
}

function redoStroke() {
  if (!redoStrokes.value.length || props.busy) return
  const stroke = redoStrokes.value.at(-1)
  redoStrokes.value = redoStrokes.value.slice(0, -1)
  strokes.value = [...strokes.value, stroke]
  renderMaskPreview()
  updateMaskCoverage()
}

function clearMask() {
  if (props.busy || !strokes.value.length) return
  redoStrokes.value = [...redoStrokes.value, ...strokes.value.slice().reverse()]
  strokes.value = []
  renderMaskPreview()
  updateMaskCoverage()
}

function adjustBrushSize(delta) {
  brushSize.value = Math.min(160, Math.max(12, Number(brushSize.value) + delta))
}

function applyQuickPrompt(text) {
  if (props.busy) return
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
  if (modifier) return
  if (event.key === 'b' || event.key === 'B') brushMode.value = 'paint'
  else if (event.key === 'e' || event.key === 'E') brushMode.value = 'erase'
  else if (event.key === '[') adjustBrushSize(-8)
  else if (event.key === ']') adjustBrushSize(8)
}

async function submitEdit() {
  if (props.busy || loading.value || !objectUrl.value) return
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
  context.fillStyle = '#000'
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
  <Teleport to="body">
    <Transition name="local-mask-dialog" appear>
      <div v-if="open" class="local-mask-backdrop" @click.self="emit('close')">
        <section class="local-mask-dialog" role="dialog" aria-modal="true" aria-label="局部编辑">
          <header>
            <div>
              <strong>局部编辑</strong>
              <small>{{ sourceTitle || '在图片上涂抹需要修改的区域' }}</small>
            </div>
            <span v-if="sourceSizeLabel" class="local-mask-source-size">
              <i class="bi bi-aspect-ratio" aria-hidden="true"></i>{{ sourceSizeLabel }}
            </span>
            <button
              type="button"
              class="local-mask-close"
              aria-label="关闭局部编辑"
              :disabled="busy"
              @click="emit('close')"
            >
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div class="local-mask-workspace">
            <div class="local-mask-stage">
              <!-- 悬浮工具条：画笔 / 尺寸 / 历史 / 显隐 / 清空 -->
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
                    title="涂抹区域（B）"
                    @click="brushMode = 'paint'"
                  >
                    <i class="bi bi-brush"></i><span>涂抹</span>
                  </button>
                  <button
                    type="button"
                    :class="{ 'is-on': brushMode === 'erase' }"
                    :aria-pressed="brushMode === 'erase'"
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
                    aria-label="画笔大小"
                  />
                  <i class="bi bi-circle-fill is-max" aria-hidden="true"></i>
                  <output>{{ brushSize }}</output>
                </div>
                <i class="local-mask-divider" aria-hidden="true"></i>
                <div class="local-mask-icons" role="group" aria-label="蒙版历史">
                  <button
                    type="button"
                    :disabled="!strokes.length || busy"
                    :title="`撤销（${MOD_KEY_LABEL}Z）`"
                    @click="undoStroke"
                  >
                    <i class="bi bi-arrow-counterclockwise"></i>
                  </button>
                  <button
                    type="button"
                    :disabled="!redoStrokes.length || busy"
                    :title="`重做（${MOD_KEY_LABEL}⇧Z）`"
                    @click="redoStroke"
                  >
                    <i class="bi bi-arrow-clockwise"></i>
                  </button>
                  <button
                    type="button"
                    :class="{ 'is-on': !maskVisible }"
                    :aria-pressed="!maskVisible"
                    :title="maskVisible ? '隐藏蒙版查看原图' : '显示蒙版'"
                    @click="maskVisible = !maskVisible"
                  >
                    <i class="bi" :class="maskVisible ? 'bi-eye-slash' : 'bi-eye'"></i>
                  </button>
                  <button
                    type="button"
                    :disabled="!strokes.length || busy"
                    title="清空蒙版"
                    @click="clearMask"
                  >
                    <i class="bi bi-trash3"></i>
                  </button>
                </div>
              </div>

              <div
                class="local-mask-artboard"
                :class="{ 'is-erasing': brushMode === 'erase' }"
                :style="artboardStyle"
                @pointermove="trackCursor"
                @pointerenter="trackCursor"
                @pointerleave="hideCursor"
              >
                <img v-if="objectUrl" :src="objectUrl" alt="待局部编辑的原图" draggable="false" />
                <canvas
                  v-show="objectUrl && maskVisible"
                  ref="canvasRef"
                  aria-label="局部编辑蒙版画布"
                  @pointerdown.prevent="beginStroke"
                  @pointermove.prevent="extendStroke"
                  @pointerup.prevent="endStroke"
                  @pointercancel.prevent="endStroke"
                ></canvas>
                <div
                  v-if="cursor.visible && objectUrl && !busy && !loading"
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
                  <span>正在提交局部编辑…</span>
                </div>
              </div>

              <p class="local-mask-hint" aria-hidden="true">{{ shortcutTip }}</p>
            </div>

            <aside :class="{ 'is-busy': busy }">
              <div class="local-mask-panel-head">
                <span>修改要求</span>
                <em>{{ editPrompt.length }}/2000</em>
              </div>
              <textarea
                ref="textareaRef"
                v-model="editPrompt"
                class="local-mask-textarea"
                rows="7"
                maxlength="2000"
                :disabled="busy"
                placeholder="例如：把选中区域的衣服改为深蓝色皮夹克，保持人物、姿势和其他区域不变"
              ></textarea>
              <div class="local-mask-quick" role="group" aria-label="快捷修改要求">
                <button
                  v-for="quick in QUICK_PROMPTS"
                  :key="quick.label"
                  type="button"
                  :disabled="busy"
                  @click="applyQuickPrompt(quick.text)"
                >
                  <i class="bi bi-stars" aria-hidden="true"></i>{{ quick.label }}
                </button>
              </div>
              <div class="local-mask-legend">
                <p><i class="local-mask-dot" aria-hidden="true"></i>紫色区域将被重新绘制</p>
                <p><i class="local-mask-dot is-keep" aria-hidden="true"></i>未涂抹区域要求模型保持不变</p>
                <p><i class="local-mask-dot is-alt" aria-hidden="true"></i>按住 Alt 涂抹＝临时擦除</p>
              </div>
              <p v-if="error && objectUrl" class="local-mask-error" role="alert">
                <i class="bi bi-exclamation-circle" aria-hidden="true"></i>{{ error }}
              </p>
              <div class="local-mask-footer">
                <span v-if="coverageLabel" class="local-mask-coverage">
                  <i class="bi bi-vector-pen" aria-hidden="true"></i>已覆盖 {{ coverageLabel }}
                </span>
                <span v-else class="local-mask-coverage is-empty">尚未涂抹区域</span>
                <button
                  type="button"
                  class="local-mask-submit"
                  :disabled="busy || loading || !objectUrl || !hasMask || !editPrompt.trim()"
                  :title="submitHint"
                  @click="submitEdit"
                >
                  <i class="bi" :class="busy ? 'bi-arrow-repeat spin' : 'bi-stars'"></i>
                  {{ busy ? '正在提交…' : '生成局部编辑' }}
                  <kbd>{{ MOD_KEY_LABEL }}↵</kbd>
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
  font: 600 0.7rem/1 ui-monospace, monospace;
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
  transition: background 0.15s ease, color 0.15s ease;
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
    radial-gradient(640px 300px at 50% 0%, rgba(124, 108, 255, 0.05), transparent 70%),
    #0d0d12;
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
  transition: background 0.15s ease, color 0.15s ease;
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
  font: 700 0.72rem/1 ui-monospace, monospace;
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
  transition: background 0.15s ease, color 0.15s ease;
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
  font: 600 0.64rem/1.5 ui-monospace, monospace;
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
  background: linear-gradient(90deg, transparent, var(--lm-accent), #cfc5ff, var(--lm-accent), transparent);
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
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
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
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
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
  font: 700 0.7rem/1 ui-monospace, monospace;
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
  transition: filter 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
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
  font: 700 0.6rem/1 ui-monospace, monospace;
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
</style>
