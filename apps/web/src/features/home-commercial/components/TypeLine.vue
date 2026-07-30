<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  texts: { type: Array, default: () => [] },
  typingSpeed: { type: Number, default: 56 },
  deletingSpeed: { type: Number, default: 30 },
  pauseDuration: { type: Number, default: 1500 },
})

const rootRef = ref(null)
const displayedText = ref('')
const activeIndex = ref(0)
const deleting = ref(false)
const started = ref(false)
const accessibleLabel = computed(() => props.texts.join('；'))
let timer = 0
let observer = null

function motionDisabled() {
  return (
    document.documentElement.classList.contains('settings-no-animations') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function schedule(delay) {
  window.clearTimeout(timer)
  timer = window.setTimeout(step, delay)
}

function step() {
  if (!started.value || !props.texts.length) return
  const current = String(props.texts[activeIndex.value] || '')

  if (deleting.value) {
    if (displayedText.value.length > 0) {
      displayedText.value = displayedText.value.slice(0, -1)
      schedule(props.deletingSpeed)
      return
    }
    deleting.value = false
    activeIndex.value = (activeIndex.value + 1) % props.texts.length
    schedule(240)
    return
  }

  if (displayedText.value.length < current.length) {
    displayedText.value = current.slice(0, displayedText.value.length + 1)
    schedule(props.typingSpeed + Math.random() * 24)
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
  if (motionDisabled()) {
    displayedText.value = String(props.texts[0] || '')
    return
  }
  schedule(320)
}

onMounted(() => {
  if (!rootRef.value || typeof IntersectionObserver === 'undefined') {
    start()
    return
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return
      start()
      observer?.disconnect()
    },
    { rootMargin: '100px 0px', threshold: 0.05 },
  )
  observer.observe(rootRef.value)
})

onBeforeUnmount(() => {
  window.clearTimeout(timer)
  observer?.disconnect()
})
</script>

<template>
  <span ref="rootRef" class="type-line" :aria-label="accessibleLabel">
    <span aria-hidden="true">{{ displayedText }}<i></i></span>
  </span>
</template>

<style scoped>
.type-line {
  display: inline-flex;
  min-height: 1.5em;
  align-items: center;
}

.type-line i {
  display: inline-block;
  width: 2px;
  height: 0.9em;
  margin-left: 5px;
  vertical-align: -0.08em;
  background: currentColor;
  animation: type-cursor 0.78s steps(1, end) infinite;
}

@keyframes type-cursor {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .type-line i {
    animation: none;
  }
}

:global(html.settings-no-animations) .type-line i {
  animation: none;
}
</style>
