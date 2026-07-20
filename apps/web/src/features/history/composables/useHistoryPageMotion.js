import {
  cancelAnimations,
  createTimeline,
  ms,
  prefersReducedMotion,
  set,
  stagger,
  ANIME_EASE_ENTER,
} from '@/lib/anime'
import { nextTick, onBeforeUnmount, watch } from 'vue'

function canAnimate() {
  if (typeof window === 'undefined') return false
  if (prefersReducedMotion()) return false
  if (document.documentElement.classList.contains('settings-no-animations')) return false
  return true
}

function clearMotionProps(targets) {
  const list = Array.isArray(targets) ? targets : [...(targets || [])]
  if (!list.length) return
  cancelAnimations(list)
  set(list, { opacity: 1, translateY: 0 })
}

/**
 * 浏览历史页轻量动效：顶栏入场 + 列表软淡入
 */
export function useHistoryPageMotion({ pageRef, feedRef, ready, filterKey }) {
  let introPlayed = false
  let listTween = null
  let introTimeline = null

  function markReady() {
    const root = pageRef?.value
    if (root) root.classList.add('is-ready')
  }

  function playIntro() {
    const root = pageRef?.value
    if (!root || introPlayed) return
    introPlayed = true

    const parts = [...root.querySelectorAll('[data-history-motion]')]
    if (!canAnimate() || !parts.length) {
      clearMotionProps(parts)
      markReady()
      return
    }

    cancelAnimations(parts)
    set(parts, { opacity: 0, translateY: 10 })
    markReady()

    introTimeline?.pause?.()
    introTimeline = createTimeline({ defaults: { ease: ANIME_EASE_ENTER } })
    introTimeline.add(parts, {
      opacity: { to: 1 },
      translateY: { to: 0 },
      duration: ms(0.36),
      delay: stagger(48),
    })
  }

  function playListReveal({ soft = false } = {}) {
    const feed = feedRef?.value
    if (!feed) return

    const rows = [
      ...feed.querySelectorAll(
        '.history-timeline-item, .history-card, .history-stats-card, .history-stats-panel',
      ),
    ].slice(0, 28)
    if (!rows.length) return

    cancelAnimations(rows)

    if (!canAnimate()) {
      clearMotionProps(rows)
      return
    }

    set(rows, { opacity: 0, translateY: soft ? 6 : 10 })
    listTween = createTimeline({ defaults: { ease: ANIME_EASE_ENTER } })
    listTween.add(rows, {
      opacity: { to: 1 },
      translateY: { to: 0 },
      duration: ms(soft ? 0.22 : 0.32),
      delay: stagger(soft ? 12 : 28),
    })
  }

  watch(
    () => ready?.value,
    async (isReady) => {
      if (!isReady) return
      await nextTick()
      playIntro()
      playListReveal()
    },
    { immediate: true },
  )

  watch(
    () => filterKey?.value,
    async () => {
      if (!ready?.value) return
      await nextTick()
      playListReveal({ soft: true })
    },
  )

  onBeforeUnmount(() => {
    listTween?.pause?.()
    introTimeline?.pause?.()
  })
}
