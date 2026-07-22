// 引入样式
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import './assets/base.css'
import './assets/tailwind.css'
import './assets/main.css'

// 引入主题样式
import './assets/css/themes/default.css'

// 引入全局主题修复样式
import './assets/css/global-theme-fixes.css'
import './assets/css/image-reveal.css'

// 引入Bootstrap JS
import 'bootstrap/dist/js/bootstrap.bundle.min.js'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './services/apiClient'
import { createLoginRedirectQuery } from './services/authRedirect'
import notificationService from './services/notification'
import { useAppearanceStore } from './stores/appearance'
import { useAuthStore } from './stores/auth'
import { useLocaleStore } from './stores/locale'

/**
 * 401（auth_required）全局处理：仅当此前是已登录态才清会话并跳登录，
 * 画廊等公开页的匿名 401 不会误触发。
 */
function registerUnauthorizedHandler() {
  setUnauthorizedHandler(() => {
    const authStore = useAuthStore()
    if (!authStore.isAuthenticated) return
    authStore.resetAuthState()
    notificationService.warning('登录已过期，请重新登录')
    const current = router.currentRoute.value
    if (current.name === 'auth') return
    router
      .push({
        path: '/auth',
        query: { mode: 'login', ...createLoginRedirectQuery(current.fullPath) },
      })
      .catch(() => {})
  })
}

function bootstrapApp() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  useAppearanceStore().applyToDocument()
  useLocaleStore().applyToDocument()
  registerUnauthorizedHandler()

  app.mount('#app')
}

bootstrapApp()
