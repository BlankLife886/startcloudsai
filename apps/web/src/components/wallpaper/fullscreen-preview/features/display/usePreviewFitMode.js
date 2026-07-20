import { computed, ref } from 'vue'

// 铺满/完整显示是用户偏好，不直接等同于 CSS object-fit；缩放层会根据它换算基础 zoom。
export function usePreviewFitMode({ getPreferredFitMode, onFitModeChange } = {}) {
  const fitMode = ref('contain')
  const baseFitMode = ref('contain')
  const currentFitMode = computed(() => baseFitMode.value)

  function normalizeFitMode(mode) {
    return mode === 'cover' ? 'cover' : 'contain'
  }

  function applyPreferredFitMode() {
    const preferredMode = normalizeFitMode(getPreferredFitMode?.())
    baseFitMode.value = preferredMode
    fitMode.value = 'contain'
  }

  function setFitMode(mode) {
    baseFitMode.value = normalizeFitMode(mode)
    fitMode.value = 'contain'
    onFitModeChange?.()
  }

  function toggleFitMode() {
    setFitMode(baseFitMode.value === 'cover' ? 'contain' : 'cover')
    return baseFitMode.value
  }

  return {
    baseFitMode,
    currentFitMode,
    fitMode,
    applyPreferredFitMode,
    setFitMode,
    toggleFitMode,
  }
}
