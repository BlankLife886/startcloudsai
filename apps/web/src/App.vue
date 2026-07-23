<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { navigationTarget } from './router'
import NotificationContainer from './components/common/NotificationContainer.vue'
import ClientLocaleBridge from './components/common/ClientLocaleBridge.vue'
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
    'assistant',
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
  if (isPricingConsoleRoute.value || isProfileConsoleRoute.value || isStudioConsoleRoute.value) {
    return false
  }
  return route.name === 'home'
})

const showBackToTop = ref(false)
let pageScrollbarTimer = null
let scrollFrameId = 0
let pageResizeObserver = null

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

watch(
  () => route.fullPath,
  () => {
    if (typeof window === 'undefined') return
    void nextTick().then(() => {
      window.requestAnimationFrame(() => updateScrollUi(false))
    })
  },
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
  window.addEventListener('resize', handleScroll, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    pageResizeObserver = new ResizeObserver(() => updateScrollUi(false))
    pageResizeObserver.observe(document.body)
  }
  updateScrollUi(false)
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
  window.removeEventListener('resize', handleScroll)
  pageResizeObserver?.disconnect()
  pageResizeObserver = null
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.classList.remove('is-page-scrolling', 'is-page-scrolled', 'has-page-scroll')
    root.style.removeProperty('--page-scroll-ratio')
  }
})

function handleScroll() {
  if (scrollFrameId) return
  scrollFrameId = window.requestAnimationFrame(() => {
    scrollFrameId = 0
    updateScrollUi()
  })
}

function updateScrollUi(markScrolling = true) {
  const root = document.documentElement
  const scrollTop = Math.max(0, window.scrollY || root.scrollTop || 0)
  const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight)
  const ratio = maxScroll > 0 ? Math.min(1, scrollTop / maxScroll) : 0

  root.style.setProperty('--page-scroll-ratio', ratio.toFixed(4))
  root.classList.toggle('has-page-scroll', maxScroll > 24)
  root.classList.toggle('is-page-scrolled', scrollTop > 10)

  if (markScrolling) {
    root.classList.add('is-page-scrolling')
    if (pageScrollbarTimer) window.clearTimeout(pageScrollbarTimer)
    pageScrollbarTimer = window.setTimeout(() => {
      root.classList.remove('is-page-scrolling')
      pageScrollbarTimer = null
    }, 700)
  }

  showBackToTop.value = scrollTop > Math.min(360, window.innerHeight * 0.55)
}

function scrollToTop() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const animationsDisabled = document.documentElement.classList.contains('settings-no-animations')
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion || animationsDisabled ? 'auto' : 'smooth',
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
    <div v-if="showAppChrome" class="page-scroll-progress" aria-hidden="true">
      <i></i>
    </div>

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
    <Transition name="backtop">
      <button
        v-if="showAppChrome && showBackToTop"
        id="back-to-top"
        type="button"
        class="back-to-top-btn"
        aria-label="回到顶部"
        title="回到顶部"
        @click="scrollToTop"
      >
        <i class="bi bi-arrow-up" aria-hidden="true"></i>
      </button>
    </Transition>

    <!-- 全局通知容器 -->
    <NotificationContainer />
    <ClientLocaleBridge />
    <AnnouncementCenter v-if="showAppChrome" />
  </div>
</template>

<style src="./assets/app-shell.css"></style>
