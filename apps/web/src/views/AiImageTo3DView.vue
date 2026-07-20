<script setup>
import { computed, onMounted } from 'vue'
import WallpaperModelPanel from '@/components/wallpaper/fullscreen-preview/features/model/WallpaperModelPanel.vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

const runtimeConfigStore = useRuntimeConfigStore()

const modelFeatureConfig = computed(() => ({
  ...(runtimeConfigStore.getFeatureConfig('ai.imageToModel') || {}),
  aiModelCatalog: runtimeConfigStore.getAiModelCatalog(),
}))

const disabledMessage = computed(() => {
  if (runtimeConfigStore.isBlocked) return runtimeConfigStore.blockReason
  if (!runtimeConfigStore.canUse('ai.imageToModel')) {
    return runtimeConfigStore.getFeatureConfig('ai.imageToModel')?.config?.message || '图转模型功能暂未开放'
  }
  return ''
})

onMounted(() => {
  runtimeConfigStore.loadRuntimeConfig()
})

function loadImageFromSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}
</script>

<template>
  <main class="model-studio-page">
    <WallpaperModelPanel
      show
      embedded
      :runtime-config="modelFeatureConfig"
      :disabled-message="disabledMessage"
      :load-image-from-src="loadImageFromSrc"
    />
  </main>
</template>
