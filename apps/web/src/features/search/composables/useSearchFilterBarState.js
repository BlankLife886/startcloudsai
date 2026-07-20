import { ref } from 'vue'

export function useSearchFilterBarState({
  searchParams,
  settingsStore,
  storageService,
  workbenchStore,
  createDefaultSearchParams,
  applyFilters,
}) {
  const activeDropdown = ref(null)
  let dropdownCloseTimer = null

  function clearDropdownCloseTimer() {
    if (!dropdownCloseTimer) return
    window.clearTimeout(dropdownCloseTimer)
    dropdownCloseTimer = null
  }

  function normalizeGridColumns(value) {
    const n = Number.parseInt(value, 10)
    return [2, 3, 4, 6, 8].includes(n) ? n : 4
  }

  function defaultGridColumns() {
    return normalizeGridColumns(settingsStore.settings.search_default_grid_columns)
  }

  const gridColumns = ref(
    normalizeGridColumns(storageService.getItem('gridColumns') || defaultGridColumns()),
  )

  function toggleDropdown(name) {
    activeDropdown.value = activeDropdown.value === name ? null : name
  }

  function openDropdown(name) {
    clearDropdownCloseTimer()
    activeDropdown.value = name
  }

  function closeDropdown(name, delay = 180) {
    clearDropdownCloseTimer()
    dropdownCloseTimer = window.setTimeout(() => {
      if (!name || activeDropdown.value === name) {
        activeDropdown.value = null
      }
      dropdownCloseTimer = null
    }, delay)
  }

  function toggleCategory(index) {
    const categories = searchParams.value.categories.split('')
    categories[index] = categories[index] === '1' ? '0' : '1'
    searchParams.value.categories = categories.join('')
    applyFilters()
  }

  function togglePurity(index) {
    if (index === 2 && !settingsStore.settings.show_nsfw) return

    const purity = searchParams.value.purity.split('')
    purity[index] = purity[index] === '1' ? '0' : '1'
    searchParams.value.purity = purity.join('')
    applyFilters()
  }

  function setResolution(resolution) {
    searchParams.value.resolution = resolution
    activeDropdown.value = null
    applyFilters()
  }

  function setRatio(ratio) {
    searchParams.value.ratios = ratio
    activeDropdown.value = null
    applyFilters()
  }

  function setColor(color) {
    searchParams.value.color = color
    activeDropdown.value = null
    applyFilters()
  }

  function setSorting(sorting) {
    searchParams.value.sorting = sorting
    activeDropdown.value = null
    applyFilters()
  }

  function setTopRange(range) {
    searchParams.value.topRange = range
    activeDropdown.value = null
    applyFilters()
  }

  function setOrder(order) {
    searchParams.value.order = order
    applyFilters()
  }

  function setGridColumns(columns) {
    const next = normalizeGridColumns(columns)
    if (gridColumns.value === next) return
    gridColumns.value = next
    saveSettings()
  }

  function loadSettings() {
    const savedGridColumns = storageService.getItem('gridColumns')
    gridColumns.value = normalizeGridColumns(savedGridColumns || defaultGridColumns())
  }

  function saveSettings() {
    storageService.setItem('gridColumns', String(gridColumns.value))
  }

  function resetFilters() {
    workbenchStore.clearChips()
    searchParams.value = createDefaultSearchParams()
    applyFilters()
  }

  function closeDropdownsIfOutside(event, dropdownSelector = '.filter-bar-dropdown') {
    if (activeDropdown.value && !event.target.closest(dropdownSelector)) {
      clearDropdownCloseTimer()
      activeDropdown.value = null
    }
  }

  return {
    activeDropdown,
    gridColumns,
    toggleDropdown,
    openDropdown,
    closeDropdown,
    toggleCategory,
    togglePurity,
    setResolution,
    setRatio,
    setColor,
    setSorting,
    setTopRange,
    setOrder,
    setGridColumns,
    loadSettings,
    saveSettings,
    resetFilters,
    closeDropdownsIfOutside,
  }
}
