import { computed } from 'vue'
import {
  doesFavoriteMatchFacet,
  getFacetDisplayValue,
  getFacetMeta,
} from '@/features/favorites/utils/favoriteFacets'

function parseResolution(resolution) {
  if (!resolution || typeof resolution !== 'string') {
    return { width: 0, height: 0, pixels: 0 }
  }

  const match = resolution.match(/(\d+)\s*x\s*(\d+)/i)
  if (!match) {
    return { width: 0, height: 0, pixels: 0 }
  }

  const width = Number(match[1])
  const height = Number(match[2])
  return { width, height, pixels: width * height }
}

export function useFavoritesFilters({
  favoritesStore,
  searchQuery,
  sortBy,
  sortOrder,
  quickFilter,
  visualFacet,
}) {
  function isUncategorized(item) {
    return !Array.isArray(item.collections) || item.collections.length === 0
  }

  function matchesQuickFilter(item, filter) {
    if (filter === 'all') return true
    if (filter === 'uncategorized') return isUncategorized(item)

    const { width, height, pixels } = parseResolution(item.resolution)
    if (filter === 'landscape') return width > 0 && height > 0 && width >= height
    if (filter === 'portrait') return width > 0 && height > 0 && width < height
    if (filter === 'highres') return width >= 3840 || pixels >= 3840 * 2160

    return true
  }

  const scopedFavorites = computed(() => {
    return favoritesStore.selectedCollection
      ? [...favoritesStore.collectionFavorites]
      : [...favoritesStore.favorites]
  })

  const searchedFavorites = computed(() => {
    let result = [...scopedFavorites.value]

    if (searchQuery.value.trim()) {
      const query = searchQuery.value.trim().toLowerCase()
      result = result.filter((item) => {
        if (item.id && item.id.toLowerCase().includes(query)) return true
        if (item.resolution && item.resolution.toLowerCase().includes(query)) return true
        if (
          item.tags &&
          item.tags.some((tag) =>
            typeof tag === 'string'
              ? tag.toLowerCase().includes(query)
              : tag.name && tag.name.toLowerCase().includes(query),
          )
        ) {
          return true
        }
        if (item.uploader && item.uploader.toLowerCase().includes(query)) return true
        if (item.category && item.category.toLowerCase().includes(query)) return true
        if (item.purity && item.purity.toLowerCase().includes(query)) return true
        return false
      })
    }

    return result
  })

  function sortFavorites(list) {
    const result = [...list]
    result.sort((a, b) => {
      if (sortBy.value === 'date') {
        const dateA = new Date(a.favorited_at || 0)
        const dateB = new Date(b.favorited_at || 0)
        return sortOrder.value === 'asc' ? dateA - dateB : dateB - dateA
      }

      if (sortBy.value === 'name') {
        const nameA = a.id || ''
        const nameB = b.id || ''
        return sortOrder.value === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA)
      }

      if (sortBy.value === 'resolution') {
        const resA = parseResolution(a.resolution).pixels
        const resB = parseResolution(b.resolution).pixels
        return sortOrder.value === 'asc' ? resA - resB : resB - resA
      }

      return 0
    })
    return result
  }

  /** 搜索 + 快捷筛选（不含维度），供关系网保持完整维度图 */
  const browseFavorites = computed(() => {
    const result = searchedFavorites.value.filter((item) =>
      matchesQuickFilter(item, quickFilter.value),
    )
    return sortFavorites(result)
  })

  const filteredFavorites = computed(() => {
    const result = browseFavorites.value.filter((item) =>
      doesFavoriteMatchFacet(item, visualFacet.value),
    )
    return result
  })

  const quickFilters = computed(() => {
    const source = searchedFavorites.value
    const count = (filter) => source.filter((item) => matchesQuickFilter(item, filter)).length

    return [
      { key: 'all', label: '全部', icon: 'bi-grid-3x3-gap', count: source.length },
      { key: 'uncategorized', label: '未归类', icon: 'bi-inboxes', count: count('uncategorized') },
      { key: 'landscape', label: '横图', icon: 'bi-display', count: count('landscape') },
      { key: 'portrait', label: '竖图', icon: 'bi-phone', count: count('portrait') },
      { key: 'highres', label: '4K+', icon: 'bi-badge-4k', count: count('highres') },
    ]
  })

  const sortLabel = computed(() => {
    const labels = { date: '收藏日期', name: '壁纸 ID', resolution: '分辨率' }
    return labels[sortBy.value] || '排序'
  })

  const resultSummary = computed(() => {
    const total = searchedFavorites.value.length
    const visible = filteredFavorites.value.length
    if (visualFacet.value?.type) {
      const meta = getFacetMeta(visualFacet.value.type)
      const label = getFacetDisplayValue(visualFacet.value.type, visualFacet.value.value)
      return `${meta.label}「${label}」 · ${visible} / ${total}`
    }
    if (quickFilter.value !== 'all' || searchQuery.value.trim()) {
      return `显示 ${visible} / ${total}`
    }
    return `${visible} 张壁纸`
  })

  const emptyState = computed(() => {
    if (searchQuery.value.trim()) {
      return {
        icon: 'bi-search',
        title: '没有匹配的收藏',
        text: `当前关键词：“${searchQuery.value.trim()}”`,
        action: '清除搜索',
      }
    }

    if (visualFacet.value?.type) {
      const meta = getFacetMeta(visualFacet.value.type)
      const label = getFacetDisplayValue(visualFacet.value.type, visualFacet.value.value)
      return {
        icon: meta.icon,
        title: '这个维度没有可显示的收藏',
        text: `${meta.label}「${label}」当前没有匹配的壁纸。`,
        action: '清除维度筛选',
      }
    }

    if (quickFilter.value !== 'all') {
      const current = quickFilters.value.find((item) => item.key === quickFilter.value)
      return {
        icon: current?.icon || 'bi-funnel',
        title: '当前筛选没有结果',
        text: `“${current?.label || '筛选'}”下暂时没有收藏壁纸。`,
        action: '显示全部',
      }
    }

    if (favoritesStore.selectedCollection) {
      return {
        icon: 'bi-folder',
        title: '这个集合还没有壁纸',
        text: '回到全部收藏，或把喜欢的壁纸拖进这个集合。',
        action: '返回全部收藏',
      }
    }

    return {
      icon: 'bi-heart',
      title: '收藏夹还很安静',
      text: '去浏览壁纸，把喜欢的作品点进收藏。',
      action: '浏览壁纸',
    }
  })

  return {
    scopedFavorites,
    searchedFavorites,
    browseFavorites,
    filteredFavorites,
    quickFilters,
    sortLabel,
    resultSummary,
    emptyState,
    isUncategorized,
  }
}
