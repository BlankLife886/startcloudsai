import { ref } from 'vue'

export function useSearchHistory({ storageService }) {
  const searchHistory = ref([])
  const showSearchHistory = ref(false)

  function loadSearchHistory() {
    const history = storageService.getItem('searchHistory')
    if (!history) return

    try {
      searchHistory.value = JSON.parse(history)
    } catch {
      searchHistory.value = []
    }
  }

  function saveSearchHistory() {
    storageService.setItem('searchHistory', JSON.stringify(searchHistory.value))
  }

  function addSearchHistory(query) {
    if (!query || query.trim() === '') return

    searchHistory.value = searchHistory.value.filter((item) => item !== query)
    searchHistory.value.unshift(query)

    if (searchHistory.value.length > 10) {
      searchHistory.value = searchHistory.value.slice(0, 10)
    }

    saveSearchHistory()
  }

  function applyHistoryQuery(query, onApply) {
    onApply?.(query)
    showSearchHistory.value = false
  }

  function removeSearchHistoryItem(index) {
    searchHistory.value.splice(index, 1)
    saveSearchHistory()
  }

  function clearSearchHistory() {
    searchHistory.value = []
    saveSearchHistory()
  }

  function toggleSearchHistory() {
    showSearchHistory.value = !showSearchHistory.value
  }

  function closeSearchHistoryIfOutside(event, shellSelector = '.cosmic-search-shell') {
    if (showSearchHistory.value && !event.target.closest(shellSelector)) {
      showSearchHistory.value = false
    }
  }

  return {
    searchHistory,
    showSearchHistory,
    loadSearchHistory,
    addSearchHistory,
    applyHistoryQuery,
    removeSearchHistoryItem,
    clearSearchHistory,
    toggleSearchHistory,
    closeSearchHistoryIfOutside,
  }
}
