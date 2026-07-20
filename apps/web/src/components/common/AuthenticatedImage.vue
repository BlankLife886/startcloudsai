<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  isAuthenticatedAiMediaUrl,
  releaseAuthenticatedMediaUrl,
  resolveAuthenticatedMediaUrl,
} from '@/services/authenticatedMedia'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  loading: { type: String, default: 'lazy' },
  decoding: { type: String, default: 'async' },
  fetchpriority: { type: String, default: 'auto' },
  rootMargin: { type: String, default: '360px 0px' },
  retryCount: { type: Number, default: 1 },
  unloadDelay: { type: Number, default: 900 },
  maxDimension: { type: Number, default: 0 },
})

const emit = defineEmits(['load', 'error'])
const imageEl = ref(null)
const resolvedSrc = ref('')
const loaded = ref(false)
const failed = ref(false)
const loadActive = ref(false)
const nativeLoading = computed(() =>
  isAuthenticatedAiMediaUrl(props.src) ? 'eager' : props.loading,
)
let loadToken = 0
let observer = null
let retryAttempt = 0
let retryTimer = null
let unloadTimer = null
let nearViewport = false

function clearRetryTimer() {
  if (retryTimer) window.clearTimeout(retryTimer)
  retryTimer = null
}

function clearUnloadTimer() {
  if (unloadTimer) window.clearTimeout(unloadTimer)
  unloadTimer = null
}

function stopObserving() {
  observer?.disconnect()
  observer = null
}

async function resolveSource(value = props.src) {
  const token = ++loadToken
  const next = String(value || '').trim()
  if (!next) return
  failed.value = false
  try {
    const resolved = await resolveAuthenticatedMediaUrl(next, {
      maxDimension: props.maxDimension,
    })
    if (token === loadToken) {
      resolvedSrc.value = resolved
      if (!nearViewport && props.loading !== 'eager') scheduleSourceRelease(next)
    }
  } catch (error) {
    if (token === loadToken) {
      resolvedSrc.value = ''
      loaded.value = false
      if (retryAttempt < Math.max(0, Number(props.retryCount) || 0) && props.src) {
        retryAttempt += 1
        failed.value = false
        clearRetryTimer()
        retryTimer = window.setTimeout(() => {
          retryTimer = null
          void resolveSource(props.src)
        }, 240 * retryAttempt)
        return
      }
      failed.value = true
      emit('error', error)
    }
  }
}

function releaseResolvedSource(value = props.src, maxDimension = props.maxDimension) {
  const current = resolvedSrc.value
  if (!current) return
  ++loadToken
  resolvedSrc.value = ''
  loaded.value = false
  failed.value = false
  releaseAuthenticatedMediaUrl(value, current, { maxDimension })
}

function scheduleSourceRelease(value) {
  if (props.loading === 'eager' || !resolvedSrc.value || unloadTimer) return
  const delay = Math.max(200, Number(props.unloadDelay) || 0)
  unloadTimer = window.setTimeout(() => {
    unloadTimer = null
    releaseResolvedSource(value)
  }, delay)
}

function observeProtectedSource(value) {
  stopObserving()
  if (
    props.loading === 'eager' ||
    !isAuthenticatedAiMediaUrl(value) ||
    typeof IntersectionObserver === 'undefined'
  ) {
    nearViewport = true
    loadActive.value = true
    void resolveSource(value)
    return
  }
  const el = imageEl.value
  if (!el) return
  observer = new IntersectionObserver(
    (entries) => {
      const isNearViewport = entries.some((entry) => entry.isIntersecting)
      nearViewport = isNearViewport
      loadActive.value = isNearViewport
      if (isNearViewport) {
        clearUnloadTimer()
        if (!resolvedSrc.value) void resolveSource(value)
        return
      }
      scheduleSourceRelease(value)
    },
    { rootMargin: props.rootMargin, threshold: 0.01 },
  )
  observer.observe(el)
}

function handleLoad(event) {
  clearRetryTimer()
  retryAttempt = 0
  loaded.value = true
  failed.value = false
  emit('load', event)
}

function handleError(event) {
  loaded.value = false
  if (retryAttempt < Math.max(0, Number(props.retryCount) || 0) && props.src) {
    retryAttempt += 1
    failed.value = false
    releaseResolvedSource(props.src)
    clearRetryTimer()
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      void resolveSource(props.src)
    }, 240 * retryAttempt)
    return
  }
  failed.value = true
  resolvedSrc.value = ''
  emit('error', event)
}

watch(
  () => [props.src, props.loading, props.rootMargin, props.maxDimension],
  ([value], previous = []) => {
    ++loadToken
    releaseResolvedSource(previous[0], previous[3])
    const next = String(value || '').trim()
    resolvedSrc.value = ''
    loaded.value = false
    failed.value = false
    retryAttempt = 0
    clearRetryTimer()
    clearUnloadTimer()
    stopObserving()
    nearViewport = false
    loadActive.value = false
    if (!next) return
    void nextTick(() => observeProtectedSource(next))
  },
  { immediate: true },
)

onMounted(() => {
  if (props.src && !resolvedSrc.value) observeProtectedSource(String(props.src).trim())
})

onBeforeUnmount(() => {
  ++loadToken
  clearRetryTimer()
  clearUnloadTimer()
  stopObserving()
  releaseResolvedSource(props.src)
})
</script>

<template>
  <span
    v-bind="$attrs"
    ref="imageEl"
    class="authenticated-image"
    :class="{
      'is-loading': Boolean(src) && loadActive && !loaded && !failed,
      'is-loaded': loaded,
      'is-failed': failed,
      'is-placeholder': !resolvedSrc,
    }"
    role="img"
    :aria-label="alt || (failed ? '图片暂时无法读取' : '图片加载中')"
  >
    <img
      v-if="resolvedSrc"
      class="authenticated-image-media"
      :src="resolvedSrc"
      :alt="alt"
      :loading="nativeLoading"
      :decoding="decoding"
      :fetchpriority="fetchpriority"
      draggable="false"
      @load="handleLoad"
      @error="handleError"
    />
  </span>
</template>

<style scoped>
.authenticated-image {
  display: block;
  background-color: rgba(120, 133, 148, 0.1);
}

.authenticated-image.is-placeholder {
  color: transparent;
}

.authenticated-image-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: inherit;
  object-position: inherit;
}

.authenticated-image.is-loading {
  background-image: linear-gradient(
    105deg,
    rgba(255, 255, 255, 0.025) 24%,
    rgba(255, 255, 255, 0.1) 42%,
    rgba(255, 255, 255, 0.025) 60%
  );
  background-size: 220% 100%;
  animation: authenticated-image-skeleton 1.25s linear infinite;
}

.authenticated-image.is-loaded {
  animation: authenticated-image-reveal 0.32s ease-out;
}

.authenticated-image.is-failed {
  background-image: linear-gradient(
    105deg,
    rgba(255, 255, 255, 0.025) 24%,
    rgba(255, 255, 255, 0.055) 42%,
    rgba(255, 255, 255, 0.025) 60%
  );
  background-size: 220% 100%;
}

@keyframes authenticated-image-skeleton {
  to { background-position: -220% 0; }
}

@keyframes authenticated-image-reveal {
  from { opacity: 0.35; filter: blur(7px); transform: scale(1.012); }
  to { opacity: 1; filter: blur(0); transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .authenticated-image.is-loading,
  .authenticated-image.is-loaded { animation: none; }
}
</style>
