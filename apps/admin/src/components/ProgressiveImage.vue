<script setup lang="ts">
import { ref, watch } from 'vue'

/** 简化版渐进加载媒体：原生 img + 骨架屏（替代旧 AdminProgressiveMedia） */
const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    fit?: 'cover' | 'contain'
  }>(),
  { src: '', alt: '', fit: 'cover' },
)

const loaded = ref(false)
const failed = ref(false)

watch(
  () => props.src,
  () => {
    loaded.value = false
    failed.value = false
  },
)
</script>

<template>
  <span class="progressive-image" :class="[`is-${fit}`, { 'is-loaded': loaded }]">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="alt"
      loading="lazy"
      decoding="async"
      draggable="false"
      @load="loaded = true"
      @error="failed = true"
    />
    <span v-if="!loaded && !failed && src" class="progressive-image__skeleton" aria-hidden="true" />
    <span v-if="failed || !src" class="progressive-image__fallback">{{ failed ? '图片加载失败' : '暂无图片' }}</span>
  </span>
</template>

<style scoped>
.progressive-image {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--el-fill-color-light);
}

.progressive-image img {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.progressive-image.is-cover img {
  object-fit: cover;
}

.progressive-image.is-contain img {
  object-fit: contain;
}

.progressive-image.is-loaded img {
  opacity: 1;
}

.progressive-image__skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    rgba(128, 139, 158, 0.08) 22%,
    rgba(128, 139, 158, 0.18) 42%,
    rgba(128, 139, 158, 0.08) 62%
  );
  background-size: 220% 100%;
  animation: progressive-shimmer 1.15s linear infinite;
}

.progressive-image__fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}

@keyframes progressive-shimmer {
  to {
    background-position: -220% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .progressive-image img {
    transition: none;
  }

  .progressive-image__skeleton {
    animation: none;
  }
}
</style>
