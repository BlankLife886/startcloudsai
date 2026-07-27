<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// 全屏图片预览：缩放/平移/键盘导航自管理；样式在 assistant-workspace.css
// 的 .image-viewer 系列（teleport 到 body，不带 .assistant-workspace 前缀）。
const props = defineProps({
  image: { type: Object, default: null },
})
const emit = defineEmits(['close', 'step', 'download'])

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const ZOOM_STEP = 0.25

const frame = ref(null)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const panning = ref(false)
const naturalSize = ref({ width: 0, height: 0 })
let panStart = null

const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
const imageStyle = computed(() => ({
  transform: `translate3d(${panX.value}px, ${panY.value}px, 0) scale(${zoom.value})`,
}))
const positionLabel = computed(() => {
  const gallery = props.image?.gallery || []
  return gallery.length > 1 ? `${props.image.index + 1} / ${gallery.length}` : ''
})
const dimensionsLabel = computed(() => {
  const width = Number(naturalSize.value.width || props.image?.width || 0)
  const height = Number(naturalSize.value.height || props.image?.height || 0)
  return width > 0 && height > 0 ? `${Math.round(width)}×${Math.round(height)}` : ''
})

function resetView() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  panning.value = false
  panStart = null
}

watch(
  () => `${props.image?.index}-${props.image?.dataUrl}`,
  () => {
    naturalSize.value = { width: 0, height: 0 }
    resetView()
  },
)

function clampPan() {
  const element = frame.value
  if (!element || zoom.value <= 1) {
    panX.value = 0
    panY.value = 0
    return
  }
  const rect = element.getBoundingClientRect()
  const naturalWidth = Number(naturalSize.value.width || rect.width)
  const naturalHeight = Number(naturalSize.value.height || rect.height)
  const fitScale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const scaledWidth = naturalWidth * fitScale * zoom.value
  const scaledHeight = naturalHeight * fitScale * zoom.value
  const maxX = Math.max(0, (scaledWidth - rect.width) / 2)
  const maxY = Math.max(0, (scaledHeight - rect.height) / 2)
  panX.value = Math.min(maxX, Math.max(-maxX, panX.value))
  panY.value = Math.min(maxY, Math.max(-maxY, panY.value))
}

function setZoom(value) {
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(Number(value || 1) * 100) / 100))
  requestAnimationFrame(clampPan)
}

function zoomBy(delta) {
  setZoom(zoom.value + delta)
}

function handleWheel(event) {
  zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
}

function toggleZoom() {
  setZoom(zoom.value === 1 ? 2 : 1)
}

function handleLoad(event) {
  naturalSize.value = {
    width: Number(event?.target?.naturalWidth || 0),
    height: Number(event?.target?.naturalHeight || 0),
  }
  clampPan()
}

function startPan(event) {
  if (event.button !== 0 || zoom.value <= 1) return
  event.preventDefault()
  panning.value = true
  panStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: panX.value,
    panY: panY.value,
  }
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function movePan(event) {
  if (!panning.value || panStart?.pointerId !== event.pointerId) return
  panX.value = panStart.panX + event.clientX - panStart.x
  panY.value = panStart.panY + event.clientY - panStart.y
  clampPan()
}

function endPan(event) {
  if (panStart?.pointerId !== event.pointerId) return
  event.currentTarget?.releasePointerCapture?.(event.pointerId)
  panning.value = false
  panStart = null
}

function handleKeydown(event) {
  if (!props.image) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    emit('step', event.key === 'ArrowLeft' ? -1 : 1)
  } else if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomBy(ZOOM_STEP)
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    zoomBy(-ZOOM_STEP)
  } else if (event.key === '0') {
    event.preventDefault()
    resetView()
  }
}

watch(
  () => props.image,
  (image) => {
    document.documentElement.classList.toggle('assistant-image-viewer-open', Boolean(image))
  },
  { flush: 'post' },
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', clampPan, { passive: true })
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('assistant-image-viewer-open')
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', clampPan)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="image-viewer-fade">
      <div
        v-if="image"
        class="image-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="生成图片全屏预览"
        @click.self="emit('close')"
      >
        <header class="image-viewer__head">
          <div class="image-viewer__title">
            <strong>全屏预览</strong>
            <small v-if="positionLabel">{{ positionLabel }}</small>
            <small>{{ image.revisedPrompt || image.name || 'AI 生成图片' }}</small>
            <small v-if="dimensionsLabel" class="is-size">{{ dimensionsLabel }}</small>
          </div>
        </header>

        <div class="image-viewer__actions" aria-label="预览操作" @click.stop>
          <button
            type="button"
            title="下载原图"
            aria-label="下载原图"
            @click="emit('download', image)"
          >
            <i class="bi bi-download"></i>
          </button>
          <button type="button" title="关闭预览" aria-label="关闭预览" @click="emit('close')">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div class="image-viewer__stage">
          <button
            v-if="image.gallery.length > 1"
            class="image-viewer__nav is-previous"
            type="button"
            title="上一张"
            aria-label="上一张"
            @click.stop="emit('step', -1)"
          >
            <i class="bi bi-chevron-left"></i>
          </button>
          <div
            ref="frame"
            class="image-viewer__frame"
            :class="{ 'is-zoomed': zoom > 1, 'is-panning': panning }"
            @wheel.prevent="handleWheel"
            @dblclick.prevent="toggleZoom"
            @pointerdown="startPan"
            @pointermove="movePan"
            @pointerup="endPan"
            @pointercancel="endPan"
          >
            <div
              :key="`${image.index}-${image.dataUrl}`"
              class="image-viewer__image-layer"
              :style="imageStyle"
            >
              <img
                :src="image.dataUrl"
                :alt="image.revisedPrompt || image.name || 'AI 生成图片'"
                draggable="false"
                @load="handleLoad"
                @dragstart.prevent
              />
            </div>
          </div>
          <button
            v-if="image.gallery.length > 1"
            class="image-viewer__nav is-next"
            type="button"
            title="下一张"
            aria-label="下一张"
            @click.stop="emit('step', 1)"
          >
            <i class="bi bi-chevron-right"></i>
          </button>
        </div>

        <div class="image-viewer__zoom-tools" aria-label="图片缩放工具" @click.stop>
          <button
            type="button"
            :disabled="zoom <= MIN_ZOOM"
            aria-label="缩小图片"
            @click="zoomBy(-ZOOM_STEP)"
          >
            <i class="bi bi-zoom-out"></i><span>缩小</span>
          </button>
          <output>{{ zoomLabel }}</output>
          <button
            type="button"
            :disabled="zoom >= MAX_ZOOM"
            aria-label="放大图片"
            @click="zoomBy(ZOOM_STEP)"
          >
            <i class="bi bi-zoom-in"></i><span>放大</span>
          </button>
          <button type="button" aria-label="适应屏幕" @click="resetView">
            <i class="bi bi-arrows-angle-contract"></i><span>适应屏幕</span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
