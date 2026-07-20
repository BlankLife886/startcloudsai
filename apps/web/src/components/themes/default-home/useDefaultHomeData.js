import { proxyWallhavenImageUrl, wallpaperApi } from '@/services/api'
import { fetchHomeBootstrap } from '@/services/homeBootstrap'
import storageService from '@/services/storage'
import { useSettingsStore } from '@/stores/settings'
import { randomWallhavenSeed } from '@/utils/wallhaven'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const HOME_WALLPAPER_LIMIT = 12
const HOME_CACHE_TTL_MS = 30 * 60 * 1000
const HOME_RESOLUTION_OPTIONS = ['', '3840x2160', '2560x1440', '1920x1080', '1366x768', '1280x720']
const HOME_COLOR_OPTIONS = [
  '',
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
]
const HOME_RATIO_OPTIONS = [
  '',
  '16x9',
  '16x10',
  '21x9',
  '32x9',
  '48x9',
  '9x16',
  '10x16',
  '19x9',
  '19x10',
  '20x9',
  '1x1',
]
const HOME_MOBILE_RATIO_OPTIONS = ['', '9x16,10x16', '9x16', '10x16', '19x9', '19x10', '20x9']
const HOME_SEARCH_DEFAULTS = {
  hero: {
    categories: '111',
    purity: '100',
    sorting: 'favorites',
    resolution: '3840x2160',
    color: '',
    ratios: '16x9',
    quality: 'small',
    query: '',
  },
  video: {
    categories: '111',
    purity: '100',
    sorting: 'favorites',
    resolution: '3840x2160',
    color: '66cccc',
    ratios: '16x9',
    quality: 'original',
    query: '',
  },
  mobile: {
    categories: '011',
    purity: '100',
    sorting: 'favorites',
    resolution: '',
    color: '',
    ratios: '9x16,10x16',
    quality: 'original',
    query: '',
  },
  desktop: {
    categories: '100',
    purity: '100',
    sorting: 'favorites',
    resolution: '3840x2160',
    color: '',
    ratios: '16x9',
    quality: 'original',
    query: '',
  },
  latest: {
    categories: '111',
    purity: '100',
    resolution: '',
    color: '',
    ratios: '',
    quality: 'original',
    query: '',
  },
  random: {
    categories: '111',
    purity: '100',
    sorting: 'random',
    resolution: '',
    color: '',
    ratios: '',
    quality: 'original',
    similarId: '',
  },
}

const HOME_SETTING_DEFAULTS = {
  home_hero_categories: HOME_SEARCH_DEFAULTS.hero.categories,
  home_hero_purity: HOME_SEARCH_DEFAULTS.hero.purity,
  home_hero_sorting: HOME_SEARCH_DEFAULTS.hero.sorting,
  home_hero_resolution: HOME_SEARCH_DEFAULTS.hero.resolution,
  home_hero_color: HOME_SEARCH_DEFAULTS.hero.color,
  home_hero_query: HOME_SEARCH_DEFAULTS.hero.query,
  home_video_categories: HOME_SEARCH_DEFAULTS.video.categories,
  home_video_purity: HOME_SEARCH_DEFAULTS.video.purity,
  home_video_sorting: HOME_SEARCH_DEFAULTS.video.sorting,
  home_video_resolution: HOME_SEARCH_DEFAULTS.video.resolution,
  home_video_color: HOME_SEARCH_DEFAULTS.video.color,
  home_video_query: HOME_SEARCH_DEFAULTS.video.query,
  home_video_image_quality: HOME_SEARCH_DEFAULTS.video.quality,
  home_mobile_categories: HOME_SEARCH_DEFAULTS.mobile.categories,
  home_mobile_purity: HOME_SEARCH_DEFAULTS.mobile.purity,
  home_mobile_sorting: HOME_SEARCH_DEFAULTS.mobile.sorting,
  home_mobile_resolution: HOME_SEARCH_DEFAULTS.mobile.resolution,
  home_mobile_color: HOME_SEARCH_DEFAULTS.mobile.color,
  home_mobile_ratios: HOME_SEARCH_DEFAULTS.mobile.ratios,
  home_mobile_query: HOME_SEARCH_DEFAULTS.mobile.query,
  home_mobile_image_quality: HOME_SEARCH_DEFAULTS.mobile.quality,
  home_desktop_categories: HOME_SEARCH_DEFAULTS.desktop.categories,
  home_desktop_purity: HOME_SEARCH_DEFAULTS.desktop.purity,
  home_desktop_sorting: HOME_SEARCH_DEFAULTS.desktop.sorting,
  home_desktop_resolution: HOME_SEARCH_DEFAULTS.desktop.resolution,
  home_desktop_color: HOME_SEARCH_DEFAULTS.desktop.color,
  home_desktop_query: HOME_SEARCH_DEFAULTS.desktop.query,
  home_desktop_image_quality: HOME_SEARCH_DEFAULTS.desktop.quality,
  home_latest_categories: HOME_SEARCH_DEFAULTS.latest.categories,
  home_latest_purity: HOME_SEARCH_DEFAULTS.latest.purity,
  home_latest_ratios: HOME_SEARCH_DEFAULTS.latest.ratios,
  home_latest_resolution: HOME_SEARCH_DEFAULTS.latest.resolution,
  home_latest_color: HOME_SEARCH_DEFAULTS.latest.color,
  home_latest_query: HOME_SEARCH_DEFAULTS.latest.query,
  home_latest_image_quality: HOME_SEARCH_DEFAULTS.latest.quality,
  home_random_categories: HOME_SEARCH_DEFAULTS.random.categories,
  home_random_purity: HOME_SEARCH_DEFAULTS.random.purity,
  home_random_sorting: HOME_SEARCH_DEFAULTS.random.sorting,
  home_random_ratios: HOME_SEARCH_DEFAULTS.random.ratios,
  home_random_resolution: HOME_SEARCH_DEFAULTS.random.resolution,
  home_random_color: HOME_SEARCH_DEFAULTS.random.color,
  home_random_similar_id: HOME_SEARCH_DEFAULTS.random.similarId,
  home_random_image_quality: HOME_SEARCH_DEFAULTS.random.quality,
  home_mobile_tags:
    'All=\nPortrait=portrait\nGirl=girl\nAnime=anime\nBlue=blue\nHatsune Miku=hatsune miku',
}

const CACHE_KEYS = {
  hero: 'home_hero_simple_background_cache',
  mobileTop: 'home_mobile_top_cache',
  desktopTop: 'home_desktop_favorites_4k_cache',
  randomSeed: 'home_random_seed_cache',
  latest: 'home_latest_cache',
  favoriteRank: 'home_favorite_rank_cache',
}
const HOME_RANDOM_SEED_STATE_KEY = 'home_random_seed_state'

const HOME_TAGS_DEFAULT = [
  { label: 'Portrait', query: 'portrait' },
  { label: 'Hatsune Miku', query: 'hatsune miku' },
  { label: 'Demon Slayer', query: 'demon slayer' },
  { label: 'Attack on Titan', query: 'attack on titan' },
  { label: 'Evangelion', query: 'evangelion' },
  { label: 'All', query: '' },
]

function normalizeImages(response) {
  if (response?.success && Array.isArray(response.images)) {
    return response.images.slice(0, HOME_WALLPAPER_LIMIT)
  }

  return []
}

function toCachedWallpaper(wallpaper) {
  if (!wallpaper?.id) return null

  const original = wallpaper?.thumbs?.original || ''
  const small = wallpaper?.thumbs?.small || ''
  const rawThumbs = wallpaper?.raw_thumbs || {}
  const rawPath = wallpaper?.raw_path || wallpaper?.path || wallpaper?.url || ''
  const rawThumbnail = wallpaper?.raw_thumbnail || wallpaper?.thumbnail || ''
  if (
    !original &&
    !small &&
    !rawPath &&
    !rawThumbnail &&
    !rawThumbs.original &&
    !rawThumbs.small &&
    !rawThumbs.large
  ) {
    return null
  }

  return {
    id: wallpaper.id,
    resolution: wallpaper.resolution || '',
    favorites: wallpaper.favorites || 0,
    views: wallpaper.views || 0,
    raw_path: rawPath,
    path: wallpaper?.path || '',
    url: wallpaper?.url || '',
    raw_thumbnail: rawThumbnail,
    raw_thumbs: rawThumbs,
    thumbs: {
      original,
      small,
    },
    tags: Array.isArray(wallpaper.tags)
      ? wallpaper.tags.slice(0, 4).map((tag) => {
          if (typeof tag === 'object' && tag) {
            return { name: tag.name || '' }
          }
          return tag
        })
      : [],
  }
}

function readSectionCache(key) {
  const payload = storageService.get(key, null)
  if (!payload || !Array.isArray(payload.items)) return null

  const items = payload.items
    .filter(
      (item) =>
        item?.id &&
        (item?.thumbs?.original ||
          item?.thumbs?.small ||
          item?.raw_path ||
          item?.raw_thumbnail ||
          item?.raw_thumbs?.original ||
          item?.raw_thumbs?.small ||
          item?.raw_thumbs?.large),
    )
    .slice(0, HOME_WALLPAPER_LIMIT)
  if (!items.length) return null

  return {
    items,
    updatedAt: Number(payload.updatedAt) || 0,
    seed: typeof payload.seed === 'string' ? payload.seed : '',
  }
}

function writeSectionCache(key, wallpapers, extra = {}) {
  const items = wallpapers.map(toCachedWallpaper).filter(Boolean).slice(0, HOME_WALLPAPER_LIMIT)
  if (!items.length) return

  storageService.set(key, {
    items,
    updatedAt: Date.now(),
    ...extra,
  })
}

function isCacheFresh(entry) {
  return !!entry?.items?.length && Date.now() - entry.updatedAt < HOME_CACHE_TTL_MS
}

function writeHomeRandomSeed(seed) {
  storageService.set(HOME_RANDOM_SEED_STATE_KEY, {
    seed,
    updatedAt: Date.now(),
  })
}

function readHomeRandomSeed() {
  const payload = storageService.get(HOME_RANDOM_SEED_STATE_KEY, null)
  const seed = typeof payload?.seed === 'string' ? payload.seed.trim() : ''
  const updatedAt = Number(payload?.updatedAt) || 0
  if (seed && Date.now() - updatedAt < HOME_CACHE_TTL_MS) {
    return seed
  }

  const nextSeed = randomWallhavenSeed()
  writeHomeRandomSeed(nextSeed)
  return nextSeed
}

function normalizeCacheToken(value) {
  const source =
    String(value || 'all')
      .trim()
      .toLowerCase() || 'all'
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const readable = source
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28)
  return `${readable || 'value'}_${(hash >>> 0).toString(36)}`
}

function homeSectionCacheKey(baseKey, queryValue, qualityValue, seedValue = '') {
  return [
    baseKey,
    normalizeCacheToken(queryValue),
    normalizeCacheToken(qualityValue),
    normalizeCacheToken(seedValue),
  ]
    .filter(Boolean)
    .join('_')
}

function homeConfigFingerprint(parts) {
  return JSON.stringify(parts)
}

function uniqueHomeRequests(requests) {
  const seen = new Set()
  return requests.filter((request) => {
    const key = JSON.stringify(request)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sanitizeHomeCategories(value, fallback = '111') {
  const text = String(value || '').trim()
  return /^[01]{3}$/.test(text) ? text : fallback
}

function sanitizeHomePurity(value, fallback = '100') {
  const text = String(value || '').trim()
  return ['100', '110', '111'].includes(text) ? text : fallback
}

function sanitizeHomeSorting(value, fallback = 'favorites') {
  const text = String(value || '').trim()
  return ['relevance', 'date_added', 'views', 'favorites', 'toplist', 'random'].includes(text)
    ? text
    : fallback
}

function sanitizeHomeQuality(value, fallback = 'original', allowSmall = false) {
  const allowed = allowSmall ? ['small', 'original', 'full'] : ['original', 'full']
  const text = String(value || '').trim()
  return allowed.includes(text) ? text : fallback
}

function sanitizeHomeText(value, fallback = '') {
  const text = String(value || '').trim()
  return text || fallback
}

function parseHomeSimilarIds(value) {
  return String(value || '')
    .split(/[\s,，;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function pickHomeSimilarId(value) {
  const ids = parseHomeSimilarIds(value)
  if (!ids.length) return ''
  return ids[Math.floor(Math.random() * ids.length)]
}

function sanitizeHomeOption(value, allowed, fallback = '') {
  const text = String(value || '').trim()
  return allowed.includes(text) ? text : fallback
}

function buildHomeSearchRequest(config) {
  const request = {
    categories: config.categories,
    purity: config.purity,
    sorting: config.sorting,
    order: 'desc',
    q: config.query || undefined,
    ratios: config.ratios || undefined,
    resolution: config.resolution || undefined,
    color: config.color || undefined,
    page: 1,
    per_page: 24,
  }

  const similarId = pickHomeSimilarId(config.similarId)
  if (similarId) {
    request.q = `like:${similarId}`
  }

  return request
}

export function useDefaultHomeData(options = {}) {
  const settingsStore = useSettingsStore()
  const abortControllers = new Set()
  let isHomeActive = true
  let mobileTopRequestVersion = 0
  let mobileTopSignal = null
  const isSectionEnabled = (key) => options.isSectionEnabled?.(key) !== false
  const publicHomeConfig = ref({})
  const publicPopularSearches = ref([])
  const heroWallpapers = ref([])
  const mobileTopWallpapers = ref([])
  const desktopTopWallpapers = ref([])
  const randomSeedWallpapers = ref([])
  const latestWallpapers = ref([])
  const favoriteRankWallpapers = ref([])
  const mobileTopTag = ref('')

  const isLoadingHero = ref(false)
  const isLoadingMobileTop = ref(false)
  const isLoadingDesktopTop = ref(false)
  const isLoadingRandomSeed = ref(false)
  const isLoadingLatest = ref(false)
  const isLoadingFavoriteRank = ref(false)

  const heroError = ref('')
  const mobileTopError = ref('')
  const desktopTopError = ref('')
  const randomSeedError = ref('')
  const latestError = ref('')
  const favoriteRankError = ref('')
  const homeDataInitialized = ref(false)

  const randomSeed = ref(readHomeRandomSeed())
  const homeQuickSearches = computed(() =>
    normalizeHomeQuickSearches(
      publicPopularSearches.value.length
        ? publicPopularSearches.value
        : publicHomeConfig.value.quickSearches,
    ),
  )
  const homeHeroPlaceholder = computed(() =>
    sanitizeHomeText(publicHomeConfig.value.heroPlaceholder, '搜索壁纸标签、风格、分辨率或创作者'),
  )
  const homeMobileTags = computed(() => parseHomeTags(getHomeSetting('home_mobile_tags', '')))
  const homeHeroConfig = computed(() => ({
    categories: sanitizeHomeCategories(
      getHomeSetting('home_hero_categories'),
      HOME_SEARCH_DEFAULTS.hero.categories,
    ),
    purity: sanitizeHomePurity(
      getHomeSetting('home_hero_purity'),
      HOME_SEARCH_DEFAULTS.hero.purity,
    ),
    sorting: sanitizeHomeSorting(
      getHomeSetting('home_hero_sorting'),
      HOME_SEARCH_DEFAULTS.hero.sorting,
    ),
    resolution: sanitizeHomeOption(
      getHomeSetting('home_hero_resolution'),
      HOME_RESOLUTION_OPTIONS,
      HOME_SEARCH_DEFAULTS.hero.resolution,
    ),
    color: sanitizeHomeOption(
      getHomeSetting('home_hero_color'),
      HOME_COLOR_OPTIONS,
      HOME_SEARCH_DEFAULTS.hero.color,
    ),
    ratios: HOME_SEARCH_DEFAULTS.hero.ratios,
    quality: HOME_SEARCH_DEFAULTS.hero.quality,
    query: sanitizeHomeText(getHomeSetting('home_hero_query'), HOME_SEARCH_DEFAULTS.hero.query),
  }))
  const homeVideoConfig = computed(() => ({
    categories: sanitizeHomeCategories(
      getHomeSetting('home_video_categories'),
      HOME_SEARCH_DEFAULTS.video.categories,
    ),
    purity: sanitizeHomePurity(
      getHomeSetting('home_video_purity'),
      HOME_SEARCH_DEFAULTS.video.purity,
    ),
    sorting: sanitizeHomeSorting(
      getHomeSetting('home_video_sorting'),
      HOME_SEARCH_DEFAULTS.video.sorting,
    ),
    resolution: sanitizeHomeOption(
      getHomeSetting('home_video_resolution'),
      HOME_RESOLUTION_OPTIONS,
      HOME_SEARCH_DEFAULTS.video.resolution,
    ),
    color: sanitizeHomeOption(
      getHomeSetting('home_video_color'),
      HOME_COLOR_OPTIONS,
      HOME_SEARCH_DEFAULTS.video.color,
    ),
    ratios: HOME_SEARCH_DEFAULTS.video.ratios,
    quality: sanitizeHomeQuality(
      getHomeSetting('home_video_image_quality'),
      HOME_SEARCH_DEFAULTS.video.quality,
    ),
    query: sanitizeHomeText(getHomeSetting('home_video_query'), HOME_SEARCH_DEFAULTS.video.query),
  }))
  const homeMobileConfig = computed(() => ({
    categories: sanitizeHomeCategories(
      getHomeSetting('home_mobile_categories'),
      HOME_SEARCH_DEFAULTS.mobile.categories,
    ),
    purity: sanitizeHomePurity(
      getHomeSetting('home_mobile_purity'),
      HOME_SEARCH_DEFAULTS.mobile.purity,
    ),
    sorting: sanitizeHomeSorting(
      getHomeSetting('home_mobile_sorting'),
      HOME_SEARCH_DEFAULTS.mobile.sorting,
    ),
    resolution: sanitizeHomeOption(
      getHomeSetting('home_mobile_resolution'),
      HOME_RESOLUTION_OPTIONS,
      HOME_SEARCH_DEFAULTS.mobile.resolution,
    ),
    color: sanitizeHomeOption(
      getHomeSetting('home_mobile_color'),
      HOME_COLOR_OPTIONS,
      HOME_SEARCH_DEFAULTS.mobile.color,
    ),
    ratios: sanitizeHomeOption(
      getHomeSetting('home_mobile_ratios'),
      HOME_MOBILE_RATIO_OPTIONS,
      HOME_SEARCH_DEFAULTS.mobile.ratios,
    ),
    quality: sanitizeHomeQuality(
      getHomeSetting('home_mobile_image_quality'),
      HOME_SEARCH_DEFAULTS.mobile.quality,
    ),
    query: sanitizeHomeText(getHomeSetting('home_mobile_query'), HOME_SEARCH_DEFAULTS.mobile.query),
  }))
  const homeDesktopConfig = computed(() => ({
    categories: sanitizeHomeCategories(
      getHomeSetting('home_desktop_categories'),
      HOME_SEARCH_DEFAULTS.desktop.categories,
    ),
    purity: sanitizeHomePurity(
      getHomeSetting('home_desktop_purity'),
      HOME_SEARCH_DEFAULTS.desktop.purity,
    ),
    sorting: sanitizeHomeSorting(
      getHomeSetting('home_desktop_sorting'),
      HOME_SEARCH_DEFAULTS.desktop.sorting,
    ),
    resolution: sanitizeHomeOption(
      getHomeSetting('home_desktop_resolution'),
      HOME_RESOLUTION_OPTIONS,
      HOME_SEARCH_DEFAULTS.desktop.resolution,
    ),
    color: sanitizeHomeOption(
      getHomeSetting('home_desktop_color'),
      HOME_COLOR_OPTIONS,
      HOME_SEARCH_DEFAULTS.desktop.color,
    ),
    ratios: HOME_SEARCH_DEFAULTS.desktop.ratios,
    quality: sanitizeHomeQuality(
      getHomeSetting('home_desktop_image_quality'),
      HOME_SEARCH_DEFAULTS.desktop.quality,
    ),
    query: sanitizeHomeText(
      getHomeSetting('home_desktop_query'),
      HOME_SEARCH_DEFAULTS.desktop.query,
    ),
  }))
  const homeLatestConfig = computed(() => ({
    categories: sanitizeHomeCategories(
      getHomeSetting('home_latest_categories'),
      HOME_SEARCH_DEFAULTS.latest.categories,
    ),
    purity: sanitizeHomePurity(
      getHomeSetting('home_latest_purity'),
      HOME_SEARCH_DEFAULTS.latest.purity,
    ),
    sorting: 'date_added',
    resolution: sanitizeHomeOption(
      getHomeSetting('home_latest_resolution'),
      HOME_RESOLUTION_OPTIONS,
      HOME_SEARCH_DEFAULTS.latest.resolution,
    ),
    color: sanitizeHomeOption(
      getHomeSetting('home_latest_color'),
      HOME_COLOR_OPTIONS,
      HOME_SEARCH_DEFAULTS.latest.color,
    ),
    ratios: sanitizeHomeOption(
      getHomeSetting('home_latest_ratios'),
      HOME_RATIO_OPTIONS,
      HOME_SEARCH_DEFAULTS.latest.ratios,
    ),
    quality: sanitizeHomeQuality(
      getHomeSetting('home_latest_image_quality'),
      HOME_SEARCH_DEFAULTS.latest.quality,
    ),
    query: sanitizeHomeText(getHomeSetting('home_latest_query'), HOME_SEARCH_DEFAULTS.latest.query),
  }))
  const homeRandomConfig = computed(() => ({
    categories: sanitizeHomeCategories(
      getHomeSetting('home_random_categories'),
      HOME_SEARCH_DEFAULTS.random.categories,
    ),
    purity: sanitizeHomePurity(
      getHomeSetting('home_random_purity'),
      HOME_SEARCH_DEFAULTS.random.purity,
    ),
    sorting: sanitizeHomeSorting(
      getHomeSetting('home_random_sorting'),
      HOME_SEARCH_DEFAULTS.random.sorting,
    ),
    resolution: sanitizeHomeOption(
      getHomeSetting('home_random_resolution'),
      HOME_RESOLUTION_OPTIONS,
      HOME_SEARCH_DEFAULTS.random.resolution,
    ),
    color: sanitizeHomeOption(
      getHomeSetting('home_random_color'),
      HOME_COLOR_OPTIONS,
      HOME_SEARCH_DEFAULTS.random.color,
    ),
    ratios: sanitizeHomeOption(
      getHomeSetting('home_random_ratios'),
      HOME_RATIO_OPTIONS,
      HOME_SEARCH_DEFAULTS.random.ratios,
    ),
    quality: sanitizeHomeQuality(
      getHomeSetting('home_random_image_quality'),
      HOME_SEARCH_DEFAULTS.random.quality,
    ),
    similarId: sanitizeHomeText(
      getHomeSetting('home_random_similar_id'),
      HOME_SEARCH_DEFAULTS.random.similarId,
    ),
  }))

  const heroDesktopWallpapers = computed(() => heroWallpapers.value.slice(0, 24))
  const homeSearchConfigFingerprint = computed(() =>
    homeConfigFingerprint({
      hero: homeHeroConfig.value,
      mobile: homeMobileConfig.value,
      desktop: homeDesktopConfig.value,
      latest: homeLatestConfig.value,
      random: homeRandomConfig.value,
      video: homeVideoConfig.value,
      mobileTags: homeMobileTags.value,
    }),
  )

  function resolveHomeImageQuality(overrideQuality) {
    const quality = String(overrideQuality || 'original')
    return ['small', 'original', 'full'].includes(quality) ? quality : 'original'
  }

  function getHomeImageUrl(wallpaper, overrideQuality = 'inherit') {
    const quality = resolveHomeImageQuality(overrideQuality)
    const thumbs = wallpaper?.thumbs || {}
    const rawThumbs = wallpaper?.raw_thumbs || {}

    if (quality === 'small') {
      return (
        proxyWallhavenImageUrl(
          thumbs.small || rawThumbs.small || wallpaper?.raw_thumbnail || wallpaper?.thumbnail || '',
        ) || ''
      )
    }

    if (quality === 'original') {
      return (
        proxyWallhavenImageUrl(
          thumbs.original ||
            rawThumbs.original ||
            thumbs.large ||
            rawThumbs.large ||
            wallpaper?.raw_thumbnail ||
            wallpaper?.thumbnail ||
            '',
        ) || ''
      )
    }

    return (
      proxyWallhavenImageUrl(
        wallpaper?.raw_path ||
          wallpaper?.path ||
          wallpaper?.url ||
          rawThumbs.original ||
          rawThumbs.large ||
          thumbs.original ||
          thumbs.large ||
          wallpaper?.raw_thumbnail ||
          wallpaper?.thumbnail ||
          '',
      ) || ''
    )
  }

  function parseHomeTags(raw) {
    const text = String(raw || '').trim()
    if (!text) return HOME_TAGS_DEFAULT

    const parsed = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, ...rest] = line.split('=')
        const query = rest.join('=').trim()
        const finalLabel = String(label || '').trim()
        return finalLabel ? { label: finalLabel, query } : null
      })
      .filter(Boolean)

    return parsed.length ? parsed : HOME_TAGS_DEFAULT
  }

  function getHomeSetting(key, fallback = '') {
    const defaultValue = HOME_SETTING_DEFAULTS[key] ?? fallback
    const localValue = settingsStore.getSetting(key, defaultValue)
    const publicValue = publicHomeConfig.value?.[key]

    if (
      publicValue !== undefined &&
      publicValue !== null &&
      String(localValue ?? '') === String(defaultValue ?? '')
    ) {
      return publicValue
    }

    return localValue
  }

  function createHomeAbortSignal() {
    const controller = new AbortController()
    if (!isHomeActive) {
      controller.abort()
      return controller.signal
    }
    abortControllers.add(controller)
    controller.signal.addEventListener(
      'abort',
      () => {
        abortControllers.delete(controller)
      },
      { once: true },
    )
    return controller.signal
  }

  function releaseHomeAbortSignal(signal) {
    if (!signal) return
    for (const controller of abortControllers) {
      if (controller.signal === signal) {
        abortControllers.delete(controller)
        return
      }
    }
  }

  function abortHomeSignal(signal) {
    if (!signal) return
    for (const controller of abortControllers) {
      if (controller.signal === signal) {
        controller.abort()
        return
      }
    }
  }

  function isAbortError(error) {
    return (
      error?.name === 'AbortError' ||
      error?.name === 'CanceledError' ||
      error?.code === 'ERR_CANCELED' ||
      (error?.name === 'TypeError' && /failed to fetch/i.test(error?.message || ''))
    )
  }

  function abortHomeRequests() {
    abortControllers.forEach((controller) => controller.abort())
    abortControllers.clear()
  }

  function normalizeHomeQuickSearches(value) {
    if (!Array.isArray(value)) return []

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const label = sanitizeHomeText(item.label, '')
        if (!label) return null

        return {
          label,
          query: sanitizeHomeText(item.query, ''),
          categories: sanitizeHomeCategories(item.categories, '111'),
          purity: sanitizeHomePurity(item.purity, '100'),
          sorting: sanitizeHomeSorting(item.sorting, 'favorites'),
          resolution: sanitizeHomeOption(item.resolution, HOME_RESOLUTION_OPTIONS, ''),
          ratios: sanitizeHomeOption(item.ratios, HOME_RATIO_OPTIONS, ''),
          color: sanitizeHomeOption(item.color, HOME_COLOR_OPTIONS, ''),
        }
      })
      .filter(Boolean)
      .slice(0, 8)
  }

  async function loadPublicHomeConfig() {
    if (!isHomeActive) return
    try {
      const payload = await fetchHomeBootstrap()
      if (!isHomeActive) return
      const nextConfig = payload?.config?.siteHome
      const nextSearches = payload?.searches
      publicHomeConfig.value = nextConfig && typeof nextConfig === 'object' ? nextConfig : {}
      publicPopularSearches.value = Array.isArray(nextSearches) ? nextSearches : []
    } catch (error) {
      if (!isHomeActive || isAbortError(error)) return
      console.warn('加载首页运营配置失败:', error)
      publicHomeConfig.value = {}
      publicPopularSearches.value = []
    }
  }

  async function searchHomeWithFallback(requests, signal) {
    const finalRequests = uniqueHomeRequests(requests)
    let lastResponse = null

    for (const request of finalRequests) {
      if (!isHomeActive || signal?.aborted) return { response: lastResponse, images: [] }
      const response = await wallpaperApi.search(request, { signal })
      if (!isHomeActive || signal?.aborted || response?.aborted) return { response, images: [] }
      const images = normalizeImages(response)
      if (images.length) return { response, images }
      lastResponse = response
    }

    return { response: lastResponse, images: [] }
  }

  async function loadHeroWallpapers(force = false) {
    if (!isHomeActive) return
    if (isLoadingHero.value) return

    const config = homeHeroConfig.value
    const cacheKey = homeSectionCacheKey(CACHE_KEYS.hero, JSON.stringify(config), config.quality)
    const cache = readSectionCache(cacheKey)
    if (!force && isCacheFresh(cache)) {
      heroWallpapers.value = cache.items
      return
    }

    isLoadingHero.value = true
    heroError.value = ''
    const signal = createHomeAbortSignal()

    try {
      const baseRequest = buildHomeSearchRequest(config)
      const { response, images } = await searchHomeWithFallback([baseRequest], signal)
      if (!isHomeActive || signal.aborted) return

      heroWallpapers.value = images
      writeSectionCache(cacheKey, heroWallpapers.value)
      if (!heroWallpapers.value.length) {
        heroError.value = response?.error || '加载首页球形图失败'
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('加载首页球形图失败:', error)
      heroError.value = '加载首页球形图失败'
    } finally {
      releaseHomeAbortSignal(signal)
      isLoadingHero.value = false
    }
  }

  async function loadMobileTopWallpapers(force = false, tag = mobileTopTag.value) {
    if (!isHomeActive) return
    const requestVersion = ++mobileTopRequestVersion
    if (mobileTopSignal) abortHomeSignal(mobileTopSignal)

    const config = homeMobileConfig.value
    const cacheKey = homeSectionCacheKey(
      CACHE_KEYS.mobileTop,
      `${tag || ''} ${JSON.stringify(config)}`.trim(),
      config.quality,
    )
    const cache = readSectionCache(cacheKey)
    if (!force && isCacheFresh(cache)) {
      mobileTopWallpapers.value = cache.items
      mobileTopSignal = null
      isLoadingMobileTop.value = false
      return
    }

    isLoadingMobileTop.value = true
    mobileTopError.value = ''
    const signal = createHomeAbortSignal()
    mobileTopSignal = signal

    try {
      const queryParts = [tag || '', config.query]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      const baseRequest = buildHomeSearchRequest({
        ...config,
        query: queryParts.join(' '),
      })
      const { response, images } = await searchHomeWithFallback([baseRequest], signal)
      if (!isHomeActive || signal.aborted || requestVersion !== mobileTopRequestVersion) return

      mobileTopWallpapers.value = images
      writeSectionCache(cacheKey, mobileTopWallpapers.value)
      if (!mobileTopWallpapers.value.length) {
        mobileTopError.value = response?.error || '加载经典手机壁纸失败'
      }
    } catch (error) {
      if (isAbortError(error) || requestVersion !== mobileTopRequestVersion) return
      console.error('加载经典手机壁纸失败:', error)
      mobileTopError.value = '加载经典手机壁纸失败'
    } finally {
      releaseHomeAbortSignal(signal)
      if (mobileTopSignal === signal) mobileTopSignal = null
      if (requestVersion === mobileTopRequestVersion) isLoadingMobileTop.value = false
    }
  }

  async function loadDesktopTopWallpapers(force = false) {
    if (!isHomeActive) return
    if (isLoadingDesktopTop.value) return

    const config = homeDesktopConfig.value
    const cacheKey = homeSectionCacheKey(
      CACHE_KEYS.desktopTop,
      JSON.stringify(config),
      config.quality,
    )
    const cache = readSectionCache(cacheKey)
    if (!force && isCacheFresh(cache)) {
      desktopTopWallpapers.value = cache.items
      return
    }

    isLoadingDesktopTop.value = true
    desktopTopError.value = ''
    const signal = createHomeAbortSignal()

    try {
      const baseRequest = buildHomeSearchRequest(config)
      const { response, images } = await searchHomeWithFallback([baseRequest], signal)
      if (!isHomeActive || signal.aborted) return

      desktopTopWallpapers.value = images
      writeSectionCache(cacheKey, desktopTopWallpapers.value)
      if (!desktopTopWallpapers.value.length) {
        desktopTopError.value = response?.error || '加载经典桌面壁纸失败'
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('加载经典桌面壁纸失败:', error)
      desktopTopError.value = '加载经典桌面壁纸失败'
    } finally {
      releaseHomeAbortSignal(signal)
      isLoadingDesktopTop.value = false
    }
  }

  async function loadRandomSeedWallpapers(force = false) {
    if (!isHomeActive) return
    if (isLoadingRandomSeed.value) return

    const config = homeRandomConfig.value
    const cacheKey = homeSectionCacheKey(
      CACHE_KEYS.randomSeed,
      JSON.stringify(config),
      config.quality,
      randomSeed.value,
    )
    const cache = readSectionCache(cacheKey)
    if (!force && isCacheFresh(cache)) {
      randomSeed.value = cache.seed || randomSeed.value
      randomSeedWallpapers.value = cache.items
      return
    }

    isLoadingRandomSeed.value = true
    randomSeedError.value = ''
    const signal = createHomeAbortSignal()

    try {
      const hasSimilarIds = parseHomeSimilarIds(config.similarId).length > 0
      const baseRequest = {
        ...buildHomeSearchRequest(config),
        seed: hasSimilarIds ? undefined : randomSeed.value,
      }
      const { response, images } = await searchHomeWithFallback([baseRequest], signal)
      if (!isHomeActive || signal.aborted) return

      randomSeedWallpapers.value = images
      writeSectionCache(cacheKey, randomSeedWallpapers.value, { seed: randomSeed.value })
      if (!randomSeedWallpapers.value.length) {
        randomSeedError.value = response?.error || '加载随机种子壁纸失败'
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('加载随机种子壁纸失败:', error)
      randomSeedError.value = '加载随机种子壁纸失败'
    } finally {
      releaseHomeAbortSignal(signal)
      isLoadingRandomSeed.value = false
    }
  }

  async function refreshRandomSeedWallpapers() {
    if (!isHomeActive) return
    randomSeed.value = randomWallhavenSeed()
    writeHomeRandomSeed(randomSeed.value)
    await loadRandomSeedWallpapers(true)
  }

  async function loadLatestWallpapers(force = false) {
    if (!isHomeActive) return
    if (isLoadingLatest.value) return

    const config = homeLatestConfig.value
    const cacheKey = homeSectionCacheKey(CACHE_KEYS.latest, JSON.stringify(config), config.quality)
    const cache = readSectionCache(cacheKey)
    if (!force && isCacheFresh(cache)) {
      latestWallpapers.value = cache.items
      return
    }

    isLoadingLatest.value = true
    latestError.value = ''
    const signal = createHomeAbortSignal()

    try {
      const baseRequest = buildHomeSearchRequest(config)
      const { response, images } = await searchHomeWithFallback([baseRequest], signal)
      if (!isHomeActive || signal.aborted) return

      latestWallpapers.value = images
      writeSectionCache(cacheKey, latestWallpapers.value)
      if (!latestWallpapers.value.length) {
        latestError.value = response?.error || '加载最新壁纸失败'
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('加载最新壁纸失败:', error)
      latestError.value = '加载最新壁纸失败'
    } finally {
      releaseHomeAbortSignal(signal)
      isLoadingLatest.value = false
    }
  }

  async function loadFavoriteRankWallpapers(force = false) {
    if (!isHomeActive) return
    if (isLoadingFavoriteRank.value) return

    const config = homeVideoConfig.value
    const cacheKey = homeSectionCacheKey(
      CACHE_KEYS.favoriteRank,
      JSON.stringify(config),
      config.quality,
    )
    const cache = readSectionCache(cacheKey)
    if (!force && isCacheFresh(cache)) {
      favoriteRankWallpapers.value = cache.items
      return
    }

    isLoadingFavoriteRank.value = true
    favoriteRankError.value = ''
    const signal = createHomeAbortSignal()

    try {
      const baseRequest = buildHomeSearchRequest(config)
      const { response, images } = await searchHomeWithFallback([baseRequest], signal)
      if (!isHomeActive || signal.aborted) return

      favoriteRankWallpapers.value = images
      writeSectionCache(cacheKey, favoriteRankWallpapers.value)
      if (!favoriteRankWallpapers.value.length) {
        favoriteRankError.value = response?.error || '加载收藏数排行失败'
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('加载收藏数排行失败:', error)
      favoriteRankError.value = '加载收藏数排行失败'
    } finally {
      releaseHomeAbortSignal(signal)
      isLoadingFavoriteRank.value = false
    }
  }

  function hydrateFromCache() {
    const heroCacheKey = homeSectionCacheKey(
      CACHE_KEYS.hero,
      JSON.stringify(homeHeroConfig.value),
      homeHeroConfig.value.quality,
    )
    const heroCache = readSectionCache(heroCacheKey)
    const mobileCacheKey = homeSectionCacheKey(
      CACHE_KEYS.mobileTop,
      `${mobileTopTag.value || ''} ${JSON.stringify(homeMobileConfig.value)}`.trim(),
      homeMobileConfig.value.quality,
    )
    const desktopCacheKey = homeSectionCacheKey(
      CACHE_KEYS.desktopTop,
      JSON.stringify(homeDesktopConfig.value),
      homeDesktopConfig.value.quality,
    )
    const randomCacheKey = homeSectionCacheKey(
      CACHE_KEYS.randomSeed,
      JSON.stringify(homeRandomConfig.value),
      homeRandomConfig.value.quality,
      randomSeed.value,
    )
    const latestCacheKey = homeSectionCacheKey(
      CACHE_KEYS.latest,
      JSON.stringify(homeLatestConfig.value),
      homeLatestConfig.value.quality,
    )
    const favoriteCacheKey = homeSectionCacheKey(
      CACHE_KEYS.favoriteRank,
      JSON.stringify(homeVideoConfig.value),
      homeVideoConfig.value.quality,
    )
    const mobileTopCache = readSectionCache(mobileCacheKey)
    const desktopTopCache = readSectionCache(desktopCacheKey)
    const randomSeedCache = readSectionCache(randomCacheKey)
    const latestCache = readSectionCache(latestCacheKey)
    const favoriteRankCache = readSectionCache(favoriteCacheKey)

    if (heroCache?.items?.length) {
      heroWallpapers.value = heroCache.items
    }
    if (mobileTopCache?.items?.length) {
      mobileTopWallpapers.value = mobileTopCache.items
    }
    if (desktopTopCache?.items?.length) {
      desktopTopWallpapers.value = desktopTopCache.items
    }
    if (randomSeedCache?.items?.length) {
      randomSeed.value = randomSeedCache.seed || randomSeed.value
      randomSeedWallpapers.value = randomSeedCache.items
    }
    if (latestCache?.items?.length) {
      latestWallpapers.value = latestCache.items
    }
    if (favoriteRankCache?.items?.length) {
      favoriteRankWallpapers.value = favoriteRankCache.items
    }
  }

  async function loadInitialHomeData() {
    if (!isHomeActive) return
    const jobs = []
    if (isSectionEnabled('hero')) jobs.push(loadHeroWallpapers())
    if (isSectionEnabled('mobile')) jobs.push(loadMobileTopWallpapers())
    if (isSectionEnabled('desktop')) jobs.push(loadDesktopTopWallpapers())
    if (isSectionEnabled('desktop') || isSectionEnabled('latest')) {
      jobs.push(loadFavoriteRankWallpapers())
    }
    if (isSectionEnabled('random')) jobs.push(loadRandomSeedWallpapers())
    if (isSectionEnabled('latest')) jobs.push(loadLatestWallpapers())
    await Promise.all(jobs)
  }

  onMounted(() => {
    isHomeActive = true
    hydrateFromCache()
    void loadPublicHomeConfig()
      .finally(() => {
        if (!isHomeActive) return undefined
        return loadInitialHomeData()
      })
      .finally(() => {
        if (!isHomeActive) return
        homeDataInitialized.value = true
      })
  })

  onBeforeUnmount(() => {
    isHomeActive = false
    mobileTopRequestVersion += 1
    mobileTopSignal = null
    abortHomeRequests()
  })

  watch(homeSearchConfigFingerprint, (nextFingerprint, previousFingerprint) => {
    if (!isHomeActive) return
    if (!homeDataInitialized.value) return
    if (nextFingerprint === previousFingerprint) return
    const jobs = []
    if (isSectionEnabled('hero')) jobs.push(loadHeroWallpapers(true))
    if (isSectionEnabled('mobile')) {
      jobs.push(loadMobileTopWallpapers(true, mobileTopTag.value))
    }
    if (isSectionEnabled('desktop')) jobs.push(loadDesktopTopWallpapers(true))
    if (isSectionEnabled('random')) jobs.push(loadRandomSeedWallpapers(true))
    if (isSectionEnabled('latest')) jobs.push(loadLatestWallpapers(true))
    if (isSectionEnabled('desktop') || isSectionEnabled('latest')) {
      jobs.push(loadFavoriteRankWallpapers(true))
    }
    void Promise.allSettled(jobs)
  })

  async function setMobileTopTag(tag) {
    mobileTopTag.value = tag
    await loadMobileTopWallpapers(false, tag)
  }

  return {
    heroWallpapers,
    mobileTopWallpapers,
    desktopTopWallpapers,
    heroDesktopWallpapers,
    randomSeedWallpapers,
    latestWallpapers,
    favoriteRankWallpapers,
    randomSeed,
    mobileTopTag,
    isLoadingHero,
    isLoadingMobileTop,
    isLoadingDesktopTop,
    isLoadingRandomSeed,
    isLoadingLatest,
    isLoadingFavoriteRank,
    heroError,
    mobileTopError,
    desktopTopError,
    randomSeedError,
    latestError,
    favoriteRankError,
    loadInitialHomeData,
    loadHeroWallpapers,
    loadMobileTopWallpapers,
    setMobileTopTag,
    loadDesktopTopWallpapers,
    loadRandomSeedWallpapers,
    refreshRandomSeedWallpapers,
    loadLatestWallpapers,
    loadFavoriteRankWallpapers,
    homeMobileTags,
    homeQuickSearches,
    homeHeroPlaceholder,
    homeHeroImageQuality: computed(() => homeHeroConfig.value.quality),
    homeMobileImageQuality: computed(() => homeMobileConfig.value.quality),
    homeDesktopImageQuality: computed(() => homeDesktopConfig.value.quality),
    homeLatestImageQuality: computed(() => homeLatestConfig.value.quality),
    homeRandomImageQuality: computed(() => homeRandomConfig.value.quality),
    homeVideoImageQuality: computed(() => homeVideoConfig.value.quality),
    resolveHomeImageQuality,
    getHomeImageUrl,
  }
}
