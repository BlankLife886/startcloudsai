<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  eager: { type: Boolean, default: false },
})

const rootRef = ref(null)
const active = ref(props.eager)
const loaded = ref(false)
const failed = ref(false)
const retryKey = ref(0)
let observer = null

function beginObserve() {
  observer?.disconnect()
  observer = null
  if (props.eager || typeof IntersectionObserver === 'undefined') {
    active.value = true
    return
  }
  if (!rootRef.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      active.value = true
      observer?.disconnect()
      observer = null
    },
    { rootMargin: '320px 0px', threshold: 0.01 },
  )
  observer.observe(rootRef.value)
}

function retry(event) {
  event?.stopPropagation?.()
  failed.value = false
  loaded.value = false
  active.value = false
  retryKey.value += 1
  requestAnimationFrame(() => {
    active.value = true
  })
}

watch(
  () => props.src,
  () => {
    loaded.value = false
    failed.value = false
    active.value = props.eager
    requestAnimationFrame(beginObserve)
  },
)

onMounted(beginObserve)
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <span
    ref="rootRef"
    v-bind="$attrs"
    class="share-progressive-image"
    :class="{ 'is-loaded': loaded, 'is-failed': failed }"
  >
    <span class="share-progressive-image__skeleton" aria-hidden="true"></span>
    <img
      v-if="active && src"
      :key="`${src}:${retryKey}`"
      :src="src"
      :alt="alt"
      :loading="eager ? 'eager' : 'lazy'"
      :fetchpriority="eager ? 'high' : 'auto'"
      decoding="async"
      draggable="false"
      @load="loaded = true"
      @error="failed = true"
    />
    <button v-if="failed" type="button" class="share-progressive-image__fallback" @click="retry">
      <i class="bi bi-image"></i>
      <span>图片加载失败</span>
      <small>点击重试</small>
    </button>
  </span>
</template>

<style>
.share-progressive-image {
  position: relative;
  display: block;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: #eceef6;
}

.share-progressive-image img {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.share-progressive-image.is-loaded img {
  opacity: 1;
}

.share-progressive-image__skeleton {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(100deg, #eceef5 24%, #f8f8fc 38%, #eceef5 52%);
  background-size: 200% 100%;
  animation: share-progressive-skeleton 1.25s linear infinite;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.share-progressive-image.is-loaded .share-progressive-image__skeleton {
  opacity: 0;
}

.share-progressive-image__fallback {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-content: center;
  gap: 4px;
  margin: 0;
  padding: 8px;
  border: 0;
  color: #6b6685;
  background: #eceef6;
  cursor: pointer;
}

.share-progressive-image__fallback i {
  color: #a998ef;
  font-size: 1.4rem;
}

.share-progressive-image__fallback span {
  font-size: 0.7rem;
}

.share-progressive-image__fallback small {
  font-size: 0.6rem;
  opacity: 0.72;
}

@keyframes share-progressive-skeleton {
  to {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .share-progressive-image img,
  .share-progressive-image__skeleton {
    transition: none;
    animation: none;
  }
}

html.settings-no-animations .share-progressive-image img,
html.settings-no-animations .share-progressive-image__skeleton {
  transition: none !important;
  animation: none !important;
}

html.color-scheme-dark .share-progressive-image {
  background: #171926;
}

html.color-scheme-dark .share-progressive-image__skeleton {
  background: linear-gradient(100deg, #1a1c28 24%, #242736 38%, #1a1c28 52%);
  background-size: 200% 100%;
}

html.color-scheme-dark .share-progressive-image__fallback {
  color: #9a96b0;
  background: #171926;
}
</style>
