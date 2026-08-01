<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { gsap } from 'gsap'

const props = defineProps({
  items: { type: Array, default: () => [] },
  speed: { type: Number, default: 15 },
  textColor: { type: String, default: '#ffffff' },
  bgColor: { type: String, default: '#111111' },
  marqueeBgColor: { type: String, default: '#ffffff' },
  marqueeTextColor: { type: String, default: '#111111' },
  borderColor: { type: String, default: '#ffffff' },
})

const itemRefs = ref([])
const marqueeRefs = ref([])
const marqueeInnerRefs = ref([])
const repetitions = ref([])
const animations = ref([])

const animationDefaults = {
  duration: 0.6,
  ease: 'expo',
}

function setItemRef(el, idx) {
  if (el) itemRefs.value[idx] = el
}

function setMarqueeRef(el, idx) {
  marqueeRefs.value[idx] = el
}

function setMarqueeInnerRef(el, idx) {
  marqueeInnerRefs.value[idx] = el
}

function findClosestEdge(mouseX, mouseY, width, height) {
  const topEdgeDist = (mouseX - width / 2) ** 2 + mouseY ** 2
  const bottomEdgeDist = (mouseX - width / 2) ** 2 + (mouseY - height) ** 2
  return topEdgeDist < bottomEdgeDist ? 'top' : 'bottom'
}

function setupMarquees() {
  props.items.forEach((_, idx) => {
    const marqueeInner = marqueeInnerRefs.value[idx]
    if (!marqueeInner) return

    const marqueeContent = marqueeInner.querySelector('.flowing-menu__part')
    if (!marqueeContent) return

    const contentWidth = marqueeContent.offsetWidth
    if (contentWidth === 0) return

    animations.value[idx]?.kill()
    gsap.set(marqueeInner, { x: 0 })
    animations.value[idx] = gsap.to(marqueeInner, {
      x: -contentWidth,
      duration: props.speed,
      ease: 'none',
      repeat: -1,
    })
  })
}

async function calculateRepetitions() {
  await nextTick()
  props.items.forEach((_, idx) => {
    const marqueeInner = marqueeInnerRefs.value[idx]
    if (!marqueeInner) return
    const marqueeContent = marqueeInner.querySelector('.flowing-menu__part')
    if (!marqueeContent) return
    const contentWidth = marqueeContent.offsetWidth
    const viewportWidth = window.innerWidth
    const needed = Math.ceil(viewportWidth / Math.max(contentWidth, 1)) + 2
    repetitions.value[idx] = Math.max(4, needed)
  })
  await nextTick()
  setupMarquees()
}

function handleMouseEnter(ev, idx) {
  const itemRef = itemRefs.value[idx]
  const marqueeRef = marqueeRefs.value[idx]
  const marqueeInnerRef = marqueeInnerRefs.value[idx]
  if (!itemRef || !marqueeRef || !marqueeInnerRef) return

  const rect = itemRef.getBoundingClientRect()
  const edge = findClosestEdge(ev.clientX - rect.left, ev.clientY - rect.top, rect.width, rect.height)

  gsap
    .timeline({ defaults: animationDefaults })
    .set(marqueeRef, { y: edge === 'top' ? '-101%' : '101%' }, 0)
    .set(marqueeInnerRef, { y: edge === 'top' ? '101%' : '-101%' }, 0)
    .to([marqueeRef, marqueeInnerRef], { y: '0%' }, 0)
}

function handleMouseLeave(ev, idx) {
  const itemRef = itemRefs.value[idx]
  const marqueeRef = marqueeRefs.value[idx]
  const marqueeInnerRef = marqueeInnerRefs.value[idx]
  if (!itemRef || !marqueeRef || !marqueeInnerRef) return

  const rect = itemRef.getBoundingClientRect()
  const edge = findClosestEdge(ev.clientX - rect.left, ev.clientY - rect.top, rect.width, rect.height)

  gsap
    .timeline({ defaults: animationDefaults })
    .to(marqueeRef, { y: edge === 'top' ? '-101%' : '101%' }, 0)
    .to(marqueeInnerRef, { y: edge === 'top' ? '101%' : '-101%' }, 0)
}

function isExternal(link) {
  return typeof link === 'string' && /^(https?:|mailto:|#)/.test(link)
}

onMounted(() => {
  calculateRepetitions()
  window.addEventListener('resize', calculateRepetitions)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', calculateRepetitions)
  animations.value.forEach((animation) => animation?.kill())
})

watch(
  () => props.items,
  async () => {
    await calculateRepetitions()
  },
  { deep: true },
)

watch(
  () => props.speed,
  () => {
    setupMarquees()
  },
)
</script>

<template>
  <div class="flowing-menu" :style="{ backgroundColor: bgColor }">
    <nav class="flowing-menu__nav" aria-label="创作入口">
      <div
        v-for="(item, idx) in items"
        :key="`${item.text}-${idx}`"
        class="flowing-menu__item"
        :ref="(el) => setItemRef(el, idx)"
        :style="{ borderTop: idx === 0 ? 'none' : `1px solid ${borderColor}` }"
      >
        <a
          v-if="isExternal(item.link)"
          class="flowing-menu__link"
          :href="item.link"
          :style="{ color: textColor }"
          @mouseenter="(ev) => handleMouseEnter(ev, idx)"
          @mouseleave="(ev) => handleMouseLeave(ev, idx)"
        >
          {{ item.text }}
        </a>
        <RouterLink
          v-else
          class="flowing-menu__link"
          :to="item.link || '/'"
          :style="{ color: textColor }"
          @mouseenter="(ev) => handleMouseEnter(ev, idx)"
          @mouseleave="(ev) => handleMouseLeave(ev, idx)"
        >
          {{ item.text }}
        </RouterLink>

        <div
          class="flowing-menu__marquee"
          :style="{ backgroundColor: marqueeBgColor }"
          :ref="(el) => setMarqueeRef(el, idx)"
        >
          <div class="flowing-menu__marquee-inner" :ref="(el) => setMarqueeInnerRef(el, idx)">
            <div
              v-for="i in repetitions[idx] || 4"
              :key="`${idx}-${i}`"
              class="flowing-menu__part"
            >
              <span class="flowing-menu__label" :style="{ color: marqueeTextColor }">
                {{ item.text }}
              </span>
              <div
                class="flowing-menu__thumb"
                :style="{ backgroundImage: item.image ? `url(${item.image})` : 'none' }"
              />
            </div>
          </div>
        </div>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.flowing-menu {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.flowing-menu__nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  margin: 0;
  padding: 0;
}

.flowing-menu__item {
  position: relative;
  flex: 1 1 0;
  overflow: hidden;
  text-align: center;
}

.flowing-menu__link {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: clamp(22px, 4vh, 48px);
  font-weight: 650;
  letter-spacing: 0.04em;
  text-decoration: none;
  text-transform: uppercase;
  cursor: pointer;
}

.flowing-menu__marquee {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  transform: translateY(101%);
  pointer-events: none;
}

.flowing-menu__marquee-inner {
  display: flex;
  width: max-content;
  height: 100%;
}

.flowing-menu__part {
  display: flex;
  flex-shrink: 0;
  align-items: center;
}

.flowing-menu__label {
  padding: 0 1vw;
  font-size: clamp(22px, 4vh, 48px);
  font-weight: 520;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.flowing-menu__thumb {
  width: min(200px, 28vw);
  height: 7vh;
  min-height: 48px;
  margin: 2em 2vw;
  border-radius: 50px;
  background-color: rgba(0, 0, 0, 0.08);
  background-position: center;
  background-size: cover;
}

@media (prefers-reduced-motion: reduce) {
  .flowing-menu__marquee,
  .flowing-menu__marquee-inner {
    transition: none;
  }
}
</style>
