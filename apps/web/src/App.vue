<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { navigationTarget } from './router'
import NotificationContainer from './components/common/NotificationContainer.vue'
import FooterComponent from './components/layout/FooterComponent.vue'
import NavBar from './components/layout/NavBar.vue'
import { useAuthStore } from './stores/auth'
import { useDownloadsStore } from './stores/downloads'
import { useFavoritesStore } from './stores/favorites'
import { useSettingsStore } from './stores/settings'
import { useRuntimeConfigStore } from './stores/runtimeConfig'
import { useMqttStore } from './stores/mqtt'
import { getWallhavenSearchWindowUsage } from '@/utils/wallhavenBudget'
import {
  cancelWallpaperZipPackaging,
  cancelWallpaperZipName,
  confirmWallpaperZipName,
  initZipDownloadRecords,
  wallpaperDownloadUi,
} from '@/services/wallpaperDownload'

const AnnouncementCenter = defineAsyncComponent(
  () => import('./components/common/AnnouncementCenter.vue'),
)

const favoritesStore = useFavoritesStore()
const downloadsStore = useDownloadsStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const runtimeConfigStore = useRuntimeConfigStore()
const mqttStore = useMqttStore()
const route = useRoute()
const effectiveRoutePath = computed(() => navigationTarget.path || route.path)
const effectiveRouteName = computed(() => navigationTarget.name || route.name)
const showBrowseWallpaperDock = computed(() => route.name === 'search')
const isSearchGalleryRoute = computed(() => route.name === 'search')
const isPricingConsoleRoute = computed(
  () => effectiveRouteName.value === 'pricing' || effectiveRoutePath.value === '/pricing',
)
const isProfileConsoleRoute = computed(() => route.name === 'profile')
const isSettingsConsoleRoute = computed(() => route.name === 'settings')
const isZiweiConsoleRoute = computed(() => route.name === 'ziwei' || route.name === 'ziwei-docs')
const isShareGalleryRoute = computed(() => route.name === 'share')
const isWallpaperDetailRoute = computed(() => route.name === 'wallpaper')
const isHistoryGalleryRoute = computed(() => route.name === 'history')
const isUpdatesGalleryRoute = computed(() => route.name === 'updates')
const isDownloadsGalleryRoute = computed(() => route.name === 'downloads')
const isFavoritesGalleryRoute = computed(() => route.name === 'favorites')
const isUsersGalleryRoute = computed(() => route.name === 'users')
const isAuthorGalleryRoute = computed(() => route.name === 'user')
const isTagsGalleryRoute = computed(() => route.name === 'tags')
const isStudioConsoleRoute = computed(() =>
  [
    'text-to-image',
    'ai-wallpaper',
    'ai-illustration-coloring',
    'ai-puzzle',
    'ai-image-to-3d',
    'design-workshop',
    'model-sheet',
    'game-art',
  ].includes(String(route.name || '')),
)
const showAppChrome = computed(() => !route.meta?.immersive)
const showSiteFooter = computed(() => {
  const pendingPath = String(navigationTarget.path || '').replace(/\/+$/, '') || '/'
  const pendingName = navigationTarget.name
  if (pendingName && pendingName !== 'home') return false
  if (pendingPath !== '/' && pendingPath !== '') return false
  if (route.meta?.hideSiteFooter) return false
  if (
    isPricingConsoleRoute.value ||
    isProfileConsoleRoute.value ||
    isSettingsConsoleRoute.value ||
    isZiweiConsoleRoute.value ||
    isStudioConsoleRoute.value
  ) {
    return false
  }
  return route.name === 'home'
})

// 本地状态
const showBackToTop = ref(false)
const apiWindowUsage = ref(getWallhavenSearchWindowUsage())
let apiDockTimer = null
const dockScrollIdle = ref(true)
let dockScrollStopTimer = null
let pageScrollbarTimer = null
let scrollFrameId = 0
let runtimeConfigRealtimeTimer = null
let runtimeCredentialTimer = null
let runtimeConfigRefreshedAt = 0
const showDownloadProgressUi = computed(() => settingsStore.getSetting('show_progress', true))
const dockRestoreDelayMs = computed(() => {
  const ms = Number(settingsStore.getSetting('search_dock_restore_delay_ms', 600))
  return Number.isFinite(ms) ? Math.round(Math.min(10000, Math.max(300, ms))) : 600
})

const dockApiBorderClass = computed(() => {
  const r = apiWindowUsage.value.ratio
  if (r >= 1) return 'is-api-border-danger'
  if (r >= 0.85) return 'is-api-border-warning'
  if (r >= 0.65) return 'is-api-border-info'
  return 'is-api-border-ok'
})

const dockProgressStyle = computed(() => ({
  '--api-border-progress': String(Math.min(1, Math.max(0, apiWindowUsage.value.ratio))),
}))

function applyPreferenceHtmlClasses() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('settings-no-animations', !settingsStore.settings.enable_animations)
  root.classList.toggle('settings-no-blur', !settingsStore.settings.enable_blur_effects)
}

async function clearTemporarySiteCaches() {
  try {
    localStorage.removeItem('walleven_image_cache')
  } catch {
    /* ignore */
  }

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key.includes('walleven')).map((key) => caches.delete(key)),
      )
    }
  } catch {
    /* ignore */
  }

  try {
    if (indexedDB?.deleteDatabase) {
      indexedDB.deleteDatabase('walleven-cache')
    }
  } catch {
    /* ignore */
  }
}

function handleBeforeUnloadClearCache() {
  if (!settingsStore.getSetting('clear_cache_on_exit')) return
  void clearTemporarySiteCaches()
}

function handleRuntimeConfigUpdated() {
  window.clearTimeout(runtimeConfigRealtimeTimer)
  runtimeConfigRealtimeTimer = window.setTimeout(() => {
    runtimeConfigRefreshedAt = Date.now()
    void runtimeConfigStore.loadRuntimeConfig({ force: true })
  }, 220)
}

function handleRealtimeVisibilityChange() {
  if (
    document.visibilityState === 'visible' &&
    Date.now() - runtimeConfigRefreshedAt > 8 * 60 * 1000
  ) {
    handleRuntimeConfigUpdated()
  }
}

watch(
  () => settingsStore.settings,
  () => applyPreferenceHtmlClasses(),
  { deep: true, immediate: true },
)

// 在组件挂载时加载主题和初始化收藏
onMounted(() => {
  const needsImmediateAuth =
    route.meta?.requiresAuth ||
    route.name === 'profile' ||
    route.name === 'settings' ||
    route.name === 'pricing' ||
    String(route.name || '').startsWith('auth')

  const runAuthInit = () => authStore.initAuth().catch(() => {})
  if (needsImmediateAuth) {
    runAuthInit()
  } else if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(runAuthInit, { timeout: 2500 })
  } else {
    window.setTimeout(runAuthInit, 400)
  }

  const runStoreInit = () => {
    settingsStore.initSettings().finally(() => {
      applyPreferenceHtmlClasses()
    })
    favoritesStore.initFavorites().catch((err) => {
      console.error('初始化收藏失败:', err)
    })
  }

  if (needsImmediateAuth) {
    runStoreInit()
  } else if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(runStoreInit, { timeout: 3000 })
  } else {
    window.setTimeout(runStoreInit, 500)
  }

  initZipDownloadRecords()

  void runtimeConfigStore.loadRuntimeConfig().then((config) => {
    runtimeConfigRefreshedAt = Date.now()
    mqttStore.start(config.mqtt, { userId: authStore.user?.id })
  })

  // 监听滚动事件，控制返回顶部按钮的显示
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('beforeunload', handleBeforeUnloadClearCache)
  window.addEventListener('walleven:runtime_config-updated', handleRuntimeConfigUpdated)
  document.addEventListener('visibilitychange', handleRealtimeVisibilityChange)
  runtimeCredentialTimer = window.setInterval(handleRuntimeConfigUpdated, 10 * 60 * 1000)
})

onBeforeUnmount(() => {
  mqttStore.stop()
  if (apiDockTimer) {
    window.clearInterval(apiDockTimer)
    apiDockTimer = null
  }
  if (dockScrollStopTimer) {
    window.clearTimeout(dockScrollStopTimer)
    dockScrollStopTimer = null
  }
  if (pageScrollbarTimer) {
    window.clearTimeout(pageScrollbarTimer)
    pageScrollbarTimer = null
  }
  if (scrollFrameId) {
    window.cancelAnimationFrame(scrollFrameId)
    scrollFrameId = 0
  }
  if (runtimeConfigRealtimeTimer) {
    window.clearTimeout(runtimeConfigRealtimeTimer)
    runtimeConfigRealtimeTimer = null
  }
  if (runtimeCredentialTimer) {
    window.clearInterval(runtimeCredentialTimer)
    runtimeCredentialTimer = null
  }
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('beforeunload', handleBeforeUnloadClearCache)
  window.removeEventListener('walleven:runtime_config-updated', handleRuntimeConfigUpdated)
  document.removeEventListener('visibilitychange', handleRealtimeVisibilityChange)
  if (typeof document !== 'undefined') {
    document.body.classList.remove('download-session-locked')
    document.documentElement.classList.remove('is-page-scrolling')
  }
})

watch(
  [() => runtimeConfigStore.config.mqtt, () => authStore.user?.id],
  ([mqtt, userId]) => mqttStore.start(mqtt, { userId }),
  { deep: true },
)

watch(
  () => authStore.user?.id || '',
  (userId, previousUserId) => {
    if (userId === previousUserId) return
    handleRuntimeConfigUpdated()
  },
)

watch(
  () => wallpaperDownloadUi.progressVisible && showDownloadProgressUi.value,
  (locked) => {
    if (typeof document === 'undefined') return
    document.body.classList.toggle('download-session-locked', locked)
  },
  { immediate: true },
)

watch(
  showBrowseWallpaperDock,
  (show) => {
    if (!show) {
      dockScrollIdle.value = true
      if (dockScrollStopTimer) {
        window.clearTimeout(dockScrollStopTimer)
        dockScrollStopTimer = null
      }
      if (apiDockTimer) {
        window.clearInterval(apiDockTimer)
        apiDockTimer = null
      }
      return
    }
    apiWindowUsage.value = getWallhavenSearchWindowUsage()
    if (apiDockTimer) return
    apiDockTimer = window.setInterval(() => {
      apiWindowUsage.value = getWallhavenSearchWindowUsage()
    }, 700)
  },
  { immediate: true },
)

// 处理滚动事件
function handleScroll() {
  if (scrollFrameId) return
  scrollFrameId = window.requestAnimationFrame(() => {
    scrollFrameId = 0
    updateScrollUi()
  })
}

function updateScrollUi() {
  document.documentElement.classList.add('is-page-scrolling')
  if (pageScrollbarTimer) {
    window.clearTimeout(pageScrollbarTimer)
  }
  pageScrollbarTimer = window.setTimeout(() => {
    document.documentElement.classList.remove('is-page-scrolling')
    pageScrollbarTimer = null
  }, 900)

  if (window.scrollY > 300) {
    showBackToTop.value = true
  } else {
    showBackToTop.value = false
  }

  if (!showBrowseWallpaperDock.value) return
  dockScrollIdle.value = false
  if (dockScrollStopTimer) {
    window.clearTimeout(dockScrollStopTimer)
  }
  dockScrollStopTimer = window.setTimeout(() => {
    dockScrollIdle.value = true
    dockScrollStopTimer = null
  }, dockRestoreDelayMs.value)
}

// 返回顶部
function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}
</script>

<template>
  <div
    class="app-container"
    :class="{
      'app--share-gallery': isShareGalleryRoute,
      'app--wallpaper-detail': isWallpaperDetailRoute,
      'app--search-gallery': isSearchGalleryRoute,
      'app--history-gallery': isHistoryGalleryRoute,
      'app--updates-gallery': isUpdatesGalleryRoute,
      'app--downloads-gallery': isDownloadsGalleryRoute,
      'app--favorites-gallery': isFavoritesGalleryRoute,
      'app--users-gallery': isUsersGalleryRoute,
      'app--author-gallery': isAuthorGalleryRoute,
      'app--tags-gallery': isTagsGalleryRoute,
    }"
  >
    <!-- 导航栏 -->
    <NavBar v-if="showAppChrome" />

    <aside
      v-if="showAppChrome && showBrowseWallpaperDock"
      class="app-bottom-floating-dock"
      :class="{ 'is-dock-scroll-hidden': !dockScrollIdle }"
      aria-label="搜索结果悬浮栏"
      :aria-hidden="!dockScrollIdle"
    >
      <div
        class="app-bottom-floating-dock-inner"
        :class="dockApiBorderClass"
        :style="dockProgressStyle"
      >
        <div id="app-bottom-dock-slot" class="app-bottom-dock-slot"></div>
      </div>
    </aside>

    <!-- 主内容区域 -->
    <main
      class="main-content"
      :class="{
        'main--browse-dock': showBrowseWallpaperDock,
        'main--pricing-console': isPricingConsoleRoute,
        'main--profile-console': isProfileConsoleRoute,
        'main--settings-console': isSettingsConsoleRoute,
        'main--ziwei-console': isZiweiConsoleRoute,
        'main--studio-console': isStudioConsoleRoute,
        'main--share-gallery': isShareGalleryRoute,
        'main--wallpaper-detail': isWallpaperDetailRoute,
        'main--search-gallery': isSearchGalleryRoute,
        'main--history-gallery': isHistoryGalleryRoute,
        'main--updates-gallery': isUpdatesGalleryRoute,
        'main--downloads-gallery': isDownloadsGalleryRoute,
        'main--favorites-gallery': isFavoritesGalleryRoute,
        'main--users-gallery': isUsersGalleryRoute,
        'main--author-gallery': isAuthorGalleryRoute,
        'main--tags-gallery': isTagsGalleryRoute,
        'main--no-header': !showAppChrome,
      }"
    >
      <RouterView />
    </main>

    <!-- 页脚 -->
    <FooterComponent v-if="showSiteFooter" />

    <!-- 回到顶部按钮 -->
    <button
      v-if="showAppChrome"
      id="back-to-top"
      type="button"
      class="back-to-top-btn"
      :class="{ 'is-browse-dock': showBrowseWallpaperDock }"
      aria-label="回到顶部"
      title="回到顶部"
      @click="scrollToTop"
      :style="{ display: showBackToTop ? 'inline-flex' : 'none' }"
    >
      <i class="bi bi-arrow-up" aria-hidden="true"></i>
    </button>

    <!-- 全局通知容器 -->
    <NotificationContainer />
    <AnnouncementCenter v-if="showAppChrome" />

    <div class="download-guard-modal" v-if="wallpaperDownloadUi.nameDialogVisible">
      <button
        class="download-guard-backdrop"
        type="button"
        aria-label="关闭"
        @click="cancelWallpaperZipName"
      ></button>
      <form class="download-guard-panel" @submit.prevent="confirmWallpaperZipName">
        <header class="download-guard-header">
          <div class="download-guard-heading">
            <span class="download-guard-icon" aria-hidden="true"
              ><i class="bi bi-file-earmark-zip"></i
            ></span>
            <h5 class="download-guard-title">压缩包命名</h5>
          </div>
          <button
            class="download-guard-close"
            type="button"
            aria-label="关闭"
            @click="cancelWallpaperZipName"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </header>
        <div class="download-guard-body">
          <p class="download-guard-text">本次将打包 {{ wallpaperDownloadUi.count }} 张壁纸。</p>
          <p v-if="wallpaperDownloadUi.estimatedSizeText" class="download-guard-hint">
            预计体积 {{ wallpaperDownloadUi.estimatedSizeText }}，将使用本地打包。
          </p>
          <label class="download-name-field">
            <span>文件名</span>
            <input
              v-model="wallpaperDownloadUi.filename"
              type="text"
              maxlength="80"
              :placeholder="wallpaperDownloadUi.defaultName"
              autofocus
            />
          </label>
        </div>
        <div class="download-guard-actions">
          <button type="button" class="download-modal-btn" @click="cancelWallpaperZipName">
            取消
          </button>
          <button class="download-modal-btn is-primary" type="submit">开始打包</button>
        </div>
      </form>
    </div>

    <div
      class="download-lock-modal"
      v-if="wallpaperDownloadUi.progressVisible && showDownloadProgressUi"
    >
      <div class="download-lock-backdrop"></div>
      <div class="download-lock-panel">
        <header class="download-guard-header">
          <div class="download-guard-heading">
            <span class="download-guard-icon" aria-hidden="true"
              ><i class="bi bi-archive"></i
            ></span>
            <h5 class="download-lock-title">正在打包</h5>
          </div>
        </header>
        <div class="download-guard-body">
          <p class="download-lock-text">请稍等，完成后会自动保存压缩包。</p>
          <div
            class="download-lock-progress"
            role="progressbar"
            :aria-valuenow="wallpaperDownloadUi.progress"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="download-lock-progress__bar"
              :style="{ width: `${wallpaperDownloadUi.progress}%` }"
            ></div>
            <span class="download-lock-progress__label">{{ wallpaperDownloadUi.progress }}%</span>
          </div>
          <div class="download-lock-meta">
            <span>总计 {{ wallpaperDownloadUi.count }}</span>
            <span>{{ wallpaperDownloadUi.statusText }}</span>
          </div>
        </div>
        <div class="download-lock-actions">
          <button
            type="button"
            class="download-modal-btn is-danger"
            :disabled="wallpaperDownloadUi.cancelling"
            @click="cancelWallpaperZipPackaging"
          >
            {{ wallpaperDownloadUi.cancelling ? '正在取消...' : '取消打包' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style src="./assets/app-shell.css"></style>
