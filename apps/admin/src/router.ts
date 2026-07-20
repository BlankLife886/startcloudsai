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
        { path: 'orders', component: () => import('@/views/OrdersView.vue'), meta: { title: '订单' } },
        { path: 'plans', component: () => import('@/views/PlansView.vue'), meta: { title: '套餐' } },
        { path: 'tasks', component: () => import('@/views/TasksView.vue'), meta: { title: '任务监控' } },
        { path: 'gallery', component: () => import('@/views/GalleryView.vue'), meta: { title: '画廊审核' } },
        { path: 'content', component: () => import('@/views/ContentView.vue'), meta: { title: '内容管理' } },
        { path: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '系统设置' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
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
