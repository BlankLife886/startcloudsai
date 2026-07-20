import {
  clamp,
  cloneArtStyleParams,
  CUSTOM_PRESETS_SETTINGS_KEY,
  defaultFilterParams,
  DEFAULT_ART_STYLE,
  DEFAULT_ART_STYLE_INTENSITY,
  MAX_CUSTOM_PRESETS,
} from '@/components/wallpaper/fullscreen-preview/features/filters/filterStateUtils'
import { buildDefaultArtStyleParams } from '@/features/filters/artStyleEngine'
import { ref } from 'vue'

// 自定义滤镜预设只负责本地持久化和增删，是否应用由 usePreviewEffects 统一协调。
export function useCustomFilterPresets({
  settingsStore,
  activeArtStyle,
  artStyleIntensity,
  artStyleParams,
  filterIntensity,
  filterParams,
  selectedPresetId,
  saveToHistory,
  persistFilterState,
}) {
  const customPresets = ref([])

  function persistCustomPresets() {
    if (!settingsStore?.setSetting) return
    settingsStore.setSetting(CUSTOM_PRESETS_SETTINGS_KEY, customPresets.value)
  }

  function normalizeCustomPreset(rawPreset) {
    if (!rawPreset || typeof rawPreset !== 'object') return null
    if (!rawPreset.id || !rawPreset.label) return null

    return {
      id: String(rawPreset.id),
      label: String(rawPreset.label).slice(0, 24),
      group: 'custom',
      description: rawPreset.description || '我的滤镜配方',
      activeFilter: rawPreset.activeFilter || 'custom',
      activeArtStyle: rawPreset.activeArtStyle || DEFAULT_ART_STYLE,
      artStyleIntensity: clamp(rawPreset.artStyleIntensity, 0, 100, DEFAULT_ART_STYLE_INTENSITY),
      artStyleParams: {
        ...buildDefaultArtStyleParams(),
        ...(rawPreset.artStyleParams || {}),
      },
      filterIntensity: clamp(rawPreset.filterIntensity, 0, 200, 100),
      filterParams: {
        ...defaultFilterParams,
        ...(rawPreset.filterParams || {}),
      },
      createdAt: Number(rawPreset.createdAt) || Date.now(),
    }
  }

  function loadCustomPresets() {
    if (!settingsStore?.getSetting) return
    const saved = settingsStore.getSetting(CUSTOM_PRESETS_SETTINGS_KEY, [])
    if (!Array.isArray(saved)) return
    customPresets.value = saved
      .map(normalizeCustomPreset)
      .filter(Boolean)
      .slice(0, MAX_CUSTOM_PRESETS)
  }

  function saveCurrentAsCustomPreset(rawLabel) {
    const label = String(rawLabel || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 24)
    if (!label) return { ok: false, reason: 'EMPTY_LABEL' }
    if (customPresets.value.some((p) => p.label === label)) {
      return { ok: false, reason: 'DUPLICATE_LABEL' }
    }

    const customPreset = {
      id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      label,
      group: 'custom',
      description: '我的滤镜配方',
      activeFilter: 'custom',
      activeArtStyle: activeArtStyle.value,
      artStyleIntensity: artStyleIntensity.value,
      artStyleParams: cloneArtStyleParams(artStyleParams),
      filterIntensity: filterIntensity.value,
      filterParams: { ...filterParams },
      createdAt: Date.now(),
    }

    customPresets.value = [customPreset, ...customPresets.value].slice(0, MAX_CUSTOM_PRESETS)
    selectedPresetId.value = customPreset.id
    saveToHistory()
    persistCustomPresets()
    persistFilterState()
    return { ok: true, preset: customPreset }
  }

  function removeCustomPresetById(presetId) {
    const before = customPresets.value.length
    customPresets.value = customPresets.value.filter((p) => p.id !== presetId)
    if (before === customPresets.value.length) return { ok: false }

    if (selectedPresetId.value === presetId) {
      selectedPresetId.value = null
      persistFilterState()
    }
    persistCustomPresets()
    return { ok: true }
  }

  return {
    customPresets,
    loadCustomPresets,
    saveCurrentAsCustomPreset,
    removeCustomPresetById,
  }
}
