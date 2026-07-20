import { computed, ref } from 'vue'
import notificationService from '@/services/notification'
import { proxyWallhavenImageUrl, wallpaperApi } from '@/services/api'
import { warmDownloadThumbs } from '@/features/downloads/composables/useDownloadThumbCache'
import { randomWallhavenSeed } from '@/utils/wallhaven'

const SEARCH_RESULTS_CACHE_KEY = 'walleven_search_results_cache_v1'
const SEARCH_RESULTS_CACHE_TTL_MS = 5 * 60 * 1000
const SEARCH_RESULTS_CACHE_MAX_ITEMS = 96

/** 超小(8列)预取 3 页，小图标(6列)预取 2 页，其余仍 1 页 */
export function getDensePrefetchPageCount(columns) {
  const n = Number(columns)
  if (n === 8) return 3
  if (n === 6) return 2
  return 1
}

function collectSearchThumbUrls(images = []) {
  const urls = []
  for (const image of images) {
    const thumbs = image?.thumbs || {}
    const raw =
      thumbs.small ||
      thumbs.large ||
      thumbs.original ||
      image?.thumbnail ||
      image?.thumbs?.original ||
      ''
    if (!raw || typeof raw !== 'string') continue
    const proxied =
      raw.startsWith('http') || raw.includes('wallhaven.cc') ? proxyWallhavenImageUrl(raw) : raw
    if (proxied) urls.push(proxied)
  }
  return urls
}

export function useSearchRequests({
  searchParams,
  addSearchHistory,
  scrollAfterResultsLoad,
  scrollResultsIntoView,
}) {
  const wallpapers = ref([])
  const isLoading = ref(false)
  const hasSearched = ref(false)
  const loadMoreInFlight = ref(false)
  const error = ref('')
  const totalPages = ref(1)
  const totalResults = ref(0)
  const wallhavenCooldown = ref(null)
  const lastWallhavenStatus = ref(null)

  const hasMorePages = computed(() => searchParams.value.page < totalPages.value)
  const gridHasMorePages = computed(() => hasMorePages.value && !wallhavenCooldown.value)

  const aggregateTags = computed(() => {
    const map = new Map()
    for (const wallpaper of wallpapers.value) {
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

  const aggregateColors = computed(() => {
    const map = new Map()

    for (const wallpaper of wallpapers.value) {
      const colors = Array.isArray(wallpaper.colors) ? wallpaper.colors : []
      for (const color of colors) {
        const hex = String(color || '')
          .replace(/^#/, '')
          .toLowerCase()
        if (!/^[0-9a-f]{6}$/.test(hex)) continue
        map.set(hex, (map.get(hex) || 0) + 1)
      }
    }

    return [...map.entries()]
      .map(([hex, count]) => ({ hex, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 14)
  })

  let searchDebounceTimer = null
  let cooldownTimer = null
  let cooldownUntil = 0
  let wallhavenRateLimitLoadMoreToastShown = false
  let lastSearchToastKey = ''
  let lastSearchToastAt = 0
  let lastSearchSignature = ''
  let displayedSearchSignature = ''
  let prefetchTimer = null
  let prefetchAbortController = null
  const searchAbortController = ref(null)
  const prefetchCache = ref(null)

  function buildCurrentSearchSignature(loadMore = false) {
    return JSON.stringify({
      ...searchParams.value,
      loadMore,
    })
  }

  function readCachedSearchResults() {
    if (typeof sessionStorage === 'undefined') return null

    try {
      const raw = sessionStorage.getItem(SEARCH_RESULTS_CACHE_KEY)
      if (!raw) return null
      const cached = JSON.parse(raw)
      if (!cached || typeof cached !== 'object') return null
      if (cached.signature !== buildCurrentSearchSignature(false)) return null
      if (Date.now() - Number(cached.savedAt || 0) > SEARCH_RESULTS_CACHE_TTL_MS) return null
      if (!Array.isArray(cached.wallpapers) || cached.wallpapers.length === 0) return null
      return cached
    } catch {
      return null
    }
  }

  function writeCachedSearchResults() {
    if (typeof sessionStorage === 'undefined') return
    if (!Array.isArray(wallpapers.value) || wallpapers.value.length === 0) return

    try {
      sessionStorage.setItem(
        SEARCH_RESULTS_CACHE_KEY,
        JSON.stringify({
          signature: buildCurrentSearchSignature(false),
          savedAt: Date.now(),
          wallpapers: wallpapers.value.slice(0, SEARCH_RESULTS_CACHE_MAX_ITEMS),
          totalPages: totalPages.value,
          totalResults: totalResults.value,
        }),
      )
    } catch {
      /* ignore cache write failures */
    }
  }

  function restoreCachedSearchResults() {
    const cached = readCachedSearchResults()
    if (!cached) return false

    wallpapers.value = cached.wallpapers
    totalPages.value = Number(cached.totalPages) || 1
    totalResults.value = Number(cached.totalResults) || cached.wallpapers.length
    hasSearched.value = true
    error.value = ''
    displayedSearchSignature = buildCurrentSearchSignature(false)
    warmDownloadThumbs(collectSearchThumbUrls(cached.wallpapers), 36)
    return true
  }

  function invalidateSearchSignature() {
    lastSearchSignature = ''
  }

  function showSearchToast(type, message, options = {}) {
    const now = Date.now()
    const key = `${type}|${String(message || '').trim()}`
    if (key === lastSearchToastKey && now - lastSearchToastAt < 12000) {
      return
    }
    lastSearchToastKey = key
    lastSearchToastAt = now
    notificationService[type](message, {
      dedupeKey: `search:${key}`,
      dedupeWindow: 12000,
      ...options,
    })
  }

  function buildPrefetchBaseSig() {
    const { page: _page, ...rest } = searchParams.value
    return JSON.stringify(rest)
  }

  function clearPrefetchState() {
    if (prefetchTimer != null) {
      clearTimeout(prefetchTimer)
      prefetchTimer = null
    }
    prefetchAbortController?.abort()
    prefetchAbortController = null
    prefetchCache.value = null
  }

  function schedulePrefetchNextPage() {
    if (prefetchTimer != null) {
      clearTimeout(prefetchTimer)
      prefetchTimer = null
    }

    prefetchTimer = window.setTimeout(() => {
      prefetchTimer = null
      const baseSig = buildPrefetchBaseSig()
      const nextPage = searchParams.value.page + 1
      if (nextPage > totalPages.value) return
      if (
        prefetchCache.value?.baseSig === baseSig &&
        prefetchCache.value?.targetPage === nextPage
      ) {
        return
      }

      const run = () => {
        void executePrefetchNextPage(baseSig, nextPage)
      }

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 2800 })
      } else {
        window.setTimeout(run, 450)
      }
    }, 280)
  }

  async function executePrefetchNextPage(expectedBaseSig, expectedNextPage) {
    if (wallhavenCooldown.value) return

    prefetchAbortController?.abort()
    prefetchAbortController = new AbortController()
    const signal = prefetchAbortController.signal

    if (buildPrefetchBaseSig() !== expectedBaseSig) return
    if (searchParams.value.page + 1 !== expectedNextPage) return

    try {
      const response = await wallpaperApi.search(
        {
          ...searchParams.value,
          page: expectedNextPage,
          items_per_page: 24,
        },
        { signal },
      )

      if (response.aborted) return

      if (buildPrefetchBaseSig() !== expectedBaseSig) return
      if (searchParams.value.page + 1 !== expectedNextPage) return

      if (response.success && response.images?.length) {
        prefetchCache.value = { baseSig: expectedBaseSig, targetPage: expectedNextPage, response }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('预取下一页失败:', err)
    }
  }

  function applySuccessfulSearchResponse(response, loadMore) {
    if (response.warning) {
      console.warn('Wallhaven API 警告:', response)
      notificationService.warning(response.warning, {
        duration: 5000,
        position: 'top-right',
      })
    }

    if (searchParams.value.sorting === 'random' && response.meta?.seed) {
      searchParams.value.seed = String(response.meta.seed)
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 16)
    }

    wallpapers.value = loadMore ? [...wallpapers.value, ...response.images] : response.images

    const warmBatch = Array.isArray(response.images) ? response.images : []
    warmDownloadThumbs(collectSearchThumbUrls(warmBatch), loadMore ? 24 : 36)

    if (!loadMore && scrollAfterResultsLoad.value) {
      scrollAfterResultsLoad.value = false
      scrollResultsIntoView()
    }

    if (response.meta) {
      totalPages.value = response.meta.last_page || 1
      totalResults.value = response.meta.total || 0
    } else {
      totalPages.value = 1
      totalResults.value = response.images.length
    }

    if (!loadMore) {
      displayedSearchSignature = buildCurrentSearchSignature(false)
      writeCachedSearchResults()
    }
  }

  async function searchWallpapers(loadMore = false, opts = {}) {
    if (isLoading.value && loadMore) {
      searchParams.value.page = Math.max(1, searchParams.value.page - 1)
      return
    }

    const searchSignature = buildCurrentSearchSignature(loadMore)
    if (!loadMore && searchSignature === lastSearchSignature) {
      return
    }

    if (!loadMore) {
      hasSearched.value = true
    }

    if (!loadMore) {
      lastSearchSignature = searchSignature
      if (searchAbortController.value) {
        searchAbortController.value.abort()
      }
      searchAbortController.value = new AbortController()
    }

    const signal = searchAbortController.value?.signal

    if (opts.force) {
      clearPrefetchState()
    }

    const baseSig = buildPrefetchBaseSig()
    const targetPage = searchParams.value.page

    if (
      !opts.force &&
      prefetchCache.value &&
      prefetchCache.value.baseSig === baseSig &&
      prefetchCache.value.targetPage === targetPage
    ) {
      const cached = prefetchCache.value.response
      clearPrefetchState()
      const usable =
        !cached.aborted &&
        cached.success &&
        Array.isArray(cached.images) &&
        cached.images.length > 0
      if (usable) {
        isLoading.value = true
        try {
          lastWallhavenStatus.value = null
          if (!loadMore) {
            error.value = ''
            const mergedForHistory = searchParams.value.query.trim()
            if (mergedForHistory.trim() !== '') {
              addSearchHistory(mergedForHistory)
            }
          }
          applySuccessfulSearchResponse(cached, loadMore)
          schedulePrefetchNextPage()
        } finally {
          isLoading.value = false
        }
        return
      }
    }

    clearPrefetchState()
    isLoading.value = true

    if (!loadMore) {
      error.value = ''
      lastWallhavenStatus.value = null
      if (wallpapers.value.length === 0) {
        restoreCachedSearchResults()
      } else if (displayedSearchSignature !== searchSignature) {
        wallpapers.value = []
      }

      const mergedForHistory = searchParams.value.query.trim()
      if (mergedForHistory.trim() !== '') {
        addSearchHistory(mergedForHistory)
      }
    }

    try {
      if (searchParams.value.sorting === 'random' && !searchParams.value.seed) {
        searchParams.value.seed = randomWallhavenSeed()
      }

      const response = await wallpaperApi.search(
        {
          ...searchParams.value,
          items_per_page: 24,
          ...(opts.force ? { force: true, _force: true } : {}),
        },
        { signal },
      )

      if (response.aborted) return

      if (response.success && response.images) {
        lastWallhavenStatus.value = null
        setWallhavenCooldownFromResponse(null)
        applySuccessfulSearchResponse(response, loadMore)
        schedulePrefetchNextPage()
      } else {
        if (loadMore) {
          searchParams.value.page = Math.max(1, searchParams.value.page - 1)
        }

        lastWallhavenStatus.value = response.wallhaven_status ?? null
        setWallhavenCooldownFromResponse(response)
        const quietLoadMore = loadMore && response.cooldown

        if (quietLoadMore) {
          error.value = ''
          if (!wallhavenRateLimitLoadMoreToastShown) {
            wallhavenRateLimitLoadMoreToastShown = true
            showSearchToast(
              'warning',
              response.error || 'Wallhaven 上游正在冷却，已暂停自动加载更多；请稍候再试。',
              { duration: 9000, position: 'top-right' },
            )
          }
        } else {
          console.warn('Wallhaven API 返回错误:', response)
          error.value = response.error || '搜索壁纸失败'
          if (!response.cooldown) {
            showSearchToast('error', error.value, {
              duration: 6000,
              position: 'top-right',
            })
          }
        }
      }
    } catch (err) {
      console.error('搜索壁纸失败:', err)
      error.value = '搜索壁纸失败'
    } finally {
      isLoading.value = false
    }
  }

  function loadMore() {
    if (loadMoreInFlight.value || isLoading.value || !hasMorePages.value) {
      return Promise.resolve(false)
    }
    if (wallhavenCooldown.value) return Promise.resolve(false)

    if (searchParams.value.sorting === 'random' && !searchParams.value.seed) {
      searchParams.value.seed = randomWallhavenSeed()
    }

    loadMoreInFlight.value = true
    searchParams.value.page += 1
    return (async () => {
      try {
        await searchWallpapers(true)
        return true
      } finally {
        loadMoreInFlight.value = false
      }
    })()
  }

  let densePrefetchToken = 0

  /**
   * 按网格密度补足起始页数：8 列 → 3 页，6 列 → 2 页。
   * 已达到目标页或没有更多结果时直接返回。
   */
  async function ensureDenseGridPages(columns) {
    const targetPages = getDensePrefetchPageCount(columns)
    if (targetPages <= 1) return
    if (!hasSearched.value) return

    const token = ++densePrefetchToken
    while (
      token === densePrefetchToken &&
      searchParams.value.page < targetPages &&
      hasMorePages.value &&
      !wallhavenCooldown.value
    ) {
      const loaded = await loadMore()
      if (!loaded) break
    }
  }

  function debounceSearch(onApplyFilters) {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
    }

    searchDebounceTimer = setTimeout(() => {
      if (
        searchParams.value.query.trim() !== '' ||
        searchParams.value.categories !== '111' ||
        searchParams.value.purity !== '100'
      ) {
        onApplyFilters?.()
      }
    }, 500)
  }

  function retryWallhavenSearch() {
    invalidateSearchSignature()
    return searchWallpapers(false, { force: true })
  }

  function startCooldownPolling() {
    cooldownTimer = window.setInterval(() => {
      tickWallhavenCooldown()
    }, 500)
  }

  function setWallhavenCooldownFromResponse(response) {
    const cooldown = normalizeCooldownResponse(response?.cooldown)
    if (!cooldown) {
      if (response?.wallhaven_status !== 429) {
        wallhavenCooldown.value = null
        cooldownUntil = 0
      }
      return
    }
    cooldownUntil = cooldown.untilMs
    wallhavenCooldown.value = {
      remainingSeconds: cooldown.remainingSeconds,
      wallhaven_status: response.wallhaven_status ?? 429,
      reason: cooldown.reason,
      until: cooldown.until,
    }
  }

  function tickWallhavenCooldown() {
    if (!cooldownUntil) return
    const remainingMs = cooldownUntil - Date.now()
    if (remainingMs <= 0) {
      cooldownUntil = 0
      wallhavenCooldown.value = null
      wallhavenRateLimitLoadMoreToastShown = false
      return
    }
    wallhavenCooldown.value = {
      ...(wallhavenCooldown.value || {}),
      remainingSeconds: Math.ceil(remainingMs / 1000),
    }
  }

  function normalizeCooldownResponse(value) {
    if (!value || typeof value !== 'object') return null
    const until = String(value.until || '').trim()
    const parsedUntil = Date.parse(until)
    const remainingSeconds = Number(value.remainingSeconds || 0)
    const untilMs = Number.isFinite(parsedUntil)
      ? parsedUntil
      : Date.now() + Math.max(1, remainingSeconds) * 1000
    const remaining = Math.max(0, Math.ceil((untilMs - Date.now()) / 1000))
    if (!remaining) return null
    return {
      until,
      untilMs,
      remainingSeconds: remaining,
      reason: String(value.reason || ''),
    }
  }

  function cleanupSearchRequests() {
    densePrefetchToken += 1
    searchAbortController.value?.abort()
    clearPrefetchState()
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
    if (cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }

  return {
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
    aggregateTags,
    aggregateColors,
    searchWallpapers,
    loadMore,
    ensureDenseGridPages,
    debounceSearch,
    retryWallhavenSearch,
    invalidateSearchSignature,
    restoreCachedSearchResults,
    startCooldownPolling,
    cleanupSearchRequests,
  }
}
