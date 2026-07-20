import { ref, watch } from 'vue'
import { randomWallhavenSeed } from '@/utils/wallhaven'

const ROUTE_QUERY_FILTER_KEYS = new Set(['resolution', 'ratios', 'color'])
const ROUTE_QUERY_FILTER_ALL = '_all'

function pickQueryFilterField(query, key, settingsFallback) {
  if (!query || !Object.prototype.hasOwnProperty.call(query, key)) {
    return settingsFallback != null && settingsFallback !== undefined
      ? String(settingsFallback)
      : ''
  }

  const value = query[key]
  if (value === undefined || value === null) return ''

  const raw = Array.isArray(value) ? String(value[0] ?? '') : String(value)
  if (raw === ROUTE_QUERY_FILTER_ALL) return ''
  return raw
}

export function useSearchRouteState({ route, settingsStore }) {
  function normalizeCategories(value) {
    const raw = String(value || '')
    return /^[01]{3}$/.test(raw) ? raw : '111'
  }

  function normalizePurity(value) {
    const raw = String(value || '')
    return /^[01]{3}$/.test(raw) ? raw : '100'
  }

  function normalizeTopRange(value) {
    const raw = String(value || '')
    return ['1d', '3d', '1w', '1M', '3M', '6M', '1y'].includes(raw) ? raw : '1M'
  }

  const searchParams = ref({
    query: '',
    categories: '111',
    purity: '100',
    sorting: 'relevance',
    order: 'desc',
    resolution: '',
    ratios: '',
    color: '',
    topRange: '1M',
    page: 1,
    seed: '',
  })

  const jumpToPage = ref('')

  function createDefaultSearchParams(overrides = {}) {
    return {
      query: '',
      categories: normalizeCategories(settingsStore.settings.search_default_categories || '111'),
      purity: normalizePurity(settingsStore.settings.search_default_purity || '100'),
      sorting: settingsStore.settings.default_sorting || 'favorites',
      order: settingsStore.settings.default_order || 'desc',
      resolution: settingsStore.settings.default_resolution || '',
      ratios: settingsStore.settings.default_ratio || '',
      color: settingsStore.settings.default_color || '',
      topRange: normalizeTopRange(settingsStore.settings.search_default_top_range || '1M'),
      page: 1,
      seed: '',
      ...overrides,
    }
  }

  function toRouteQuery() {
    const params = { ...searchParams.value }

    if (params.sorting !== 'random') {
      delete params.seed
    } else if (!params.seed) {
      params.seed = randomWallhavenSeed()
    }

    const query = {}
    Object.keys(params).forEach((key) => {
      const value = params[key]
      if (ROUTE_QUERY_FILTER_KEYS.has(key)) {
        if (value === undefined || value === null || value === '') {
          query[key] = ROUTE_QUERY_FILTER_ALL
          return
        }
        query[key] = value
        return
      }

      if (value === undefined || value === null || value === '') return
      query[key] = value
    })

    query._sb = String(Date.now())
    return query
  }

  function updateSearchParamsFromQuery() {
    const query = route.query
    const rawSeed = typeof query.seed === 'string' ? query.seed : ''
    const cleanSeed = rawSeed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)

    searchParams.value = createDefaultSearchParams({
      query: query.query || '',
      categories: normalizeCategories(
        query.categories || settingsStore.settings.search_default_categories || '111',
      ),
      purity: normalizePurity(
        query.purity || settingsStore.settings.search_default_purity || '100',
      ),
      sorting: query.sorting || settingsStore.settings.default_sorting || 'favorites',
      order: query.order || settingsStore.settings.default_order || 'desc',
      resolution: pickQueryFilterField(
        query,
        'resolution',
        settingsStore.settings.default_resolution,
      ),
      ratios: pickQueryFilterField(query, 'ratios', settingsStore.settings.default_ratio),
      color: pickQueryFilterField(query, 'color', settingsStore.settings.default_color),
      topRange: normalizeTopRange(
        query.topRange || settingsStore.settings.search_default_top_range,
      ),
      page: Number.parseInt(query.page, 10) || 1,
      seed: cleanSeed,
    })
  }

  watch(
    () => searchParams.value.page,
    (newPage) => {
      if (jumpToPage.value === '' || Number(jumpToPage.value) !== newPage) {
        jumpToPage.value = String(newPage)
      }
    },
  )

  return {
    searchParams,
    jumpToPage,
    createDefaultSearchParams,
    toRouteQuery,
    updateSearchParamsFromQuery,
  }
}
