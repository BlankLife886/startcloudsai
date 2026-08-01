<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { gsap } from 'gsap'
import OptionWheel from '@/features/home-commercial/components/OptionWheel.vue'

gsap.registerPlugin(ScrollTrigger)

const props = defineProps({
  studios: { type: Array, default: () => [] },
})

const sectionRef = ref(null)
const pinRef = ref(null)
const activeIndex = ref(0)
const wheelPosition = ref(0)
const pinEnabled = ref(false)

let scrollTrigger = null
let syncingFromScroll = false
let preloadLink = null

const labels = computed(() => props.studios.map((entry) => entry.title))
const activeStudio = computed(() => props.studios[activeIndex.value] || null)
const captureWheel = computed(() => !pinEnabled.value)
const stepCount = computed(() => Math.max(props.studios.length, 1))
const activeCover = computed(() => activeStudio.value?.cover || '')

function motionDisabled() {
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function canPin() {
  return (
    !motionDisabled() &&
    window.matchMedia('(min-width: 961px)').matches &&
    props.studios.length > 1
  )
}

function clampIndex(value) {
  const max = Math.max(props.studios.length - 1, 0)
  return Math.min(Math.max(Math.round(value), 0), max)
}

function progressToIndex(progress) {
  const n = stepCount.value
  if (n <= 1) return 0
  return Math.min(n - 1, Math.floor(progress * n + 1e-6))
}

function progressToPosition(progress) {
  const n = stepCount.value
  const max = Math.max(n - 1, 0)
  if (max <= 0) return 0
  return Math.min(max, Math.max(0, progress * n - 0.5))
}

function indexToScrollProgress(index) {
  const n = stepCount.value
  if (n <= 1) return 0
  return (clampIndex(index) + 0.5) / n
}

function preloadNeighbor(index) {
  const next = props.studios[index + 1]?.cover
  if (!next || typeof document === 'undefined') return
  if (!preloadLink) {
    preloadLink = document.createElement('link')
    preloadLink.rel = 'preload'
    preloadLink.as = 'image'
    document.head.appendChild(preloadLink)
  }
  if (preloadLink.href.endsWith(next) || preloadLink.getAttribute('href') === next) return
  preloadLink.href = next
}

function applyScrollProgress(progress) {
  const nextPos = progressToPosition(progress)
  const nextIndex = progressToIndex(progress)
  if (Math.abs(wheelPosition.value - nextPos) > 0.001) {
    wheelPosition.value = nextPos
  }
  if (nextIndex !== activeIndex.value) {
    syncingFromScroll = true
    activeIndex.value = nextIndex
    preloadNeighbor(nextIndex)
    requestAnimationFrame(() => {
      syncingFromScroll = false
    })
  }
}

function scrollToIndex(index) {
  const next = clampIndex(index)
  activeIndex.value = next
  wheelPosition.value = next
  if (!scrollTrigger || !pinEnabled.value) return
  const st = scrollTrigger
  const y = st.start + (st.end - st.start) * indexToScrollProgress(next)
  window.scrollTo({ top: y, behavior: 'smooth' })
}

function onWheelChange(index) {
  if (syncingFromScroll) return
  scrollToIndex(index)
}

function destroyPin() {
  scrollTrigger?.kill(false)
  scrollTrigger = null
}

function setupPin({ preserveScroll = true } = {}) {
  const prevY = window.scrollY || window.pageYOffset || 0
  destroyPin()
  pinEnabled.value = canPin()
  if (!pinEnabled.value || !pinRef.value || !sectionRef.value) return

  const n = stepCount.value
  // 每项约 1/7 屏，快速切完再进下一区
  scrollTrigger = ScrollTrigger.create({
    trigger: sectionRef.value,
    start: 'top top',
    end: () => `+=${Math.max(n, 1) * Math.round(window.innerHeight * 0.14)}`,
    pin: pinRef.value,
    pinSpacing: true,
    scrub: true,
    anticipatePin: 0,
    fastScrollEnd: true,
    invalidateOnRefresh: true,
    onUpdate: (self) => {
      applyScrollProgress(self.progress)
    },
  })

  // 防止创建/refresh 把首屏冲到该 pin 区
  if (preserveScroll && prevY < 120) {
    window.scrollTo(0, 0)
  } else if (preserveScroll) {
    window.scrollTo(0, prevY)
  }
}

function onResize() {
  const shouldPin = canPin()
  if (shouldPin !== pinEnabled.value) {
    setupPin({ preserveScroll: true })
    return
  }
  scrollTrigger?.refresh()
}

watch(
  () => props.studios.length,
  async () => {
    activeIndex.value = 0
    wheelPosition.value = 0
    await nextTick()
    setupPin({ preserveScroll: true })
  },
)

onMounted(async () => {
  const bootY = window.scrollY || 0
  const lockTop = bootY < 80
  if (lockTop) {
    try {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    } catch {
      // ignore
    }
    window.scrollTo(0, 0)
  }

  await nextTick()
  // 等首页其它 ScrollTrigger 初始化完，再创建 pin，减少 refresh 抢滚动
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  setupPin({ preserveScroll: true })
  window.addEventListener('resize', onResize, { passive: true })

  if (lockTop) {
    window.scrollTo(0, 0)
    requestAnimationFrame(() => window.scrollTo(0, 0))
    window.setTimeout(() => {
      if ((window.scrollY || 0) < 200) window.scrollTo(0, 0)
    }, 120)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  destroyPin()
  preloadLink?.remove()
  preloadLink = null
  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'auto'
  } catch {
    // ignore
  }
})
</script>

<template>
  <div ref="sectionRef" class="commercial-storyboard">
    <div ref="pinRef" class="commercial-storyboard__pin">
      <div class="commercial-storyboard__stage">
        <div class="commercial-storyboard__wheel">
          <OptionWheel
            :items="labels"
            :position="wheelPosition"
            :follow-external="pinEnabled"
            :selected-index="activeIndex"
            :capture-wheel="captureWheel"
            :draggable="!pinEnabled"
            :loop="false"
            side="left"
            :font-size="3"
            :spacing="1.4"
            :inset="80"
            :tilt="6"
            :curve="1"
            :blur="1.2"
            :fade="0.25"
            :min-opacity="0.05"
            :smoothing="140"
            text-color="#9aa19a"
            active-color="#141815"
            @change="onWheelChange"
          />
        </div>

        <div class="commercial-storyboard__media">
          <RouterLink
            v-if="activeStudio"
            class="commercial-storyboard__frames"
            :class="`tone-${activeStudio.tone || 'mint'}`"
            :to="activeStudio.to"
            :aria-label="`进入${activeStudio.title}`"
          >
            <img
              v-if="activeCover"
              class="commercial-storyboard__image"
              :src="activeCover"
              :alt="activeStudio.title"
              decoding="async"
              fetchpriority="low"
            />
            <div class="commercial-storyboard__caption">
              <small>{{ activeStudio.english }}</small>
              <strong>{{ activeStudio.title }}</strong>
              <p>{{ activeStudio.description }}</p>
            </div>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
