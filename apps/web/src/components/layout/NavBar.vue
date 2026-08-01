<script setup>
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import { useSettingsStore } from '@/stores/settings'
import { DEFAULT_AUTH_REDIRECT, createLoginRedirectQuery } from '@/services/authRedirect'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { navigationTarget } from '@/router'
import { setBodyScrollLock } from '@/utils/bodyScrollLock'
import ThemeDayNightSwitch from '@/components/layout/ThemeDayNightSwitch.vue'
import LocaleSwitcher from '@/components/layout/LocaleSwitcher.vue'
import RedeemCodeDialog from '@/components/layout/RedeemCodeDialog.vue'
import { STUDIO_TOOLS } from '@/features/creator-hub/studioTools'

const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()
const appearanceStore = useAppearanceStore()
const authStore = useAuthStore()
const runtimeConfigStore = useRuntimeConfigStore()
const { balanceDisplay, availableCents, refreshWalletBalance } = useClientWalletBalance()
const balanceNumberDisplay = computed(() => formatPoints(availableCents.value, { withUnit: false }))
const redeemDialogOpen = ref(false)

const MOBILE_NAV_MQ = '(max-width: 920px)'

const menuOpen = ref(false)
const mobileSheetKind = ref('')
const activeDropdown = ref('')
let dropdownCloseTimer = null
const DROPDOWN_CLOSE_DELAY_MS = 100
const isMobileNav = ref(false)
const isScrolled = ref(false)
const siteHeaderEl = ref(null)
const mobileBottomNavEl = ref(null)
let headerResizeObserver = null
let mobileNavMq = null
let scrollRaf = 0
const MOBILE_NAV_SCROLL_LOCK = 'mobile-navigation'
const SCROLL_FROST_THRESHOLD = 10

function syncHeaderScrollState() {
  if (typeof window === 'undefined') return
  const next = window.scrollY > SCROLL_FROST_THRESHOLD
  if (next !== isScrolled.value) isScrolled.value = next
}

function onWindowScroll() {
  if (scrollRaf) return
  scrollRaf = window.requestAnimationFrame(() => {
    scrollRaf = 0
    syncHeaderScrollState()
  })
}

const effectiveRoutePath = computed(() => navigationTarget.path || route.path)

/** 同步到 :root，供全局 main 留白与搜索固定栏 top 使用 */
function publishChromeOffsets() {
  nextTick(() => {
    if (typeof document === 'undefined') return

    const headerEl = siteHeaderEl.value
    if (headerEl) {
      const h = Math.ceil(headerEl.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--app-header-offset', `${h}px`)
    }

    const bottomEl = mobileBottomNavEl.value
    if (bottomEl && isMobileNav.value) {
      const bottomH = Math.ceil(bottomEl.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--app-bottom-nav-offset', `${bottomH}px`)
    } else {
      document.documentElement.style.setProperty('--app-bottom-nav-offset', '0px')
    }
  })
}

/** @deprecated alias */
function publishHeaderOffset() {
  publishChromeOffsets()
}

function bindChromeResizeObservers() {
  headerResizeObserver?.disconnect()
  headerResizeObserver = null
  if (typeof ResizeObserver === 'undefined') return

  headerResizeObserver = new ResizeObserver(() => publishChromeOffsets())
  if (siteHeaderEl.value) headerResizeObserver.observe(siteHeaderEl.value)
  if (mobileBottomNavEl.value && isMobileNav.value) {
    headerResizeObserver.observe(mobileBottomNavEl.value)
  }
}

const homeLink = { to: '/', label: '首页', icon: 'bi-house-door-fill' }

const studioLink = { to: '/studio', label: '创作台', icon: 'bi-grid-1x2-fill' }

const promptsLink = { to: '/prompts', label: '提示词', icon: 'bi-journal-richtext' }

const historyLink = { to: '/history', label: '历史记录', icon: 'bi-clock-history' }

const shareLink = { to: '/share', label: '社区', icon: 'bi-images' }

const pricingLink = { to: '/pricing', label: '价格', icon: 'bi-credit-card-2-front-fill' }

const toolLinks = [
  { to: '/app-space', label: '应用空间', icon: 'bi-columns-gap' },
  { to: '/updates', label: '更新说明', icon: 'bi-megaphone-fill' },
]

/** bento 布局：hero 左侧通高 / tile 叠字卡 */
const BENTO_VARIANT = {
  assistant: 'hero',
  t2i: 'tile',
  coloring: 'tile',
  ui: 'tile',
  model: 'tile',
  game: 'tile',
  puzzle: 'tile',
}

const imageDesignLinks = STUDIO_TOOLS.map((tool) => ({
  id: tool.id,
  to: tool.to,
  label: tool.label,
  icon: tool.icon,
  tagline: tool.tagline,
  cover: tool.cover,
  badge: tool.badge,
  feature: tool.feature,
  bento: BENTO_VARIANT[tool.id] || 'tile',
}))

const aiLinks = imageDesignLinks

const routePrefetchers = {
  '/assistant': () => import('@/views/AssistantWorkspaceView.vue'),
  '/updates': () => import('@/views/UpdatesView.vue'),
  '/pricing': () => import('@/views/PricingView.vue'),
  '/share': () => import('@/views/ShareView.vue'),
  '/studio': () => import('@/views/StudioHubView.vue'),
  '/prompts': () => import('@/views/PromptLibraryView.vue'),
  '/history': () => import('@/views/CreationHistoryView.vue'),
  '/text-to-image': () => import('@/views/AiWallpaperView.vue'),
  '/ai-illustration-coloring': () => import('@/views/AiIllustrationColoringView.vue'),
  '/ai-puzzle': () => import('@/views/AiPuzzleView.vue'),
  '/design-workshop': () => import('@/views/DesignWorkshopView.vue'),
  '/model-sheet': () => import('@/views/ModelSheetStudioView.vue'),
  '/game-art': () => import('@/views/GameArtStudioView.vue'),
  '/app-space': () => import('@/views/AppSpaceView.vue'),
  '/auth': () => import('@/views/auth/AuthAccountView.vue'),
  '/profile': () => import('@/views/ProfileView.vue'),
}
const prefetchedRoutes = new Set()

const dropdownGroupDefs = {
  ai: {
    name: 'ai',
    label: 'AI',
    icon: 'bi-stars',
    links: aiLinks,
  },
  'image-design': {
    name: 'image-design',
    label: '图片设计',
    icon: 'bi-palette-fill',
    links: imageDesignLinks,
    mega: true,
    primaryTo: '/studio',
  },
  tools: {
    name: 'tools',
    label: '工具',
    icon: 'bi-columns-gap',
    links: toolLinks,
  },
}

/** 顶栏顺序：首页 → 创作台 → 图片设计 → 提示词 → 社区 → 历史 → 价格 → 工具 */
const NAV_ORDER = [
  { type: 'home' },
  { type: 'link', link: studioLink },
  { type: 'group', key: 'image-design' },
  { type: 'link', link: promptsLink },
  { type: 'link', link: shareLink },
  { type: 'link', link: historyLink },
  { type: 'link', link: pricingLink },
  { type: 'group', key: 'tools' },
]

/** 移动端底部 Tab：首页 / 创作台 / 社区 / 我的 */
const BOTTOM_TAB_DEFS = [
  { id: 'home', label: '首页', icon: 'bi-house-door-fill', kind: 'link', link: homeLink },
  { id: 'studio', label: '创作台', icon: 'bi-grid-1x2-fill', kind: 'link', link: studioLink },
  { id: 'share', label: '社区', icon: 'bi-images', kind: 'link', link: shareLink },
  { id: 'mine', label: '我的', icon: 'bi-person-circle', kind: 'mine' },
]

const navItems = computed(() => {
  const items = []

  NAV_ORDER.forEach((entry) => {
    if (entry.type === 'home') {
      if (isLinkVisible(homeLink)) {
        items.push({ type: 'link', id: 'home', ...homeLink })
      }
      return
    }

    if (entry.type === 'link') {
      if (isLinkVisible(entry.link)) {
        items.push({ type: 'link', id: entry.link.to, ...entry.link })
      }
      return
    }

    const def = dropdownGroupDefs[entry.key]
    if (!def) return

    const links = def.links.filter((link) => isLinkVisible(link))
    if (links.length > 0) {
      items.push({ type: 'group', id: def.name, ...def, links })
    }
  })

  return items
})

const mobileSheetTitle = computed(() => {
  if (mobileSheetKind.value === 'ai' || mobileSheetKind.value === 'image-design') return '图片设计'
  if (mobileSheetKind.value === 'mine') return '我的'
  return ''
})

const mobileSheetLinks = computed(() => {
  const kind = mobileSheetKind.value
  if (!kind) return []

  const toCell = (link) => ({
    id: typeof link.to === 'string' ? link.to : link.id || link.label,
    to: link.to,
    label: link.label,
    icon: link.icon,
    disabled: isLinkDisabled(link),
  })

  if (kind === 'ai' || kind === 'image-design') {
    return imageDesignLinks.filter((link) => isLinkVisible(link)).map(toCell)
  }

  if (kind === 'mine') {
    const cells = []

    if (!authStore.isAuthenticated && authVisible.value) {
      cells.push({
        id: 'auth',
        to: loginRoute.value,
        label: '登录',
        icon: 'bi-box-arrow-in-right',
        disabled: authDisabled.value,
      })
    }
    if (authStore.isAuthenticated && profileVisible.value) {
      cells.push({
        id: 'profile',
        to: profileRoute,
        label: '个人中心',
        icon: 'bi-person-circle',
        disabled: profileDisabled.value,
      })
    }
    const mineLinks = [promptsLink, historyLink, pricingLink, ...toolLinks]
    mineLinks.filter((link) => isLinkVisible(link)).forEach((link) => cells.push(toCell(link)))

    return cells
  }

  return []
})

const bottomTabs = computed(() =>
  BOTTOM_TAB_DEFS.filter((tab) => {
    if (tab.kind === 'mine') return true
    if (tab.kind === 'link') return isLinkVisible(tab.link)
    if (tab.kind === 'group') {
      const def = dropdownGroupDefs[tab.groupKey]
      if (!def) return false
      return def.links.some((link) => isLinkVisible(link))
    }
    return false
  }),
)

const profileVisible = computed(() => isLinkVisible({ to: '/profile' }))
const authVisible = computed(() => isLinkVisible({ to: '/auth' }))
const authDisabled = computed(() => isLinkDisabled({ to: '/auth' }))
const profileDisabled = computed(() => isLinkDisabled({ to: '/profile' }))
const loginRoute = computed(() => ({
  name: 'auth',
  query: {
    ...createLoginRedirectQuery(route.name === 'home' ? DEFAULT_AUTH_REDIRECT : route.fullPath),
    mode: 'login',
  },
}))
const profileRoute = { name: 'profile' }

const accountDisplayName = computed(
  () =>
    authStore.displayName ||
    settingsStore.settings.display_name ||
    settingsStore.settings.username ||
    '创作者',
)
const accountAvatarUrl = computed(
  () => settingsStore.settings.avatar_url || '/brand/avatar-placeholder.svg',
)
const accountMenuOpen = computed(() => activeDropdown.value === 'account')
const accountLoggingOut = ref(false)

function toggleAccountMenu() {
  if (profileDisabled.value) return
  const next = activeDropdown.value === 'account' ? '' : 'account'
  activeDropdown.value = next
  if (next === 'account') {
    prefetchRoute('/profile')
    prefetchRoute('/pricing')
    void refreshWalletBalance({ force: false })
  }
}

function openRedeemDialog() {
  if (!authStore.isAuthenticated) return
  closeDropdowns()
  closeMobileSheet()
  redeemDialogOpen.value = true
}

function closeRedeemDialog() {
  redeemDialogOpen.value = false
}

function openRedeemFromMenu() {
  closeMenu()
  openRedeemDialog()
}

async function handleAccountLogout() {
  if (accountLoggingOut.value) return
  if (!window.confirm('退出当前账号？退出后需要重新登录。')) return
  accountLoggingOut.value = true
  closeMenu()
  try {
    const result = await authStore.logout()
    if (result?.error) {
      notificationService.warning('本机登录状态已清除，服务器会话可能仍需稍后重试。')
    } else {
      notificationService.success('已安全退出登录')
    }
    await router.replace({
      name: 'auth',
      query: {
        mode: 'login',
        ...createLoginRedirectQuery(route.fullPath),
      },
    })
  } finally {
    accountLoggingOut.value = false
  }
}

function isLinkVisible(link) {
  if (runtimeConfigStore.isBlocked) return false
  if (link.feature && !runtimeConfigStore.isFeatureEnabled(link.feature)) return false
  return runtimeConfigStore.isRouteVisible(link.to)
}

function isLinkDisabled(link) {
  if (link.feature && !runtimeConfigStore.isFeatureEnabled(link.feature)) return true
  return !runtimeConfigStore.isRouteClickable(link.to)
}

function linkDisabledReason(link) {
  if (link.feature && !runtimeConfigStore.isFeatureEnabled(link.feature)) return '当前功能暂未开放'
  return runtimeConfigStore.getRouteDisabledMessage(link.to)
}

function handleDisabledLinkClick(event) {
  event.preventDefault()
  event.stopPropagation()
}

function isRouteActive(path) {
  const currentPath = effectiveRoutePath.value
  return currentPath === path || currentPath.startsWith(`${path}/`)
}

function isGroupActive(links) {
  return links.some((link) => isRouteActive(link.to))
}

function groupDisplayLabel(item) {
  if (!item?.mega || !Array.isArray(item.links)) return item.label
  const active = item.links.find((link) => isRouteActive(link.to))
  return active?.label || item.label
}

function getFirstNavigableLink(links = []) {
  return links.find((link) => !isLinkDisabled(link)) || null
}

function handleGroupPrimaryClick(group, event) {
  if (group.primaryTo) {
    closeMenu()
    closeDropdowns()
    prefetchRoute(group.primaryTo)
    if (!isRouteActive(group.primaryTo)) router.push(group.primaryTo)
    return
  }

  const firstLink = getFirstNavigableLink(group.links)
  if (!firstLink) return

  if (isLinkDisabled(firstLink)) {
    handleDisabledLinkClick(event)
    return
  }

  closeMenu()
  closeDropdowns()

  if (!isRouteActive(firstLink.to)) {
    router.push(firstLink.to)
  }
}

function onToolCoverError(event, link) {
  const img = event?.target
  if (!img || !link?.cover) return
  const png = String(link.cover).replace(/\.webp$/i, '.png')
  if (png !== link.cover && img.getAttribute('src') !== png) img.src = png
}

function onMegaCardEnter(link) {
  prefetchRoute(link?.to)
}

function closeMobileSheet() {
  mobileSheetKind.value = ''
  menuOpen.value = false
  syncBodyScrollLock()
}

function openMobileSheet(kind) {
  if (mobileSheetKind.value === kind) {
    closeMobileSheet()
    return
  }

  mobileSheetKind.value = kind
  menuOpen.value = true

  if (kind === 'ai') prefetchLinks(aiLinks)
  if (kind === 'mine') {
    prefetchLinks([pricingLink, ...toolLinks, { to: '/auth' }, { to: '/profile' }])
  }

  syncBodyScrollLock()
}

function isBottomTabActive(tab) {
  if (tab.kind === 'mine') {
    if (mobileSheetKind.value === 'mine') return true
    if (isRouteActive('/profile') || route.path.startsWith('/auth')) {
      return true
    }
    return [pricingLink, ...toolLinks].some((link) => isLinkVisible(link) && isRouteActive(link.to))
  }

  if (mobileSheetKind.value === tab.id || mobileSheetKind.value === tab.groupKey) {
    return true
  }

  if (tab.kind === 'group') {
    const def = dropdownGroupDefs[tab.groupKey]
    return def?.links.some((link) => isRouteActive(link.to)) ?? false
  }

  if (tab.kind === 'link' && tab.link?.to) {
    return isRouteActive(tab.link.to)
  }

  return false
}

function handleBottomTabClick(tab) {
  if (tab.kind === 'mine') {
    openMobileSheet('mine')
    return
  }

  if (tab.kind === 'group') {
    const inGroup = isBottomTabGroupRouteActive(tab.groupKey)
    if (inGroup) {
      openMobileSheet(tab.groupKey)
      return
    }

    closeMobileSheet()
    const group = navItems.value.find((item) => item.type === 'group' && item.id === tab.groupKey)
    if (group) {
      const firstLink = getFirstNavigableLink(group.links)
      if (firstLink && !isLinkDisabled(firstLink) && !isRouteActive(firstLink.to)) {
        router.push(firstLink.to)
      }
      prefetchLinks(group.links)
    }
    return
  }

  closeMobileSheet()

  if (tab.kind === 'link' && tab.link) {
    if (isLinkDisabled(tab.link)) return
    prefetchRoute(tab.link.to)
    if (!isRouteActive(tab.link.to)) {
      router.push(tab.link.to)
    }
  }
}

function isBottomTabGroupRouteActive(groupKey) {
  const def = dropdownGroupDefs[groupKey]
  return def?.links.some((link) => isLinkVisible(link) && isRouteActive(link.to)) ?? false
}

function syncMobileNavMode() {
  if (typeof window === 'undefined') return
  const nextMobile = window.matchMedia(MOBILE_NAV_MQ).matches
  if (isMobileNav.value === nextMobile) return
  isMobileNav.value = nextMobile
  if (!nextMobile) {
    closeMenu()
  }
  publishChromeOffsets()
}

function syncBodyScrollLock() {
  if (typeof document === 'undefined') return
  const locked = isMobileNav.value && Boolean(mobileSheetKind.value)

  document.documentElement.classList.toggle('nav-mobile-open', locked)
  document.body.classList.toggle('nav-mobile-open', locked)
  setBodyScrollLock(MOBILE_NAV_SCROLL_LOCK, locked, { freezeViewport: true })
}

function clearDropdownCloseTimer() {
  if (dropdownCloseTimer == null) return
  window.clearTimeout(dropdownCloseTimer)
  dropdownCloseTimer = null
}

function toggleDropdown(name) {
  clearDropdownCloseTimer()
  activeDropdown.value = activeDropdown.value === name ? '' : name
  const group = navItems.value.find((item) => item.type === 'group' && item.name === name)
  if (group) prefetchLinks(group.links)
}

function openDropdown(name) {
  if (isMobileNav.value && mobileSheetKind.value) return
  clearDropdownCloseTimer()
  activeDropdown.value = name
  const group = navItems.value.find((item) => item.type === 'group' && item.name === name)
  if (group) prefetchLinks(group.links)
}

function closeMenu() {
  clearDropdownCloseTimer()
  closeMobileSheet()
  activeDropdown.value = ''
}

function normalizePrefetchPath(to) {
  if (typeof to === 'string') return to.split('?')[0].split('#')[0]
  if (!to || typeof to !== 'object') return ''
  if (to.path) return String(to.path).split('?')[0].split('#')[0]
  if (to.name === 'auth') return '/auth'
  if (to.name === 'profile') return '/profile'
  return ''
}

function prefetchRoute(to) {
  if (typeof window === 'undefined') return
  const path = normalizePrefetchPath(to)
  const prefetcher = routePrefetchers[path]
  if (!prefetcher || prefetchedRoutes.has(path) || route.path === path) return
  prefetchedRoutes.add(path)
  prefetcher().catch(() => prefetchedRoutes.delete(path))
}

function prefetchLinks(links = []) {
  if (typeof window === 'undefined') return
  const run = () => links.forEach((link) => prefetchRoute(link.to || link))
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1200 })
    return
  }
  window.setTimeout(run, 80)
}

function focusFirstDropdownItem(name) {
  nextTick(() => {
    const item = siteHeaderEl.value?.querySelector(
      `[data-dropdown-menu="${name}"] .nav-dropdown-item`,
    )
    item?.focus()
  })
}

function handleDropdownKeydown(event, name) {
  if (event.key === 'Enter') {
    event.preventDefault()
    const group = navItems.value.find((item) => item.type === 'group' && item.name === name)
    if (group) handleGroupPrimaryClick(group, event)
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (activeDropdown.value !== name) {
      activeDropdown.value = name
    }
    focusFirstDropdownItem(name)
  }

  if (event.key === 'Escape') {
    closeDropdowns()
  }
}

function handleMobileSheetLinkClick(link, event) {
  if (link.disabled) {
    handleDisabledLinkClick(event)
    return
  }
  closeMobileSheet()
}

function closeDropdowns() {
  clearDropdownCloseTimer()
  activeDropdown.value = ''
}

/** 鼠标离开时延迟关闭，方便移入菜单区域点击 */
function scheduleCloseDropdowns() {
  clearDropdownCloseTimer()
  dropdownCloseTimer = window.setTimeout(() => {
    dropdownCloseTimer = null
    activeDropdown.value = ''
  }, DROPDOWN_CLOSE_DELAY_MS)
}

function handleDocumentClick(event) {
  if (isMobileNav.value) return
  // account-menu 使用 @click.stop，内部点击不会冒泡到这里；点到页头其它区域应关闭
  if (activeDropdown.value === 'account') {
    closeDropdowns()
    return
  }
  if (!siteHeaderEl.value?.contains(event.target)) {
    closeDropdowns()
  }
}

function handleEscape(event) {
  if (event.key !== 'Escape') return
  if (redeemDialogOpen.value) {
    closeRedeemDialog()
    return
  }
  closeMenu()
}

watch(
  () => route.fullPath,
  () => {
    closeMenu()
    publishHeaderOffset()
  },
)

watch(
  () => settingsStore.settings.sidebar_compact,
  () => publishHeaderOffset(),
)

watch(mobileSheetKind, () => {
  publishChromeOffsets()
  syncBodyScrollLock()
})

watch(activeDropdown, () => publishChromeOffsets())

watch(isMobileNav, () => {
  syncBodyScrollLock()
  publishChromeOffsets()
  nextTick(() => bindChromeResizeObservers())
})

watch(bottomTabs, () => publishChromeOffsets())

watch(mobileBottomNavEl, () => {
  nextTick(() => bindChromeResizeObservers())
})

watch(
  () => authStore.isAuthenticated,
  (ok) => {
    if (ok) void refreshWalletBalance({ force: true }).catch(() => null)
  },
)

onMounted(() => {
  syncMobileNavMode()
  if (typeof window !== 'undefined') {
    mobileNavMq = window.matchMedia(MOBILE_NAV_MQ)
    mobileNavMq.addEventListener('change', syncMobileNavMode)
    syncHeaderScrollState()
    window.addEventListener('scroll', onWindowScroll, { passive: true })
  }
  publishHeaderOffset()
  window.addEventListener('resize', publishHeaderOffset)
  window.addEventListener('resize', syncMobileNavMode)
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleEscape)
  nextTick(() => bindChromeResizeObservers())
  if (authStore.isAuthenticated) {
    void refreshWalletBalance({ force: true }).catch(() => null)
  }
})

function onDropdownFocusOut(event, name) {
  const root = event.currentTarget
  const next = event.relatedTarget
  if (root instanceof Element && next instanceof Node && root.contains(next)) return
  if (activeDropdown.value === name) scheduleCloseDropdowns()
}

onBeforeUnmount(() => {
  clearDropdownCloseTimer()
  mobileNavMq?.removeEventListener('change', syncMobileNavMode)
  mobileNavMq = null
  document.documentElement.classList.remove('nav-mobile-open')
  document.body.classList.remove('nav-mobile-open')
  setBodyScrollLock(MOBILE_NAV_SCROLL_LOCK, false)
  window.removeEventListener('scroll', onWindowScroll)
  if (scrollRaf) {
    window.cancelAnimationFrame(scrollRaf)
    scrollRaf = 0
  }
  window.removeEventListener('resize', publishHeaderOffset)
  window.removeEventListener('resize', syncMobileNavMode)
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleEscape)
  headerResizeObserver?.disconnect()
  headerResizeObserver = null
})
</script>

<template>
  <header
    ref="siteHeaderEl"
    class="site-header"
    :class="{
      'nav-compact': settingsStore.settings.sidebar_compact,
      'nav-motion-off': !settingsStore.getSetting('sidebar_animation_effect', true),
      'nav-mobile-sheet-open': isMobileNav && Boolean(mobileSheetKind),
      'is-dark': appearanceStore.isDark,
      'is-scrolled': isScrolled,
    }"
  >
    <div class="header-shell">
      <div class="header-row">
        <div class="brand-cluster">
          <router-link class="brand-mark" to="/" aria-label="星空云绘首页" @click="closeMenu">
            <span class="brand-icon">
              <img src="/brand/starcloud-logo.svg" alt="" />
            </span>
            <span class="brand-copy">
              <strong>星空云绘</strong>
              <small>StarCloudIsAI</small>
            </span>
          </router-link>
        </div>

        <nav v-if="!isMobileNav" class="main-nav" aria-label="主导航">
          <template v-for="item in navItems" :key="item.id">
            <router-link
              v-if="item.type === 'link'"
              :to="item.to"
              class="nav-link"
              :class="{
                'nav-home-link': item.id === 'home',
                active: isRouteActive(item.to),
                disabled: isLinkDisabled(item),
              }"
              :aria-disabled="isLinkDisabled(item)"
              :title="isLinkDisabled(item) ? linkDisabledReason(item) : ''"
              @click="isLinkDisabled(item) ? handleDisabledLinkClick($event) : closeMenu()"
              @focus="prefetchRoute(item.to)"
              @pointerenter="prefetchRoute(item.to)"
            >
              <i class="bi" :class="item.icon"></i>
              <span>{{ item.label }}</span>
            </router-link>

            <div
              v-else
              class="nav-dropdown"
              :class="{
                open: activeDropdown === item.name,
                active: isGroupActive(item.links),
                'nav-dropdown--mega': item.mega,
              }"
              @mouseenter="openDropdown(item.name)"
              @mouseleave="scheduleCloseDropdowns"
              @focusin="openDropdown(item.name)"
              @focusout="onDropdownFocusOut($event, item.name)"
            >
              <div class="nav-link nav-dropdown-trigger">
                <button
                  type="button"
                  class="nav-dropdown-label"
                  :aria-controls="`nav-dropdown-${item.name}`"
                  @click="handleGroupPrimaryClick(item, $event)"
                  @keydown="handleDropdownKeydown($event, item.name)"
                  @pointerenter="prefetchRoute(item.primaryTo || getFirstNavigableLink(item.links)?.to)"
                >
                  <i class="bi" :class="item.icon"></i>
                  <span>{{ groupDisplayLabel(item) }}</span>
                  <i
                    class="bi bi-chevron-down nav-caret"
                    :class="{ 'is-open': activeDropdown === item.name }"
                    aria-hidden="true"
                  ></i>
                </button>
                <button
                  type="button"
                  class="nav-dropdown-chevron-btn"
                  :aria-expanded="activeDropdown === item.name"
                  aria-label="展开子菜单"
                  @click.stop="toggleDropdown(item.name)"
                >
                  <i
                    class="bi bi-chevron-down dropdown-chevron"
                    :class="{ 'is-open': activeDropdown === item.name }"
                    aria-hidden="true"
                  ></i>
                </button>
              </div>

              <div
                v-if="item.mega"
                :id="`nav-dropdown-${item.name}`"
                class="nav-dropdown-menu nav-mega-menu"
                role="menu"
                :data-dropdown-menu="item.name"
              >
                <div class="nav-bento" role="none">
                  <router-link
                    v-for="link in item.links"
                    :key="link.to"
                    :to="link.to"
                    class="nav-bento-card"
                    :class="[
                      `is-${link.bento || 'tile'}`,
                      `is-${link.id}`,
                      {
                        active: isRouteActive(link.to),
                        disabled: isLinkDisabled(link),
                      },
                    ]"
                    :aria-disabled="isLinkDisabled(link)"
                    :title="isLinkDisabled(link) ? linkDisabledReason(link) : link.tagline"
                    role="menuitem"
                    @click="isLinkDisabled(link) ? handleDisabledLinkClick($event) : closeMenu()"
                    @focus="onMegaCardEnter(link)"
                    @pointerenter="onMegaCardEnter(link)"
                  >
                    <span class="nav-bento-card__media" aria-hidden="true">
                      <img
                        :src="link.cover"
                        :alt="''"
                        loading="lazy"
                        @error="onToolCoverError($event, link)"
                      />
                    </span>
                    <span class="nav-bento-card__copy">
                      <strong>{{ link.label }}</strong>
                      <small>{{ link.tagline }}</small>
                    </span>
                    <em
                      v-if="isRouteActive(link.to)"
                      class="nav-bento-card__selected"
                      aria-hidden="true"
                    >
                      <i class="bi bi-check-lg"></i>
                    </em>
                    <em v-else-if="isLinkDisabled(link)" class="nav-bento-card__lock">未开放</em>
                  </router-link>
                </div>
              </div>

              <div
                v-else
                :id="`nav-dropdown-${item.name}`"
                class="nav-dropdown-menu"
                role="menu"
                :data-dropdown-menu="item.name"
              >
                <router-link
                  v-for="link in item.links"
                  :key="link.to"
                  :to="link.to"
                  class="nav-dropdown-item"
                  :class="{ active: isRouteActive(link.to), disabled: isLinkDisabled(link) }"
                  :aria-disabled="isLinkDisabled(link)"
                  :title="isLinkDisabled(link) ? linkDisabledReason(link) : ''"
                  role="menuitem"
                  @click="isLinkDisabled(link) ? handleDisabledLinkClick($event) : closeMenu()"
                  @focus="prefetchRoute(link.to)"
                  @pointerenter="prefetchRoute(link.to)"
                >
                  <i class="bi" :class="link.icon"></i>
                  <span>{{ link.label }}</span>
                  <em v-if="isLinkDisabled(link)">未开放</em>
                </router-link>
              </div>
            </div>
          </template>
        </nav>

        <div v-if="!isMobileNav" class="header-tools">
          <div class="tool-actions">
            <LocaleSwitcher class="nav-locale-switch" />
            <ThemeDayNightSwitch class="nav-theme-switch" />

            <router-link
              v-if="!authStore.isAuthenticated && authVisible"
              :to="loginRoute"
              class="account-login"
              :class="{ disabled: authDisabled }"
              :aria-disabled="authDisabled"
              :title="authDisabled ? linkDisabledReason({ to: '/auth' }) : ''"
              @click="authDisabled ? handleDisabledLinkClick($event) : closeMenu()"
              @focus="prefetchRoute('/auth')"
              @pointerenter="prefetchRoute('/auth')"
            >
              <i class="bi bi-box-arrow-in-right" aria-hidden="true"></i>
              <span>登录</span>
            </router-link>

            <template v-else-if="authStore.isAuthenticated">
              <button type="button" class="nav-redeem-btn" title="兑换码" @click="openRedeemDialog">
                <i class="bi bi-ticket-perforated" aria-hidden="true"></i>
                <span>兑换</span>
              </button>

              <router-link
                v-if="isLinkVisible(pricingLink)"
                :to="pricingLink.to"
                class="nav-credits-chip"
                :class="{ disabled: isLinkDisabled(pricingLink) }"
                :aria-disabled="isLinkDisabled(pricingLink)"
                :title="isLinkDisabled(pricingLink) ? linkDisabledReason(pricingLink) : '积分余额'"
                @click="isLinkDisabled(pricingLink) ? handleDisabledLinkClick($event) : closeMenu()"
                @focus="prefetchRoute('/pricing')"
                @pointerenter="prefetchRoute('/pricing')"
              >
                <i class="bi bi-lightning-charge-fill" aria-hidden="true"></i>
                <span>{{ balanceNumberDisplay }}</span>
              </router-link>
              <button
                v-else
                type="button"
                class="nav-credits-chip"
                title="积分余额"
                @click="openRedeemDialog"
              >
                <i class="bi bi-lightning-charge-fill" aria-hidden="true"></i>
                <span>{{ balanceNumberDisplay }}</span>
              </button>

              <div
                v-if="profileVisible"
                class="account-menu"
                :class="{ open: accountMenuOpen, disabled: profileDisabled }"
                @click.stop
              >
                <button
                  type="button"
                  class="account-chip"
                  :class="{
                    disabled: profileDisabled,
                    active: accountMenuOpen || isRouteActive('/profile'),
                  }"
                  :aria-expanded="accountMenuOpen"
                  aria-haspopup="menu"
                  :aria-disabled="profileDisabled"
                  :title="profileDisabled ? linkDisabledReason({ to: '/profile' }) : '个人中心'"
                  @click="
                    profileDisabled ? handleDisabledLinkClick($event) : toggleAccountMenu()
                  "
                  @focus="prefetchRoute('/profile')"
                  @pointerenter="prefetchRoute('/profile')"
                >
                  <img
                    class="account-chip__avatar"
                    :src="accountAvatarUrl"
                    alt=""
                    @error="$event.target.src = '/brand/avatar-placeholder.svg'"
                  />
                </button>

                <Transition name="account-menu">
                  <div
                    v-if="accountMenuOpen"
                    class="account-menu__panel"
                    role="menu"
                    aria-label="个人中心菜单"
                  >
                    <div class="account-menu__head">
                      <img
                        class="account-menu__avatar"
                        :src="accountAvatarUrl"
                        alt=""
                        @error="$event.target.src = '/brand/avatar-placeholder.svg'"
                      />
                      <div class="account-menu__copy">
                        <strong>{{ accountDisplayName }}</strong>
                        <small>{{ balanceDisplay }}</small>
                      </div>
                    </div>

                    <div class="account-menu__list">
                      <router-link
                        class="account-menu__item"
                        role="menuitem"
                        :to="profileRoute"
                        @click="closeMenu()"
                        @focus="prefetchRoute('/profile')"
                        @pointerenter="prefetchRoute('/profile')"
                      >
                        <i class="bi bi-person-circle" aria-hidden="true"></i>
                        <span>个人中心</span>
                      </router-link>
                      <router-link
                        v-if="isLinkVisible(pricingLink)"
                        class="account-menu__item"
                        role="menuitem"
                        :to="pricingLink.to"
                        :class="{ disabled: isLinkDisabled(pricingLink) }"
                        @click="
                          isLinkDisabled(pricingLink)
                            ? handleDisabledLinkClick($event)
                            : closeMenu()
                        "
                        @focus="prefetchRoute('/pricing')"
                        @pointerenter="prefetchRoute('/pricing')"
                      >
                        <i class="bi bi-lightning-charge-fill" aria-hidden="true"></i>
                        <span>充值积分</span>
                      </router-link>
                      <button
                        type="button"
                        class="account-menu__item"
                        role="menuitem"
                        @click="openRedeemFromMenu"
                      >
                        <i class="bi bi-ticket-perforated" aria-hidden="true"></i>
                        <span>兑换码</span>
                      </button>
                      <button
                        type="button"
                        class="account-menu__item is-danger"
                        role="menuitem"
                        :disabled="accountLoggingOut"
                        @click="handleAccountLogout"
                      >
                        <i
                          class="bi"
                          :class="accountLoggingOut ? 'bi-arrow-repeat spin' : 'bi-box-arrow-right'"
                          aria-hidden="true"
                        ></i>
                        <span>{{ accountLoggingOut ? '正在退出…' : '退出登录' }}</span>
                      </button>
                    </div>
                  </div>
                </Transition>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </header>

  <Teleport to="body">
    <Transition name="msheet">
      <div
        v-if="isMobileNav && mobileSheetKind"
        class="msheet-root"
        @keydown.esc.stop="closeMobileSheet"
      >
        <button
          type="button"
          class="msheet-scrim"
          aria-label="关闭菜单"
          @click="closeMobileSheet"
        ></button>

        <section
          class="msheet-panel"
          :class="{ 'is-dark': appearanceStore.isDark }"
          role="dialog"
          aria-modal="true"
          :aria-label="mobileSheetTitle"
        >
          <div class="msheet-handle" aria-hidden="true"></div>
          <header class="msheet-header">
            <h2 class="msheet-title">{{ mobileSheetTitle }}</h2>
            <div class="msheet-header-actions">
              <LocaleSwitcher v-if="mobileSheetKind === 'mine'" class="msheet-locale-switch" />
              <ThemeDayNightSwitch v-if="mobileSheetKind === 'mine'" class="msheet-theme-switch" />
              <button
                type="button"
                class="msheet-close"
                aria-label="关闭"
                @click="closeMobileSheet"
              >
                <i class="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            </div>
          </header>

          <div
            v-if="mobileSheetKind === 'mine' && authStore.isAuthenticated"
            class="msheet-account"
          >
            <img
              class="msheet-account__avatar"
              :src="accountAvatarUrl"
              alt=""
              @error="$event.target.src = '/brand/avatar-placeholder.svg'"
            />
            <div class="msheet-account__copy">
              <strong>{{ accountDisplayName }}</strong>
              <small>
                <i class="bi bi-lightning-charge-fill" aria-hidden="true"></i>
                {{ balanceNumberDisplay }}
              </small>
            </div>
            <button type="button" class="msheet-account__redeem" @click="openRedeemDialog">
              兑换
            </button>
            <button
              type="button"
              class="msheet-account__logout"
              :disabled="accountLoggingOut"
              @click="handleAccountLogout"
            >
              {{ accountLoggingOut ? '退出中…' : '退出' }}
            </button>
          </div>

          <div class="msheet-grid">
            <router-link
              v-for="link in mobileSheetLinks"
              :key="link.id"
              :to="link.to"
              class="msheet-cell"
              :class="{
                active: typeof link.to === 'string' && isRouteActive(link.to),
                disabled: link.disabled,
              }"
              :aria-disabled="link.disabled"
              @click="handleMobileSheetLinkClick(link, $event)"
            >
              <i class="bi" :class="link.icon" aria-hidden="true"></i>
              <span>{{ link.label }}</span>
            </router-link>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <nav
      v-if="isMobileNav && bottomTabs.length"
      ref="mobileBottomNavEl"
      class="mbottom-nav"
      :class="{ 'is-dark': appearanceStore.isDark }"
      :style="{ '--mbottom-nav-count': bottomTabs.length }"
      aria-label="底部导航"
    >
      <button
        v-for="tab in bottomTabs"
        :key="tab.id"
        type="button"
        class="mbottom-nav-item"
        :class="{
          active: isBottomTabActive(tab),
          'has-sheet': tab.kind === 'group' || tab.kind === 'mine',
        }"
        :aria-current="isBottomTabActive(tab) && !mobileSheetKind ? 'page' : undefined"
        :aria-expanded="
          mobileSheetKind === tab.id || mobileSheetKind === tab.groupKey ? true : undefined
        "
        @click="handleBottomTabClick(tab)"
      >
        <i class="bi" :class="tab.icon" aria-hidden="true"></i>
        <span>{{ tab.label }}</span>
      </button>
    </nav>
  </Teleport>

  <RedeemCodeDialog :open="redeemDialogOpen" @close="closeRedeemDialog" />
</template>

<style scoped>
.site-header {
  --nav-bg: transparent;
  --nav-bg-solid: #ffffff;
  --nav-track: rgba(21, 22, 31, 0.035);
  --nav-hover: rgba(21, 22, 31, 0.055);
  --nav-line: rgba(21, 22, 31, 0.09);
  --nav-line-strong: rgba(109, 92, 255, 0.34);
  --nav-accent: #6d5cff;
  --nav-accent-soft: rgba(109, 92, 255, 0.1);
  --nav-accent-mid: rgba(109, 92, 255, 0.16);
  --nav-heading: #17171f;
  --nav-text: #444451;
  --nav-muted: #777785;
  --nav-on-accent: #ffffff;
  --nav-shadow: 0 10px 28px rgba(58, 51, 112, 0.08);
  --nav-ease: cubic-bezier(0.22, 0.8, 0.24, 1);
  --nav-song: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  --nav-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3000;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  border: 0;
  border-bottom: 0;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none;
  pointer-events: none;
  transition:
    background 220ms var(--nav-ease),
    backdrop-filter 220ms var(--nav-ease),
    -webkit-backdrop-filter 220ms var(--nav-ease);
}

.site-header.is-scrolled {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  border: 0;
  border-bottom: 0;
  box-shadow: none;
}

.site-header.is-dark {
  --nav-bg: transparent;
  --nav-bg-solid: #121218;
  --nav-track: rgba(255, 255, 255, 0.035);
  --nav-hover: rgba(255, 255, 255, 0.06);
  --nav-line: rgba(255, 255, 255, 0.08);
  --nav-line-strong: rgba(109, 92, 255, 0.52);
  --nav-accent: #8b7bff;
  --nav-accent-soft: rgba(109, 92, 255, 0.14);
  --nav-accent-mid: rgba(109, 92, 255, 0.22);
  --nav-heading: rgba(255, 255, 255, 0.96);
  --nav-text: rgba(255, 255, 255, 0.78);
  --nav-muted: rgba(255, 255, 255, 0.52);
  --nav-on-accent: #12101c;
  --nav-shadow: 0 18px 48px rgba(0, 0, 0, 0.46);
}

.site-header.is-dark.is-scrolled {
  background: rgba(18, 18, 24, 0.72);
  backdrop-filter: blur(16px) saturate(1.15);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);
  border: 0;
  border-bottom: 0;
  box-shadow: none;
}

.header-shell {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  min-height: 62px;
  padding: 0 clamp(14px, 2vw, 28px);
  pointer-events: auto;
  overflow: visible;
}

.nav-compact .header-shell {
  min-height: 54px;
  padding: 0 clamp(12px, 1.5vw, 18px);
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: clamp(12px, 1.8vw, 24px);
  width: 100%;
  min-height: inherit;
}

.header-row .main-nav:not(.is-mobile) {
  flex: 1 1 auto;
  justify-content: center;
  min-width: 0;
}

.brand-cluster {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 0;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 3px 7px 3px 3px;
  border: 1px solid transparent;
  border-radius: 9px;
  color: var(--nav-heading);
  text-decoration: none;
  transition:
    border-color 180ms var(--nav-ease),
    background 180ms var(--nav-ease);
}

.brand-mark:hover {
  border-color: transparent;
  background: var(--nav-hover);
}

.brand-icon {
  width: 32px;
  height: 32px;
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  background: transparent;
}

.brand-icon img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.brand-copy strong {
  font-family: var(--nav-song);
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.1;
  white-space: nowrap;
}

.brand-copy small {
  color: var(--nav-muted);
  font-family: var(--nav-mono);
  font-size: 0.56rem;
  font-weight: 650;
  letter-spacing: 0;
  white-space: nowrap;
}

.nav-compact .brand-icon {
  width: 30px;
  height: 30px;
}

.nav-compact .brand-copy strong {
  font-size: 0.9rem;
}

.main-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 一级菜单平铺后条目较多：放不下时换行，避免盖住品牌区或右侧工具 */
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  min-width: 0;
  width: max-content;
  max-width: 100%;
}

/* 顶栏一级项纯文字展示（图标保留在下拉子菜单里），为平铺后的多条目省宽度 */
.main-nav .nav-link > i.bi:first-child,
.main-nav .nav-dropdown-label > i.bi:first-child {
  display: none;
}

.nav-link,
.nav-dropdown-label {
  position: relative;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 11px;
  border: 0;
  border-radius: 7px;
  color: var(--nav-muted);
  text-decoration: none;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 620;
  white-space: nowrap;
  background: transparent;
  cursor: pointer;
}

.nav-link > i:first-child,
.nav-dropdown-label > i:first-child {
  font-size: 0.92rem;
  opacity: 0.78;
}

.nav-caret {
  margin-left: 1px;
  font-size: 0.62rem;
  opacity: 0.5;
  transition:
    transform 0.18s var(--nav-ease),
    opacity 0.18s var(--nav-ease);
}

.nav-caret.is-open {
  transform: rotate(180deg);
  opacity: 0.85;
}

.nav-link:hover,
.nav-dropdown-label:hover {
  color: var(--nav-heading);
  background: var(--nav-hover);
}

.nav-link:hover > i:first-child,
.nav-dropdown-label:hover > i:first-child,
.nav-link.active > i:first-child,
.nav-dropdown.active > .nav-dropdown-trigger .nav-dropdown-label > i:first-child {
  opacity: 1;
  color: var(--nav-accent);
}

.nav-link.active,
.nav-dropdown.active > .nav-dropdown-trigger .nav-dropdown-label {
  color: var(--nav-heading);
  background: var(--nav-accent-soft);
  box-shadow: none;
}

.nav-link.disabled,
.nav-link.disabled:hover {
  opacity: 0.4;
  cursor: not-allowed;
  color: var(--nav-muted);
  background: transparent;
  box-shadow: none;
}

.nav-compact .nav-link,
.nav-compact .nav-dropdown-label {
  min-height: 32px;
  padding: 0 10px;
  font-size: 0.82rem;
}

.site-header:not(.nav-motion-off) .header-shell,
.site-header:not(.nav-motion-off) .nav-link,
.site-header:not(.nav-motion-off) .nav-dropdown-label,
.site-header:not(.nav-motion-off) .nav-dropdown-menu,
.site-header:not(.nav-motion-off) .nav-dropdown-item,
.site-header:not(.nav-motion-off) .tool-icon,
.site-header:not(.nav-motion-off) .account-chip,
.site-header:not(.nav-motion-off) .account-login {
  transition:
    background 0.18s var(--nav-ease),
    color 0.18s var(--nav-ease),
    border-color 0.18s var(--nav-ease),
    box-shadow 0.18s var(--nav-ease),
    transform 0.18s var(--nav-ease),
    opacity 0.18s var(--nav-ease),
    padding 0.22s var(--nav-ease);
}

.site-header.nav-motion-off .header-shell,
.site-header.nav-motion-off .nav-link,
.site-header.nav-motion-off .nav-dropdown-menu,
.site-header.nav-motion-off .tool-icon,
.site-header.nav-motion-off .account-chip {
  transition: none !important;
}

.nav-dropdown {
  position: relative;
  flex: 0 0 auto;
}

.nav-dropdown-trigger {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
}

/* 触发器外套了 .nav-link，避免与内部 .nav-dropdown-label 叠两层背景造成重影 */
.nav-link.nav-dropdown-trigger,
.nav-link.nav-dropdown-trigger:hover,
.nav-link.nav-dropdown-trigger:focus,
.nav-link.nav-dropdown-trigger.active {
  min-height: 0;
  padding: 0;
  gap: 0;
  background: transparent !important;
  box-shadow: none !important;
  color: inherit;
}

.nav-dropdown-chevron-btn,
.dropdown-chevron {
  display: none;
}

.nav-dropdown-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 20;
  width: min(236px, calc(100vw - 40px));
  display: grid;
  gap: 3px;
  padding: 6px;
  border: 1px solid var(--nav-line);
  border-radius: 10px;
  background: var(--nav-bg-solid);
  box-shadow: var(--nav-shadow);
  opacity: 0;
  pointer-events: none;
  transform: translate3d(-50%, -4px, 0);
  visibility: hidden;
}

.nav-dropdown.open .nav-dropdown-menu {
  opacity: 1;
  pointer-events: auto;
  transform: translate3d(-50%, 0, 0);
  visibility: visible;
}

.nav-dropdown-menu::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -12px;
  height: 12px;
}

.nav-dropdown.nav-dropdown--mega .nav-mega-menu.nav-dropdown-menu::before {
  top: -16px;
  height: 16px;
}

.nav-dropdown-item {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--nav-text);
  text-decoration: none;
  font-size: 0.86rem;
  font-weight: 620;
  background: transparent;
}

.nav-dropdown-item > i {
  width: 16px;
  text-align: center;
  color: var(--nav-accent);
  opacity: 0.85;
}

.nav-dropdown-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-dropdown-item em {
  margin-left: auto;
  padding: 2px 6px;
  color: var(--nav-muted);
  background: var(--nav-accent-soft);
  font-size: 0.64rem;
  font-style: normal;
  font-weight: 700;
  font-family: var(--nav-mono);
}

.nav-dropdown-item:hover,
.nav-dropdown-item.active {
  color: var(--nav-heading);
  background: var(--nav-accent-soft);
}

.nav-dropdown-item.active {
  border-color: var(--nav-line-strong);
}

.nav-dropdown-item:hover > i,
.nav-dropdown-item.active > i {
  opacity: 1;
}

.nav-dropdown-item.disabled,
.nav-dropdown-item.disabled:hover {
  opacity: 0.45;
  cursor: not-allowed;
  background: transparent;
}

.nav-dropdown.nav-dropdown--mega {
  position: relative;
  z-index: 30;
}

.nav-dropdown.nav-dropdown--mega .nav-mega-menu.nav-dropdown-menu {
  left: 50%;
  right: auto;
  top: calc(100% + 12px);
  width: min(680px, calc(100vw - 40px));
  display: block;
  gap: 0;
  padding: 8px;
  border-radius: 18px;
  background: #fff;
  border: 0;
  box-shadow: 0 18px 48px rgba(18, 20, 28, 0.12);
  transform: translate3d(-42%, -8px, 0);
}

.site-header.is-dark .nav-dropdown.nav-dropdown--mega .nav-mega-menu {
  background: #17171f;
  border: 0;
  box-shadow: 0 26px 64px rgba(0, 0, 0, 0.45);
}

.nav-dropdown.nav-dropdown--mega.open .nav-mega-menu.nav-dropdown-menu {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translate3d(-42%, 0, 0);
}

.nav-bento {
  --bento-gap: 8px;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-areas:
    'assistant assistant assistant model model model t2i t2i t2i coloring coloring coloring'
    'assistant assistant assistant model model model ui ui ui ui ui ui'
    'game game game game game game puzzle puzzle puzzle puzzle puzzle puzzle';
  gap: var(--bento-gap);
  min-width: 0;
  align-items: stretch;
}

.nav-bento-card {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: clip;
  border: 0 !important;
  border-radius: 14px;
  outline: none !important;
  box-shadow: none !important;
  text-decoration: none;
  color: #fff;
  background: transparent;
}

/* 左侧通高主卡 */
.nav-bento-card.is-assistant {
  grid-area: assistant;
}

/* 上排小卡 */
.nav-bento-card.is-t2i {
  grid-area: t2i;
  aspect-ratio: 4 / 3;
  width: 100%;
}

.nav-bento-card.is-coloring {
  grid-area: coloring;
  aspect-ratio: 4 / 3;
  width: 100%;
}

/* UI 横图 */
.nav-bento-card.is-ui {
  grid-area: ui;
  aspect-ratio: 16 / 9;
  width: 100%;
}

/* 模型竖图 9:16 */
.nav-bento-card.is-model {
  grid-area: model;
}

/* 底栏等宽宽卡 */
.nav-bento-card.is-game {
  grid-area: game;
  min-height: 100px;
}

.nav-bento-card.is-puzzle {
  grid-area: puzzle;
  min-height: 100px;
}

.nav-bento-card__media {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: clip;
  border-radius: inherit;
  background: transparent;
}

.nav-bento-card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  border: 0;
  transform: scale(1.01);
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.nav-bento-card.is-model .nav-bento-card__media img {
  object-position: center top;
}

.nav-bento-card.is-assistant .nav-bento-card__media img,
.nav-bento-card.is-game .nav-bento-card__media img {
  object-position: center 28%;
}

.nav-bento-card.is-ui .nav-bento-card__media img {
  object-position: center 22%;
}

.nav-bento-card:hover .nav-bento-card__media img,
.nav-bento-card:focus-visible .nav-bento-card__media img {
  transform: scale(1.08);
}

.nav-bento-card.is-hero .nav-bento-card__media::after,
.nav-bento-card.is-tile .nav-bento-card__media::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgba(8, 9, 14, 0.88) 0%,
    rgba(8, 9, 14, 0.35) 42%,
    rgba(8, 9, 14, 0.08) 72%,
    transparent 100%
  );
  pointer-events: none;
}

.nav-bento-card__copy {
  position: absolute;
  z-index: 2;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  gap: 2px;
  padding: 12px 12px 10px;
  min-width: 0;
}

.nav-bento-card.is-assistant .nav-bento-card__copy {
  padding: 16px 14px 14px;
}

.nav-bento-card.is-assistant .nav-bento-card__copy strong {
  font-size: 1.05rem;
}

.nav-bento-card__copy strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
  font-weight: 760;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.nav-bento-card__copy strong i {
  font-size: 0.85rem;
  opacity: 0.9;
}

.nav-bento-card__copy small {
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.68rem;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-bento-card__lock {
  position: absolute;
  z-index: 3;
  top: 12px;
  right: 12px;
  margin: 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 0.64rem;
  font-style: normal;
  font-weight: 700;
}

.nav-bento-card.disabled,
.nav-bento-card.disabled:hover {
  opacity: 0.48;
  cursor: not-allowed;
}

.nav-bento-card.disabled .nav-bento-card__media img {
  transform: none;
}

.nav-bento-card:hover,
.nav-bento-card:focus,
.nav-bento-card:focus-visible,
.nav-bento-card:active {
  border: 0 !important;
  outline: none !important;
}

.nav-bento-card.active {
  border: 0 !important;
  outline: none !important;
  /* 内侧高亮，避免外圈描边发丝线 */
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.92) !important;
}

.nav-bento-card.active .nav-bento-card__copy strong {
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.45);
}

.nav-bento-card__selected {
  position: absolute;
  z-index: 3;
  top: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  color: #17181f;
  font-size: 0.95rem;
  font-style: normal;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}

@media (max-width: 1100px) {
  .desk-nav .nav-dropdown.nav-dropdown--mega .nav-mega-menu.nav-dropdown-menu {
    width: min(640px, calc(100vw - 28px));
    padding: 8px;
  }

  .nav-bento {
    --bento-gap: 6px;
  }

  .nav-bento-card {
    border-radius: 12px;
  }

  .nav-bento-card__copy {
    padding: 10px 10px 9px;
  }

  .nav-bento-card__copy strong {
    font-size: 0.82rem;
  }

  .nav-bento-card__copy small {
    font-size: 0.64rem;
  }
}

.header-tools {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  margin-left: auto;
}

.tool-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-locale-switch,
.nav-theme-switch {
  margin-inline: 2px;
  height: 36px;
}

.tool-actions > * {
  align-self: center;
}

.tool-icon {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  color: var(--nav-muted);
  text-decoration: none;
  background: transparent;
  font-size: 0.98rem;
  cursor: pointer;
}

.tool-icon:hover,
.tool-icon.active {
  color: var(--nav-accent);
  border-color: var(--nav-line-strong);
  background: var(--nav-accent-soft);
}

.tool-icon.disabled,
.tool-icon.disabled:hover {
  opacity: 0.4;
  cursor: not-allowed;
  color: var(--nav-muted);
  background: transparent;
  border-color: var(--nav-line);
}

.account-login {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--nav-on-accent);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 700;
  background: var(--nav-accent);
  box-sizing: border-box;
  line-height: 1;
}

.account-login:hover {
  filter: brightness(1.06);
}

.account-login.disabled,
.account-login.disabled:hover {
  opacity: 0.5;
  cursor: not-allowed;
  filter: none;
}

.nav-redeem-btn,
.nav-credits-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--nav-line);
  border-radius: 999px;
  color: var(--nav-heading);
  text-decoration: none;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  white-space: nowrap;
  line-height: 1;
  box-sizing: border-box;
}

.site-header.is-dark .nav-redeem-btn,
.site-header.is-dark .nav-credits-chip {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--nav-line);
  color: var(--nav-heading);
}

.nav-redeem-btn:hover,
.nav-credits-chip:hover {
  border-color: color-mix(in srgb, var(--nav-accent) 36%, var(--nav-line));
  background: var(--nav-accent-soft);
  color: var(--nav-heading);
  filter: none;
}

.nav-redeem-btn i {
  font-size: 0.92rem;
  color: var(--nav-accent);
}

.nav-credits-chip {
  font-family: var(--nav-mono);
  letter-spacing: 0.01em;
}

.nav-credits-chip i {
  color: var(--nav-accent);
  font-size: 0.88rem;
}

.site-header.is-dark .nav-redeem-btn i,
.site-header.is-dark .nav-credits-chip i {
  color: var(--nav-accent);
}

.nav-credits-chip.disabled,
.nav-credits-chip.disabled:hover {
  opacity: 0.5;
  cursor: not-allowed;
  filter: none;
}

.account-menu {
  position: relative;
  flex: 0 0 auto;
}

.account-menu.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.account-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--nav-line);
  border-radius: 50%;
  color: var(--nav-heading);
  text-decoration: none;
  background: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  font: inherit;
  appearance: none;
  -webkit-appearance: none;
  overflow: hidden;
}

.site-header.is-dark .account-chip {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--nav-line);
  color: var(--nav-heading);
}

.account-chip:hover,
.account-chip.active {
  border-color: color-mix(in srgb, var(--nav-accent) 36%, var(--nav-line));
  background: var(--nav-accent-soft);
  box-shadow: none;
}

.account-chip.disabled,
.account-chip.disabled:hover {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.account-chip__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: 0;
  border-radius: 50%;
  background: var(--nav-accent-soft);
  flex: 0 0 auto;
}

.account-menu__panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 40;
  width: min(260px, calc(100vw - 24px));
  padding: 10px;
  border: 1px solid var(--nav-line);
  border-radius: 16px;
  background: var(--nav-bg-solid, #ffffff);
  box-shadow: var(--nav-shadow);
}

.site-header.is-dark .account-menu__panel {
  background: #17171f;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.48);
}

.account-menu__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 12px;
  border-bottom: 1px solid var(--nav-line);
  margin-bottom: 8px;
}

.account-menu__avatar {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 50%;
  background: var(--nav-accent-soft);
  flex: 0 0 auto;
}

.account-menu__copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.account-menu__copy strong {
  color: var(--nav-heading);
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-menu__copy small {
  color: var(--nav-accent);
  font-family: var(--nav-mono);
  font-size: 0.72rem;
  font-weight: 700;
}

.account-menu__list {
  display: grid;
  gap: 4px;
}

.account-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: 11px;
  color: var(--nav-heading);
  background: transparent;
  text-decoration: none;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}

.account-menu__item i {
  color: var(--nav-muted);
  font-size: 0.95rem;
}

.account-menu__item:hover {
  background: var(--nav-accent-soft);
}

.account-menu__item:hover i {
  color: var(--nav-accent);
}

.account-menu__item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.account-menu__item.is-danger {
  color: #e57373;
}

.account-menu__item.is-danger i {
  color: #e57373;
}

.account-menu__item.is-danger:hover {
  background: rgba(229, 115, 115, 0.12);
}

.account-menu__item .spin {
  display: inline-block;
  animation: account-menu-spin 0.9s linear infinite;
}

@keyframes account-menu-spin {
  to {
    transform: rotate(360deg);
  }
}

.account-menu-enter-active,
.account-menu-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.account-menu-enter-from,
.account-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.nav-compact .tool-icon {
  width: 32px;
  height: 32px;
}

.nav-compact .nav-locale-switch,
.nav-compact .nav-theme-switch {
  height: 32px;
}

.nav-compact .nav-locale-switch :deep(.locale-switcher__trigger) {
  width: 32px;
  height: 32px;
}

.nav-compact .nav-theme-switch :deep(.theme-dn-switch) {
  --theme-dn-w: 54px;
  --theme-dn-h: 32px;
  --theme-dn-knob: 22px;
  --theme-dn-pad: 5px;
}

.nav-compact .nav-redeem-btn,
.nav-compact .nav-credits-chip {
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  font-size: 0.78rem;
}

.nav-compact .account-chip {
  width: 32px;
  height: 32px;
}

.nav-compact .account-login {
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  font-size: 0.8rem;
}

@media (max-width: 1480px) {
  .nav-link,
  .nav-dropdown-label {
    padding: 0 9px;
    font-size: 0.84rem;
  }
}

@media (max-width: 1320px) {
  .brand-copy small {
    display: none;
  }

  .nav-link,
  .nav-dropdown-label {
    padding: 0 7px;
    font-size: 0.8rem;
  }
}

@media (max-width: 1180px) {
  .nav-link,
  .nav-dropdown-label {
    padding: 0 6px;
    font-size: 0.78rem;
  }
}

@media (max-width: 920px) {
  .site-header {
    padding: 0;
    border-bottom: 0;
    background: transparent;
  }

  .header-shell {
    max-width: none;
    min-height: 0;
    padding: 0;
    border: 0;
    box-shadow: none;
    background: transparent;
  }

  .header-row {
    min-height: 56px;
    padding: 0 max(14px, env(safe-area-inset-right)) 0 max(14px, env(safe-area-inset-left));
  }

  .brand-cluster {
    width: 100%;
    justify-content: center;
  }
}
</style>

<style>
html.nav-mobile-open,
body.nav-mobile-open {
  overscroll-behavior: none;
}

.msheet-root {
  position: fixed;
  inset: 0;
  z-index: 4200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  touch-action: none;
}

.msheet-scrim {
  position: absolute;
  inset: 0;
  border: 0;
  margin: 0;
  padding: 0;
  background: rgba(23, 28, 47, 0.38);
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.msheet-panel {
  --ms-accent: #6a4fe0;
  --ms-line: rgba(21, 26, 45, 0.08);
  --ms-card: #ffffff;
  --ms-heading: #171c2f;
  --ms-muted: #7a8299;
  --ms-soft: rgba(106, 79, 224, 0.07);

  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  max-height: min(72dvh, 520px);
  margin-bottom: var(--app-bottom-nav-offset, 62px);
  padding: 10px 16px 16px;
  border: 1px solid var(--ms-line);
  border-bottom: 0;
  background: var(--ms-card);
  box-shadow: 0 -14px 36px rgba(58, 51, 112, 0.12);
}

.msheet-panel.is-dark {
  --ms-accent: #b4a4ff;
  --ms-line: rgba(255, 255, 255, 0.08);
  --ms-card: #151826;
  --ms-heading: #f5f3ff;
  --ms-muted: rgba(205, 200, 235, 0.62);
  --ms-soft: rgba(160, 139, 255, 0.12);
  box-shadow: 0 -14px 36px rgba(0, 0, 0, 0.4);
}

.msheet-handle {
  width: 34px;
  height: 3px;
  margin: 0 auto 12px;
  background: rgba(106, 79, 224, 0.28);
}

.msheet-panel.is-dark .msheet-handle {
  background: rgba(180, 164, 255, 0.35);
}

.msheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.msheet-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.msheet-locale-switch {
  flex: 0 0 auto;
}

.msheet-title {
  margin: 0;
  font-family: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  font-size: 1.04rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--ms-heading);
}

.msheet-account {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--ms-line);
  border-radius: 14px;
  background: var(--ms-soft);
}

.msheet-account__avatar {
  width: 42px;
  height: 42px;
  object-fit: cover;
  border: 1px solid var(--ms-line);
  border-radius: 50%;
  flex: 0 0 auto;
}

.msheet-account__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.msheet-account__copy strong {
  font-size: 0.92rem;
  font-weight: 720;
  color: var(--ms-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msheet-account__copy small {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.74rem;
  font-weight: 700;
  color: #7ed321;
}

.msheet-account__redeem,
.msheet-account__logout {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.msheet-account__redeem {
  border: 1px solid var(--ms-line);
  background: var(--ms-soft);
  color: var(--ms-heading);
}

.msheet-account__logout {
  border: 1px solid rgba(255, 141, 141, 0.3);
  background: rgba(255, 104, 104, 0.1);
  color: #ff9a9a;
}

.msheet-account__logout:disabled {
  opacity: 0.55;
  cursor: wait;
}

.msheet-theme-switch {
  flex: 0 0 auto;
  touch-action: manipulation;
}

.msheet-close {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ms-line);
  color: var(--ms-heading);
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
}

.msheet-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 4px;
}

.msheet-cell {
  min-height: 82px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 8px;
  border: 1px solid var(--ms-line);
  color: var(--ms-heading);
  text-decoration: none;
  font-size: 0.8rem;
  font-weight: 640;
  text-align: center;
  background: transparent;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.msheet-cell > i {
  font-size: 1.22rem;
  color: var(--ms-accent);
}

.msheet-cell:active {
  background: var(--ms-soft);
}

.msheet-cell.active {
  color: var(--ms-accent);
  background: var(--ms-soft);
  border-color: rgba(106, 79, 224, 0.28);
  box-shadow: inset 0 -2px 0 var(--ms-accent);
}

.msheet-panel.is-dark .msheet-cell.active {
  border-color: rgba(180, 164, 255, 0.34);
}

.msheet-cell.disabled,
.msheet-cell.disabled:active {
  opacity: 0.4;
  pointer-events: none;
}

.msheet-enter-active,
.msheet-leave-active {
  transition: opacity 0.22s ease;
}

.msheet-enter-active .msheet-panel,
.msheet-leave-active .msheet-panel {
  transition: transform 0.26s cubic-bezier(0.22, 0.8, 0.24, 1);
}

.msheet-enter-from,
.msheet-leave-to {
  opacity: 0;
}

.msheet-enter-from .msheet-panel,
.msheet-leave-to .msheet-panel {
  transform: translate3d(0, 100%, 0);
}

@media (prefers-reduced-motion: reduce) {
  .msheet-enter-active,
  .msheet-leave-active,
  .msheet-enter-active .msheet-panel,
  .msheet-leave-active .msheet-panel {
    transition: none;
  }
}

.mbottom-nav {
  --mb-accent: #6a4fe0;
  --mb-line: rgba(21, 26, 45, 0.08);
  --mb-card: #ffffff;
  --mb-muted: #7a8299;
  --mb-heading: #171c2f;

  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4100;
  display: grid;
  grid-template-columns: repeat(var(--mbottom-nav-count, 5), minmax(0, 1fr));
  gap: 0;
  min-height: 56px;
  padding: 6px max(8px, env(safe-area-inset-right, 0px))
    calc(6px + env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px));
  border-top: 1px solid var(--mb-line);
  background: var(--mb-card);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: 0 -8px 24px rgba(58, 51, 112, 0.06);
}

.mbottom-nav.is-dark {
  --mb-accent: #b4a4ff;
  --mb-line: rgba(255, 255, 255, 0.08);
  --mb-card: #10121c;
  --mb-muted: rgba(205, 200, 235, 0.58);
  --mb-heading: #f5f3ff;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.35);
}

.mbottom-nav-item {
  position: relative;
  min-width: 0;
  min-height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 4px 2px;
  border: 0;
  color: var(--mb-muted);
  background: transparent;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-size: 0.68rem;
  font-weight: 650;
  line-height: 1.1;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.mbottom-nav-item > i {
  font-size: 1.12rem;
  line-height: 1;
}

.mbottom-nav-item span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mbottom-nav-item:active {
  background: rgba(106, 79, 224, 0.07);
}

.mbottom-nav.is-dark .mbottom-nav-item:active {
  background: rgba(160, 139, 255, 0.1);
}

.mbottom-nav-item.active {
  color: var(--mb-accent);
}

.mbottom-nav-item.has-sheet.active::after {
  content: '';
  position: absolute;
  top: 6px;
  right: calc(50% - 15px);
  width: 5px;
  height: 5px;
  background: var(--mb-accent);
}

html.settings-no-blur .site-header,
html.settings-no-blur .mbottom-nav {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

html.settings-no-blur .site-header {
  background: transparent;
}

html.settings-no-blur .site-header.is-scrolled {
  background: rgba(255, 255, 255, 0.94);
}

html.settings-no-blur .site-header.is-dark {
  background: transparent;
}

html.settings-no-blur .site-header.is-dark.is-scrolled {
  background: rgba(18, 18, 24, 0.94);
}

html.settings-no-blur .mbottom-nav {
  background: #ffffff;
}

html.settings-no-blur .mbottom-nav.is-dark {
  background: #10121c;
}
</style>
