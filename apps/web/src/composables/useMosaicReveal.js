import { useSettingsStore } from '@/stores/settings'
import { computed, ref } from 'vue'

const REVEAL_PRESETS = {
  off: {
    count: 0,
    cols: 0,
    staggerMs: 0,
    baseMs: 0,
    tileDelayMs: 0,
    tileClass: 'mosaic-tile--off',
  },
  medium: {
    count: 20,
    cols: 5,
    staggerMs: 12,
    baseMs: 470,
    tileDelayMs: 12,
    tileClass: 'mosaic-tile--medium',
  },
  epic: {
    count: 88,
    cols: 11,
    staggerMs: 7,
    baseMs: 620,
    tileDelayMs: 7,
    tileClass: 'mosaic-tile--epic-particle',
  },
}

/** 轻量揭幕（无格子）：淡入 + 微缩放；电影感可加一道高光扫过 */
const SOFT_PRESETS = {
  off: { fadeMs: 0, scaleFrom: 1, sweep: false, sweepMs: 0 },
  medium: { fadeMs: 240, scaleFrom: 1.015, sweep: false, sweepMs: 0 },
  epic: { fadeMs: 320, scaleFrom: 1.022, sweep: true, sweepMs: 220 },
}

/** GPT 风格：高斯模糊渐清 + 微缩放 */
const BLUR_PRESETS = {
  off: { blurPx: 0, fadeMs: 0, scaleFrom: 1 },
  medium: { blurPx: 26, fadeMs: 760, scaleFrom: 1.035 },
  epic: { blurPx: 38, fadeMs: 980, scaleFrom: 1.05 },
}

/**
 * 列表/详情缩略图揭幕：形式 mosaic | soft | blur，强度 off | medium | epic
 * @param {{ styleOverride?: import('vue').Ref<string>, strengthOverride?: import('vue').Ref<string> }} [options]
 */
export function useMosaicReveal(options = {}) {
  const settingsStore = useSettingsStore()
  const { styleOverride, strengthOverride } = options

  const strength = computed(() => {
    const override = String(strengthOverride?.value || '').trim()
    if (REVEAL_PRESETS[override]) return override
    const raw = settingsStore.getSetting('image_reveal_strength', 'medium') || 'medium'
    return REVEAL_PRESETS[raw] ? raw : 'medium'
  })

  const revealStyle = computed(() => {
    const override = String(styleOverride?.value || '').trim()
    if (override === 'soft' || override === 'blur' || override === 'mosaic' || override === 'off') {
      return override === 'off' ? 'soft' : override
    }
    const raw = settingsStore.getSetting('image_reveal_style', 'mosaic') || 'mosaic'
    if (raw === 'soft') return 'soft'
    if (raw === 'blur') return 'blur'
    return 'mosaic'
  })

  const forceOff = computed(() => {
    const style = String(styleOverride?.value || '').trim()
    const force = String(strengthOverride?.value || '').trim()
    return style === 'off' || force === 'off'
  })

  const preset = computed(() =>
    forceOff.value ? REVEAL_PRESETS.off : REVEAL_PRESETS[strength.value] || REVEAL_PRESETS.medium,
  )
  const softPreset = computed(() =>
    forceOff.value ? SOFT_PRESETS.off : SOFT_PRESETS[strength.value] || SOFT_PRESETS.medium,
  )
  const blurPreset = computed(() =>
    forceOff.value ? BLUR_PRESETS.off : BLUR_PRESETS[strength.value] || BLUR_PRESETS.medium,
  )

  const isMosaicStyle = computed(() => !forceOff.value && revealStyle.value === 'mosaic')
  const isBlurStyle = computed(() => !forceOff.value && revealStyle.value === 'blur')

  const mosaicCount = computed(() => (isMosaicStyle.value ? preset.value.count : 0))
  const mosaicCols = computed(() => (isMosaicStyle.value ? preset.value.cols : 0))
  const tileDelayMs = computed(() => (isMosaicStyle.value ? (preset.value.tileDelayMs ?? 12) : 0))
  const tileClass = computed(() =>
    isMosaicStyle.value ? preset.value.tileClass || 'mosaic-tile--medium' : 'mosaic-tile--off',
  )

  const revealDurationMs = computed(() => {
    if (forceOff.value) return 0
    if (isBlurStyle.value) return blurPreset.value.fadeMs
    return softPreset.value.fadeMs
  })
  const revealScaleFrom = computed(() => {
    if (isBlurStyle.value) return blurPreset.value.scaleFrom
    return softPreset.value.scaleFrom
  })
  const revealBlurPx = computed(() => blurPreset.value.blurPx)

  const showMosaic = ref(false)
  const showSweep = ref(false)
  const imageReady = ref(false)
  let clearTimer = null

  function clearRevealTimer() {
    if (clearTimer) {
      clearTimeout(clearTimer)
      clearTimer = null
    }
  }

  function onImageLoad() {
    imageReady.value = true
    clearRevealTimer()
    showSweep.value = false

    if (forceOff.value) {
      showMosaic.value = false
      return
    }

    if (revealStyle.value === 'soft') {
      showMosaic.value = false
      const sp = softPreset.value
      if (!sp.sweep || sp.sweepMs <= 0) return
      showSweep.value = true
      clearTimer = window.setTimeout(() => {
        showSweep.value = false
        clearTimer = null
      }, sp.sweepMs)
      return
    }

    if (revealStyle.value === 'blur') {
      showMosaic.value = false
      return
    }

    const n = preset.value.count
    if (n <= 0) {
      showMosaic.value = false
      return
    }
    showMosaic.value = true
    const { staggerMs, baseMs } = preset.value
    clearTimer = window.setTimeout(
      () => {
        showMosaic.value = false
        clearTimer = null
      },
      baseMs + n * staggerMs,
    )
  }

  function resetReveal() {
    clearRevealTimer()
    imageReady.value = false
    showMosaic.value = false
    showSweep.value = false
  }

  return {
    strength,
    revealStyle,
    forceOff,
    mosaicCount,
    mosaicCols,
    tileDelayMs,
    tileClass,
    revealDurationMs,
    revealScaleFrom,
    revealBlurPx,
    showMosaic,
    showSweep,
    imageReady,
    onImageLoad,
    resetReveal,
  }
}
