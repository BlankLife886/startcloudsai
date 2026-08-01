<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'

const props = defineProps({
  slides: { type: Array, default: () => [] },
  interval: { type: Number, default: 4200 },
  duration: { type: Number, default: 1.2 },
})

const rootRef = ref(null)
const curtainRef = ref(null)
const activeIndex = ref(0)
const transitioning = ref(false)
const stageWidth = ref(0)
const backSrc = ref('')
const frontSrc = ref('')

let timerId = null
let wipeTween = null
let inView = true
let pageVisible = typeof document !== 'undefined' ? !document.hidden : true
let disposed = false
let intersectionObserver = null
let resizeObserver = null

const sources = computed(() => props.slides.filter(Boolean))

function motionDisabled() {
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function layerStyle(src) {
  return {
    backgroundImage: src ? `url("${src}")` : 'none',
  }
}

function measureStage() {
  if (!rootRef.value) return
  stageWidth.value = Math.ceil(rootRef.value.getBoundingClientRect().width)
}

function syncBuffers(index = activeIndex.value) {
  const list = sources.value
  if (!list.length) {
    frontSrc.value = ''
    backSrc.value = ''
    return
  }
  const current = list[index % list.length]
  const next = list.length > 1 ? list[(index + 1) % list.length] : current
  frontSrc.value = current
  backSrc.value = next
}

function clearTimer() {
  if (!timerId) return
  window.clearTimeout(timerId)
  timerId = null
}

function scheduleNext() {
  clearTimer()
  if (disposed || sources.value.length < 2 || !inView || !pageVisible || transitioning.value) return
  timerId = window.setTimeout(() => {
    void runWipe()
  }, props.interval)
}

function resetCurtain() {
  const curtain = curtainRef.value
  if (!curtain) return
  gsap.set(curtain, { width: '100%', clearProps: 'transform,opacity,filter,clipPath' })
}

async function runWipe() {
  if (disposed || transitioning.value || sources.value.length < 2) return

  if (motionDisabled()) {
    activeIndex.value = (activeIndex.value + 1) % sources.value.length
    syncBuffers()
    await nextTick()
    resetCurtain()
    scheduleNext()
    return
  }

  const curtain = curtainRef.value
  if (!curtain) {
    activeIndex.value = (activeIndex.value + 1) % sources.value.length
    syncBuffers()
    scheduleNext()
    return
  }

  transitioning.value = true
  wipeTween?.kill()
  measureStage()
  syncBuffers()
  await nextTick()
  resetCurtain()

  // 帘幕贴右，宽度收到 0 → 下一张从左到右露出
  wipeTween = gsap.to(curtain, {
    width: 0,
    duration: props.duration,
    ease: 'power3.inOut',
    onComplete: async () => {
      if (disposed) return

      const list = sources.value
      const newIndex = (activeIndex.value + 1) % list.length
      const shown = list[newIndex]
      const upcoming = list[(newIndex + 1) % list.length]

      // 先让帘幕内容换成已露出的图，再拉开，避免露底闪一下
      frontSrc.value = shown
      await nextTick()
      resetCurtain()

      activeIndex.value = newIndex
      backSrc.value = upcoming

      transitioning.value = false
      scheduleNext()
    },
  })
}

function onVisibility() {
  pageVisible = !document.hidden
  if (pageVisible) scheduleNext()
  else clearTimer()
}

watch(
  () => sources.value.join('|'),
  async () => {
    activeIndex.value = 0
    transitioning.value = false
    wipeTween?.kill()
    syncBuffers(0)
    await nextTick()
    measureStage()
    resetCurtain()
    scheduleNext()
  },
  { immediate: true },
)

onMounted(() => {
  measureStage()
  resetCurtain()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', measureStage)

  if (rootRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => measureStage())
    resizeObserver.observe(rootRef.value)
  }

  if (rootRef.value && 'IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        inView = Boolean(entry?.isIntersecting)
        if (inView) scheduleNext()
        else clearTimer()
      },
      { threshold: 0.35 },
    )
    intersectionObserver.observe(rootRef.value)
  }

  scheduleNext()
})

onBeforeUnmount(() => {
  disposed = true
  clearTimer()
  wipeTween?.kill()
  wipeTween = null
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('resize', measureStage)
  resizeObserver?.disconnect()
  resizeObserver = null
  intersectionObserver?.disconnect()
  intersectionObserver = null
})
</script>

<template>
  <div
    ref="rootRef"
    class="commercial-intro-grid"
    :class="{ 'is-transitioning': transitioning }"
    :style="{ '--intro-media-width': stageWidth ? `${stageWidth}px` : '100%' }"
    aria-hidden="true"
  >
    <div v-if="!frontSrc" class="commercial-intro__skeleton"></div>
    <template v-else>
      <div class="commercial-intro-grid__base" :style="layerStyle(backSrc)"></div>
      <div ref="curtainRef" class="commercial-intro-grid__curtain">
        <div class="commercial-intro-grid__curtain-fill" :style="layerStyle(frontSrc)"></div>
      </div>
    </template>
  </div>
</template>
