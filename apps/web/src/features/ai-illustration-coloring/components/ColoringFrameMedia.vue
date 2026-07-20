<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveAuthenticatedMediaUrl } from '@/services/authenticatedMedia'

const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  fitMode: { type: String, default: 'contain' },
  frameKey: { type: String, default: 'source' },
  pannable: { type: Boolean, default: false },
  mediaKey: { type: String, default: '' },
})

const emit = defineEmits([
  'pan-start',
  'pan-move',
  'pan-end',
  'zoom-wheel',
  'zoom-double-click',
  'mount-body',
  'register-transform',
  'load',
  'error',
])

const bodyRef = ref(null)
const transformRef = ref(null)
const loaded = ref(false)
const displaySrc = ref('')
let loadToken = 0

const mediaStyle = () =>
  props.fitMode === 'cover'
    ? {
        width: '100%',
        height: '100%',
        maxWidth: 'none',
        maxHeight: 'none',
        objectFit: 'cover',
      }
    : {
        width: 'auto',
        height: 'auto',
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain',
      }

watch(
  () => [props.src, props.mediaKey],
  async () => {
    loaded.value = false
    const token = ++loadToken
    const next = String(props.src || '').trim()
    displaySrc.value = ''
    if (!next) return
    const resolved = await resolveAuthenticatedMediaUrl(next).catch(() => next)
    if (token !== loadToken) return
    displaySrc.value = resolved
    const img = new Image()
    img.decoding = 'async'
    const finish = () => {
      if (token !== loadToken) return
      loaded.value = true
    }
    img.onload = finish
    img.onerror = finish
    // 已缓存时可能同步完成
    img.src = resolved
    if (img.complete) finish()
  },
  { immediate: true },
)

onMounted(() => {
  emit('mount-body', { el: bodyRef.value, frameKey: props.frameKey })
  emit('register-transform', { el: transformRef.value, frameKey: props.frameKey })
})

onBeforeUnmount(() => {
  emit('mount-body', { el: null, frameKey: props.frameKey })
  emit('register-transform', { el: null, frameKey: props.frameKey })
})

watch(transformRef, (el) => {
  emit('register-transform', { el, frameKey: props.frameKey })
})

function onImageLoad(event) {
  loaded.value = true
  emit('load', event)
}

function onImageError(event) {
  loaded.value = true
  emit('error', event)
}

function onPointerDown(event) {
  emit('pan-start', event, props.frameKey)
}

function onPointerMove(event) {
  emit('pan-move', event)
}

function onPointerUp(event) {
  emit('pan-end', event)
}
</script>

<template>
  <div
    ref="bodyRef"
    class="coloring-frame-body"
    :class="{
      pannable,
      'is-loading': src && !loaded,
    }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="emit('zoom-wheel', $event, frameKey)"
    @dblclick="emit('zoom-double-click', $event, frameKey)"
  >
    <div v-if="src && !loaded" class="coloring-media-skeleton" aria-hidden="true">
      <span class="coloring-media-skeleton-shimmer"></span>
    </div>
    <div
      v-if="displaySrc"
      class="coloring-frame-matte"
      :class="[`fit-${fitMode}`, { 'is-visible': loaded }]"
    >
      <div ref="transformRef" class="coloring-media-transform">
        <img
          :key="`${frameKey}-${mediaKey}-${displaySrc}`"
          :src="displaySrc"
          :alt="alt"
          :style="mediaStyle()"
          decoding="async"
          draggable="false"
          @load="onImageLoad"
          @error="onImageError"
        />
      </div>
    </div>
    <slot v-else />
  </div>
</template>
