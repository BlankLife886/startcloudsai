<script setup>
import '@/components/wallpaper/fullscreen-preview/features/filters/filter-panel.css'
import FilterPanelHeader from '@/components/wallpaper/fullscreen-preview/features/filters/FilterPanelHeader.vue'
import FilterPanelTabs from '@/components/wallpaper/fullscreen-preview/features/filters/FilterPanelTabs.vue'
import FilterAdjustSection from '@/components/wallpaper/fullscreen-preview/features/filters/FilterAdjustSection.vue'
import FilterPresetSection from '@/components/wallpaper/fullscreen-preview/features/filters/FilterPresetSection.vue'
import FilterStyleSection from '@/components/wallpaper/fullscreen-preview/features/filters/FilterStyleSection.vue'
import { ref, watch } from 'vue'

// 滤镜面板只负责参数展示和事件派发，实际滤镜计算放在 usePreviewEffects。
const props = defineProps({
  showFilters: { type: Boolean, default: false },
  historyIndex: { type: Number, default: -1 },
  filterHistoryLength: { type: Number, default: 0 },
  activeFilter: { type: String, default: 'none' },
  filterParams: { type: Object, required: true },
  filterIntensity: { type: Number, default: 100 },
  /** 当前选中的预设 id（含 none、grayscale 等） */
  selectedPresetId: { default: null },
  activeArtStyle: { type: String, default: 'none' },
  artStyleIntensity: { type: Number, default: 60 },
  artStyleParams: { type: Object, default: () => ({}) },
  customPresets: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'undo',
  'redo',
  'reset',
  'close',
  'apply-preset',
  'filter-change',
  'filter-intensity-change',
  'save-custom-preset',
  'remove-custom-preset',
  'apply-art-style',
  'art-style-intensity-change',
  'art-style-param-change',
  'panel-enter',
  'panel-leave',
])

const tab = ref('presets')
const lastTab = ref('presets')
const presetResetToken = ref(0)

watch(tab, (value) => {
  lastTab.value = value
})

watch(
  () => props.showFilters,
  (open) => {
    if (!open) return
    // 有活跃风格时回到风格 Tab，否则恢复上次停留的 Tab，避免每次打开都跳回预设
    if (props.activeArtStyle && props.activeArtStyle !== 'none') {
      tab.value = 'styles'
    } else {
      tab.value = lastTab.value
    }
    presetResetToken.value += 1
  },
)
</script>

<template>
  <div
    v-if="showFilters"
    class="preview-filter-panel controls-visible"
    @mouseenter="emit('panel-enter')"
    @mouseleave="emit('panel-leave')"
  >
    <FilterPanelHeader
      :history-index="historyIndex"
      :filter-history-length="filterHistoryLength"
      @undo="emit('undo')"
      @redo="emit('redo')"
      @reset="emit('reset')"
      @close="emit('close')"
    />

    <FilterPanelTabs v-model:active-tab="tab" />

    <div class="filter-content">
      <FilterPresetSection
        v-show="tab === 'presets'"
        :active-filter="activeFilter"
        :selected-preset-id="selectedPresetId"
        :custom-presets="customPresets"
        :reset-token="presetResetToken"
        @apply-preset="emit('apply-preset', $event)"
        @save-custom-preset="emit('save-custom-preset', $event)"
        @remove-custom-preset="emit('remove-custom-preset', $event)"
      />

      <FilterStyleSection
        v-show="tab === 'styles'"
        :active-art-style="activeArtStyle"
        :art-style-intensity="artStyleIntensity"
        :art-style-params="artStyleParams"
        @apply-art-style="emit('apply-art-style', $event)"
        @art-style-intensity-change="emit('art-style-intensity-change', $event)"
        @art-style-param-change="emit('art-style-param-change', $event)"
      />

      <FilterAdjustSection
        v-show="tab === 'pro'"
        :active-filter="activeFilter"
        :filter-params="filterParams"
        :filter-intensity="filterIntensity"
        @filter-change="emit('filter-change')"
        @filter-intensity-change="emit('filter-intensity-change', $event)"
      />
    </div>
  </div>
</template>
