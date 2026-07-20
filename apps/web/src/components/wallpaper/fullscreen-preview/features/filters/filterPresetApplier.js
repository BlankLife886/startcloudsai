import {
  clamp,
  defaultFilterParams,
  DEFAULT_ART_STYLE,
  DEFAULT_ART_STYLE_INTENSITY,
  normalizeFilterParams,
} from '@/components/wallpaper/fullscreen-preview/features/filters/filterStateUtils'

export const INTENSITY_DRIVEN_FILTERS = ['sepia', 'blur', 'invert']

export function isIntensityDrivenFilter(filterName) {
  return INTENSITY_DRIVEN_FILTERS.includes(filterName)
}

export function buildLegacyFilterParams(filterName, filterIntensity = 100) {
  const nextParams = { ...defaultFilterParams }

  if (filterName === 'grayscale') {
    nextParams.grayscale = 100
  } else if (filterName === 'sepia') {
    nextParams.sepia = filterIntensity
  } else if (filterName === 'vintage') {
    nextParams.sepia = 50
    nextParams.contrast = 95
    nextParams.brightness = 90
    nextParams.saturation = 80
  } else if (filterName === 'sharp') {
    nextParams.contrast = 122
    nextParams.brightness = 102
    nextParams.saturation = 108
  } else if (filterName === 'blur') {
    nextParams.blur = filterIntensity / 10
  } else if (filterName === 'invert') {
    nextParams.invert = filterIntensity
  }

  normalizeFilterParams(nextParams)
  return nextParams
}

export function buildLegacyFilterState(filterName, filterIntensity = 100) {
  const normalizedName = filterName || 'none'
  return {
    activeFilter: normalizedName,
    selectedPresetId: normalizedName,
    filterParams: buildLegacyFilterParams(normalizedName, filterIntensity),
  }
}

function buildPresetArtStyleState(preset) {
  return {
    activeArtStyle: preset.activeArtStyle || DEFAULT_ART_STYLE,
    artStyleIntensity: clamp(preset.artStyleIntensity, 0, 100, DEFAULT_ART_STYLE_INTENSITY),
    artStyleParams: preset.artStyleParams || null,
  }
}

export function buildPresetFilterState(preset, currentFilterIntensity = 100) {
  if (!preset) return null

  if (preset.id === 'none' || preset.legacyId === 'none') {
    return {
      activeFilter: 'none',
      selectedPresetId: 'none',
      filterParams: { ...defaultFilterParams },
      activeArtStyle: DEFAULT_ART_STYLE,
      artStyleIntensity: DEFAULT_ART_STYLE_INTENSITY,
      artStyleParams: null,
      shouldResetHistory: true,
    }
  }

  if (preset.legacyId) {
    return {
      ...buildLegacyFilterState(preset.legacyId, currentFilterIntensity),
      ...buildPresetArtStyleState(preset),
      selectedPresetId: preset.id,
    }
  }

  const nextParams = { ...defaultFilterParams, ...(preset.filterParams || {}) }
  normalizeFilterParams(nextParams)

  return {
    activeFilter: preset.activeFilter || 'custom',
    filterIntensity: clamp(preset.filterIntensity, 0, 200, 100),
    filterParams: nextParams,
    selectedPresetId: preset.id,
    ...buildPresetArtStyleState(preset),
  }
}
