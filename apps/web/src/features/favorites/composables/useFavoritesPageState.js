import { computed, onMounted, ref, watch } from 'vue'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { downloadWallpapersUnified } from '@/services/wallpaperDownload'

const SIDEBAR_STORAGE_KEY = 'favorites-sidebar-expanded'
const VIEW_MODE_STORAGE_KEY = 'favorites-view-mode'
const GRID_VARIANT_STORAGE_KEY = 'favorites-grid-variant'
const SORT_BY_STORAGE_KEY = 'favorites-sort-by'
const SORT_ORDER_STORAGE_KEY = 'favorites-sort-order'
const QUICK_FILTER_STORAGE_KEY = 'favorites-quick-filter'
const SELECTED_COLLECTION_STORAGE_KEY = 'favorites-selected-collection-id'

const VALID_VIEW_MODES = new Set(['grid', 'network', 'orbs', 'stats'])
const VALID_GRID_VARIANTS = new Set(['standard', 'gallery', 'compact', 'cinema'])
const VALID_SORT_BY = new Set(['date', 'name', 'resolution'])
const VALID_SORT_ORDER = new Set(['asc', 'desc'])
const VALID_QUICK_FILTERS = new Set(['all', 'uncategorized', 'landscape', 'portrait', 'highres'])

function savedValue(key, fallback, validator) {
  const value = getScopedLocalItem(key)
  if (value === null || value === undefined || value === '') return fallback
  return validator?.(value) === false ? fallback : value
}

export function useFavoritesPageState({
  favoritesStore,
  getFilteredFavorites,
  getFavoritesCount,
  notificationService,
}) {
  const searchQuery = ref('')
  const sortBy = ref(savedValue(SORT_BY_STORAGE_KEY, 'date', value => VALID_SORT_BY.has(value)))
  const sortOrder = ref(savedValue(SORT_ORDER_STORAGE_KEY, 'desc', value => VALID_SORT_ORDER.has(value)))
  const quickFilter = ref(
    savedValue(QUICK_FILTER_STORAGE_KEY, 'all', value => VALID_QUICK_FILTERS.has(value)),
  )
  const visualFacet = ref(null)
  const viewMode = ref(savedValue(VIEW_MODE_STORAGE_KEY, 'grid', value => VALID_VIEW_MODES.has(value)))
  const gridVariant = ref(
    savedValue(GRID_VARIANT_STORAGE_KEY, 'standard', value => VALID_GRID_VARIANTS.has(value)),
  )
  const showSidebar = ref(savedValue(SIDEBAR_STORAGE_KEY, 'true') === 'true')

  const previewWallpaper = ref(null)
  const showPreview = ref(false)
  const showExportImportModal = ref(false)
  const showClearFavoritesConfirm = ref(false)

  function changeSorting(by) {
    if (sortBy.value === by) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
      return
    }

    sortBy.value = by
    sortOrder.value = 'desc'
  }

  function setQuickFilter(filter) {
    quickFilter.value = filter
  }

  function resetFilters() {
    searchQuery.value = ''
    quickFilter.value = 'all'
    visualFacet.value = null
  }

  function clearSearch() {
    searchQuery.value = ''
  }

  function handleEmptyAction() {
    if (searchQuery.value.trim() || quickFilter.value !== 'all' || visualFacet.value) {
      resetFilters()
      return
    }

    if (favoritesStore.selectedCollection && favoritesStore.favoritesCount > 0) {
      favoritesStore.clearSelectedCollection()
    }
  }

  function clearAllFavorites() {
    showClearFavoritesConfirm.value = true
  }

  function cancelClearAllFavorites() {
    showClearFavoritesConfirm.value = false
  }

  function confirmClearAllFavorites() {
    const success = favoritesStore.clearFavorites()
    showClearFavoritesConfirm.value = false

    if (success) {
      notificationService.success('已清空全部收藏', {
        duration: 3000,
        position: 'top-right',
      })
    } else {
      notificationService.error(favoritesStore.error || '清空收藏失败', {
        duration: 4000,
        position: 'top-right',
      })
    }
  }

  function previewImage(wallpaper) {
    previewWallpaper.value = wallpaper
    showPreview.value = true
  }

  function closePreview() {
    showPreview.value = false
    previewWallpaper.value = null
  }

  async function downloadFavorites() {
    if (getFilteredFavorites().length === 0) {
      notificationService.warning('没有可下载的收藏壁纸', {
        duration: 3000,
        position: 'top-right',
      })
      return
    }

    try {
      await downloadWallpapersUnified(getFilteredFavorites(), {
        scope: 'favorites',
        filename: '我的收藏',
      })
    } catch (error) {
      console.error('下载收藏壁纸失败:', error)
      notificationService.error(`下载失败: ${error.message || '未知错误'}`, {
        duration: 5000,
        position: 'top-right',
      })
    }
  }

  function setViewMode(mode) {
    viewMode.value = mode
  }

  function setVisualFacet(facet) {
    if (
      visualFacet.value &&
      facet &&
      String(visualFacet.value.type).toLowerCase() === String(facet.type).toLowerCase() &&
      String(visualFacet.value.value).toLowerCase() === String(facet.value).toLowerCase()
    ) {
      visualFacet.value = null
      return
    }
    visualFacet.value = facet
    searchQuery.value = ''
    quickFilter.value = 'all'
  }

  function clearVisualFacet() {
    visualFacet.value = null
  }

  function setGridVariant(variant) {
    gridVariant.value = variant
    viewMode.value = 'grid'
  }

  function toggleSidebar() {
    showSidebar.value = !showSidebar.value
  }

  function openExportImportModal() {
    showExportImportModal.value = true
  }

  function closeExportImportModal() {
    showExportImportModal.value = false
  }

  const hasFavorites = computed(() => getFavoritesCount() > 0)

  onMounted(() => {
    favoritesStore
      .initFavorites()
      .then(() => {
        const selectedCollectionId = getScopedLocalItem(SELECTED_COLLECTION_STORAGE_KEY)
        if (!selectedCollectionId) return
        const collection = favoritesStore.collections.find(
          item => String(item.id) === String(selectedCollectionId),
        )
        if (collection) {
          favoritesStore.selectCollection(collection)
        } else {
          setScopedLocalItem(SELECTED_COLLECTION_STORAGE_KEY, '')
        }
      })
      .catch((err) => {
        console.error('初始化收藏失败:', err)
      })
  })

  watch(showSidebar, (value) => {
    setScopedLocalItem(SIDEBAR_STORAGE_KEY, String(value))
  })

  watch(viewMode, (value) => {
    setScopedLocalItem(VIEW_MODE_STORAGE_KEY, value)
  })

  watch(gridVariant, (value) => {
    setScopedLocalItem(GRID_VARIANT_STORAGE_KEY, value)
  })

  watch(sortBy, (value) => {
    setScopedLocalItem(SORT_BY_STORAGE_KEY, value)
  })

  watch(sortOrder, (value) => {
    setScopedLocalItem(SORT_ORDER_STORAGE_KEY, value)
  })

  watch(quickFilter, (value) => {
    setScopedLocalItem(QUICK_FILTER_STORAGE_KEY, value)
  })

  watch(
    () => favoritesStore.selectedCollection?.id || '',
    (value) => {
      setScopedLocalItem(SELECTED_COLLECTION_STORAGE_KEY, value)
    },
  )

  return {
    searchQuery,
    sortBy,
    sortOrder,
    quickFilter,
    visualFacet,
    viewMode,
    gridVariant,
    showSidebar,
    previewWallpaper,
    showPreview,
    downloadFavorites,
    showExportImportModal,
    showClearFavoritesConfirm,
    hasFavorites,
    changeSorting,
    setQuickFilter,
    setVisualFacet,
    clearVisualFacet,
    resetFilters,
    clearSearch,
    handleEmptyAction,
    clearAllFavorites,
    cancelClearAllFavorites,
    confirmClearAllFavorites,
    previewImage,
    closePreview,
    setViewMode,
    setGridVariant,
    toggleSidebar,
    openExportImportModal,
    closeExportImportModal,
  }
}
