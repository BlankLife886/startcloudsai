import { createRouter, createWebHistory } from 'vue-router'
import { reactive } from 'vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAuthStore } from '@/stores/auth'
import {
  DEFAULT_AUTH_REDIRECT,
  createAuthRedirectLocation,
  createLoginRedirectQuery,
} from '@/services/authRedirect'
import { randomWallhavenSeed } from '@/utils/wallhaven'
import DefaultHomeLayout from '../components/themes/DefaultHomeLayout.vue'

if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}
const siteName = '星空云绘 · StarCloudIsAI'
const defaultDescription = '星空云绘（StarCloudIsAI）是集壁纸浏览、收藏与 AI 图像创作为一体的创作工作台。'

const routes = [
  {
    path: '/',
    name: 'home',
    component: DefaultHomeLayout,
    meta: {
      title: `首页 - ${siteName}`,
      description:
        '星空云绘是一座云上美术馆：AI 生成壁纸与插画、社区展厅分享创作、横竖屏馆藏检索，一站完成。',
    },
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('../views/SearchView.vue'),
    meta: {
      title: `搜索壁纸 - ${siteName}`,
      description: '按关键词、分辨率、色彩与排序条件搜索 Wallhaven 壁纸。',
    },
  },
  {
    path: '/share',
    name: 'share',
    component: () => import('../views/ShareView.vue'),
    meta: {
      title: `Share - ${siteName}`,
      titleLabel: 'Share',
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
      description: '用文字生成图片，也支持参考图、图生图和动态视频。',
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
    path: '/ai-image-to-3d',
    name: 'ai-image-to-3d',
    component: () => import('../views/AiImageTo3DView.vue'),
    meta: {
      title: `图转模型 - ${siteName}`,
      description: '导入图片并生成可预览、可下载的 3D 模型资产。',
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
    path: '/ziwei',
    name: 'ziwei',
    component: () => import('../views/ZiweiReportView.vue'),
    meta: {
      title: `紫微斗数 - ${siteName}`,
      titleLabel: '紫微斗数',
      icon: 'bi-stars',
      description: '输入出生信息生成可审计紫微斗数命盘、十二宫解读、证据链与脱敏快照。',
    },
  },
  {
    path: '/ziwei/docs',
    name: 'ziwei-docs',
    component: () => import('../views/ZiweiDocsView.vue'),
    meta: {
      title: `紫微斗数文档 - ${siteName}`,
      titleLabel: '紫微文档',
      icon: 'bi-journal-richtext',
      description: '紫微斗数入门、进阶与《紫微斗數全書》原文对照阅读。',
      hideSiteFooter: true,
    },
  },
  {
    path: '/docs',
    name: 'api-docs',
    component: () => import('../views/ApiDocsView.vue'),
    meta: {
      title: `接入文档 - ${siteName}`,
      titleLabel: '接入文档',
      icon: 'bi-plug-fill',
      description: '中转站 OpenAI 兼容 API 接入文档：Base URL、鉴权、模型列表、代码示例与计费说明。',
    },
  },
  {
    path: '/pricing',
    name: 'pricing',
    component: () => import('../views/pricing/PricingRouteView.vue'),
    meta: {
      title: `模型价格 - ${siteName}`,
      titleLabel: '价格控制台',
      icon: 'bi-currency-dollar',
      description: '查看模型价格、API 密钥、用量、钱包、推荐计划、支持和套餐。',
      requiresAuth: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/bookmarks',
    name: 'bookmarks',
    component: () => import('../views/BookmarksView.vue'),
    meta: {
      title: `书签管理 - ${siteName}`,
      titleLabel: '书签管理',
      icon: 'bi-bookmarks-fill',
      description: '集中维护站内书签、收藏入口和快捷访问。',
    },
  },
  {
    path: '/trends',
    name: 'trends',
    component: () => import('../views/TrendsView.vue'),
    meta: {
      title: `时事热点 - ${siteName}`,
      titleLabel: '时事热点',
      icon: 'bi-radar',
      description: '聚合内容平台、消费平台、新闻与 AI 时事的实时热点信号。',
      hideSiteFooter: true,
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
    path: '/downloads',
    name: 'downloads',
    component: () => import('../views/DownloadsView.vue'),
    beforeEnter() {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.add('downloads-gallery-page')
      }
    },
    meta: {
      title: `下载管理 - ${siteName}`,
      description: '集中查看壁纸下载队列、失败任务与批量下载进度。',
    },
  },
  {
    path: '/favorites',
    name: 'favorites',
    component: () => import('../views/FavoritesView.vue'),
    beforeEnter() {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.add('favorites-gallery-page')
      }
    },
    meta: {
      title: `我的收藏 - ${siteName}`,
      description: '统一管理收藏壁纸、收藏夹和导入导出操作。',
    },
  },
  {
    path: '/collections',
    name: 'collections',
    redirect: { name: 'users' },
    meta: {
      title: `关注作者 - ${siteName}`,
      description: '集中整理你关注和收藏过的作者入口，方便快速回访。',
    },
  },
  {
    path: '/users',
    name: 'users',
    component: () => import('../views/UsersView.vue'),
    meta: {
      title: `关注作者 - ${siteName}`,
      description: '查看和管理你关注或收藏合集的 Wallhaven 作者主页。',
    },
  },
  {
    path: '/tags',
    name: 'tags',
    component: () => import('../views/TagsView.vue'),
    meta: {
      title: `收藏标签 - ${siteName}`,
      description: '查看和管理你收藏的 Wallhaven 标签，并快速回到对应搜索。',
    },
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('../views/HistoryView.vue'),
    meta: {
      title: `浏览历史 - ${siteName}`,
      description: '按时间线、网格和统计方式回看你的壁纸浏览记录。',
    },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/ProfileView.vue'),
    meta: {
      title: `个人中心 - ${siteName}`,
      description: '查看账号资产、壁纸收藏、下载记录与 AI 洞察。',
      requiresAuth: true,
    },
  },
  {
    path: '/auth',
    name: 'auth',
    component: () => import('../views/auth/AuthAccountView.vue'),
    meta: {
      title: `账号中心 - ${siteName}`,
      description: '登录、注册或找回星空云绘账号。',
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
    path: '/auth/forgot-password',
    name: 'auth-forgot-password',
    redirect: (to) => ({ name: 'auth', query: { ...to.query, mode: 'forgot' } }),
  },
  {
    path: '/auth/reset-password',
    name: 'auth-reset-password',
    component: () => import('../views/auth/AuthResetPasswordView.vue'),
    meta: {
      title: `重置密码 - ${siteName}`,
      description: '设置新的星空云绘登录密码。',
      immersive: true,
    },
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
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: {
      title: `设置中心 - ${siteName}`,
      description: '调整主题、搜索、下载与缓存策略，定制你的使用体验。',
      requiresAuth: true,
    },
  },
  {
    path: '/wallpaper/:id',
    name: 'wallpaper',
    component: () => import('../views/WallpaperView.vue'),
    meta: {
      title: `壁纸详情 - ${siteName}`,
      description: '查看壁纸详情、标签、分辨率与相关内容。',
    },
  },
  {
    path: '/random',
    name: 'random',
    redirect: () => ({
      name: 'search',
      query: {
        sorting: 'random',
        seed: randomWallhavenSeed(),
      },
    }),
    meta: {
      title: `随机壁纸 - ${siteName}`,
      description: '随机探索新的 Wallhaven 壁纸内容。',
    },
  },
  {
    path: '/user/:username',
    name: 'user',
    component: () => import('../views/UserView.vue'),
    meta: {
      title: `用户主页 - ${siteName}`,
      description: '查看创作者资料、合集和公开壁纸内容。',
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

    return { top: 0, behavior: 'smooth' }
  },
})

const initialNavigationPath =
  typeof window === 'undefined' ? '' : String(window.location.pathname || '/')

export const navigationTarget = reactive({
  name: null,
  path: initialNavigationPath,
})

function syncPricingRouteFlag(path = '') {
  if (typeof document === 'undefined') return
  const normalized = String(path || '').replace(/\/+$/, '') || '/'
  const active = normalized === '/pricing' || normalized.startsWith('/pricing/')
  if (active) {
    document.documentElement.dataset.pricingRoute = '1'
    return
  }
  delete document.documentElement.dataset.pricingRoute
}

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
  syncPricingRouteFlag(to.path)

  const runtimeConfigStore = useRuntimeConfigStore()
  const authStore = useAuthStore()

  const authRouteNames = new Set([
    'auth',
    'auth-login',
    'auth-register',
    'auth-forgot-password',
    'auth-reset-password',
  ])

  if (!to.meta?.skipRuntimeGuard && to.name !== 'not-found') {
    void runtimeConfigStore.refreshRuntimeConfigInBackground().then(() => {
      const redirect = resolveRuntimeConfigRedirect(to, runtimeConfigStore)
      if (!redirect) return
      if (router.currentRoute.value.fullPath !== to.fullPath) return
      router.replace(redirect)
    })
  }

  const runtimeRedirect = resolveRuntimeConfigRedirect(to, runtimeConfigStore)
  if (runtimeRedirect) {
    next(runtimeRedirect)
    return
  }

  if (to.meta?.requiresAuth || authRouteNames.has(to.name)) {
    await authStore.initAuth({ deferLocalReload: true }).catch(() => null)
  }

  if (to.name === 'profile' && to.query?.tab === 'account') {
    const query = { ...to.query }
    delete query.tab
    next({
      name: 'profile',
      query,
      hash: to.hash,
      replace: true,
    })
    return
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

router.afterEach((to) => {
  navigationTarget.name = null
  navigationTarget.path = ''
  syncPricingRouteFlag(to.path)
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
    const fallbackType = routeConfig.fallbackType || 'hidden'
    const fallbackReason =
      routeConfig.message ||
      (fallbackType === 'maintenance'
        ? '当前页面维护中'
        : fallbackType === 'forbidden'
          ? '当前页面无访问权限'
          : '当前页面暂未开放')
    return {
      name: 'access-limited',
      query: { reason: fallbackReason, type: fallbackType },
      replace: true,
    }
  }
  return null
}

export default router
