<script setup>
import PreviewToolbarActions from '@/components/wallpaper/fullscreen-preview/features/toolbar/PreviewToolbarActions.vue'
import PreviewToolbarNavigation from '@/components/wallpaper/fullscreen-preview/features/toolbar/PreviewToolbarNavigation.vue'

// 顶部工具栏现在只是壳层，主按钮组和集合导航分别拆出去。
defineProps({
  showControls: { type: Boolean, default: true },
  isFullscreen: { type: Boolean, default: false },
  isFavorite: { type: Boolean, default: false },
  mockupMode: { type: String, default: 'none' },
  showMockupSettings: { type: Boolean, default: false },
  fitMode: { type: String, default: 'contain' },
  showFilters: { type: Boolean, default: false },
  activeFilter: { type: String, default: 'none' },
  activeArtStyle: { type: String, default: 'none' },
  comparisonMode: { type: String, default: 'none' },
  inCollection: { type: Boolean, default: false },
  showInfo: { type: Boolean, default: false },
  collectionIndex: { type: Number, default: -1 },
  collectionTotal: { type: Number, default: 0 },
  cropMode: { type: Boolean, default: false },
  cropReady: { type: Boolean, default: false },
  showAiPanel: { type: Boolean, default: false },
  aiTitle: { type: String, default: '' },
  downloadStatus: { type: String, default: 'idle' },
  enabledActions: {
    type: Object,
    default: () => ({
      favorite: true,
      mockup: true,
      rotate: true,
      fit: true,
      info: true,
      compare: true,
      crop: true,
      decompose: true,
      filters: true,
      ai: true,
      download: true,
      fullscreen: true,
    }),
  },
})

const emit = defineEmits([
  'close',
  'toggle-fullscreen',
  'toggle-favorite',
  'toggle-desktop-mockup',
  'toggle-mockup-settings',
  'toggle-phone-mockup',
  'toggle-fit-mode',
  'open-download',
  'rotate',
  'toggle-filters',
  'toggle-compare',
  'toggle-info',
  'toggle-crop',
  'apply-crop',
  'cancel-crop',
  'decompose-image',
  'toggle-ai',
  'previous',
  'next',
  'controls-enter',
  'controls-leave',
])
</script>

<template>
  <PreviewToolbarActions
    :show-controls="showControls"
    :is-fullscreen="isFullscreen"
    :is-favorite="isFavorite"
    :mockup-mode="mockupMode"
    :show-mockup-settings="showMockupSettings"
    :fit-mode="fitMode"
    :show-filters="showFilters"
    :active-filter="activeFilter"
    :active-art-style="activeArtStyle"
    :comparison-mode="comparisonMode"
    :show-info="showInfo"
    :crop-mode="cropMode"
    :crop-ready="cropReady"
    :show-ai-panel="showAiPanel"
    :ai-title="aiTitle"
    :download-status="downloadStatus"
    :enabled-actions="enabledActions"
    @close="emit('close')"
    @toggle-fullscreen="emit('toggle-fullscreen')"
    @toggle-favorite="emit('toggle-favorite')"
    @toggle-desktop-mockup="emit('toggle-desktop-mockup')"
    @toggle-mockup-settings="emit('toggle-mockup-settings')"
    @toggle-phone-mockup="emit('toggle-phone-mockup')"
    @toggle-fit-mode="emit('toggle-fit-mode')"
    @open-download="emit('open-download')"
    @rotate="emit('rotate')"
    @toggle-filters="emit('toggle-filters')"
    @toggle-compare="emit('toggle-compare')"
    @toggle-info="emit('toggle-info')"
    @toggle-crop="emit('toggle-crop')"
    @apply-crop="emit('apply-crop')"
    @cancel-crop="emit('cancel-crop')"
    @decompose-image="emit('decompose-image')"
    @toggle-ai="emit('toggle-ai')"
    @controls-enter="emit('controls-enter')"
    @controls-leave="emit('controls-leave')"
  />

  <PreviewToolbarNavigation
    :show-controls="showControls"
    :in-collection="inCollection"
    :collection-index="collectionIndex"
    :collection-total="collectionTotal"
    @previous="emit('previous')"
    @next="emit('next')"
    @controls-enter="emit('controls-enter')"
    @controls-leave="emit('controls-leave')"
  />
</template>
