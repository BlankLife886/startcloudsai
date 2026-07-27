import { ref } from 'vue'

const VALID_COMPARISON_MODES = new Set(['none', 'side-by-side'])

function normalizeComparisonMode(mode) {
  return VALID_COMPARISON_MODES.has(mode) ? mode : 'none'
}

// 比较模式只保存“当前对比展示方式”，具体图片来源由 preview result 统一管理。
export function usePreviewComparison() {
  const comparisonMode = ref('none')

  function serializeComparisonState() {
    return {
      comparisonMode: comparisonMode.value,
    }
  }

  function restoreComparisonState(savedState = null) {
    const state = savedState && typeof savedState === 'object' ? savedState : {}
    comparisonMode.value = normalizeComparisonMode(state.comparisonMode)
  }

  function setComparisonMode(mode) {
    comparisonMode.value = normalizeComparisonMode(mode)
  }

  function toggleComparisonMode(mode) {
    const normalizedMode = normalizeComparisonMode(mode)
    comparisonMode.value = comparisonMode.value === normalizedMode ? 'none' : normalizedMode
  }

  function resetComparisonState() {
    comparisonMode.value = 'none'
  }

  return {
    comparisonMode,
    serializeComparisonState,
    restoreComparisonState,
    setComparisonMode,
    toggleComparisonMode,
    resetComparisonState,
  }
}
