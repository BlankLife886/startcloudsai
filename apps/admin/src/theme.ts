/** 明暗主题切换：documentElement 挂 .dark（自定义令牌 + Element dark css-vars 共用），localStorage 持久化 */
import { ref } from 'vue'

const STORAGE_KEY = 'admin-theme'

export const isDark = ref(false)

function apply(dark: boolean) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
}

export function initTheme() {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    // 隐私模式等场景读取失败时按默认 light
  }
  apply(saved === 'dark')
}

export function toggleTheme() {
  apply(!isDark.value)
  try {
    localStorage.setItem(STORAGE_KEY, isDark.value ? 'dark' : 'light')
  } catch {
    // 写入失败不影响本次会话
  }
}
