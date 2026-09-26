import {
  ART_STYLE_PARAM_CONFIG,
  buildDefaultArtStyleParams,
} from '@/features/filters/artStyleEngine'

export const FILTER_SETTINGS_KEY = 'preview_filter_state'
export const CUSTOM_PRESETS_SETTINGS_KEY = 'preview_filter_custom_presets'
export const MAX_CUSTOM_PRESETS = 30
export const DEFAULT_ART_STYLE = 'none'
export const DEFAULT_ART_STYLE_INTENSITY = 60

export const defaultFilterParams = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  hueRotate: 0,
  invert: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  shadowCool: 0,
  highlightWarm: 0,
  vignette: 0,
  lutStyle: 'none',
  lutIntensity: 0,
  curveStrength: 0,
  grain: 0,
  skinProtect: 70,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  blackPoint: 0,
  vibrance: 0,
  clarity: 0,
  skinSmooth: 0,
  skinWarmth: 0,
  cameraProfile: 'none',
  profileIntensity: 0,
}

export function clamp(value, min, max, fallback) {
  if (Number.isNaN(Number(value))) return fallback
  return Math.min(max, Math.max(min, Number(value)))
}

export function cloneArtStyleParams(artStyleParams) {
  return JSON.parse(JSON.stringify(artStyleParams || {}))
}

export function resetArtStyleParams(artStyleParams, savedParams = {}) {
  const defaultStyleParams = buildDefaultArtStyleParams()
  Object.entries(defaultStyleParams).forEach(([styleId, defaults]) => {
    artStyleParams[styleId] = {
      ...defaults,
      ...((savedParams || {})[styleId] || {}),
    }
  })
}

export function normalizeFilterParams(filterParams) {
  filterParams.brightness = clamp(filterParams.brightness, 0, 200, defaultFilterParams.brightness)
  filterParams.contrast = clamp(filterParams.contrast, 0, 200, defaultFilterParams.contrast)
  filterParams.saturation = clamp(filterParams.saturation, 0, 200, defaultFilterParams.saturation)
  filterParams.blur = clamp(filterParams.blur, 0, 20, defaultFilterParams.blur)
  filterParams.grayscale = clamp(filterParams.grayscale, 0, 100, defaultFilterParams.grayscale)
  filterParams.sepia = clamp(filterParams.sepia, 0, 100, defaultFilterParams.sepia)
  filterParams.hueRotate = 0
  filterParams.invert = clamp(filterParams.invert, 0, 100, defaultFilterParams.invert)
  filterParams.temperature = clamp(filterParams.temperature, -100, 100, defaultFilterParams.temperature)
  filterParams.tint = clamp(filterParams.tint, -100, 100, defaultFilterParams.tint)
  filterParams.fade = clamp(filterParams.fade, 0, 100, defaultFilterParams.fade)
  filterParams.shadowCool = clamp(filterParams.shadowCool, 0, 100, defaultFilterParams.shadowCool)
  filterParams.highlightWarm = clamp(
    filterParams.highlightWarm,
    0,
    100,
    defaultFilterParams.highlightWarm,
  )
  filterParams.vignette = clamp(filterParams.vignette, 0, 100, defaultFilterParams.vignette)
  filterParams.lutStyle =
    typeof filterParams.lutStyle === 'string' && filterParams.lutStyle
      ? filterParams.lutStyle
      : defaultFilterParams.lutStyle
  filterParams.lutIntensity = clamp(filterParams.lutIntensity, 0, 100, defaultFilterParams.lutIntensity)
  filterParams.curveStrength = clamp(
    filterParams.curveStrength,
    -100,
    100,
    defaultFilterParams.curveStrength,
  )
  filterParams.grain = clamp(filterParams.grain, 0, 100, defaultFilterParams.grain)
  filterParams.skinProtect = clamp(filterParams.skinProtect, 0, 100, defaultFilterParams.skinProtect)
  filterParams.exposure = clamp(filterParams.exposure, -100, 100, defaultFilterParams.exposure)
  filterParams.highlights = clamp(filterParams.highlights, -100, 100, defaultFilterParams.highlights)
  filterParams.shadows = clamp(filterParams.shadows, -100, 100, defaultFilterParams.shadows)
  filterParams.blackPoint = clamp(filterParams.blackPoint, -100, 100, defaultFilterParams.blackPoint)
  filterParams.vibrance = clamp(filterParams.vibrance, -100, 100, defaultFilterParams.vibrance)
  filterParams.clarity = clamp(filterParams.clarity, -100, 100, defaultFilterParams.clarity)
  filterParams.skinSmooth = clamp(filterParams.skinSmooth, 0, 100, defaultFilterParams.skinSmooth)
  filterParams.skinWarmth = clamp(filterParams.skinWarmth, -100, 100, defaultFilterParams.skinWarmth)
  filterParams.cameraProfile =
    typeof filterParams.cameraProfile === 'string' && filterParams.cameraProfile
      ? filterParams.cameraProfile
      : defaultFilterParams.cameraProfile
  filterParams.profileIntensity = clamp(
    filterParams.profileIntensity,
    0,
    100,
    defaultFilterParams.profileIntensity,
  )
}

export function normalizeArtStyleParams(artStyleParams) {
  Object.entries(ART_STYLE_PARAM_CONFIG).forEach(([styleId, controls]) => {
    if (!artStyleParams[styleId]) artStyleParams[styleId] = {}
    controls.forEach((cfg) => {
      artStyleParams[styleId][cfg.key] = clamp(
        artStyleParams[styleId][cfg.key],
        cfg.min,
        cfg.max,
        cfg.defaultValue,
      )
    })
  })
}
