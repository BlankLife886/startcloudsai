<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  width: { type: [Number, String], default: 0 },
  height: { type: [Number, String], default: 0 },
  fit: { type: String, default: 'cover' },
  loading: { type: String, default: 'lazy' },
  decoding: { type: String, default: 'async' },
  fetchpriority: { type: String, default: 'auto' },
  rootMargin: { type: String, default: '480px 0px' },
  retryCount: { type: Number, default: 1 },
})

const emit = defineEmits(['load', 'error', 'dimensions'])
const rootRef = ref(null)
const active = ref(props.loading === 'eager')
const loaded = ref(false)
const failed = ref(false)
const retryKey = ref(0)
let observer = null
let retryAttempt = 0

const intrinsicWidth = computed(() => Math.max(0, Number(props.width) || 0))
const intrinsicHeight = computed(() => Math.max(0, Number(props.height) || 0))
const rootStyle = computed(() => ({
  '--optimized-image-fit': props.fit === 'contain' ? 'contain' : 'cover',
  ...(intrinsicWidth.value > 0 && intrinsicHeight.value > 0
    ? { aspectRatio: `${intrinsicWidth.value} / ${intrinsicHeight.value}` }
    : {}),
}))

function stopObserving() {
  observer?.disconnect()
  observer = null
}

function observe() {
  stopObserving()
  if (props.loading === 'eager' || typeof IntersectionObserver === 'undefined') {
    active.value = true
    return
  }
  if (!rootRef.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      active.value = true
      stopObserving()
    },
    { rootMargin: props.rootMargin, threshold: 0.01 },
  )
  observer.observe(rootRef.value)
}

function handleLoad(event) {
  loaded.value = true
  failed.value = false
  retryAttempt = 0
  const image = event?.target
  const width = Number(image?.naturalWidth || 0)
  const height = Number(image?.naturalHeight || 0)
  if (width > 0 && height > 0) emit('dimensions', { width, height })
  emit('load', event)
}

function handleError(event) {
  loaded.value = false
  if (retryAttempt < Math.max(0, Number(props.retryCount) || 0)) {
    retryAttempt += 1
    retryKey.value += 1
    active.value = false
    window.setTimeout(() => {
      active.value = true
    }, 240 * retryAttempt)
    return
  }
  failed.value = true
  emit('error', event)
}

watch(
  () => [props.src, props.loading, props.rootMargin],
  () => {
    loaded.value = false
    failed.value = false
    retryAttempt = 0
    active.value = props.loading === 'eager'
    nextTick(observe)
  },
)

onMounted(observe)
onBeforeUnmount(stopObserving)
</script>

<template>
  <span
    v-bind="$attrs"
    ref="rootRef"
    class="optimized-image"
    :class="{ 'is-loaded': loaded, 'is-failed': failed }"
    :style="rootStyle"
    role="img"
    :aria-label="alt || (failed ? '图片加载失败' : '图片加载中')"
  >
    <span class="optimized-image__skeleton" aria-hidden="true"></span>
    <img
      v-if="active && src && !failed"
      :key="`${src}:${retryKey}`"
      :src="src"
      :alt="alt"
      :width="intrinsicWidth || undefined"
      :height="intrinsicHeight || undefined"
      :loading="loading"
      :decoding="decoding"
      :fetchpriority="fetchpriority"
      draggable="false"
      @load="handleLoad"
      @error="handleError"
    />
    <span v-if="failed || !src" class="optimized-image__fallback">
      <i class="bi bi-image" aria-hidden="true"></i>
      <span>{{ failed ? '图片加载失败' : '暂无图片' }}</span>
    </span>
  </span>
</template>

<style scoped>
.optimized-image {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: rgba(120, 133, 148, 0.1);
}

.optimized-image img {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: var(--optimized-image-fit, cover);
  opacity: 0;
  transition: opacity 180ms ease;
}

.optimized-image.is-loaded img {
  opacity: 1;
}

.optimized-image__skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    rgba(120, 133, 148, 0.08) 24%,
    rgba(160, 170, 185, 0.16) 42%,
    rgba(120, 133, 148, 0.08) 60%
  );
  background-size: 220% 100%;
  animation: optimized-image-shimmer 1.2s linear infinite;
}

.optimized-image.is-loaded .optimized-image__skeleton,
.optimized-image.is-failed .optimized-image__skeleton {
  opacity: 0;
}

.optimized-image__fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 6px;
  color: #8b91a1;
  font-size: 0.72rem;
  text-align: center;
}

@keyframes optimized-image-shimmer {
  to {
    background-position: -220% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .optimized-image img {
    transition: none;
  }

  .optimized-image__skeleton {
    animation: none;
  }
}
</style>
