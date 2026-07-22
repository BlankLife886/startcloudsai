import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    /** 无需登录即可访问 */
    public?: boolean
    title?: string
  }
}

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    {
      path: '/login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/forbidden',
      component: () => import('@/views/ForbiddenView.vue'),
      meta: { public: true, title: '无权限' },
    },
    {
      path: '/',
      component: () => import('@/AdminLayout.vue'),
      children: [
        { path: '', component: () => import('@/views/DashboardView.vue'), meta: { title: '仪表盘' } },
        { path: 'users', component: () => import('@/views/UsersView.vue'), meta: { title: '用户管理' } },
        { path: 'codes', component: () => import('@/views/CodesView.vue'), meta: { title: '兑换码' } },
        { path: 'tasks', component: () => import('@/views/TasksView.vue'), meta: { title: '任务监控' } },
        {
          path: 'prompt-library',
          component: () => import('@/views/PromptLibraryView.vue'),
          meta: { title: '提示词库' },
        },
        { path: 'community', component: () => import('@/views/CommunityView.vue'), meta: { title: '社区管理' } },
        { path: 'gallery', component: () => import('@/views/GalleryView.vue'), meta: { title: '投稿审核' } },
        { path: 'content', component: () => import('@/views/ContentView.vue'), meta: { title: '内容管理' } },
        { path: 'audit', component: () => import('@/views/AuditView.vue'), meta: { title: '审计日志' } },
        { path: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '系统设置' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

const assetReloadKey = 'starclouds-admin:asset-version-reload'
const assetLoadErrorPattern =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload CSS/i

function recoverFromStaleAssetVersion(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (!assetLoadErrorPattern.test(message)) return false

  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const now = Date.now()
  let previous: { path?: string; at?: number } | null = null
  try {
    previous = JSON.parse(window.sessionStorage.getItem(assetReloadKey) || 'null')
  } catch {
    previous = null
  }
  if (previous?.path === path && now - Number(previous.at || 0) < 30_000) return false

  window.sessionStorage.setItem(assetReloadKey, JSON.stringify({ path, at: now }))
  window.location.replace(path)
  return true
}

window.addEventListener('vite:preloadError', (event) => {
  const preloadEvent = event as Event & { payload?: unknown }
  if (recoverFromStaleAssetVersion(preloadEvent.payload || event)) event.preventDefault()
})

router.onError((error) => {
  recoverFromStaleAssetVersion(error)
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.loaded) await auth.fetchMe()

  if (to.meta.public) {
    // 已登录管理员访问登录页时直接进后台
    if (to.path === '/login' && auth.isAdmin) return '/'
    return true
  }
  if (!auth.user) return { path: '/login', query: { redirect: to.fullPath } }
  if (!auth.isAdmin) return '/forbidden'
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · StartClouds 管理后台` : 'StartClouds 管理后台'
})

export default router
