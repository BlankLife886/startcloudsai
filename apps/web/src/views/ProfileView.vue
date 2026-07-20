<script setup>
import WallpaperPreview from '@/components/wallpaper/WallpaperFullscreenPreview.vue'
import { useFavoritesStore } from '@/stores/favorites'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useSettingsStore } from '@/stores/settings'
import { useUserStore } from '@/stores/user'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ActivitySummary from '@/components/profile/ActivitySummary.vue'
import CollectionsManager from '@/components/profile/CollectionsManager.vue'
import DownloadHistory from '@/components/profile/DownloadHistory.vue'
import ProfileAiAnalysis from '@/components/profile/ProfileAiAnalysis.vue'
import ProfileColoringHistory from '@/components/profile/ProfileColoringHistory.vue'
import ProfileIdentityPanel from '@/components/profile/ProfileIdentityPanel.vue'
import ProfileStudioUsage from '@/components/profile/ProfileStudioUsage.vue'
import ProfileWorkspaceHub from '@/components/profile/ProfileWorkspaceHub.vue'
import StatsAnalytics from '@/components/profile/StatsAnalytics.vue'
import UserProfileCard from '@/components/profile/UserProfileCard.vue'
import { buildProfileContinueCards } from '@/features/profile/profileHub'
import { useProfilePageMotion } from '@/features/profile/composables/useProfilePageMotion'
import { normalizeClientResourceSummary } from '@/features/pricing/pricingMoney.js'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { insightsApi } from '@/services/api'
import { getClientCommercePlans, getClientResourceSummary } from '@/services/aiWallpaper'
import { isCloudSyncEnabled } from '@/services/clientState'
import '@/styles/profile-console.css'

const favoritesStore = useFavoritesStore()
const authStore = useAuthStore()
const historyStore = useHistoryStore()
const userStore = useUserStore()
const settingsStore = useSettingsStore()
const runtimeConfigStore = useRuntimeConfigStore()
const route = useRoute()
const router = useRouter()
const { availableUsd, applyWalletFromSummary, refreshWalletBalance } = useClientWalletBalance()

const activeTab = ref('overview')
const isEditing = ref(false)
const sidebarVisible = ref(false)
const pageLoaded = ref(false)
const pageRef = ref(null)
const insights = ref(null)
const insightsLoading = ref(false)
const insightsError = ref('')
const insightsAuthRequired = ref(false)
const hubLoading = ref(false)
const resourceSummary = ref({})
const planCurrent = ref(null)

const previewWallpaper = ref(null)
const showPreview = ref(false)
const previewIndex = ref(-1)

const tabTransition = ref(false)
const { playSection } = useProfilePageMotion({ pageRef, ready: pageLoaded })

const navigationItems = [
  {
    id: 'overview',
    label: '概览',
    icon: 'bi-house-heart',
    title: '我的空间',
    description: '最近画面、创作入口与账户概览。',
    group: 'space',
  },
  {
    id: 'collections',
    label: '收藏夹',
    icon: 'bi-folder-heart',
    title: '我的收藏夹',
    description: '按主题整理灵感，快速管理不同视觉方向。',
    group: 'library',
  },
  {
    id: 'activity',
    label: '活动足迹',
    icon: 'bi-activity',
    title: '活动足迹',
    description: '最近浏览、收藏和关注行为的时间线。',
    group: 'library',
  },
  {
    id: 'downloads',
    label: '下载',
    icon: 'bi-download',
    title: '下载记录',
    description: '本地下载路径、最近任务与完整下载管理。',
    group: 'library',
  },
  {
    id: 'coloring-history',
    label: '染色作品',
    icon: 'bi-brush-fill',
    title: '染色作品',
    description: '插画染色历史，可提交到 Share 社区。',
    group: 'create',
  },
  {
    id: 'studio-usage',
    label: 'AI 用量',
    icon: 'bi-coin',
    title: 'AI 功能用量',
    description: '积分余额、消耗与扣减记录。',
    group: 'create',
  },
  {
    id: 'stats',
    label: '审美统计',
    icon: 'bi-bar-chart',
    title: '审美统计',
    description: '用数据看清你的审美偏好和浏览节奏。',
    group: 'taste',
  },
  {
    id: 'recommend',
    label: '智能推荐',
    icon: 'bi-compass',
    title: '智能推荐',
    description: '根据收藏和浏览画像，生成标签与壁纸推荐。',
    group: 'taste',
  },
  {
    id: 'ai',
    label: 'AI 洞察',
    icon: 'bi-stars',
    title: 'AI 洞察',
    description: '基于个人数据生成更深层的视觉偏好分析。',
    group: 'taste',
  },
]

const profileLayout = computed(() => runtimeConfigStore.getPageLayout('profile') || {})
const searchLayout = computed(() => runtimeConfigStore.getPageLayout('search') || {})
const previewLayout = computed(() => searchLayout.value.preview || {})

function isPreviewToolVisible(key) {
  return previewLayout.value?.enabled !== false && previewLayout.value?.[key]?.enabled !== false
}

const isPreviewEnabled = computed(
  () => searchLayout.value?.preview?.enabled !== false && previewLayout.value?.enabled !== false,
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
  download: runtimeConfigStore.canUse('download') && isPreviewToolVisible('download'),
  fullscreen: isPreviewToolVisible('fullscreen'),
}))
const profileSectionEnabled = computed(() => ({
  favorites:
    runtimeConfigStore.canUse('favorite') && profileLayout.value?.favorites?.enabled !== false,
  history: runtimeConfigStore.canUse('history') && profileLayout.value?.history?.enabled !== false,
  downloads:
    runtimeConfigStore.canUse('download') && profileLayout.value?.downloads?.enabled !== false,
  sync: runtimeConfigStore.canUse('sync') && profileLayout.value?.sync?.enabled !== false,
  aiRecords:
    runtimeConfigStore.canUse('ai.optimize') && profileLayout.value?.aiRecords?.enabled !== false,
}))

const visibleNavigationItems = computed(() =>
  navigationItems.filter((item) => {
    if (item.id === 'overview') return true
    if (item.id === 'collections') return profileSectionEnabled.value.favorites
    if (item.id === 'activity') {
      return profileSectionEnabled.value.favorites || profileSectionEnabled.value.history
    }
    if (item.id === 'downloads') return profileSectionEnabled.value.downloads
    if (item.id === 'stats') {
      return profileSectionEnabled.value.favorites || profileSectionEnabled.value.history
    }
    if (item.id === 'recommend' || item.id === 'ai') return profileSectionEnabled.value.aiRecords
    if (item.id === 'studio-usage' || item.id === 'coloring-history')
      return authStore.isAuthenticated
    return true
  }),
)

const navigationGroups = computed(() =>
  [
    {
      id: 'space',
      label: '空间',
      items: visibleNavigationItems.value.filter((item) => item.group === 'space'),
    },
    {
      id: 'library',
      label: '灵感库',
      items: visibleNavigationItems.value.filter((item) => item.group === 'library'),
    },
    {
      id: 'create',
      label: '创作台',
      items: visibleNavigationItems.value.filter((item) => item.group === 'create'),
    },
    {
      id: 'taste',
      label: '审美画像',
      items: visibleNavigationItems.value.filter((item) => item.group === 'taste'),
    },
  ].filter((group) => group.items.length > 0),
)

const cloudSyncEnabled = computed(() => isCloudSyncEnabled())
const downloadCount = computed(() => Number(settingsStore.settings.download_count || 0))
const hubWalletUsd = availableUsd

const profileDisplayName = computed(
  () =>
    authStore.displayName ||
    settingsStore.settings.display_name ||
    settingsStore.settings.username ||
    '创作者',
)

const userStats = computed(() => ({
  favorites: favoritesStore.favoritesCount,
  collections: favoritesStore.collections.length,
  history: historyStore.historyCount,
}))

const activeTabMeta = computed(
  () =>
    visibleNavigationItems.value.find((item) => item.id === activeTab.value) ||
    visibleNavigationItems.value[0] ||
    navigationItems[0],
)

const continueCards = computed(() =>
  buildProfileContinueCards({ favoritesCount: userStats.value.favorites }),
)

const categoryLabels = {
  general: '一般',
  anime: '动漫',
  people: '人物',
}

const recentWallpapers = computed(() => {
  const merged = []
  if (profileSectionEnabled.value.favorites) {
    merged.push(
      ...favoritesStore.favorites.map((item) => ({
        ...item,
        profile_source: '收藏',
        profile_time: item.favorited_at || item.created_at || item.added_at,
      })),
    )
  }
  if (profileSectionEnabled.value.history) {
    merged.push(
      ...historyStore.history.map((item) => ({
        ...item,
        profile_source: '浏览',
        profile_time: item.viewed_at || item.updated_at,
      })),
    )
  }

  const seen = new Set()
  return merged
    .filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => new Date(b.profile_time || 0) - new Date(a.profile_time || 0))
    .slice(0, 8)
})

const previewWallpapers = computed(() => {
  const merged = [...recentWallpapers.value]
  if (profileSectionEnabled.value.favorites) merged.push(...favoritesStore.favorites)
  if (profileSectionEnabled.value.history) merged.push(...historyStore.history)

  const seen = new Set()
  return merged.filter((item) => {
    if (!item?.id || seen.has(String(item.id))) return false
    seen.add(String(item.id))
    return true
  })
})

const previewInListContext = computed(
  () => showPreview.value && previewIndex.value >= 0 && previewWallpapers.value.length > 1,
)

const colorPalette = computed(() => {
  const colorCount = {}
  favoritesStore.favorites.forEach((item) => {
    if (!Array.isArray(item.colors)) return
    item.colors.forEach((color) => {
      colorCount[color] = (colorCount[color] || 0) + 1
    })
  })
  return Object.entries(colorCount)
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
})

const categoryProfile = computed(() => {
  const total = favoritesStore.favorites.length || 1
  const counts = favoritesStore.favorites.reduce((acc, item) => {
    const key = item.category || 'other'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .map(([key, count]) => ({
      key,
      label: categoryLabels[key] || '其他',
      count,
      ratio: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
})

const weeklyActivity = computed(() => {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recentViews = historyStore.history.filter(
    (item) => new Date(item.viewed_at || 0).getTime() >= weekAgo,
  ).length
  const recentFavorites = favoritesStore.favorites.filter(
    (item) => new Date(item.favorited_at || item.created_at || 0).getTime() >= weekAgo,
  ).length
  return {
    views: recentViews,
    favorites: recentFavorites,
    total: recentViews + recentFavorites,
  }
})

const profileCompleteness = computed(() => {
  const settings = settingsStore.settings || {}
  const fields = [
    settings.username,
    settings.display_name,
    settings.bio,
    settings.avatar_url,
    settings.location,
    settings.website,
    settings.social_links?.github ||
      settings.social_links?.twitter ||
      settings.social_links?.instagram,
  ]
  const filled = fields.filter(Boolean).length
  return Math.round((filled / fields.length) * 100)
})

const topCollections = computed(() =>
  [...favoritesStore.collections].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 3),
)

const collectionHealth = computed(() => {
  const collections = favoritesStore.collections
  const totalCollections = collections.length
  const emptyCollections = collections.filter((collection) => !collection.count).length
  return {
    totalCollections,
    emptyCollections,
  }
})

const insightProfile = computed(() => insights.value?.profile || null)
const autoTags = computed(() => insights.value?.tags || insightProfile.value?.tags || [])
const insightRecommendations = computed(() => insights.value?.recommendations || [])
const insightSearches = computed(
  () => insights.value?.querySuggestions || insights.value?.suggestedSearches || [],
)
const insightClusters = computed(() => insights.value?.clusters || [])
const insightStats = computed(() => insightProfile.value?.totals || null)
const publicProfilePath = computed(() => {
  const username = settingsStore.settings.username || settingsStore.settings.display_name || ''
  return username ? `/user/${encodeURIComponent(username)}` : ''
})
const publicProfileUrl = computed(() => {
  if (!publicProfilePath.value) return ''
  if (typeof window === 'undefined') return publicProfilePath.value
  return new URL(publicProfilePath.value, window.location.origin).href
})

function getNavBadge(id) {
  if (id === 'collections') return userStats.value.collections || ''
  if (id === 'activity') return weeklyActivity.value.total || ''
  if (id === 'downloads') return downloadCount.value || ''
  if (id === 'recommend') return autoTags.value.length || ''
  return ''
}

function getWallpaperThumb(wallpaper) {
  return (
    wallpaper?.thumbnail || wallpaper?.thumbs?.small || wallpaper?.thumbs?.large || wallpaper?.path
  )
}

function formatProfileTime(value) {
  if (!value) return '刚刚'
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}天前`
  if (hours > 0) return `${hours}小时前`
  if (minutes > 0) return `${minutes}分钟前`
  return '刚刚'
}

const overviewTrajectory = computed(() =>
  recentWallpapers.value.slice(0, 8).map((wallpaper, index) => ({
    wallpaper,
    index: index + 1,
    thumb: getWallpaperThumb(wallpaper),
    source: wallpaper.profile_source,
    time: formatProfileTime(wallpaper.profile_time),
  })),
)

const sectionPulse = computed(() => {
  if (activeTab.value === 'collections') {
    return { value: collectionHealth.value.totalCollections, label: '收藏夹' }
  }
  if (activeTab.value === 'activity') {
    return { value: weeklyActivity.value.total, label: '本周动态' }
  }
  if (activeTab.value === 'downloads') {
    return { value: downloadCount.value, label: '累计下载' }
  }
  if (activeTab.value === 'stats') {
    return { value: colorPalette.value.length || 0, label: '色板' }
  }
  if (activeTab.value === 'recommend') {
    return { value: autoTags.value.length || '—', label: '画像标签' }
  }
  if (activeTab.value === 'studio-usage') {
    return { value: 'AI', label: '用量' }
  }
  return null
})

watch(
  visibleNavigationItems,
  (items) => {
    if (!items.some((item) => item.id === activeTab.value)) {
      activeTab.value = items[0]?.id || 'overview'
    }
    syncRouteTab()
  },
  { immediate: true },
)

watch(
  () => route.query.tab,
  () => syncRouteTab(),
)

watch(
  () => route.path,
  (path) => {
    if (path === '/profile' && authStore.isAuthenticated) {
      void refreshWalletBalance({ force: true })
    }
  },
)

watch(
  () => authStore.isAuthenticated,
  (isAuthenticated) => {
    if (!isAuthenticated) {
      if (route.query.tab === 'account') {
        replaceProfileAccountUrl()
        router.replace('/profile').catch(() => {})
      }
      resourceSummary.value = {}
      planCurrent.value = null
      return
    }
    void loadWorkspaceHub()
    syncRouteTab()
  },
)

const mobileViewport = ref(typeof window !== 'undefined' ? window.innerWidth < 1024 : false)

function setActiveTab(tab) {
  if (!visibleNavigationItems.value.some((item) => item.id === tab)) {
    activeTab.value = visibleNavigationItems.value[0]?.id || 'overview'
    return
  }
  if (activeTab.value === tab) return

  activeTab.value = tab
  tabTransition.value = true
  const body = document.querySelector('.profile-console__body')
  if (body) body.scrollTop = 0
  window.requestAnimationFrame(() => {
    tabTransition.value = false
  })
  void nextTick(() => playSection({ soft: false }))

  if (mobileViewport.value) toggleSidebar(false)

  if (tab === 'recommend' || tab === 'overview') void loadInsights()
}

function openContinueCard(card) {
  if (card?.tab) {
    setActiveTab(card.tab)
    return
  }
  if (card?.to) router.push(card.to)
}

function toggleSidebar(forceState = null) {
  sidebarVisible.value = forceState !== null ? forceState : !sidebarVisible.value
}

function toggleEditMode() {
  isEditing.value = !isEditing.value
}

function handleSaveProfile() {
  isEditing.value = false
}

function handleCancelEdit() {
  isEditing.value = false
}

async function loadWorkspaceHub() {
  if (!authStore.isAuthenticated) return
  hubLoading.value = true
  try {
    const [resourcesResult, plansResult] = await Promise.allSettled([
      getClientResourceSummary(),
      getClientCommercePlans(),
    ])
    if (resourcesResult.status === 'fulfilled' && resourcesResult.value?.summary) {
      resourceSummary.value = normalizeClientResourceSummary(resourcesResult.value.summary)
      applyWalletFromSummary(resourceSummary.value)
    }
    if (plansResult.status === 'fulfilled') {
      planCurrent.value = plansResult.value?.current || null
    }
  } catch (error) {
    console.error('加载账号工作台失败:', error)
  } finally {
    hubLoading.value = false
  }
}

async function loadInsights(force = false) {
  if (insightsLoading.value) return
  if (insights.value && !force) return

  insightsLoading.value = true
  insightsError.value = ''
  insightsAuthRequired.value = false

  try {
    await authStore.initAuth().catch(() => null)
    if (!authStore.isAuthenticated) {
      insightsAuthRequired.value = true
      return
    }

    const [autoTagsResult, recommendationsResult] = await Promise.all([
      insightsApi.getAutoTags(),
      insightsApi.getRecommendations(18),
    ])
    insights.value = {
      ...autoTagsResult,
      ...recommendationsResult,
      tags: autoTagsResult?.tags || recommendationsResult?.profile?.tags || [],
      clusters: autoTagsResult?.clusters || [],
      suggestedSearches: autoTagsResult?.suggestedSearches || [],
    }
  } catch (error) {
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      insightsAuthRequired.value = true
      insightsError.value = ''
    } else {
      insightsError.value = error?.message || '加载推荐画像失败'
    }
  } finally {
    insightsLoading.value = false
  }
}

function goLoginForInsights() {
  router.push({
    name: 'auth',
    query: { mode: 'login', redirect: '/profile?tab=recommend' },
  })
}

function openInsightSearch(item) {
  const query = item?.query || item?.name || item?.label || ''
  const routeQuery = { page: 1, sorting: 'favorites', order: 'desc' }
  if (query) routeQuery.query = query
  if (item?.color) routeQuery.color = String(item.color).replace('#', '')
  router.push({ name: 'search', query: routeQuery })
}

function openPublicProfile() {
  if (publicProfilePath.value) router.push(publicProfilePath.value)
  else toggleEditMode()
}

function syncRouteTab() {
  const requestedTab = String(route.query.tab || '').trim()
  if (!requestedTab) return
  if (requestedTab === 'account') {
    replaceProfileAccountUrl()
    router.replace('/profile').catch(() => {})
    return
  }
  if (visibleNavigationItems.value.some((item) => item.id === requestedTab)) {
    activeTab.value = requestedTab
  }
}

function replaceProfileAccountUrl() {
  if (typeof window === 'undefined') return
  if (window.location.pathname === '/profile' && window.location.search.includes('tab=account')) {
    window.history.replaceState(window.history.state, '', '/profile')
  }
}

function previewImage(wallpaper) {
  if (!wallpaper || !isPreviewEnabled.value) return
  const list = previewWallpapers.value
  const index = list.findIndex((item) => String(item.id) === String(wallpaper?.id))

  if (index >= 0) {
    previewIndex.value = index
    previewWallpaper.value = list[index]
  } else {
    previewIndex.value = -1
    previewWallpaper.value = wallpaper
  }
  showPreview.value = true
}

function closePreview() {
  showPreview.value = false
  previewWallpaper.value = null
  previewIndex.value = -1
}

function setPreviewByIndex(index) {
  const list = previewWallpapers.value
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

function handleResize() {
  mobileViewport.value = window.innerWidth < 1024
  if (window.innerWidth >= 1024) sidebarVisible.value = false
}

onMounted(() => {
  syncRouteTab()
  if (activeTab.value === 'recommend') void loadInsights()

  Promise.allSettled([
    authStore.initAuth(),
    runtimeConfigStore.loadRuntimeConfig(),
    favoritesStore.initFavorites(),
    historyStore.initHistory(),
    userStore.initUserData(),
    settingsStore.initSettings(),
    loadWorkspaceHub(),
  ]).then((results) => {
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) console.error('初始化个人中心数据失败:', failed.reason)
    syncRouteTab()
    pageLoaded.value = true
    if (activeTab.value === 'overview') void loadInsights()
  })

  window.addEventListener('resize', handleResize)
  handleResize()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div
    ref="pageRef"
    class="profile-console"
    :class="{ 'page-loaded': pageLoaded, 'is-ready': pageLoaded }"
  >
    <div class="profile-console__ambient profile-console__ambient--a" aria-hidden="true"></div>
    <div class="profile-console__ambient profile-console__ambient--b" aria-hidden="true"></div>
    <div class="profile-console__ambient profile-console__ambient--stars" aria-hidden="true"></div>

    <div
      v-if="mobileViewport && sidebarVisible"
      class="profile-console__backdrop"
      @click="toggleSidebar(false)"
    ></div>

    <div class="profile-console__shell">
      <aside class="profile-console__aside" :class="{ 'is-open': sidebarVisible }">
        <button
          v-if="mobileViewport"
          type="button"
          class="profile-console__aside-close"
          aria-label="关闭菜单"
          @click="toggleSidebar(false)"
        >
          <i class="bi bi-x-lg"></i>
        </button>

        <ProfileIdentityPanel
          :balance-usd="hubWalletUsd"
          :sync-enabled="cloudSyncEnabled"
          :completeness="profileCompleteness"
          :public-profile-path="publicProfilePath"
          :bio="settingsStore.settings.bio || ''"
          @edit="toggleEditMode"
          @open-public="openPublicProfile"
        />

        <div
          v-for="group in navigationGroups"
          :key="group.id"
          class="profile-console__nav-group"
          data-pf-rail
        >
          <span class="profile-console__nav-label">{{ group.label }}</span>
          <nav class="profile-console__nav" :aria-label="group.label">
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              class="profile-console__nav-item"
              :class="{ 'is-active': activeTab === item.id }"
              @click="setActiveTab(item.id)"
            >
              <i class="bi" :class="item.icon"></i>
              <span>{{ item.label }}</span>
              <small v-if="getNavBadge(item.id)" class="profile-console__nav-badge">
                {{ getNavBadge(item.id) }}
              </small>
            </button>
          </nav>
        </div>

        <div class="profile-rail-foot" data-pf-rail>
          <button
            type="button"
            class="profile-rail-foot__link"
            @click="router.push({ name: 'settings' })"
          >
            <i class="bi bi-sliders"></i>
            应用设置
          </button>
          <button
            type="button"
            class="profile-rail-foot__link"
            @click="router.push({ name: 'pricing' })"
          >
            <i class="bi bi-wallet2"></i>
            钱包与套餐
          </button>
        </div>
      </aside>

      <main class="profile-console__main">
        <header v-if="mobileViewport" class="profile-console__mobile-bar">
          <button
            type="button"
            class="profile-console__menu-btn"
            aria-label="打开菜单"
            @click="toggleSidebar()"
          >
            <i class="bi bi-list"></i>
          </button>
          <div class="profile-console__mobile-title">
            <strong>{{ activeTab === 'overview' ? `你好，${profileDisplayName}` : activeTabMeta.title }}</strong>
            <small>{{ activeTabMeta.description }}</small>
          </div>
        </header>

        <div
          v-if="mobileViewport"
          class="profile-console__tabs"
          role="tablist"
          aria-label="个人中心标签"
        >
          <button
            v-for="item in visibleNavigationItems"
            :key="`tab-${item.id}`"
            type="button"
            role="tab"
            class="profile-console__tab"
            :class="{ 'is-active': activeTab === item.id }"
            :aria-selected="activeTab === item.id"
            @click="setActiveTab(item.id)"
          >
            <i class="bi" :class="item.icon"></i>
            {{ item.label }}
          </button>
        </div>

        <div class="profile-console__body" :class="{ 'is-transitioning': tabTransition }">
          <!-- Overview -->
          <div v-if="activeTab === 'overview'" class="profile-console__section profile-lounge">
            <header class="profile-lounge__hero" data-pf-motion>
              <p class="profile-lounge__eyebrow">我的空间</p>
              <h2 class="profile-lounge__hello">你好，{{ profileDisplayName }}</h2>
              <p class="profile-lounge__lead">
                从最近的画面继续。收藏、染色、壁纸与社区都在这里。
              </p>
            </header>

            <section class="profile-lounge__gallery" data-pf-motion aria-label="最近画面">
              <div class="profile-lounge__gallery-head">
                <div>
                  <h3>最近画面</h3>
                  <p>
                    {{
                      overviewTrajectory.length
                        ? `${overviewTrajectory.length} 条近期动态`
                        : '还没有画面足迹'
                    }}
                  </p>
                </div>
                <button
                  v-if="overviewTrajectory.length"
                  type="button"
                  class="profile-lounge__link"
                  @click="setActiveTab('activity')"
                >
                  查看活动
                  <i class="bi bi-arrow-right"></i>
                </button>
              </div>

              <div v-if="overviewTrajectory.length" class="profile-lounge__shots">
                <button
                  v-for="item in overviewTrajectory"
                  :key="item.wallpaper.id"
                  type="button"
                  class="profile-lounge__shot"
                  data-pf-shot
                  @click="previewImage(item.wallpaper)"
                >
                  <img
                    :src="item.thumb"
                    :alt="item.wallpaper.id"
                    loading="lazy"
                    decoding="async"
                  />
                  <span>{{ item.source }} · {{ item.time }}</span>
                </button>
              </div>
              <div v-else class="profile-lounge__empty">
                <i class="bi bi-images"></i>
                <div>
                  <strong>还没有最近画面</strong>
                  <p>去浏览或收藏几张壁纸，这里会变成你的私人画廊入口。</p>
                </div>
                <button
                  type="button"
                  class="profile-lounge__btn profile-lounge__btn--primary"
                  @click="router.push({ name: 'search' })"
                >
                  去浏览壁纸
                </button>
              </div>

              <div
                v-if="categoryProfile.length || colorPalette.length"
                class="profile-taste-strip"
                data-pf-motion
              >
                <div v-if="categoryProfile.length" class="profile-taste-strip__cats">
                  <span
                    v-for="item in categoryProfile.slice(0, 3)"
                    :key="item.key"
                    class="profile-taste-strip__cat"
                  >
                    {{ item.label }} {{ item.ratio }}%
                  </span>
                </div>
                <div v-if="colorPalette.length" class="profile-taste-strip__colors">
                  <span
                    v-for="item in colorPalette"
                    :key="item.color"
                    :style="{ backgroundColor: item.color }"
                    :title="`${item.color} · ${item.count}`"
                  ></span>
                </div>
                <button
                  type="button"
                  class="profile-taste-strip__link"
                  @click="setActiveTab('recommend')"
                >
                  智能推荐
                  <i class="bi bi-arrow-right"></i>
                </button>
              </div>
            </section>

            <section class="profile-continue" data-pf-motion aria-label="继续创作">
              <div class="profile-continue__head">
                <h3>继续创作</h3>
                <p>连接全站核心能力</p>
              </div>
              <div class="profile-continue__grid">
                <button
                  v-for="card in continueCards"
                  :key="card.id"
                  type="button"
                  class="profile-continue__card"
                  :data-tone="card.tone"
                  @click="openContinueCard(card)"
                >
                  <span class="profile-continue__icon"><i class="bi" :class="card.icon"></i></span>
                  <strong>{{ card.label }}</strong>
                  <small>{{ card.desc }}</small>
                </button>
              </div>
            </section>

            <div data-pf-motion>
              <ProfileWorkspaceHub
                :loading="hubLoading"
                :resource-summary="resourceSummary"
                :plan-current="planCurrent"
                :sync-enabled="cloudSyncEnabled"
                :download-count="downloadCount"
                :downloads-enabled="profileSectionEnabled.downloads"
              />
            </div>
          </div>

          <!-- Collections -->
          <div
            v-if="activeTab === 'collections' && profileSectionEnabled.favorites"
            class="profile-console__section"
          >
            <header class="profile-section-intro" data-pf-motion>
              <div>
                <span class="profile-section-intro__kicker">Library</span>
                <h2 class="profile-section-intro__title">我的收藏夹</h2>
                <p class="profile-section-intro__desc">
                  {{ userStats.collections }} 个主题 · {{ userStats.favorites }} 张收藏
                  <template v-if="collectionHealth.emptyCollections">
                    · {{ collectionHealth.emptyCollections }} 个待补充
                  </template>
                </p>
              </div>
              <div v-if="topCollections[0]" class="profile-section-intro__pulse">
                <strong>{{ topCollections[0].count || 0 }}</strong>
                <small>最大：{{ topCollections[0].name }}</small>
              </div>
            </header>
            <CollectionsManager :limit="12" @preview-wallpaper="previewImage" />
          </div>

          <!-- Activity -->
          <div
            v-if="
              activeTab === 'activity' &&
              (profileSectionEnabled.favorites || profileSectionEnabled.history)
            "
            class="profile-console__section"
          >
            <header class="profile-section-intro" data-pf-motion>
              <div>
                <span class="profile-section-intro__kicker">Activity</span>
                <h2 class="profile-section-intro__title">活动足迹</h2>
                <p class="profile-section-intro__desc">
                  本周 {{ weeklyActivity.views }} 浏览 · {{ weeklyActivity.favorites }} 收藏
                </p>
              </div>
              <div v-if="sectionPulse" class="profile-section-intro__pulse">
                <strong>{{ sectionPulse.value }}</strong>
                <small>{{ sectionPulse.label }}</small>
              </div>
            </header>

            <div v-if="recentWallpapers.length" class="profile-activity-rail" data-pf-motion>
              <button
                v-for="wallpaper in recentWallpapers.slice(0, 8)"
                :key="wallpaper.id"
                type="button"
                data-pf-shot
                @click="previewImage(wallpaper)"
              >
                <img :src="getWallpaperThumb(wallpaper)" :alt="wallpaper.id" />
                <span>{{ wallpaper.profile_source }}</span>
              </button>
            </div>

            <ActivitySummary :limit="20" @preview-wallpaper="previewImage" />
          </div>

          <!-- Downloads -->
          <div
            v-if="activeTab === 'downloads' && profileSectionEnabled.downloads"
            class="profile-console__section"
          >
            <header class="profile-section-intro" data-pf-motion>
              <div>
                <span class="profile-section-intro__kicker">Downloads</span>
                <h2 class="profile-section-intro__title">下载记录</h2>
                <p class="profile-section-intro__desc">
                  最近下载与保存路径。完整批量任务请前往下载管理页。
                </p>
              </div>
              <button
                type="button"
                class="profile-section-intro__action"
                @click="router.push({ name: 'downloads' })"
              >
                <i class="bi bi-box-arrow-up-right"></i>
                完整下载页
              </button>
            </header>
            <DownloadHistory :limit="8" @preview-wallpaper="previewImage" />
          </div>

          <!-- Stats -->
          <div
            v-if="
              activeTab === 'stats' &&
              (profileSectionEnabled.favorites || profileSectionEnabled.history)
            "
            class="profile-console__section"
          >
            <header class="profile-section-intro" data-pf-motion>
              <div>
                <span class="profile-section-intro__kicker">Taste</span>
                <h2 class="profile-section-intro__title">审美统计</h2>
                <p class="profile-section-intro__desc">
                  用收藏与浏览数据看清你的审美偏好。
                </p>
              </div>
              <div v-if="sectionPulse" class="profile-section-intro__pulse">
                <strong>{{ sectionPulse.value }}</strong>
                <small>{{ sectionPulse.label }}</small>
              </div>
            </header>

            <div class="profile-taste-preview" data-pf-motion>
              <div v-if="categoryProfile.length" class="profile-taste-preview__bars">
                <div v-for="item in categoryProfile" :key="item.key">
                  <span>{{ item.label }}</span>
                  <div><em :style="{ width: `${item.ratio}%` }"></em></div>
                  <strong>{{ item.ratio }}%</strong>
                </div>
              </div>
              <div v-if="colorPalette.length" class="profile-taste-preview__colors">
                <span
                  v-for="item in colorPalette"
                  :key="item.color"
                  :style="{ backgroundColor: item.color }"
                  :title="`${item.color} · ${item.count}`"
                ></span>
              </div>
            </div>

            <StatsAnalytics />
          </div>

          <!-- Recommend -->
          <div
            v-if="activeTab === 'recommend' && profileSectionEnabled.aiRecords"
            class="profile-console__section"
          >
            <header class="profile-section-intro" data-pf-motion>
              <div>
                <span class="profile-section-intro__kicker">Recommend</span>
                <h2 class="profile-section-intro__title">智能推荐</h2>
                <p class="profile-section-intro__desc">
                  根据收藏与浏览画像，生成标签与壁纸推荐。
                </p>
              </div>
              <div class="profile-section-intro__actions">
                <button
                  type="button"
                  class="profile-section-intro__action"
                  :disabled="insightsLoading"
                  @click="loadInsights(true)"
                >
                  <i class="bi bi-arrow-clockwise"></i>
                  刷新
                </button>
                <button
                  type="button"
                  class="profile-section-intro__action"
                  @click="openPublicProfile"
                >
                  <i class="bi bi-person-badge"></i>
                  公开主页
                </button>
              </div>
            </header>

            <section class="insight-panel" data-pf-motion>
              <div v-if="insightsLoading" class="profile-empty-note">
                <i class="bi bi-arrow-repeat spin"></i>
                <span>正在从云端收藏和浏览记录生成推荐画像。</span>
              </div>
              <div v-else-if="insightsAuthRequired" class="profile-empty-note insight-login-note">
                <i class="bi bi-person-lock"></i>
                <span>登录后可读取云端收藏、浏览历史和集合，生成推荐画像。</span>
                <button type="button" class="mini-action" @click="goLoginForInsights">
                  <i class="bi bi-box-arrow-in-right"></i>
                  <span>去登录</span>
                </button>
              </div>
              <div v-else-if="insightsError" class="profile-empty-note">
                <i class="bi bi-exclamation-triangle"></i>
                <span>{{ insightsError }}</span>
              </div>
              <div v-else-if="!insights" class="profile-empty-note">
                <i class="bi bi-cloud-check"></i>
                <span>打开后会读取云端收藏、历史和集合，生成标签画像与推荐壁纸。</span>
              </div>
              <div v-else class="insight-grid">
                <div class="insight-summary">
                  <div>
                    <strong>{{ insightStats?.favorites || 0 }}</strong>
                    <span>收藏样本</span>
                  </div>
                  <div>
                    <strong>{{ insightStats?.history || 0 }}</strong>
                    <span>浏览样本</span>
                  </div>
                  <div>
                    <strong>{{ autoTags.length }}</strong>
                    <span>标签</span>
                  </div>
                </div>

                <div class="insight-tags">
                  <button
                    v-for="tag in autoTags.slice(0, 14)"
                    :key="tag.name"
                    type="button"
                    @click="openInsightSearch(tag)"
                  >
                    <span>{{ tag.name }}</span>
                    <em>{{ tag.count }}</em>
                  </button>
                </div>

                <div v-if="insightClusters.length" class="insight-clusters">
                  <div v-for="cluster in insightClusters" :key="cluster.id">
                    <strong>{{ cluster.label }}</strong>
                    <span>{{
                      cluster.tags
                        .map((tag) => tag.name)
                        .slice(0, 5)
                        .join(' / ')
                    }}</span>
                  </div>
                </div>

                <div class="insight-searches">
                  <button
                    v-for="item in insightSearches.slice(0, 10)"
                    :key="`${item.source}-${item.label}`"
                    type="button"
                    @click="openInsightSearch(item)"
                  >
                    <span
                      v-if="item.color"
                      class="color-dot"
                      :style="{ backgroundColor: item.color }"
                    ></span>
                    <i v-else class="bi bi-search"></i>
                    <span>{{ item.label }}</span>
                  </button>
                </div>
              </div>
            </section>

            <section v-if="insightRecommendations.length" class="recommendation-strip" data-pf-motion>
              <button
                v-for="item in insightRecommendations.slice(0, 12)"
                :key="item.wallpaper.id"
                type="button"
                data-pf-shot
                @click="previewImage(item.wallpaper)"
              >
                <img :src="getWallpaperThumb(item.wallpaper)" :alt="item.wallpaper.id" />
                <span>{{ item.wallpaper.id }}</span>
                <small>{{ item.reasons?.[0] || '画像相似' }}</small>
              </button>
            </section>

            <section v-if="publicProfileUrl" class="public-profile-note" data-pf-motion>
              <i class="bi bi-globe2"></i>
              <div>
                <strong>公开主页地址</strong>
                <span>{{ publicProfileUrl }}</span>
              </div>
            </section>
          </div>

          <!-- AI -->
          <div
            v-if="activeTab === 'ai' && profileSectionEnabled.aiRecords"
            class="profile-console__section profile-console__section--ai"
          >
            <ProfileAiAnalysis />
          </div>

          <!-- Studio usage -->
          <div
            v-if="activeTab === 'studio-usage' && authStore.isAuthenticated"
            class="profile-console__section"
          >
            <header class="profile-section-intro" data-pf-motion>
              <div>
                <span class="profile-section-intro__kicker">Usage</span>
                <h2 class="profile-section-intro__title">AI 功能用量</h2>
                <p class="profile-section-intro__desc">积分余额、消耗与扣减记录。</p>
              </div>
            </header>
            <ProfileStudioUsage />
          </div>

          <!-- Coloring -->
          <div
            v-if="activeTab === 'coloring-history' && authStore.isAuthenticated"
            class="profile-console__section"
          >
            <ProfileColoringHistory />
          </div>
        </div>
      </main>
    </div>

    <div v-if="isEditing" class="profile-edit-host">
      <UserProfileCard
        :is-editing="isEditing"
        @edit="toggleEditMode"
        @save="handleSaveProfile"
        @cancel="handleCancelEdit"
      />
    </div>

    <Teleport to="body">
      <WallpaperPreview
        v-if="isPreviewEnabled && showPreview"
        :wallpaper="previewWallpaper"
        :show="showPreview"
        :enabled-actions="previewEnabledActions"
        :in-collection="previewInListContext"
        :collection-index="previewIndex >= 0 ? previewIndex : 0"
        :collection-total="previewWallpapers.length"
        @close="closePreview"
        @next="onPreviewNext"
        @previous="onPreviewPrevious"
      />
    </Teleport>
  </div>
</template>
