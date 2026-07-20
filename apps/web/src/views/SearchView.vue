<script setup>
import SearchAggregatesBar from '@/components/search/SearchAggregatesBar.vue'
import SearchBulkCollectionModal from '@/components/search/SearchBulkCollectionModal.vue'
import SearchCompareDrawer from '@/components/search/SearchCompareDrawer.vue'
import SearchBottomDock from '@/features/search/components/SearchBottomDock.vue'
import { useSearchBulkActions } from '@/features/search/composables/useSearchBulkActions'
import { useSearchFilterBarState } from '@/features/search/composables/useSearchFilterBarState'
import { useSearchHistory as createSearchHistory } from '@/features/search/composables/useSearchHistory'
import { useSearchPreviewInteractions } from '@/features/search/composables/useSearchPreviewInteractions'
import { useSearchRequests } from '@/features/search/composables/useSearchRequests'
import { useSearchRouteState } from '@/features/search/composables/useSearchRouteState'
import { useSearchWorkbenchUi } from '@/features/search/composables/useSearchWorkbenchUi'
import SearchQuickDetailDrawer from '@/components/search/SearchQuickDetailDrawer.vue'
import SearchWallpaperContextMenu from '@/components/search/SearchWallpaperContextMenu.vue'
import WallpaperFullscreenPreview from '@/components/wallpaper/WallpaperFullscreenPreview.vue'
import WallpaperGrid from '@/components/wallpaper/WallpaperGrid.vue'
import { useStorageService } from '@/services/storage'
import { downloadWallpapersUnified } from '@/services/wallpaperDownload'
import { useSettingsStore } from '@/stores/settings'
import { useFavoritesStore } from '@/stores/favorites'
import { useSearchWorkbenchStore } from '@/stores/searchWorkbench'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAppearanceStore } from '@/stores/appearance'
import notificationService from '@/services/notification'
import { purityLabel } from '@/utils/purity'
import { randomWallhavenSeed } from '@/utils/wallhaven'
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// 获取route、router和stores
const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()
const favoritesStore = useFavoritesStore()
const workbenchStore = useSearchWorkbenchStore()
const runtimeConfigStore = useRuntimeConfigStore()
const appearanceStore = useAppearanceStore()
const storageService = useStorageService()

// 下载相关状态
const isDownloading = ref(false)
const downloadProgress = ref(0)
let isInitializing = true

const {
  searchParams,
  jumpToPage,
  createDefaultSearchParams,
  toRouteQuery,
  updateSearchParamsFromQuery,
} = useSearchRouteState({
  route,
  settingsStore,
})

const {
  searchHistory,
  showSearchHistory,
  loadSearchHistory,
  addSearchHistory,
  applyHistoryQuery,
  removeSearchHistoryItem,
  clearSearchHistory,
  toggleSearchHistory,
  closeSearchHistoryIfOutside,
} = createSearchHistory({
  storageService,
})

const scrollAfterResultsLoad = ref(false)
const renderedWallpapers = ref([])
const resultsStagePhase = ref('idle')
const searchMode = ref('keyword')
let resultsExitTimer = null
let resultsEnterTimer = null

const searchModeOptions = [
  { value: 'keyword', label: '关键词', placeholder: '关键词…' },
  { value: 'similar', label: '相似', placeholder: '壁纸 ID…' },
  { value: 'author', label: '作者', placeholder: '作者用户名…' },
]

const searchLayout = computed(() => runtimeConfigStore.getPageLayout('search') || {})
const previewLayout = computed(() => searchLayout.value.preview || {})
function isSearchModuleVisible(key) {
  return searchLayout.value?.[key]?.enabled !== false
}
function isSearchChildVisible(parentKey, childKey) {
  const parent = searchLayout.value?.[parentKey] || {}
  return parent?.enabled !== false && parent?.[childKey]?.enabled !== false
}
function isPreviewToolVisible(key) {
  return previewLayout.value?.enabled !== false && previewLayout.value?.[key]?.enabled !== false
}
const isPreviewEnabled = computed(
  () => isSearchModuleVisible('preview') && previewLayout.value?.enabled !== false,
)
const isWorkbenchVisible = computed(
  () => isSearchModuleVisible('header') || isSearchModuleVisible('toolbar'),
)
const {
  workbenchEl,
  searchMainEl,
  resultsAnchorEl,
  workbenchScrollHidden,
  motionEnabled,
  motionPulse,
  mainPaddingStyle,
  triggerMotionPulse,
  measureSearchLayout,
  scrollResultsIntoView,
  initSearchWorkbenchUi,
  cleanupSearchWorkbenchUi,
} = useSearchWorkbenchUi({
  settingsStore,
  isWorkbenchVisible,
})

const {
  wallpapers,
  isLoading,
  hasSearched,
  loadMoreInFlight,
  error,
  totalPages,
  totalResults,
  wallhavenCooldown,
  lastWallhavenStatus,
  hasMorePages,
  gridHasMorePages,
  aggregateColors,
  searchWallpapers,
  loadMore,
  ensureDenseGridPages,
  debounceSearch: queueSearchDebounce,
  retryWallhavenSearch,
  invalidateSearchSignature,
  restoreCachedSearchResults,
  startCooldownPolling,
  cleanupSearchRequests,
} = useSearchRequests({
  searchParams,
  addSearchHistory,
  scrollAfterResultsLoad,
  scrollResultsIntoView,
})

function applyFilters() {
  triggerMotionPulse()
  invalidateSearchSignature()
  workbenchStore.clearSelection()
  searchParams.value.page = 1

  if (searchParams.value.sorting === 'random') {
    if (!searchParams.value.seed) {
      searchParams.value.seed = randomWallhavenSeed()
    }
  } else {
    searchParams.value.seed = ''
  }

  jumpToPage.value = '1'

  void router.replace({
    path: '/search',
    query: toRouteQuery(),
  }).catch(() => {})
  void searchWithDensePrefetch(false, { force: true })
}

/** 排除本会话「隐藏」的项，用于网格与预览上下文 */
const displayWallpapers = computed(() => {
  const hidden = new Set(workbenchStore.hiddenIds.map(String))
  return wallpapers.value.filter((wallpaper) => !hidden.has(String(wallpaper.id)))
})

const renderedAggregateTags = computed(() => {
  const map = new Map()
  for (const wallpaper of renderedWallpapers.value) {
    const tags = Array.isArray(wallpaper.tags) ? wallpaper.tags : []
    for (const tag of tags) {
      const name =
        typeof tag === 'object' && tag ? String(tag.name || '').trim() : String(tag || '').trim()
      if (!name || name.length > 48) continue
      map.set(name, (map.get(name) || 0) + 1)
    }
  }

  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 24)
})

const {
  activeDropdown,
  gridColumns,
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
} = useSearchFilterBarState({
  searchParams,
  settingsStore,
  storageService,
  workbenchStore,
  createDefaultSearchParams,
  applyFilters,
})

/** 搜索完成后按列密度补页：8 列 3 页、6 列 2 页 */
async function searchWithDensePrefetch(loadMoreFlag = false, opts = {}) {
  await searchWallpapers(loadMoreFlag, opts)
  if (!loadMoreFlag) {
    await ensureDenseGridPages(gridColumns.value)
  }
}

async function retryWallhavenSearchWithPrefetch() {
  await retryWallhavenSearch()
  await ensureDenseGridPages(gridColumns.value)
}

watch(gridColumns, (cols) => {
  void ensureDenseGridPages(cols)
})

const {
  selectedWallpapers,
  allVisibleWallpapersSelected,
  toggleSelectAllVisible,
  onToggleWorkbenchSelect,
  bulkAddSelectionToCompare,
  bulkExportLinks,
  bulkAddPending,
  bulkHideSelected,
  hideSingleWallpaper,
  bulkDownloadSelection,
  bulkFavoriteSelection,
  onFindSimilarFromCard,
  removePendingEntry,
} = useSearchBulkActions({
  wallpapers,
  displayWallpapers,
  searchParams,
  workbenchStore,
  favoritesStore,
  notificationService,
  invalidateSearchSignature,
  applyFilters,
})

const {
  previewWallpaper,
  showPreview,
  previewIndex,
  previewInListContext,
  showBulkCollectionModal,
  bulkCollectionWallpapers,
  contextMenu,
  quickDetailOpen,
  quickDetailWallpaper,
  quickDetailLoading,
  quickDetailError,
  showWallpaperPreview,
  onPreviewNext,
  onPreviewPrevious,
  closePreview,
  onSearchSpaceKeydown,
  onFilterColorFromCard,
  onWallpaperContextMenu,
  closeContextMenu,
  onContextMenuAction,
  closeQuickDetail,
  onQuickDetailFilterColor,
  onQuickDetailPreview,
  onQuickDetailSimilar,
  openBulkCollectionModal,
  closeBulkCollectionModal,
} = useSearchPreviewInteractions({
  route,
  displayWallpapers,
  selectedWallpapers,
  searchParams,
  workbenchStore,
  notificationService,
  applyFilters,
  onFindSimilarFromCard,
})

const isValidPageNumber = computed(() => {
  const pageNum = Number(jumpToPage.value)
  return !Number.isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages.value
})

const infiniteScroll = computed(() => settingsStore.settings.infinite_scroll)
const showGridLoading = computed(() => loadMoreInFlight.value)
const waterfallLayout = computed(() => settingsStore.settings.search_waterfall_layout === true)
const toolbarCompact = computed(() => settingsStore.settings.search_toolbar_compact !== false)
const toolbarVisible = computed(() => ({
  categories: isSearchChildVisible('toolbar', 'categories') && settingsStore.settings.search_toolbar_show_categories !== false,
  purity: isSearchChildVisible('toolbar', 'purity') && settingsStore.settings.search_toolbar_show_purity !== false,
  resolution: isSearchChildVisible('toolbar', 'resolution') && settingsStore.settings.search_toolbar_show_resolution !== false,
  ratio: isSearchChildVisible('toolbar', 'ratio') && settingsStore.settings.search_toolbar_show_ratio !== false,
  color: isSearchChildVisible('toolbar', 'color') && settingsStore.settings.search_toolbar_show_color !== false,
  sorting: isSearchChildVisible('toolbar', 'sorting') && settingsStore.settings.search_toolbar_show_sorting !== false,
  topRange: isSearchChildVisible('toolbar', 'topRange') && settingsStore.settings.search_toolbar_show_top_range !== false,
  order: isSearchChildVisible('toolbar', 'order') && settingsStore.settings.search_toolbar_show_order !== false,
  grid: isSearchChildVisible('toolbar', 'grid') && settingsStore.settings.search_toolbar_show_grid !== false,
  quality: isSearchChildVisible('toolbar', 'quality') && settingsStore.settings.search_toolbar_show_quality !== false,
  download: isSearchChildVisible('toolbar', 'download') && settingsStore.settings.search_toolbar_show_download !== false,
  search: isSearchChildVisible('toolbar', 'search') && settingsStore.settings.search_toolbar_show_search !== false,
  reset: isSearchChildVisible('toolbar', 'reset') && settingsStore.settings.search_toolbar_show_reset !== false,
}))
const bottomDockVisible = computed(() => ({
  summary: isSearchChildVisible('bottomDock', 'summary') && settingsStore.settings.search_dock_show_summary !== false,
  colors: isSearchChildVisible('bottomDock', 'colors') && settingsStore.settings.search_dock_show_colors !== false,
  selection: isSearchChildVisible('bottomDock', 'selection') && settingsStore.settings.search_dock_show_selection !== false,
  exportLinks:
    isSearchChildVisible('bottomDock', 'exportLinks') &&
    settingsStore.settings.search_dock_show_export_links !== false,
  pending:
    isSearchChildVisible('bottomDock', 'pending') &&
    isSearchModuleVisible('pendingPool') &&
    settingsStore.settings.search_dock_show_pending !== false,
  hidden: isSearchChildVisible('bottomDock', 'hidden') && settingsStore.settings.search_dock_show_hidden !== false,
  hideSelected:
    isSearchChildVisible('bottomDock', 'hideSelected') &&
    settingsStore.settings.search_dock_show_hide_selected !== false,
  compare:
    isSearchChildVisible('bottomDock', 'compare') &&
    isSearchModuleVisible('compareDrawer') &&
    settingsStore.settings.search_dock_show_compare !== false,
  collection:
    isSearchChildVisible('bottomDock', 'collection') &&
    settingsStore.settings.search_dock_show_collection !== false,
  favorite:
    isSearchChildVisible('bottomDock', 'favorite') &&
    runtimeConfigStore.canUse('favorite') &&
    settingsStore.settings.search_dock_show_favorite !== false,
  download:
    isSearchChildVisible('bottomDock', 'download') &&
    runtimeConfigStore.canUse('download') &&
    settingsStore.settings.search_dock_show_download !== false,
  jump: isSearchChildVisible('bottomDock', 'jump') && settingsStore.settings.search_dock_show_jump !== false,
  pager: isSearchChildVisible('bottomDock', 'pager') && settingsStore.settings.search_dock_show_pager !== false,
  more: isSearchChildVisible('bottomDock', 'more') && settingsStore.settings.search_dock_show_more !== false,
}))
const contextMenuActions = computed(() => ({
  preview: isPreviewEnabled.value,
  detail: isSearchModuleVisible('quickDetail'),
  pending: isSearchModuleVisible('pendingPool'),
}))
const previewEnabledActions = computed(() => ({
  favorite: isPreviewToolVisible('favorite'),
  mockup: isPreviewToolVisible('mockup'),
  rotate: isPreviewToolVisible('rotate'),
  fit: isPreviewToolVisible('fit'),
  info: isPreviewToolVisible('info'),
  compare: isPreviewToolVisible('compare'),
  crop: isPreviewToolVisible('crop'),
  decompose: isPreviewToolVisible('decompose'),
  filters: isPreviewToolVisible('filters'),
  ai: isPreviewToolVisible('ai'),
  download: isPreviewToolVisible('download'),
  fullscreen: isPreviewToolVisible('fullscreen'),
}))
const searchCardQuality = computed(() => {
  const raw = settingsStore.settings.preview_image_quality
  return ['tiny', 'medium', 'high', 'original'].includes(raw) ? raw : 'high'
})
const imageQualityToggleIcon = computed(() =>
  searchCardQuality.value === 'original' ? 'bi-image-fill' : 'bi-image',
)
const imageQualityToggleTitle = computed(() =>
  searchCardQuality.value === 'original'
    ? '当前卡片原图画质，点击切换为高清画质'
    : '当前卡片高清画质，点击切换为原图画质',
)
const waterfallInitialRenderCount = computed(() => {
  const raw = Number(settingsStore.settings.search_waterfall_initial_render_count)
  return Number.isFinite(raw) ? Math.min(120, Math.max(6, Math.round(raw))) : 24
})
const waterfallPreloadPx = computed(() => {
  const raw = Number(settingsStore.settings.search_waterfall_preload_px)
  return Number.isFinite(raw) ? Math.min(3000, Math.max(200, Math.round(raw))) : 1100
})
const searchVirtualizeGrid = computed(() => !waterfallLayout.value)

/** 标题区展示：主搜索框 + q 片段合并后的可读串 */
const displaySearchLabel = computed(() => {
  return searchParams.value.query.trim() || ''
})

const searchHeaderMainLine = computed(() => displaySearchLabel.value || '')
const searchHeaderSubLine = computed(() => '')

/** 底部栏标题过长省略时，悬停可看完整检索描述 */
const searchDockTitleFull = computed(() => {
  const main = searchHeaderMainLine.value || '所有壁纸'
  const sub = searchHeaderSubLine.value
  return sub ? `${main}（${sub}）` : main
})

const resolutionLabel = computed(() => {
  const value = searchParams.value.resolution
  if (!value) return '分辨率'
  if (value === '3840x2160') return '4K'
  if (value === '2560x1440') return '2K'
  if (value === '1920x1080') return 'FHD'
  return value
})

const ratioFilterLabel = computed(() => searchParams.value.ratios || '比例')

const sortingLabel = computed(() => {
  const labels = {
    relevance: '相关',
    random: '随机',
    date_added: '最新',
    views: '浏览',
    favorites: '收藏',
    hot: '热度',
    toplist: '排行',
  }
  return labels[searchParams.value.sorting] || '排序'
})

const currentSearchMode = computed(
  () =>
    searchModeOptions.find((option) => option.value === searchMode.value) || searchModeOptions[0],
)

function stripSearchPrefix(value, mode = searchMode.value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (mode === 'similar') return raw.replace(/^like:/i, '').trim()
  if (mode === 'author') return raw.replace(/^@+/, '').trim()
  return raw
}

function stripKnownSearchPrefix(value) {
  const raw = String(value || '').trim()
  if (/^like:/i.test(raw)) return raw.replace(/^like:/i, '').trim()
  if (/^@+/.test(raw)) return raw.replace(/^@+/, '').trim()
  return raw
}

function formatSearchQuery(value, mode = searchMode.value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (mode === 'similar') return `like:${raw.replace(/^like:/i, '').trim()}`
  if (mode === 'author') return `@${raw.replace(/^@+/, '').trim()}`

  return raw
}

function inferSearchMode(value) {
  const raw = String(value || '').trim()
  if (!raw) return 'keyword'
  if (/^like:/i.test(raw)) return 'similar'
  if (/^@+/.test(raw)) return 'author'
  return 'keyword'
}

function syncSearchModeFromQuery() {
  searchMode.value = inferSearchMode(searchParams.value.query)
}

const searchInputValue = computed({
  get() {
    return stripSearchPrefix(searchParams.value.query)
  },
  set(value) {
    searchParams.value.query = formatSearchQuery(value)
  },
})

function setSearchMode(mode) {
  if (!searchModeOptions.some((option) => option.value === mode)) return
  const currentValue = stripKnownSearchPrefix(searchParams.value.query)
  searchMode.value = mode
  searchParams.value.query = formatSearchQuery(currentValue, mode)
  activeDropdown.value = null

  if (searchParams.value.query) {
    debounceSearch()
  }
}

const orderToggleIcon = computed(() =>
  searchParams.value.order === 'asc' ? 'bi-sort-up-alt' : 'bi-sort-down',
)

const orderToggleTitle = computed(() =>
  searchParams.value.order === 'asc' ? '当前升序，点击切换为降序' : '当前降序，点击切换为升序',
)

function toggleOrderDirection() {
  setOrder(searchParams.value.order === 'asc' ? 'desc' : 'asc')
}

function toggleImageQuality() {
  const next = searchCardQuality.value === 'original' ? 'high' : 'original'
  settingsStore.setSetting('preview_image_quality', next)
}

const canGoPrev = computed(() => searchParams.value.page > 1)
const canGoNext = computed(() => searchParams.value.page < totalPages.value)

function goToPrevPage() {
  if (!canGoPrev.value) return
  triggerMotionPulse()
  scrollAfterResultsLoad.value = true
  searchParams.value.page -= 1
  jumpToPage.value = String(searchParams.value.page)
  router.replace({ path: '/search', query: toRouteQuery() })
}

function goToNextPage() {
  if (!canGoNext.value) return
  triggerMotionPulse()
  scrollAfterResultsLoad.value = true
  searchParams.value.page += 1
  jumpToPage.value = String(searchParams.value.page)
  router.replace({ path: '/search', query: toRouteQuery() })
}

function manualLoadNextBatch() {
  if (!infiniteScroll.value) {
    goToNextPage()
    return
  }
  loadMore()
}

// 跳转到指定页码
function jumpToSpecificPage() {
  if (!isValidPageNumber.value) return

  const pageNum = Number(jumpToPage.value)
  if (pageNum !== searchParams.value.page) {
    triggerMotionPulse()
    scrollAfterResultsLoad.value = true
  }
  searchParams.value.page = pageNum

  router.replace({
    path: '/search',
    query: toRouteQuery(),
  })
}

// 上一页/下一页功能已移除

// 防抖搜索函数
function debounceSearch() {
  queueSearchDebounce(applyFilters)
}

/** random 排序下更换 seed，得到全新随机序列 */
function shuffleRandomSeed() {
  triggerMotionPulse()
  if (searchParams.value.sorting !== 'random') {
    searchParams.value.sorting = 'random'
  }
  searchParams.value.seed = randomWallhavenSeed()
  searchParams.value.page = 1
  jumpToPage.value = '1'
  invalidateSearchSignature()
  router.replace({
    path: '/search',
    query: toRouteQuery(),
  })
}

function onAggregatePickTag(name) {
  searchMode.value = 'keyword'
  searchParams.value.query = String(name || '').trim()
  applyFilters()
}

function onAggregatePickColor(hex) {
  searchParams.value.color = String(hex).replace(/^#/, '').toLowerCase()
  applyFilters()
}

function handleWallpaperPreview(wallpaper) {
  if (!isPreviewEnabled.value) return
  showWallpaperPreview(wallpaper)
}

function handleSearchSpaceKeydown(event) {
  if (!isPreviewEnabled.value) return
  onSearchSpaceKeydown(event)
}

function handleWallpaperContextMenu(payload) {
  if (!isSearchModuleVisible('contextMenu')) return
  onWallpaperContextMenu(payload)
}

function handleQuickDetailPreview() {
  if (!isPreviewEnabled.value) return
  onQuickDetailPreview()
}

function handleContextMenuAction(action) {
  if (action === 'preview' && !isPreviewEnabled.value) {
    closeContextMenu()
    return
  }
  if (action === 'detail' && !isSearchModuleVisible('quickDetail')) {
    closeContextMenu()
    return
  }
  if (action === 'pending' && !isSearchModuleVisible('pendingPool')) {
    closeContextMenu()
    return
  }
  onContextMenuAction(action)
}

watch(isPreviewEnabled, (enabled) => {
  if (!enabled) closePreview()
})

// 路由为搜索条件的唯一来源，避免与本地 watch 双重请求
watch(
  () => route.query,
  () => {
    if (isInitializing) {
      return
    }

    updateSearchParamsFromQuery()
    syncSearchModeFromQuery()
    jumpToPage.value = searchParams.value.page.toString()
    void searchWithDensePrefetch()
  },
  { deep: true },
)

watch(
  () => route.fullPath,
  () => {
    if (route.name === 'search') {
      nextTick(() => measureSearchLayout())
    }
  },
)

function clearResultsStageTimers() {
  if (resultsExitTimer) {
    clearTimeout(resultsExitTimer)
    resultsExitTimer = null
  }
  if (resultsEnterTimer) {
    clearTimeout(resultsEnterTimer)
    resultsEnterTimer = null
  }
}

watch(
  displayWallpapers,
  (next, prev) => {
    if (
      isLoading.value &&
      !loadMoreInFlight.value &&
      next.length === 0 &&
      renderedWallpapers.value.length > 0
    ) {
      return
    }

    const nextIds = next.map((w) => String(w.id)).join('|')
    const renderedIds = renderedWallpapers.value.map((w) => String(w.id)).join('|')
    if (nextIds === renderedIds) return

    const prevIds = (prev || []).map((w) => String(w.id)).join('|')
    const isAppend =
      loadMoreInFlight.value &&
      renderedWallpapers.value.length > 0 &&
      next.length > renderedWallpapers.value.length &&
      nextIds.startsWith(renderedIds)

    clearResultsStageTimers()

    if (!renderedWallpapers.value.length || !prevIds || isAppend || !motionEnabled.value) {
      renderedWallpapers.value = next
      resultsStagePhase.value = 'enter'
      resultsEnterTimer = window.setTimeout(() => {
        resultsStagePhase.value = 'idle'
        resultsEnterTimer = null
      }, 180)
      return
    }

    resultsStagePhase.value = 'exit'
    resultsExitTimer = window.setTimeout(() => {
      renderedWallpapers.value = next
      resultsStagePhase.value = 'enter'
      resultsExitTimer = null
      resultsEnterTimer = window.setTimeout(() => {
        resultsStagePhase.value = 'idle'
        resultsEnterTimer = null
      }, 180)
    }, 110)
  },
  { immediate: true },
)

// 使用搜索历史
function useSearchHistory(query) {
  applyHistoryQuery(query, (value) => {
    searchParams.value.query = value
    syncSearchModeFromQuery()
    applyFilters()
  })
}

// 处理点击外部关闭下拉菜单
function handleOutsideClick(event) {
  closeSearchHistoryIfOutside(event)
  closeDropdownsIfOutside(event, '.filter-bar-dropdown, .cosmic-search-shell')
}

// 下载全部壁纸
async function downloadAllWallpapers() {
  if (isDownloading.value || wallpapers.value.length === 0) return

  try {
    isDownloading.value = true
    downloadProgress.value = 0

    // 创建一个下载记录归类名称，包含搜索关键词和日期
    let searchFolder = ''
    if (searchParams.value.query) {
      searchFolder = `搜索_${searchParams.value.query}_${new Date().toISOString().split('T')[0]}`
    } else {
      searchFolder = `壁纸_${new Date().toISOString().split('T')[0]}`
    }

    const result = await downloadWallpapersUnified(wallpapers.value, {
      scope: searchFolder,
      filename: searchFolder,
      position: 'bottom-right',
      options: {
        save_mode: 'custom',
        custom_folder: searchFolder,
      },
      onProgress: ({ percent }) => {
        downloadProgress.value = percent
      },
    })
    downloadProgress.value = 100
  } catch (error) {
    console.error('批量下载壁纸失败:', error)
    notificationService.error(`批量下载失败: ${error.message || '未知错误'}`, {
      duration: 5000,
      position: 'bottom-right',
    })
  } finally {
    isDownloading.value = false
    downloadProgress.value = 0
  }
}

onBeforeMount(() => {
  document.documentElement.classList.add('search-gallery-page')
  appearanceStore.applyToDocument()
})

// 组件挂载时初始化
onMounted(async () => {
  await settingsStore.initSettings()

  updateSearchParamsFromQuery()

  loadSettings()

  loadSearchHistory()

  jumpToPage.value = searchParams.value.page.toString()
  syncSearchModeFromQuery()
  await initSearchWorkbenchUi()
  restoreCachedSearchResults()

  isInitializing = false
  void searchWithDensePrefetch()

  document.addEventListener('click', handleOutsideClick)
  document.addEventListener('keydown', handleSearchSpaceKeydown)
  startCooldownPolling()
})

// 组件卸载前清理
onBeforeUnmount(() => {
  document.documentElement.classList.remove('search-gallery-page')
  document.removeEventListener('click', handleOutsideClick)
  document.removeEventListener('keydown', handleSearchSpaceKeydown)
  cleanupSearchRequests()
  cleanupSearchWorkbenchUi()
  clearResultsStageTimers()
  saveSettings()
})
</script>

<template>
  <div class="search-page" :class="{ 'is-scheme-dark': appearanceStore.isDark }">
    <!-- 顶部过渡遮罩：header 渐隐时反向渐显，增强滚动视觉连续性 -->
    <div class="search-top-blur-mask" aria-hidden="true"></div>
    <!-- 固定在工作区：不随列表滚动；top 对齐站点导航底部 -->
    <header
      v-if="isWorkbenchVisible"
      ref="workbenchEl"
      class="search-workbench"
      :class="{
        'is-loading': isLoading,
        'motion-enabled': motionEnabled,
        'is-scroll-hidden': workbenchScrollHidden,
        'is-toolbar-compact': toolbarCompact,
      }"
    >
      <div class="workbench-inner container-fluid px-2 px-lg-3">
        <div v-if="isSearchModuleVisible('toolbar')" class="workbench-filters">
          <div class="filter-bar-main">
            <!-- 分类过滤 -->
            <div
              v-if="toolbarVisible.categories"
              class="filter-bar-item filter-segment-group filter-segment-group--category"
              aria-label="分类过滤"
            >
              <button
                class="filter-bar-btn filter-segment-btn"
                :class="{ active: searchParams.categories[0] === '1' }"
                @click="toggleCategory(0)"
              >
                General
              </button>
              <button
                class="filter-bar-btn filter-segment-btn"
                :class="{ active: searchParams.categories[1] === '1' }"
                @click="toggleCategory(1)"
              >
                Anime
              </button>
              <button
                class="filter-bar-btn filter-segment-btn"
                :class="{ active: searchParams.categories[2] === '1' }"
                @click="toggleCategory(2)"
              >
                People
              </button>
            </div>

            <!-- 纯净度过滤 -->
            <div
              v-if="toolbarVisible.purity"
              class="filter-bar-item filter-segment-group filter-segment-group--purity"
              aria-label="纯净度过滤"
            >
              <button
                class="filter-bar-btn filter-segment-btn"
                :class="{ active: searchParams.purity[0] === '1' }"
                @click="togglePurity(0)"
              >
                SFW
              </button>
              <button
                class="filter-bar-btn filter-segment-btn"
                :class="{ active: searchParams.purity[1] === '1' }"
                @click="togglePurity(1)"
              >
                Sketchy
              </button>
              <button
                class="filter-bar-btn filter-segment-btn"
                :class="{
                  active: searchParams.purity[2] === '1',
                  disabled: !settingsStore.settings.show_nsfw,
                }"
                @click="togglePurity(2)"
                :title="
                  !settingsStore.settings.show_nsfw
                    ? '需要在设置中启用NSFW内容并提供Wallhaven API密钥'
                    : ''
                "
              >
                NSFW
              </button>
            </div>

            <!-- 分辨率过滤 -->
            <div v-if="toolbarVisible.resolution" class="filter-bar-item">
              <div
                class="filter-bar-dropdown"
                @mouseenter="openDropdown('resolution')"
                @mouseleave="closeDropdown('resolution')"
              >
                <button
                  class="filter-bar-btn"
                  type="button"
                  :aria-expanded="activeDropdown === 'resolution'"
                  @focus="openDropdown('resolution')"
                >
                  <span>{{ resolutionLabel }}</span>
                  <i class="bi bi-chevron-down ms-1 small" aria-hidden="true"></i>
                </button>
                <div
                  class="filter-bar-dropdown-menu"
                  :class="{ show: activeDropdown === 'resolution' }"
                >
                  <button
                    type="button"
                    class="filter-bar-dropdown-item"
                    :class="{ active: !searchParams.resolution }"
                    @click.stop="setResolution('')"
                  >
                    全部分辨率
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.resolution === '3840x2160' }"
                    @click="setResolution('3840x2160')"
                  >
                    4K (3840x2160)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.resolution === '2560x1440' }"
                    @click="setResolution('2560x1440')"
                  >
                    2K (2560x1440)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.resolution === '1920x1080' }"
                    @click="setResolution('1920x1080')"
                  >
                    Full HD (1920x1080)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.resolution === '1366x768' }"
                    @click="setResolution('1366x768')"
                  >
                    HD (1366x768)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.resolution === '1280x720' }"
                    @click="setResolution('1280x720')"
                  >
                    HD (1280x720)
                  </button>
                </div>
              </div>
            </div>

            <!-- 比例过滤 -->
            <div v-if="toolbarVisible.ratio" class="filter-bar-item">
              <div
                class="filter-bar-dropdown"
                @mouseenter="openDropdown('ratio')"
                @mouseleave="closeDropdown('ratio')"
              >
                <button
                  class="filter-bar-btn"
                  type="button"
                  :aria-expanded="activeDropdown === 'ratio'"
                  @focus="openDropdown('ratio')"
                >
                  <span>{{ ratioFilterLabel }}</span>
                  <i class="bi bi-chevron-down ms-1 small" aria-hidden="true"></i>
                </button>
                <div class="filter-bar-dropdown-menu" :class="{ show: activeDropdown === 'ratio' }">
                  <button
                    type="button"
                    class="filter-bar-dropdown-item"
                    :class="{ active: !searchParams.ratios }"
                    @click.stop="setRatio('')"
                  >
                    全部比例
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '16x9' }"
                    @click="setRatio('16x9')"
                  >
                    16:9
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '16x10' }"
                    @click="setRatio('16x10')"
                  >
                    16:10
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '21x9' }"
                    @click="setRatio('21x9')"
                  >
                    21:9 (超宽)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '32x9' }"
                    @click="setRatio('32x9')"
                  >
                    32:9 (双超宽)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '48x9' }"
                    @click="setRatio('48x9')"
                  >
                    48:9 (三超宽)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '9x16' }"
                    @click="setRatio('9x16')"
                  >
                    9:16 (经典手机)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '10x16' }"
                    @click="setRatio('10x16')"
                  >
                    10:16 (平板/折中)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '19x9' }"
                    @click="setRatio('19x9')"
                  >
                    19:9 (手机)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '19x10' }"
                    @click="setRatio('19x10')"
                  >
                    19:10 (19.5:9 手机)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '20x9' }"
                    @click="setRatio('20x9')"
                  >
                    20:9 (全面屏手机)
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.ratios === '1x1' }"
                    @click="setRatio('1x1')"
                  >
                    1:1 (正方形)
                  </button>
                </div>
              </div>
            </div>

            <!-- 颜色过滤 -->
            <div v-if="toolbarVisible.color" class="filter-bar-item">
              <div
                class="filter-bar-dropdown"
                @mouseenter="openDropdown('color')"
                @mouseleave="closeDropdown('color')"
              >
                <button
                  class="filter-bar-btn"
                  type="button"
                  :aria-expanded="activeDropdown === 'color'"
                  @focus="openDropdown('color')"
                >
                  <span>颜色</span>
                  <i class="bi bi-chevron-down ms-1 small" aria-hidden="true"></i>
                </button>
                <div class="filter-bar-dropdown-menu" :class="{ show: activeDropdown === 'color' }">
                  <button
                    type="button"
                    class="filter-bar-dropdown-item"
                    :class="{ active: !searchParams.color }"
                    @click.stop="setColor('')"
                  >
                    全部颜色
                  </button>
                  <div class="color-grid">
                    <button
                      v-for="color in [
                        '660000',
                        '990000',
                        'cc0000',
                        'cc3333',
                        'ea4c88',
                        '993399',
                        '663399',
                        '333399',
                        '0066cc',
                        '0099cc',
                        '66cccc',
                        '77cc33',
                        '669900',
                        '336600',
                        '666600',
                        '999900',
                        'cccc33',
                        'ffff00',
                        'ffcc33',
                        'ff9900',
                        'ff6600',
                        'cc6633',
                        '996633',
                        '663300',
                        '000000',
                        '999999',
                        'cccccc',
                        'ffffff',
                        '424153',
                      ]"
                      :key="color"
                      class="color-item"
                      :class="{ active: searchParams.color === color }"
                      :style="{ backgroundColor: `#${color}` }"
                      @click="setColor(color)"
                    ></button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 排序方式 -->
            <div v-if="toolbarVisible.sorting" class="filter-bar-item">
              <div
                class="filter-bar-dropdown"
                @mouseenter="openDropdown('sorting')"
                @mouseleave="closeDropdown('sorting')"
              >
                <button
                  class="filter-bar-btn"
                  type="button"
                  :aria-expanded="activeDropdown === 'sorting'"
                  @focus="openDropdown('sorting')"
                >
                  <span>{{ sortingLabel }}</span>
                  <i class="bi bi-chevron-down ms-1 small" aria-hidden="true"></i>
                </button>
                <div
                  class="filter-bar-dropdown-menu"
                  :class="{ show: activeDropdown === 'sorting' }"
                >
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.sorting === 'relevance' }"
                    @click="setSorting('relevance')"
                  >
                    相关性
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.sorting === 'random' }"
                    @click="setSorting('random')"
                  >
                    随机
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.sorting === 'date_added' }"
                    @click="setSorting('date_added')"
                  >
                    最新（Date Added）
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.sorting === 'views' }"
                    @click="setSorting('views')"
                  >
                    查看次数
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.sorting === 'favorites' }"
                    @click="setSorting('favorites')"
                  >
                    收藏次数
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.sorting === 'hot' }"
                    @click="setSorting('hot')"
                  >
                    热度（Hot）
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.sorting === 'toplist' }"
                    @click="setSorting('toplist')"
                  >
                    排行榜（Toplist）
                  </button>
                </div>
              </div>
            </div>

            <!-- 热门时间范围 -->
            <div
              v-if="toolbarVisible.topRange && searchParams.sorting === 'toplist'"
              class="filter-bar-item"
            >
              <div
                class="filter-bar-dropdown"
                @mouseenter="openDropdown('topRange')"
                @mouseleave="closeDropdown('topRange')"
              >
                <button
                  class="filter-bar-btn filter-bar-btn--compact"
                  :aria-expanded="activeDropdown === 'topRange'"
                  @focus="openDropdown('topRange')"
                >
                  <span>{{ searchParams.topRange }}</span>
                  <i class="bi bi-chevron-down ms-1 small" aria-hidden="true"></i>
                </button>
                <div
                  class="filter-bar-dropdown-menu"
                  :class="{ show: activeDropdown === 'topRange' }"
                >
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.topRange === '1d' }"
                    @click="setTopRange('1d')"
                  >
                    1天
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.topRange === '3d' }"
                    @click="setTopRange('3d')"
                  >
                    3天
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.topRange === '1w' }"
                    @click="setTopRange('1w')"
                  >
                    1周
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.topRange === '1M' }"
                    @click="setTopRange('1M')"
                  >
                    1个月
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.topRange === '3M' }"
                    @click="setTopRange('3M')"
                  >
                    3个月
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.topRange === '6M' }"
                    @click="setTopRange('6M')"
                  >
                    6个月
                  </button>
                  <button
                    class="filter-bar-dropdown-item"
                    :class="{ active: searchParams.topRange === '1y' }"
                    @click="setTopRange('1y')"
                  >
                    1年
                  </button>
                </div>
              </div>
            </div>

            <!-- 排序顺序 -->
            <div v-if="toolbarVisible.order" class="filter-bar-item">
              <button
                class="filter-bar-btn toolbar-icon-btn"
                :title="orderToggleTitle"
                @click="toggleOrderDirection"
              >
                <i class="bi" :class="orderToggleIcon" aria-hidden="true"></i>
              </button>
            </div>

            <!-- 网格大小控制 -->
            <div v-if="toolbarVisible.grid" class="filter-bar-item">
              <div
                class="btn-group btn-group-sm toolbar-icon-segment"
                role="group"
                aria-label="网格大小控制"
              >
                <button
                  type="button"
                  class="btn btn-outline-secondary grid-size-btn"
                  :class="{ active: gridColumns === 8 }"
                  @click="setGridColumns(8)"
                  title="超小图标 (8列)"
                >
                  <i class="bi bi-grid-3x3-gap"></i>
                </button>
                <button
                  type="button"
                  class="btn btn-outline-secondary grid-size-btn"
                  :class="{ active: gridColumns === 6 }"
                  @click="setGridColumns(6)"
                  title="小图标 (6列)"
                >
                  <i class="bi bi-grid-3x3"></i>
                </button>
                <button
                  type="button"
                  class="btn btn-outline-secondary grid-size-btn"
                  :class="{ active: gridColumns === 4 }"
                  @click="setGridColumns(4)"
                  title="中等图标 (4列)"
                >
                  <i class="bi bi-grid-3x2"></i>
                </button>
                <button
                  type="button"
                  class="btn btn-outline-secondary grid-size-btn"
                  :class="{ active: gridColumns === 3 }"
                  @click="setGridColumns(3)"
                  title="大图标 (3列)"
                >
                  <i class="bi bi-grid"></i>
                </button>
                <button
                  type="button"
                  class="btn btn-outline-secondary grid-size-btn"
                  :class="{ active: gridColumns === 2 }"
                  @click="setGridColumns(2)"
                  title="超大图标 (2列)"
                >
                  <i class="bi bi-layout-split"></i>
                </button>
              </div>
            </div>

            <!-- 图片画质切换 -->
            <div v-if="toolbarVisible.quality" class="filter-bar-item">
              <button
                type="button"
                class="filter-bar-btn toolbar-icon-btn"
                :class="{ active: searchCardQuality === 'original' }"
                :title="imageQualityToggleTitle"
                @click="toggleImageQuality"
              >
                <i class="bi" :class="imageQualityToggleIcon" aria-hidden="true"></i>
              </button>
            </div>

            <!-- 本页下载 -->
            <div v-if="toolbarVisible.download" class="filter-bar-item filter-bar-download-inline">
              <div v-if="isDownloading && downloadProgress > 0" class="download-progress-inline">
                <div class="progress toolbar-progress">
                  <div
                    class="progress-bar progress-bar-striped progress-bar-animated bg-success"
                    role="progressbar"
                    :style="{ width: downloadProgress + '%' }"
                    :aria-valuenow="downloadProgress"
                    aria-valuemin="0"
                    aria-valuemax="100"
                  ></div>
                </div>
                <small class="text-muted">{{ downloadProgress }}%</small>
              </div>
              <button
                type="button"
                class="btn btn-outline-primary btn-sm download-all-btn"
                @click="downloadAllWallpapers"
                :disabled="isLoading || wallpapers.length === 0 || isDownloading"
                title="下载当前列表中的壁纸"
              >
                <i class="bi bi-download"></i>
                <span class="download-all-label">本页 {{ wallpapers.length }} 张</span>
              </button>
            </div>

            <!-- 关键词 + 搜索 + 重置：合并到筛选栏最右侧 -->
            <div
              v-if="toolbarVisible.search || toolbarVisible.reset"
              class="filter-bar-item filter-bar-actions-trail"
            >
              <div class="filter-bar-query-wrap">
                <label class="visually-hidden" for="quick-search">搜索壁纸</label>
                <div
                  v-if="toolbarVisible.search"
                  class="cosmic-search-shell"
                  :class="{ 'is-history-open': showSearchHistory }"
                  @mouseleave="closeDropdown('searchMode')"
                >
                  <div class="cosmic-search-track search-composer">
                    <div class="search-mode-picker">
                      <button
                        type="button"
                        class="search-mode-trigger"
                        :aria-expanded="activeDropdown === 'searchMode'"
                        @mouseenter="openDropdown('searchMode')"
                        @focus="openDropdown('searchMode')"
                      >
                        <span>{{ currentSearchMode.label }}</span>
                        <i class="bi bi-chevron-down" aria-hidden="true"></i>
                      </button>
                    </div>
                    <div class="search-input-zone">
                      <input
                        type="text"
                        class="form-control cosmic-search-input"
                        id="quick-search"
                        :placeholder="currentSearchMode.placeholder"
                        v-model="searchInputValue"
                        autocomplete="off"
                        @keyup.enter="applyFilters"
                        @input="debounceSearch"
                      />
                    </div>
                    <div class="search-action-zone">
                      <button
                        type="button"
                        class="cosmic-search-history-btn"
                        title="搜索历史"
                        :aria-expanded="showSearchHistory"
                        @click="toggleSearchHistory"
                      >
                        <i class="bi bi-clock-history" aria-hidden="true"></i>
                      </button>
                      <button
                        type="button"
                        class="cosmic-search-submit-btn"
                        title="按当前条件搜索"
                        @click="applyFilters"
                      >
                        搜索
                      </button>
                    </div>
                  </div>
                  <div
                    class="filter-bar-dropdown-menu search-mode-menu"
                    :class="{ show: activeDropdown === 'searchMode' }"
                    @click.stop
                  >
                    <button
                      v-for="option in searchModeOptions"
                      :key="option.value"
                      type="button"
                      class="filter-bar-dropdown-item"
                      :class="{ active: searchMode === option.value }"
                      @click.stop="setSearchMode(option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                  <div
                    v-if="showSearchHistory"
                    class="search-history-dropdown cosmic-search-history-panel"
                    role="listbox"
                    aria-label="搜索历史"
                  >
                    <div class="search-history-header cosmic-search-history-header">
                      <span>搜索历史</span>
                      <button
                        type="button"
                        class="cosmic-search-clear-all"
                        @click="clearSearchHistory"
                      >
                        清除全部
                      </button>
                    </div>
                    <div class="search-history-list" v-if="searchHistory.length > 0">
                      <div
                        v-for="(item, index) in searchHistory"
                        :key="index"
                        class="search-history-item cosmic-search-history-item"
                        role="option"
                        @click="useSearchHistory(item)"
                      >
                        <span class="cosmic-search-history-text">{{ item }}</span>
                        <button
                          type="button"
                          class="cosmic-search-history-remove"
                          title="移除此条"
                          @click.stop="removeSearchHistoryItem(index)"
                        >
                          <i class="bi bi-x-lg" aria-hidden="true"></i>
                        </button>
                      </div>
                    </div>
                    <div class="search-history-empty cosmic-search-history-empty" v-else>
                      <span>暂无搜索历史</span>
                    </div>
                  </div>
                </div>
              </div>
              <button
                v-if="toolbarVisible.reset"
                type="button"
                class="filter-bar-btn"
                title="恢复分类、纯度、分辨率与关键词默认值"
                @click="resetFilters"
              >
                <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                <span class="reset-filter-label">重置</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="isSearchModuleVisible('toolbar')" class="workbench-toolbar">
          <!-- 多选、主色与分页在结果卡片底部 -->
          <div class="toolbar-row toolbar-row-unified">
            <div class="toolbar-inline-controls">
              <div class="toolbar-group toolbar-group-meta">
                <span
                  v-if="searchParams.sorting === 'random' && searchParams.seed"
                  class="status-chip subtle seed-chip"
                >
                  <i class="bi bi-dice-5"></i>
                  <span class="seed-text" :title="searchParams.seed">{{ searchParams.seed }}</span>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary seed-shuffle-btn"
                    title="换一批随机结果（新 seed）"
                    @click="shuffleRandomSeed"
                  >
                    换种子
                  </button>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main ref="searchMainEl" class="search-main" :style="mainPaddingStyle">
      <div ref="resultsAnchorEl" class="search-results-anchor" tabindex="-1"></div>

      <!-- 搜索结果 -->
      <div class="search-results container-fluid" :class="{ 'motion-enabled': motionEnabled }">
        <div
          v-if="
            isSearchModuleVisible('status') &&
            (lastWallhavenStatus === 429 || lastWallhavenStatus === 401)
          "
          class="mx-2 mt-2 mb-0 wallhaven-status-banner"
          :class="lastWallhavenStatus === 429 ? 'is-warning' : 'is-danger'"
          role="status"
        >
          <div class="wallhaven-status-inner">
            <div class="wallhaven-status-text">
              <i class="bi bi-shield-exclamation me-1" aria-hidden="true"></i>
              <template v-if="lastWallhavenStatus === 429">
                Wallhaven 上游限流，Worker
                已进入统一冷却。下方进度条为本机最近搜索频率估算；请稍后重试。
              </template>
              <template v-else>
                未授权：请在设置中填写有效的 Wallhaven API Key，或暂时关闭 NSFW 后再搜索。
              </template>
            </div>
            <div class="wallhaven-status-actions">
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary wallhaven-status-btn"
                @click="retryWallhavenSearchWithPrefetch"
              >
                重试
              </button>
              <router-link
                v-if="lastWallhavenStatus === 401"
                class="btn btn-sm btn-primary wallhaven-status-btn"
                to="/settings"
              >
                打开设置
              </router-link>
            </div>
          </div>
        </div>

        <div
          v-if="isSearchModuleVisible('status') && wallhavenCooldown"
          class="cooldown-hint mx-2 mt-2 mb-0"
          role="status"
        >
          <i class="bi bi-hourglass-split me-1" />
          Worker 冷却中，约
          <strong>{{ wallhavenCooldown.remainingSeconds }}</strong> 秒后可继续。
        </div>

        <div
          v-if="isSearchModuleVisible('pendingPool') && workbenchStore.pendingCount > 0"
          class="pending-strip mx-2 mt-2"
        >
          <div class="pending-strip-head">
            <span class="pending-title"
              ><i class="bi bi-inbox me-1" aria-hidden="true" />待定池 ·
              {{ workbenchStore.pendingCount }}</span
            >
            <div class="pending-head-actions">
              <button
                type="button"
                class="btn btn-link btn-sm py-0"
                @click="workbenchStore.clearPending()"
              >
                清空
              </button>
            </div>
          </div>
          <div class="pending-chips">
            <span
              v-for="p in workbenchStore.pendingPool.slice(0, 16)"
              :key="p.id"
              class="pending-chip"
            >
              <router-link class="pending-link" :to="{ name: 'wallpaper', params: { id: p.id } }">{{
                p.id
              }}</router-link>
              <button
                type="button"
                class="pending-remove"
                :aria-label="`从待定池移除 ${p.id}`"
                @click="removePendingEntry(p.id)"
              >
                <i class="bi bi-x" />
              </button>
            </span>
          </div>
        </div>

        <SearchAggregatesBar
          v-if="isSearchModuleVisible('aggregates')"
          class="mx-2 mb-2"
          :tag-buckets="renderedAggregateTags"
          @pick-tag="onAggregatePickTag"
        />

        <!-- 壁纸网格 -->
        <div v-if="isSearchModuleVisible('grid')" class="row search-results-grid">
          <div class="col-md-12">
            <div
              class="results-card"
              :class="{
                'results-loading': isLoading,
                'results-stage-exit': resultsStagePhase === 'exit',
                'results-stage-enter': resultsStagePhase === 'enter',
                'motion-enabled': motionEnabled,
                'pulse-once': motionPulse,
              }"
            >
              <div class="results-body">
                <WallpaperGrid
                  :wallpapers="renderedWallpapers"
                  :loading="showGridLoading"
                  :show-empty-state="hasSearched"
                  :error="error"
                  :infiniteScroll="infiniteScroll"
                  :has-more="gridHasMorePages"
                  :gridColumns="gridColumns"
                  :waterfall-layout="waterfallLayout"
                  :waterfall-quality="searchCardQuality"
                  :image-quality="searchCardQuality"
                  :waterfall-initial-render-count="waterfallInitialRenderCount"
                  :waterfall-preload-px="waterfallPreloadPx"
                  :progressive-mount="true"
                  :virtualize="searchVirtualizeGrid"
                  reveal-style="soft"
                  reveal-strength="medium"
                  :showTags="true"
                  :showUploader="true"
                  :selectionMode="workbenchStore.selectionMode"
                  :selectedIds="workbenchStore.selectedIds"
                  @load-more="loadMore"
                  @preview="handleWallpaperPreview"
                  @toggle-select="onToggleWorkbenchSelect"
                  @hide="hideSingleWallpaper"
                  @find-similar="onFindSimilarFromCard"
                  @filter-color="onFilterColorFromCard"
                  @context-menu="handleWallpaperContextMenu"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <SearchBulkCollectionModal
      :show="showBulkCollectionModal"
      :wallpapers="bulkCollectionWallpapers"
      @close="closeBulkCollectionModal"
    />

    <SearchCompareDrawer
      v-if="isSearchModuleVisible('compareDrawer')"
      :open="workbenchStore.compareDrawerOpen"
      :items="workbenchStore.compareItems"
      @close="workbenchStore.closeCompareDrawer()"
      @remove="workbenchStore.removeFromCompare($event)"
      @clear="workbenchStore.clearCompare()"
    />

    <!-- 壁纸预览 -->
    <WallpaperFullscreenPreview
      v-if="isPreviewEnabled"
      :wallpaper="previewWallpaper"
      :show="showPreview"
      :enabled-actions="previewEnabledActions"
      :in-collection="previewInListContext"
      :collection-index="previewIndex >= 0 ? previewIndex : 0"
      :collection-total="renderedWallpapers.length"
      @close="closePreview"
      @next="onPreviewNext"
      @previous="onPreviewPrevious"
    />

    <SearchWallpaperContextMenu
      v-if="isSearchModuleVisible('contextMenu')"
      :show="contextMenu.show"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :wallpaper="contextMenu.wallpaper"
      :visible-actions="contextMenuActions"
      @close="closeContextMenu"
      @action="handleContextMenuAction"
    />

    <SearchQuickDetailDrawer
      v-if="isSearchModuleVisible('quickDetail')"
      :open="quickDetailOpen"
      :wallpaper="quickDetailWallpaper"
      :loading="quickDetailLoading"
      :error="quickDetailError"
      @close="closeQuickDetail"
      @preview="handleQuickDetailPreview"
      @similar="onQuickDetailSimilar"
      @filter-color="onQuickDetailFilterColor"
    />

    <Teleport v-if="isSearchModuleVisible('bottomDock')" defer to="#app-bottom-dock-slot">
      <SearchBottomDock
        :selection-mode="workbenchStore.selectionMode"
        :selected-count="workbenchStore.selectedCount"
        :bulk-disabled="isLoading"
        :summary-title="searchHeaderMainLine || '所有壁纸'"
        :summary-subline="searchHeaderSubLine"
        :summary-full-title="searchDockTitleFull"
        :total-results="totalResults"
        :display-count="displayWallpapers.length"
        :aggregate-colors="aggregateColors"
        :all-selected="allVisibleWallpapersSelected"
        :hidden-count="workbenchStore.hiddenIds.length"
        v-model:page-input="jumpToPage"
        :total-pages="totalPages"
        :is-valid-page-number="isValidPageNumber"
        :can-go-prev="canGoPrev"
        :can-go-next="canGoNext"
        :is-loading="isLoading"
        :infinite-scroll="infiniteScroll"
        :has-more-pages="hasMorePages"
        :wallhaven-cooldown="wallhavenCooldown"
        :visible-tools="bottomDockVisible"
        @compare="bottomDockVisible.compare && bulkAddSelectionToCompare()"
        @download="bottomDockVisible.download && bulkDownloadSelection()"
        @favorite="bottomDockVisible.favorite && bulkFavoriteSelection()"
        @export-links="bottomDockVisible.exportLinks && bulkExportLinks()"
        @add-pending="bottomDockVisible.pending && bulkAddPending()"
        @hide-selected="bottomDockVisible.hideSelected && bulkHideSelected()"
        @bulk-collection="bottomDockVisible.collection && openBulkCollectionModal()"
        @pick-color="onAggregatePickColor"
        @toggle-selection-mode="workbenchStore.toggleSelectionMode()"
        @toggle-select-all="toggleSelectAllVisible"
        @clear-hidden="workbenchStore.clearHidden()"
        @jump="jumpToSpecificPage"
        @prev="goToPrevPage"
        @next="goToNextPage"
        @load-more="manualLoadNextBatch"
      />
    </Teleport>
  </div>
</template>

<style scoped src="../features/search/styles/search-view.css"></style>
