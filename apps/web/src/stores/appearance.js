import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const STORAGE_KEY = 'walleven-color-scheme'

function readStoredScheme() {
  if (typeof localStorage === 'undefined') return 'light'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    /* ignore */
  }
  return 'light'
}

function writeStoredScheme(scheme) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, scheme)
  } catch {
    /* ignore */
  }
}

/**
 * 全局亮/暗偏好。由导航栏切换，写入 html.color-scheme-dark；各画廊页分别消费。
 */
export const useAppearanceStore = defineStore('appearance', () => {
  const scheme = ref(readStoredScheme())
  const isDark = computed(() => scheme.value === 'dark')

  function applyToDocument() {
    if (typeof document === 'undefined') return
    const dark = scheme.value === 'dark'
    document.documentElement.classList.toggle('color-scheme-dark', dark)
    document.documentElement.dataset.colorScheme = scheme.value
  }

  function setScheme(next) {
    scheme.value = next === 'dark' ? 'dark' : 'light'
    writeStoredScheme(scheme.value)
    applyToDocument()
  }

  function toggle() {
    setScheme(scheme.value === 'dark' ? 'light' : 'dark')
  }

  applyToDocument()

  return {
    scheme,
    isDark,
    setScheme,
    toggle,
    applyToDocument,
  }
})
