<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  value: {
    type: Number,
    default: 0,
  },
  duration: {
    type: Number,
    default: 1200,
  },
  decimals: {
    type: Number,
    default: 0,
  },
  prefix: {
    type: String,
    default: '',
  },
  suffix: {
    type: String,
    default: '',
  },
})

const rootEl = ref(null)
const currentValue = ref(0)
let observer = null
let frameId = 0
let hasStarted = false

const displayValue = computed(() => {
  const formatter = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  })
  return `${props.prefix}${formatter.format(currentValue.value)}${props.suffix}`
})

function stopAnimation() {
  if (frameId) {
    cancelAnimationFrame(frameId)
    frameId = 0
  }
}

function animateCount() {
  if (hasStarted) return
  hasStarted = true

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  if (reducedMotion) {
    currentValue.value = props.value
    return
  }

  const startValue = 0
  const endValue = Number(props.value) || 0
  const startedAt = performance.now()

  const tick = (timestamp) => {
    const progress = Math.min(1, (timestamp - startedAt) / Math.max(1, props.duration))
    const eased = 1 - Math.pow(1 - progress, 3)
    const nextValue = startValue + (endValue - startValue) * eased

    currentValue.value = Number(nextValue.toFixed(props.decimals))

    if (progress < 1) {
      frameId = requestAnimationFrame(tick)
      return
    }

    currentValue.value = endValue
    frameId = 0
  }

  frameId = requestAnimationFrame(tick)
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !rootEl.value) {
    animateCount()
    return
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      animateCount()
      observer?.disconnect()
      observer = null
    },
    { threshold: 0.3 },
  )

  observer.observe(rootEl.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  stopAnimation()
})
</script>

<template>
  <span ref="rootEl">{{ displayValue }}</span>
</template>
