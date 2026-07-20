import {
  animate,
  cancelAnimations,
  createTimeline,
  ms,
  prefersReducedMotion,
  set,
  stagger,
  ANIME_EASE_ENTER,
  ANIME_EASE_SMOOTH,
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
  set(list, {
    opacity: 1,
    translateY: 0,
  })
}

/**
 * 收藏标签页轻量 anime.js 动效：顶栏入场 + 卡片软淡入
 */
export function useTagsPageMotion({ pageRef, feedRef, ready, filterKey, loading }) {
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

    const parts = [...root.querySelectorAll('[data-tags-motion]')]
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
    if (!feed || loading?.value) return

    const cards = [...feed.querySelectorAll('.tag-card')].slice(0, 24)
    if (!cards.length) return

    cancelAnimations(cards)

    if (!canAnimate()) {
      clearMotionProps(cards)
      return
    }

    set(cards, { opacity: 0, translateY: soft ? 6 : 10 })
    listTween = animate(cards, {
      opacity: { to: 1 },
      translateY: { to: 0 },
      duration: soft ? ms(0.2) : ms(0.3),
      delay: stagger(soft ? 10 : 18),
      ease: soft ? ANIME_EASE_SMOOTH : ANIME_EASE_ENTER,
    })
  }

  const stopReady = watch(
    () => Boolean(ready?.value),
    async (isReady) => {
      if (!isReady) return
      await nextTick()
      playIntro()
      await nextTick()
      playListReveal({ soft: false })
    },
    { immediate: true },
  )

  let listGen = 0
  const stopItems = watch(
    () => [filterKey?.value ?? '', loading?.value],
    async (current, previous) => {
      if (!introPlayed || current?.[1]) return
      if (previous === undefined) return
      const gen = ++listGen
      await nextTick()
      if (gen !== listGen) return
      playListReveal({ soft: true })
    },
  )

  onBeforeUnmount(() => {
    stopReady()
    stopItems()
    try {
      introTimeline?.pause?.()
    } catch {
      /* ignore */
    }
    cancelAnimations(listTween)
    const root = pageRef?.value
    if (root) {
      clearMotionProps(root.querySelectorAll('[data-tags-motion], .tag-card'))
    }
  })

  return { playIntro, playListReveal, markReady }
}
