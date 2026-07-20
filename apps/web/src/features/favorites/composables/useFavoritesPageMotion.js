import {
  cancelAnimations,
  createTimeline,
  ms,
  prefersReducedMotion,
  set,
  stagger,
  ANIME_EASE_ENTER,
  ANIME_EASE_OVERSHOOT,
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
    rotate: 0,
    scale: 1,
  })
}

/**
 * 收藏页轻量 anime.js 入场：
 * - 侧栏 / Hero / 工具条 stagger
 * - 封面条错落入场（位错 + 轻微旋转）
 * - 动画失败时强制恢复可见，避免白屏
 */
export function useFavoritesPageMotion({ pageRef, ready }) {
  let introPlayed = false
  let introTimeline = null

  function markReady() {
    const root = pageRef?.value
    if (root) root.classList.add('is-ready')
  }

  function playIntro() {
    const root = pageRef?.value
    if (!root || introPlayed) return
    introPlayed = true

    const parts = [...root.querySelectorAll('[data-fav-motion]')]
    const covers = [...root.querySelectorAll('[data-fav-cover]')]
    const allTargets = [...parts, ...covers]

    if (!canAnimate()) {
      clearMotionProps(allTargets)
      covers.forEach((el) => el.classList.add('is-cover-ready'))
      markReady()
      return
    }

    try {
      cancelAnimations(allTargets)
      if (parts.length) set(parts, { opacity: 0, translateY: 10 })
      if (covers.length) {
        set(covers, {
          opacity: 0,
          translateY: 22,
          rotate: -6,
          scale: 0.92,
        })
      }
      markReady()

      try {
        introTimeline?.pause?.()
      } catch {
        /* ignore */
      }

      introTimeline = createTimeline({ defaults: { ease: ANIME_EASE_ENTER } })

      if (parts.length) {
        introTimeline.add(parts, {
          opacity: { to: 1 },
          translateY: { to: 0 },
          duration: ms(0.36),
          delay: stagger(48),
        })
      }

      if (covers.length) {
        introTimeline.add(
          covers,
          {
            opacity: { to: 1 },
            translateY: { to: 0 },
            rotate: { to: 0 },
            scale: { to: 1 },
            duration: ms(0.48),
            delay: stagger(70),
            ease: ANIME_EASE_OVERSHOOT,
            onComplete: () => {
              covers.forEach((el) => {
                el.classList.add('is-cover-ready')
                // 清掉入场内联 transform，交给 CSS --cover-y / --cover-rot 错落与浮动
                el.style.removeProperty('transform')
                el.style.removeProperty('translate')
                el.style.removeProperty('rotate')
                el.style.removeProperty('scale')
                el.style.removeProperty('opacity')
              })
            },
          },
          parts.length ? `-=${ms(0.18)}` : 0,
        )
      }
    } catch {
      clearMotionProps(allTargets)
      covers.forEach((el) => el.classList.add('is-cover-ready'))
      markReady()
    }
  }

  const stopReady = watch(
    () => Boolean(ready?.value),
    async (isReady) => {
      if (!isReady) return
      await nextTick()
      playIntro()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stopReady()
    try {
      introTimeline?.pause?.()
    } catch {
      /* ignore */
    }
    const root = pageRef?.value
    if (root) {
      clearMotionProps(root.querySelectorAll('[data-fav-motion], [data-fav-cover]'))
    }
  })

  return { playIntro, markReady }
}
