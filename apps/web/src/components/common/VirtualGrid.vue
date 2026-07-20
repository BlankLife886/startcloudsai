<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  itemKey: { type: [String, Function], default: 'id' },
  minColumnWidth: { type: Number, default: 288 },
  minColumns: { type: Number, default: 1 },
  maxColumns: { type: Number, default: 6 },
  /** When > 0, lock column count (skips width fitting). */
  columns: { type: Number, default: 0 },
  itemHeight: { type: Number, default: 240 },
  gap: { type: Number, default: 16 },
  overscanRows: { type: Number, default: 3 },
  ariaLabel: { type: String, default: '' },
  /** Nested scroll container (HTMLElement or Vue ref). Defaults to window. */
  scrollRoot: { type: Object, default: null },
})

const containerRef = ref(null)
const containerWidth = ref(0)
const containerTop = ref(0)
const viewportHeight = ref(
  typeof window !== 'undefined' ? window.innerHeight || document.documentElement.clientHeight || 720 : 720,
)

let resizeObserver = null
let sampleRaf = 0
let boundScrollTarget = null

const columns = computed(() => {
  const forced = Math.round(Number(props.columns) || 0)
  if (forced > 0) return forced
  const minimum = Math.max(1, Math.round(props.minColumns || 1))
  const maximum = Math.max(minimum, Math.round(props.maxColumns || minimum))
  if (!containerWidth.value) return minimum
  const fitted = Math.floor((containerWidth.value + props.gap) / (props.minColumnWidth + props.gap))
  return Math.min(maximum, Math.max(minimum, fitted))
})

const rowStride = computed(() => Math.max(1, props.itemHeight + props.gap))
const totalRows = computed(() => Math.ceil(props.items.length / columns.value))
const totalHeight = computed(() =>
  totalRows.value ? totalRows.value * rowStride.value - props.gap : 0,
)

function resolveWindowHeight() {
  if (typeof window === 'undefined') return 720
  return window.innerHeight || document.documentElement?.clientHeight || 720
}

const visibleRange = computed(() => {
  const rows = totalRows.value
  if (!rows) return { start: 0, end: 0 }

  const overscan = Math.max(0, props.overscanRows)
  const stride = rowStride.value
  const vh = viewportHeight.value || resolveWindowHeight()
  const total = totalHeight.value

  // 全部内容本就装得进视口：直接全量渲染，避免半屏空白
  if (total > 0 && total <= vh + Math.abs(Math.min(0, containerTop.value)) + stride) {
    return { start: 0, end: rows }
  }

  const rawStart = Math.floor(-containerTop.value / stride) - overscan
  const start = Math.min(rows - 1, Math.max(0, rawStart))
  const rawEnd = Math.ceil((vh - containerTop.value) / stride + overscan)
  const fillRows = Math.ceil(Math.max(vh - Math.max(0, containerTop.value), vh * 0.85) / stride) + overscan + 2
  const end = Math.min(rows, Math.max(start + 1, rawEnd, start + fillRows))
  return { start, end }
})

const visibleItems = computed(() => {
  const startIndex = visibleRange.value.start * columns.value
  const endIndex = visibleRange.value.end * columns.value
  return props.items.slice(startIndex, endIndex).map((item, offset) => ({
    item,
    index: startIndex + offset,
  }))
})

const innerStyle = computed(() => ({
  transform: `translate3d(0, ${visibleRange.value.start * rowStride.value}px, 0)`,
  gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
  gridAutoRows: `${props.itemHeight}px`,
  gap: `${props.gap}px`,
}))

function resolveKey(entry) {
  if (typeof props.itemKey === 'function') return props.itemKey(entry.item, entry.index)
  return entry.item?.[props.itemKey] ?? entry.index
}

function resolveScrollRoot() {
  const raw = props.scrollRoot
  if (!raw) return null
  if (raw instanceof Element) return raw
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    const el = raw.value
    return el instanceof Element ? el : null
  }
  return null
}

function sampleViewport() {
  sampleRaf = 0
  const element = containerRef.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const root = resolveScrollRoot()
  const winH = resolveWindowHeight()

  if (root) {
    const rootRect = root.getBoundingClientRect()
    containerTop.value = rect.top - rootRect.top
    viewportHeight.value = root.clientHeight || rootRect.height || winH
  } else {
    containerTop.value = rect.top
    viewportHeight.value = winH
  }

  if (!containerWidth.value) {
    containerWidth.value = element.clientWidth || rect.width || 0
  }
}

function scheduleSample() {
  if (sampleRaf) return
  sampleRaf = requestAnimationFrame(sampleViewport)
}

function forceSample() {
  if (sampleRaf) {
    cancelAnimationFrame(sampleRaf)
    sampleRaf = 0
  }
  sampleViewport()
  requestAnimationFrame(() => {
    sampleViewport()
  })
}

function unbindScrollTarget() {
  if (!boundScrollTarget) return
  boundScrollTarget.removeEventListener('scroll', scheduleSample)
  boundScrollTarget = null
}

function bindScrollTarget() {
  const next = resolveScrollRoot() || window
  if (boundScrollTarget === next) {
    scheduleSample()
    return
  }
  unbindScrollTarget()
  boundScrollTarget = next
  boundScrollTarget.addEventListener('scroll', scheduleSample, { passive: true })
  scheduleSample()
}

watch(
  () => [props.items.length, props.itemHeight, props.gap, props.minColumnWidth, props.columns],
  () => nextTick(forceSample),
)

watch(
  () => props.scrollRoot,
  () => nextTick(bindScrollTarget),
  { flush: 'post' },
)

onMounted(() => {
  forceSample()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      containerWidth.value = entries[0]?.contentRect?.width || 0
      scheduleSample()
    })
    if (containerRef.value) resizeObserver.observe(containerRef.value)
    const root = resolveScrollRoot()
    if (root) resizeObserver.observe(root)
  } else {
    containerWidth.value = containerRef.value?.clientWidth || 0
  }
  bindScrollTarget()
  window.addEventListener('resize', scheduleSample, { passive: true })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (sampleRaf) cancelAnimationFrame(sampleRaf)
  sampleRaf = 0
  unbindScrollTarget()
  window.removeEventListener('resize', scheduleSample)
})
</script>

<template>
  <div
    ref="containerRef"
    class="virtual-grid"
    role="list"
    :aria-label="ariaLabel || undefined"
    :style="{ height: `${totalHeight}px` }"
  >
    <div class="virtual-grid__inner" :style="innerStyle">
      <template v-for="entry in visibleItems" :key="resolveKey(entry)">
        <slot :item="entry.item" :index="entry.index"></slot>
      </template>
    </div>
  </div>
</template>

<style scoped>
.virtual-grid {
  position: relative;
  width: 100%;
  overflow: hidden;
  contain: layout style;
}

.virtual-grid__inner {
  position: absolute;
  inset: 0 0 auto;
  display: grid;
  will-change: transform;
}
</style>
