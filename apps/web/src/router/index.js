import { createRouter, createWebHistory } from 'vue-router'
import { reactive } from 'vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAuthStore } from '@/stores/auth'
import {
  DEFAULT_AUTH_REDIRECT,
  createAuthRedirectLocation,
  createLoginRedirectQuery,
} from '@/services/authRedirect'
import DefaultHomeLayout from '../components/themes/DefaultHomeLayout.vue'

if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}
const siteName = '星空云绘 · StarCloudIsAI'
const defaultDescription =
  '星空云绘（StarCloudIsAI）是一站式 AI 图像创作工作台：文生图、插画染色、UI 设计稿、模型图、游戏设计与 AI 拼图。'

const routes = [
  {
    path: '/',
    name: 'home',
    component: DefaultHomeLayout,
    meta: {
      title: `首页 - ${siteName}`,
      description: '星空云绘是一座云上创作馆：AI 生成图像、社区画廊分享创作，一站完成。',
    },
  },
  {
    path: '/share',
    name: 'share',
    component: () => import('../views/ShareView.vue'),
    meta: {
      title: `画廊 - ${siteName}`,
      titleLabel: '画廊',
      icon: 'bi-share-fill',
      description: '查看用户提交并通过审核的 AI 生成图共享画廊。',
    },
  },
  {
    path: '/text-to-image',
    name: 'text-to-image',
    component: () => import('../views/AiWallpaperView.vue'),
    meta: {
      title: `文生图 - ${siteName}`,
      description: '用文字生成图片，也支持参考图与图生图。',
    },
  },
  {
    path: '/assistant',
    name: 'assistant',
    component: () => import('../views/AssistantWorkspaceView.vue'),
    meta: {
      title: `AI助手 - ${siteName}`,
      description: '使用AI助手进行连续对话和 AI 图片创作。',
      requiresAuth: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/ai-wallpaper',
    redirect: '/text-to-image',
  },
  {
    path: '/ai-illustration-coloring',
    name: 'ai-illustration-coloring',
    component: () => import('../views/AiIllustrationColoringView.vue'),
    meta: {
      title: `插画染色 - ${siteName}`,
      titleLabel: '插画染色',
      icon: 'bi-brush-fill',
      description: '上传线稿插画，由 AI 智能上色并导出高清结果。',
      hideSiteFooter: true,
    },
  },
  {
    path: '/ai-puzzle',
    name: 'ai-puzzle',
    component: () => import('../views/AiPuzzleView.vue'),
    meta: {
      title: `AI 拼图 - ${siteName}`,
      titleLabel: 'AI 拼图',
      icon: 'bi-puzzle-fill',
      description: '上传图片、选择模板，在线制作照片拼图并导出高清 PNG。',
    },
  },
  {
    path: '/design-workshop',
    name: 'design-workshop',
    component: () => import('../views/DesignWorkshopView.vue'),
    meta: {
      title: `UI 设计稿 - ${siteName}`,
      titleLabel: '设计稿',
      icon: 'bi-bezier2',
      description: '生成前端 UI 设计稿，并在本地完成透明背景 PNG 与真实 SVG 路径转换。',
      hideSiteFooter: true,
    },
  },
  {
    path: '/model-sheet',
    name: 'model-sheet',
    component: () => import('../views/ModelSheetStudioView.vue'),
    meta: {
      title: `超高清模型图 - ${siteName}`,
      titleLabel: '模型图',
      icon: 'bi-person-bounding-box',
      description: '把人物或物体转换为可用于后续建模的超高清多视角模型参考图。',
      hideSiteFooter: true,
    },
  },
  {
    path: '/game-art',
    name: 'game-art',
    component: () => import('../views/GameArtStudioView.vue'),
    meta: {
      title: `游戏设计 - ${siteName}`,
      titleLabel: '游戏设计',
      icon: 'bi-controller',
      description: '生成角色、场景、道具、游戏 UI、图标与贴图等高清游戏生产素材。',
      hideSiteFooter: true,
    },
  },
  {
    path: '/pricing',
    name: 'pricing',
    component: () => import('../views/PricingView.vue'),
    meta: {
      title: `价格与套餐 - ${siteName}`,
      titleLabel: '价格',
      icon: 'bi-credit-card-2-front-fill',
      description: '查看星空云绘创作单价、套餐方案与支付接入状态。',
    },
  },
  {
    path: '/updates',
    name: 'updates',
    component: () => import('../views/UpdatesView.vue'),
    meta: {
      title: `更新说明 - ${siteName}`,
      titleLabel: '更新说明',
      icon: 'bi-megaphone-fill',
      description: '查看近期功能变化、修复记录与版本说明。',
    },
  },
  {
    path: '/app-space',
    name: 'app-space',
    component: () => import('../views/AppSpaceView.vue'),
    meta: {
      title: `应用空间 - ${siteName}`,
      titleLabel: '应用空间',
      icon: 'bi-columns-gap',
      description: '管理扩展应用、工作区和更多站内能力。',
    },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/ProfileView.vue'),
    meta: {
      title: `个人中心 - ${siteName}`,
      description: '查看账号信息、钱包余额、创作任务与画廊投稿。',
      requiresAuth: true,
    },
  },
  {
    path: '/auth',
    name: 'auth',
    component: () => import('../views/auth/AuthAccountView.vue'),
    meta: {
      title: `账号中心 - ${siteName}`,
      description: '通过 GitHub 或邮箱密码登录星空云绘账号。',
      immersive: true,
    },
  },
  {
    path: '/auth/login',
    name: 'auth-login',
    redirect: (to) => ({ name: 'auth', query: { ...to.query, mode: 'login' } }),
  },
  {
    path: '/auth/register',
    name: 'auth-register',
    redirect: (to) => ({ name: 'auth', query: { ...to.query, mode: 'register' } }),
  },
  {
    path: '/access-limited',
    name: 'access-limited',
    component: () => import('../views/AccessLimitedView.vue'),
    meta: {
      title: `访问受限 - ${siteName}`,
      description: defaultDescription,
      skipRuntimeGuard: true,
    },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
    meta: {
      title: `页面未找到 - ${siteName}`,
      description: defaultDescription,
    },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }
    if (to.path === from.path && to.hash === from.hash) return false
    if (to.hash) return { el: to.hash, top: 16, behavior: 'smooth' }
    return { top: 0 }
  },
})

const assetReloadKey = 'starclouds:asset-version-reload'
const assetLoadErrorPattern =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload CSS/i

function recoverFromStaleAssetVersion(error, targetPath = '') {
  if (
    typeof window === 'undefined' ||
    !assetLoadErrorPattern.test(String(error?.message || error || ''))
  ) {
    return false
  }

  const path =
    targetPath || `${window.location.pathname}${window.location.search}${window.location.hash}`
  const now = Date.now()
  let previous = null
  try {
    previous = JSON.parse(window.sessionStorage.getItem(assetReloadKey) || 'null')
  } catch {
    previous = null
  }

  // 同一路径 30 秒内最多自动恢复一次，避免资源服务确实异常时无限刷新。
  if (previous?.path === path && now - Number(previous.at || 0) < 30_000) return false
  window.sessionStorage.setItem(assetReloadKey, JSON.stringify({ path, at: now }))
  window.location.replace(path)
  return true
}

// Vite 会在动态分包或其 CSS 预加载失败时发出该事件。Docker 镜像更新后，
// 已打开的旧页面仍可能引用上一版 hash 文件；自动刷新即可取得新 index。
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    if (recoverFromStaleAssetVersion(event?.payload || event)) event.preventDefault()
  })
}

router.onError((error, to) => {
  recoverFromStaleAssetVersion(error, to?.fullPath)
})

const initialNavigationPath =
  typeof window === 'undefined' ? '' : String(window.location.pathname || '/')

export const navigationTarget = reactive({
  name: null,
  path: initialNavigationPath,
})

function upsertMeta(attribute, key, content) {
  if (typeof document === 'undefined') return

  let selector = `meta[${attribute}="${key}"]`
  let tag = document.head.querySelector(selector)

  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attribute, key)
    document.head.appendChild(tag)
  }

  tag.setAttribute('content', content)
}

router.beforeEach(async (to, from, next) => {
  navigationTarget.name = to.name || null
  navigationTarget.path = to.path || ''

  const runtimeConfigStore = useRuntimeConfigStore()
  const authStore = useAuthStore()

  const authRouteNames = new Set(['auth', 'auth-login', 'auth-register'])

  const runtimeRedirect = resolveRuntimeConfigRedirect(to, runtimeConfigStore)
  if (runtimeRedirect) {
    next(runtimeRedirect)
    return
  }

  if (to.meta?.requiresAuth || authRouteNames.has(to.name)) {
    await authStore.initAuth().catch(() => null)
  }

  if (authRouteNames.has(to.name)) {
    if (to.name === 'auth' && from.name === 'auth') {
      next()
      return
    }

    if (authStore.isAuthenticated) {
      next({
        ...createAuthRedirectLocation(to.query.redirect, DEFAULT_AUTH_REDIRECT),
        replace: true,
      })
      return
    }
  }

  if (to.meta?.requiresAuth) {
    if (!authStore.isAuthenticated) {
      next({
        name: 'auth',
        query: {
          ...createLoginRedirectQuery(to.fullPath),
          mode: 'login',
        },
        replace: true,
      })
      return
    }
  }

  const title = to.meta.title || siteName
  const description = to.meta.description || defaultDescription

  document.title = title
  upsertMeta('name', 'description', description)
  upsertMeta('name', 'application-name', siteName)
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:site_name', siteName)
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)

  next()
})

router.afterEach(() => {
  navigationTarget.name = null
  navigationTarget.path = ''
})

function resolveRuntimeConfigRedirect(to, runtimeConfigStore) {
  if (to.meta?.skipRuntimeGuard || to.name === 'not-found') return null
  if (runtimeConfigStore.isBlocked) {
    return {
      name: 'access-limited',
      query: { reason: runtimeConfigStore.blockReason },
      replace: true,
    }
  }
  const routeConfig = runtimeConfigStore.getRouteConfig(to.path)
  if (routeConfig.enabled === false) {
    return {
      name: 'access-limited',
      query: {
        reason: routeConfig.message || '当前页面暂未开放',
        type: routeConfig.fallbackType || 'hidden',
      },
      replace: true,
    }
  }
  return null
}

export default router
