import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const STORAGE_KEY = 'starclouds-locale'

export const LOCALE_OPTIONS = [
  { value: 'zh-CN', short: '简', label: '简体中文' },
  { value: 'en', short: 'EN', label: 'English' },
  { value: 'zh-TW', short: '繁', label: '繁體中文' },
]

function normalizeLocale(value) {
  const locale = String(value || '').toLowerCase()
  if (locale === 'en' || locale.startsWith('en-')) return 'en'
  if (locale === 'zh-tw' || locale === 'zh-hk' || locale === 'zh-hant') return 'zh-TW'
  return 'zh-CN'
}

function readLocale() {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return normalizeLocale(stored)
    } catch {
      /* ignore unavailable storage */
    }
  }
  return normalizeLocale(typeof navigator !== 'undefined' ? navigator.language : 'zh-CN')
}

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref(readLocale())
  const option = computed(
    () => LOCALE_OPTIONS.find((item) => item.value === locale.value) || LOCALE_OPTIONS[0],
  )

  function applyToDocument() {
    if (typeof document === 'undefined') return
    document.documentElement.lang = locale.value
    document.documentElement.dataset.locale = locale.value
  }

  function setLocale(value) {
    locale.value = normalizeLocale(value)
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, locale.value)
      } catch {
        /* ignore unavailable storage */
      }
    }
    applyToDocument()
  }

  applyToDocument()

  return { locale, option, options: LOCALE_OPTIONS, setLocale, applyToDocument }
})
