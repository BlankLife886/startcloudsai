import { computed } from 'vue'
import { getFacetDisplayValue } from '@/features/favorites/utils/favoriteFacets'

function parseResolution(resolution) {
  if (!resolution || typeof resolution !== 'string') {
    return { width: 0, height: 0, pixels: 0 }
  }
  const match = resolution.match(/(\d+)\s*x\s*(\d+)/i)
  if (!match) return { width: 0, height: 0, pixels: 0 }
  const width = Number(match[1])
  const height = Number(match[2])
  return { width, height, pixels: width * height }
}

function buildCounts(items, getter, { limit = 8, fallback = '未知' } = {}) {
  const counter = new Map()
  items.forEach((item) => {
    const raw = getter(item)
    const key = raw || fallback
    counter.set(key, (counter.get(key) || 0) + 1)
  })
  return Array.from(counter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/**
 * 收藏统计视图数据：KPI + 图表序列
 */
export function useFavoritesStatsData({
  favoritesStore,
  filteredFavorites,
  scopedFavorites,
}) {
  const totalVisible = computed(() => filteredFavorites.value.length)

  const categorySeries = computed(() => {
    return buildCounts(
      filteredFavorites.value,
      (item) => getFacetDisplayValue('category', item.category) || '未分类',
      { limit: 8, fallback: '未分类' },
    )
  })

  const resolutionSeries = computed(() => {
    return buildCounts(
      filteredFavorites.value,
      (item) => item.resolution,
      { limit: 8, fallback: '未知分辨率' },
    )
  })

  const puritySeries = computed(() => {
    return buildCounts(
      filteredFavorites.value,
      (item) => getFacetDisplayValue('purity', item.purity) || '未知',
      { limit: 6, fallback: '未知' },
    )
  })

  const orientationSeries = computed(() => {
    let landscape = 0
    let portrait = 0
    let square = 0
    let unknown = 0

    filteredFavorites.value.forEach((item) => {
      const { width, height } = parseResolution(item.resolution)
      if (!width || !height) {
        unknown += 1
        return
      }
      if (width === height) square += 1
      else if (width > height) landscape += 1
      else portrait += 1
    })

    return [
      { name: '横图', count: landscape },
      { name: '竖图', count: portrait },
      { name: '方形', count: square },
      { name: '未知', count: unknown },
    ].filter((item) => item.count > 0)
  })

  const uploaderSeries = computed(() => {
    return buildCounts(
      filteredFavorites.value,
      (item) => item.uploader || item.user?.username,
      { limit: 8, fallback: '未知作者' },
    )
  })

  const collectionSeries = computed(() => {
    const counter = new Map()
    const collections = favoritesStore.collections || []
    collections.forEach((collection) => {
      counter.set(collection.name || '未命名', 0)
    })

    scopedFavorites.value.forEach((item) => {
      const ids = Array.isArray(item.collections) ? item.collections : []
      if (!ids.length) {
        counter.set('未归类', (counter.get('未归类') || 0) + 1)
        return
      }
      ids.forEach((id) => {
        const collection = collections.find((entry) => entry.id === id)
        const name = collection?.name || '未知合集'
        counter.set(name, (counter.get(name) || 0) + 1)
      })
    })

    return Array.from(counter.entries())
      .map(([name, count]) => ({ name, count }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  })

  const hasChartData = computed(() => totalVisible.value > 0)

  return {
    categorySeries,
    resolutionSeries,
    puritySeries,
    orientationSeries,
    uploaderSeries,
    collectionSeries,
    hasChartData,
    totalVisible,
  }
}
