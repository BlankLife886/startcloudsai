<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import ShareProgressiveImage from '@/features/share/components/ShareProgressiveImage.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  width: { type: [Number, String], default: 800 },
  height: { type: [Number, String], default: 450 },
  cardDistance: { type: Number, default: 55 },
  verticalDistance: { type: Number, default: 120 },
  delay: { type: Number, default: 3000 },
  pauseOnHover: { type: Boolean, default: false },
  skewAmount: { type: Number, default: 0 },
  easing: { type: String, default: 'elastic' },
})

const containerRef = ref(null)
const order = ref([])
const cards = computed(() => props.items.slice(0, 4))

let timeline = null
let intervalId = null
let intersectionObserver = null
let inView = false
let pageVisible = typeof document !== 'undefined' ? !document.hidden : true
let disposed = false

function motionDisabled() {
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function cssDim(value) {
  return typeof value === 'number' ? `${value}px` : value
}

function cardElements() {
  if (!containerRef.value) return []
  return [...containerRef.value.querySelectorAll('[data-swap-card]')]
}

function makeSlot(index, distX, distY, total) {
  return {
    x: index * distX,
    y: -index * distY,
    z: -index * distX * 1.5,
    zIndex: total - index,
  }
}

function placeNow(element, slot, skew) {
  gsap.set(element, {
    x: slot.x,
    y: slot.y,
    z: slot.z,
    xPercent: -50,
    yPercent: -50,
    skewY: skew,
    transformOrigin: 'center center',
    zIndex: slot.zIndex,
    force3D: true,
  })
}

function getConfig() {
  return props.easing === 'elastic'
    ? {
        ease: 'elastic.out(0.6,0.9)',
        durDrop: 2,
        durMove: 2,
        durReturn: 2,
        promoteOverlap: 0.9,
        returnDelay: 0.05,
      }
    : {
        ease: 'power1.inOut',
        durDrop: 0.8,
        durMove: 0.8,
        durReturn: 0.8,
        promoteOverlap: 0.45,
        returnDelay: 0.2,
      }
}

function applyCardSize(element) {
  element.style.width = cssDim(props.width)
  element.style.height = cssDim(props.height)
}

function init() {
  const elements = cardElements()
  const total = elements.length
  order.value = Array.from({ length: total }, (_, index) => index)
  const skew = motionDisabled() ? 0 : props.skewAmount
  elements.forEach((element, index) => {
    applyCardSize(element)
    placeNow(element, makeSlot(index, props.cardDistance, props.verticalDistance, total), skew)
  })
}

function swap() {
  const elements = cardElements()
  if (disposed || motionDisabled() || order.value.length < 2 || elements.length < 2) return

  const config = getConfig()
  const [front, ...rest] = order.value
  const frontElement = elements[front]
  if (!frontElement) return

  timeline?.kill()
  const tl = gsap.timeline()
  timeline = tl

  tl.to(frontElement, {
    y: '+=500',
    duration: config.durDrop,
    ease: config.ease,
  })
  tl.addLabel('promote', `-=${config.durDrop * config.promoteOverlap}`)

  rest.forEach((cardIndex, index) => {
    const element = elements[cardIndex]
    const slot = makeSlot(index, props.cardDistance, props.verticalDistance, elements.length)
    tl.set(element, { zIndex: slot.zIndex }, 'promote')
    tl.to(
      element,
      {
        x: slot.x,
        y: slot.y,
        z: slot.z,
        duration: config.durMove,
        ease: config.ease,
      },
      `promote+=${index * 0.15}`,
    )
  })

  const backSlot = makeSlot(
    elements.length - 1,
    props.cardDistance,
    props.verticalDistance,
    elements.length,
  )
  tl.addLabel('return', `promote+=${config.durMove * config.returnDelay}`)
  tl.call(
    () => {
      gsap.set(frontElement, { zIndex: backSlot.zIndex })
    },
    undefined,
    'return',
  )
  tl.to(
    frontElement,
    {
      x: backSlot.x,
      y: backSlot.y,
      z: backSlot.z,
      duration: config.durReturn,
      ease: config.ease,
    },
    'return',
  )
  tl.call(() => {
    order.value = [...rest, front]
  })
}

function stopAutoplay() {
  if (intervalId === null) return
  window.clearInterval(intervalId)
  intervalId = null
}

function startAutoplay() {
  stopAutoplay()
  if (
    motionDisabled() ||
    !inView ||
    !pageVisible ||
    cards.value.length < 2
  ) {
    return
  }
  intervalId = window.setInterval(swap, Math.max(3000, props.delay))
}

function updateAutoplay() {
  stopAutoplay()
  startAutoplay()
}

function pauseInteraction() {
  if (!props.pauseOnHover) return
  timeline?.pause()
  stopAutoplay()
}

function resumeInteraction() {
  if (!props.pauseOnHover) return
  timeline?.play()
  startAutoplay()
}

function onVisibilityChange() {
  pageVisible = !document.hidden
  if (!pageVisible) {
    timeline?.pause()
    stopAutoplay()
    return
  }
  if (!props.pauseOnHover || !containerRef.value?.matches(':hover')) {
    timeline?.play()
    startAutoplay()
  }
}

function positionOf(index) {
  const position = order.value.indexOf(index)
  return position < 0 ? index : position
}

async function boot({ playImmediate = false } = {}) {
  await nextTick()
  if (disposed || !containerRef.value) return
  timeline?.kill()
  timeline = null
  init()
  if (playImmediate && !motionDisabled() && cards.value.length > 1) {
    swap()
  }
  updateAutoplay()
}

onMounted(() => {
  disposed = false
  void boot({ playImmediate: true })

  intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      inView = entry?.isIntersecting ?? false
      if (!inView) {
        timeline?.pause()
        stopAutoplay()
        return
      }
      timeline?.play()
      updateAutoplay()
    },
    { rootMargin: '120px 0px', threshold: 0 },
  )
  if (containerRef.value) intersectionObserver.observe(containerRef.value)
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true })
})

watch(
  () =>
    [
      cards.value.map((item) => item.id || item.cover).join('|'),
      props.width,
      props.height,
      props.cardDistance,
      props.verticalDistance,
      props.delay,
      props.pauseOnHover,
      props.skewAmount,
      props.easing,
    ].join(':'),
  () => void boot({ playImmediate: true }),
)

onBeforeUnmount(() => {
  disposed = true
  stopAutoplay()
  timeline?.kill()
  timeline = null
  intersectionObserver?.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div
    ref="containerRef"
    class="card-swap-gallery"
    role="region"
    aria-roledescription="carousel"
    aria-label="创作工作台预览"
    :style="{ width: cssDim(width), height: cssDim(height) }"
    @mouseenter="pauseInteraction"
    @mouseleave="resumeInteraction"
  >
    <article
      v-for="(item, index) in cards"
      :key="item.id || item.cover || index"
      data-swap-card
      class="swap-art-card"
      :class="[`tone-${item.tone || 'mint'}`, { 'is-front': positionOf(index) === 0 }]"
      :aria-hidden="positionOf(index) === 0 ? undefined : 'true'"
    >
      <div class="swap-art-card__windowbar">
        <i :class="item.icon || 'bi bi-stars'" aria-hidden="true"></i>
        <strong>{{ item.title || 'AI 图像创作' }}</strong>
      </div>
      <ShareProgressiveImage
        v-if="item.cover"
        class="swap-art-card__media"
        :src="item.cover"
        :alt="item.title || 'AI 生成作品'"
        :eager="index === 0"
      />
      <div v-else class="swap-art-card__placeholder" aria-hidden="true">
        <span class="swap-art-card__fluid swap-art-card__fluid--one"></span>
        <span class="swap-art-card__fluid swap-art-card__fluid--two"></span>
        <span class="swap-art-card__fluid swap-art-card__fluid--three"></span>
        <span class="swap-art-card__orb">{{ item.index || String(index + 1).padStart(2, '0') }}</span>
      </div>
    </article>
  </div>
</template>

<style scoped>
.card-swap-gallery {
  position: relative;
  flex-shrink: 0;
  overflow: visible;
  perspective: 1200px;
  transform: translate(20%, 50%);
  transform-origin: center center;
  pointer-events: none;
}

.swap-art-card {
  --card-accent: #72f7d0;
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  grid-template-rows: 56px minmax(0, 1fr);
  overflow: hidden;
  color: #f7f7f2;
  background: rgba(8, 10, 12, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 22px;
  box-shadow:
    0 22px 56px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  transform-style: preserve-3d;
  backface-visibility: hidden;
  will-change: transform;
}

.swap-art-card.tone-blue { --card-accent: #67b7ff; }
.swap-art-card.tone-coral { --card-accent: #ff6f70; }
.swap-art-card.tone-yellow { --card-accent: #ffd15c; }
.swap-art-card.tone-violet { --card-accent: #a993ff; }
.swap-art-card.tone-green { --card-accent: #8bd769; }

.swap-art-card__windowbar {
  position: relative;
  z-index: 3;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  color: rgba(255, 255, 255, 0.96);
  background: rgba(0, 0, 0, 0.38);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  backdrop-filter: blur(20px) saturate(1.1);
  -webkit-backdrop-filter: blur(20px) saturate(1.1);
}

.swap-art-card__windowbar > i {
  color: rgba(255, 255, 255, 0.92);
  font-size: 16px;
}

.swap-art-card__windowbar > strong {
  overflow: hidden;
  font-size: 16px;
  font-weight: 520;
  letter-spacing: -0.025em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.swap-art-card__media {
  position: relative;
  min-height: 0;
  background: rgba(0, 0, 0, 0.35);
}

.swap-art-card__media :deep(img) {
  object-fit: cover;
  object-position: center;
  opacity: 0.82;
  filter: saturate(1.02) contrast(1.04) brightness(0.92);
}

.swap-art-card__media::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.12), transparent 40%, rgba(0, 0, 0, 0.28));
  content: '';
  pointer-events: none;
}

.swap-art-card__placeholder {
  position: relative;
  min-height: 0;
  overflow: hidden;
  color: #fff;
  background:
    radial-gradient(ellipse at 50% 58%, rgba(255, 255, 255, 0.06), transparent 34%),
    linear-gradient(145deg, rgba(20, 22, 26, 0.55), rgba(0, 0, 0, 0.62) 58%, rgba(0, 0, 0, 0.72));
}

.swap-art-card__placeholder::before {
  position: absolute;
  inset: 0;
  z-index: 2;
  opacity: 0.2;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 140 140' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E");
  content: '';
  mix-blend-mode: screen;
  pointer-events: none;
}

.swap-art-card__fluid {
  position: absolute;
  display: block;
  border: clamp(18px, 3.2vw, 42px) solid rgba(238, 238, 238, 0.55);
  border-radius: 48% 52% 54% 46% / 42% 46% 54% 58%;
  filter: blur(2px);
  transform: rotate(var(--fluid-rotate, 0deg));
}

.swap-art-card__fluid::after {
  position: absolute;
  inset: -14px;
  border: 4px solid rgba(255, 255, 255, 0.16);
  border-radius: inherit;
  content: '';
  filter: blur(7px);
}

.swap-art-card__fluid--one {
  --fluid-rotate: 20deg;
  top: 24%;
  left: -16%;
  width: 72%;
  height: 47%;
  border-right-color: rgba(245, 245, 245, 0.22);
  border-bottom-color: rgba(255, 255, 255, 0.32);
}

.swap-art-card__fluid--two {
  --fluid-rotate: -28deg;
  right: -8%;
  bottom: 9%;
  width: 62%;
  height: 52%;
  border-left-color: rgba(255, 255, 255, 0.26);
  border-top-color: rgba(255, 255, 255, 0.38);
}

.swap-art-card__fluid--three {
  --fluid-rotate: 52deg;
  right: 23%;
  bottom: 4%;
  width: 32%;
  height: 25%;
  border-width: clamp(12px, 2vw, 24px);
  opacity: 0.62;
}

.swap-art-card__orb {
  position: absolute;
  top: 54%;
  left: 52%;
  z-index: 1;
  color: rgba(255, 255, 255, 0.22);
  font-family: Georgia, serif;
  font-size: clamp(96px, 14vw, 180px);
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 0 24px rgba(255, 255, 255, 0.12);
  transform: translate(-50%, -50%) rotate(-7deg);
}

@media (max-width: 1180px) {
  .card-swap-gallery {
    transform: translate(20%, 50%) scale(0.9);
  }
}

@media (max-width: 960px) {
  .card-swap-gallery {
    transform: translate(20%, 50%) scale(0.82);
  }
}





@media (prefers-reduced-motion: reduce) {
  .swap-art-card {
    will-change: auto;
  }
}
</style>
