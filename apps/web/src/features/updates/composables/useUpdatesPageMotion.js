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
 * 更新说明页轻量动效：顶区入场 + 时间线条目 stagger
 */
export function useUpdatesPageMotion({ pageRef, timelineRef, ready, filterKey }) {
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

    const parts = [...root.querySelectorAll('[data-updates-motion]')]
    if (!canAnimate() || !parts.length) {
      clearMotionProps(parts)
      markReady()
      return
    }

    cancelAnimations(parts)
    set(parts, { opacity: 0, translateY: 14 })
    markReady()

    introTimeline?.pause?.()
    introTimeline = createTimeline({ defaults: { ease: ANIME_EASE_ENTER } })
    introTimeline.add(parts, {
      opacity: { to: 1 },
      translateY: { to: 0 },
      duration: ms(0.42),
      delay: stagger(56),
    })
  }

  function playList({ soft = false } = {}) {
    const feed = timelineRef?.value
    if (!feed) return

    const cards = [...feed.querySelectorAll('.updates-spotlight, .updates-entry')].slice(0, 24)
    if (!cards.length) return

    cancelAnimations(cards)

    if (!canAnimate()) {
      clearMotionProps(cards)
      return
    }

    set(cards, { opacity: 0, translateY: soft ? 6 : 12 })
    listTween = createTimeline({ defaults: { ease: ANIME_EASE_ENTER } })
    listTween.add(cards, {
      opacity: { to: 1 },
      translateY: { to: 0 },
      duration: ms(soft ? 0.22 : 0.34),
      delay: stagger(soft ? 14 : 30),
    })
  }

  watch(
    () => ready?.value,
    async (isReady) => {
      if (!isReady) return
      await nextTick()
      playIntro()
      playList()
    },
    { immediate: true },
  )

  watch(
    () => filterKey?.value,
    async () => {
      await nextTick()
      playList({ soft: true })
    },
  )

  onBeforeUnmount(() => {
    introTimeline?.pause?.()
    listTween?.pause?.()
    introTimeline = null
    listTween = null
  })

  return { playIntro, playList }
}
