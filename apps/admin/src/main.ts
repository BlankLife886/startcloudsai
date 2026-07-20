import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

import App from './App.vue'
import router from './router'
import './styles/theme.css'
import './styles.css'
import { initTheme } from './theme'

initTheme()

createApp(App).use(createPinia()).use(router).mount('#app')
