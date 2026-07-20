<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { navigationTarget } from './router'
import NotificationContainer from './components/common/NotificationContainer.vue'
import FooterComponent from './components/layout/FooterComponent.vue'
import NavBar from './components/layout/NavBar.vue'
import { useAuthStore } from './stores/auth'
import { useSettingsStore } from './stores/settings'

const AnnouncementCenter = defineAsyncComponent(
  () => import('./components/common/AnnouncementCenter.vue'),
)

const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const route = useRoute()
const isPricingConsoleRoute = computed(() => route.name === 'pricing')
const isProfileConsoleRoute = computed(() => route.name === 'profile')
const isShareGalleryRoute = computed(() => route.name === 'share')
const isUpdatesGalleryRoute = computed(() => route.name === 'updates')
const isStudioConsoleRoute = computed(() =>
  [
    'text-to-image',
    'ai-wallpaper',
    'ai-illustration-coloring',
    'ai-puzzle',
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
    isStudioConsoleRoute.value
  ) {
    return false
  }
  return route.name === 'home'
})

const showBackToTop = ref(false)
let pageScrollbarTimer = null
let scrollFrameId = 0

function applyPreferenceHtmlClasses() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('settings-no-animations', !settingsStore.settings.enable_animations)
  root.classList.toggle('settings-no-blur', !settingsStore.settings.enable_blur_effects)
}

watch(
  () => settingsStore.settings,
  () => applyPreferenceHtmlClasses(),
  { deep: true, immediate: true },
)

onMounted(() => {
  const needsImmediateAuth =
    route.meta?.requiresAuth ||
    route.name === 'profile' ||
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

  settingsStore.initSettings().finally(() => {
    applyPreferenceHtmlClasses()
  })

  window.addEventListener('scroll', handleScroll, { passive: true })
})

onBeforeUnmount(() => {
  if (pageScrollbarTimer) {
    window.clearTimeout(pageScrollbarTimer)
    pageScrollbarTimer = null
  }
  if (scrollFrameId) {
    window.cancelAnimationFrame(scrollFrameId)
    scrollFrameId = 0
  }
  window.removeEventListener('scroll', handleScroll)
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('is-page-scrolling')
  }
})

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

  showBackToTop.value = window.scrollY > 300
}

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
      'app--updates-gallery': isUpdatesGalleryRoute,
    }"
  >
    <!-- 导航栏 -->
    <NavBar v-if="showAppChrome" />

    <!-- 主内容区域 -->
    <main
      class="main-content"
      :class="{
        'main--pricing-console': isPricingConsoleRoute,
        'main--profile-console': isProfileConsoleRoute,
        'main--studio-console': isStudioConsoleRoute,
        'main--share-gallery': isShareGalleryRoute,
        'main--updates-gallery': isUpdatesGalleryRoute,
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
  </div>
</template>

<style src="./assets/app-shell.css"></style>
