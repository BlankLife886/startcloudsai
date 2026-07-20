<script setup lang="ts">
import { gsap } from 'gsap'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

interface BentoItem {
  id: string
  image: string
  title: string
  description?: string
  label?: string
}

interface BentoProps {
  items?: BentoItem[]
  textAutoHide?: boolean
  enableSpotlight?: boolean
  enableBorderGlow?: boolean
  disableAnimations?: boolean
  spotlightRadius?: number
  enableTilt?: boolean
  glowColor?: string
  clickEffect?: boolean
  enableMagnetism?: boolean
}

const MOBILE_BREAKPOINT = 768

const props = withDefaults(defineProps<BentoProps>(), {
  items: () => [],
  textAutoHide: true,
  enableSpotlight: true,
  enableBorderGlow: true,
  disableAnimations: false,
  spotlightRadius: 300,
  enableTilt: false,
  glowColor: '0, 200, 83',
  clickEffect: true,
  enableMagnetism: true,
})

const gridRef = ref<HTMLDivElement | null>(null)
const cardRefs = ref<HTMLElement[]>([])
const spotlightRef = ref<HTMLDivElement | null>(null)
const isMobile = ref(false)

const cards = computed(() =>
  props.items.map((item, index) => ({
    ...item,
    description: item.description || '精选桌面图集',
    label: item.label || `Card ${index + 1}`,
  })),
)

const shouldDisableAnimations = computed(() => props.disableAnimations || isMobile.value)

function getCardStyle(card: BentoItem) {
  return {
    backgroundImage: `url(${card.image})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  }
}

function setCardRef(el: Element | null, index: number) {
  if (!el) return
  cardRefs.value[index] = el as HTMLElement
}

function checkMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT
}

function clearSpotlight() {
  spotlightRef.value?.remove()
  spotlightRef.value = null
}

function ensureSpotlight() {
  if (
    !props.enableSpotlight ||
    shouldDisableAnimations.value ||
    spotlightRef.value ||
    typeof document === 'undefined'
  )
    return

  const spotlight = document.createElement('div')
  spotlight.className = 'magic-bento-spotlight'
  spotlight.style.cssText = `
    position: fixed;
    width: 760px;
    height: 760px;
    border-radius: 50%;
    pointer-events: none;
    background: radial-gradient(circle,
      rgba(${props.glowColor}, 0.12) 0%,
      rgba(${props.glowColor}, 0.06) 18%,
      rgba(${props.glowColor}, 0.03) 28%,
      rgba(${props.glowColor}, 0.015) 42%,
      transparent 70%
    );
    z-index: 200;
    opacity: 0;
    transform: translate(-50%, -50%);
    mix-blend-mode: screen;
  `
  document.body.appendChild(spotlight)
  spotlightRef.value = spotlight
}

function resetCards() {
  cardRefs.value.forEach((card) => {
    if (!card) return
    card.style.setProperty('--glow-intensity', '0')
    gsap.to(card, {
      x: 0,
      y: 0,
      rotateX: 0,
      rotateY: 0,
      duration: 0.28,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  })
}

function updateCardGlow(card: HTMLElement, mouseX: number, mouseY: number, glow: number) {
  const rect = card.getBoundingClientRect()
  const relativeX = ((mouseX - rect.left) / rect.width) * 100
  const relativeY = ((mouseY - rect.top) / rect.height) * 100
  card.style.setProperty('--glow-x', `${relativeX}%`)
  card.style.setProperty('--glow-y', `${relativeY}%`)
  card.style.setProperty('--glow-intensity', glow.toString())
  card.style.setProperty('--glow-radius', `${props.spotlightRadius}px`)
}

function handlePointerMove(event: MouseEvent) {
  if (!gridRef.value || shouldDisableAnimations.value) return

  const sectionRect = gridRef.value.getBoundingClientRect()
  const inside =
    event.clientX >= sectionRect.left &&
    event.clientX <= sectionRect.right &&
    event.clientY >= sectionRect.top &&
    event.clientY <= sectionRect.bottom

  if (!inside) {
    resetCards()
    if (spotlightRef.value) {
      gsap.to(spotlightRef.value, { opacity: 0, duration: 0.3, ease: 'power2.out' })
    }
    return
  }

  ensureSpotlight()
  const proximity = props.spotlightRadius * 0.5
  const fadeDistance = props.spotlightRadius * 0.75
  let minDistance = Infinity

  cardRefs.value.forEach((card) => {
    if (!card) return
    const rect = card.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const distance =
      Math.hypot(event.clientX - centerX, event.clientY - centerY) -
      Math.max(rect.width, rect.height) / 2
    const effectiveDistance = Math.max(0, distance)
    minDistance = Math.min(minDistance, effectiveDistance)

    let glow = 0
    if (effectiveDistance <= proximity) {
      glow = 1
    } else if (effectiveDistance <= fadeDistance) {
      glow = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)
    }

    updateCardGlow(card, event.clientX, event.clientY, glow)

    if (props.enableTilt || props.enableMagnetism) {
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const centerXLocal = rect.width / 2
      const centerYLocal = rect.height / 2

      const nextProps: Record<string, number | string> = {
        duration: 0.18,
        ease: 'power2.out',
        overwrite: 'auto',
      }

      if (props.enableTilt) {
        nextProps.rotateX = ((localY - centerYLocal) / centerYLocal) * -6
        nextProps.rotateY = ((localX - centerXLocal) / centerXLocal) * 6
      }

      if (props.enableMagnetism) {
        nextProps.x = (localX - centerXLocal) * 0.03
        nextProps.y = (localY - centerYLocal) * 0.03
      }

      gsap.to(card, nextProps)
    }
  })

  if (spotlightRef.value) {
    gsap.to(spotlightRef.value, {
      left: event.clientX,
      top: event.clientY,
      duration: 0.1,
      ease: 'power2.out',
    })

    const targetOpacity =
      minDistance <= proximity
        ? 0.8
        : minDistance <= fadeDistance
          ? ((fadeDistance - minDistance) / (fadeDistance - proximity)) * 0.8
          : 0

    gsap.to(spotlightRef.value, {
      opacity: targetOpacity,
      duration: targetOpacity > 0 ? 0.2 : 0.5,
      ease: 'power2.out',
    })
  }
}

function handlePointerLeave() {
  resetCards()
  if (spotlightRef.value) {
    gsap.to(spotlightRef.value, { opacity: 0, duration: 0.3, ease: 'power2.out' })
  }
}

function handleCardClick(event: MouseEvent, card: HTMLElement) {
  if (!props.clickEffect || shouldDisableAnimations.value) return

  const rect = card.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const maxDistance = Math.max(
    Math.hypot(x, y),
    Math.hypot(x - rect.width, y),
    Math.hypot(x, y - rect.height),
    Math.hypot(x - rect.width, y - rect.height),
  )

  const ripple = document.createElement('div')
  ripple.style.cssText = `
    position: absolute;
    width: ${maxDistance * 2}px;
    height: ${maxDistance * 2}px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(${props.glowColor}, 0.4) 0%, rgba(${props.glowColor}, 0.2) 30%, transparent 70%);
    left: ${x - maxDistance}px;
    top: ${y - maxDistance}px;
    pointer-events: none;
    z-index: 1000;
  `
  card.appendChild(ripple)

  gsap.fromTo(
    ripple,
    { scale: 0, opacity: 1 },
    {
      scale: 1,
      opacity: 0,
      duration: 0.8,
      ease: 'power2.out',
      onComplete: () => ripple.remove(),
    },
  )
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  window.addEventListener('mousemove', handlePointerMove)
  window.addEventListener('mouseleave', handlePointerLeave)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  window.removeEventListener('mousemove', handlePointerMove)
  window.removeEventListener('mouseleave', handlePointerLeave)
  clearSpotlight()
})

watch(shouldDisableAnimations, (disabled) => {
  if (disabled) {
    handlePointerLeave()
  }
})
</script>

<template>
  <section class="magic-bento-shell bento-section">
    <div ref="gridRef" class="magic-bento-grid card-responsive">
      <article
        v-for="(card, index) in cards"
        :key="card.id"
        :ref="(el) => setCardRef(el, index)"
        class="card magic-bento-card"
        :class="{ 'card--border-glow': enableBorderGlow }"
        :style="getCardStyle(card)"
        @mouseleave="handlePointerLeave"
        @click="(event) => handleCardClick(event, cardRefs[index])"
      >
        <div class="relative flex justify-between gap-3 text-white card__header">
          <span class="text-base card__label">{{ card.label }}</span>
        </div>
        <div class="relative flex flex-col text-white card__content">
          <h3
            :class="`card__title font-normal text-base m-0 mb-1 ${textAutoHide ? 'text-clamp-1' : ''}`"
          >
            {{ card.title }}
          </h3>
          <p
            :class="`card__description text-xs leading-5 opacity-90 ${textAutoHide ? 'text-clamp-2' : ''}`"
          >
            {{ card.description }}
          </p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.bento-section {
  --glow-x: 50%;
  --glow-y: 50%;
  --glow-intensity: 0;
  --glow-radius: 200px;
  --border-color: #333;
  --background-dark: #060010;
  --white: hsl(0, 0%, 100%);
}

.magic-bento-shell {
  width: 100%;
  height: 100%;
}

.magic-bento-grid {
  display: grid;
  gap: 0.5rem;
  width: 90%;
  margin: 0 auto;
  padding: 0.5rem;
}

.card-responsive {
  grid-template-columns: 1fr;
}

@media (min-width: 600px) {
  .card-responsive {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .card-responsive {
    grid-template-columns: repeat(4, 1fr);
  }

  .card-responsive .card:nth-child(3) {
    grid-column: span 2;
    grid-row: span 2;
  }

  .card-responsive .card:nth-child(4) {
    grid-column: 1 / span 2;
    grid-row: 2 / span 2;
  }

  .card-responsive .card:nth-child(6) {
    grid-column: 4;
    grid-row: 3;
  }
}

.magic-bento-card {
  position: relative;
  aspect-ratio: 4 / 3;
  min-height: 200px;
  width: 100%;
  max-width: 100%;
  padding: 1.25rem;
  border-radius: 20px;
  border: 1px solid var(--border-color);
  overflow: hidden;
  background-color: var(--background-dark);
  color: var(--white);
  transition: box-shadow 0.3s ease-in-out;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  --glow-x: 50%;
  --glow-y: 50%;
  --glow-intensity: 0;
  --glow-radius: 200px;
}

.card--border-glow::after {
  content: '';
  position: absolute;
  inset: 0;
  padding: 6px;
  background: radial-gradient(
    var(--glow-radius) circle at var(--glow-x) var(--glow-y),
    rgba(v-bind(glowColor), calc(var(--glow-intensity) * 0.8)) 0%,
    rgba(v-bind(glowColor), calc(var(--glow-intensity) * 0.4)) 30%,
    transparent 60%
  );
  border-radius: inherit;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: subtract;
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  pointer-events: none;
  transition: opacity 0.3s ease;
  z-index: 1;
}

.card--border-glow:hover::after {
  opacity: 1;
}

.card--border-glow:hover {
  box-shadow:
    0 4px 20px rgba(46, 24, 78, 0.4),
    0 0 30px rgba(v-bind(glowColor), 0.2);
}

.text-clamp-1 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.text-clamp-2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 599px) {
  .card-responsive {
    grid-template-columns: 1fr;
  }

  .card-responsive .card {
    min-height: 180px;
  }
}
</style>
