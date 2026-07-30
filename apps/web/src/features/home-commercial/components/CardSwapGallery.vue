<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { gsap } from 'gsap'
import ShareProgressiveImage from '@/features/share/components/ShareProgressiveImage.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  delay: { type: Number, default: 4400 },
})

const containerRef = ref(null)
const cards = computed(() => props.items.slice(0, 4))
const order = ref([])
let timeline = null
let interval = 0
let resizeTimer = 0
let intersectionObserver = null
let resizeObserver = null
let inView = true
let pageVisible = !document.hidden
let interactionPaused = false
let animating = false
let disposed = false

function motionDisabled() {
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function cardElements() {
  return containerRef.value ? [...containerRef.value.querySelectorAll('[data-swap-card]')] : []
}

function slotFor(position, total) {
  const mobile = window.matchMedia('(max-width: 760px)').matches
  const xStep = mobile ? 13 : 31
  const yStep = mobile ? 15 : 23
  return {
    x: position * xStep,
    y: position * -yStep,
    z: position * -76,
    scale: 1 - position * 0.035,
    rotationY: position * -1.4,
    rotationZ: position * 0.9,
    zIndex: total - position,
  }
}

function setCard(element, slot) {
  gsap.set(element, {
    ...slot,
    xPercent: -50,
    yPercent: -50,
    autoAlpha: 1,
    transformOrigin: '50% 50%',
    force3D: true,
  })
}

async function initialize() {
  await nextTick()
  if (disposed || !containerRef.value) return
  const elements = cardElements()
  order.value = elements.map((_, index) => index)
  timeline?.kill()
  animating = false
  elements.forEach((element, position) => setCard(element, slotFor(position, elements.length)))
  updateAutoplay()
}

function swap() {
  const elements = cardElements()
  if (animating || motionDisabled() || order.value.length < 2 || elements.length < 2) return

  const [frontIndex, ...remaining] = order.value
  const front = elements[frontIndex]
  if (!front) return

  animating = true
  timeline?.kill()
  timeline = gsap.timeline({
    defaults: { overwrite: 'auto' },
    onComplete: () => {
      order.value = [...remaining, frontIndex]
      animating = false
    },
  })

  timeline.to(front, {
    x: '-=48',
    y: '+=98',
    rotationZ: -4,
    scale: 0.97,
    autoAlpha: 0,
    duration: 0.42,
    ease: 'power3.in',
  })
  timeline.addLabel('promote', '-=0.16')

  remaining.forEach((cardIndex, position) => {
    const element = elements[cardIndex]
    const slot = slotFor(position, elements.length)
    timeline.set(element, { zIndex: slot.zIndex }, 'promote')
    timeline.to(
      element,
      {
        ...slot,
        duration: 0.72,
        ease: 'power3.inOut',
        force3D: true,
      },
      `promote+=${position * 0.035}`,
    )
  })

  const backSlot = slotFor(elements.length - 1, elements.length)
  timeline.set(front, { ...backSlot, autoAlpha: 0 }, 'promote+=0.36')
  timeline.to(
    front,
    {
      autoAlpha: 1,
      duration: 0.34,
      ease: 'power2.out',
    },
    'promote+=0.56',
  )
}

function stopAutoplay() {
  if (!interval) return
  window.clearInterval(interval)
  interval = 0
}

function updateAutoplay() {
  stopAutoplay()
  if (
    motionDisabled() ||
    interactionPaused ||
    !inView ||
    !pageVisible ||
    cards.value.length < 2
  ) {
    return
  }
  interval = window.setInterval(swap, Math.max(2600, props.delay))
}

function pauseInteraction() {
  interactionPaused = true
  timeline?.pause()
  updateAutoplay()
}

function resumeInteraction() {
  interactionPaused = false
  timeline?.resume()
  updateAutoplay()
}

function onVisibilityChange() {
  pageVisible = !document.hidden
  updateAutoplay()
}

function positionOf(index) {
  const position = order.value.indexOf(index)
  return position < 0 ? index : position
}

function linkTarget(item) {
  if (item.to) return item.to
  if (item.id) return { name: 'share', query: { item: item.id } }
  return '/share'
}

onMounted(() => {
  disposed = false
  void initialize()
  intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      inView = entry?.isIntersecting ?? true
      updateAutoplay()
    },
    { rootMargin: '160px 0px', threshold: 0 },
  )
  if (containerRef.value) intersectionObserver.observe(containerRef.value)

  resizeObserver = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      if (!animating) void initialize()
    }, 120)
  })
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true })
})

watch(
  () => cards.value.map((item) => item.id || item.cover).join('|'),
  () => void initialize(),
)

onBeforeUnmount(() => {
  disposed = true
  stopAutoplay()
  window.clearTimeout(resizeTimer)
  timeline?.kill()
  intersectionObserver?.disconnect()
  resizeObserver?.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div
    ref="containerRef"
    class="card-swap-gallery"
    aria-label="精选作品轮播"
    @mouseenter="pauseInteraction"
    @mouseleave="resumeInteraction"
    @focusin="pauseInteraction"
    @focusout="resumeInteraction"
  >
    <RouterLink
      v-for="(item, index) in cards"
      :key="item.id || item.cover || index"
      data-swap-card
      class="swap-art-card"
      :class="{ 'is-front': positionOf(index) === 0 }"
      :to="linkTarget(item)"
      :tabindex="positionOf(index) === 0 ? 0 : -1"
      :aria-hidden="positionOf(index) === 0 ? undefined : 'true'"
    >
      <ShareProgressiveImage
        v-if="item.cover"
        class="swap-art-card__media"
        :src="item.cover"
        :alt="item.title || 'AI 生成作品'"
        :eager="index === 0"
      />
      <div v-else class="swap-art-card__placeholder" aria-hidden="true">
        <span>{{ item.category || 'Creative studio' }}</span>
        <i :class="item.icon || 'bi bi-stars'"></i>
        <small>STAR CLOUDS AI</small>
      </div>
      <div class="swap-art-card__caption">
        <span>{{ item.category || '社区精选' }}</span>
        <strong>{{ item.title || 'AI 生成作品' }}</strong>
        <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
      </div>
    </RouterLink>
  </div>
</template>

<style scoped>
.card-swap-gallery {
  position: relative;
  width: min(520px, 100%);
  height: 570px;
  perspective: 1500px;
  transform-style: preserve-3d;
  isolation: isolate;
}

.swap-art-card {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 70px;
  width: min(420px, calc(100% - 88px));
  height: 500px;
  overflow: hidden;
  color: #f7f7f2;
  text-decoration: none;
  background: #111514;
  border-radius: 8px;
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.45);
  transform-style: preserve-3d;
  backface-visibility: hidden;
  will-change: transform, opacity;
}

.swap-art-card::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.11);
  content: '';
  pointer-events: none;
}

.swap-art-card__media {
  min-height: 0;
  background: #0b0e0d;
}

.swap-art-card__media :deep(img) {
  object-fit: contain;
}

.swap-art-card__placeholder {
  position: relative;
  display: grid;
  min-height: 0;
  place-content: center;
  justify-items: center;
  gap: 14px;
  overflow: hidden;
  color: #74f2d0;
  background: #0d1110;
}

.swap-art-card__placeholder::before,
.swap-art-card__placeholder::after {
  position: absolute;
  content: '';
  pointer-events: none;
}

.swap-art-card__placeholder::before {
  inset: 28px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.065);
}

.swap-art-card__placeholder::after {
  width: 1px;
  height: 140%;
  background: rgba(255, 255, 255, 0.055);
  transform: rotate(35deg);
}

.swap-art-card__placeholder > span,
.swap-art-card__placeholder > small {
  z-index: 1;
  color: rgba(241, 246, 242, 0.42);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  text-transform: uppercase;
}

.swap-art-card__placeholder > i {
  z-index: 1;
  font-size: 68px;
}

.swap-art-card__caption {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  grid-template-rows: 21px 28px;
  align-content: center;
  gap: 0 10px;
  padding: 9px 18px 10px;
  background: rgba(10, 13, 12, 0.92);
}

.swap-art-card__caption span {
  color: #7ae9cc;
  font-size: 12px;
  line-height: 21px;
}

.swap-art-card__caption strong {
  overflow: hidden;
  color: #f7f7f2;
  font-size: 16px;
  font-weight: 600;
  line-height: 28px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.swap-art-card__caption i {
  grid-row: 1 / 3;
  grid-column: 2;
  align-self: center;
  font-size: 20px;
}

.swap-art-card:focus-visible {
  outline: 2px solid #75f4d0;
  outline-offset: 4px;
}

@media (max-width: 760px) {
  .card-swap-gallery {
    width: min(360px, 100%);
    height: 390px;
  }

  .swap-art-card {
    width: min(290px, calc(100% - 42px));
    height: 350px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .swap-art-card {
    will-change: auto;
  }
}
</style>
