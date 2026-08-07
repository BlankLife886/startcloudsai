import { createRouter, createWebHistory } from 'vue-router'
import { reactive } from 'vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAuthStore } from '@/stores/auth'
import { requestAuthentication } from '@/services/authGate'
import { DEFAULT_AUTH_REDIRECT, createAuthRedirectLocation } from '@/services/authRedirect'
import { getTrialAccessApplication, getTrialAccessCampaign } from '@/services/trialAccessApi'

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
    component: () => import('../views/CommercialHomeView.vue'),
    meta: {
      title: `首页 - ${siteName}`,
      description: '星空云绘是一站式 AI 图像生产工作台：连接多模型、实时任务与高清交付。',
      hideSiteFooter: true,
    },
  },
  {
    path: '/studio',
    name: 'studio',
    component: () => import('../views/StudioHubView.vue'),
    meta: {
      title: `创作台 - ${siteName}`,
      titleLabel: '创作台',
      icon: 'bi-grid-1x2-fill',
      description: '选择文生图、染色、设计稿等 AI 创作工作台，一站式开始生产。',
      hideSiteFooter: true,
    },
  },
  {
    path: '/prompts',
    name: 'prompts',
    component: () => import('../views/PromptLibraryView.vue'),
    meta: {
      title: `提示词 - ${siteName}`,
      titleLabel: '提示词',
      icon: 'bi-journal-richtext',
      description: '浏览官方与社区提示词灵感，一键带到对应创作工作台。',
      hideSiteFooter: true,
    },
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('../views/CreationHistoryView.vue'),
    meta: {
      title: `历史记录 - ${siteName}`,
      titleLabel: '历史记录',
      icon: 'bi-clock-history',
      description: '查看各工作台的生成历史，支持筛选、复用提示词与管理产物。',
      requiresAuth: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/share',
    name: 'share',
    component: () => import('../views/ShareView.vue'),
    meta: {
      title: `社区 - ${siteName}`,
      titleLabel: '社区',
      icon: 'bi-share-fill',
      description: '查看用户提交并通过审核的 AI 生成图社区作品。',
    },
  },
  {
    path: '/text-to-image',
    name: 'text-to-image',
    component: () => import('../views/AiWallpaperView.vue'),
    meta: {
      title: `文生图 - ${siteName}`,
      description: '用文字生成图片，也支持参考图与图生图。',
      requiresAuth: true,
      trialFeatureKey: 'text_to_image',
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
    path: '/canvas',
    name: 'canvas-app',
    component: () => import('../views/CanvasAppView.vue'),
    meta: {
      title: '智能画布 - ' + siteName,
      titleLabel: '智能画布',
      icon: 'bi-bounding-box-circles',
      description: '在一张画布中连续完成文本、图像、分镜与视频创作。',
      requiresAuth: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/ecommerce-design',
    name: 'ecommerce-design',
    component: () => import('../views/EcommerceDesignView.vue'),
    meta: {
      title: `AI 电商设计 - ${siteName}`,
      titleLabel: 'AI 电商设计',
      icon: 'bi-bag-check-fill',
      description: '上传商品图，一次生成适配不同平台、市场与语言的电商详情视觉。',
      requiresAuth: true,
      trialFeatureKey: 'ecommerce_design',
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
      requiresAuth: true,
      trialFeatureKey: 'illustration_coloring',
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
    path: '/tools/background-remove',
    name: 'background-remove',
    component: () => import('../views/BackgroundRemoveView.vue'),
    meta: {
      title: `背景移除 - ${siteName}`,
      titleLabel: '背景移除',
      icon: 'bi-person-bounding-box',
      description: '上传图片并移除背景，导出透明 PNG。',
      requiresAuth: true,
      trialFeatureKey: 'background_remove',
      hideSiteFooter: true,
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
      requiresAuth: true,
      trialFeatureKey: 'ui_design',
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
      requiresAuth: true,
      trialFeatureKey: 'model_sheet',
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
      requiresAuth: true,
      trialFeatureKey: 'game_art',
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
    path: '/feedback',
    name: 'feedback',
    component: () => import('../views/FeedbackView.vue'),
    meta: {
      title: `问题反馈 - ${siteName}`,
      titleLabel: '问题反馈',
      icon: 'bi-chat-square-text',
      description: '提交产品问题与建议，并查看反馈处理进度。',
      requiresAuth: true,
    },
  },
  {
    path: '/check-in',
    name: 'check-in',
    component: () => import('../views/CheckinView.vue'),
    meta: {
      title: `每日签到 - ${siteName}`,
      titleLabel: '每日签到',
      icon: 'bi-calendar-check',
      description: '每日签到领取创作积分，连续签到可获得更高奖励。',
      requiresAuth: true,
    },
  },
  {
    path: '/incentive-plans',
    name: 'incentive-plans',
    component: () => import('../views/CreatorIncentivesView.vue'),
    meta: {
      title: `创作激励 - ${siteName}`,
      titleLabel: '创作激励',
      icon: 'bi-gift',
      description: '查看账户权益、活动进度、服务保障与创作奖励。',
      requiresAuth: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/incentive-plans/group',
    name: 'friend-group',
    component: () => import('../views/FriendGroupView.vue'),
    meta: {
      title: `好友拼团 - ${siteName}`,
      titleLabel: '好友拼团',
      description: '邀请好友一起参与拼团，成团后共同获得创作积分。',
      requiresAuth: true,
      immersive: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/incentive-plans/membership',
    name: 'membership-plan',
    component: () => import('../views/MembershipPlanView.vue'),
    meta: {
      title: `会员计划 - ${siteName}`,
      titleLabel: '会员计划',
      description: '对比会员计划、体验资格与企业合作方案。',
      requiresAuth: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/incentive-plans/failure',
    name: 'failure-compensation',
    component: () => import('../views/FailureCompensationView.vue'),
    meta: {
      title: `失败补偿 - ${siteName}`,
      titleLabel: '失败补偿',
      description: '查看失败任务费用释放、额外补偿与每日补偿状态。',
      requiresAuth: true,
      immersive: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/incentive-plans/suggestion',
    name: 'suggestion-adoption',
    component: () => import('../views/SuggestionAdoptionView.vue'),
    meta: {
      title: `建议采纳 - ${siteName}`,
      titleLabel: '建议采纳',
      description: '提交真实、具体且可执行的产品建议，并查看采纳与奖励规则。',
      requiresAuth: true,
      immersive: true,
      hideSiteFooter: true,
    },
  },
  {
    path: '/incentive-plans/:program',
    name: 'incentive-plan-detail',
    component: () => import('../views/CreatorIncentiveDetailView.vue'),
    meta: {
      title: `创作激励 - ${siteName}`,
      titleLabel: '创作激励',
      description: '查看激励计划详情、账户进度与参与方式。',
      requiresAuth: true,
      hideSiteFooter: true,
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
      description: '查看账号总览、创作数据与快捷入口。',
      requiresAuth: true,
    },
  },
  {
    path: '/submissions',
    name: 'submissions',
    component: () => import('../views/SubmissionsView.vue'),
    meta: {
      title: `我的投稿 - ${siteName}`,
      titleLabel: '我的投稿',
      icon: 'bi-send-check',
      description: '查看画廊投稿与审核进度。',
      requiresAuth: true,
    },
  },
  {
    path: '/wallet',
    name: 'wallet',
    component: () => import('../views/WalletView.vue'),
    meta: {
      title: `钱包 - ${siteName}`,
      titleLabel: '钱包',
      icon: 'bi-wallet2',
      description: '管理余额、兑换码和资金明细。',
      requiresAuth: true,
    },
  },
  {
    path: '/account',
    name: 'account',
    component: () => import('../views/AccountSettingsView.vue'),
    meta: {
      title: `账号设置 - ${siteName}`,
      titleLabel: '账号设置',
      icon: 'bi-person-gear',
      description: '管理公开资料、创作偏好和账号安全。',
      requiresAuth: true,
    },
  },
  {
    path: '/notifications',
    name: 'notifications',
    component: () => import('../views/NotificationsView.vue'),
    meta: {
      title: `通知 - ${siteName}`,
      titleLabel: '通知',
      icon: 'bi-bell',
      description: '查看账号、任务与审核相关的站内通知。',
      requiresAuth: true,
    },
  },
  {
    path: '/materials',
    name: 'materials',
    component: () => import('../views/MaterialsLibraryView.vue'),
    meta: {
      title: `素材库 - ${siteName}`,
      titleLabel: '素材库',
      icon: 'bi-collection',
      description: '上传并整理可重复使用的个人视觉素材。',
      requiresAuth: true,
    },
  },
  {
    path: '/auth',
    name: 'auth',
    component: () => import('../views/auth/AuthAccountView.vue'),
    meta: {
      title: `账号中心 - ${siteName}`,
      description: '通过 Gmail、Googlemail 或 QQ 邮箱验证码登录星空云绘账号。',
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
      return { ...savedPosition, behavior: 'instant' }
    }
    if (to.fullPath === from.fullPath) return false
    if (to.hash) return { el: to.hash, top: 16, behavior: 'smooth' }
    return { top: 0, left: 0, behavior: 'instant' }
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
      requestAuthentication({
        target: to.fullPath,
        pageTitle: to.meta?.titleLabel || String(to.meta?.title || '').split(' - ')[0] || '此页面',
      })
      navigationTarget.name = null
      navigationTarget.path = ''
      if (from.matched?.length) next(false)
      else next({ name: 'home', replace: true })
      return
    }
  }

  if (to.meta?.trialFeatureKey && authStore.isAuthenticated) {
    try {
      const [campaign, application] = await Promise.all([
        getTrialAccessCampaign(),
        getTrialAccessApplication(),
      ])
      const campaignFeatures = Array.isArray(campaign?.features)
        ? campaign.features
        : campaign?.feature
          ? [campaign.feature]
          : []
      const applicationFeatureKeys = Array.isArray(application?.featureKeys)
        ? application.featureKeys
        : application?.featureKey
          ? [application.featureKey]
          : []
      const applicationFeatures = Array.isArray(application?.features)
        ? application.features
        : application?.feature
          ? [application.feature]
          : []
      const campaignFeature = campaignFeatures.find(
        (feature) => feature?.key === to.meta.trialFeatureKey,
      )
      const entitlementMatches =
        applicationFeatureKeys.includes(to.meta.trialFeatureKey) &&
        applicationFeatures.some(
          (feature) =>
            feature?.key === to.meta.trialFeatureKey && feature?.entitlementActive === true,
        )
      if (campaign?.accessMode === 'restricted' && campaignFeature && !entitlementMatches) {
        next({
          name: 'access-limited',
          query: {
            reason: `「${campaignFeature?.label || '该功能'}」正在内测，请先申请并通过体验资格审核`,
            type: 'trial',
          },
          replace: true,
        })
        return
      }
    } catch {
      // The route check is an experience guard. Task submission remains the
      // authoritative server-side permission boundary.
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
