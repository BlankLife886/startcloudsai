<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
  failedItems: { type: Object, default: () => ({}) },
  visibleCount: { type: Number, default: 5 },
  animateOnMount: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue'])
const rootRef = ref(null)
const trackRef = ref(null)
const railRef = ref(null)
const normalizedItems = computed(() => props.items
  .map((item) => {
    if (typeof item === 'string') return { id: item, src: item, pending: false }
    if (!item || typeof item !== 'object') return null
    const src = String(item.src || item.url || '').trim()
    const id = String(item.id || item.value || src).trim()
    return id ? { id, src, pending: item.pending === true } : null
  })
  .filter(Boolean))
const allItems = computed(() => normalizedItems.value.map((item) => item.id))
const itemMetaById = computed(() => new Map(normalizedItems.value.map((item) => [item.id, item])))

function itemMeta(value) {
  return itemMetaById.value.get(value) || { id: value, src: value, pending: false }
}
const loopPaddingCount = computed(() => (
  allItems.value.length > 1
    ? Math.min(Math.max(1, props.visibleCount), allItems.value.length)
    : 0
))
const displayItems = computed(() => {
  const items = allItems.value
  if (items.length < 2) {
    return items.map((item, index) => ({ item, index, cycle: 0, key: `main-${index}-${item}` }))
  }
  const padding = loopPaddingCount.value
  const before = items.slice(-padding).map((item, offset) => ({
    item,
    index: items.length - padding + offset,
    cycle: -1,
    key: `before-${offset}-${item}`,
  }))
  const middle = items.map((item, index) => ({
    item,
    index,
    cycle: 0,
    key: `main-${index}-${item}`,
  }))
  const after = items.slice(0, padding).map((item, index) => ({
    item,
    index,
    cycle: 1,
    key: `after-${index}-${item}`,
  }))
  return [...before, ...middle, ...after]
})
const selectedValue = computed(() => (
  allItems.value.includes(props.modelValue)
    ? props.modelValue
    : allItems.value[0] || ''
))
const selectedIndex = computed(() => Math.max(0, allItems.value.indexOf(selectedValue.value)))
const slotCount = computed(() => Math.max(2, Math.min(props.visibleCount, allItems.value.length)))

let visualRaf = 0
let resizeObserver = null
let motionMatchMedia = null
let snapTween = null
let snapping = false
let mounted = false
let reduceMotion = false
let directSelectionTarget = null
let promotedElements = new Set()
const visualSetters = new WeakMap()

function optionElements() {
  return Array.from(railRef.value?.querySelectorAll('[data-film-index]') || [])
}

function isHorizontal() {
  const rail = railRef.value
  return Boolean(rail && getComputedStyle(rail).flexDirection === 'row')
}

function settersFor(element) {
  let setters = visualSetters.get(element)
  if (setters) return setters
  gsap.set(element, {
    transformOrigin: '50% 50%',
    transformPerspective: 520,
  })
  const config = { duration: 0.2, ease: 'power2.out', overwrite: 'auto' }
  setters = {
    opacity: gsap.quickTo(element, 'opacity', { ...config, duration: 0.16 }),
    rotationX: gsap.quickTo(element, 'rotationX', config),
    rotationY: gsap.quickTo(element, 'rotationY', config),
    scale: gsap.quickTo(element, 'scale', config),
    x: gsap.quickTo(element, 'x', config),
    y: gsap.quickTo(element, 'y', config),
    z: gsap.quickTo(element, 'z', config),
  }
  visualSetters.set(element, setters)
  return setters
}

function syncVisuals() {
  cancelAnimationFrame(visualRaf)
  visualRaf = requestAnimationFrame(() => {
    const track = trackRef.value
    const elements = optionElements()
    if (!track || !elements.length) return

    const horizontal = isHorizontal()
    const reduced = reduceMotion
    const viewportSize = horizontal ? track.clientWidth : track.clientHeight
    const scrollPosition = horizontal ? track.scrollLeft : track.scrollTop
    const center = scrollPosition + viewportSize / 2
    const radius = Math.max(1, viewportSize * 0.56)
    const firstStart = horizontal ? elements[0].offsetLeft : elements[0].offsetTop
    const itemStep = elements[1]
      ? Math.max(1, (horizontal ? elements[1].offsetLeft : elements[1].offsetTop) - firstStart)
      : Math.max(1, horizontal ? elements[0].offsetWidth : elements[0].offsetHeight)
    const startIndex = Math.max(0, Math.floor((scrollPosition - firstStart) / itemStep) - 2)
    const endIndex = Math.min(
      elements.length,
      Math.ceil((scrollPosition + viewportSize - firstStart) / itemStep) + 2,
    )

    const values = elements.slice(startIndex, endIndex).map((element) => {
      const itemStart = horizontal ? element.offsetLeft : element.offsetTop
      const itemSize = horizontal ? element.offsetWidth : element.offsetHeight
      const position = Math.max(-1, Math.min(1, (itemStart + itemSize / 2 - center) / radius))
      return { element, position, distance: Math.abs(position) }
    })
    const nextPromoted = new Set(values.map(({ element }) => element))
    for (const element of promotedElements) {
      if (!nextPromoted.has(element)) gsap.set(element, { willChange: 'auto' })
    }
    for (const element of nextPromoted) {
      if (!promotedElements.has(element)) gsap.set(element, { willChange: 'transform,opacity' })
    }
    promotedElements = nextPromoted

    for (const { element, position, distance } of values) {
      const setters = settersFor(element)
      const focus = 1 - distance
      const rotation = reduced ? 0 : position * -18
      setters.rotationX(horizontal ? 0 : rotation)
      setters.rotationY(horizontal ? -rotation : 0)
      setters.x(reduced || horizontal ? 0 : focus * -5)
      setters.y(reduced || !horizontal ? 0 : focus * -3)
      setters.z(reduced ? 0 : distance * -30 + focus * 8)
      setters.scale(reduced ? 1 : 0.9 + focus * 0.1)
      setters.opacity(reduced ? 1 : 0.68 + focus * 0.32)
    }
  })
}

function scrollTargetFor(element) {
  const track = trackRef.value
  if (!track || !element) return null
  const horizontal = isHorizontal()
  const itemStart = horizontal ? element.offsetLeft : element.offsetTop
  const itemSize = horizontal ? element.offsetWidth : element.offsetHeight
  const viewportSize = horizontal ? track.clientWidth : track.clientHeight
  const contentSize = horizontal ? track.scrollWidth : track.scrollHeight
  const target = Math.max(0, Math.min(contentSize - viewportSize, itemStart + itemSize / 2 - viewportSize / 2))
  return { horizontal, target }
}

function normalizeLoopPosition() {
  const track = trackRef.value
  const elements = optionElements()
  const itemCount = allItems.value.length
  const padding = loopPaddingCount.value
  if (!track || itemCount < 2 || !padding) return false

  const middleFirst = elements[padding]
  const afterFirst = elements[padding + itemCount]
  if (!middleFirst || !afterFirst) return false

  const horizontal = isHorizontal()
  const startOf = (element) => horizontal ? element.offsetLeft : element.offsetTop
  const middleStart = startOf(middleFirst)
  const afterStart = startOf(afterFirst)
  const cycleSpan = afterStart - middleStart
  if (cycleSpan <= 0) return false

  const nextMiddle = elements[padding + 1]
  const itemStep = nextMiddle
    ? Math.max(1, startOf(nextMiddle) - middleStart)
    : Math.max(1, horizontal ? middleFirst.offsetWidth : middleFirst.offsetHeight)
  const scrollPosition = horizontal ? track.scrollLeft : track.scrollTop
  const viewportSize = horizontal ? track.clientWidth : track.clientHeight
  const viewportCenter = scrollPosition + viewportSize / 2
  let shift = 0

  if (viewportCenter < middleStart - itemStep / 2) shift = cycleSpan
  else if (viewportCenter >= afterStart - itemStep / 2) shift = -cycleSpan
  if (!shift) return false

  if (horizontal) track.scrollLeft += shift
  else track.scrollTop += shift
  return true
}

function interruptSnap() {
  snapTween?.kill()
  snapTween = null
  snapping = false
}

function scrollToElement(element, animate = true) {
  const track = trackRef.value
  const targetState = scrollTargetFor(element)
  if (!track || !targetState) return
  const { horizontal, target } = targetState
  const current = horizontal ? track.scrollLeft : track.scrollTop
  interruptSnap()

  if (!animate || reduceMotion || Math.abs(target - current) < 1) {
    if (horizontal) track.scrollLeft = target
    else track.scrollTop = target
    syncVisuals()
    return
  }

  const state = { value: current }
  const distance = Math.abs(target - current)
  snapping = true
  snapTween = gsap.to(state, {
    value: target,
    duration: Math.min(0.52, 0.28 + distance / 900),
    ease: 'power4.out',
    overwrite: 'auto',
    onUpdate: () => {
      if (horizontal) track.scrollLeft = state.value
      else track.scrollTop = state.value
      syncVisuals()
    },
    onComplete: () => {
      snapTween = null
      snapping = false
      normalizeLoopPosition()
      syncVisuals()
    },
  })
}

function centerSelected(animate = true) {
  const candidates = Array.from(railRef.value?.querySelectorAll(
    `[data-film-index="${selectedIndex.value}"]`,
  ) || [])
  const track = trackRef.value
  const horizontal = isHorizontal()
  const viewportCenter = track
    ? (horizontal ? track.scrollLeft + track.clientWidth / 2 : track.scrollTop + track.clientHeight / 2)
    : 0
  const selected = animate
    ? candidates.reduce((nearest, element) => {
        const itemStart = horizontal ? element.offsetLeft : element.offsetTop
        const itemSize = horizontal ? element.offsetWidth : element.offsetHeight
        const distance = Math.abs(itemStart + itemSize / 2 - viewportCenter)
        return !nearest || distance < nearest.distance ? { element, distance } : nearest
      }, null)?.element
    : candidates.find((element) => element.dataset.cycle === '0')
  scrollToElement(selected, animate)
}

function choose(value, element = null) {
  if (!value) return
  if (value !== selectedValue.value) {
    directSelectionTarget = element
    emit('update:modelValue', value)
  }
  if (element) scrollToElement(element)
}

function handleScroll() {
  if (!snapping) normalizeLoopPosition()
  syncVisuals()
}

function step(direction) {
  const count = allItems.value.length
  if (!count) return
  const index = (selectedIndex.value + direction + count) % count
  const value = allItems.value[index]
  if (!value) return
  emit('update:modelValue', value)
}

function handleKeydown(event) {
  const previousKeys = ['ArrowUp', 'ArrowLeft']
  const nextKeys = ['ArrowDown', 'ArrowRight']
  if (!previousKeys.includes(event.key) && !nextKeys.includes(event.key)) return
  event.preventDefault()
  step(previousKeys.includes(event.key) ? -1 : 1)
}

async function prepareItems({ center = false } = {}) {
  await nextTick()
  if (center) centerSelected(false)
  syncVisuals()
}

watch(selectedValue, async () => {
  if (!mounted) return
  await nextTick()
  if (directSelectionTarget) {
    directSelectionTarget = null
    syncVisuals()
    return
  }
  if (snapping) return
  centerSelected()
  syncVisuals()
}, { flush: 'post' })

watch(() => normalizedItems.value.map((item) => `${item.id}:${item.src}:${item.pending}`).join('|'), async () => {
  if (!mounted) return
  await prepareItems({ center: true })
}, { flush: 'post' })

onMounted(async () => {
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  mounted = true
  await prepareItems({ center: true })
  resizeObserver = new ResizeObserver(() => {
    centerSelected(false)
    syncVisuals()
  })
  if (trackRef.value) resizeObserver.observe(trackRef.value)
  motionMatchMedia = gsap.matchMedia()
  motionMatchMedia.add(
    {
      reduced: '(prefers-reduced-motion: reduce)',
      full: '(prefers-reduced-motion: no-preference)',
    },
    (context) => {
      reduceMotion = context.conditions.reduced
      syncVisuals()
      if (!context.conditions.full || !props.animateOnMount) return
      gsap.fromTo(rootRef.value, { autoAlpha: 0, x: 12, scale: 0.985 }, {
        autoAlpha: 1,
        x: 0,
        scale: 1,
        duration: 0.36,
        ease: 'power3.out',
        clearProps: 'transform,opacity,visibility',
      })
    },
    rootRef.value,
  )
})

onBeforeUnmount(() => {
  mounted = false
  interruptSnap()
  cancelAnimationFrame(visualRaf)
  resizeObserver?.disconnect()
  motionMatchMedia?.revert()
  const elements = optionElements()
  gsap.killTweensOf(elements)
  gsap.set(elements, { clearProps: 'transform,opacity,visibility,willChange' })
})
</script>

<template>
  <aside
    ref="rootRef"
    class="clock-filmstrip"
    aria-label="生成图片历史胶片"
    :style="{ '--film-slots': slotCount }"
  >
    <div class="clock-filmstrip__window">
      <div
        ref="trackRef"
        class="clock-filmstrip__track"
        role="listbox"
        aria-label="浏览全部历史图片"
        tabindex="0"
        @scroll.passive="handleScroll"
        @wheel.passive="interruptSnap"
        @pointerdown.passive="interruptSnap"
        @keydown="handleKeydown"
      >
        <div ref="railRef" class="clock-filmstrip__rail">
          <button
            v-for="entry in displayItems"
            :key="entry.key"
            type="button"
            :role="entry.cycle === 0 ? 'option' : undefined"
            :tabindex="entry.cycle === 0 ? 0 : -1"
            :aria-hidden="entry.cycle === 0 ? undefined : 'true'"
            :aria-label="entry.cycle === 0 ? `查看历史图片 ${entry.index + 1}` : undefined"
            :aria-posinset="entry.cycle === 0 ? entry.index + 1 : undefined"
            :aria-setsize="entry.cycle === 0 ? allItems.length : undefined"
            :aria-selected="entry.cycle === 0 ? entry.item === selectedValue : undefined"
            :data-film-index="entry.index"
            :data-cycle="entry.cycle"
            :class="{
              active: entry.item === selectedValue,
              'is-pending': itemMeta(entry.item).pending,
            }"
            @click="choose(entry.item, $event.currentTarget)"
          >
            <AuthenticatedImage
              v-if="itemMeta(entry.item).src && !failedItems[itemMeta(entry.item).src]"
              :src="itemMeta(entry.item).src"
              alt=""
              :max-dimension="180"
              loading="eager"
            />
            <span v-else class="clock-filmstrip__pending" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.clock-filmstrip {
  position: relative;
  align-self: center;
  width: 100%;
  height: clamp(236px, calc(var(--film-slots, 5) * 76px + 8px), 388px);
  max-height: 86%;
  min-width: 0;
  min-height: 0;
  padding: 0;
  box-sizing: border-box;
}

.clock-filmstrip__window {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  perspective: 520px;
  perspective-origin: 50% 50%;
  contain: layout paint;
}

.clock-filmstrip__track {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  outline: none;
  cursor: grab;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.clock-filmstrip__track:active { cursor: grabbing; }

.clock-filmstrip__track::-webkit-scrollbar { display: none; }

.clock-filmstrip__rail {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 8px 6px;
}

.clock-filmstrip__rail > button {
  position: relative;
  flex: 0 0 68px;
  width: 68px;
  height: 68px;
  aspect-ratio: 1 / 1;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #6f777d;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s ease;
  backface-visibility: hidden;
  user-select: none;
}

.clock-filmstrip__rail > button:hover {
  box-shadow:
    0 0 0 1px var(--studio-accent-soft, #ffffff4d),
    var(--studio-filmstrip-hover-shadow, 0 10px 24px #0000005c);
}

.clock-filmstrip__rail > button.active {
  box-shadow:
    0 0 0 1px var(--studio-accent, #f4f6f7),
    0 0 18px var(--studio-accent-glow, transparent),
    var(--studio-filmstrip-active-shadow, 0 14px 30px #00000070);
}

.clock-filmstrip__rail > button.is-pending :deep(.authenticated-image) {
  opacity: 0.62;
  filter: saturate(0.72) brightness(0.78);
}

.clock-filmstrip__pending {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--studio-surface-raised, #15191b);
}

.clock-filmstrip__rail :deep(.authenticated-image) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--studio-surface-deep, #0d1012);
  border-radius: inherit;
  transition: opacity 0.28s ease, filter 0.28s ease;
}

@media (max-width: 700px) {
  .clock-filmstrip {
    align-self: stretch;
    height: 64px;
    max-height: none;
    padding: 0;
  }

  .clock-filmstrip__track {
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    touch-action: pan-x;
  }

  .clock-filmstrip__track::-webkit-scrollbar { display: none; }

  .clock-filmstrip__rail {
    width: max-content;
    min-width: 100%;
    min-height: 0;
    height: 100%;
    flex-direction: row;
    gap: 6px;
    padding: 4px 6px;
  }

  .clock-filmstrip__rail > button {
    flex-basis: 56px;
    width: 56px;
    height: 56px;
  }
}
</style>
