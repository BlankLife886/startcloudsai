<script setup>
import { computed, ref } from 'vue'
import WallpaperDesktopMockupSettings from './WallpaperDesktopMockupSettings.vue'
import WallpaperDeviceMockup from './WallpaperDeviceMockup.vue'

// 样机舞台只关心设备外壳和当前图片，设备类型由工具栏状态传入。
const props = defineProps({
  mockupMode: { type: String, default: 'none' },
  imageUrl: { type: String, default: '' },
  imageCrossorigin: { default: null },
  filterCss: { type: String, default: '' },
  showSettings: { type: Boolean, default: false },
  desktopConfig: { type: Object, default: () => ({}) },
  screenLoading: { type: Boolean, default: false },
})

const emit = defineEmits(['image-loaded', 'image-error', 'update-desktop-config'])
const deviceMockupRef = ref(null)

const isDesktop = computed(() => props.mockupMode === 'desktop')
const isPhone = computed(() => props.mockupMode.startsWith('phone-'))

const stageClass = computed(() => ({
  'mockup-stage--desktop': isDesktop.value,
  'mockup-stage--phone': isPhone.value,
}))

async function exportMockupImage() {
  return await deviceMockupRef.value?.exportMockupImage?.()
}

function handleDesktopSettingsUpdate(payload) {
  emit('update-desktop-config', payload)
}

defineExpose({
  exportMockupImage,
})
</script>

<template>
  <div class="mockup-stage" :class="stageClass">
    <WallpaperDesktopMockupSettings
      v-if="isDesktop"
      :show="showSettings"
      :config="desktopConfig"
      @update="handleDesktopSettingsUpdate"
    />

    <WallpaperDeviceMockup
      ref="deviceMockupRef"
      :variant="mockupMode"
      :src="imageUrl"
      :crossorigin="imageCrossorigin"
      :filter-css="filterCss"
      :desktop-config="desktopConfig"
      :screen-loading="screenLoading"
      @image-loaded="emit('image-loaded', $event)"
      @image-error="emit('image-error', $event)"
    />
  </div>
</template>

<style scoped>
.mockup-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 28px 42px;
  z-index: 1;
}

.mockup-stage--desktop {
  padding-top: 14px;
  padding-bottom: 32px;
}

.mockup-stage--phone {
  padding: 44px 48px 48px;
  align-items: center;
}

@media (max-width: 768px) {
  .mockup-stage {
    padding: 18px 12px 30px;
  }

  .mockup-stage--desktop {
    padding-top: 10px;
    padding-bottom: 24px;
  }

  .mockup-stage--phone {
    padding: 44px 12px 42px;
  }
}
</style>
