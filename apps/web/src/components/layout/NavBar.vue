<script setup>
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import { useSettingsStore } from '@/stores/settings'
import { DEFAULT_AUTH_REDIRECT, createLoginRedirectQuery } from '@/services/authRedirect'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { navigationTarget } from '@/router'

const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()
const appearanceStore = useAppearanceStore()
const authStore = useAuthStore()
const runtimeConfigStore = useRuntimeConfigStore()
const { balanceDisplay, refreshWalletBalance } = useClientWalletBalance()

const MOBILE_NAV_MQ = '(max-width: 920px)'

const menuOpen = ref(false)
const mobileSheetKind = ref('')
const activeDropdown = ref('')
const isMobileNav = ref(false)
const siteHeaderEl = ref(null)
const mobileBottomNavEl = ref(null)
let headerResizeObserver = null
let mobileNavMq = null
let bodyScrollLockY = 0

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

const shareLink = { to: '/share', label: '画廊', icon: 'bi-images' }

const pricingLink = { to: '/pricing', label: '价格', icon: 'bi-currency-dollar' }

const toolLinks = [
  { to: '/app-space', label: '应用空间', icon: 'bi-columns-gap' },
  { to: '/updates', label: '更新说明', icon: 'bi-megaphone-fill' },
]

const aiLinks = [
  {
    to: '/text-to-image',
    label: '文生图',
    icon: 'bi-stars',
    feature: 'ai.wallpaperGeneration',
  },
  {
    to: '/ai-illustration-coloring',
    label: '插画染色',
    icon: 'bi-brush-fill',
    feature: 'ai.illustrationColoring',
  },
  { to: '/design-workshop', label: 'UI 设计稿', icon: 'bi-bezier2', feature: 'ai.uiDesign' },
  {
    to: '/model-sheet',
    label: '超高清模型图',
    icon: 'bi-person-bounding-box',
    feature: 'ai.ultraModelSheet',
  },
  { to: '/game-art', label: '游戏设计', icon: 'bi-controller', feature: 'ai.gameDesign' },
  { to: '/ai-puzzle', label: 'AI 拼图', icon: 'bi-puzzle-fill', feature: 'ai.puzzle' },
]

const routePrefetchers = {
  '/updates': () => import('@/views/UpdatesView.vue'),
  '/share': () => import('@/views/ShareView.vue'),
  '/text-to-image': () => import('@/views/AiWallpaperView.vue'),
  '/ai-illustration-coloring': () => import('@/views/AiIllustrationColoringView.vue'),
  '/ai-puzzle': () => import('@/views/AiPuzzleView.vue'),
  '/design-workshop': () => import('@/views/DesignWorkshopView.vue'),
  '/model-sheet': () => import('@/views/ModelSheetStudioView.vue'),
  '/game-art': () => import('@/views/GameArtStudioView.vue'),
  '/pricing': () => import('@/views/PricingView.vue'),
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
  tools: {
    name: 'tools',
    label: '工具',
    icon: 'bi-columns-gap',
    links: toolLinks,
  },
}

/** 顶栏顺序：首页 → AI 各工作台（一级平铺） → 价格 → 画廊 → 工具 */
const NAV_ORDER = [
  { type: 'home' },
  ...aiLinks.map((link) => ({ type: 'link', link })),
  { type: 'link', link: pricingLink },
  { type: 'link', link: shareLink },
  { type: 'group', key: 'tools' },
]

/** 移动端底部 Tab：首页 / 画廊 / AI / 价格 / 我的 */
const BOTTOM_TAB_DEFS = [
  { id: 'home', label: '首页', icon: 'bi-house-door-fill', kind: 'link', link: homeLink },
  { id: 'share', label: '画廊', icon: 'bi-images', kind: 'link', link: shareLink },
  { id: 'ai', label: 'AI', icon: 'bi-cpu-fill', kind: 'group', groupKey: 'ai' },
  { id: 'pricing', label: '价格', icon: 'bi-currency-dollar', kind: 'link', link: pricingLink },
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
  if (mobileSheetKind.value === 'ai') return 'AI 功能'
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

  if (kind === 'ai') {
    return aiLinks.filter((link) => isLinkVisible(link)).map(toCell)
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
    toolLinks.filter((link) => isLinkVisible(link)).forEach((link) => cells.push(toCell(link)))

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
  () => settingsStore.settings.avatar_url || '/placeholder.svg',
)
const accountShortName = computed(() => {
  const name = String(accountDisplayName.value || '').trim()
  if (name.length <= 8) return name
  return `${name.slice(0, 7)}…`
})

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

function getFirstNavigableLink(links = []) {
  return links.find((link) => !isLinkDisabled(link)) || null
}

function handleGroupPrimaryClick(group, event) {
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
    prefetchLinks([...toolLinks, { to: '/auth' }, { to: '/profile' }])
  }

  syncBodyScrollLock()
}

function isBottomTabActive(tab) {
  if (tab.kind === 'mine') {
    if (mobileSheetKind.value === 'mine') return true
    if (isRouteActive('/profile') || route.path.startsWith('/auth')) {
      return true
    }
    return toolLinks.some((link) => isLinkVisible(link) && isRouteActive(link.to))
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
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const locked = isMobileNav.value && Boolean(mobileSheetKind.value)

  document.documentElement.classList.toggle('nav-mobile-open', locked)

  if (locked) {
    bodyScrollLockY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${bodyScrollLockY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    document.body.classList.add('nav-mobile-open')
    return
  }

  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.left = ''
  document.body.style.right = ''
  document.body.style.width = ''
  document.body.classList.remove('nav-mobile-open')

  if (bodyScrollLockY) {
    window.scrollTo(0, bodyScrollLockY)
    bodyScrollLockY = 0
  }
}

function toggleDropdown(name) {
  activeDropdown.value = activeDropdown.value === name ? '' : name
  const group = navItems.value.find((item) => item.type === 'group' && item.name === name)
  if (group) prefetchLinks(group.links)
}

function openDropdown(name) {
  if (isMobileNav.value && mobileSheetKind.value) return
  activeDropdown.value = name
  const group = navItems.value.find((item) => item.type === 'group' && item.name === name)
  if (group) prefetchLinks(group.links)
}

function closeMenu() {
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
  activeDropdown.value = ''
}

function handleDocumentClick(event) {
  if (isMobileNav.value) return
  if (!siteHeaderEl.value?.contains(event.target)) {
    closeDropdowns()
  }
}

function handleEscape(event) {
  if (event.key === 'Escape') closeMenu()
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

onBeforeUnmount(() => {
  mobileNavMq?.removeEventListener('change', syncMobileNavMode)
  mobileNavMq = null
  document.documentElement.classList.remove('nav-mobile-open')
  document.body.classList.remove('nav-mobile-open')
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.left = ''
  document.body.style.right = ''
  document.body.style.width = ''
  if (bodyScrollLockY) {
    window.scrollTo(0, bodyScrollLockY)
    bodyScrollLockY = 0
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
              :class="{ open: activeDropdown === item.name, active: isGroupActive(item.links) }"
              @mouseenter="openDropdown(item.name)"
              @mouseleave="closeDropdowns"
              @focusin="openDropdown(item.name)"
            >
              <div class="nav-link nav-dropdown-trigger">
                <button
                  type="button"
                  class="nav-dropdown-label"
                  :aria-controls="`nav-dropdown-${item.name}`"
                  @click="handleGroupPrimaryClick(item, $event)"
                  @keydown="handleDropdownKeydown($event, item.name)"
                  @pointerenter="prefetchRoute(getFirstNavigableLink(item.links)?.to)"
                >
                  <i class="bi" :class="item.icon"></i>
                  <span>{{ item.label }}</span>
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
            <button
              type="button"
              class="tool-icon"
              :title="appearanceStore.isDark ? '切换亮色模式' : '切换暗色模式'"
              :aria-label="appearanceStore.isDark ? '切换亮色模式' : '切换暗色模式'"
              @click="appearanceStore.toggle()"
            >
              <i
                class="bi"
                :class="appearanceStore.isDark ? 'bi-sun' : 'bi-moon-stars'"
                aria-hidden="true"
              ></i>
            </button>

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
              <router-link
                v-if="profileVisible"
                :to="profileRoute"
                class="account-chip"
                :class="{
                  disabled: profileDisabled,
                  active: isRouteActive('/profile'),
                }"
                :aria-disabled="profileDisabled"
                :title="profileDisabled ? linkDisabledReason({ to: '/profile' }) : '个人中心'"
                @click="profileDisabled ? handleDisabledLinkClick($event) : closeMenu()"
                @focus="prefetchRoute('/profile')"
                @pointerenter="prefetchRoute('/profile')"
              >
                <img
                  class="account-chip__avatar"
                  :src="accountAvatarUrl"
                  alt=""
                  @error="($event.target).src = '/placeholder.svg'"
                />
                <span class="account-chip__meta">
                  <strong>{{ accountShortName }}</strong>
                  <small>{{ balanceDisplay }}</small>
                </span>
              </router-link>
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
              <button
                v-if="mobileSheetKind === 'mine'"
                type="button"
                class="msheet-theme"
                :title="appearanceStore.isDark ? '切换亮色模式' : '切换暗色模式'"
                :aria-label="appearanceStore.isDark ? '切换亮色模式' : '切换暗色模式'"
                @click="appearanceStore.toggle()"
              >
                <i
                  class="bi"
                  :class="appearanceStore.isDark ? 'bi-sun' : 'bi-moon-stars'"
                  aria-hidden="true"
                ></i>
              </button>
              <button type="button" class="msheet-close" aria-label="关闭" @click="closeMobileSheet">
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
              @error="($event.target).src = '/placeholder.svg'"
            />
            <div class="msheet-account__copy">
              <strong>{{ accountDisplayName }}</strong>
              <small>{{ balanceDisplay }}</small>
            </div>
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
</template>

<style scoped>
.site-header {
  --nav-bg: #ffffff;
  --nav-bg-solid: #ffffff;
  --nav-line: rgba(21, 26, 45, 0.08);
  --nav-line-strong: rgba(106, 79, 224, 0.28);
  --nav-accent: #6a4fe0;
  --nav-accent-soft: rgba(106, 79, 224, 0.09);
  --nav-accent-mid: rgba(106, 79, 224, 0.16);
  --nav-heading: #171c2f;
  --nav-text: #3d455c;
  --nav-muted: #7a8299;
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
  border-bottom: 1px solid var(--nav-line);
  background: var(--nav-bg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  pointer-events: none;
}

.site-header.is-dark {
  --nav-bg: #10121c;
  --nav-bg-solid: #151826;
  --nav-line: rgba(255, 255, 255, 0.08);
  --nav-line-strong: rgba(160, 139, 255, 0.34);
  --nav-accent: #b4a4ff;
  --nav-accent-soft: rgba(160, 139, 255, 0.12);
  --nav-accent-mid: rgba(160, 139, 255, 0.2);
  --nav-heading: #f5f3ff;
  --nav-text: rgba(245, 243, 255, 0.86);
  --nav-muted: rgba(205, 200, 235, 0.62);
  --nav-on-accent: #12101c;
  --nav-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
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
  gap: 11px;
  min-height: 36px;
  color: var(--nav-heading);
  text-decoration: none;
}

.brand-icon {
  width: 34px;
  height: 34px;
  overflow: hidden;
  border: 0;
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
  font-size: 1.02rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1.1;
  white-space: nowrap;
}

.brand-copy small {
  color: var(--nav-muted);
  font-family: var(--nav-mono);
  font-size: 0.56rem;
  font-weight: 650;
  letter-spacing: 0.1em;
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
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border: 0;
  color: var(--nav-muted);
  text-decoration: none;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 650;
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
  transition: transform 0.18s var(--nav-ease), opacity 0.18s var(--nav-ease);
}

.nav-caret.is-open {
  transform: rotate(180deg);
  opacity: 0.85;
}

.nav-link:hover,
.nav-dropdown-label:hover {
  color: var(--nav-heading);
  background: var(--nav-accent-soft);
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
  color: var(--nav-accent);
  background: var(--nav-accent-soft);
  box-shadow: inset 0 -2px 0 var(--nav-accent);
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
  min-height: 34px;
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
  gap: 2px;
  padding: 8px;
  border: 1px solid var(--nav-line);
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
  top: -8px;
  height: 8px;
}

.nav-dropdown-item {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
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

.tool-icon {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--nav-line);
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
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  color: var(--nav-on-accent);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 700;
  background: var(--nav-accent);
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

.account-chip {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  max-width: 188px;
  padding: 3px 12px 3px 3px;
  border: 1px solid var(--nav-line);
  color: var(--nav-heading);
  text-decoration: none;
  background: transparent;
}

.account-chip:hover,
.account-chip.active {
  border-color: var(--nav-line-strong);
  background: var(--nav-accent-soft);
}

.account-chip.disabled,
.account-chip.disabled:hover {
  opacity: 0.5;
  cursor: not-allowed;
}

.account-chip__avatar {
  width: 30px;
  height: 30px;
  object-fit: cover;
  border: 1px solid var(--nav-line);
  background: var(--nav-accent-soft);
}

.account-chip__meta {
  display: grid;
  gap: 1px;
  min-width: 0;
  text-align: left;
}

.account-chip__meta strong {
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-chip__meta small {
  font-family: var(--nav-mono);
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--nav-accent);
  line-height: 1.1;
}

.nav-compact .tool-icon {
  width: 32px;
  height: 32px;
}

.nav-compact .account-chip {
  min-height: 34px;
  max-width: 160px;
}

.nav-compact .account-login {
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
  .account-chip__meta small {
    display: none;
  }

  .account-chip {
    max-width: 140px;
  }

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
    border-bottom: 1px solid var(--nav-line);
    background: var(--nav-bg);
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
  background: var(--ms-soft);
}

.msheet-account__avatar {
  width: 42px;
  height: 42px;
  object-fit: cover;
  border: 1px solid var(--ms-line);
}

.msheet-account__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
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
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--ms-accent);
}

.msheet-theme,
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
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

html.settings-no-blur .site-header {
  background: #ffffff;
}

html.settings-no-blur .site-header.is-dark {
  background: #10121c;
}

html.settings-no-blur .mbottom-nav {
  background: #ffffff;
}

html.settings-no-blur .mbottom-nav.is-dark {
  background: #10121c;
}
</style>
