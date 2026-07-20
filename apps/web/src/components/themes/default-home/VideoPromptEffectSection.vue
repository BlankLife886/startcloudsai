<script setup>
import RetryableImage from '@/components/common/RetryableImage.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  wallpapers: {
    type: Array,
    default: () => [],
  },
})

const CARD_COUNT = 24
const IMAGE_SOURCE_BUDGET = 12
const shellRef = ref(null)
const carouselRef = ref(null)
const hasEnteredView = ref(false)
const isHovering = ref(false)
const isDragging = ref(false)

let progress = 0.12
let viewportWidth = 1200
/** 容器尺寸监听，避免仅依赖 window.innerWidth（侧栏/内边距变化时也能更新） */
let shellResizeObserver = null
let visibilityObserver = null
let snapRafId = 0
let snapStartProgress = 0
let snapDelta = 0
let snapStartTs = 0
let dragStartX = 0
let dragLastX = 0
let dragLastTs = 0
let dragVelocity = 0
let hasDragged = false
let dragStartCardIndex = -1
let cardElements = []

function findCardFromEvent(event) {
  const path = event.composedPath?.() || []
  return (
    path.find((element) => element?.classList?.contains?.('video-prompt-hero__card')) ||
    event.target?.closest?.('.video-prompt-hero__card')
  )
}

function findInteractiveCard(event) {
  const eventCard = findCardFromEvent(event)
  if (eventCard) {
    return {
      element: eventCard,
      index: Number(eventCard.dataset?.cardIndex ?? -1),
      source: 'event-path',
    }
  }

  const pointMatch = findCardFromProjectedPoint(event)
  if (!pointMatch) return null

  return {
    element: pointMatch.element,
    index: pointMatch.index,
    source: 'point-rect',
    rect: pointMatch.rect,
    opacity: pointMatch.opacity,
    zIndex: pointMatch.zIndex,
    distance: pointMatch.distance,
    isInside: pointMatch.isInside,
  }
}

const displayItems = computed(() => {
  if (!hasEnteredView.value) return []

  const source = props.wallpapers
    .map(toDisplayItem)
    .filter((item) => item?.src && !item.src.startsWith('/video-prompt-effect/'))
    .slice(0, IMAGE_SOURCE_BUDGET)

  if (!source.length) return []

  return Array.from({ length: CARD_COUNT }, (_, index) => ({
    ...source[index % source.length],
    loopKey: `${source[index % source.length].id}-${index}`,
  }))
})

function normalize(value) {
  return ((value % 1) + 1) % 1
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function signedDistance(value) {
  return normalize(value + 0.5) - 0.5
}

function easeOutCubic(value) {
  const t = clamp(value, 0, 1)
  return 1 - Math.pow(1 - t, 3)
}

function toDisplayItem(wallpaper, index) {
  const thumbs = wallpaper?.thumbs || {}
  const src = thumbs.original || ''
  if (!src) return null

  return {
    id: wallpaper?.id || `video-card-${index}`,
    src,
    alt: wallpaper?.id ? `Wallpaper ${wallpaper.id}` : '',
  }
}

function getResponsiveLayoutMetrics(containerWidth) {
  const w = Math.max(200, containerWidth)
  const layoutScale = clamp(w / 1920, 0.46, 1)
  const cardWidth = clamp(180, 520 * layoutScale, 520)
  const cardHeight = cardWidth * 0.78
  const radius = 1380 * layoutScale
  return { cardWidth, cardHeight, radius, layoutScale }
}

function getCardLayout(index, total) {
  const { cardWidth, cardHeight, radius, layoutScale } = getResponsiveLayoutMetrics(viewportWidth)
  const count = Math.max(total, 1)
  const slot = signedDistance(index / count - progress) * count
  const absSlot = Math.abs(slot)
  const visible = 1 - smoothstep(5.15, 6.05, absSlot)
  const sideProgress = clamp(absSlot / 5.2, 0, 1)
  const direction = slot < 0 ? -1 : 1
  const angleStep = (cardWidth * 0.88) / radius
  const angle = slot * angleStep
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const curve = Math.pow(sideProgress, 1.18)
  const x = sin * radius
  const z = -(cos * radius * 0.36)
  const y = (40 - curve * 68) * layoutScale
  const rotateY = ((-angle * 180) / Math.PI) * 0.82
  const rotateX = 0.35
  const rotateZ = direction * curve * -0.16
  const scale = 0.965 + curve * 0.075
  const opacity = Math.max(0, visible)
  const brightness = 1
  const shadeOpacity = 0
  const sideLightOpacity = 0
  const shadeAngle = direction < 0 ? 92 : 268
  const imageShift = direction * curve * 2.8
  const edgeGlow = 0
  const pointerEvents = visible > 0.12 ? 'auto' : 'none'

  return {
    cardWidth,
    cardHeight,
    x,
    y,
    z,
    rotateY,
    rotateX,
    rotateZ,
    scale,
    opacity,
    brightness,
    shadeOpacity,
    sideLightOpacity,
    shadeAngle,
    imageShift,
    edgeGlow,
    sideProgress,
    pointerEvents,
    visible,
  }
}

function cardStyle(index, total) {
  const layout = getCardLayout(index, total)

  return {
    '--card-width': `${layout.cardWidth.toFixed(2)}px`,
    '--card-height': `${layout.cardHeight.toFixed(2)}px`,
    '--card-x': `${layout.x.toFixed(2)}px`,
    '--card-y': `${layout.y.toFixed(2)}px`,
    '--card-z': `${layout.z.toFixed(2)}px`,
    '--card-rotate-y': `${layout.rotateY.toFixed(2)}deg`,
    '--card-rotate-x': `${layout.rotateX.toFixed(2)}deg`,
    '--card-rotate-z': `${layout.rotateZ.toFixed(2)}deg`,
    '--card-scale': layout.scale.toFixed(4),
    '--card-opacity': layout.opacity.toFixed(4),
    '--card-brightness': layout.brightness.toFixed(4),
    '--card-shade-opacity': layout.shadeOpacity.toFixed(4),
    '--card-side-light-opacity': layout.sideLightOpacity.toFixed(4),
    '--card-shade-angle': `${layout.shadeAngle}deg`,
    '--card-image-shift': `${layout.imageShift.toFixed(2)}%`,
    '--card-edge-glow': layout.edgeGlow.toFixed(4),
    '--card-z-index': String(Math.round(layout.sideProgress * 1000 + layout.visible * 120)),
    '--card-pointer-events': layout.pointerEvents,
  }
}

function findCardFromProjectedPoint(event) {
  const total = displayItems.value.length
  const carouselRect = carouselRef.value?.getBoundingClientRect?.()
  if (!total || !carouselRect) return null

  const pointerX = event.clientX - (carouselRect.left + carouselRect.width / 2)
  const pointerY = event.clientY - (carouselRect.top + carouselRect.height / 2)
  let bestMatch = null
  let bestScore = Number.POSITIVE_INFINITY

  for (let index = 0; index < total; index += 1) {
    const layout = getCardLayout(index, total)
    if (layout.opacity < 0.12) continue

    const halfWidth = layout.cardWidth * layout.scale * 0.5
    const halfHeight = layout.cardHeight * layout.scale * 0.5
    const dx = Math.abs(pointerX - layout.x)
    const dy = Math.abs(pointerY - layout.y)
    const isInside = dx <= halfWidth && dy <= halfHeight
    const overflowX = Math.max(0, dx - halfWidth)
    const overflowY = Math.max(0, dy - halfHeight)
    const distance = Math.hypot(overflowX, overflowY)
    const score =
      distance +
      Math.abs(pointerX - layout.x) * 0.08 -
      layout.opacity * 80 -
      layout.sideProgress * 8

    if (isInside || distance < 54) {
      if (score < bestScore) {
        bestScore = score
        bestMatch = {
          element: cardElements[index],
          index,
          rect: null,
          opacity: layout.opacity,
          zIndex: Math.round(layout.sideProgress * 1000 + layout.visible * 120),
          distance,
          isInside,
        }
      }
    }
  }

  return bestMatch
}

function setCardRef(element, index) {
  if (element) {
    cardElements[index] = element
  } else {
    cardElements[index] = null
  }
}

function applyCardStyles() {
  const total = displayItems.value.length
  if (!total) return

  for (let index = 0; index < total; index += 1) {
    const element = cardElements[index]
    if (!element) continue

    const styles = cardStyle(index, total)
    Object.entries(styles).forEach(([key, value]) => {
      element.style.setProperty(key, value)
    })
  }
}

function updateViewportWidth() {
  if (typeof window === 'undefined') return
  const next = shellRef.value?.clientWidth || window.innerWidth || 1200
  if (Math.abs(next - viewportWidth) < 0.5) return
  viewportWidth = next
  applyCardStyles()
}

function stopSnapAnimation() {
  if (snapRafId) {
    window.cancelAnimationFrame(snapRafId)
    snapRafId = 0
  }
  snapStartTs = 0
}

function runSnapAnimation(ts) {
  if (!snapStartTs) snapStartTs = ts
  const elapsed = ts - snapStartTs
  const eased = easeOutCubic(elapsed / 460)
  progress = normalize(snapStartProgress + snapDelta * eased)
  applyCardStyles()

  if (elapsed >= 460) {
    progress = normalize(snapStartProgress + snapDelta)
    applyCardStyles()
    stopSnapAnimation()
    return
  }

  snapRafId = window.requestAnimationFrame(runSnapAnimation)
}

function centerCard(index, total) {
  if (typeof window === 'undefined' || !total) return
  const target = normalize(index / total)
  const delta = signedDistance(target - progress)
  if (Math.abs(delta) < 0.0005) return

  stopSnapAnimation()
  snapStartProgress = progress
  snapDelta = delta
  snapStartTs = 0
  snapRafId = window.requestAnimationFrame(runSnapAnimation)
}

function handlePointerEnter() {
  isHovering.value = true
}

function handlePointerLeave() {
  if (!isDragging.value) {
    isHovering.value = false
  }
}

function handlePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return
  stopSnapAnimation()
  const card = findInteractiveCard(event)
  isDragging.value = true
  isHovering.value = true
  dragStartX = event.clientX
  dragLastX = event.clientX
  dragLastTs = event.timeStamp || performance.now()
  dragVelocity = 0
  hasDragged = false
  dragStartCardIndex = Number(card?.index ?? -1)
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function handlePointerMove(event) {
  if (!isDragging.value) return
  const width = Math.max(viewportWidth, 1)
  const delta = event.clientX - dragLastX
  const totalDelta = event.clientX - dragStartX
  const now = event.timeStamp || performance.now()
  const dt = Math.max(now - dragLastTs, 16)
  dragLastX = event.clientX
  dragLastTs = now
  if (Math.abs(totalDelta) > 6) hasDragged = true
  dragVelocity = delta / dt
  progress = normalize(progress - (delta / width) * 0.86)
  applyCardStyles()
}

function endPointerDrag(event) {
  if (!isDragging.value) return
  isDragging.value = false
  event.currentTarget?.releasePointerCapture?.(event.pointerId)
  if (!hasDragged && dragStartCardIndex >= 0) {
    centerCard(dragStartCardIndex, displayItems.value.length)
  }
  dragStartCardIndex = -1
}

onMounted(() => {
  updateViewportWidth()
  window.addEventListener('resize', updateViewportWidth)
  void nextTick(() => {
    if (typeof ResizeObserver !== 'undefined' && shellRef.value) {
      shellResizeObserver = new ResizeObserver(() => {
        updateViewportWidth()
      })
      shellResizeObserver.observe(shellRef.value)
    }
    if (typeof IntersectionObserver !== 'undefined' && shellRef.value) {
      visibilityObserver = new IntersectionObserver(
        ([entry]) => {
          const isInView = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0.08)
          if (!isInView && isDragging.value) return
          if (isInView) {
            hasEnteredView.value = true
            visibilityObserver?.disconnect()
            visibilityObserver = null
          }
        },
        { threshold: [0, 0.08, 0.22], rootMargin: '240px 0px 360px 0px' },
      )
      visibilityObserver.observe(shellRef.value)
    } else {
      hasEnteredView.value = true
    }
    applyCardStyles()
  })
})

onBeforeUnmount(() => {
  stopSnapAnimation()
  window.removeEventListener('resize', updateViewportWidth)
  shellResizeObserver?.disconnect()
  visibilityObserver?.disconnect()
  shellResizeObserver = null
  visibilityObserver = null
})

watch(displayItems, () => {
  cardElements = cardElements.slice(0, displayItems.value.length)
  void nextTick(() => {
    updateViewportWidth()
    applyCardStyles()
  })
})
</script>

<template>
  <section
    ref="shellRef"
    class="video-prompt-hero"
    :class="{ 'video-prompt-hero--entered': hasEnteredView }"
    aria-label="收藏数排行壁纸轮播"
  >
    <div
      class="video-prompt-hero__shell"
      @pointerenter="handlePointerEnter"
      @pointerleave="handlePointerLeave"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="endPointerDrag"
      @pointercancel="endPointerDrag"
    >
      <div v-if="displayItems.length" ref="carouselRef" class="video-prompt-hero__carousel">
        <div class="video-prompt-hero__stage">
          <article
            v-for="(item, index) in displayItems"
            :key="item.loopKey"
            :ref="(element) => setCardRef(element, index)"
            class="video-prompt-hero__card"
            :data-card-index="index"
            :style="cardStyle(index, displayItems.length)"
          >
            <div class="video-prompt-hero__card-plane">
              <RetryableImage :src="item.src" :alt="item.alt" loading="lazy" :draggable="false" />
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.video-prompt-hero {
  position: relative;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 0 max(0px, env(safe-area-inset-right)) 0 max(0px, env(safe-area-inset-left));
  background: transparent;
  opacity: 0;
  transform: translate3d(0, 24px, 0) scale(0.992);
  transition:
    opacity 0.48s ease,
    transform 0.62s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform;
}

.video-prompt-hero--entered {
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
}

.video-prompt-hero__shell {
  position: relative;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  isolation: isolate;
  user-select: none;
  /* 横向拖动轮播：允许竖向滚动整页，横向由指针事件处理 */
  touch-action: pan-y pinch-zoom;
  cursor: grab;
  background: transparent;
}

.video-prompt-hero__shell:active {
  cursor: grabbing;
}

.video-prompt-hero__carousel {
  position: relative;
  margin: 0 auto;
  z-index: 12;
  width: 100%;
  height: clamp(220px, 23.95vw, 460px);
  perspective: clamp(640px, 61.45vw, 1180px);
  perspective-origin: 50% 46%;
  transform-style: preserve-3d;
}

.video-prompt-hero__carousel::before,
.video-prompt-hero__carousel::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 40;
  width: clamp(96px, 14vw, 260px);
  pointer-events: none;
}

.video-prompt-hero__carousel::before {
  left: 0;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.92) 0%,
    rgba(0, 0, 0, 0.58) 48%,
    rgba(0, 0, 0, 0) 100%
  );
}

.video-prompt-hero__carousel::after {
  right: 0;
  background: linear-gradient(
    270deg,
    rgba(0, 0, 0, 0.92) 0%,
    rgba(0, 0, 0, 0.58) 48%,
    rgba(0, 0, 0, 0) 100%
  );
}

.video-prompt-hero__stage {
  position: absolute;
  inset: 0;
  transform: rotateX(-0.5deg) translateZ(0);
  transform-style: preserve-3d;
}

.video-prompt-hero__card {
  --card-x: 0px;
  --card-y: 0px;
  --card-z: 0px;
  --card-rotate-y: 0deg;
  --card-rotate-x: 0deg;
  --card-rotate-z: 0deg;
  --card-scale: 1;
  --card-opacity: 1;
  --card-brightness: 1;
  --card-shade-opacity: 0.2;
  --card-side-light-opacity: 0.08;
  --card-shade-angle: 90deg;
  --card-image-shift: 0%;
  --card-edge-glow: 0.12;
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--card-width);
  height: var(--card-height);
  overflow: visible;
  opacity: var(--card-opacity);
  z-index: calc(4 + var(--card-z-index));
  background: transparent;
  cursor: pointer;
  pointer-events: var(--card-pointer-events);
  filter: none;
  transform: translate3d(calc(-50% + var(--card-x)), calc(-50% + var(--card-y)), var(--card-z))
    rotateX(var(--card-rotate-x)) rotateY(var(--card-rotate-y)) rotateZ(var(--card-rotate-z))
    scale(var(--card-scale));
  transform-origin: center center;
  backface-visibility: hidden;
  transform-style: preserve-3d;
  will-change: transform, opacity;
  transition:
    opacity 0.42s ease,
    transform 0.62s cubic-bezier(0.22, 1, 0.36, 1);
}

.video-prompt-hero__card-plane {
  position: absolute;
  inset: 0 -1px;
  overflow: hidden;
  background: #090d14;
  border-radius: clamp(14px, 3vw, 24px);
  box-shadow: none;
  pointer-events: none;
  transform: translateZ(0.1px);
  transform-style: preserve-3d;
}

.video-prompt-hero__card-plane:hover {
  box-shadow: none;
}

.video-prompt-hero__card-plane :deep(.retryable-image-shell),
.video-prompt-hero__card-plane :deep(img) {
  width: 106%;
  height: 100%;
  display: block;
  object-fit: cover;
  transform: translateX(var(--card-image-shift)) scale(1.025);
  filter: none;
  pointer-events: none;
}

@media (max-width: 1200px) {
  .video-prompt-hero__carousel {
    height: clamp(220px, 24.5vw, 330px);
  }
}

@media (max-width: 992px) {
  .video-prompt-hero__carousel {
    height: clamp(210px, 25vw, 290px);
  }
}

@media (max-width: 768px) {
  .video-prompt-hero__carousel {
    height: clamp(200px, 26vw, 250px);
    perspective-origin: 50% 46%;
  }
}

@media (max-width: 480px) {
  .video-prompt-hero__carousel {
    height: clamp(190px, 33vw, 220px);
  }
}

@media (max-width: 380px) {
  .video-prompt-hero__carousel {
    height: clamp(180px, 36vw, 205px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .video-prompt-hero {
    opacity: 1;
    transform: none;
    transition: none;
    will-change: auto;
  }

  .video-prompt-hero__card {
    will-change: auto;
    transition: none;
  }
}
</style>
