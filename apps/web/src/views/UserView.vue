<script setup>
import WallpaperPreview from '@/components/wallpaper/WallpaperFullscreenPreview.vue'
import WallpaperGrid from '@/components/wallpaper/WallpaperGrid.vue'
import authorForestAnimeHero from '@/assets/user/author-forest-anime-hero.png'
import { userApi } from '@/services/api'
import notificationService from '@/services/notification'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { downloadWallpapersUnified } from '@/services/wallpaperDownload'
import { useFavoritesStore } from '@/stores/favorites'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useSettingsStore } from '@/stores/settings'
import { useUserStore } from '@/stores/user'
import { purityLabel } from '@/utils/purity'
import { computed, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import '../styles/user-view.css'

// 获取route、router和stores
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const favoritesStore = useFavoritesStore()
const runtimeConfigStore = useRuntimeConfigStore()
const settingsStore = useSettingsStore()

// 用户数据
const userData = ref(null)
const publicProfile = ref(null)
const isLoading = ref(false)
const error = ref('')
/** 线上代理无用户 API 或 404 时，链到 Wallhaven 用户页 */
const wallhavenProfileUrl = ref('')
const activeTab = ref('uploads')
const collections = ref([])
const selectedCollection = ref(null)
const sortMode = ref('newest')
const viewDensity = ref('medium')
const waterfallLayout = ref(true)
const imageQuality = ref('original')
const sortMenuOpen = ref(false)
/** 纯净度筛选：三位 bitmask，与搜索页一致（SFW / Sketchy / NSFW） */
const purityFilter = ref('110')

// 壁纸数据
const wallpapers = ref([])
const isLoadingWallpapers = ref(false)
const wallpapersError = ref('')
const currentPage = ref(1)
const totalPages = ref(1)

// 预览相关
const previewWallpaper = ref(null)
const showPreview = ref(false)
const previewIndex = ref(-1)

// 收藏集相关
const showCollectionDetail = ref(false)
const currentCollection = ref(null)
const collectionWallpapers = ref([])
const isLoadingCollectionWallpapers = ref(false)
const collectionWallpapersError = ref('')
const collectionCurrentPage = ref(1)
const collectionTotalPages = ref(1)

// 下载相关
const isDownloading = ref(false)
const downloadProgress = ref(0)

// 收藏相关
const isFavoriting = ref(false)
const favoriteProgress = ref(0)
const favoriteAllDialogVisible = ref(false)
const authorMainRef = ref(null)

const USER_PAGE_STORAGE_KEYS = {
  activeTab: 'author-page-active-tab',
  sortMode: 'author-page-sort-mode',
  viewDensity: 'author-page-view-density',
  waterfallLayout: 'author-page-waterfall-layout',
  imageQuality: 'author-page-image-quality',
  purityFilter: 'author-page-purity-filter',
  /** @deprecated migrated to imageQuality */
  originalQuality: 'author-page-original-quality',
}

const VALID_TABS = new Set(['uploads', 'favorites', 'collections'])
const VALID_SORT_MODES = new Set(['newest', 'popular', 'views', 'resolution', 'id'])
const VALID_DENSITIES = new Set(['compact', 'medium', 'relaxed'])
const VALID_QUALITIES = new Set(['medium', 'high', 'original'])

const PURITY_OPTIONS = [
  { key: 'sfw', index: 0, label: 'SFW', title: '安全' },
  { key: 'sketchy', index: 1, label: 'Sketchy', title: '轻微敏感' },
  { key: 'nsfw', index: 2, label: 'NSFW', title: '敏感' },
]

const qualityOptions = [
  { key: 'medium', label: '中等画质', shortLabel: '中', icon: 'bi-badge-sd' },
  { key: 'high', label: '高清画质', shortLabel: '高', icon: 'bi-badge-hd' },
  { key: 'original', label: '原图画质', shortLabel: '原', icon: 'bi-badge-4k' },
]
const waterfallQualityOptions = qualityOptions.filter((item) => item.key !== 'medium')

function defaultPurityFilter() {
  return settingsStore.settings?.show_nsfw ? '111' : '110'
}

function normalizePurityFilter(value, fallback = '110') {
  const raw = String(value || '')
  if (!/^[01]{3}$/.test(raw)) return fallback
  if (raw === '000') return fallback
  if (raw[2] === '1' && !settingsStore.settings?.show_nsfw) {
    return `${raw[0]}${raw[1]}0`
  }
  return raw
}

function wallpaperPurityKey(item) {
  const value = String(item?.purity || '')
    .trim()
    .toLowerCase()
  if (!value || value === 'sfw' || value === '100') return 'sfw'
  if (value === 'sketchy' || value === '110' || value === '010') return 'sketchy'
  if (
    value === 'nsfw' ||
    value === '001' ||
    value === '011' ||
    value === '101' ||
    value === '111'
  ) {
    return 'nsfw'
  }
  const label = purityLabel(value).toLowerCase()
  if (label === 'sketchy') return 'sketchy'
  if (label === 'nsfw') return 'nsfw'
  return 'sfw'
}

const searchLayout = computed(() => runtimeConfigStore.getPageLayout('search') || {})
const userPageLayout = computed(() => runtimeConfigStore.getPageLayout('user') || {})
const previewLayout = computed(() => searchLayout.value.preview || {})
function isSearchModuleVisible(key) {
  return searchLayout.value?.[key]?.enabled !== false
}
function isPreviewToolVisible(key) {
  return previewLayout.value?.enabled !== false && previewLayout.value?.[key]?.enabled !== false
}
const isPreviewEnabled = computed(
  () => isSearchModuleVisible('preview') && previewLayout.value?.enabled !== false,
)
const canDownloadAuthorPage = computed(
  () => runtimeConfigStore.canUse('download') && userPageLayout.value?.download?.enabled !== false,
)
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

function getAuthorScopedKey(key) {
  return `${key}:${String(username.value || 'unknown').toLowerCase()}`
}

function readStoredValue(key, fallback, validator) {
  const raw = getScopedLocalItem(key)
  if (raw === null || raw === undefined || raw === '') return fallback
  return validator?.(raw) === false ? fallback : raw
}

function persistAuthorPageState() {
  setScopedLocalItem(USER_PAGE_STORAGE_KEYS.activeTab, activeTab.value)
  setScopedLocalItem(USER_PAGE_STORAGE_KEYS.sortMode, sortMode.value)
  setScopedLocalItem(USER_PAGE_STORAGE_KEYS.viewDensity, viewDensity.value)
  setScopedLocalItem(USER_PAGE_STORAGE_KEYS.waterfallLayout, String(waterfallLayout.value))
  setScopedLocalItem(USER_PAGE_STORAGE_KEYS.imageQuality, imageQuality.value)
  setScopedLocalItem(USER_PAGE_STORAGE_KEYS.purityFilter, purityFilter.value)
  setScopedLocalItem(
    getAuthorScopedKey('author-page-selected-collection-id'),
    selectedCollection.value?.id ? String(selectedCollection.value.id) : '',
  )
  setScopedLocalItem(
    getAuthorScopedKey('author-page-open-collection-id'),
    showCollectionDetail.value && currentCollection.value?.id ? String(currentCollection.value.id) : '',
  )
}

function restoreAuthorPageState() {
  activeTab.value = readStoredValue(
    USER_PAGE_STORAGE_KEYS.activeTab,
    'uploads',
    value => VALID_TABS.has(value),
  )
  sortMode.value = readStoredValue(
    USER_PAGE_STORAGE_KEYS.sortMode,
    'newest',
    value => VALID_SORT_MODES.has(value),
  )
  viewDensity.value = readStoredValue(
    USER_PAGE_STORAGE_KEYS.viewDensity,
    'medium',
    value => VALID_DENSITIES.has(value),
  )
  waterfallLayout.value =
    readStoredValue(USER_PAGE_STORAGE_KEYS.waterfallLayout, 'true', value =>
      ['true', 'false'].includes(value),
    ) === 'true'

  const storedQuality = readStoredValue(
    USER_PAGE_STORAGE_KEYS.imageQuality,
    '',
    value => VALID_QUALITIES.has(value),
  )
  if (storedQuality) {
    imageQuality.value = storedQuality
  } else {
    // migrate legacy boolean originalQuality
    const legacyOriginal =
      readStoredValue(USER_PAGE_STORAGE_KEYS.originalQuality, 'true', value =>
        ['true', 'false'].includes(value),
      ) === 'true'
    imageQuality.value = legacyOriginal ? 'original' : 'high'
  }

  purityFilter.value = normalizePurityFilter(
    readStoredValue(USER_PAGE_STORAGE_KEYS.purityFilter, '', () => true),
    defaultPurityFilter(),
  )

  selectedCollection.value = null
  currentCollection.value = null
  showCollectionDetail.value = false
  ensureSortModeForContext()
}

function restoreAuthorCollectionsState() {
  if (activeTab.value === 'favorites') {
    const selectedId = getScopedLocalItem(getAuthorScopedKey('author-page-selected-collection-id'))
    const collection = collections.value.find(item => String(item.id) === String(selectedId))
    if (collection) {
      selectedCollection.value = collection
      return
    }
  }

  if (activeTab.value === 'collections') {
    const openId = getScopedLocalItem(getAuthorScopedKey('author-page-open-collection-id'))
    const collection = userCollections.value.find(item => String(item.id) === String(openId))
    if (collection) {
      currentCollection.value = collection
      showCollectionDetail.value = true
      collectionCurrentPage.value = 1
      collectionWallpapers.value = []
      loadCollectionWallpapers()
    }
  }
}

// 计算属性：路由 param 可能含编码字符，与 Wallhaven 用户名对齐
const username = computed(() => {
  const p = route.params.username
  const raw = Array.isArray(p) ? p[0] : p
  if (raw == null || raw === '') return ''
  try {
    return decodeURIComponent(String(raw)).trim()
  } catch {
    return String(raw).trim()
  }
})
const isFollowing = computed(() => userStore.isFollowing(username.value))
const isFollowingCollection = computed(() => userStore.isFollowingCollection(username.value))

const userWallpapersHasMore = computed(() => currentPage.value < totalPages.value)
const collectionWallpapersHasMore = computed(
  () => collectionCurrentPage.value < collectionTotalPages.value,
)

const tabOptions = [
  { value: 'uploads', label: '上传', icon: 'bi-cloud-arrow-up' },
  { value: 'favorites', label: '收藏', icon: 'bi-heart' },
  { value: 'collections', label: '收藏集', icon: 'bi-collection' },
]

const densityOptions = [
  { value: 'compact', label: '紧凑', icon: 'bi-grid-3x3-gap' },
  { value: 'medium', label: '标准', icon: 'bi-grid' },
  { value: 'relaxed', label: '宽松', icon: 'bi-grid-1x2' },
]

const sortOptions = [
  { value: 'newest', label: '最新' },
  { value: 'popular', label: '热度' },
  { value: 'views', label: '浏览' },
  { value: 'resolution', label: '分辨率' },
  { value: 'id', label: 'ID' },
]

const collectionSortOptions = [
  { value: 'newest', label: '最新' },
  { value: 'popular', label: '数量' },
  { value: 'id', label: 'ID' },
]

const activeTabMeta = computed(
  () => tabOptions.find((option) => option.value === activeTab.value) || tabOptions[0],
)

const hasContentFilters = computed(
  () => sortMode.value !== 'newest' || purityFilter.value !== defaultPurityFilter(),
)
const showDensitySwitch = computed(
  () => activeTab.value !== 'collections' || showCollectionDetail.value,
)
const showPurityFilter = computed(
  () => activeTab.value !== 'collections' || showCollectionDetail.value,
)
const activeSortOptions = computed(() =>
  activeTab.value === 'collections' && !showCollectionDetail.value
    ? collectionSortOptions
    : sortOptions,
)

const activeSortLabel = computed(
  () => activeSortOptions.value.find((option) => option.value === sortMode.value)?.label || '最新',
)

const tabCounts = computed(() => ({
  uploads: userData.value?.uploads || normalizedWallpapers.value.length,
  favorites: userData.value?.favorites || 0,
  collections: userCollectionCount.value,
}))

const gridColumns = computed(() => {
  if (viewDensity.value === 'compact') return 6
  if (viewDensity.value === 'relaxed') return 3
  return 4
})

const normalizedWallpapers = computed(() => uniqueById(wallpapers.value))
const normalizedCollectionWallpapers = computed(() => uniqueById(collectionWallpapers.value))
const gridImageQuality = computed(() => imageQuality.value)
const activeImageQuality = computed(() => {
  const options = waterfallLayout.value ? waterfallQualityOptions : qualityOptions
  return options.find((item) => item.key === imageQuality.value) || options[0]
})

/** 收藏集数量：本地接口可能给数字，Wallhaven 回退为数组 */
const userCollectionCount = computed(() => {
  return userCollections.value.length
})

const userCollections = computed(() => {
  const userList = userData.value?.user_collections
  const list = Array.isArray(userList) && userList.length > 0 ? userList : collections.value || []
  return uniqueCollections(list)
})

const visibleWallpapers = computed(() => filterAndSortWallpapers(normalizedWallpapers.value))
const visibleCollectionWallpapers = computed(() =>
  filterAndSortWallpapers(normalizedCollectionWallpapers.value),
)
const activePreviewList = computed(() => {
  if (showCollectionDetail.value) return visibleCollectionWallpapers.value
  if (activeTab.value !== 'collections') return visibleWallpapers.value
  return []
})
const previewInListContext = computed(
  () => previewIndex.value >= 0 && activePreviewList.value.length > 1,
)
const favoriteAllTargetLabel = computed(() => {
  if (showCollectionDetail.value) return currentCollection.value?.name || '当前收藏集'
  if (activeTab.value === 'favorites') return selectedCollection.value?.name || '当前收藏'
  return '该作者上传'
})
const favoriteAllEstimatedCount = computed(() => {
  if (showCollectionDetail.value) {
    return currentCollection.value?.count || normalizedCollectionWallpapers.value.length
  }
  if (activeTab.value === 'favorites') return userData.value?.favorites || normalizedWallpapers.value.length
  return userData.value?.uploads || normalizedWallpapers.value.length
})

const visibleCollections = computed(() => {
  return [...userCollections.value].sort((a, b) => {
    if (sortMode.value === 'id') return String(a.id).localeCompare(String(b.id))
    if (sortMode.value === 'newest') return Number(b.id || 0) - Number(a.id || 0)
    return Number(b.count || 0) - Number(a.count || 0)
  })
})

const emptyContentMessage = computed(() => {
  if (showCollectionDetail.value) {
    return hasContentFilters.value ? '没有匹配当前纯净度筛选的壁纸' : '该收藏集中没有壁纸'
  }
  if (activeTab.value === 'uploads') {
    return hasContentFilters.value && wallpapers.value.length > 0
      ? '没有匹配当前纯净度筛选的壁纸'
      : '该用户还没有上传任何壁纸'
  }
  if (activeTab.value === 'favorites') {
    if (hasContentFilters.value && wallpapers.value.length > 0) {
      return '没有匹配当前纯净度筛选的壁纸'
    }
    return selectedCollection.value ? '该收藏集中没有壁纸' : '该用户还没有收藏任何壁纸'
  }
  return userCollections.value.length > 0 ? '没有匹配当前筛选的收藏集' : '该用户还没有创建收藏集'
})

function matchesPurityFilter(item) {
  const key = wallpaperPurityKey(item)
  const bits = purityFilter.value
  if (key === 'sfw') return bits[0] === '1'
  if (key === 'sketchy') return bits[1] === '1'
  if (key === 'nsfw') return bits[2] === '1'
  return bits[0] === '1'
}

function filterAndSortWallpapers(list = []) {
  return [...list]
    .filter((item) => matchesPurityFilter(item))
    .sort((a, b) => compareWallpaper(a, b, sortMode.value))
}

const heroWallpapers = computed(() => {
  const pool = uniqueById([...normalizedWallpapers.value, ...normalizedCollectionWallpapers.value])
    .filter((wallpaper) => getWallpaperImage(wallpaper))
    .slice(0, 5)

  if (pool.length >= 3) return pool

  const previews = userCollections.value
    .flatMap((collection) => collection.preview_images || [])
    .map((image, index) => ({
      id: `collection-preview-${index}-${image.thumbnail || image.url || image.path || ''}`,
      thumbnail: image.thumbnail || image.url || image.path || '',
      url: image.url || image.path || image.thumbnail || '',
    }))
    .filter((wallpaper) => getWallpaperImage(wallpaper))

  return uniqueById([...pool, ...previews]).slice(0, 5)
})

const authorAvatarImage = computed(
  () =>
    publicProfile.value?.user?.avatarUrl ||
    getWallpaperImage(heroWallpapers.value[0]) ||
    userData.value?.avatar_url ||
    '',
)

const publicProfileTags = computed(() => publicProfile.value?.profile?.tags || [])
const publicProfileStats = computed(() => publicProfile.value?.stats || null)
const publicHighlights = computed(() => publicProfile.value?.highlights || [])
const cardActionsLayout = computed(() => ({
  enabled: false,
  toolbar: { enabled: false },
  hide: { enabled: false },
}))

const authorHeaderStyle = computed(() => ({
  '--author-bg-image': `url("${authorForestAnimeHero}")`,
}))

const wallhavenUserPageUrl = computed(() =>
  username.value ? `https://wallhaven.cc/user/${encodeURIComponent(username.value)}` : '',
)

function uniqueById(list = []) {
  const seen = new Set()
  const result = []

  for (const item of Array.isArray(list) ? list : []) {
    if (!item) continue
    const image = getWallpaperImage(item)
    const key = String(
      item.id || item.path || item.url || item.image_url || item.thumbnail || image || '',
    )
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

function uniqueCollections(list = []) {
  const seen = new Set()
  const result = []

  for (const item of Array.isArray(list) ? list : []) {
    if (!item) continue
    const key = String(item.id || item.name || '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

function mergeUniqueById(current, incoming) {
  return uniqueById([...(current || []), ...(incoming || [])])
}

function getWallpaperImage(wallpaper) {
  return (
    wallpaper?.thumbnail ||
    wallpaper?.thumbs?.large ||
    wallpaper?.thumbs?.small ||
    wallpaper?.thumbs?.original ||
    wallpaper?.image_url ||
    wallpaper?.path ||
    wallpaper?.url ||
    ''
  )
}

function numberValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function wallpaperTimeValue(wallpaper) {
  const ts = Date.parse(wallpaper?.created_at || wallpaper?.upload_time || wallpaper?.created || '')
  return Number.isFinite(ts) ? ts : 0
}

function wallpaperPixels(wallpaper) {
  const resolution = String(wallpaper?.resolution || '')
  const match = resolution.match(/(\d+)\s*[xX]\s*(\d+)/)
  if (match) return numberValue(match[1]) * numberValue(match[2])
  return numberValue(wallpaper?.width) * numberValue(wallpaper?.height)
}

function compareWallpaper(a, b, mode) {
  if (mode === 'popular') {
    return (
      numberValue(b.favorites ?? b.favorite_count) - numberValue(a.favorites ?? a.favorite_count) ||
      numberValue(b.views) - numberValue(a.views)
    )
  }
  if (mode === 'views') return numberValue(b.views) - numberValue(a.views)
  if (mode === 'resolution') return wallpaperPixels(b) - wallpaperPixels(a)
  if (mode === 'id') return String(b.id || '').localeCompare(String(a.id || ''))
  return (
    wallpaperTimeValue(b) - wallpaperTimeValue(a) ||
    String(b.id || '').localeCompare(String(a.id || ''))
  )
}

function setViewDensity(value) {
  if (densityOptions.some((option) => option.value === value)) {
    viewDensity.value = value
    persistAuthorPageState()
  }
}

function toggleWaterfallLayout() {
  waterfallLayout.value = !waterfallLayout.value
  if (waterfallLayout.value && imageQuality.value === 'medium') {
    imageQuality.value = 'high'
  }
  persistAuthorPageState()
}

function cycleImageQuality() {
  const options = waterfallLayout.value ? waterfallQualityOptions : qualityOptions
  const index = options.findIndex((item) => item.key === imageQuality.value)
  const next = options[(index + 1) % options.length] || options[0]
  imageQuality.value = next.key
  persistAuthorPageState()
}

function isPurityEnabled(index) {
  return purityFilter.value[index] === '1'
}

function togglePurityFilter(index) {
  if (index === 2 && !settingsStore.settings?.show_nsfw) {
    notificationService.warning('需要在设置中启用 NSFW 内容', {
      duration: 3000,
      position: 'top-right',
    })
    return
  }

  const chars = purityFilter.value.split('')
  const next = chars[index] === '1' ? '0' : '1'
  chars[index] = next
  const candidate = chars.join('')
  if (candidate === '000') {
    notificationService.info('请至少保留一种纯净度', {
      duration: 2200,
      position: 'top-right',
    })
    return
  }
  purityFilter.value = candidate
  persistAuthorPageState()
}

function clearContentFilters() {
  sortMode.value = 'newest'
  purityFilter.value = defaultPurityFilter()
  persistAuthorPageState()
}

function selectSortMode(value) {
  sortMode.value = value
  sortMenuOpen.value = false
  persistAuthorPageState()
}

function handleSortMenuFocusout(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    sortMenuOpen.value = false
  }
}

function ensureSortModeForContext() {
  if (activeSortOptions.value.some((option) => option.value === sortMode.value)) return
  sortMode.value = 'newest'
}

async function copyText(text, message) {
  const value = String(text || '')
  if (!value) return

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    notificationService.success(message || '已复制')
  } catch {
    notificationService.error('复制失败')
  }
}

function copyAuthorQuery() {
  copyText(`@${username.value}`, '已复制作者查询')
}

function openAuthorSearch() {
  router.push({
    path: '/search',
    query: {
      query: `@${username.value}`,
      sorting: 'date_added',
      order: 'desc',
      page: 1,
    },
  })
}

function openWallhavenProfile() {
  if (!wallhavenUserPageUrl.value) return
  window.open(wallhavenUserPageUrl.value, '_blank', 'noopener,noreferrer')
}

function refreshAuthorPage() {
  const shouldLoadWallpapers = activeTab.value !== 'collections'
  loadUserData()
  if (!shouldLoadWallpapers) {
    wallpapers.value = []
    currentPage.value = 1
    totalPages.value = 1
  }
}

function getCollectionUrl(collection) {
  if (!username.value || !collection?.id) return wallhavenUserPageUrl.value
  return `https://wallhaven.cc/user/${encodeURIComponent(username.value)}/favorites/${encodeURIComponent(collection.id)}`
}

function copyCollectionLink(collection) {
  copyText(getCollectionUrl(collection), '已复制收藏集链接')
}

function openCollectionWallhaven(collection) {
  const url = getCollectionUrl(collection)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

// 加载用户数据
async function loadUserData() {
  if (isLoading.value) return
  if (!username.value?.trim()) {
    error.value = '无效的用户名'
    userData.value = null
    return
  }

  restoreAuthorPageState()
  isLoading.value = true
  error.value = ''

  try {
    wallhavenProfileUrl.value = ''
    publicProfile.value = null
    const response = await userApi.getUserInfo(username.value, { preferWallhavenFallback: true })

    if (response && response.success) {
      userData.value = response
      if (!publicProfile.value && response.publicProfile) {
        publicProfile.value = response.publicProfile
      }

      // 加载收藏集
      if (response.collections && response.collections.length > 0) {
        collections.value = uniqueCollections(response.collections)
      }
      restoreAuthorCollectionsState()

      // 加载壁纸
      if (activeTab.value !== 'collections') {
        loadWallpapers()
      }
    } else {
      error.value = (response && response.error) || '加载用户数据失败'
    }
  } catch (err) {
    const status = err.response?.status
    const serverMsg = err.response?.data?.error
    wallhavenProfileUrl.value =
      username.value && status === 404
        ? `https://wallhaven.cc/user/${encodeURIComponent(username.value)}`
        : ''

    if (status === 404) {
      error.value =
        serverMsg ||
        '当前接口无法加载用户资料（Wallhaven 代理不包含用户 API）。可在下方打开 Wallhaven 原站查看。'
    } else {
      error.value = serverMsg || err.message || '加载用户数据失败'
    }
  } finally {
    isLoading.value = false
  }
}

// 加载壁纸
async function loadWallpapers(page = 1, loadMore = false) {
  if (isLoadingWallpapers.value) return

  isLoadingWallpapers.value = true
  if (!loadMore) {
    wallpapersError.value = ''
    wallpapers.value = []
  }

  try {
    let response

    if (activeTab.value === 'uploads') {
      // 加载用户上传的壁纸
      response = await userApi.getUserUploads(username.value, page, {
        preferWallhavenFallback: true,
      })
    } else if (activeTab.value === 'favorites') {
      // 加载用户收藏的壁纸
      response = await userApi.getUserFavorites(
        username.value,
        page,
        selectedCollection.value ? selectedCollection.value.id : null,
        { preferWallhavenFallback: true },
      )
    }

    if (response && response.success) {
      if (loadMore) {
        // 添加到现有列表
        wallpapers.value = mergeUniqueById(wallpapers.value, response.images || [])
      } else {
        // 替换现有列表
        wallpapers.value = uniqueById(response.images || [])
      }

      // 更新分页信息
      if (response.meta) {
        currentPage.value = page
        totalPages.value = response.meta.last_page || 1
      }

      // 更新收藏集列表
      if (activeTab.value === 'favorites' && response.collections) {
        collections.value = uniqueCollections(response.collections)
        // Wallhaven 无「全部收藏」列表：未选收藏夹时默认选中第一个，与已加载列表一致
        if (!selectedCollection.value && response.collections.length > 0) {
          selectedCollection.value = collections.value[0]
        }
      }
    } else {
      wallpapersError.value = (response && response.error) || '加载壁纸失败'
      console.error('加载壁纸失败:', wallpapersError.value)
    }
  } catch (err) {
    console.error('加载壁纸失败:', err)
    wallpapersError.value = '加载壁纸失败: ' + (err.message || err)

    // 尝试从错误响应中获取更多信息
    if (err.response) {
      console.error('错误响应:', err.response)
      if (err.response.data) {
        console.error('错误数据:', err.response.data)
        wallpapersError.value = err.response.data.error || wallpapersError.value
      }
    }
  } finally {
    isLoadingWallpapers.value = false
  }
}

// 切换标签
function setActiveTab(tab) {
  if (activeTab.value === tab) return

  activeTab.value = tab
  selectedCollection.value = null
  showCollectionDetail.value = false
  currentCollection.value = null
  ensureSortModeForContext()
  currentPage.value = 1
  persistAuthorPageState()

  // 加载壁纸
  if (tab !== 'collections') {
    loadWallpapers(1)
  }
}

// 选择收藏集
function selectCollection(collection) {
  if (!collection) return
  selectedCollection.value = collection
  currentPage.value = 1
  persistAuthorPageState()

  // 加载壁纸
  loadWallpapers(1)
}

// 加载更多壁纸
function loadMore() {
  if (isLoadingWallpapers.value || currentPage.value >= totalPages.value) return

  // 加载下一页
  loadWallpapers(currentPage.value + 1, true)
}

// 关注作者：写入本机 Pinia，供「关注作者」页使用
async function followUser() {
  if (!username.value) return
  try {
    if (isFollowing.value) {
      userStore.unfollowUser(username.value)
      notificationService.success('已取消关注')
    } else {
      userStore.followUser(username.value)
      notificationService.success(
        userData.value?.wallhaven_mode ? '已关注（保存在本机，可在「关注作者」中查看）' : '已关注',
      )
    }
  } catch (err) {
    notificationService.error(err?.message || '关注操作失败')
  }
}

// 收藏用户合集（同上：远端接口不可用时仅本地）
async function followCollection() {
  if (!username.value) return
  const meta = {
    avatar_url: userData.value?.avatar_url || '',
    group: userData.value?.group || 'User',
  }
  try {
    if (isFollowingCollection.value) {
      userStore.unfollowCollection(username.value)
      notificationService.success('已取消收藏该作者合集')
    } else {
      userStore.followCollection(username.value, meta)
      notificationService.success(
        userData.value?.wallhaven_mode ? '已收藏该作者合集（保存在本机）' : '已收藏合集',
      )
    }
  } catch (err) {
    notificationService.error(err?.message || '收藏合集失败')
  }
}

// 预览壁纸
function previewImage(wallpaper) {
  if (!isPreviewEnabled.value) return
  const list = activePreviewList.value
  const index = list.findIndex((item) => String(item?.id) === String(wallpaper?.id))
  previewIndex.value = index
  previewWallpaper.value = index >= 0 ? list[index] : wallpaper
  showPreview.value = true
}

// 关闭预览
function closePreview() {
  showPreview.value = false
  previewIndex.value = -1
}

function setPreviewByIndex(index) {
  const list = activePreviewList.value
  if (!list.length) return

  const nextIndex = (index + list.length) % list.length
  previewIndex.value = nextIndex
  previewWallpaper.value = list[nextIndex]
}

function onPreviewNext() {
  setPreviewByIndex(previewIndex.value + 1)
}

function onPreviewPrevious() {
  setPreviewByIndex(previewIndex.value - 1)
}

// 查看收藏集
function viewCollection(collection) {
  activeTab.value = 'collections'
  currentCollection.value = collection
  showCollectionDetail.value = true
  ensureSortModeForContext()
  collectionCurrentPage.value = 1
  collectionWallpapers.value = []
  persistAuthorPageState()

  // 加载收藏集壁纸
  loadCollectionWallpapers()
}

// 返回收藏集列表
function backToCollections() {
  showCollectionDetail.value = false
  currentCollection.value = null
  collectionWallpapers.value = []
  persistAuthorPageState()
}

// 加载收藏集壁纸
async function loadCollectionWallpapers(page = 1, loadMore = false) {
  if (isLoadingCollectionWallpapers.value || !currentCollection.value) return

  isLoadingCollectionWallpapers.value = true
  if (!loadMore) {
    collectionWallpapersError.value = ''
    collectionWallpapers.value = []
  }

  try {
    // 加载收藏集壁纸
    const response = await userApi.getUserFavorites(
      username.value,
      page,
      currentCollection.value.id,
      { preferWallhavenFallback: true },
    )

    if (response && response.success) {
      if (loadMore) {
        // 添加到现有列表
        collectionWallpapers.value = mergeUniqueById(
          collectionWallpapers.value,
          response.images || [],
        )
      } else {
        // 替换现有列表
        collectionWallpapers.value = uniqueById(response.images || [])
      }

      // 更新分页信息
      if (response.meta) {
        collectionCurrentPage.value = page
        collectionTotalPages.value = response.meta.last_page || 1
      }
    } else {
      collectionWallpapersError.value = (response && response.error) || '加载收藏集壁纸失败'
      console.error('加载收藏集壁纸失败:', collectionWallpapersError.value)
    }
  } catch (err) {
    console.error('加载收藏集壁纸失败:', err)
    collectionWallpapersError.value = '加载收藏集壁纸失败: ' + (err.message || err)
  } finally {
    isLoadingCollectionWallpapers.value = false
  }
}

// 加载更多收藏集壁纸
function loadMoreCollectionWallpapers() {
  if (
    isLoadingCollectionWallpapers.value ||
    collectionCurrentPage.value >= collectionTotalPages.value
  )
    return

  // 加载下一页
  loadCollectionWallpapers(collectionCurrentPage.value + 1, true)
}

// 监听路由变化
watch(
  () => route.params.username,
  () => {
    loadUserData()
  },
)

async function downloadVisibleWallpapers() {
  if (!canDownloadAuthorPage.value) {
    notificationService.warning('作者页下载功能暂未开放', {
      duration: 3000,
      position: 'top-right',
    })
    return
  }

  const wallpapersToDownload = showCollectionDetail.value
    ? visibleCollectionWallpapers.value
    : visibleWallpapers.value

  if (isDownloading.value || wallpapersToDownload.length === 0) {
    if (wallpapersToDownload.length === 0) {
      notificationService.warning('当前没有可下载的壁纸', {
        duration: 3000,
        position: 'top-right',
      })
    }
    return
  }

  try {
    isDownloading.value = true
    downloadProgress.value = 0

    const result = await downloadWallpapersUnified(wallpapersToDownload, {
      scope: `${username.value || 'author'}-${activeTab.value}`,
      notify: true,
      options: {
        save_mode: 'custom',
        custom_folder: `${username.value || 'author'}-${activeTab.value}`,
      },
      onProgress: ({ percent }) => {
        downloadProgress.value = percent
      },
    })

    if (result.mode === 'cancelled') return

    if (result.count > 0) {
      const failText = result.failCount > 0 ? `，${result.failCount} 张失败` : ''
      if (result.mode === 'zip') {
        notificationService.success(`已打包 ${result.count} 张壁纸${failText}`, {
          duration: 5000,
          position: 'top-right',
        })
      }
    } else {
      notificationService.error('下载失败，没有成功下载的壁纸', {
        duration: 5000,
        position: 'top-right',
      })
    }
  } catch (error) {
    console.error('下载壁纸失败:', error)
    notificationService.error(`下载失败: ${error.message || '未知错误'}`, {
      duration: 5000,
      position: 'top-right',
    })
  } finally {
    isDownloading.value = false
    downloadProgress.value = 0
  }
}

function openZipNameDialog() {
  if (isDownloading.value) return
  void downloadVisibleWallpapers()
}

function openFavoriteAllDialog() {
  if (isFavoriting.value) return
  favoriteAllDialogVisible.value = true
}

function closeFavoriteAllDialog() {
  if (isFavoriting.value) return
  favoriteAllDialogVisible.value = false
}

async function collectFavoriteTargets() {
  let wallpapersToFavorite = []

  if (showCollectionDetail.value) {
    wallpapersToFavorite = uniqueById(collectionWallpapers.value)

    for (let page = 2; page <= collectionTotalPages.value; page++) {
      try {
        const response = await userApi.getUserFavorites(
          username.value,
          page,
          currentCollection.value?.id,
          { preferWallhavenFallback: true },
        )

        if (response?.success && response.images) {
          wallpapersToFavorite = mergeUniqueById(wallpapersToFavorite, response.images)
        }

        favoriteProgress.value = Math.round((page / collectionTotalPages.value) * 50)
      } catch (error) {
        console.error(`加载收藏集第${page}页壁纸失败:`, error)
      }
    }

    return wallpapersToFavorite
  }

  if (activeTab.value === 'favorites') {
    wallpapersToFavorite = uniqueById(wallpapers.value)

    for (let page = 2; page <= totalPages.value; page++) {
      try {
        const response = await userApi.getUserFavorites(
          username.value,
          page,
          selectedCollection.value?.id || null,
          { preferWallhavenFallback: true },
        )

        if (response?.success && response.images) {
          wallpapersToFavorite = mergeUniqueById(wallpapersToFavorite, response.images)
        }

        favoriteProgress.value = Math.round((page / totalPages.value) * 50)
      } catch (error) {
        console.error(`加载收藏第${page}页壁纸失败:`, error)
      }
    }

    return wallpapersToFavorite
  }

  if (activeTab.value === 'uploads') {
    wallpapersToFavorite = uniqueById(wallpapers.value)

    for (let page = 2; page <= totalPages.value; page++) {
      try {
        const response = await userApi.getUserUploads(username.value, page, {
          preferWallhavenFallback: true,
        })

        if (response?.success && response.images) {
          wallpapersToFavorite = mergeUniqueById(wallpapersToFavorite, response.images)
        }

        favoriteProgress.value = Math.round((page / totalPages.value) * 50)
      } catch (error) {
        console.error(`加载上传第${page}页壁纸失败:`, error)
      }
    }
  }

  return wallpapersToFavorite
}

// 收藏全部壁纸
async function favoriteAllWallpapers() {
  try {
    favoriteAllDialogVisible.value = false
    isFavoriting.value = true
    favoriteProgress.value = 0

    // 显示加载中通知
    notificationService.info(`正在准备收藏${favoriteAllTargetLabel.value}壁纸...`, {
      duration: 3000,
      position: 'top-right',
    })

    const wallpapersToFavorite = await collectFavoriteTargets()

    if (wallpapersToFavorite.length === 0) {
      notificationService.warning('当前没有可收藏的壁纸', {
        duration: 3000,
        position: 'top-right',
      })
      return
    }

    // 收藏壁纸
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < wallpapersToFavorite.length; i++) {
      const wallpaper = wallpapersToFavorite[i]

      try {
        // 检查是否已收藏
        if (!favoritesStore.isFavorited(wallpaper.id)) {
          // 添加到收藏
          const result = await favoritesStore.addFavorite(wallpaper)

          if (result) {
            successCount++
          } else {
            failCount++
          }
        } else {
          // 已收藏，跳过
          successCount++
        }
      } catch (error) {
        console.error(`收藏壁纸 ${wallpaper.id} 失败:`, error)
        failCount++
      }

      // 更新进度
      favoriteProgress.value = 50 + Math.round(((i + 1) / wallpapersToFavorite.length) * 50) // 后50%是收藏壁纸
    }

    // 显示收藏完成通知
    if (successCount > 0) {
      notificationService.success(`成功收藏 ${successCount} 张壁纸`, {
        duration: 5000,
        position: 'top-right',
      })
    }

    if (failCount > 0) {
      notificationService.error(`${failCount} 张壁纸收藏失败`, {
        duration: 5000,
        position: 'top-right',
      })
    }
  } catch (error) {
    console.error('收藏壁纸失败:', error)
    notificationService.error(`收藏失败: ${error.message || '未知错误'}`, {
      duration: 5000,
      position: 'top-right',
    })
  } finally {
    isFavoriting.value = false
    favoriteProgress.value = 100
  }
}

// 获取分组徽章样式
function getGroupBadgeClass(group) {
  switch (group) {
    case 'admin':
      return 'bg-danger'
    case 'moderator':
      return 'bg-warning'
    case 'premium':
      return 'bg-success'
    default:
      return 'bg-secondary'
  }
}

// 组件挂载时初始化
onBeforeMount(() => {
  document.documentElement.classList.add('author-gallery-page')
  void settingsStore.initSettings()
})

onMounted(() => {
  // 初始化stores
  userStore.initUserData()
  favoritesStore.initFavorites()
  void settingsStore.initSettings()

  // 加载用户数据
  loadUserData()
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('author-gallery-page')
})
</script>

<template>
  <div class="user-container author-page">
    <!-- 加载中 -->
    <div class="author-state author-state--loading" v-if="isLoading">
      <div class="author-state__spinner" role="status" aria-label="加载中"></div>
      <p>加载用户数据中...</p>
    </div>

    <!-- 错误提示 -->
    <div class="author-state author-state--error" v-else-if="error">
      <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
      <strong>{{ error }}</strong>
      <div v-if="wallhavenProfileUrl" class="author-state__actions">
        <a
          class="batch-button"
          :href="wallhavenProfileUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <i class="bi bi-box-arrow-up-right"></i> 在 Wallhaven 打开该用户
        </a>
      </div>
      <div class="author-state__actions">
        <router-link to="/" class="batch-button primary">
          <i class="bi bi-arrow-left"></i> 返回首页
        </router-link>
      </div>
    </div>

    <!-- 用户信息 -->
    <div v-else-if="userData" class="user-profile">
      <section class="author-header" :style="authorHeaderStyle">
        <div class="author-identity">
          <img :src="authorAvatarImage" :alt="username" class="user-avatar" />
          <div class="author-copy">
            <div class="author-meta">
              <span class="author-badge" :class="getGroupBadgeClass(userData.group)">
                {{ userData.group || 'User' }}
              </span>
              <span v-if="userData.wallhaven_mode" class="author-source">Wallhaven API</span>
            </div>
            <h1>{{ username }}</h1>
          </div>
        </div>

        <div class="author-showcase" v-if="heroWallpapers.length > 0" aria-hidden="true">
          <div class="showcase-track">
            <div
              v-for="(wallpaper, index) in heroWallpapers"
              :key="wallpaper.id || index"
              class="showcase-frame"
              :style="{ '--delay': `${index * 0.55}s` }"
            >
              <img :src="getWallpaperImage(wallpaper)" :alt="username" />
            </div>
          </div>
        </div>

        <div class="author-actions">
          <div class="author-main-actions">
            <button
              class="author-action primary"
              :class="{ active: isFollowing }"
              :title="
                userData.wallhaven_mode ? '关注仅保存在本机，仍可在关注作者中打开' : '关注该作者'
              "
              @click="followUser"
            >
              <i class="bi" :class="isFollowing ? 'bi-person-check' : 'bi-person-plus'"></i>
              <span>{{ isFollowing ? '已关注' : '关注' }}</span>
            </button>
            <button
              class="author-action"
              :class="{ active: isFollowingCollection }"
              :title="userData.wallhaven_mode ? '收藏合集仅保存在本机' : '收藏公开合集入口'"
              @click="followCollection"
            >
              <i
                class="bi"
                :class="isFollowingCollection ? 'bi-bookmark-check' : 'bi-bookmark-plus'"
              ></i>
              <span>{{ isFollowingCollection ? '已收藏合集' : '收藏合集' }}</span>
            </button>
          </div>
          <div class="author-icon-actions">
            <button class="icon-action" title="按作者搜索" @click="openAuthorSearch">
              <i class="bi bi-search"></i>
            </button>
            <button class="icon-action" title="复制作者查询" @click="copyAuthorQuery">
              <i class="bi bi-copy"></i>
            </button>
            <button class="icon-action" title="刷新作者数据" @click="refreshAuthorPage">
              <i class="bi bi-arrow-clockwise"></i>
            </button>
            <button class="icon-action" title="在 Wallhaven 打开" @click="openWallhavenProfile">
              <i class="bi bi-box-arrow-up-right"></i>
            </button>
          </div>
        </div>
      </section>

      <div class="author-workspace">
        <aside class="author-sidebar">
          <div class="sidebar-section public-profile-card" v-if="publicProfile">
            <span class="sidebar-label">星空云绘公开主页</span>
            <p v-if="publicProfile.user?.bio">{{ publicProfile.user.bio }}</p>
            <div class="public-stats">
              <span
                ><strong>{{ publicProfileStats?.favorites || 0 }}</strong
                >收藏</span
              >
              <span
                ><strong>{{ publicProfileStats?.collections || 0 }}</strong
                >集合</span
              >
              <span
                ><strong>{{ publicProfileTags.length }}</strong
                >标签</span
              >
            </div>
            <div class="public-tags">
              <button
                v-for="tag in publicProfileTags.slice(0, 8)"
                :key="tag.name"
                type="button"
                @click="
                  router.push({
                    name: 'search',
                    query: { query: tag.name, sorting: 'favorites', order: 'desc' },
                  })
                "
              >
                {{ tag.name }}
              </button>
            </div>
          </div>

          <div class="sidebar-section">
            <span class="sidebar-label">内容</span>
            <div class="section-tabs" role="tablist" aria-label="作者内容">
              <button
                v-for="tab in tabOptions"
                :key="tab.value"
                type="button"
                class="section-tab"
                :class="{ active: activeTab === tab.value }"
                @click="setActiveTab(tab.value)"
              >
                <i class="bi" :class="tab.icon"></i>
                <span>{{ tab.label }}</span>
                <strong>{{ tabCounts[tab.value] || 0 }}</strong>
              </button>
            </div>
          </div>

          <div class="sidebar-section" v-if="userCollections.length > 0">
            <span class="sidebar-label">收藏集</span>
            <button
              v-for="collection in userCollections.slice(0, 8)"
              :key="collection.id"
              type="button"
              class="collection-pill"
              :class="{ active: selectedCollection && selectedCollection.id === collection.id }"
              @click="
                activeTab === 'favorites'
                  ? selectCollection(collection)
                  : viewCollection(collection)
              "
            >
              <span>{{ collection.name }}</span>
              <strong>{{ collection.count || 0 }}</strong>
            </button>
          </div>
        </aside>

        <main ref="authorMainRef" class="author-main">
          <section v-if="publicProfile" class="public-highlight-strip">
            <button
              v-for="wallpaper in publicHighlights.slice(0, 6)"
              :key="wallpaper.id"
              type="button"
              @click="previewImage(wallpaper)"
            >
              <img :src="getWallpaperImage(wallpaper)" :alt="wallpaper.id" />
              <span>{{ wallpaper.id }}</span>
            </button>
          </section>

          <div class="content-toolbar">
            <div class="toolbar-controls">
              <div class="batch-status" v-if="activeTab !== 'collections' && wallpapers.length > 0">
                <i class="bi bi-layers"></i>
                <span
                  >当前页 {{ normalizedWallpapers.length }} 张，已显示
                  {{ visibleWallpapers.length }} 张</span
                >
              </div>

              <div class="sort-menu" @focusout="handleSortMenuFocusout">
                <button
                  type="button"
                  class="sort-trigger"
                  :class="{ active: sortMenuOpen }"
                  title="排序"
                  :aria-expanded="sortMenuOpen"
                  aria-haspopup="listbox"
                  @click="sortMenuOpen = !sortMenuOpen"
                >
                  <span>{{ activeSortLabel }}</span>
                  <i class="bi bi-chevron-down"></i>
                </button>
                <div v-if="sortMenuOpen" class="sort-options" role="listbox">
                  <button
                    v-for="option in activeSortOptions"
                    :key="option.value"
                    type="button"
                    class="sort-option"
                    :class="{ active: sortMode === option.value }"
                    role="option"
                    :aria-selected="sortMode === option.value"
                    @click="selectSortMode(option.value)"
                  >
                    <span>{{ option.label }}</span>
                    <i v-if="sortMode === option.value" class="bi bi-check2"></i>
                  </button>
                </div>
              </div>

              <div
                v-if="showPurityFilter"
                class="purity-filter"
                role="group"
                aria-label="纯净度过滤"
              >
                <button
                  v-for="option in PURITY_OPTIONS"
                  :key="option.key"
                  type="button"
                  class="purity-filter__btn"
                  :class="{
                    active: isPurityEnabled(option.index),
                    disabled: option.index === 2 && !settingsStore.settings?.show_nsfw,
                  }"
                  :title="
                    option.index === 2 && !settingsStore.settings?.show_nsfw
                      ? '需要在设置中启用 NSFW 内容'
                      : option.title
                  "
                  @click="togglePurityFilter(option.index)"
                >
                  {{ option.label }}
                </button>
              </div>

              <div class="density-switch" v-if="showDensitySwitch">
                <button
                  v-for="option in densityOptions"
                  :key="option.value"
                  type="button"
                  :class="{ active: viewDensity === option.value }"
                  :title="option.label"
                  @click="setViewDensity(option.value)"
                >
                  <i class="bi" :class="option.icon"></i>
                </button>
              </div>

              <button
                v-if="showDensitySwitch"
                type="button"
                class="favorite-action-button icon-only"
                :class="{ active: waterfallLayout }"
                :title="waterfallLayout ? '关闭瀑布流' : '开启瀑布流'"
                @click="toggleWaterfallLayout"
              >
                <i class="bi bi-water"></i>
                <span>{{ waterfallLayout ? '瀑布流' : '网格流' }}</span>
              </button>

              <button
                v-if="showDensitySwitch"
                type="button"
                class="favorite-action-button quality-trigger"
                :title="`图片画质：${activeImageQuality.label}`"
                @click="cycleImageQuality"
              >
                <i class="bi" :class="activeImageQuality.icon"></i>
                <span>{{ activeImageQuality.shortLabel }}</span>
              </button>

              <button
                type="button"
                class="icon-action subtle reset-filter"
                :class="{ active: hasContentFilters }"
                title="重置筛选"
                @click="clearContentFilters"
              >
                <i class="bi bi-eraser"></i>
              </button>

              <div
                class="batch-actions"
                v-if="activeTab !== 'collections' && wallpapers.length > 0"
              >
                <button
                  v-if="canDownloadAuthorPage"
                  class="batch-button primary"
                  @click="openZipNameDialog"
                  :disabled="isDownloading || isFavoriting"
                >
                  <i class="bi bi-download"></i>
                  <span>下载全部</span>
                </button>
                <button
                  v-if="activeTab === 'uploads'"
                  class="batch-button"
                  @click="openFavoriteAllDialog"
                  :disabled="isDownloading || isFavoriting"
                >
                  <i class="bi bi-heart-fill"></i>
                  <span>收藏全部</span>
                </button>
              </div>
            </div>
          </div>

          <div v-if="isDownloading && downloadProgress > 0" class="progress author-progress">
            <div
              class="progress-bar progress-bar-striped progress-bar-animated"
              role="progressbar"
              :style="{ width: downloadProgress + '%' }"
              :aria-valuenow="downloadProgress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              {{ downloadProgress }}%
            </div>
          </div>

          <div v-if="isFavoriting" class="progress author-progress">
            <div
              class="progress-bar progress-bar-striped progress-bar-animated bg-success"
              role="progressbar"
              :style="{ width: favoriteProgress + '%' }"
              :aria-valuenow="favoriteProgress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              {{ favoriteProgress }}%
            </div>
          </div>

          <!-- 壁纸内容 -->
          <div class="user-content" v-if="activeTab !== 'collections'">
            <WallpaperGrid
              :wallpapers="visibleWallpapers"
              :loading="isLoadingWallpapers"
              :error="wallpapersError"
              :infiniteScroll="true"
              :has-more="userWallpapersHasMore"
              :grid-columns="gridColumns"
              :waterfall-layout="waterfallLayout"
              :waterfall-quality="gridImageQuality"
              :image-quality="gridImageQuality"
              :card-actions="cardActionsLayout"
              :show-empty-state="false"
              :scroll-root="authorMainRef"
              :progressive-mount="true"
              :waterfall-initial-render-count="24"
              :waterfall-preload-px="1100"
              reveal-style="soft"
              reveal-strength="medium"
              @load-more="loadMore"
              @preview="previewImage"
            />

            <div
              class="empty-state"
              v-if="!isLoadingWallpapers && visibleWallpapers.length === 0 && !wallpapersError"
            >
              <i class="bi bi-image"></i>
              <p>{{ emptyContentMessage }}</p>
            </div>
          </div>

          <!-- 收藏集内容 -->
          <div class="user-collections" v-if="activeTab === 'collections'">
            <div v-if="!showCollectionDetail" class="collections-grid">
              <article
                v-for="collection in visibleCollections"
                :key="collection.id"
                class="collection-card"
              >
                <button
                  class="collection-preview"
                  type="button"
                  @click="viewCollection(collection)"
                >
                  <div
                    class="preview-grid"
                    v-if="collection.preview_images && collection.preview_images.length"
                  >
                    <img
                      v-for="(image, index) in collection.preview_images.slice(0, 4)"
                      :key="index"
                      :src="image.thumbnail"
                      :alt="collection.name"
                      class="preview-image"
                    />
                  </div>
                  <div v-else class="preview-empty">
                    <i class="bi bi-images"></i>
                  </div>
                </button>
                <div class="collection-body">
                  <div>
                    <h3>{{ collection.name }}</h3>
                    <p>{{ collection.count || 0 }} 张壁纸</p>
                  </div>
                  <div class="collection-actions">
                    <button type="button" title="查看收藏集" @click="viewCollection(collection)">
                      <i class="bi bi-grid"></i>
                    </button>
                    <button type="button" title="复制链接" @click="copyCollectionLink(collection)">
                      <i class="bi bi-copy"></i>
                    </button>
                    <button
                      type="button"
                      title="在 Wallhaven 打开"
                      @click="openCollectionWallhaven(collection)"
                    >
                      <i class="bi bi-box-arrow-up-right"></i>
                    </button>
                  </div>
                </div>
              </article>
            </div>

            <div v-if="showCollectionDetail" class="collection-detail">
              <div class="detail-toolbar">
                <button class="back-button" @click="backToCollections">
                  <i class="bi bi-arrow-left"></i>
                  <span>返回收藏集</span>
                </button>
                <div>
                  <h3>{{ currentCollection.name }}</h3>
                  <p>{{ currentCollection.count || visibleCollectionWallpapers.length }} 张壁纸</p>
                </div>
                <button
                  class="icon-action subtle"
                  title="在 Wallhaven 打开"
                  @click="openCollectionWallhaven(currentCollection)"
                >
                  <i class="bi bi-box-arrow-up-right"></i>
                </button>
              </div>

              <WallpaperGrid
                :wallpapers="visibleCollectionWallpapers"
                :loading="isLoadingCollectionWallpapers"
                :error="collectionWallpapersError"
                :infiniteScroll="true"
                :has-more="collectionWallpapersHasMore"
                :grid-columns="gridColumns"
                :waterfall-layout="waterfallLayout"
                :waterfall-quality="gridImageQuality"
                :image-quality="gridImageQuality"
                :card-actions="cardActionsLayout"
                :show-empty-state="false"
                :scroll-root="authorMainRef"
                :progressive-mount="true"
                :waterfall-initial-render-count="24"
                :waterfall-preload-px="1100"
                reveal-style="soft"
                reveal-strength="medium"
                @load-more="loadMoreCollectionWallpapers"
                @preview="previewImage"
              />

              <div
                class="empty-state"
                v-if="
                  !isLoadingCollectionWallpapers &&
                  visibleCollectionWallpapers.length === 0 &&
                  !collectionWallpapersError
                "
              >
                <i class="bi bi-image"></i>
                <p>{{ emptyContentMessage }}</p>
              </div>
            </div>

            <div
              class="empty-state"
              v-if="!showCollectionDetail && visibleCollections.length === 0"
            >
              <i class="bi bi-collection"></i>
              <p>{{ emptyContentMessage }}</p>
            </div>
          </div>
        </main>
      </div>
    </div>

    <!-- 壁纸预览 -->
    <WallpaperPreview
      v-if="isPreviewEnabled"
      :wallpaper="previewWallpaper"
      :show="showPreview"
      :enabled-actions="previewEnabledActions"
      :in-collection="previewInListContext"
      :collection-index="previewIndex >= 0 ? previewIndex : 0"
      :collection-total="activePreviewList.length"
      @close="closePreview"
      @next="onPreviewNext"
      @previous="onPreviewPrevious"
    />

    <div
      v-if="favoriteAllDialogVisible"
      class="author-modal-backdrop"
      role="presentation"
      @click.self="closeFavoriteAllDialog"
    >
      <section class="author-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="favorite-all-title">
        <div class="author-confirm-icon">
          <i class="bi bi-heart-fill"></i>
        </div>
        <div class="author-confirm-copy">
          <h2 id="favorite-all-title">收藏全部壁纸</h2>
          <p>
            将收藏{{ favoriteAllTargetLabel }}的壁纸，预计
            {{ favoriteAllEstimatedCount }} 张。多页数据会自动加载，过程可能需要一些时间。
          </p>
        </div>
        <div class="author-confirm-actions">
          <button type="button" class="batch-button" @click="closeFavoriteAllDialog">
            取消
          </button>
          <button type="button" class="batch-button primary" @click="favoriteAllWallpapers">
            开始收藏
          </button>
        </div>
      </section>
    </div>

  </div>
</template>
