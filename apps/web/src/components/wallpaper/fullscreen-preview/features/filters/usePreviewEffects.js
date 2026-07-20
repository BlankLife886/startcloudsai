import { buildPreviewFilterCssString } from '@/features/filters/filterEngine'
import {
  ART_STYLE_PARAM_CONFIG,
  buildDefaultArtStyleParams,
} from '@/features/filters/artStyleEngine'
import { getFilterPresetById, normalizePresetId } from '@/features/filters/filterPresets'
import { usePreviewComparison } from '@/components/wallpaper/fullscreen-preview/features/compare/usePreviewComparison'
import {
  buildLegacyFilterState,
  buildPresetFilterState,
  isIntensityDrivenFilter,
} from '@/components/wallpaper/fullscreen-preview/features/filters/filterPresetApplier'
import {
  clamp,
  cloneArtStyleParams,
  defaultFilterParams,
  DEFAULT_ART_STYLE,
  DEFAULT_ART_STYLE_INTENSITY,
  FILTER_SETTINGS_KEY,
  normalizeArtStyleParams,
  normalizeFilterParams,
  resetArtStyleParams,
} from '@/components/wallpaper/fullscreen-preview/features/filters/filterStateUtils'
import { useCustomFilterPresets } from '@/components/wallpaper/fullscreen-preview/features/filters/useCustomFilterPresets'
import { useFilterHistory } from '@/components/wallpaper/fullscreen-preview/features/filters/useFilterHistory'
import { computed, reactive, ref } from 'vue'

// 图像滤镜和艺术风格的状态入口，同时复用比较模式状态，方便工具栏统一调度。
export function usePreviewEffects({ settingsStore } = {}) {
  const showFilters = ref(false)
  const activeFilter = ref('none')
  const filterIntensity = ref(100)
  const originalImageData = ref(null)
  const processedImageData = ref(null)
  const filterParams = reactive({ ...defaultFilterParams })

  const {
    comparisonMode,
    serializeComparisonState,
    restoreComparisonState,
    setComparisonMode: applyComparisonMode,
    toggleComparisonMode: applyToggleComparisonMode,
    resetComparisonState,
  } = usePreviewComparison()
  /** 当前选中的预设 id，用于面板高亮；手动滑杆后为 null */
  const selectedPresetId = ref(null)
  const activeArtStyle = ref(DEFAULT_ART_STYLE)
  const artStyleIntensity = ref(DEFAULT_ART_STYLE_INTENSITY)
  const artStyleParams = reactive(buildDefaultArtStyleParams())

  function persistFilterState() {
    if (!settingsStore?.setSetting) return
    settingsStore.setSetting(FILTER_SETTINGS_KEY, {
      activeFilter: activeFilter.value,
      filterIntensity: filterIntensity.value,
      ...serializeComparisonState(),
      filterParams: { ...filterParams },
      selectedPresetId: selectedPresetId.value,
      activeArtStyle: activeArtStyle.value,
      artStyleIntensity: artStyleIntensity.value,
      artStyleParams: cloneArtStyleParams(artStyleParams),
    })
  }

  function restoreSnapshot(snapshot) {
    activeFilter.value = snapshot.activeFilter || 'none'
    filterIntensity.value = clamp(snapshot.filterIntensity, 0, 200, 100)
    activeArtStyle.value = snapshot.activeArtStyle || DEFAULT_ART_STYLE
    artStyleIntensity.value = clamp(snapshot.artStyleIntensity, 0, 100, DEFAULT_ART_STYLE_INTENSITY)
    resetArtStyleParams(artStyleParams, snapshot.artStyleParams || {})
    normalizeArtStyleParams(artStyleParams)
    Object.assign(filterParams, defaultFilterParams, snapshot.filterParams || {})
    selectedPresetId.value = snapshot.selectedPresetId || null
    normalizeFilterParams(filterParams)
  }

  const {
    filterHistory,
    historyIndex,
    resetHistory,
    saveToHistory,
    restoreFromHistory,
    undoFilter,
    redoFilter,
  } = useFilterHistory({
    activeFilter,
    filterIntensity,
    activeArtStyle,
    artStyleIntensity,
    artStyleParams,
    filterParams,
    selectedPresetId,
    restoreSnapshot,
    persistFilterState,
  })

  const { customPresets, loadCustomPresets, saveCurrentAsCustomPreset, removeCustomPresetById } =
    useCustomFilterPresets({
      settingsStore,
      activeArtStyle,
      artStyleIntensity,
      artStyleParams,
      filterIntensity,
      filterParams,
      selectedPresetId,
      saveToHistory,
      persistFilterState,
    })

  function restoreFilterState() {
    if (!settingsStore?.getSetting) return
    const savedState = settingsStore.getSetting(FILTER_SETTINGS_KEY, null)
    if (!savedState || typeof savedState !== 'object') {
      saveToHistory()
      return
    }

    const restoredPresetId = savedState.selectedPresetId
      ? normalizePresetId(savedState.selectedPresetId)
      : null
    const restoredPreset = restoredPresetId ? getFilterPresetById(restoredPresetId) : null

    activeFilter.value =
      restoredPreset?.activeFilter || restoredPreset?.legacyId || savedState.activeFilter || 'none'
    filterIntensity.value = clamp(savedState.filterIntensity, 0, 200, 100)
    restoreComparisonState(savedState)
    activeArtStyle.value = savedState.activeArtStyle || DEFAULT_ART_STYLE
    artStyleIntensity.value = clamp(
      savedState.artStyleIntensity,
      0,
      100,
      DEFAULT_ART_STYLE_INTENSITY,
    )
    resetArtStyleParams(artStyleParams, savedState.artStyleParams || {})
    normalizeArtStyleParams(artStyleParams)
    Object.assign(filterParams, defaultFilterParams, savedState.filterParams || {})
    normalizeFilterParams(filterParams)
    if (restoredPreset) {
      const nextState = buildPresetFilterState(restoredPreset, filterIntensity.value)
      if (nextState) {
        Object.assign(filterParams, nextState.filterParams)
        activeFilter.value = nextState.activeFilter
        if (Number.isFinite(nextState.filterIntensity)) {
          filterIntensity.value = nextState.filterIntensity
        }
        activeArtStyle.value = nextState.activeArtStyle
        artStyleIntensity.value = nextState.artStyleIntensity
        resetArtStyleParams(artStyleParams, nextState.artStyleParams || {})
        normalizeArtStyleParams(artStyleParams)
      }
      selectedPresetId.value = restoredPresetId
    } else if (restoredPresetId) {
      const hasCustomPreset = customPresets.value.some((p) => p.id === restoredPresetId)
      selectedPresetId.value = hasCustomPreset ? restoredPresetId : null
    } else {
      selectedPresetId.value = null
    }
    resetHistory()
    saveToHistory()
  }

  const filterStyle = computed(() => {
    if (activeFilter.value === 'none' && !showFilters.value) {
      return {}
    }

    const css = buildPreviewFilterCssString(
      activeFilter.value,
      showFilters.value,
      filterIntensity.value,
      filterParams,
    )
    return { filter: css === 'none' ? 'none' : css }
  })

  function handleFilterChange() {
    normalizeFilterParams(filterParams)
    activeFilter.value = 'custom'
    selectedPresetId.value = null
    saveToHistory()
    persistFilterState()
  }

  function applyArtStyle(styleId) {
    activeArtStyle.value = styleId || DEFAULT_ART_STYLE
    selectedPresetId.value = null
    saveToHistory()
    persistFilterState()
  }

  function setArtStyleIntensity(v) {
    artStyleIntensity.value = clamp(v, 0, 100, DEFAULT_ART_STYLE_INTENSITY)
    selectedPresetId.value = null
    saveToHistory()
    persistFilterState()
  }

  function setArtStyleParam(key, value) {
    const styleId = activeArtStyle.value
    if (!styleId || styleId === DEFAULT_ART_STYLE) return
    const controls = ART_STYLE_PARAM_CONFIG[styleId] || []
    const config = controls.find((item) => item.key === key)
    if (!config) return
    if (!artStyleParams[styleId]) artStyleParams[styleId] = {}
    artStyleParams[styleId][key] = clamp(value, config.min, config.max, config.defaultValue)
    selectedPresetId.value = null
    saveToHistory()
    persistFilterState()
  }

  function resetFilterParams({ persist = true } = {}) {
    Object.assign(filterParams, defaultFilterParams)
    activeArtStyle.value = DEFAULT_ART_STYLE
    artStyleIntensity.value = DEFAULT_ART_STYLE_INTENSITY
    resetArtStyleParams(artStyleParams)
    selectedPresetId.value = null

    resetHistory()
    saveToHistory()
    if (persist) persistFilterState()
  }

  function applyFilter(filterName) {
    const nextState = buildLegacyFilterState(filterName, filterIntensity.value)
    Object.assign(filterParams, nextState.filterParams)
    activeFilter.value = nextState.activeFilter
    selectedPresetId.value = nextState.selectedPresetId

    if (filterName === 'none') {
      resetHistory()
    }
    saveToHistory()
    persistFilterState()
  }

  /** 调节依赖「强度」的风格（sepia / blur / invert） */
  function setFilterIntensity(v) {
    filterIntensity.value = clamp(v, 0, 200, 100)
    if (isIntensityDrivenFilter(activeFilter.value)) {
      applyFilter(activeFilter.value)
    } else {
      saveToHistory()
      persistFilterState()
    }
  }

  /** 按预设 id 应用（含参数化风格预设） */
  function applyPresetById(presetId) {
    const normalizedId = normalizePresetId(presetId)
    const preset =
      customPresets.value.find((item) => item.id === normalizedId) ||
      getFilterPresetById(normalizedId)
    if (!preset) return { ok: false }

    const nextState = buildPresetFilterState(preset, filterIntensity.value)
    if (!nextState) return { ok: false }

    if (nextState.shouldResetHistory) {
      resetHistory()
    }
    Object.assign(filterParams, nextState.filterParams)
    activeFilter.value = nextState.activeFilter
    if (Number.isFinite(nextState.filterIntensity)) {
      filterIntensity.value = nextState.filterIntensity
    }
    activeArtStyle.value = nextState.activeArtStyle
    artStyleIntensity.value = nextState.artStyleIntensity
    resetArtStyleParams(artStyleParams, nextState.artStyleParams || {})
    normalizeArtStyleParams(artStyleParams)
    selectedPresetId.value = nextState.selectedPresetId
    saveToHistory()
    persistFilterState()
    return { ok: true }
  }

  function setComparisonMode(mode) {
    applyComparisonMode(mode)
    persistFilterState()
  }

  function toggleComparisonMode(mode) {
    applyToggleComparisonMode(mode)
    persistFilterState()
  }

  function resetEffectsState() {
    showFilters.value = false
    activeFilter.value = 'none'
    filterIntensity.value = 100
    activeArtStyle.value = DEFAULT_ART_STYLE
    artStyleIntensity.value = DEFAULT_ART_STYLE_INTENSITY
    selectedPresetId.value = null
    resetComparisonState()
    // 换图/打开预览时不写入本地，避免把用户保存的滤镜配置覆盖成「原图」
    resetFilterParams({ persist: false })
  }

  function cleanupEffectResources() {
    originalImageData.value = null
    processedImageData.value = null
  }

  loadCustomPresets()
  restoreFilterState()

  return {
    showFilters,
    activeFilter,
    filterIntensity,
    activeArtStyle,
    artStyleIntensity,
    artStyleParams,
    selectedPresetId,
    customPresets,
    originalImageData,
    processedImageData,
    filterParams,
    filterHistory,
    historyIndex,
    comparisonMode,
    filterStyle,
    handleFilterChange,
    resetFilterParams,
    applyFilter,
    applyPresetById,
    applyArtStyle,
    setArtStyleIntensity,
    setArtStyleParam,
    saveCurrentAsCustomPreset,
    removeCustomPresetById,
    setFilterIntensity,
    saveToHistory,
    undoFilter,
    redoFilter,
    restoreFromHistory,
    setComparisonMode,
    toggleComparisonMode,
    persistFilterState,
    restoreFilterState,
    resetEffectsState,
    cleanupEffectResources,
  }
}
