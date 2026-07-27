<script setup>
import {
  DESKTOP_MOCKUP_PLATFORM,
  DESKTOP_MOCKUP_PRESETS,
  getDefaultDesktopMockupSize,
  normalizeDesktopMockupConfig,
} from './useDesktopMockupSettings'
import { computed, ref, watch } from 'vue'

const props = defineProps({
  config: { type: Object, default: () => ({}) },
  show: { type: Boolean, default: true },
})

const emit = defineEmits(['update'])
const isCustomEditing = ref(false)

const normalizedConfig = computed(() => normalizeDesktopMockupConfig(props.config))
const platformPresets = computed(
  () => DESKTOP_MOCKUP_PRESETS[normalizedConfig.value.platform] || [],
)
const exportResolutionText = computed(
  () => `${normalizedConfig.value.exportWidth} x ${normalizedConfig.value.exportHeight}`,
)

const matchedPreset = computed(() =>
  platformPresets.value.find(
    (preset) =>
      preset.width === normalizedConfig.value.width &&
      preset.height === normalizedConfig.value.height,
  ),
)
const showCustomSizeFields = computed(() => isCustomEditing.value || !matchedPreset.value)

watch(matchedPreset, (preset) => {
  if (!preset) {
    isCustomEditing.value = true
  }
})

function updatePlatform(platform) {
  const currentPreset = matchedPreset.value
  const nextSize = currentPreset ? getDefaultDesktopMockupSize(platform) : normalizedConfig.value
  isCustomEditing.value = !currentPreset
  emit('update', {
    platform,
    width: nextSize.width,
    height: nextSize.height,
  })
}

function applyPreset(event) {
  const preset = platformPresets.value.find((item) => item.id === event.target.value)
  if (!preset) return
  isCustomEditing.value = false
  emit('update', {
    width: preset.width,
    height: preset.height,
  })
}

function applyPresetById(presetId) {
  const preset = platformPresets.value.find((item) => item.id === presetId)
  if (!preset) return
  isCustomEditing.value = false
  emit('update', {
    width: preset.width,
    height: preset.height,
  })
}

function editCustomSize() {
  isCustomEditing.value = true
}

function updateSize(key, event) {
  emit('update', {
    [key]: event.target.value,
  })
}
</script>

<template>
  <div class="desktop-mockup-settings" :class="{ 'settings-visible': show }">
    <div class="desktop-settings-header">
      <div>
        <strong>样机配置</strong>
        <span>{{
          normalizedConfig.platform === DESKTOP_MOCKUP_PLATFORM.macos ? 'Retina 导出' : '标准屏幕'
        }}</span>
      </div>
      <div class="desktop-export-chip">{{ exportResolutionText }}</div>
    </div>

    <div class="desktop-mockup-platforms" role="group" aria-label="桌面系统">
      <button
        type="button"
        class="desktop-platform-btn"
        :class="{ active: normalizedConfig.platform === DESKTOP_MOCKUP_PLATFORM.macos }"
        @click="updatePlatform(DESKTOP_MOCKUP_PLATFORM.macos)"
      >
        <i class="bi bi-apple"></i>
        <span>macOS</span>
      </button>
      <button
        type="button"
        class="desktop-platform-btn"
        :class="{ active: normalizedConfig.platform === DESKTOP_MOCKUP_PLATFORM.windows }"
        @click="updatePlatform(DESKTOP_MOCKUP_PLATFORM.windows)"
      >
        <i class="bi bi-windows"></i>
        <span>Windows</span>
      </button>
    </div>

    <label class="desktop-setting-row desktop-setting-row--native">
      <span>预设</span>
      <select
        :value="matchedPreset?.id || 'custom'"
        @change="applyPreset"
        aria-label="桌面尺寸预设"
      >
        <option value="custom">自定义</option>
        <option v-for="preset in platformPresets" :key="preset.id" :value="preset.id">
          {{ preset.label }}
        </option>
      </select>
    </label>

    <div class="desktop-preset-grid" role="group" aria-label="桌面尺寸预设">
      <button
        v-for="preset in platformPresets"
        :key="preset.id"
        type="button"
        class="desktop-preset-btn"
        :class="{ active: !showCustomSizeFields && matchedPreset?.id === preset.id }"
        @click="applyPresetById(preset.id)"
      >
        <strong>{{ preset.label }}</strong>
        <span>{{ preset.width }} x {{ preset.height }}</span>
      </button>
      <button
        type="button"
        class="desktop-preset-btn desktop-preset-btn--custom"
        :class="{ active: showCustomSizeFields }"
        @click="editCustomSize"
      >
        <strong>自定义</strong>
        <span>{{ normalizedConfig.width }} x {{ normalizedConfig.height }}</span>
      </button>
    </div>

    <div v-if="showCustomSizeFields" class="desktop-size-grid">
      <label>
        <span>显示宽</span>
        <input
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          :value="normalizedConfig.width"
          @input="updateSize('width', $event)"
        />
      </label>
      <span class="desktop-size-separator">x</span>
      <label>
        <span>显示高</span>
        <input
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          :value="normalizedConfig.height"
          @input="updateSize('height', $event)"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.desktop-mockup-settings {
  position: absolute;
  top: 74px;
  right: 24px;
  width: 304px;
  padding: 14px;
  display: grid;
  gap: 12px;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(15, 17, 20, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.38);
  opacity: 0;
  transform: translateY(-8px);
  pointer-events: none;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  backdrop-filter: blur(16px);
  z-index: 3;
}

.desktop-mockup-settings.settings-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.desktop-settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.desktop-settings-header div:first-child {
  display: grid;
  gap: 3px;
}

.desktop-settings-header strong {
  font-size: 0.9rem;
  line-height: 1.2;
  color: #fff;
}

.desktop-settings-header span {
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.54);
}

.desktop-export-chip {
  flex: 0 0 auto;
  padding: 5px 8px;
  border-radius: 7px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.68rem;
  font-weight: 700;
}

.desktop-mockup-platforms {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
}

.desktop-platform-btn {
  height: 34px;
  border: 0;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.68);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.desktop-platform-btn.active {
  color: #111827;
  background: rgba(255, 255, 255, 0.9);
}

.desktop-platform-btn:not(.active):hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
}

.desktop-setting-row,
.desktop-size-grid label {
  display: grid;
  gap: 4px;
}

.desktop-setting-row--native {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.desktop-setting-row span,
.desktop-size-grid span {
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.56);
}

.desktop-setting-row select,
.desktop-size-grid input {
  width: 100%;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.76rem;
  outline: none;
}

.desktop-setting-row select {
  padding: 0 8px;
}

.desktop-size-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: 8px;
}

.desktop-size-grid input {
  padding: 0 7px;
}

.desktop-size-separator {
  padding-bottom: 8px;
  color: rgba(255, 255, 255, 0.36);
  font-size: 0.76rem;
  font-weight: 700;
}

.desktop-preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.desktop-preset-btn {
  min-height: 54px;
  padding: 8px 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  display: grid;
  gap: 4px;
  text-align: left;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.055);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    transform 0.18s ease;
}

.desktop-preset-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
}

.desktop-preset-btn.active {
  border-color: rgba(111, 207, 151, 0.72);
  background: rgba(76, 175, 80, 0.22);
}

.desktop-preset-btn strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.76rem;
  line-height: 1.1;
}

.desktop-preset-btn span {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.66rem;
}

.desktop-preset-btn--custom {
  appearance: none;
}

@media (max-width: 768px) {
  .desktop-mockup-settings {
    top: auto;
    right: 12px;
    bottom: 16px;
    width: min(304px, calc(100vw - 24px));
  }
}
</style>
