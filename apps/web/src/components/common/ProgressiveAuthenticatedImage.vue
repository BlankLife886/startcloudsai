<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import AuthenticatedImage from './AuthenticatedImage.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  src: { type: String, default: '' },
  previewSrc: { type: String, default: '' },
  alt: { type: String, default: '' },
  loading: { type: String, default: 'lazy' },
  decoding: { type: String, default: 'async' },
  fetchpriority: { type: String, default: 'auto' },
  rootMargin: { type: String, default: '240px 0px' },
  retryCount: { type: Number, default: 1 },
  loadOriginal: { type: Boolean, default: false },
})

const emit = defineEmits(['load', 'error', 'preview-load', 'original-error'])
const previewLoaded = ref(false)
const previewFailed = ref(false)
const originalActive = ref(false)
const originalLoaded = ref(false)
const originalFailed = ref(false)

const normalizedSource = computed(() => String(props.src || '').trim())
const normalizedPreview = computed(() => String(props.previewSrc || '').trim())
const shouldLoadOriginal = computed(() => props.loadOriginal && Boolean(normalizedSource.value))
const hasDistinctPreview = computed(
  () => Boolean(normalizedPreview.value) && normalizedPreview.value !== normalizedSource.value,
)
const shouldRenderPreview = computed(
  () => Boolean(normalizedPreview.value) && (!shouldLoadOriginal.value || hasDistinctPreview.value),
)
const hasLoadTarget = computed(() =>
  shouldLoadOriginal.value ? Boolean(normalizedSource.value) : Boolean(normalizedPreview.value),
)
const targetLoaded = computed(() =>
  shouldLoadOriginal.value ? originalLoaded.value : previewLoaded.value,
)
const targetFailed = computed(() =>
  shouldLoadOriginal.value ? originalFailed.value && !previewLoaded.value : previewFailed.value,
)

function reset() {
  previewLoaded.value = false
  previewFailed.value = false
  originalLoaded.value = false
  originalFailed.value = false
  originalActive.value = shouldLoadOriginal.value && !hasDistinctPreview.value
}

function activateOriginal() {
  if (!shouldLoadOriginal.value || originalActive.value) return
  void nextTick(() => {
    originalActive.value = true
  })
}

function handlePreviewLoad(event) {
  previewLoaded.value = true
  previewFailed.value = false
  emit('preview-load', event)
  if (shouldLoadOriginal.value) activateOriginal()
  else emit('load', event)
}

function handlePreviewError(event) {
  previewLoaded.value = false
  previewFailed.value = true
  if (shouldLoadOriginal.value) activateOriginal()
  else emit('error', event)
}

function handleOriginalLoad(event) {
  originalLoaded.value = true
  originalFailed.value = false
  emit('load', event)
}

function handleOriginalError(event) {
  originalLoaded.value = false
  originalFailed.value = true
  if (previewLoaded.value) {
    emit('original-error', event)
    return
  }
  emit('error', event)
}

watch(() => [props.src, props.previewSrc, props.loadOriginal], reset, { immediate: true })
</script>

<template>
  <span
    v-bind="$attrs"
    class="authenticated-image progressive-authenticated-image"
    :class="{
      'is-loading': hasLoadTarget && !targetLoaded && !targetFailed,
      'is-preview-loaded': previewLoaded && !originalLoaded,
      'is-original-loaded': originalLoaded,
      'is-thumbnail-only': !shouldLoadOriginal,
      'is-failed': targetFailed,
    }"
    role="img"
    :aria-label="alt || (targetFailed ? '图片暂时无法读取' : '图片加载中')"
  >
    <AuthenticatedImage
      v-if="shouldRenderPreview"
      :key="`${normalizedPreview}:${shouldLoadOriginal ? 'progressive' : 'thumbnail'}`"
      class="progressive-authenticated-image__layer is-preview"
      :class="{ 'is-hidden': originalLoaded }"
      :src="normalizedPreview"
      alt=""
      :loading="loading"
      :decoding="decoding"
      :fetchpriority="fetchpriority"
      :root-margin="rootMargin"
      :retry-count="retryCount"
      @load="handlePreviewLoad"
      @error="handlePreviewError"
    />
    <AuthenticatedImage
      v-if="originalActive"
      class="progressive-authenticated-image__layer is-original"
      :class="{ 'is-visible': originalLoaded }"
      :src="normalizedSource"
      :alt="alt"
      :loading="loading"
      :decoding="decoding"
      :fetchpriority="fetchpriority"
      :root-margin="rootMargin"
      :retry-count="retryCount"
      @load="handleOriginalLoad"
      @error="handleOriginalError"
    />
    <span
      v-if="hasLoadTarget && !targetLoaded"
      class="progressive-authenticated-image__status"
      :class="{ 'is-failed': targetFailed }"
      aria-hidden="true"
    >
      <i
        class="bi"
        :class="targetFailed ? 'bi-image-alt' : 'bi-arrow-repeat'"
        aria-hidden="true"
      ></i>
      <span>{{ targetFailed ? '图片暂时无法读取' : '图片加载中' }}</span>
    </span>
  </span>
</template>

<style scoped>
.progressive-authenticated-image {
  position: relative;
  display: block;
  overflow: hidden;
}

.progressive-authenticated-image__layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: inherit;
  object-position: inherit;
  background: transparent;
}

.progressive-authenticated-image__layer.is-preview {
  z-index: 1;
  opacity: 1;
  transition: opacity 240ms ease-out;
}

.progressive-authenticated-image__layer.is-preview.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.progressive-authenticated-image__layer.is-original {
  z-index: 2;
  opacity: 0;
  transition: opacity 240ms ease-out;
}

.progressive-authenticated-image__layer.is-original.is-visible {
  opacity: 1;
}

.progressive-authenticated-image__status {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 12px;
  color: rgba(230, 228, 239, 0.6);
  background: rgba(15, 16, 25, 0.2);
  font-size: 0.72rem;
  line-height: 1.4;
  text-align: center;
}

.progressive-authenticated-image__status > i {
  font-size: 1rem;
  animation: progressive-authenticated-image-spin 0.9s linear infinite;
}

.progressive-authenticated-image__status.is-failed {
  color: rgba(230, 228, 239, 0.72);
  background: rgba(15, 16, 25, 0.5);
}

.progressive-authenticated-image__status.is-failed > i {
  animation: none;
}

@keyframes progressive-authenticated-image-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .progressive-authenticated-image__layer.is-preview,
  .progressive-authenticated-image__layer.is-original {
    transition: none;
  }

  .progressive-authenticated-image__status > i {
    animation: none;
  }
}
</style>
