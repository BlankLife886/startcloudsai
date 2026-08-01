<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  texts: { type: Array, default: () => [] },
  typingSpeed: { type: Number, default: 54 },
  deletingSpeed: { type: Number, default: 29 },
  pauseDuration: { type: Number, default: 1750 },
  startDelay: { type: Number, default: 760 },
  accessibleLabel: { type: String, default: '' },
})

const rootRef = ref(null)
const displayedText = ref('')
const activeIndex = ref(0)
const deleting = ref(false)
const started = ref(false)
const reduced = ref(false)
const stableLabel = computed(
  () => props.accessibleLabel || String(props.texts[0] || 'AI 图像创作工作流'),
)
let timer = 0
let observer = null
let inView = false
let pageVisible = !document.hidden

function motionDisabled() {
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function clearTimer() {
  window.clearTimeout(timer)
  timer = 0
}

function canRun() {
  return started.value && inView && pageVisible && !reduced.value && props.texts.length > 0
}

function schedule(delay) {
  clearTimer()
  if (!canRun()) return
  timer = window.setTimeout(step, delay)
}

function step() {
  if (!canRun()) return
  const current = String(props.texts[activeIndex.value] || '')

  if (deleting.value) {
    if (displayedText.value.length > 0) {
      displayedText.value = displayedText.value.slice(0, -1)
      schedule(props.deletingSpeed)
      return
    }
    deleting.value = false
    activeIndex.value = (activeIndex.value + 1) % props.texts.length
    schedule(250)
    return
  }

  if (displayedText.value.length < current.length) {
    displayedText.value = current.slice(0, displayedText.value.length + 1)
    schedule(props.typingSpeed + Math.random() * 14)
    return
  }

  if (props.texts.length > 1) {
    deleting.value = true
    schedule(props.pauseDuration)
  }
}

function start() {
  if (started.value) return
  started.value = true
  reduced.value = motionDisabled()
  if (reduced.value) {
    displayedText.value = String(props.texts[0] || '')
    return
  }
  schedule(props.startDelay)
}

function onVisibilityChange() {
  pageVisible = !document.hidden
  if (pageVisible) schedule(180)
  else clearTimer()
}

watch(
  () => props.texts.map(String).join('|'),
  () => {
    clearTimer()
    activeIndex.value = 0
    deleting.value = false
    displayedText.value = reduced.value ? String(props.texts[0] || '') : ''
    if (started.value) schedule(240)
  },
)

onMounted(() => {
  reduced.value = motionDisabled()
  if (!rootRef.value || typeof IntersectionObserver === 'undefined') {
    inView = true
    start()
  } else {
    observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry?.isIntersecting ?? false
        if (inView) {
          start()
          if (started.value && !timer && displayedText.value) schedule(180)
        } else {
          clearTimer()
        }
      },
      { rootMargin: '100px 0px', threshold: 0.05 },
    )
    observer.observe(rootRef.value)
  }
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true })
})

onBeforeUnmount(() => {
  clearTimer()
  observer?.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <span ref="rootRef" class="type-line">
    <span class="sr-only">{{ stableLabel }}</span>
    <span aria-hidden="true">{{ displayedText }}<i v-if="!reduced"></i></span>
  </span>
</template>

<style scoped>
.type-line {
  display: inline-flex;
  min-height: 1.5em;
  align-items: center;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.type-line i {
  display: inline-block;
  width: 2px;
  height: 0.9em;
  margin-left: 5px;
  vertical-align: -0.08em;
  background: currentColor;
  animation: type-cursor 0.84s steps(1, end) infinite;
}

@keyframes type-cursor {
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .type-line i { display: none; }
}

:global(html.settings-no-animations) .type-line i { display: none; }
</style>
