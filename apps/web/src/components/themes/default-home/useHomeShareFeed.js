import { computed, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue'
import { getShareOverview } from '@/services/shareGallery'
import storageService from '@/services/storage'

const HOME_SHARE_CACHE_KEY = 'home_share_overview_cache'
const HOME_SHARE_CACHE_TTL_MS = 10 * 60 * 1000

function readShareCache() {
  const payload = storageService.get(HOME_SHARE_CACHE_KEY, null)
  if (!payload || typeof payload !== 'object' || !payload.overview) return null
  if (Date.now() - (Number(payload.updatedAt) || 0) > HOME_SHARE_CACHE_TTL_MS) return null
  return payload.overview
}

function writeShareCache(overview) {
  storageService.set(HOME_SHARE_CACHE_KEY, {
    overview,
    updatedAt: Date.now(),
  })
}

function normalizeOverview(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    stats: {
      works: Number(raw.stats?.works || 0),
      creators: Number(raw.stats?.creators || 0),
      favorites: Number(raw.stats?.favorites || 0),
      comments: Number(raw.stats?.comments || 0),
    },
    featured: Array.isArray(raw.featured) ? raw.featured.slice(0, 5) : [],
    popular: Array.isArray(raw.popular) ? raw.popular.slice(0, 5) : [],
    trendingTags: Array.isArray(raw.trendingTags) ? raw.trendingTags.slice(0, 8) : [],
    creators: Array.isArray(raw.creators) ? raw.creators.slice(0, 6) : [],
  }
}

/**
 * 首页使用的 Share 社区概览：缓存优先（10 分钟），后台静默刷新。
 */
export function useHomeShareFeed(options = {}) {
  const overview = ref(null)
  const loading = ref(false)
  const error = ref('')
  let active = true
  let realtimeRefreshTimer = null
  const isEnabled = () => unref(options.enabled) !== false

  const shareStats = computed(() => overview.value?.stats || null)
  const shareFeatured = computed(() => overview.value?.featured || [])
  const sharePopular = computed(() => overview.value?.popular || [])
  const shareTrendingTags = computed(() => overview.value?.trendingTags || [])

  async function refresh() {
    if (loading.value || !isEnabled()) return
    loading.value = true
    error.value = ''
    try {
      const data = normalizeOverview(await getShareOverview())
      if (!active || !data) return
      overview.value = data
      writeShareCache(data)
    } catch (refreshError) {
      console.warn('首页社区概览读取失败', refreshError)
      if (active) {
        const message = refreshError?.message || '社区展厅暂时无法连接'
        overview.value = overview.value || null
        // 有缓存内容时保留内容，只把错误作为非阻塞状态暴露给页面。
        error.value = message
      }
    } finally {
      loading.value = false
    }
  }

  function handleShareUpdated() {
    window.clearTimeout(realtimeRefreshTimer)
    realtimeRefreshTimer = window.setTimeout(() => void refresh(), 320)
  }

  onMounted(() => {
    active = true
    const cached = normalizeOverview(readShareCache())
    if (cached) overview.value = cached
    if (isEnabled()) void refresh()
    window.addEventListener('walleven:share-updated', handleShareUpdated)
  })

  watch(
    () => isEnabled(),
    (enabled) => {
      if (active && enabled && !overview.value) void refresh()
    },
  )

  onBeforeUnmount(() => {
    active = false
    window.clearTimeout(realtimeRefreshTimer)
    window.removeEventListener('walleven:share-updated', handleShareUpdated)
  })

  return {
    shareOverview: overview,
    shareLoading: loading,
    shareError: error,
    shareStats,
    shareFeatured,
    sharePopular,
    shareTrendingTags,
    refreshShareOverview: refresh,
  }
}
