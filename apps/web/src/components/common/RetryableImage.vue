<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  src: {
    type: String,
    default: '',
  },
  alt: {
    type: String,
    default: '',
  },
  imgClass: {
    type: [String, Array, Object],
    default: '',
  },
  loading: {
    type: String,
    default: 'lazy',
  },
  draggable: {
    type: Boolean,
    default: false,
  },
  showButton: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['load', 'error'])

const displaySrc = ref('')
const failed = ref(false)
const retryCount = ref(0)
const retryTimer = ref(0)

const normalizedSrc = computed(() => String(props.src || '').trim())

function clearRetryTimer() {
  if (!retryTimer.value) return
  window.clearTimeout(retryTimer.value)
  retryTimer.value = 0
}

function withRetryParam(url, key = 'retry') {
  if (!url) return ''
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${key}=${Date.now()}-${retryCount.value}`
}

function resetImage() {
  clearRetryTimer()
  failed.value = false
  retryCount.value = 0
  displaySrc.value = normalizedSrc.value
}

function handleLoad(event) {
  clearRetryTimer()
  failed.value = false
  retryCount.value = 0
  emit('load', event)
}

function handleError(event) {
  emit('error', event)
  if (!normalizedSrc.value) {
    failed.value = true
    return
  }

  if (retryCount.value < 3) {
    retryCount.value += 1
    const delay = 420 * retryCount.value
    clearRetryTimer()
    retryTimer.value = window.setTimeout(() => {
      displaySrc.value = withRetryParam(normalizedSrc.value)
    }, delay)
    return
  }

  failed.value = true
}

function retryNow() {
  clearRetryTimer()
  failed.value = false
  retryCount.value = 0
  displaySrc.value = withRetryParam(normalizedSrc.value, 'manualRetry')
}

watch(normalizedSrc, resetImage, { immediate: true })

onBeforeUnmount(clearRetryTimer)
</script>

<template>
  <span class="retryable-image-shell" :class="{ 'is-failed': failed }">
    <img
      v-if="displaySrc"
      :src="displaySrc"
      :alt="alt"
      :class="imgClass"
      :loading="loading"
      decoding="async"
      :draggable="draggable"
      @load="handleLoad"
      @error="handleError"
    />
    <button
      v-if="failed && showButton"
      type="button"
      class="retryable-image-button"
      @click.prevent.stop="retryNow"
    >
      <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
      重试
    </button>
  </span>
</template>

<style scoped>
.retryable-image-shell {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}

.retryable-image-shell > img {
  width: 100%;
  height: 100%;
}

.retryable-image-shell.is-failed {
  background: rgba(120, 126, 148, 0.12);
}

.retryable-image-button {
  position: absolute;
  left: 50%;
  top: 50%;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 10px;
  color: #fff;
  background: rgba(7, 10, 15, 0.76);
  font-size: 0.8rem;
  font-weight: 760;
  transform: translate(-50%, -50%);
  backdrop-filter: blur(8px);
}

.retryable-image-button:hover {
  border-color: rgba(124, 255, 103, 0.5);
  background: rgba(76, 175, 80, 0.22);
}
</style>
