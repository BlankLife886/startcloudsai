<script setup>
import CollectionList from '@/components/favorites/CollectionList.vue'
import CollectionModal from '@/components/favorites/CollectionModal.vue'
import WallpaperGrid from '@/components/wallpaper/WallpaperGrid.vue'
import WallpaperPreview from '@/components/wallpaper/WallpaperFullscreenPreview.vue'
import ShareProgressiveImage from '@/features/share/components/ShareProgressiveImage.vue'
import FavoritesStatsView from '@/features/favorites/components/FavoritesStatsView.vue'
import {
  FAVORITES_GRID_VIEWS,
  FAVORITES_VIEW_MODES,
} from '@/features/favorites/constants/viewModes'
import { useFavoritesCollections } from '@/features/favorites/composables/useFavoritesCollections'
import { useFavoritesFilters } from '@/features/favorites/composables/useFavoritesFilters'
import { useFavoritesOrbStage } from '@/features/favorites/composables/useFavoritesOrbStage'
import { useFavoritesNetwork } from '@/features/favorites/composables/useFavoritesNetwork'
import { useFavoritesPageMotion } from '@/features/favorites/composables/useFavoritesPageMotion'
import { useFavoritesPageState } from '@/features/favorites/composables/useFavoritesPageState'
import { useFavoritesVisuals } from '@/features/favorites/composables/useFavoritesVisuals'
import notificationService from '@/services/notification'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { useFavoritesStore } from '@/stores/favorites'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const favoritesStore = useFavoritesStore()
const runtimeConfigStore = useRuntimeConfigStore()
const pageRoot = ref(null)
const pageReady = ref(false)
const favoritesContentRef = ref(null)
const selectedFavoriteIds = ref([])
const downloadScope = ref('filtered')
const selectionMode = ref(false)
const previewIndex = ref(-1)
const FAVORITES_WATERFALL_STORAGE_KEY = 'favorites-waterfall-layout'
const FAVORITES_QUALITY_STORAGE_KEY = 'favorites-image-quality'
const waterfallLayout = ref(
  typeof window !== 'undefined'
    ? getScopedLocalItem(FAVORITES_WATERFALL_STORAGE_KEY) !== 'false'
    : true,
)
const favoriteImageQuality = ref(
  typeof window !== 'undefined'
    ? getScopedLocalItem(FAVORITES_QUALITY_STORAGE_KEY) || 'high'
    : 'high',
)

const {
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
  changeSorting,
  setQuickFilter,
  setVisualFacet,
  clearVisualFacet,
  resetFilters,
  clearSearch,
  handleEmptyAction,
  previewImage: openPreviewImage,
  closePreview: closePreviewBase,
  setViewMode,
  setGridVariant,
  toggleSidebar,
} = useFavoritesPageState({
  favoritesStore,
  getFilteredFavorites: () =>
    downloadScope.value === 'selected' ? selectedFavorites.value : filteredFavorites.value,
  getFavoritesCount: () => favoritesCount.value,
  notificationService,
})

const {
  scopedFavorites,
  searchedFavorites,
  browseFavorites,
  filteredFavorites,
  quickFilters,
  sortLabel,
  resultSummary,
  emptyState,
  isUncategorized,
} = useFavoritesFilters({
  favoritesStore,
  searchQuery,
  sortBy,
  sortOrder,
  quickFilter,
  visualFacet,
})

const {
  showCollectionModal,
  editingCollection,
  isEditingCollection,
  collectionSubtitle,
  favoritesCount,
  currentCollectionName,
  currentCollectionIcon,
  railCollections,
  getRailCollectionCount,
  openCreateCollectionModal,
  openEditCollectionModal,
  closeCollectionModal,
  saveCollection,
  deleteCollection,
  selectCollection,
} = useFavoritesCollections({
  favoritesStore,
})

const {
  getWallpaperImageUrl,
  getWallpaperCoverUrl,
  getWallpaperLabel,
  getWallpaperSummary,
  orbWallpapers,
  orbStageSize,
} = useFavoritesVisuals({
  filteredFavorites,
})

const lockedNetworkFacetKey = computed(() => {
  if (!visualFacet.value) return null
  return `${visualFacet.value.type}:${visualFacet.value.value}`.toLowerCase()
})

const {
  networkCanvasRef,
  networkTagNodes,
  networkWallpaperNodes,
  networkEdges,
  networkMeta,
  focusFacetKey,
  networkReady,
  setHoverFacet,
  clearHoverFacet,
  handleNetworkPointerMove,
  resetNetworkPointer,
  markNetworkReady,
} = useFavoritesNetwork({
  sourceFavorites: browseFavorites,
  lockedFacetKey: lockedNetworkFacetKey,
})

const { orbStageRef, handleOrbPointerMove, resetOrbPointer } = useFavoritesOrbStage()

watch(
  () => viewMode.value,
  (mode) => {
    if (mode === 'network') markNetworkReady()
  },
  { immediate: true },
)

const viewModes = FAVORITES_VIEW_MODES
const gridViews = FAVORITES_GRID_VIEWS
const qualityOptions = [
  { key: 'medium', label: '中等画质', shortLabel: '中', icon: 'bi-badge-sd' },
  { key: 'high', label: '高清画质', shortLabel: '高', icon: 'bi-badge-hd' },
  { key: 'original', label: '原图画质', shortLabel: '原', icon: 'bi-badge-4k' },
]

const waterfallQualityOptions = qualityOptions.filter((item) => item.key !== 'medium')
const searchLayout = computed(() => runtimeConfigStore.getPageLayout('search') || {})
const previewLayout = computed(() => searchLayout.value.preview || {})
const cardActionsLayout = computed(() => ({ enabled: false, toolbar: { enabled: false }, hide: { enabled: false } }))

function isLayoutEnabled(section, key = '') {
  const source = key ? section?.[key] : section
  return source?.enabled !== false
}

const canDownloadFavorites = computed(
  () =>
    runtimeConfigStore.canUse('download') &&
    isLayoutEnabled(searchLayout.value.bottomDock || {}, 'download'),
)
const previewEnabledActions = computed(() => ({
  favorite: isLayoutEnabled(previewLayout.value, 'favorite'),
  mockup: isLayoutEnabled(previewLayout.value, 'mockup'),
  rotate: isLayoutEnabled(previewLayout.value, 'rotate'),
  fit: isLayoutEnabled(previewLayout.value, 'fit'),
  info: isLayoutEnabled(previewLayout.value, 'info'),
  compare: isLayoutEnabled(previewLayout.value, 'compare'),
  crop: isLayoutEnabled(previewLayout.value, 'crop'),
  decompose: isLayoutEnabled(previewLayout.value, 'decompose'),
  filters: isLayoutEnabled(previewLayout.value, 'filters'),
  ai: isLayoutEnabled(previewLayout.value, 'ai'),
  download: canDownloadFavorites.value && isLayoutEnabled(previewLayout.value, 'download'),
  fullscreen: isLayoutEnabled(previewLayout.value, 'fullscreen'),
}))

const activeGrid = computed(() => {
  return gridViews.find((item) => item.key === gridVariant.value) || gridViews[0]
})

const activeQuality = computed(() => {
  const options = waterfallLayout.value ? waterfallQualityOptions : qualityOptions
  return options.find((item) => item.key === favoriteImageQuality.value) || options[0]
})

const selectedFavoriteIdSet = computed(
  () => new Set(selectedFavoriteIds.value.map((id) => String(id))),
)

const selectedFavorites = computed(() =>
  filteredFavorites.value.filter((item) => selectedFavoriteIdSet.value.has(String(item.id))),
)

const selectedCount = computed(() => selectedFavorites.value.length)
const previewInListContext = computed(
  () => previewIndex.value >= 0 && filteredFavorites.value.length > 1,
)

const allVisibleSelected = computed(
  () =>
    filteredFavorites.value.length > 0 &&
    filteredFavorites.value.every((item) => selectedFavoriteIdSet.value.has(String(item.id))),
)

const selectedCollectionTargets = computed(() => {
  const selectedIds = new Set(selectedFavorites.value.map((item) => String(item.id)))
  return favoritesStore.collections
    .map((collection) => {
      const selectedInCollection = selectedFavorites.value.filter((item) => {
        return Array.isArray(item.collections) && item.collections.includes(collection.id)
      }).length
      return {
        ...collection,
        selectedInCollection,
        selectedMissingCount: Math.max(selectedIds.size - selectedInCollection, 0),
      }
    })
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
})

const featuredFavorites = computed(() => filteredFavorites.value.slice(0, 4))

function toggleFavoriteSelection(wallpaperOrId) {
  if (!selectionMode.value) return

  const id = String(
    typeof wallpaperOrId === 'object' ? wallpaperOrId?.id || '' : wallpaperOrId || '',
  )
  if (!id) return

  if (selectedFavoriteIdSet.value.has(id)) {
    selectedFavoriteIds.value = selectedFavoriteIds.value.filter((item) => String(item) !== id)
    return
  }

  selectedFavoriteIds.value = [...selectedFavoriteIds.value, id]
}

function previewImage(wallpaper) {
  const index = filteredFavorites.value.findIndex((item) => String(item?.id) === String(wallpaper?.id))
  previewIndex.value = index
  openPreviewImage(index >= 0 ? filteredFavorites.value[index] : wallpaper)
}

function closePreview() {
  previewIndex.value = -1
  closePreviewBase()
}

function setPreviewByIndex(index) {
  const list = filteredFavorites.value
  if (!list.length) return

  const nextIndex = (index + list.length) % list.length
  previewIndex.value = nextIndex
  openPreviewImage(list[nextIndex])
}

function onPreviewNext() {
  setPreviewByIndex(previewIndex.value + 1)
}

function onPreviewPrevious() {
  setPreviewByIndex(previewIndex.value - 1)
}

function toggleSelectVisible() {
  if (selectionMode.value) {
    clearSelection()
    return
  }

  selectionMode.value = true
}

function toggleSelectAllVisible() {
  if (!selectionMode.value) {
    selectionMode.value = true
  }

  if (allVisibleSelected.value) {
    const visibleIds = new Set(filteredFavorites.value.map((item) => String(item.id)))
    selectedFavoriteIds.value = selectedFavoriteIds.value.filter(
      (id) => !visibleIds.has(String(id)),
    )
    return
  }

  selectedFavoriteIds.value = [
    ...new Set([
      ...selectedFavoriteIds.value.map((id) => String(id)),
      ...filteredFavorites.value.map((item) => String(item.id)),
    ]),
  ]
}

function clearSelection() {
  selectedFavoriteIds.value = []
  selectionMode.value = false
}

function openSelectedDownloadModal() {
  if (!canDownloadFavorites.value) {
    notificationService.warning('下载功能暂未开放')
    return
  }
  if (selectionMode.value && selectedCount.value === 0) {
    notificationService.warning('请先选择要下载的收藏壁纸')
    return
  }

  downloadScope.value = selectionMode.value ? 'selected' : 'filtered'
  downloadFavorites()
}

function removeSelectedFavorites() {
  if (selectedCount.value === 0) {
    notificationService.warning('请先选择要移除的收藏壁纸')
    return
  }

  if (!confirm(`确定要移除选中的 ${selectedCount.value} 张收藏吗？`)) return

  let removed = 0
  for (const item of selectedFavorites.value) {
    if (favoritesStore.removeFavorite(item.id)) removed += 1
  }

  clearSelection()
  notificationService.success(`已移除 ${removed} 张收藏`)
}

function addSelectedToCollection(collection) {
  if (selectedCount.value === 0) {
    notificationService.warning('请先选择要加入合集的收藏壁纸')
    return
  }

  let added = 0
  for (const item of selectedFavorites.value) {
    const result = favoritesStore.addToCollection(item.id, collection.id)
    if (result.success && result.message !== '壁纸已在该收藏集合中') {
      added += 1
    }
  }

  if (added > 0) {
    notificationService.success(`已加入「${collection.name}」${added} 张`)
  } else {
    notificationService.info(`所选壁纸已在「${collection.name}」中`)
  }
}

function removeSelectedFromCurrentCollection() {
  const collection = favoritesStore.selectedCollection
  if (!collection || selectedCount.value === 0) return

  let removed = 0
  for (const item of selectedFavorites.value) {
    const result = favoritesStore.removeFromCollection(item.id, collection.id)
    if (result.success) removed += 1
  }

  clearSelection()
  notificationService.success(`已从「${collection.name}」移出 ${removed} 张`)
}

function toggleWaterfallLayout() {
  waterfallLayout.value = !waterfallLayout.value
  if (waterfallLayout.value && favoriteImageQuality.value === 'medium') {
    favoriteImageQuality.value = 'high'
  }
  viewMode.value = 'grid'
}

function cycleFavoriteImageQuality() {
  const options = waterfallLayout.value ? waterfallQualityOptions : qualityOptions
  const index = options.findIndex((item) => item.key === favoriteImageQuality.value)
  const next = options[(index + 1) % options.length] || options[0]
  favoriteImageQuality.value = next.key
}

watch(filteredFavorites, (items) => {
  const visibleIds = new Set(items.map((item) => String(item.id)))
  selectedFavoriteIds.value = selectedFavoriteIds.value.filter((id) => visibleIds.has(String(id)))
  if (selectedFavoriteIds.value.length === 0) {
    selectionMode.value = false
  }
})

watch(waterfallLayout, (value) => {
  setScopedLocalItem(FAVORITES_WATERFALL_STORAGE_KEY, String(value))
})

watch(favoriteImageQuality, (value) => {
  setScopedLocalItem(FAVORITES_QUALITY_STORAGE_KEY, value)
})

useFavoritesPageMotion({
  pageRef: pageRoot,
  ready: pageReady,
})

onBeforeMount(() => {
  document.documentElement.classList.add('favorites-gallery-page')
  void favoritesStore.initFavorites()
})

onMounted(async () => {
  await nextTick()
  pageReady.value = true
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('favorites-gallery-page')
})

</script>

<template>
  <div ref="pageRoot" class="favorites-container" :class="{ 'is-ready': pageReady }">
    <div
      class="favorites-layout"
      :class="{
        'sidebar-collapsed': !showSidebar,
      }"
    >
      <!-- 侧边栏：panel / rail 同挂载，靠宽度与交叉淡入平滑收起 -->
      <aside class="favorites-sidebar" :class="{ collapsed: !showSidebar }" data-fav-motion>
        <div class="favorites-sidebar-shell">
          <div
            class="favorites-sidebar-panel"
            :aria-hidden="!showSidebar"
            :inert="!showSidebar || undefined"
          >
            <CollectionList
              :collections="favoritesStore.collections"
              :selectedCollection="favoritesStore.selectedCollection"
              :showCollapseButton="true"
              @select="selectCollection"
              @edit="openEditCollectionModal"
              @delete="deleteCollection"
              @create="openCreateCollectionModal"
              @toggle-collapse="toggleSidebar"
            />
          </div>

          <div
            class="favorites-sidebar-rail"
            :aria-hidden="showSidebar"
            :inert="showSidebar || undefined"
          >
            <button
              class="rail-button expand"
              type="button"
              title="展开侧边栏"
              @click="toggleSidebar"
            >
              <i class="bi bi-layout-sidebar-inset"></i>
            </button>

            <div class="rail-scroll" aria-label="收藏合集快捷切换">
              <button
                class="rail-button"
                :class="{ active: !favoritesStore.selectedCollection }"
                type="button"
                :title="`全部收藏（${favoritesStore.favoritesCount} 项）`"
                @click="favoritesStore.clearSelectedCollection()"
              >
                <i class="bi bi-grid-1x2"></i>
              </button>

              <button
                v-for="collection in railCollections"
                :key="collection.id"
                class="rail-button"
                :class="{ active: favoritesStore.selectedCollection?.id === collection.id }"
                type="button"
                :title="`${collection.name}（${getRailCollectionCount(collection)} 项）`"
                @click="selectCollection(collection)"
              >
                <i class="bi" :class="`bi-${collection.icon || 'folder'}`"></i>
              </button>
            </div>

            <button
              class="rail-button create"
              type="button"
              title="创建集合"
              @click="openCreateCollectionModal"
            >
              <i class="bi bi-plus-lg"></i>
            </button>
          </div>
        </div>
      </aside>

      <!-- 主内容区 -->
      <div class="favorites-main">
        <section class="favorites-hero" data-fav-motion>
          <div class="favorites-hero-copy">
            <div class="favorites-context">
              <button
                class="mobile-sidebar-toggle d-md-none"
                @click="toggleSidebar"
                title="切换侧边栏"
              >
                <i class="bi bi-list"></i>
              </button>

              <div class="favorites-title-icon">
                <i class="bi" :class="currentCollectionIcon"></i>
              </div>

              <div class="favorites-heading">
                <h1 class="favorites-title">{{ currentCollectionName }}</h1>
              </div>
            </div>
          </div>

          <div
            v-if="featuredFavorites.length"
            class="favorites-cover-strip"
            aria-label="收藏预览"
          >
            <button
              v-for="(item, index) in featuredFavorites"
              :key="item.id"
              type="button"
              class="favorite-cover-thumb"
              data-fav-cover
              :title="getWallpaperLabel(item)"
              @click="previewImage(item)"
            >
              <ShareProgressiveImage
                :src="getWallpaperCoverUrl(item)"
                :alt="getWallpaperLabel(item)"
                :eager="index < 2"
              />
            </button>
          </div>
        </section>

        <section class="favorites-toolbar" data-fav-motion>
          <div class="favorites-search-box search-box">
            <i class="bi bi-search"></i>
            <input
              type="text"
              class="form-control"
              placeholder="搜索收藏、标签或分辨率"
              v-model="searchQuery"
            />
            <button
              v-if="searchQuery"
              class="search-clear"
              type="button"
              title="清除搜索"
              @click="clearSearch"
            >
              <i class="bi bi-x-lg"></i>
            </button>
          </div>

          <div class="favorites-actions">
            <div
              class="view-mode-group"
              role="tablist"
              aria-label="收藏视图"
            >
              <button
                v-for="mode in viewModes"
                :key="mode.key"
                class="view-mode-button"
                type="button"
                role="tab"
                :aria-selected="viewMode === mode.key"
                :class="{ active: viewMode === mode.key }"
                :title="mode.label"
                @click="setViewMode(mode.key)"
              >
                <i class="bi" :class="mode.icon"></i>
              </button>
            </div>

            <button
              v-if="viewMode === 'grid'"
              class="favorite-action-button icon-only"
              type="button"
              :class="{ active: waterfallLayout }"
              :title="waterfallLayout ? '关闭瀑布流' : '开启瀑布流'"
              @click="toggleWaterfallLayout"
            >
              <i class="bi bi-water"></i>
              <span>{{ waterfallLayout ? '瀑布流' : '网格流' }}</span>
            </button>

            <div
              v-if="viewMode === 'grid'"
              class="dropdown grid-view-picker"
            >
              <button
                class="favorite-action-button grid-trigger dropdown-toggle"
                type="button"
                data-bs-toggle="dropdown"
                :title="`网格：${activeGrid.label}`"
              >
                <i class="bi" :class="activeGrid.icon"></i>
                <span>{{ activeGrid.shortLabel }}</span>
              </button>
              <ul class="dropdown-menu dropdown-menu-end grid-mode-menu">
                <li v-for="grid in gridViews" :key="grid.key">
                  <button
                    class="dropdown-item"
                    type="button"
                    :class="{ active: gridVariant === grid.key }"
                    @click="setGridVariant(grid.key)"
                  >
                    <i class="bi" :class="grid.icon"></i>
                    <span>{{ grid.label }}</span>
                    <small>{{ grid.columns }}列</small>
                  </button>
                </li>
              </ul>
            </div>

            <button
              v-if="viewMode === 'grid'"
              class="favorite-action-button quality-trigger"
              type="button"
              :title="`图片画质：${activeQuality.label}`"
              @click="cycleFavoriteImageQuality"
            >
              <i class="bi" :class="activeQuality.icon"></i>
              <span>{{ activeQuality.shortLabel }}</span>
            </button>

            <div class="dropdown">
              <button
                class="favorite-action-button sort-trigger dropdown-toggle"
                type="button"
                data-bs-toggle="dropdown"
                :title="`排序：${sortLabel}`"
              >
                <i class="bi bi-sort-down"></i>
                <span>{{ sortLabel }}</span>
              </button>
              <ul class="dropdown-menu dropdown-menu-end favorites-sort-menu">
                <li>
                  <a
                    class="dropdown-item"
                    href="#"
                    @click.prevent="changeSorting('date')"
                    :class="{ active: sortBy === 'date' }"
                  >
                    <i class="bi bi-calendar"></i> 收藏日期
                    <i
                      v-if="sortBy === 'date'"
                      class="bi float-end"
                      :class="sortOrder === 'asc' ? 'bi-sort-up' : 'bi-sort-down'"
                    ></i>
                  </a>
                </li>
                <li>
                  <a
                    class="dropdown-item"
                    href="#"
                    @click.prevent="changeSorting('name')"
                    :class="{ active: sortBy === 'name' }"
                  >
                    <i class="bi bi-sort-alpha-down"></i> ID
                    <i
                      v-if="sortBy === 'name'"
                      class="bi float-end"
                      :class="sortOrder === 'asc' ? 'bi-sort-up' : 'bi-sort-down'"
                    ></i>
                  </a>
                </li>
                <li>
                  <a
                    class="dropdown-item"
                    href="#"
                    @click.prevent="changeSorting('resolution')"
                    :class="{ active: sortBy === 'resolution' }"
                  >
                    <i class="bi bi-aspect-ratio"></i> 分辨率
                    <i
                      v-if="sortBy === 'resolution'"
                      class="bi float-end"
                      :class="sortOrder === 'asc' ? 'bi-sort-up' : 'bi-sort-down'"
                    ></i>
                  </a>
                </li>
              </ul>
            </div>

            <button
              v-if="canDownloadFavorites"
              class="favorite-action-button download"
              @click="openSelectedDownloadModal"
              :disabled="selectionMode ? selectedCount === 0 : favoritesCount === 0"
              :title="selectionMode ? '下载所选' : '下载当前结果'"
            >
              <i class="bi bi-download"></i>
              <span>{{ selectionMode ? '下载所选' : '下载' }}</span>
            </button>

            <button
              type="button"
              class="favorite-action-button selection-trigger"
              :class="{ active: selectionMode }"
              @click="toggleSelectVisible"
            >
              <i class="bi" :class="selectionMode ? 'bi-x-lg' : 'bi-check2-square'"></i>
              <span>{{ selectionMode ? '退出选择' : '选择' }}</span>
            </button>
          </div>

          <div
            v-if="selectionMode || selectedCount > 0"
            class="bulk-selection-strip"
          >
            <div class="bulk-status">
              <i class="bi bi-check2-square"></i>
              <span>已选择 {{ selectedCount }} / {{ filteredFavorites.length }}</span>
            </div>
            <div class="bulk-actions">
              <button
                type="button"
                class="bulk-button"
                :disabled="filteredFavorites.length === 0"
                @click="toggleSelectAllVisible"
              >
                <i class="bi" :class="allVisibleSelected ? 'bi-dash-square' : 'bi-check2-all'"></i>
                <span>{{ allVisibleSelected ? '取消全选' : '全选' }}</span>
              </button>
              <div class="dropdown bulk-dropdown">
                <button
                  type="button"
                  class="bulk-button"
                  data-bs-toggle="dropdown"
                  :disabled="selectedCount === 0 || favoritesStore.collectionsCount === 0"
                >
                  <i class="bi bi-folder-plus"></i>
                  <span>加入合集</span>
                </button>
                <ul class="dropdown-menu dropdown-menu-end bulk-collection-menu">
                  <li v-for="collection in selectedCollectionTargets" :key="collection.id">
                    <button
                      class="dropdown-item"
                      type="button"
                      :disabled="collection.selectedMissingCount === 0"
                      @click="addSelectedToCollection(collection)"
                    >
                      <i class="bi" :class="`bi-${collection.icon || 'folder'}`"></i>
                      <span>{{ collection.name }}</span>
                      <small>
                        {{
                          collection.selectedMissingCount === 0
                            ? '已包含'
                            : `可加入 ${collection.selectedMissingCount}`
                        }}
                      </small>
                    </button>
                  </li>
                </ul>
              </div>
              <button
                v-if="favoritesStore.selectedCollection"
                type="button"
                class="bulk-button warning"
                :disabled="selectedCount === 0"
                @click="removeSelectedFromCurrentCollection"
              >
                <i class="bi bi-folder-x"></i>
                <span>移出当前合集</span>
              </button>
              <button
                v-if="runtimeConfigStore.canUse('favorite')"
                type="button"
                class="bulk-button danger"
                :disabled="selectedCount === 0"
                @click="removeSelectedFavorites"
              >
                <i class="bi bi-trash3"></i>
                <span>移除所选</span>
              </button>
              <button
                type="button"
                class="bulk-button subtle"
                @click="clearSelection"
              >
                <i class="bi bi-x-lg"></i>
                <span>退出选择</span>
              </button>
            </div>
          </div>

          <div class="favorites-filter-strip">
            <div class="quick-filter-group" aria-label="收藏快速筛选">
              <button
                v-for="filter in quickFilters"
                :key="filter.key"
                class="quick-filter-chip"
                type="button"
                :class="{ active: quickFilter === filter.key }"
                @click="setQuickFilter(filter.key)"
              >
                <i class="bi" :class="filter.icon"></i>
                <span>{{ filter.label }}</span>
                <strong>{{ filter.count }}</strong>
              </button>
            </div>

            <div class="favorites-result-meta">
              <span>{{ resultSummary }}</span>
              <button v-if="visualFacet" type="button" @click="clearVisualFacet">清除维度</button>
              <button
                v-if="quickFilter !== 'all' || searchQuery"
                type="button"
                @click="resetFilters"
              >
                重置
              </button>
            </div>
          </div>
        </section>

        <!-- 收藏内容 -->
        <div ref="favoritesContentRef" class="favorites-content">
          <!-- 无收藏提示 -->
          <div class="empty-favorites-state" v-if="favoritesCount === 0">
            <div class="empty-visual">
              <i class="bi" :class="emptyState.icon"></i>
            </div>
            <h2>{{ emptyState.title }}</h2>
            <p>{{ emptyState.text }}</p>
            <div class="empty-actions">
              <router-link
                v-if="!favoritesStore.selectedCollection"
                to="/search"
                class="theme-button"
              >
                <i class="bi bi-search"></i>
                <span>浏览壁纸</span>
              </router-link>
              <button
                v-if="favoritesStore.selectedCollection && favoritesStore.favoritesCount > 0"
                class="ghost-action"
                @click="favoritesStore.clearSelectedCollection()"
              >
                <i class="bi bi-arrow-left"></i>
                <span>返回全部收藏</span>
              </button>
            </div>
          </div>

          <!-- 无搜索结果提示 -->
          <div class="empty-favorites-state" v-else-if="filteredFavorites.length === 0">
            <div class="empty-visual">
              <i class="bi" :class="emptyState.icon"></i>
            </div>
            <h2>{{ emptyState.title }}</h2>
            <p>{{ emptyState.text }}</p>
            <button class="theme-button" @click="handleEmptyAction">
              <i class="bi bi-x-circle"></i>
              <span>{{ emptyState.action }}</span>
            </button>
          </div>

          <!-- 网格视图 -->
          <WallpaperGrid
            v-else-if="viewMode === 'grid'"
            :wallpapers="filteredFavorites"
            :loading="false"
            :error="null"
            :infiniteScroll="false"
            :gridColumns="activeGrid.columns"
            :waterfallLayout="waterfallLayout"
            :waterfallQuality="favoriteImageQuality"
            :imageQuality="favoriteImageQuality"
            :ratioMode="activeGrid.ratioMode"
            :showTags="activeGrid.showTags"
            :showUploader="activeGrid.showUploader"
            :selectionMode="selectionMode"
            :selectedIds="selectedFavoriteIds"
            :cardActions="cardActionsLayout"
            :scrollRoot="favoritesContentRef"
            :progressiveMount="true"
            :waterfallInitialRenderCount="24"
            :waterfallPreloadPx="1100"
            revealStyle="soft"
            revealStrength="medium"
            @preview="previewImage"
            @toggle-select="toggleFavoriteSelection"
          />

          <!-- 关系网：左侧维度图 + 右侧壁纸格 -->
          <div
            v-else-if="viewMode === 'network'"
            class="network-view"
            :class="{ 'is-ready': networkReady, 'is-focused': Boolean(focusFacetKey) }"
          >
            <div v-if="!networkMeta.totalItems" class="network-empty">
              <i class="bi bi-diagram-3"></i>
              <p>当前没有可展示的收藏</p>
            </div>

            <div v-else class="network-board">
              <div class="network-diagram-slot">
                <section
                  ref="networkCanvasRef"
                  class="network-diagram"
                  :class="{ 'is-focused': Boolean(focusFacetKey) }"
                  aria-label="收藏维度图"
                  @pointermove="handleNetworkPointerMove"
                  @pointerleave="resetNetworkPointer"
                >
                <svg
                  class="network-lines"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line
                    v-for="edge in networkEdges"
                    :key="edge.id"
                    class="network-edge"
                    :class="{
                      'is-hot': focusFacetKey && edge.facetKey === focusFacetKey,
                      'is-dim': focusFacetKey && edge.facetKey !== focusFacetKey,
                    }"
                    :x1="edge.x1"
                    :y1="edge.y1"
                    :x2="edge.x2"
                    :y2="edge.y2"
                  />
                </svg>

                <button
                  v-for="tag in networkTagNodes"
                  :key="tag.key"
                  class="network-tag-node"
                  :class="{
                    active:
                      visualFacet &&
                      `${visualFacet.type}:${visualFacet.value}`.toLowerCase() === tag.key,
                    'is-hot': focusFacetKey === tag.key,
                    'is-dim': focusFacetKey && focusFacetKey !== tag.key,
                  }"
                  type="button"
                  :style="{
                    '--x': `${tag.x}%`,
                    '--y': `${tag.y}%`,
                    '--i': tag.index,
                  }"
                  :title="`${tag.typeLabel}：${tag.label}，${tag.count} 张`"
                  @mouseenter="setHoverFacet(tag.key)"
                  @mouseleave="clearHoverFacet"
                  @focus="setHoverFacet(tag.key)"
                  @blur="clearHoverFacet"
                  @click="setVisualFacet({ type: tag.type, value: tag.value })"
                >
                  <i class="bi" :class="tag.icon"></i>
                  <span class="network-tag-copy">
                    <small>{{ tag.typeLabel }}</small>
                    <em>{{ tag.label }}</em>
                  </span>
                  <strong>{{ tag.count }}</strong>
                </button>

                <div class="network-center-node" aria-hidden="true">
                  <i class="bi bi-diagram-3"></i>
                  <strong>{{ networkMeta.totalItems }}</strong>
                  <span>收藏</span>
                </div>
              </section>
              </div>

              <section class="network-panel" aria-label="关联壁纸">
                <header class="network-panel-head">
                  <div>
                    <strong>{{ networkMeta.focusLabel }}</strong>
                    <span>{{ networkMeta.panelTotal }} 张</span>
                  </div>
                  <button
                    v-if="visualFacet"
                    type="button"
                    class="network-panel-clear"
                    @click="clearVisualFacet"
                  >
                    清除筛选
                  </button>
                </header>

                <div v-if="networkWallpaperNodes.length" class="network-panel-grid">
                  <button
                    v-for="node in networkWallpaperNodes"
                    :key="node.item.id"
                    class="network-panel-card"
                    type="button"
                    :style="{ '--i': node.index }"
                    :title="getWallpaperLabel(node.item)"
                    @click="previewImage(node.item)"
                  >
                    <ShareProgressiveImage
                      :src="getWallpaperCoverUrl(node.item)"
                      :alt="getWallpaperLabel(node.item)"
                      :eager="node.index < 8"
                    />
                  </button>
                </div>

                <div v-else class="network-panel-empty">
                  <p>这个维度下暂时没有壁纸</p>
                </div>

                <p v-if="networkMeta.panelHidden > 0" class="network-overflow">
                  另有 {{ networkMeta.panelHidden }} 张未展示，可切回网格浏览全部
                </p>
              </section>
            </div>
          </div>

          <!-- 动态球球视图 -->
          <div
            v-else-if="viewMode === 'orbs'"
            class="orb-view"
            :style="{ '--orb-stage-size': `${orbStageSize}px` }"
          >
            <div
              ref="orbStageRef"
              class="orb-stage"
              @pointermove="handleOrbPointerMove"
              @pointerleave="resetOrbPointer"
            >
              <button
                v-for="orb in orbWallpapers"
                :key="orb.item.id"
                class="image-orb"
                type="button"
                :style="{
                  '--orb-tx': orb.tx,
                  '--orb-ty': orb.ty,
                  '--orb-size': `${orb.size}px`,
                  '--float-x': orb.floatX,
                  '--float-y': orb.floatY,
                  '--float-back-x': orb.floatBackX,
                  '--float-back-y': orb.floatBackY,
                  '--collision-x': orb.collisionX,
                  '--collision-y': orb.collisionY,
                  '--orb-delay': orb.delay,
                  '--orb-duration': orb.duration,
                }"
                :title="getWallpaperLabel(orb.item)"
                @click="previewImage(orb.item)"
              >
                <span class="orb-body">
                  <img :src="getWallpaperImageUrl(orb.item)" :alt="getWallpaperLabel(orb.item)" />
                  <span class="orb-label">
                    <strong>{{ getWallpaperLabel(orb.item) }}</strong>
                    <small>{{ getWallpaperSummary(orb.item) || '收藏壁纸' }}</small>
                  </span>
                </span>
              </button>
            </div>
          </div>

          <!-- 统计视图 -->
          <FavoritesStatsView
            v-else-if="viewMode === 'stats'"
            :favorites-store="favoritesStore"
            :filtered-favorites="filteredFavorites"
            :scoped-favorites="scopedFavorites"
          />
        </div>
      </div>
    </div>

    <!-- 壁纸预览 -->
    <WallpaperPreview
      :wallpaper="previewWallpaper"
      :show="showPreview"
      :enabledActions="previewEnabledActions"
      :in-collection="previewInListContext"
      :collection-index="previewIndex >= 0 ? previewIndex : 0"
      :collection-total="filteredFavorites.length"
      @close="closePreview"
      @next="onPreviewNext"
      @previous="onPreviewPrevious"
    />

    <!-- 集合模态框 -->
    <CollectionModal
      :show="showCollectionModal"
      :collection="editingCollection"
      :isEdit="isEditingCollection"
      @close="closeCollectionModal"
      @save="saveCollection"
    />
  </div>
</template>

<style scoped src="../features/favorites/styles/favorites-view.css"></style>
