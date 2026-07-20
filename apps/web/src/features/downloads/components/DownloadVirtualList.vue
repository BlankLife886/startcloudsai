<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 纵向虚拟列表：跟随指定滚动容器（默认最近可滚动祖先 / window），
 * 只渲染可视区 ± overscan。
 */
const props = defineProps({
  items: { type: Array, default: () => [] },
  scrollRoot: { type: Object, default: null },
  desktopItemHeight: { type: Number, default: 118 },
  mobileItemHeight: { type: Number, default: 292 },
  mobileBreakpoint: { type: Number, default: 760 },
  gap: { type: Number, default: 14 },
  overscan: { type: Number, default: 4 },
})

const containerRef = ref(null)
const containerWidth = ref(0)
const viewTop = ref(0)
const viewportHeight = ref(0)
let resizeObserver = null
let scrollRaf = 0
let boundScrollTarget = null

const isMobile = computed(() => containerWidth.value > 0 && containerWidth.value < props.mobileBreakpoint)

const itemStride = computed(() => {
  const height = isMobile.value ? props.mobileItemHeight : props.desktopItemHeight
  return height + props.gap
})

const totalHeight = computed(() => {
  const count = props.items.length
  if (!count) return 0
  return count * itemStride.value - props.gap
})

const range = computed(() => {
  const count = props.items.length
  if (!count) return { start: 0, end: 0 }
  const stride = itemStride.value
  const start = Math.max(0, Math.floor(-viewTop.value / stride) - props.overscan)
  const end = Math.min(
    count,
    Math.max(start, Math.ceil((viewportHeight.value - viewTop.value) / stride) + props.overscan),
  )
  return { start, end }
})

const visibleItems = computed(() =>
  props.items.slice(range.value.start, range.value.end).map((item, offset) => ({
    item,
    index: range.value.start + offset,
  })),
)

const innerStyle = computed(() => ({
  transform: `translate3d(0, ${range.value.start * itemStride.value}px, 0)`,
  display: 'grid',
  gap: `${props.gap}px`,
}))

function resolveScrollTarget() {
  if (props.scrollRoot) return props.scrollRoot
  if (typeof document === 'undefined') return null
  return window
}

function sample() {
  const el = containerRef.value
  if (!el) return
  const scrollTarget = resolveScrollTarget()
  const rect = el.getBoundingClientRect()

  if (scrollTarget && scrollTarget !== window) {
    const parentRect = scrollTarget.getBoundingClientRect()
    viewTop.value = rect.top - parentRect.top
    viewportHeight.value = scrollTarget.clientHeight || 0
  } else {
    viewTop.value = rect.top
    viewportHeight.value = window.innerHeight || 0
  }
}

function handleScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    sample()
  })
}

function bindScrollTarget() {
  const next = resolveScrollTarget()
  if (boundScrollTarget === next) return
  if (boundScrollTarget) {
    boundScrollTarget.removeEventListener('scroll', handleScroll)
  }
  boundScrollTarget = next
  if (boundScrollTarget) {
    boundScrollTarget.addEventListener('scroll', handleScroll, { passive: true })
  }
  sample()
}

watch(
  () => [props.items.length, props.scrollRoot],
  () => {
    bindScrollTarget()
    requestAnimationFrame(sample)
  },
)

onMounted(() => {
  sample()
  resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect?.width || 0
    if (width) containerWidth.value = width
    sample()
  })
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  bindScrollTarget()
  window.addEventListener('resize', handleScroll, { passive: true })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  if (boundScrollTarget) {
    boundScrollTarget.removeEventListener('scroll', handleScroll)
    boundScrollTarget = null
  }
  window.removeEventListener('resize', handleScroll)
})
</script>

<template>
  <div
    ref="containerRef"
    class="download-virtual-list"
    :class="{ 'is-mobile': isMobile }"
    :style="{ height: `${totalHeight}px` }"
  >
    <div class="download-virtual-list__inner" :style="innerStyle">
      <template v-for="entry in visibleItems" :key="entry.item?.id ?? entry.index">
        <slot :item="entry.item" :index="entry.index"></slot>
      </template>
    </div>
  </div>
</template>

<style scoped>
.download-virtual-list {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.download-virtual-list__inner {
  position: absolute;
  inset: 0 0 auto;
  width: 100%;
  will-change: transform;
}
</style>
