<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 轻量窗口化网格：跟随整页滚动，只渲染可视行 ± overscan 行，
 * 其余高度用占位撑起，保证滚动条稳定。
 */
const props = defineProps({
  items: { type: Array, default: () => [] },
  minColumnWidth: { type: Number, default: 220 },
  minColumns: { type: Number, default: 1 },
  gap: { type: Number, default: 16 },
  aspectRatio: { type: Number, default: 1.32 },
  metaHeight: { type: Number, default: 0 },
  overscanRows: { type: Number, default: 2 },
})

const containerRef = ref(null)
const containerWidth = ref(0)
const viewTop = ref(0)
const viewportHeight = ref(0)

let resizeObserver = null
let scrollRaf = 0

const columns = computed(() => {
  const width = containerWidth.value
  const minimum = Math.max(1, Math.round(props.minColumns || 1))
  if (!width) return minimum
  return Math.max(minimum, Math.floor((width + props.gap) / (props.minColumnWidth + props.gap)))
})

const columnWidth = computed(() => {
  const cols = columns.value
  return Math.max(1, (containerWidth.value - props.gap * (cols - 1)) / cols)
})

const rowHeight = computed(
  () => columnWidth.value / props.aspectRatio + props.metaHeight + props.gap,
)

const totalRows = computed(() => Math.ceil(props.items.length / columns.value))

const totalHeight = computed(() => (totalRows.value ? totalRows.value * rowHeight.value : 0))

const rowRange = computed(() => {
  const rows = totalRows.value
  if (!rows) return { start: 0, end: 0 }
  const height = rowHeight.value
  const overscan = props.overscanRows
  const start = Math.min(rows, Math.max(0, Math.floor(-viewTop.value / height) - overscan))
  const end = Math.min(
    rows,
    Math.max(start, Math.ceil((viewportHeight.value - viewTop.value) / height) + overscan),
  )
  return { start, end }
})

const visibleItems = computed(() => {
  const cols = columns.value
  const { start, end } = rowRange.value
  return props.items.slice(start * cols, end * cols).map((item, offset) => ({
    item,
    index: start * cols + offset,
  }))
})

const innerStyle = computed(() => ({
  transform: `translate3d(0, ${rowRange.value.start * rowHeight.value}px, 0)`,
  display: 'grid',
  gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
  gap: `${props.gap}px`,
}))

function sample() {
  const el = containerRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  viewTop.value = rect.top
  viewportHeight.value = window.innerHeight || 0
}

function handleScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    sample()
  })
}

onMounted(() => {
  sample()
  resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect?.width || 0
    if (width) containerWidth.value = width
    sample()
  })
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', handleScroll, { passive: true })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', handleScroll)
})
</script>

<template>
  <div ref="containerRef" class="home-virtual-grid" :style="{ height: `${totalHeight}px` }">
    <div class="home-virtual-grid__inner" :style="innerStyle">
      <template v-for="entry in visibleItems" :key="entry.item?.id ?? entry.index">
        <slot :item="entry.item" :index="entry.index"></slot>
      </template>
    </div>
  </div>
</template>

<style scoped>
.home-virtual-grid {
  position: relative;
  overflow: hidden;
  width: 100%;
}

.home-virtual-grid__inner {
  position: absolute;
  inset: 0 0 auto;
  will-change: transform;
}
</style>
