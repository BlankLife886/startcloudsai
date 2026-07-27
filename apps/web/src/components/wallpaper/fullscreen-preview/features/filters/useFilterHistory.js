import {
  cloneArtStyleParams,
  DEFAULT_ART_STYLE,
  DEFAULT_ART_STYLE_INTENSITY,
} from '@/components/wallpaper/fullscreen-preview/features/filters/filterStateUtils'
import { ref } from 'vue'

// 滤镜历史只保存可还原快照，不关心这些快照最终如何写回具体 ref/reactive。
export function useFilterHistory({
  activeFilter,
  filterIntensity,
  activeArtStyle,
  artStyleIntensity,
  artStyleParams,
  filterParams,
  selectedPresetId,
  restoreSnapshot,
  persistFilterState,
}) {
  const filterHistory = ref([])
  const historyIndex = ref(-1)

  function createHistorySnapshot() {
    return {
      activeFilter: activeFilter.value,
      filterIntensity: filterIntensity.value,
      activeArtStyle: activeArtStyle.value,
      artStyleIntensity: artStyleIntensity.value,
      artStyleParams: cloneArtStyleParams(artStyleParams),
      filterParams: { ...filterParams },
      selectedPresetId: selectedPresetId.value,
    }
  }

  function isSameSnapshot(a, b) {
    return (
      a &&
      b &&
      a.activeFilter === b.activeFilter &&
      a.filterIntensity === b.filterIntensity &&
      a.activeArtStyle === b.activeArtStyle &&
      a.artStyleIntensity === b.artStyleIntensity &&
      a.selectedPresetId === b.selectedPresetId &&
      JSON.stringify(a.artStyleParams) === JSON.stringify(b.artStyleParams) &&
      JSON.stringify(a.filterParams) === JSON.stringify(b.filterParams)
    )
  }

  function resetHistory() {
    filterHistory.value = []
    historyIndex.value = -1
  }

  function saveToHistory() {
    if (historyIndex.value >= 0 && historyIndex.value < filterHistory.value.length - 1) {
      filterHistory.value = filterHistory.value.slice(0, historyIndex.value + 1)
    }

    const nextHistoryItem = createHistorySnapshot()
    const lastHistoryItem = filterHistory.value[filterHistory.value.length - 1]
    if (isSameSnapshot(lastHistoryItem, nextHistoryItem)) return

    filterHistory.value.push(nextHistoryItem)
    historyIndex.value = filterHistory.value.length - 1

    if (filterHistory.value.length > 20) {
      filterHistory.value.shift()
      historyIndex.value--
    }
  }

  function restoreFromHistory() {
    const historyItem = filterHistory.value[historyIndex.value]
    if (!historyItem) return
    restoreSnapshot({
      activeFilter: historyItem.activeFilter,
      filterIntensity: historyItem.filterIntensity,
      activeArtStyle: historyItem.activeArtStyle || DEFAULT_ART_STYLE,
      artStyleIntensity: historyItem.artStyleIntensity ?? DEFAULT_ART_STYLE_INTENSITY,
      artStyleParams: historyItem.artStyleParams || {},
      filterParams: historyItem.filterParams || {},
      selectedPresetId: historyItem.selectedPresetId || null,
    })
  }

  function undoFilter() {
    if (historyIndex.value > 0) {
      historyIndex.value--
      restoreFromHistory()
      persistFilterState()
    }
  }

  function redoFilter() {
    if (historyIndex.value < filterHistory.value.length - 1) {
      historyIndex.value++
      restoreFromHistory()
      persistFilterState()
    }
  }

  return {
    filterHistory,
    historyIndex,
    resetHistory,
    saveToHistory,
    restoreFromHistory,
    undoFilter,
    redoFilter,
  }
}
