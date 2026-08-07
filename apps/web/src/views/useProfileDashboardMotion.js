import { nextTick, onBeforeUnmount, watch } from 'vue'
import { gsap } from 'gsap'

/**
 * 个人中心总览：画布入口 / 卡片入场。
 * 仅 transform / opacity，尊重 reduced-motion。
 */
export function useProfileDashboardMotion({ rootRef, activeTab }) {
  let media = null

  function kill() {
    media?.revert()
    media = null
  }

  async function play() {
    kill()
    await nextTick()
    const root = rootRef.value
    if (!root || activeTab.value !== 'dashboard') return

    media = gsap.matchMedia()
    media.add(
      {
        reduce: '(prefers-reduced-motion: reduce)',
        motion: '(prefers-reduced-motion: no-preference)',
      },
      (context) => {
        const { reduce } = context.conditions
        const hero = root.querySelector('.pp-soft-hero')
        const figure = root.querySelector('.pp-bento-hero-figure')
        const perf = root.querySelector('.pp-soft-performance')
        const stats = gsap.utils.toArray('.pp-soft-stat', root)

        if (reduce) {
          gsap.set([hero, figure, perf, ...stats].filter(Boolean), {
            clearProps: 'all',
          })
          return
        }

        const ctx = gsap.context(() => {
          const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

          if (hero) {
            gsap.set(hero, { autoAlpha: 0, y: 18 })
            tl.to(hero, { autoAlpha: 1, y: 0, duration: 0.5 }, 0)
          }

          if (figure) {
            gsap.set(figure, { autoAlpha: 0, y: 20 })
            tl.to(figure, { autoAlpha: 1, y: 0, duration: 0.55 }, 0.12)
          }

          if (perf) {
            gsap.set(perf, { autoAlpha: 0, y: 22 })
            tl.to(perf, { autoAlpha: 1, y: 0, duration: 0.48 }, 0.1)
          }

          if (stats.length) {
            gsap.set(stats, { autoAlpha: 0, y: 18 })
            tl.to(
              stats,
              {
                autoAlpha: 1,
                y: 0,
                duration: 0.45,
                stagger: 0.05,
                clearProps: 'transform',
              },
              0.16,
            )
          }
        }, root)

        return () => ctx.revert()
      },
    )
  }

  watch(
    activeTab,
    (tab) => {
      if (tab === 'dashboard') play()
      else kill()
    },
    { flush: 'post' },
  )

  onBeforeUnmount(kill)

  return { playDashboardMotion: play }
}
