import { computed, nextTick, ref } from 'vue'

export function useSearchWorkbenchUi({ settingsStore, isWorkbenchVisible } = {}) {
  const prefersReducedMotion = ref(false)
  const motionPulse = ref(false)
  const workbenchScrollHidden = ref(false)
  const searchUiOpacity = ref(1)

  const workbenchEl = ref(null)
  const searchMainEl = ref(null)
  const resultsAnchorEl = ref(null)
  const workbenchHeight = ref(88)

  let cachedSiteHeaderEl = null
  let lastScrollY = 0
  let motionPulseTimer = null
  let workbenchResizeObserver = null
  let workbenchScrollStopTimer = null
  let workbenchRevealDebounceTimer = null
  let searchUiOpacityTarget = 1
  let searchUiOpacityRaf = null

  const motionEnabled = computed(
    () => settingsStore.getSetting('enable_animations', true) && !prefersReducedMotion.value,
  )

  const searchUiRestoreDelayMs = computed(() => {
    const ms = Number(settingsStore.getSetting('search_ui_restore_delay_ms', Number.NaN))
    if (Number.isFinite(ms)) {
      return Math.round(Math.min(10000, Math.max(300, ms)))
    }

    const legacySec = Number(settingsStore.getSetting('search_ui_restore_delay_sec', 3))
    const safeSec = Number.isFinite(legacySec) ? legacySec : 3
    return Math.round(Math.min(10000, Math.max(300, safeSec * 1000)))
  })

  const mainPaddingTop = computed(() => (isWorkbenchVisible?.value === false ? 8 : workbenchHeight.value))
  const bulkBarInset = computed(() => 0)
  const mainPaddingStyle = computed(() => ({
    paddingTop: `${mainPaddingTop.value}px`,
    paddingBottom: `${bulkBarInset.value}px`,
  }))

  function triggerMotionPulse() {
    if (!motionEnabled.value) return

    motionPulse.value = false
    if (motionPulseTimer) {
      clearTimeout(motionPulseTimer)
    }

    requestAnimationFrame(() => {
      motionPulse.value = true
      motionPulseTimer = window.setTimeout(() => {
        motionPulse.value = false
        motionPulseTimer = null
      }, 380)
    })
  }

  function setSiteHeaderScrollHidden(hidden) {
    if (typeof document === 'undefined') return
    if (!cachedSiteHeaderEl) {
      cachedSiteHeaderEl = document.querySelector('.site-header')
    }
    cachedSiteHeaderEl?.classList.toggle('search-scroll-hidden', hidden)
  }

  function commitSearchUiOpacity() {
    if (typeof document === 'undefined') return
    document.documentElement.style.setProperty('--search-ui-opacity', String(searchUiOpacity.value))
  }

  function animateSearchUiOpacity() {
    const delta = searchUiOpacityTarget - searchUiOpacity.value
    if (Math.abs(delta) < 0.01) {
      searchUiOpacity.value = searchUiOpacityTarget
      commitSearchUiOpacity()
      searchUiOpacityRaf = null
      return
    }

    searchUiOpacity.value += delta * 0.16
    commitSearchUiOpacity()
    searchUiOpacityRaf = requestAnimationFrame(animateSearchUiOpacity)
  }

  function setSearchUiOpacityTarget(target) {
    searchUiOpacityTarget = Math.max(0, Math.min(1, target))
    if (searchUiOpacityRaf != null) return
    searchUiOpacityRaf = requestAnimationFrame(animateSearchUiOpacity)
  }

  function applySearchUiHidden(hidden) {
    workbenchScrollHidden.value = hidden
    setSiteHeaderScrollHidden(hidden)
    setSearchUiOpacityTarget(hidden ? 0 : 1)
  }

  function onSearchUiScroll() {
    const y = Math.max(
      0,
      window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0,
    )
    const delta = y - lastScrollY
    lastScrollY = y

    const contentAtViewportTop =
      searchMainEl.value?.getBoundingClientRect?.().top != null
        ? searchMainEl.value.getBoundingClientRect().top <= 0
        : false

    if (!contentAtViewportTop) {
      applySearchUiHidden(false)
      if (workbenchScrollStopTimer) {
        clearTimeout(workbenchScrollStopTimer)
        workbenchScrollStopTimer = null
      }
      return
    }

    if (y <= 8) {
      applySearchUiHidden(false)
      if (workbenchScrollStopTimer) {
        clearTimeout(workbenchScrollStopTimer)
        workbenchScrollStopTimer = null
      }
      if (workbenchRevealDebounceTimer) {
        clearTimeout(workbenchRevealDebounceTimer)
        workbenchRevealDebounceTimer = null
      }
      return
    }

    if (delta > 4) {
      if (workbenchRevealDebounceTimer) {
        clearTimeout(workbenchRevealDebounceTimer)
        workbenchRevealDebounceTimer = null
      }
      applySearchUiHidden(true)
    } else if (delta < -6) {
      if (workbenchRevealDebounceTimer) {
        clearTimeout(workbenchRevealDebounceTimer)
      }
      workbenchRevealDebounceTimer = window.setTimeout(() => {
        applySearchUiHidden(false)
        workbenchRevealDebounceTimer = null
      }, 120)
    }

    if (workbenchScrollStopTimer) {
      clearTimeout(workbenchScrollStopTimer)
    }

    workbenchScrollStopTimer = window.setTimeout(() => {
      if (workbenchRevealDebounceTimer) {
        clearTimeout(workbenchRevealDebounceTimer)
        workbenchRevealDebounceTimer = null
      }
      applySearchUiHidden(false)
      workbenchScrollStopTimer = null
    }, searchUiRestoreDelayMs.value)
  }

  function measureSearchLayout() {
    if (isWorkbenchVisible?.value === false) {
      workbenchHeight.value = 0
      return
    }
    if (workbenchEl.value) {
      const nextHeight = Math.ceil(workbenchEl.value.getBoundingClientRect().height)
      if (Math.abs(nextHeight - workbenchHeight.value) > 1) {
        workbenchHeight.value = nextHeight
      }
    }
  }

  function scrollResultsIntoView() {
    nextTick(() => {
      resultsAnchorEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function initSearchWorkbenchUi() {
    try {
      prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      prefersReducedMotion.value = false
    }

    await nextTick()
    measureSearchLayout()

    if (typeof ResizeObserver !== 'undefined' && workbenchEl.value) {
      workbenchResizeObserver = new ResizeObserver(() => measureSearchLayout())
      workbenchResizeObserver.observe(workbenchEl.value)
    }

    window.addEventListener('resize', measureSearchLayout)
    lastScrollY = Math.max(
      0,
      window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0,
    )
    window.addEventListener('scroll', onSearchUiScroll, { passive: true })
    searchUiOpacity.value = 1
    searchUiOpacityTarget = 1
    commitSearchUiOpacity()
  }

  function cleanupSearchWorkbenchUi() {
    workbenchResizeObserver?.disconnect()
    workbenchResizeObserver = null
    window.removeEventListener('resize', measureSearchLayout)
    window.removeEventListener('scroll', onSearchUiScroll)

    if (motionPulseTimer) {
      clearTimeout(motionPulseTimer)
      motionPulseTimer = null
    }
    if (workbenchScrollStopTimer) {
      clearTimeout(workbenchScrollStopTimer)
      workbenchScrollStopTimer = null
    }
    if (workbenchRevealDebounceTimer) {
      clearTimeout(workbenchRevealDebounceTimer)
      workbenchRevealDebounceTimer = null
    }
    if (searchUiOpacityRaf != null) {
      cancelAnimationFrame(searchUiOpacityRaf)
      searchUiOpacityRaf = null
    }

    applySearchUiHidden(false)
    searchUiOpacity.value = 1
    commitSearchUiOpacity()
  }

  return {
    workbenchEl,
    searchMainEl,
    resultsAnchorEl,
    workbenchHeight,
    workbenchScrollHidden,
    motionEnabled,
    motionPulse,
    mainPaddingStyle,
    triggerMotionPulse,
    measureSearchLayout,
    scrollResultsIntoView,
    initSearchWorkbenchUi,
    cleanupSearchWorkbenchUi,
  }
}
