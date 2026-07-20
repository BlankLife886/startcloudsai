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
import { useAppearanceStore } from './stores/appearance'

function bootstrapApp() {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  useAppearanceStore().applyToDocument()

  app.mount('#app')
}

bootstrapApp()
