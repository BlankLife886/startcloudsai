import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** 响应式布局：桌面三栏 / 平板双栏 / 移动 Dock */
export function useStudioLayout() {
  const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)

  function syncViewport() {
    if (typeof window === 'undefined') return
    viewportWidth.value = window.innerWidth
  }

  onMounted(() => {
    syncViewport()
    window.addEventListener('resize', syncViewport, { passive: true })
  })

  onBeforeUnmount(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('resize', syncViewport)
  })

  const layoutMode = computed(() => {
    if (viewportWidth.value < 768) return 'mobile'
    if (viewportWidth.value < 1024) return 'tablet'
    return 'desktop'
  })

  const isMobile = computed(() => layoutMode.value === 'mobile')
  const isTablet = computed(() => layoutMode.value === 'tablet')
  const isDesktop = computed(() => layoutMode.value === 'desktop')

  return {
    viewportWidth,
    layoutMode,
    isMobile,
    isTablet,
    isDesktop,
  }
}
