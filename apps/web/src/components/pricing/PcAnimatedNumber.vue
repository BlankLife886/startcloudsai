<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  animateNumberValue,
  formatAnimatedNumber,
} from '@/features/pricing/pricingNumberMotion'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  value: { type: Number, default: 0 },
  format: {
    type: String,
    default: 'integer',
    validator: (value) => ['integer', 'usd', 'usd3', 'percent', 'percent1'].includes(value),
  },
  duration: { type: Number, default: 1200 },
  delay: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
  tag: { type: String, default: 'span' },
})

const display = ref(formatAnimatedNumber(0, props.format))
let controller = null
let lastAnimatedValue = 0

function setDisplay(value, format = props.format) {
  display.value = formatAnimatedNumber(value, format)
}

function play(to, from = 0) {
  controller?.cancel()
  if (!props.enabled) {
    setDisplay(to)
    return
  }
  controller = animateNumberValue({
    from,
    to,
    format: props.format,
    duration: props.duration,
    delay: props.delay,
    onUpdate: (text) => {
      display.value = text
    },
  })
}

watch(
  () => props.value,
  (next) => {
    if (!props.enabled) {
      setDisplay(next)
      lastAnimatedValue = next
      return
    }
    play(next, lastAnimatedValue)
    lastAnimatedValue = next
  },
)

watch(
  () => props.enabled,
  (enabled) => {
    if (!enabled) {
      controller?.cancel()
      setDisplay(props.value)
      return
    }
    lastAnimatedValue = 0
    play(props.value, 0)
    lastAnimatedValue = props.value
  },
)

watch(
  () => props.format,
  () => {
    if (!props.enabled) {
      setDisplay(props.value)
      return
    }
    lastAnimatedValue = 0
    play(props.value, 0)
    lastAnimatedValue = props.value
  },
)

onMounted(() => {
  if (props.enabled) {
    play(props.value, 0)
    lastAnimatedValue = props.value
    return
  }
  setDisplay(props.value)
  lastAnimatedValue = props.value
})

onBeforeUnmount(() => {
  controller?.cancel()
})
</script>

<template>
  <component :is="tag" class="pc-num" v-bind="$attrs">{{ display }}</component>
</template>
